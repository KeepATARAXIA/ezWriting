import { compactArticleMedia, expandLocalImageReferences, localImageBlob, retainLocalImageReferences } from '../lib/local-image-registry'
import { createLocalBackup } from './local-backup'
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArticleDraft } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft, type PersistedDraft } from '../domain/saved-draft'
import {
  DRAFT_ASSET_PROTOCOL,
  DraftConflictError,
  LocalDraftRepository,
  resetLocalDraftDatabase,
} from './local-draft-repository'

const CREATED_AT = '2026-08-01T08:00:00.000Z'
let databaseSequence = 0
const repositories: LocalDraftRepository[] = []
const databaseNames: string[] = []

function article(id: string, overrides: Partial<ArticleDraft> = {}): ArticleDraft {
  return {
    id,
    title: `稿件 ${id}`,
    html: '<p>正文</p>',
    tags: [],
    sourceFile: 'article.md',
    sourceKind: 'markdown',
    importedAt: CREATED_AT,
    warnings: [],
    missingAssets: [],
    ...overrides,
  }
}

function persisted(id: string, overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  const draft = createPersistedDraft(article(id), DEFAULT_ARTICLE_FORMATTING, {
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  return { ...draft, ...overrides }
}

function createRepository(now: () => Date = () => new Date('2026-08-13T04:00:00.000Z'), runtimeImageReferences = false) {
  databaseSequence += 1
  const databaseName = `dispatch-workbench-test-${databaseSequence}`
  const repository = new LocalDraftRepository({ databaseName, now, runtimeImageReferences })
  repositories.push(repository)
  databaseNames.push(databaseName)
  return { databaseName, repository }
}

function openDatabase(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function createLegacyDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts', { keyPath: 'id' }).put(persisted('legacy-draft'))
      request.result.createObjectStore('assets', { keyPath: 'key' })
      request.result.createObjectStore('settings', { keyPath: 'key' })
      request.result.createObjectStore('outbox', { keyPath: 'id' })
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

afterEach(async () => {
  retainLocalImageReferences([])
  vi.restoreAllMocks()
  await Promise.all(repositories.splice(0).map(repository => repository.close()))
  await Promise.all(databaseNames.splice(0).map(databaseName => resetLocalDraftDatabase(databaseName)))
})

describe('LocalDraftRepository', () => {
  it('creates the three local stores and supports settings', async () => {
    const { databaseName, repository } = createRepository()

    await repository.putSetting('last-opened-draft-id', 'draft-1')
    expect(await repository.getSetting<string>('last-opened-draft-id')).toBe('draft-1')

    const database = await openDatabase(databaseName)
    expect(Array.from(database.objectStoreNames)).toEqual(['assets', 'drafts', 'settings'])
    database.close()

    await repository.deleteSetting('last-opened-draft-id')
    expect(await repository.getSetting('last-opened-draft-id')).toBeUndefined()
  })

  it('upgrades the previous local database without drafts loss and removes the cloud outbox', async () => {
    databaseSequence += 1
    const databaseName = `dispatch-workbench-test-${databaseSequence}`
    databaseNames.push(databaseName)
    await createLegacyDatabase(databaseName)
    const repository = new LocalDraftRepository({ databaseName })
    repositories.push(repository)

    await repository.listDrafts()
    const database = await openDatabase(databaseName)
    expect(Array.from(database.objectStoreNames)).toEqual(['assets', 'drafts', 'settings'])
    database.close()
    expect((await repository.listDrafts()).map(draft => draft.id)).toEqual(['legacy-draft'])
  })

  it('saves, loads, filters, and orders draft summaries while preserving createdAt', async () => {
    let now = '2026-08-13T04:00:00.000Z'
    const { repository } = createRepository(() => new Date(now))
    const older = persisted('older', {
      kind: 'image',
      article: article('older', { title: '图文稿' }),
    })
    const newer = persisted('newer', {
      kind: 'longform',
      article: article('newer', { title: '长文稿', sourceKind: 'html' }),
      formatting: { ...DEFAULT_ARTICLE_FORMATTING, theme: 'editorial', accent: 'purple' },
      xhsSettings: { template: 'clean', paletteId: 'paper', fontMode: 'template', showPageNumber: false, showFooter: false, footerText: '本地测试', imageOverrides: {} },
    })

    await repository.saveDraft(older)
    now = '2026-08-13T05:00:00.000Z'
    const savedNewer = await repository.saveDraft(newer)

    expect(savedNewer.createdAt).toBe(CREATED_AT)
    expect(savedNewer.updatedAt).toBe(now)
    expect((await repository.listDrafts()).map(draft => draft.id)).toEqual(['newer', 'older'])
    expect((await repository.listDrafts({ kind: 'image' })).map(draft => draft.id)).toEqual(['older'])
    expect((await repository.listDrafts())[0]).toMatchObject({
      title: '长文稿',
      kind: 'longform',
      sourceKind: 'html',
    })
    expect((await repository.getDraft('newer'))?.formatting).toMatchObject({ theme: 'editorial', accent: 'purple' })
    expect((await repository.getDraft('newer'))?.xhsSettings).toEqual({
      template: 'clean',
      paletteId: 'paper',
      fontMode: 'template',
      showPageNumber: false,
      showFooter: false,
      footerText: '本地测试',
      imageOverrides: {},
    })
    expect(await repository.getDraft('missing')).toBeNull()
  })

  it('stores embedded images once as binary assets and transparently restores data URLs', async () => {
    const { databaseName, repository } = createRepository()
    const dataUri = 'data:image/png;base64,iVBORw0KGgo='
    const draft = persisted('with-image', {
      article: article('with-image', {
        html: `<p>正文</p><img src="${dataUri}" alt="配图">`,
        markdown: `正文\n\n![配图](${dataUri})`,
        sourceText: `正文\n\n![配图](${dataUri})`,
        sourceLanguage: 'markdown',
        cover: dataUri,
      } as Partial<ArticleDraft> & { cover: string }),
    })

    const saved = await repository.saveDraft(draft)

    expect(saved.article.html).toContain(dataUri)
    expect(saved.article.markdown).toContain(dataUri)
    expect(saved.article.sourceText).toContain(dataUri)
    expect(saved.article).not.toHaveProperty('cover')

    const database = await openDatabase(databaseName)
    const transaction = database.transaction(['drafts', 'assets'], 'readonly')
    const rawDraft = await requestResult(transaction.objectStore('drafts').get('with-image') as IDBRequest<PersistedDraft>)
    const assets = await requestResult(transaction.objectStore('assets').getAll() as IDBRequest<Array<{ id: string; blob?: Blob; bytes: ArrayBuffer; mimeType: string }>>)
    database.close()

    expect(rawDraft.article.html).not.toContain('data:image/')
    expect(rawDraft.article.html).toContain(DRAFT_ASSET_PROTOCOL)
    expect(rawDraft.article).not.toHaveProperty('cover')
    expect(rawDraft.article.markdown).toContain(DRAFT_ASSET_PROTOCOL)
    expect(rawDraft.article.sourceText).toContain(DRAFT_ASSET_PROTOCOL)
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ mimeType: 'image/png' })
    expect(assets[0].bytes.byteLength).toBeGreaterThan(0)
    expect(assets[0]).not.toHaveProperty('blob')
  })

  it('does not decode or rewrite unchanged images, including after reopening the draft', async () => {
    const { repository } = createRepository()
    const dataUri = 'data:image/png;base64,AQIDBA=='
    const draft = persisted('cached-image', {
      article: article('cached-image', { html: `<img src="${dataUri}"><img src="${dataUri}">` }),
    })
    const decode = vi.spyOn(globalThis, 'atob')
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    await repository.saveDraft(draft)
    expect(decode).toHaveBeenCalledTimes(1)
    decode.mockClear()
    put.mockClear()
    await repository.saveDraft({ ...draft, article: { ...draft.article, title: '只改标题' } })
    expect(decode).not.toHaveBeenCalled()
    expect(put.mock.instances.filter(store => (store as IDBObjectStore).name === 'assets')).toHaveLength(0)

    await repository.close()
    const restored = await repository.getDraft(draft.id)
    put.mockClear()
    await repository.saveDraft(restored!)
    expect(decode).not.toHaveBeenCalled()
    expect(put.mock.instances.filter(store => (store as IDBObjectStore).name === 'assets')).toHaveLength(0)
  })

  it('writes cached assets again after removal and undo, and does not assume failed saves committed', async () => {
    const { repository } = createRepository()
    const draft = persisted('cached-retry', {
      article: article('cached-retry', { html: '<img src="data:image/png;base64,AQIDBA==">' }),
    })
    await expect(repository.saveDraft(draft, { expectedUpdatedAt: 'stale' })).rejects.toBeInstanceOf(DraftConflictError)
    await repository.saveDraft(draft)
    await repository.saveDraft({ ...draft, article: article(draft.id) })
    await repository.saveDraft(draft)
    expect((await repository.getDraft(draft.id))?.article.html).toContain('data:image/png;base64,AQIDBA==')
  })

  it('keeps the previous draft intact if an asset write throws and can retry the cached media', async () => {
    const { repository } = createRepository()
    const previous = persisted('asset-write-failure')
    await repository.saveDraft(previous)
    const next = { ...previous, article: article(previous.id, { html: '<img src="data:image/png;base64,AQIDBA==">' }) }
    const originalPut = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'assets') throw new DOMException('空间不足', 'QuotaExceededError')
      return originalPut.apply(this, args)
    })
    await expect(repository.saveDraft(next)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    put.mockRestore()
    expect((await repository.getDraft(previous.id))?.article.html).toBe(previous.article.html)
    await repository.saveDraft(next)
    expect((await repository.getDraft(next.id))?.article.html).toBe(next.article.html)
  })

  it('recovers cached media removed by another repository without bypassing conflict checks', async () => {
    const { databaseName, repository } = createRepository()
    const other = new LocalDraftRepository({ databaseName })
    repositories.push(other)
    const draft = persisted('cross-tab-assets', { article: article('cross-tab-assets', { html: '<img src="data:image/png;base64,AQIDBA==">' }) })
    const original = await repository.saveDraft(draft)
    const removed = await other.saveDraft({ ...draft, article: article(draft.id) })
    await expect(repository.saveDraft(draft, { expectedUpdatedAt: original.updatedAt })).rejects.toBeInstanceOf(DraftConflictError)
    await repository.saveDraft(draft, { expectedUpdatedAt: removed.updatedAt })
    expect((await other.getDraft(draft.id))?.article.html).toBe(draft.article.html)
  })

  it('uses stable asset identifiers and removes assets no longer referenced by a draft', async () => {
    const { databaseName, repository } = createRepository()
    const dataUri = 'data:image/png;base64,AQIDBA=='
    const withImage = persisted('cleanup', {
      article: article('cleanup', { html: `<img src="${dataUri}" alt="配图">` }),
    })

    await repository.saveDraft(withImage)
    await repository.saveDraft(withImage)

    let database = await openDatabase(databaseName)
    let assets = await requestResult(database.transaction('assets').objectStore('assets').getAll() as IDBRequest<Array<{ id: string }>>)
    expect(assets).toHaveLength(1)
    expect(assets[0].id).toMatch(/^sha256-/)
    database.close()

    await repository.saveDraft({ ...withImage, article: article('cleanup', { html: '<p>已移除图片</p>' }) })
    database = await openDatabase(databaseName)
    assets = await requestResult(database.transaction('assets').objectStore('assets').getAll() as IDBRequest<Array<{ id: string }>>)
    database.close()
    expect(assets).toEqual([])
  })

  it('soft deletes and restores drafts without allowing a stale save to clear the tombstone', async () => {
    let now = '2026-08-13T04:00:00.000Z'
    const { repository } = createRepository(() => new Date(now))
    const original = persisted('soft-delete')
    await repository.saveDraft(original)

    now = '2026-08-13T05:00:00.000Z'
    const deleted = await repository.softDeleteDraft(original.id)
    expect(deleted?.deletedAt).toBe(now)
    expect(await repository.listDrafts()).toEqual([])
    expect((await repository.listDrafts({ includeDeleted: true }))[0].deletedAt).toBe(now)

    now = '2026-08-13T06:00:00.000Z'
    const staleSave = await repository.saveDraft({
      ...original,
      article: article(original.id, { title: '删除期间仍在编辑' }),
      deletedAt: null,
    })
    expect(staleSave.deletedAt).toBe('2026-08-13T05:00:00.000Z')
    expect(await repository.listDrafts()).toEqual([])

    now = '2026-08-13T07:00:00.000Z'
    const restored = await repository.restoreDraft(original.id)
    expect(restored?.deletedAt).toBeNull()
    expect((await repository.listDrafts()).map(draft => draft.id)).toEqual([original.id])
  })

  it('rejects a stale cross-tab save when the expected update timestamp no longer matches', async () => {
    const firstNow = '2026-08-13T04:00:00.000Z'
    let secondNow = '2026-08-13T04:00:00.000Z'
    const { databaseName, repository: firstTab } = createRepository(() => new Date(firstNow))
    const secondTab = new LocalDraftRepository({ databaseName, now: () => new Date(secondNow) })
    repositories.push(secondTab)

    const initial = await firstTab.saveDraft(persisted('shared-draft'))
    const staleCopy = await secondTab.getDraft(initial.id)
    expect(staleCopy?.updatedAt).toBe(initial.updatedAt)

    const firstSaved = await firstTab.saveDraft({
      ...initial,
      article: article(initial.id, { title: '标签页一的新版本' }),
    }, { expectedUpdatedAt: initial.updatedAt })
    expect(firstSaved.updatedAt).toBe('2026-08-13T04:00:00.001Z')

    secondNow = '2026-08-13T06:00:00.000Z'
    const staleSave = secondTab.saveDraft({
      ...staleCopy!,
      article: article(initial.id, { title: '标签页二的陈旧版本' }),
    }, { expectedUpdatedAt: staleCopy!.updatedAt })

    await expect(staleSave).rejects.toMatchObject({
      name: 'DraftConflictError',
      code: 'draft-conflict',
      draftId: initial.id,
      expectedUpdatedAt: initial.updatedAt,
      actualUpdatedAt: firstSaved.updatedAt,
    })
    await expect(staleSave).rejects.toBeInstanceOf(DraftConflictError)
    expect((await firstTab.getDraft(initial.id))?.article.title).toBe('标签页一的新版本')
  })

  it('rolls back all imported drafts and setting mutations when a batch transaction fails', async () => {
    const { repository } = createRepository()
    const original = await repository.saveDraft(persisted('atomic-existing', {
      article: article('atomic-existing', { title: '导入前内容' }),
    }))
    await repository.putSetting('last-active-draft-id', original.id)

    const replacement = persisted(original.id, {
      article: article(original.id, { title: '不应留下的覆盖内容' }),
      updatedAt: '2026-08-13T05:00:00.000Z',
    })
    const invalid = persisted('atomic-invalid', {
      article: {
        ...article('atomic-invalid', { title: '触发事务失败' }),
        nonCloneableValue: () => undefined,
      } as ArticleDraft,
    })

    await expect(repository.importDraftsAtomically([replacement, invalid], {
      settingMutations: [{ type: 'put', key: 'last-active-draft-id', value: invalid.id }],
    })).rejects.toBeDefined()

    expect((await repository.getDraft(original.id))?.article.title).toBe('导入前内容')
    expect(await repository.getDraft(invalid.id)).toBeNull()
    expect(await repository.getSetting('last-active-draft-id')).toBe(original.id)
  })

  it('hard deletes a draft together with its assets', async () => {
    const { databaseName, repository } = createRepository()
    const dataUri = 'data:image/webp;base64,AQID'
    await repository.saveDraft(persisted('hard-delete', {
      article: article('hard-delete', { html: `<img src="${dataUri}">` }),
    }))
    await repository.deleteDraft('hard-delete')

    expect(await repository.getDraft('hard-delete')).toBeNull()
    const database = await openDatabase(databaseName)
    const assets = await requestResult(database.transaction('assets').objectStore('assets').getAll())
    database.close()
    expect(assets).toEqual([])
  })
})


