import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft, type PersistedDraft } from '../domain/saved-draft'
import type { ArticleDraft } from '../domain/article'
import { clearLocalVideoRegistry, localVideoBlob } from '../lib/local-video-registry'
import {
  DRAFT_ASSET_PROTOCOL,
  LocalDraftRepository,
  resetLocalDraftDatabase,
} from './local-draft-repository'

const databaseName = 'dispatch-workbench-video-test'

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

afterEach(async () => {
  clearLocalVideoRegistry()
  await resetLocalDraftDatabase(databaseName)
})

describe('LocalDraftRepository video assets', () => {
  it('stores embedded video once as a Blob and restores the editable data URI', async () => {
    const source = 'data:video/mp4;base64,AQIDBA=='
    const article: ArticleDraft = {
      id: 'video-draft',
      title: '视频稿件',
      html: `<p>正文</p><video controls src="${source}" data-ez-video-name="演示.mp4"></video>`,
      markdown: `正文\n\n<video controls src="${source}" data-ez-video-name="演示.mp4"></video>`,
      sourceText: `正文\n\n<video controls src="${source}" data-ez-video-name="演示.mp4"></video>`,
      sourceLanguage: 'markdown',
      tags: [],
      sourceFile: 'article.md',
      sourceKind: 'markdown',
      importedAt: '2026-08-28T08:00:00.000Z',
      warnings: [],
      missingAssets: [],
    }
    const repository = new LocalDraftRepository({ databaseName })
    const draft = createPersistedDraft(article, DEFAULT_ARTICLE_FORMATTING, {
      createdAt: '2026-08-28T08:00:00.000Z',
      updatedAt: '2026-08-28T08:00:00.000Z',
    })

    const saved = await repository.saveDraft(draft)
    expect(saved.article.html).toContain(source)
    expect(saved.article.sourceText).toContain(source)

    const database = await openDatabase()
    const transaction = database.transaction(['drafts', 'assets'], 'readonly')
    const rawDraft = await requestResult(transaction.objectStore('drafts').get(article.id) as IDBRequest<PersistedDraft>)
    const assets = await requestResult(transaction.objectStore('assets').getAll() as IDBRequest<Array<{ mimeType: string; byteSize: number }>>)
    database.close()

    expect(rawDraft.article.html).toContain(DRAFT_ASSET_PROTOCOL)
    expect(rawDraft.article.html).not.toContain('data:video/')
    expect(rawDraft.article.sourceText).toContain(DRAFT_ASSET_PROTOCOL)
    expect(assets).toEqual([expect.objectContaining({ mimeType: 'video/mp4', byteSize: 4 })])

    const restored = await repository.getDraft(article.id)
    const restoredReference = restored?.article.sourceText?.match(/dispatch-local-video:\/\/[a-z0-9-]+/i)?.[0]
    expect(restoredReference).toBeTruthy()
    expect(restored?.article.sourceText).not.toContain('data:video/')
    expect(localVideoBlob(restoredReference || '')?.size).toBe(4)
    await repository.close()
  })
})
