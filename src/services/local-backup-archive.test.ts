import 'fake-indexeddb/auto'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft } from '../domain/saved-draft'
import { clearLocalVideoRegistry, localVideoBlob, registerLocalVideo } from '../lib/local-video-registry'
import { createLocalBackupArchive, importLocalBackup, LAST_ACTIVE_DRAFT_SETTING, parseLocalBackup } from './local-backup'
import { MAX_BACKUP_ASSET_BYTES } from './local-backup-archive'
import { LocalDraftRepository, resetLocalDraftDatabase } from './local-draft-repository'

const databases: Array<{ name: string; repository: LocalDraftRepository }> = []
function repository() {
  const name = `archive-${crypto.randomUUID()}`
  const repository = new LocalDraftRepository({ databaseName: name })
  databases.push({ name, repository })
  return repository
}
function draft(id = crypto.randomUUID(), source = 'data:image/png;base64,AQIDBA==') {
  const html = `<p>正文</p><img src="${source}" alt="配图">`
  return createPersistedDraft({ id, title: '资产包备份', html, markdown: html, sourceText: html,
    sourceLanguage: 'html', tags: ['备份'], sourceFile: 'backup.html', sourceKind: 'html',
    importedAt: '2026-09-05T04:00:00.000Z', warnings: [], missingAssets: [],
  }, DEFAULT_ARTICLE_FORMATTING)
}
async function archive() {
  const source = repository()
  const original = draft()
  await source.saveDraft(original, { preserveUpdatedAt: true })
  const exported = await createLocalBackupArchive(source)
  const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer())
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  return { source, original, exported, zip, manifest }
}
async function file(zip: JSZip) {
  return new File([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))], 'backup.ezwriting-backup.zip')
}
afterEach(async () => {
  vi.restoreAllMocks()
  clearLocalVideoRegistry()
  for (const entry of databases.splice(0)) {
    await entry.repository.close()
    await resetLocalDraftDatabase(entry.name)
  }
  vi.unstubAllGlobals()
})