describe('runtime image persistence', () => {
  it('rejects an expired runtime URL without overwriting the saved draft', async () => {
    const { repository } = createRepository()
    const original = await repository.saveDraft(persisted('expired-images'))
    await expect(repository.saveDraft({ ...original, article: { ...original.article, html: '<img src="blob:expired-image">' } }))
      .rejects.toThrow('本地图片引用已失效')
    expect((await repository.getDraft(original.id))?.article.html).toBe(original.article.html)
  })

  it('saves short runtime references atomically and exports original bytes after reopen and undo', async () => {
    const { repository } = createRepository(undefined, true)
    const source = 'data:image/png;base64,aW1hZ2U='
    const original = persisted('runtime-images')
    original.article = compactArticleMedia({ ...original.article, html: `<p><img src="${source}"></p>`,
      markdown: `![原图](${source})`, sourceText: `![原图](${source})`, sourceLanguage: 'markdown' })
    const reference = original.article.html.match(/src="([^"]+)"/)![1]
    const read = vi.spyOn(localImageBlob(reference)!, 'arrayBuffer')
    let saved = await repository.saveDraft(original)
    expect(read).toHaveBeenCalledTimes(1)
    await repository.close()
    const restored = (await repository.getDraft(original.id))!
    expect(restored.article.html).toContain(reference)
    read.mockClear()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    saved = await repository.saveDraft({ ...restored, article: { ...restored.article, title: '只改标题' } })
    expect(read).not.toHaveBeenCalled()
    expect(put.mock.instances.filter(store => (store as IDBObjectStore).name === 'assets')).toHaveLength(0)
    const backup = await createLocalBackup(repository, new Date(), saved)
    expect(backup.drafts[0].article.html).toContain(source)
    expect(JSON.stringify(backup)).not.toContain('blob:')
    const removed = await repository.saveDraft({ ...saved, article: { ...saved.article, html: '<p>删图</p>', markdown: '删图', sourceText: '删图' } })
    await repository.saveDraft({ ...removed, article: saved.article })
    const undone = (await repository.getDraft(original.id))!
    expect(expandLocalImageReferences(undone.article.html)).toContain(source)
  })
})
