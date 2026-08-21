import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArticleDraft } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft, type PersistedDraft } from '../domain/saved-draft'
import {
  LAST_ACTIVE_DRAFT_SETTING,
  LOCAL_BACKUP_FORMAT,
  LOCAL_BACKUP_VERSION,
  createLocalBackup,
  importLocalBackup,
  parseLocalBackup,
  serializeLocalBackup,
  type LocalBackupPayload,
} from './local-backup'
import { LocalDraftRepository, resetLocalDraftDatabase } from './local-draft-repository'
import type { DraftRepository } from './draft-repository'

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

function backupPayload(drafts: PersistedDraft[], activeDraftId: string | null): LocalBackupPayload {
  return {
    format: LOCAL_BACKUP_FORMAT,
    version: LOCAL_BACKUP_VERSION,
    exportedAt: '2026-08-15T10:00:00.000Z',
    activeDraftId,
    drafts,
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

  it('can overlay the current unsaved draft so backup remains an emergency exit', async () => {
    const source = repository()
    const stored = createPersistedDraft(article(), DEFAULT_ARTICLE_FORMATTING)
    await source.saveDraft(stored, { preserveUpdatedAt: true })
    const unsaved = {
      ...stored,
      article: { ...stored.article, title: '尚未写入数据库的版本' },
      updatedAt: '2026-08-15T10:00:00.000Z',
    }

    const payload = await createLocalBackup(source, new Date('2026-08-15T10:30:00.000Z'), unsaved)

    expect(payload.drafts).toHaveLength(1)
    expect(payload.drafts[0].article.title).toBe('尚未写入数据库的版本')
    expect(payload.activeDraftId).toBe(unsaved.id)
  })

  it('rejects unrelated JSON files', async () => {
    const file = new File([JSON.stringify({ drafts: [] })], 'other.json', { type: 'application/json' })
    await expect(parseLocalBackup(file)).rejects.toThrow('请选择 EZWRITING 导出的本地备份')
  })

  it('treats a missing deletedAt field as an active draft instead of silently deleting it', async () => {
    const draft = createPersistedDraft(article(), DEFAULT_ARTICLE_FORMATTING)
    const serializedDraft = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>
    delete serializedDraft.deletedAt
    const file = new File([JSON.stringify({
      ...backupPayload([], null),
      drafts: [serializedDraft],
    })], 'missing-deleted-at.ezwriting-backup.json', { type: 'application/json' })

    const parsed = await parseLocalBackup(file)

    expect(parsed.drafts[0].deletedAt).toBeNull()
  })

  it('strictly sanitizes forged backup markers and automatic media requests', async () => {
    const draft = createPersistedDraft({
      ...article(),
      html: '<p>正文</p><img src="https://example.test/image.png" data-missing-id="forged" data-missing-asset="secrets.png"><video autoplay src="https://example.test/video.mp4"></video><table background="https://example.test/tracker.png"><tr><td>表格</td></tr></table>',
      missingAssets: ['secrets.png'],
    }, DEFAULT_ARTICLE_FORMATTING)
    const file = new File([JSON.stringify(backupPayload([draft], draft.id))], 'forged.ezwriting-backup.json', { type: 'application/json' })

    const parsed = await parseLocalBackup(file)
    const restored = parsed.drafts[0].article

    expect(restored.html).not.toContain('data-missing-id')
    expect(restored.html).not.toContain('data-missing-asset')
    expect(restored.html).not.toContain('<video')
    expect(restored.html).not.toContain('background=')
    expect(restored.missingAssets).toEqual([])
  })

  it('rebuilds legitimate missing-image state from sanitized local references', async () => {
    const draft = createPersistedDraft({
      ...article(),
      html: '<p>正文</p><p><img src="assets/flow.png" alt="流程图" data-missing-id="old-id" data-missing-asset="forged.png"></p>',
      missingAssets: ['forged.png'],
    }, DEFAULT_ARTICLE_FORMATTING)
    const file = new File([JSON.stringify(backupPayload([draft], draft.id))], 'missing-image.ezwriting-backup.json', { type: 'application/json' })

    const parsed = await parseLocalBackup(file)
    const restored = parsed.drafts[0].article

    expect(restored.html).toContain('data-missing-id="missing-image-0"')
    expect(restored.html).toContain('data-missing-asset="assets/flow.png"')
    expect(restored.html).not.toContain('forged.png')
    expect(restored.missingAssets).toEqual(['assets/flow.png'])
  })

  it('does not partially overwrite drafts or the active setting when a later image is invalid', async () => {
    const target = repository()
    const original = createPersistedDraft({
      ...article(),
      title: '导入前内容',
    }, DEFAULT_ARTICLE_FORMATTING, {
      updatedAt: '2026-08-15T08:00:00.000Z',
    })
    await target.saveDraft(original, { preserveUpdatedAt: true })
    await target.putSetting(LAST_ACTIVE_DRAFT_SETTING, original.id)

    const replacement = {
      ...original,
      article: { ...original.article, title: '不应留下的覆盖内容' },
      updatedAt: '2026-08-15T09:00:00.000Z',
    }
    const invalidId = 'draft-backup-invalid-0002'
    const invalid = createPersistedDraft({
      ...article(),
      id: invalidId,
      title: '非法图片稿件',
      html: '<p>正文</p><img src="data:image/png;base64,%%%">',
    }, DEFAULT_ARTICLE_FORMATTING)

    await expect(importLocalBackup(target, backupPayload(
      [replacement, invalid],
      invalid.id,
    ))).rejects.toBeDefined()

    expect((await target.getDraft(original.id))?.article.title).toBe('导入前内容')
    expect(await target.getDraft(invalid.id)).toBeNull()
    expect(await target.getSetting(LAST_ACTIVE_DRAFT_SETTING)).toBe(original.id)
  })

  it('updates or clears the active setting in the same successful atomic import', async () => {
    const target = repository()
    await target.putSetting(LAST_ACTIVE_DRAFT_SETTING, 'previous-active-draft')
    const imported = createPersistedDraft(article(), DEFAULT_ARTICLE_FORMATTING)

    await importLocalBackup(target, backupPayload([imported], imported.id))
    expect(await target.getSetting(LAST_ACTIVE_DRAFT_SETTING)).toBe(imported.id)

    await importLocalBackup(target, backupPayload([], null))
    expect(await target.getSetting(LAST_ACTIVE_DRAFT_SETTING)).toBeUndefined()
  })

  it('rejects repositories without atomic import support before writing any draft', async () => {
    const unsupported: DraftRepository = {
      saveDraft: vi.fn(),
      getDraft: vi.fn(),
      listDrafts: vi.fn(),
      softDeleteDraft: vi.fn(),
      restoreDraft: vi.fn(),
      deleteDraft: vi.fn(),
      putSetting: vi.fn(),
      getSetting: vi.fn(),
      deleteSetting: vi.fn(),
    }
    const draft = createPersistedDraft(article(), DEFAULT_ARTICLE_FORMATTING)

    await expect(importLocalBackup(unsupported, backupPayload([draft], draft.id)))
      .rejects.toThrow('不支持原子整库导入')
    expect(unsupported.saveDraft).not.toHaveBeenCalled()
    expect(unsupported.putSetting).not.toHaveBeenCalled()
  })
})
