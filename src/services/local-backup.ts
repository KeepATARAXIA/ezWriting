import type { ArticleDraft, ArticleSourceLanguage, SourceKind } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING, type ArticleFormatting } from '../domain/formatting'
import {
  SAVED_DRAFT_SCHEMA_VERSION,
  normalizeXhsCardSettings,
  type DraftKind,
  type PersistedDraft,
  type XhsCardSettings,
} from '../domain/saved-draft'
import { sanitizeEditedHtml } from '../lib/file-parser'
import { normalizeWechatThemeSettings } from '../lib/wechat-theme'
import type { DraftRepository } from './draft-repository'

export const LOCAL_BACKUP_FORMAT = 'ezwriting-local-backup'
export const LOCAL_BACKUP_VERSION = 1
export const LOCAL_BACKUP_FILE_EXTENSION = '.ezwriting-backup.json'
export const MAX_LOCAL_BACKUP_BYTES = 128 * 1024 * 1024
export const LAST_ACTIVE_DRAFT_SETTING = 'last-active-draft-id'

export interface LocalBackupPayload {
  format: typeof LOCAL_BACKUP_FORMAT
  version: typeof LOCAL_BACKUP_VERSION
  exportedAt: string
  activeDraftId: string | null
  drafts: PersistedDraft[]
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
  if (!html) throw new Error('备份中存在缺少正文的稿件。')
  const language = sourceLanguage(value.sourceLanguage)
  return {
    id: draftId,
    title: stringValue(value.title).slice(0, 500),
    html: sanitizeEditedHtml(html),
    ...(typeof value.markdown === 'string' ? { markdown: value.markdown } : {}),
    ...(typeof value.sourceText === 'string' ? { sourceText: value.sourceText } : {}),
    ...(language ? { sourceLanguage: language } : {}),
    ...(typeof value.cover === 'string' ? { cover: value.cover } : {}),
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    tags: stringArray(value.tags),
    sourceFile: stringValue(value.sourceFile, '备份恢复稿件'),
    sourceKind: sourceKind(value.sourceKind),
    importedAt: timestamp(value.importedAt, importedAt),
    warnings: stringArray(value.warnings),
    missingAssets: stringArray(value.missingAssets),
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

function normalizeDraft(value: unknown, fallbackTimestamp: string): PersistedDraft {
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
    deletedAt: value.deletedAt === null ? null : timestamp(value.deletedAt, createdAt),
    sourceInfo: sourceInfo(value.sourceInfo),
  }
}

export function localBackupFileName(now = new Date()): string {
  return `ezwriting-${now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}${LOCAL_BACKUP_FILE_EXTENSION}`
}

export async function createLocalBackup(repository: DraftRepository, now = new Date()): Promise<LocalBackupPayload> {
  const summaries = await repository.listDrafts({ includeDeleted: true })
  const drafts = (await Promise.all(summaries.map(summary => repository.getDraft(summary.id))))
    .filter((draft): draft is PersistedDraft => Boolean(draft))
  const activeDraftId = await repository.getSetting<string>(LAST_ACTIVE_DRAFT_SETTING)
  return {
    format: LOCAL_BACKUP_FORMAT,
    version: LOCAL_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    activeDraftId: activeDraftId && drafts.some(draft => draft.id === activeDraftId) ? activeDraftId : null,
    drafts,
  }
}

export function serializeLocalBackup(payload: LocalBackupPayload): Blob {
  return new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' })
}

export async function parseLocalBackup(file: File): Promise<LocalBackupPayload> {
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
  const drafts = raw.drafts.map(value => normalizeDraft(value, exportedAt))
  const ids = new Set<string>()
  for (const draft of drafts) {
    if (ids.has(draft.id)) throw new Error('备份中包含重复稿件。')
    ids.add(draft.id)
  }
  const activeDraftId = typeof raw.activeDraftId === 'string' && ids.has(raw.activeDraftId) ? raw.activeDraftId : null
  return { format: LOCAL_BACKUP_FORMAT, version: LOCAL_BACKUP_VERSION, exportedAt, activeDraftId, drafts }
}

export async function importLocalBackup(repository: DraftRepository, payload: LocalBackupPayload): Promise<LocalBackupImportResult> {
  for (const draft of payload.drafts) {
    await repository.saveDraft(draft, { preserveUpdatedAt: true, replaceDeletionState: true })
  }
  if (payload.activeDraftId) await repository.putSetting(LAST_ACTIVE_DRAFT_SETTING, payload.activeDraftId)
  return { draftCount: payload.drafts.length, activeDraftId: payload.activeDraftId }
}

export async function requestPersistentLocalStorage(storage = navigator.storage): Promise<boolean | null> {
  if (!storage?.persisted || !storage.persist) return null
  if (await storage.persisted()) return true
  return storage.persist()
}
