import type { DraftKind, DraftSummary, PersistedDraft } from '../domain/saved-draft'

export interface DraftListOptions {
  includeDeleted?: boolean
  kind?: DraftKind
}

export interface DraftRepository {
  saveDraft(draft: PersistedDraft, options?: { preserveUpdatedAt?: boolean; replaceDeletionState?: boolean }): Promise<PersistedDraft>
  getDraft(id: string): Promise<PersistedDraft | null>
  listDrafts(options?: DraftListOptions): Promise<DraftSummary[]>
  softDeleteDraft(id: string): Promise<PersistedDraft | null>
  restoreDraft(id: string): Promise<PersistedDraft | null>
  deleteDraft(id: string): Promise<void>
  putSetting<T>(key: string, value: T): Promise<void>
  getSetting<T>(key: string): Promise<T | undefined>
  deleteSetting(key: string): Promise<void>
}
