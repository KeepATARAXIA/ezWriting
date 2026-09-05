import JSZip from 'jszip'
import type { PersistedDraft } from '../domain/saved-draft'
import type { DraftBackupAsset, DraftBackupRecord, DraftRepository } from './draft-repository'
import { DRAFT_ASSET_PROTOCOL, prepareDraftForBackup } from './local-draft-repository'
import { LAST_ACTIVE_DRAFT_SETTING, LOCAL_BACKUP_FORMAT, normalizeBackupDraft, type BackupOperationOptions, type LocalBackupPayload } from './local-backup'

export const BACKUP_ARCHIVE_EXTENSION = '.ezwriting-backup.zip'
export const MAX_BACKUP_ASSET_BYTES = 100 * 1024 * 1024
export const MAX_BACKUP_MEDIA_BYTES = 512 * 1024 * 1024
export const MAX_BACKUP_MANIFEST_BYTES = 16 * 1024 * 1024
export const MAX_BACKUP_ARCHIVE_BYTES = 532 * 1024 * 1024
const MAX_ASSETS = 5000
const MAX_DRAFTS = 1000
const REFERENCE = /dispatch-asset:\/\/([a-z0-9-]+)/gi
const TEMPORARY_MEDIA = /blob:(?:https?:\/\/|null\/)|dispatch-local-video:\/\/[a-z0-9-]+/i

interface AssetDescriptor {
  id: string
  path: string
  mimeType: string
  byteSize: number
  sha256: string
}

interface Manifest {
  format: typeof LOCAL_BACKUP_FORMAT
  version: 2
  exportedAt: string
  activeDraftId: string | null
  drafts: PersistedDraft[]
  assets: AssetDescriptor[]
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function check(options: BackupOperationOptions, message?: string) {
  options.signal?.throwIfAborted()
  if (message) options.onProgress?.(message)
  options.signal?.throwIfAborted()
}

async function yieldToBrowser(options: BackupOperationOptions) {
  await new Promise(resolve => setTimeout(resolve, 0))
  check(options)
}

function allowedMime(mime: string): boolean {
  return mime.length <= 64 && (/^image\/[a-z0-9.+-]+$/.test(mime) || mime === 'video/mp4' || mime === 'video/webm')
}

async function hash(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法校验媒体完整性，请使用本地或 HTTPS 页面。')
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function assetId(mime: string, digest: string): string {
  return `sha256-${mime.replace(/[^a-z0-9]+/g, '-')}-${digest}`
}

function mapSources(draft: PersistedDraft, replace: (value: string) => string): PersistedDraft {
  return { ...draft, article: { ...draft.article,
    html: replace(draft.article.html),
    markdown: draft.article.markdown === undefined ? undefined : replace(draft.article.markdown),
    sourceText: draft.article.sourceText === undefined ? undefined : replace(draft.article.sourceText),
  } }
}

// Work with bounded chunks. Cancellation pauses the producer and releases our chunks.
function collectStream(stream: JSZip.JSZipStreamHelper<Uint8Array>, limit: number, options: BackupOperationOptions, onPercent?: (percent: number) => void): Promise<Uint8Array<ArrayBuffer>[]> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let length = 0
    let settled = false
    const cleanup = () => options.signal?.removeEventListener('abort', cancel)
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      stream.pause()
      chunks.length = 0
      cleanup()
      reject(error)
    }
    const cancel = () => fail(new DOMException('备份操作已取消。', 'AbortError'))
    if (options.signal?.aborted) { cancel(); return }
    options.signal?.addEventListener('abort', cancel, { once: true })
    stream.on('data', (chunk, metadata) => {
      if (settled) return
      length += chunk.byteLength
      if (length > limit) { fail(new Error('备份解压或打包大小超过安全上限。')); return }
      chunks.push(new Uint8Array(chunk))
      try { onPercent?.(Math.floor(metadata.percent)) } catch (error) { fail(error) }
    }).on('error', fail).on('end', () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(chunks)
    }).resume()
  })
}

