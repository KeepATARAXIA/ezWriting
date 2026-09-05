import { expandLocalImageReferences, localImageReferences, retainLocalImageReferences } from '../lib/local-image-registry'
import type { ArticleDraft, ArticleSourceLanguage, SourceKind } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING, type ArticleFormatting } from '../domain/formatting'
import {
  SAVED_DRAFT_SCHEMA_VERSION,
  normalizeXhsCardSettings,
  type DraftKind,
  type PersistedDraft,
  type XhsCardSettings,
} from '../domain/saved-draft'
import { annotateLocalImagesAsMissing } from '../lib/article-source'
import { expandLocalVideoReferences, retainLocalVideoReferences } from '../lib/local-video-registry'
import { sanitizeContentHtml } from '../lib/markdown-compatibility'
import { normalizeWechatThemeSettings } from '../lib/wechat-theme'
import type { DraftBackupAsset, DraftRepository } from './draft-repository'
import { LAST_ACTIVE_DRAFT_SETTING } from './local-storage'

export { LAST_ACTIVE_DRAFT_SETTING, requestPersistentLocalStorage } from './local-storage'

export const LOCAL_BACKUP_FORMAT = 'ezwriting-local-backup'
export const LOCAL_BACKUP_VERSION = 1
export const LOCAL_BACKUP_FILE_EXTENSION = '.ezwriting-backup.json'
export const MAX_LOCAL_BACKUP_BYTES = 128 * 1024 * 1024

export interface LocalBackupPayload {
  format: typeof LOCAL_BACKUP_FORMAT
  version: 1 | 2
  exportedAt: string
  activeDraftId: string | null
  drafts: PersistedDraft[]
  assets?: Map<string, DraftBackupAsset>
}

export interface BackupOperationOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
}

export interface LocalBackupImportResult {
  draftCount: number
  activeDraftId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function timestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback
  return new Date(value).toISOString()
}

function sourceKind(value: unknown): SourceKind {
  return value === 'markdown' || value === 'html' || value === 'zip' ? value : 'blank'
}

function sourceLanguage(value: unknown): ArticleSourceLanguage | undefined {
  return value === 'markdown' || value === 'html' ? value : undefined
}

function draftKind(value: unknown): DraftKind {
  return value === 'image' ? 'image' : 'longform'
}

function formatting(value: unknown): ArticleFormatting {
  const candidate = isRecord(value) ? value : {}
  return {
    theme: candidate.theme === 'editorial' || candidate.theme === 'wechat' ? candidate.theme : 'clean',
    sourceStyle: candidate.sourceStyle === 'theme' ? 'theme' : 'preserve',
    font: candidate.font === 'sans' ? 'sans' : 'serif',
    fontSize: candidate.fontSize === 'small' || candidate.fontSize === 'large' ? candidate.fontSize : 'medium',
    lineHeight: candidate.lineHeight === 'compact' || candidate.lineHeight === 'airy' ? candidate.lineHeight : 'comfortable',
    accent: candidate.accent === 'green' || candidate.accent === 'orange' || candidate.accent === 'purple' ? candidate.accent : 'blue',
    wechat: normalizeWechatThemeSettings(isRecord(candidate.wechat) ? candidate.wechat : DEFAULT_ARTICLE_FORMATTING.wechat),
  }
}

function xhsSettings(value: unknown): XhsCardSettings {
  return normalizeXhsCardSettings(value)
}

function article(value: unknown, draftId: string, importedAt: string): ArticleDraft {
  if (!isRecord(value)) throw new Error('备份中存在无效稿件。')
  const html = stringValue(value.html)
  if (typeof value.html !== 'string') throw new Error('备份中存在缺少正文的稿件。')
  const language = sourceLanguage(value.sourceLanguage)
  const sanitized = sanitizeContentHtml(html)
  const annotated = annotateLocalImagesAsMissing(sanitized)
  return {
    id: draftId,
    title: stringValue(value.title).slice(0, 500),
    html: annotated.html,
    ...(typeof value.markdown === 'string' ? { markdown: value.markdown } : {}),
    ...(typeof value.sourceText === 'string' ? { sourceText: value.sourceText } : {}),
    ...(language ? { sourceLanguage: language } : {}),
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    tags: stringArray(value.tags),
    sourceFile: stringValue(value.sourceFile, '备份恢复稿件'),
    sourceKind: sourceKind(value.sourceKind),
    importedAt: timestamp(value.importedAt, importedAt),
    warnings: stringArray(value.warnings),
    missingAssets: annotated.references,
  }
}

function sourceInfo(value: unknown): PersistedDraft['sourceInfo'] {
  if (!isRecord(value)) return null
  const name = stringValue(value.name)
  const size = Number(value.size)
  const assetCount = Number(value.assetCount)
  if (!name || !Number.isFinite(size) || !Number.isFinite(assetCount)) return null
  return { name, size: Math.max(0, size), assetCount: Math.max(0, Math.floor(assetCount)) }
}

export function normalizeBackupDraft(value: unknown, fallbackTimestamp: string): PersistedDraft {
  if (!isRecord(value)) throw new Error('备份中存在无效稿件。')
  const id = stringValue(value.id)
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('备份中存在无效稿件标识。')
  const createdAt = timestamp(value.createdAt, fallbackTimestamp)
  return {
    schemaVersion: SAVED_DRAFT_SCHEMA_VERSION,
    id,
    article: article(value.article, id, createdAt),
    formatting: formatting(value.formatting),
    kind: draftKind(value.kind),
    xhsSettings: xhsSettings(value.xhsSettings),
    createdAt,
    updatedAt: timestamp(value.updatedAt, createdAt),
    deletedAt: value.deletedAt == null ? null : timestamp(value.deletedAt, createdAt),
    sourceInfo: sourceInfo(value.sourceInfo),
  }
}

