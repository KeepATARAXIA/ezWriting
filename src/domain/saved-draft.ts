import type { ArticleDraft, SourceKind } from './article'
import type { ArticleFormatting } from './formatting'

export const SAVED_DRAFT_SCHEMA_VERSION = 2

export type DraftKind = 'image' | 'longform'

export type XhsCardTemplate = 'clean' | 'editorial' | 'focus'

export interface XhsCardSettings {
  template: XhsCardTemplate
  showPageNumber: boolean
  showFooter: boolean
  footerText: string
}

export const DEFAULT_XHS_CARD_SETTINGS: XhsCardSettings = {
  template: 'focus',
  showPageNumber: true,
  showFooter: true,
  footerText: 'DISPATCH',
}

export interface PersistedDraft {
  schemaVersion: typeof SAVED_DRAFT_SCHEMA_VERSION
  id: string
  article: ArticleDraft
  formatting: ArticleFormatting
  kind: DraftKind
  xhsSettings: XhsCardSettings
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  sourceInfo: {
    name: string
    size: number
    assetCount: number
  } | null
}

export interface DraftSummary {
  id: string
  title: string
  kind: DraftKind
  sourceKind: SourceKind
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface PersistedDraftOverrides {
  kind?: DraftKind
  xhsSettings?: XhsCardSettings
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
  sourceInfo?: PersistedDraft['sourceInfo']
}

export function createPersistedDraft(
  article: ArticleDraft,
  formatting: ArticleFormatting,
  overrides: PersistedDraftOverrides = {},
): PersistedDraft {
  const now = new Date().toISOString()

  return {
    schemaVersion: SAVED_DRAFT_SCHEMA_VERSION,
    id: article.id,
    article,
    formatting: {
      ...formatting,
      wechat: {
        ...formatting.wechat,
        accentByTheme: { ...formatting.wechat.accentByTheme },
        slotColorsByTheme: Object.fromEntries(
          Object.entries(formatting.wechat.slotColorsByTheme).map(([themeId, colors]) => [themeId, { ...colors }]),
        ),
      },
    },
    kind: overrides.kind ?? 'longform',
    xhsSettings: overrides.xhsSettings
      ? { ...overrides.xhsSettings }
      : { ...DEFAULT_XHS_CARD_SETTINGS },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
    sourceInfo: overrides.sourceInfo ? { ...overrides.sourceInfo } : null,
  }
}

export function toDraftSummary(draft: PersistedDraft): DraftSummary {
  return {
    id: draft.id,
    title: draft.article.title,
    kind: draft.kind,
    sourceKind: draft.article.sourceKind,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    deletedAt: draft.deletedAt,
  }
}