export async function createBackupArchive(repository: DraftRepository, now = new Date(), draftOverride?: PersistedDraft, options: BackupOperationOptions = {}) {
  check(options, '正在读取备份清单…')
  const summaries = await repository.listDrafts({ includeDeleted: true })
  const ids = [...new Set([...summaries.map(draft => draft.id), ...(draftOverride ? [draftOverride.id] : [])])]
  if (ids.length > MAX_DRAFTS) throw new Error('单个备份最多包含 1000 篇稿件。')
  const active = draftOverride?.id ?? await repository.getSetting<string>(LAST_ACTIVE_DRAFT_SETTING)
  const zip = new JSZip()
  const descriptors = new Map<string, AssetDescriptor>()
  const drafts: PersistedDraft[] = []
  let mediaBytes = 0
  let manifestDraftBytes = 0
  for (const [index, id] of ids.entries()) {
    check(options, `正在整理稿件 ${index + 1}/${ids.length}…`)
    let snapshot: DraftBackupRecord | null
    if (draftOverride?.id === id) snapshot = await prepareDraftForBackup(draftOverride)
    else if (repository.readDraftForBackup) {
      snapshot = await repository.readDraftForBackup(id)
      if (snapshot) {
        const inline = await prepareDraftForBackup(snapshot.draft)
        snapshot = { draft: inline.draft, assets: [...snapshot.assets, ...inline.assets] }
      }
    } else {
      const draft = await repository.getDraft(id)
      snapshot = draft ? await prepareDraftForBackup(draft) : null
    }
    if (!snapshot) throw new Error('备份过程中稿件已被其他页面删除，请重试。')
    const replacements = new Map<string, string>()
    for (const asset of snapshot.assets) {
      check(options, `正在校验稿件 ${index + 1}/${ids.length} 的媒体…`)
      if (!allowedMime(asset.mimeType) || asset.bytes.byteLength !== asset.byteSize) throw new Error('本地媒体格式或长度异常。')
      if (asset.byteSize > MAX_BACKUP_ASSET_BYTES) throw new Error('备份单个媒体不能超过 100 MiB。')
      const digest = await hash(asset.bytes)
      check(options)
      const canonicalId = assetId(asset.mimeType, digest)
      replacements.set(asset.id, canonicalId)
      if (!descriptors.has(canonicalId)) {
        mediaBytes += asset.byteSize
        if (mediaBytes > MAX_BACKUP_MEDIA_BYTES) throw new Error('备份去重媒体总量不能超过 512 MiB。')
        if (descriptors.size >= MAX_ASSETS) throw new Error('单个备份最多包含 5000 个媒体文件。')
        const path = `assets/${canonicalId}.bin`
        descriptors.set(canonicalId, { id: canonicalId, path, mimeType: asset.mimeType, byteSize: asset.byteSize, sha256: digest })
        zip.file(path, asset.bytes, { binary: true, compression: 'STORE', createFolders: false })
      }
      await yieldToBrowser(options)
    }
    const draft = mapSources(snapshot.draft, value => {
      if (TEMPORARY_MEDIA.test(value)) throw new Error('稿件含有失效的临时媒体引用，请重新选择媒体后备份。')
      return value.replace(REFERENCE, (_source, asset: string) => {
        const target = replacements.get(asset)
        if (!target) throw new Error(`稿件缺少媒体原件：${asset}`)
        return `${DRAFT_ASSET_PROTOCOL}${target}`
      })
    })
    manifestDraftBytes += new TextEncoder().encode(JSON.stringify(draft)).byteLength
    if (manifestDraftBytes > MAX_BACKUP_MANIFEST_BYTES) throw new Error('备份文字清单不能超过 16 MiB。')
    normalizeArchiveDraft(draft, now.toISOString(), descriptors)
    drafts.push(draft)
    await yieldToBrowser(options)
  }
  const manifest: Manifest = { format: LOCAL_BACKUP_FORMAT, version: 2, exportedAt: now.toISOString(), activeDraftId: active && ids.includes(active) ? active : null, drafts, assets: [...descriptors.values()] }
  const manifestText = JSON.stringify(manifest)
  const manifestBytes = new TextEncoder().encode(manifestText)
  if (manifestBytes.byteLength > MAX_BACKUP_MANIFEST_BYTES) throw new Error('备份文字清单不能超过 16 MiB。')
  zip.file('manifest.json', manifestText, { compression: 'STORE', createFolders: false })
  let previousPercent = -1
  const chunks = await collectStream(zip.generateInternalStream({ type: 'uint8array', compression: 'STORE', streamFiles: true }), MAX_BACKUP_ARCHIVE_BYTES, options, percent => {
    if (percent !== previousPercent) { previousPercent = percent; check(options, `正在生成备份 ${percent}%…`) }
  })
  check(options)
  const blob = new Blob(chunks, { type: 'application/zip' })
  return { blob, draftCount: drafts.length, assetCount: descriptors.size, mediaBytes,
    fileName: `ezwriting-${now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}${BACKUP_ARCHIVE_EXTENSION}` }
}

