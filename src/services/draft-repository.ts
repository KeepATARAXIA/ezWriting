import type { DraftKind, DraftSummary, PersistedDraft } from '../domain/saved-draft'

export interface DraftListOptions {
  includeDeleted?: boolean
  kind?: DraftKind
}

export interface DraftSaveOptions {
  preserveUpdatedAt?: boolean
  replaceDeletionState?: boolean
  expectedUpdatedAt?: string | null
}

export type DraftSettingMutation =
  | { type: 'put'; key: string; value: unknown }
  | { type: 'delete'; key: string }

export interface AtomicDraftImportOptions {
  settingMutations?: readonly DraftSettingMutation[]
  assets?: ReadonlyMap<string, DraftBackupAsset>
  signal?: AbortSignal
}

export interface DraftBackupAsset {
  id: string
  bytes: ArrayBuffer
  mimeType: string
  byteSize: number
}

export interface DraftBackupRecord {
  draft: PersistedDraft
  assets: DraftBackupAsset[]
}

export interface DraftRepository {
  saveDraft(draft: PersistedDraft, options?: DraftSaveOptions): Promise<PersistedDraft>
  importDraftsAtomically?(drafts: readonly PersistedDraft[], options?: AtomicDraftImportOptions): Promise<void>
  getDraft(id: string): Promise<PersistedDraft | null>
  readDraftForBackup?(id: string): Promise<DraftBackupRecord | null>
  listDrafts(options?: DraftListOptions): Promise<DraftSummary[]>
  softDeleteDraft(id: string): Promise<PersistedDraft | null>
  restoreDraft(id: string): Promise<PersistedDraft | null>
  deleteDraft(id: string): Promise<void>
  putSetting<T>(key: string, value: T): Promise<void>
  getSetting<T>(key: string): Promise<T | undefined>
  deleteSetting(key: string): Promise<void>
}
