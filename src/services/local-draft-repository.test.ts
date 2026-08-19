import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { ArticleDraft } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft, type PersistedDraft } from '../domain/saved-draft'
import {
  DRAFT_ASSET_PROTOCOL,
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

function createRepository(now: () => Date = () => new Date('2026-08-13T04:00:00.000Z')) {
  databaseSequence += 1
  const databaseName = `dispatch-workbench-test-${databaseSequence}`
  const repository = new LocalDraftRepository({ databaseName, now })
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
      xhsSettings: { template: 'clean', showPageNumber: false, showFooter: false, footerText: '本地测试', imageOverrides: {} },
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
      showPageNumber: false,
      showFooter: false,
      footerText: '本地测试',
      imageOverrides: {},
    })
    expect(await repository.getDraft('missing')).toBeNull()
  })

  it('stores embedded images once as Blob assets and transparently restores data URLs', async () => {
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
    const assets = await requestResult(transaction.objectStore('assets').getAll() as IDBRequest<Array<{ id: string; blob: Blob; bytes: ArrayBuffer; mimeType: string }>>)
    database.close()

    expect(rawDraft.article.html).not.toContain('data:image/')
    expect(rawDraft.article.html).toContain(DRAFT_ASSET_PROTOCOL)
    expect(rawDraft.article).not.toHaveProperty('cover')
    expect(rawDraft.article.markdown).toContain(DRAFT_ASSET_PROTOCOL)
    expect(rawDraft.article.sourceText).toContain(DRAFT_ASSET_PROTOCOL)
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ mimeType: 'image/png' })
    expect(assets[0]).toHaveProperty('blob')
    expect(assets[0].bytes.byteLength).toBeGreaterThan(0)
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