// Inspect the directory before JSZip normalizes names or allocates decompressed files.
function validateDirectory(bytes: Uint8Array): Map<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break }
  }
  if (end < 0) throw new Error('备份 ZIP 目录损坏。')
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  let offset = view.getUint32(end + 16, true)
  const directoryEnd = offset + size
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count > MAX_ASSETS + 1 || directoryEnd !== end) throw new Error('备份 ZIP 分卷、文件数量或目录无效。')
  const files = new Map<string, number>()
  let total = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('备份 ZIP 目录损坏。')
    const nameSize = view.getUint16(offset + 28, true)
    const entryEnd = offset + 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    if (entryEnd > directoryEnd) throw new Error('备份 ZIP 目录损坏。')
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameSize))
    if (name !== 'manifest.json' && !/^assets\/[a-z0-9-]{1,150}\.bin$/.test(name)) throw new Error('备份含有不安全或未知文件路径。')
    if (files.has(name)) throw new Error('备份包含重复文件路径。')
    const length = view.getUint32(offset + 24, true)
    const limit = name === 'manifest.json' ? MAX_BACKUP_MANIFEST_BYTES : MAX_BACKUP_ASSET_BYTES
    if (length > limit) throw new Error('备份单文件解压大小超限。')
    total += length
    if (total > MAX_BACKUP_MEDIA_BYTES + MAX_BACKUP_MANIFEST_BYTES) throw new Error('备份解压总大小超限。')
    if ((view.getUint16(offset + 8, true) & 1) || ![0, 8].includes(view.getUint16(offset + 10, true))) throw new Error('不支持加密或特殊压缩的备份。')
    files.set(name, length)
    offset = entryEnd
  }
  if (offset !== directoryEnd || !files.has('manifest.json')) throw new Error('备份缺少完整清单。')
  return files
}

async function readEntry(zip: JSZip, name: string, size: number, options: BackupOperationOptions): Promise<Uint8Array<ArrayBuffer>> {
  const entry = zip.file(name) as (JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }) | null
  if (!entry || entry.unsafeOriginalName !== name) throw new Error('备份媒体文件缺失或路径异常。')
  const chunks = await collectStream(entry.internalStream('uint8array'), size, options)
  const actualSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  if (actualSize !== size) throw new Error('备份文件长度校验失败。')
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}

