import { DEFAULT_ARTICLE_FORMATTING, type ArticleFormatting } from '../domain/formatting'
import {
  DEFAULT_XHS_CARD_SETTINGS,
  createPersistedDraft,
  normalizeXhsCardSettings,
  type DraftKind,
  type PersistedDraft,
  type XhsCardSettings,
} from '../domain/saved-draft'
import type { ArticleDraft } from '../domain/article'
import { normalizeWechatThemeSettings } from '../lib/wechat-theme'

export interface DraftWorkspaceSnapshot {
  article: ArticleDraft
  formatting: ArticleFormatting
  kind: DraftKind
  xhsSettings: XhsCardSettings
  sourceInfo: PersistedDraft['sourceInfo']
}

export function defaultDraftKind(article: ArticleDraft): DraftKind {
  if (/<img\b/i.test(article.html)) return 'image'
  return 'longform'
}

export function snapshotFromPersistedDraft(draft: PersistedDraft): DraftWorkspaceSnapshot {
  return {
    article: draft.article,
    formatting: {
      ...DEFAULT_ARTICLE_FORMATTING,
      ...draft.formatting,
      wechat: normalizeWechatThemeSettings(draft.formatting?.wechat),
    },
    kind: draft.kind ?? defaultDraftKind(draft.article),
    xhsSettings: normalizeXhsCardSettings(draft.xhsSettings),
    sourceInfo: draft.sourceInfo ? { ...draft.sourceInfo } : null,
  }
}

export function createDraftSnapshot(
  article: ArticleDraft,
  sourceInfo: PersistedDraft['sourceInfo'] = null,
): DraftWorkspaceSnapshot {
  return {
    article,
    formatting: {
      ...DEFAULT_ARTICLE_FORMATTING,
      wechat: normalizeWechatThemeSettings(DEFAULT_ARTICLE_FORMATTING.wechat),
    },
    kind: defaultDraftKind(article),
    xhsSettings: normalizeXhsCardSettings(DEFAULT_XHS_CARD_SETTINGS),
    sourceInfo,
  }
}

export function persistedDraftFromSnapshot(
  snapshot: DraftWorkspaceSnapshot,
  current?: PersistedDraft | null,
): PersistedDraft {
  return createPersistedDraft(snapshot.article, snapshot.formatting, {
    kind: snapshot.kind,
    xhsSettings: snapshot.xhsSettings,
    sourceInfo: snapshot.sourceInfo,
    createdAt: current?.createdAt,
    deletedAt: current?.deletedAt,
  })
}
