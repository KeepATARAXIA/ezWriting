import type { ArticleDraft, SourceKind } from './article'
import type { ArticleFormatting } from './formatting'

export const SAVED_DRAFT_SCHEMA_VERSION = 2

export type DraftKind = 'image' | 'longform'

export const XHS_CARD_TEMPLATES = [
  'clean',
  'focus',
  'index',
  'memo',
  'headline',
  'journal',
  'quote',
  'soft',
  'fresh',
  'editorial',
  'retro',
  'geometry',
  'doodle',
  'texture',
  'logic',
  'mono',
  'hero',
  'narrative',
  'dust',
  'topology',
] as const

export type XhsCardTemplate = typeof XHS_CARD_TEMPLATES[number]
export type XhsImageLayout = 'full' | 'image-left' | 'image-right'

const XHS_CARD_TEMPLATE_SET = new Set<string>(XHS_CARD_TEMPLATES)

export interface XhsImageOverride {
  layout: XhsImageLayout
  widthPercent: number
}

export interface XhsCardSettings {
  template: XhsCardTemplate
  showPageNumber: boolean
  showFooter: boolean
  footerText: string
  imageOverrides: Record<string, XhsImageOverride>
}

export const DEFAULT_XHS_CARD_SETTINGS: XhsCardSettings = {
  template: 'focus',
  showPageNumber: true,
  showFooter: true,
  footerText: 'DISPATCH',
  imageOverrides: {},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeXhsImageOverride(value: unknown): XhsImageOverride | null {
  if (!isRecord(value)) return null
  const layout = value.layout
  if (layout !== 'full' && layout !== 'image-left' && layout !== 'image-right') return null
  const rawWidth = Number(value.widthPercent)
  if (!Number.isFinite(rawWidth)) return null
  const minimum = layout === 'full' ? 35 : 30
  const maximum = layout === 'full' ? 100 : 70
  return { layout, widthPercent: Math.round(Math.min(maximum, Math.max(minimum, rawWidth))) }
}

export function normalizeXhsCardSettings(value?: unknown): XhsCardSettings {
  const candidate = isRecord(value) ? value : {}
  const rawOverrides = isRecord(candidate.imageOverrides) ? candidate.imageOverrides : {}
  const imageOverrides: Record<string, XhsImageOverride> = {}
  Object.entries(rawOverrides).slice(0, 500).forEach(([key, override]) => {
    if (!key || key.length > 120) return
    const normalized = normalizeXhsImageOverride(override)
    if (normalized) imageOverrides[key] = normalized
  })

  return {
    template: typeof candidate.template === 'string' && XHS_CARD_TEMPLATE_SET.has(candidate.template)
      ? candidate.template as XhsCardTemplate
      : 'focus',
    showPageNumber: typeof candidate.showPageNumber === 'boolean' ? candidate.showPageNumber : DEFAULT_XHS_CARD_SETTINGS.showPageNumber,
    showFooter: typeof candidate.showFooter === 'boolean' ? candidate.showFooter : DEFAULT_XHS_CARD_SETTINGS.showFooter,
    footerText: typeof candidate.footerText === 'string' ? candidate.footerText.slice(0, 80) : DEFAULT_XHS_CARD_SETTINGS.footerText,
    imageOverrides,
  }
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
    xhsSettings: normalizeXhsCardSettings(overrides.xhsSettings),
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