describe('media archive backups', () => {
  it('stores repeated media once across fields and drafts, restoring raw bytes in an isolated database', async () => {
    const source = repository()
    const first = draft()
    const second = { ...draft(), deletedAt: '2026-09-05T04:30:00.000Z' }
    await source.saveDraft(first, { preserveUpdatedAt: true })
    await source.saveDraft(second, { preserveUpdatedAt: true, replaceDeletionState: true })
    await source.putSetting(LAST_ACTIVE_DRAFT_SETTING, first.id)
    const hydrate = vi.spyOn(source, 'getDraft')
    const exported = await createLocalBackupArchive(source)
    expect(hydrate).not.toHaveBeenCalled()
    expect(exported).toMatchObject({ draftCount: 2, assetCount: 1, mediaBytes: 4 })
    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer())
    const manifestText = await zip.file('manifest.json')!.async('string')
    expect(manifestText).not.toContain('data:image/')
    expect(Object.keys(zip.files)).toHaveLength(2)
    const parsed = await parseLocalBackup(new File([exported.blob], exported.fileName))
    const target = repository()
    await importLocalBackup(target, parsed)
    const restored = await target.readDraftForBackup(first.id)
    expect(new Uint8Array(restored!.assets[0].bytes)).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(restored!.draft.article.sourceText).toContain('dispatch-asset://sha256-')
    expect((await target.readDraftForBackup(second.id))!.draft.deletedAt).toBe(second.deletedAt)
    expect(await target.getSetting(LAST_ACTIVE_DRAFT_SETTING)).toBe(first.id)
  })

  it('includes unsaved edits without revoking video references retained for editor undo', async () => {
    const source = repository()
    const reference = registerLocalVideo(new Blob(['video'], { type: 'video/mp4' }))
    const original = draft()
    const html = `<video src="${reference}" controls></video>`
    original.article = { ...original.article, html, markdown: html, sourceText: html }
    await source.saveDraft(original)
    const override = { ...original, article: { ...original.article, title: '尚未保存' } }
    const exported = await createLocalBackupArchive(source, new Date(), override)
    const parsed = await parseLocalBackup(new File([exported.blob], exported.fileName))
    expect(parsed.drafts[0].article.title).toBe('尚未保存')
    expect(parsed.activeDraftId).toBe(original.id)
    expect(localVideoBlob(reference)?.size).toBe(5)
    expect(parsed.assets?.size).toBe(1)
  })

  it('round-trips an empty new draft', async () => {
    const source = repository()
    const original = draft()
    original.article = { ...original.article, html: '', markdown: '', sourceText: '' }
    const exported = await createLocalBackupArchive(source, new Date(), original)
    const parsed = await parseLocalBackup(new File([exported.blob], exported.fileName))
    expect(parsed.drafts[0].article.html).toBe('')
  })

  it('preserves ordinary technical prose mentioning media protocols', async () => {
    const source = repository()
    const original = draft()
    const html = '<p>图片可以使用 data:image/ 协议，临时地址使用 blob: 前缀。</p>'
    original.article = { ...original.article, html, markdown: html, sourceText: html }
    const exported = await createLocalBackupArchive(source, new Date(), original)
    const parsed = await parseLocalBackup(new File([exported.blob], exported.fileName))
    expect(parsed.drafts[0].article.html).toBe(html)
  })

  it('restores a 100 MiB asset and a package larger than the old 128 MiB ceiling byte-for-byte', async () => {
    const source = repository()
    const expected: Array<{ id: string; digest: string; size: number }> = []
    // Synthetic binary payloads exercise storage capacity, not video playback/decoding.
    for (const size of [100, 32]) {
      const bytes = new Uint8Array(size * 1024 * 1024)
      bytes.fill(size)
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
      const id = `sha256-video-mp4-${digest}`
      const original = draft()
      const html = `<video controls src="dispatch-asset://${id}"></video>`
      original.article = { ...original.article, html, markdown: html, sourceText: html }
      await source.importDraftsAtomically([original], { assets: new Map([[id, { id, bytes: bytes.buffer, mimeType: 'video/mp4', byteSize: bytes.byteLength }]]) })
      expected.push({ id: original.id, digest, size: bytes.byteLength })
    }
    const exported = await createLocalBackupArchive(source)
    expect(exported.blob.size).toBeGreaterThan(128 * 1024 * 1024)
    expect(exported.blob.size).toBeLessThan(133 * 1024 * 1024)
    const parsed = await parseLocalBackup(new File([exported.blob], exported.fileName))
    const target = repository()
    await importLocalBackup(target, parsed)
    for (const item of expected) {
      const restored = (await target.readDraftForBackup(item.id))!
      expect(restored.assets).toHaveLength(1)
      expect(restored.assets[0].byteSize).toBe(item.size)
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', restored.assets[0].bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
      expect(digest).toBe(item.digest)
      expect(restored.draft.article.html).toContain(`dispatch-asset://sha256-video-mp4-${digest}`)
    }
  }, 30_000)

  it.each(['corrupt bytes', 'missing file', 'wrong media type', 'missing reference', 'duplicate draft', 'extra file', 'unsafe path'])(
    'rejects %s before importing any data', async scenario => {
      const { zip, manifest } = await archive()
      const asset = manifest.assets[0]
      if (scenario === 'corrupt bytes') zip.file(asset.path, new Uint8Array([4, 3, 2, 1]), { createFolders: false })
      if (scenario === 'missing file') zip.remove(asset.path)
      if (scenario === 'wrong media type') manifest.drafts[0].article.html = `<video src="dispatch-asset://${asset.id}"></video>`
      if (scenario === 'missing reference') manifest.drafts[0].article.html = '<img src="dispatch-asset://missing">'
      if (scenario === 'duplicate draft') manifest.drafts.push(manifest.drafts[0])
      if (scenario === 'extra file') zip.file('assets/unregistered.bin', 'x', { createFolders: false })
      if (scenario === 'unsafe path') zip.file('../escape.bin', 'x', { createFolders: false })
      zip.file('manifest.json', JSON.stringify(manifest))
      await expect(parseLocalBackup(await file(zip))).rejects.toThrow(scenario === 'corrupt bytes' ? '完整性校验失败' : undefined)
    },
  )

  it('rejects a forged uncompressed length before extracting an entry', async () => {
    const { zip } = await archive()
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const view = new DataView(bytes.buffer)
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue
      view.setUint32(offset + 24, MAX_BACKUP_ASSET_BYTES + 1, true)
      break
    }
    await expect(parseLocalBackup(new File([new Uint8Array(bytes)], 'oversize.zip'))).rejects.toThrow('解压大小超限')
  })

  it('can cancel generation and parsing without altering the original database', async () => {
    const { source, original, exported } = await archive()
    const exportController = new AbortController()
    await expect(createLocalBackupArchive(source, new Date(), undefined, {
      signal: exportController.signal,
      onProgress: message => { if (message.startsWith('正在生成备份')) exportController.abort() },
    })).rejects.toMatchObject({ name: 'AbortError' })
    const importController = new AbortController()
    await expect(parseLocalBackup(new File([exported.blob], exported.fileName), {
      signal: importController.signal,
      onProgress: message => { if (message.startsWith('正在校验媒体')) importController.abort() },
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect((await source.readDraftForBackup(original.id))!.assets).toHaveLength(1)
  })

  it('rolls back an overwrite and active setting when the IndexedDB transaction fails', async () => {
    const { original, exported } = await archive()
    const parsed = await parseLocalBackup(new File([exported.blob], exported.fileName))
    const target = repository()
    await target.saveDraft({ ...original, article: { ...original.article, title: '原稿' } })
    await target.putSetting(LAST_ACTIVE_DRAFT_SETTING, 'original-active')
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'assets') throw new DOMException('空间不足', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(importLocalBackup(target, parsed)).rejects.toThrow('空间不足')
    expect((await target.readDraftForBackup(original.id))!.draft.article.title).toBe('原稿')
    expect(await target.getSetting(LAST_ACTIVE_DRAFT_SETTING)).toBe('original-active')
  })

  it('rolls back when cancelled during the IndexedDB write transaction', async () => {
    const { original, exported } = await archive()
    const parsed = await parseLocalBackup(new File([exported.blob], exported.fileName))
    const target = repository()
    await target.putSetting(LAST_ACTIVE_DRAFT_SETTING, 'keep-active')
    const controller = new AbortController()
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      const request = put.apply(this, args)
      if (this.name === 'drafts') controller.abort()
      return request
    })
    await expect(importLocalBackup(target, parsed, { signal: controller.signal })).rejects.toBeDefined()
    expect(await target.readDraftForBackup(original.id)).toBeNull()
    expect(await target.getSetting(LAST_ACTIVE_DRAFT_SETTING)).toBe('keep-active')
  })
})