export function localBackupFileName(now = new Date()): string {
  return `ezwriting-${now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}${LOCAL_BACKUP_FILE_EXTENSION}`
}

export async function createLocalBackup(
  repository: DraftRepository,
  now = new Date(),
  draftOverride?: PersistedDraft,
): Promise<LocalBackupPayload> {
  const retainedImages = localImageReferences()
  const [summaries, storedActiveDraftId] = await Promise.all([
    repository.listDrafts({ includeDeleted: true }),
    repository.getSetting<string>(LAST_ACTIVE_DRAFT_SETTING),
  ])
  let drafts = (await Promise.all(summaries.map(summary => repository.getDraft(summary.id))))
    .filter((draft): draft is PersistedDraft => Boolean(draft))
  if (draftOverride) {
    drafts = [...drafts.filter(draft => draft.id !== draftOverride.id), draftOverride]
  }
  const activeDraftId = draftOverride?.id ?? storedActiveDraftId
  const retainedVideoValues = drafts
    .filter(draft => draft.id === activeDraftId)
    .flatMap(draft => [draft.article.html, draft.article.markdown || '', draft.article.sourceText || ''])
  drafts = await Promise.all(drafts.map(async draft => {
    const html = await expandLocalVideoReferences(expandLocalImageReferences(draft.article.html))
    const markdown = typeof draft.article.markdown === 'string'
      ? await expandLocalVideoReferences(expandLocalImageReferences(draft.article.markdown))
      : undefined
    const sourceText = typeof draft.article.sourceText === 'string'
      ? draft.article.sourceText === draft.article.markdown && markdown !== undefined
        ? markdown
        : await expandLocalVideoReferences(expandLocalImageReferences(draft.article.sourceText))
      : undefined
    return {
      ...draft,
      article: {
        ...draft.article,
        html,
        markdown,
        sourceText,
      },
    }
  })).finally(() => { retainLocalVideoReferences(retainedVideoValues); retainLocalImageReferences(retainedImages) })
  return {
    format: LOCAL_BACKUP_FORMAT,
    version: LOCAL_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    activeDraftId: activeDraftId && drafts.some(draft => draft.id === activeDraftId) ? activeDraftId : null,
    drafts,
  }
}

export function serializeLocalBackup(payload: LocalBackupPayload): Blob {
  if (payload.version !== 1) throw new Error('媒体资产包必须使用 ZIP 导出。')
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' })
  if (blob.size > MAX_LOCAL_BACKUP_BYTES) throw new Error('旧 JSON 备份超过 128 MB，请使用去重媒体资产包导出。')
  return blob
}

export async function createLocalBackupArchive(repository: DraftRepository, now = new Date(), draftOverride?: PersistedDraft, options: BackupOperationOptions = {}) {
  return (await import('./local-backup-archive')).createBackupArchive(repository, now, draftOverride, options)
}

export async function parseLocalBackup(file: File, options: BackupOperationOptions = {}): Promise<LocalBackupPayload> {
  options.signal?.throwIfAborted()
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (signature[0] === 0x50 && signature[1] === 0x4b) {
    return (await import('./local-backup-archive')).parseBackupArchive(file, options)
  }
  if (file.size > MAX_LOCAL_BACKUP_BYTES) throw new Error('本地备份不能超过 128 MB。')
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error('备份文件不是有效的 EZWRITING 数据。')
  }
  if (!isRecord(raw) || raw.format !== LOCAL_BACKUP_FORMAT) throw new Error('请选择 EZWRITING 导出的本地备份。')
  if (raw.version !== LOCAL_BACKUP_VERSION) throw new Error('当前版本暂不支持这个备份格式。')
  if (!Array.isArray(raw.drafts)) throw new Error('备份文件缺少稿件数据。')
  if (raw.drafts.length > 1_000) throw new Error('单个备份最多包含 1000 篇稿件。')
  const exportedAt = timestamp(raw.exportedAt, new Date().toISOString())
  options.signal?.throwIfAborted()
  const drafts = raw.drafts.map(value => normalizeBackupDraft(value, exportedAt))
  const ids = new Set<string>()
  for (const draft of drafts) {
    if (ids.has(draft.id)) throw new Error('备份中包含重复稿件。')
    ids.add(draft.id)
  }
  const activeDraftId = typeof raw.activeDraftId === 'string' && ids.has(raw.activeDraftId) ? raw.activeDraftId : null
  return { format: LOCAL_BACKUP_FORMAT, version: LOCAL_BACKUP_VERSION, exportedAt, activeDraftId, drafts }
}

export async function importLocalBackup(repository: DraftRepository, payload: LocalBackupPayload, options: BackupOperationOptions = {}): Promise<LocalBackupImportResult> {
  if (typeof repository.importDraftsAtomically !== 'function') {
    throw new Error('当前稿件仓库不支持原子整库导入，已停止且未写入任何稿件。')
  }
  options.signal?.throwIfAborted()
  options.onProgress?.('正在写入稿件与媒体，可取消并整笔回滚…')
  await repository.importDraftsAtomically(payload.drafts, {
    assets: payload.assets,
    signal: options.signal,
    settingMutations: payload.activeDraftId
      ? [{ type: 'put', key: LAST_ACTIVE_DRAFT_SETTING, value: payload.activeDraftId }]
      : [{ type: 'delete', key: LAST_ACTIVE_DRAFT_SETTING }],
  })
  return { draftCount: payload.drafts.length, activeDraftId: payload.activeDraftId }
}