function normalizeArchiveDraft(raw: unknown, exportedAt: string, assets: ReadonlyMap<string, Pick<DraftBackupAsset, 'mimeType'>>): PersistedDraft {
  if (!record(raw) || !record(raw.article) || typeof raw.article.html !== 'string') throw new Error('备份稿件结构无效。')
  for (const field of ['html', 'markdown', 'sourceText']) {
    const value = raw.article[field]
    if (typeof value !== 'string') continue
    if (TEMPORARY_MEDIA.test(value) || /data:(?:image|video)\/[^\s<>"']*,/i.test(value)) throw new Error('新版备份含有未分离的媒体数据。')
    for (const match of value.matchAll(REFERENCE)) if (!assets.has(match[1])) throw new Error('备份稿件引用了缺失媒体。')
  }
  const replacements = new Map<string, string>()
  const protectedHtml = raw.article.html.replace(/(<(img|video)\b[^>]*?\bsrc\s*=\s*)(["'])(dispatch-asset:\/\/([a-z0-9-]+))\3/gi,
    (_syntax, prefix: string, tag: string, quote: string, reference: string, id: string) => {
      const asset = assets.get(id)
      if (!asset || (tag.toLowerCase() === 'video') !== asset.mimeType.startsWith('video/')) throw new Error('备份媒体类型与正文不一致。')
      const placeholder = `data:${asset.mimeType};base64,${btoa(crypto.randomUUID())}`
      replacements.set(placeholder, reference)
      return `${prefix}${quote}${placeholder}${quote}`
    })
  const draft = normalizeBackupDraft({ ...raw, article: { ...raw.article, html: protectedHtml } }, exportedAt)
  for (const [placeholder, reference] of replacements) draft.article.html = draft.article.html.replaceAll(placeholder, reference)
  return draft
}

export async function parseBackupArchive(file: File, options: BackupOperationOptions = {}): Promise<LocalBackupPayload> {
  check(options, '正在检查备份结构…')
  if (file.size > MAX_BACKUP_ARCHIVE_BYTES) throw new Error('备份资产包不能超过 532 MiB。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  check(options)
  const directory = validateDirectory(bytes)
  const zip = await JSZip.loadAsync(bytes)
  check(options)
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder().decode(await readEntry(zip, 'manifest.json', directory.get('manifest.json')!, options))) }
  catch (error) { options.signal?.throwIfAborted(); throw new Error(`备份清单读取失败：${(error as Error).message}`) }
  if (!record(raw) || raw.format !== LOCAL_BACKUP_FORMAT || raw.version !== 2) throw new Error('不支持这个备份资产包版本。')
  if (!Array.isArray(raw.drafts) || raw.drafts.length > MAX_DRAFTS || !Array.isArray(raw.assets) || raw.assets.length > MAX_ASSETS) throw new Error('备份稿件或媒体数量无效。')
  const assets = new Map<string, DraftBackupAsset>()
  let mediaBytes = 0
  for (const [index, item] of raw.assets.entries()) {
    check(options, `正在校验媒体 ${index + 1}/${raw.assets.length}…`)
    if (!record(item) || typeof item.id !== 'string' || typeof item.mimeType !== 'string' || !allowedMime(item.mimeType) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || item.id !== assetId(item.mimeType, item.sha256)) throw new Error('备份媒体清单无效。')
    if (assets.has(item.id)) throw new Error('备份媒体清单包含重复项。')
    const path = `assets/${item.id}.bin`
    const size = directory.get(path)
    if (item.path !== path || size === undefined || item.byteSize !== size) throw new Error('备份媒体缺失或长度不匹配。')
    mediaBytes += size
    if (mediaBytes > MAX_BACKUP_MEDIA_BYTES) throw new Error('备份去重媒体总量不能超过 512 MiB。')
    const data = await readEntry(zip, path, size, options)
    if (await hash(data.buffer) !== item.sha256) throw new Error('备份媒体完整性校验失败，文件可能已损坏。')
    assets.set(item.id, { id: item.id, bytes: data.buffer, byteSize: size, mimeType: item.mimeType })
    await yieldToBrowser(options)
  }
  if (directory.size !== assets.size + 1) throw new Error('备份包含未登记的文件。')
  const exportedAt = typeof raw.exportedAt === 'string' && Number.isFinite(Date.parse(raw.exportedAt)) ? raw.exportedAt : new Date().toISOString()
  const drafts: PersistedDraft[] = []
  const ids = new Set<string>()
  for (const [index, value] of raw.drafts.entries()) {
    check(options, `正在校验稿件 ${index + 1}/${raw.drafts.length}…`)
    const draft = normalizeArchiveDraft(value, exportedAt, assets)
    if (ids.has(draft.id)) throw new Error('备份包含重复稿件。')
    ids.add(draft.id)
    drafts.push(draft)
    await yieldToBrowser(options)
  }
  return { format: LOCAL_BACKUP_FORMAT, version: 2, exportedAt, activeDraftId: typeof raw.activeDraftId === 'string' && ids.has(raw.activeDraftId) ? raw.activeDraftId : null, drafts, assets }
}
