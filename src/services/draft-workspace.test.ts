import { describe, expect, it, vi } from 'vitest'
import type { ArticleDraft } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import {
  DEFAULT_XHS_CARD_SETTINGS,
  createPersistedDraft,
  type PersistedDraft,
} from '../domain/saved-draft'
import {
  createDraftSnapshot,
  defaultDraftKind,
  persistedDraftFromSnapshot,
  snapshotFromPersistedDraft,
} from './draft-workspace'

const IMPORTED_AT = '2026-08-12T02:00:00.000Z'

function article(overrides: Partial<ArticleDraft> = {}): ArticleDraft {
  return {
    id: 'draft-1',
    title: '本地优先工作流',
    html: '<p>正文</p>',
    markdown: '正文',
    tags: ['本地优先'],
    sourceFile: 'article.md',
    sourceKind: 'markdown',
    importedAt: IMPORTED_AT,
    warnings: [],
    missingAssets: [],
    ...overrides,
  }
}

function persisted(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  const draft = createPersistedDraft(article(), DEFAULT_ARTICLE_FORMATTING, {
    createdAt: '2026-08-12T03:00:00.000Z',
    updatedAt: '2026-08-12T04:00:00.000Z',
  })

  return { ...draft, ...overrides }
}

describe('draft workspace', () => {
  describe('defaultDraftKind', () => {
    it.each([
      ['正文图片稿件', article({ html: '<p>正文</p><IMG src="cover.png">' }), 'image'],
      ['纯文本稿件', article(), 'longform'],
      ['空白稿件', article({ html: '' }), 'longform'],
    ] as const)('%s 默认归类为 %s', (_label, draft, expectedKind) => {
      expect(defaultDraftKind(draft)).toBe(expectedKind)
    })
  })

  it('创建快照时应用独立的默认排版、小红书设置和稿件类型', () => {
    const sourceInfo = { name: 'article.md', size: 2048, assetCount: 1 }
    const snapshot = createDraftSnapshot(
      article({ html: '<p>正文</p><img src="figure.png">' }),
      sourceInfo,
    )

    expect(snapshot).toMatchObject({
      kind: 'image',
      formatting: DEFAULT_ARTICLE_FORMATTING,
      xhsSettings: DEFAULT_XHS_CARD_SETTINGS,
      sourceInfo,
    })
    expect(snapshot.formatting).not.toBe(DEFAULT_ARTICLE_FORMATTING)
    expect(snapshot.xhsSettings).not.toBe(DEFAULT_XHS_CARD_SETTINGS)
  })

  it('持久化快照时保留现有生命周期并写入最新来源信息', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T08:30:00.000Z'))

    try {
      const current = persisted({
        createdAt: '2026-08-01T01:00:00.000Z',
        deletedAt: '2026-08-13T07:00:00.000Z',
        sourceInfo: { name: '旧稿.md', size: 100, assetCount: 0 },
      })
      const snapshot = {
        ...createDraftSnapshot(article({ title: '编辑后的标题' })),
        kind: 'image' as const,
        formatting: { ...DEFAULT_ARTICLE_FORMATTING, theme: 'editorial' as const },
        xhsSettings: {
          template: 'clean' as const,
          showPageNumber: false,
          showFooter: true,
          footerText: 'LOCAL',
          imageOverrides: {},
        },
        sourceInfo: { name: '新版.zip', size: 4096, assetCount: 3 },
      }

      const next = persistedDraftFromSnapshot(snapshot, current)

      expect(next).toMatchObject({
        id: snapshot.article.id,
        article: snapshot.article,
        formatting: snapshot.formatting,
        kind: 'image',
        xhsSettings: snapshot.xhsSettings,
        createdAt: current.createdAt,
        updatedAt: '2026-08-13T08:30:00.000Z',
        deletedAt: current.deletedAt,
        sourceInfo: snapshot.sourceInfo,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('从持久化稿件恢复完整的可编辑工作区快照', () => {
    const draft = persisted({
      article: article({
        title: '恢复后的稿件',
        html: '<h1>恢复后的稿件</h1><p>正文</p>',
      }),
      formatting: {
        ...DEFAULT_ARTICLE_FORMATTING,
        theme: 'wechat',
        font: 'sans',
        accent: 'green',
        wechat: {
          ...DEFAULT_ARTICLE_FORMATTING.wechat,
          themeId: 'candy-pop',
          accentByTheme: { 'candy-pop': '#123456' },
          slotColorsByTheme: { 'candy-pop': { blue: '#abcdef' } },
          fontFamily: 'rounded',
          fontSize: 18,
        },
      },
      kind: 'image',
      xhsSettings: {
        template: 'editorial',
        showPageNumber: false,
        showFooter: true,
        footerText: '恢复测试',
        imageOverrides: {
          'xhs-img-test-1': { layout: 'image-right', widthPercent: 52 },
        },
      },
      sourceInfo: { name: 'content.zip', size: 8192, assetCount: 4 },
    })

    expect(snapshotFromPersistedDraft(draft)).toEqual({
      article: draft.article,
      formatting: draft.formatting,
      kind: draft.kind,
      xhsSettings: draft.xhsSettings,
      sourceInfo: draft.sourceInfo,
    })
  })
})
