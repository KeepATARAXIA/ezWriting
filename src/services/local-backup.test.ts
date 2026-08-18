import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { ArticleDraft } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft } from '../domain/saved-draft'
import {
  LAST_ACTIVE_DRAFT_SETTING,
  createLocalBackup,
  importLocalBackup,
  parseLocalBackup,
  serializeLocalBackup,
} from './local-backup'
import { LocalDraftRepository, resetLocalDraftDatabase } from './local-draft-repository'

const repositories: LocalDraftRepository[] = []
const databaseNames: string[] = []

function repository(): LocalDraftRepository {
  const databaseName = `ezwriting-backup-${crypto.randomUUID()}`
  const instance = new LocalDraftRepository({ databaseName })
  repositories.push(instance)
  databaseNames.push(databaseName)
  return instance
}

function article(): ArticleDraft {
  const image = 'data:image/png;base64,AQIDBA=='
  return {
    id: 'draft-backup-0001',
    title: '本地备份稿件',
    html: `<h2>正文</h2><img src="${image}" alt="配图">`,
    markdown: `## 正文\n\n![配图](${image})`,
    sourceText: `## 正文\n\n![配图](${image})`,
    sourceLanguage: 'markdown',
    tags: ['本地优先'],
    sourceFile: 'article.md',
    sourceKind: 'markdown',
    importedAt: '2026-08-15T08:00:00.000Z',
    warnings: [],
    missingAssets: [],
  }
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(instance => instance.close()))
  await Promise.all(databaseNames.splice(0).map(name => resetLocalDraftDatabase(name)))
})

describe('local backup', () => {
  it('round-trips drafts, embedded images, formatting, deletion state and the active draft', async () => {
    const source = repository()
    const original = createPersistedDraft(article(), {
      ...DEFAULT_ARTICLE_FORMATTING,
      theme: 'wechat',
      accent: 'green',
    }, {
      kind: 'image',
      xhsSettings: {
        template: 'focus',
        showPageNumber: true,
        showFooter: true,
        footerText: 'DISPATCH',
        imageOverrides: {
          'xhs-img-example-1': { layout: 'image-left', widthPercent: 48 },
        },
      },
      createdAt: '2026-08-15T08:00:00.000Z',
      updatedAt: '2026-08-15T09:00:00.000Z',
    })
    await source.saveDraft(original, { preserveUpdatedAt: true })
    await source.putSetting(LAST_ACTIVE_DRAFT_SETTING, original.id)

    const payload = await createLocalBackup(source, new Date('2026-08-15T10:00:00.000Z'))
    const file = new File([serializeLocalBackup(payload)], 'backup.ezwriting-backup.json', { type: 'application/json' })
    const parsed = await parseLocalBackup(file)
    const target = repository()
    const result = await importLocalBackup(target, parsed)

    expect(result).toEqual({ draftCount: 1, activeDraftId: original.id })
    const restored = await target.getDraft(original.id)
    expect(restored).toMatchObject({
      id: original.id,
      kind: 'image',
      createdAt: '2026-08-15T08:00:00.000Z',
      updatedAt: '2026-08-15T09:00:00.000Z',
      formatting: { theme: 'wechat', accent: 'green' },
    })
    expect(restored?.article.html).toContain('data:image/png;base64,AQIDBA==')
    expect(restored?.article.markdown).toContain('data:image/png;base64,AQIDBA==')
    expect(restored?.xhsSettings.imageOverrides).toEqual({
      'xhs-img-example-1': { layout: 'image-left', widthPercent: 48 },
    })
    expect(await target.getSetting(LAST_ACTIVE_DRAFT_SETTING)).toBe(original.id)
    expect(restored).not.toHaveProperty('syncState')
    expect(restored).not.toHaveProperty('cloudVersion')
  })

  it('rejects unrelated JSON files', async () => {
    const file = new File([JSON.stringify({ drafts: [] })], 'other.json', { type: 'application/json' })
    await expect(parseLocalBackup(file)).rejects.toThrow('请选择 EZWRITING 导出的本地备份')
  })
})
