import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft, type PersistedDraft } from '../domain/saved-draft'
import type { ArticleDraft } from '../domain/article'
import { clearLocalVideoRegistry, localVideoBlob, registerLocalVideo } from '../lib/local-video-registry'
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
  it.each([60, 100])('stores and restores a %i MiB video without expanding the article', async sizeMiB => {
    const bytes = new Uint8Array(sizeMiB * 1024 * 1024)
    bytes.set([1, 2, 3, 4])
    const reference = registerLocalVideo(new Blob([bytes], { type: 'video/mp4' }))
    const source = `<video controls src="${reference}" data-ez-video-name="大视频.mp4"></video>`
    const article: ArticleDraft = {
      id: 'large-video-draft',
      title: '大视频稿件',
      html: source,
      markdown: source,
      sourceText: source,
      sourceLanguage: 'markdown',
      tags: [],
      sourceFile: 'article.md',
      sourceKind: 'markdown',
      importedAt: '2026-09-04T03:00:00.000Z',
      warnings: [],
      missingAssets: [],
    }
    const repository = new LocalDraftRepository({ databaseName })
    await repository.saveDraft(createPersistedDraft(article, DEFAULT_ARTICLE_FORMATTING))
    await repository.close()
    clearLocalVideoRegistry()

    const reopened = new LocalDraftRepository({ databaseName })
    const restored = await reopened.getDraft(article.id)
    const restoredReference = restored?.article.sourceText?.match(/dispatch-local-video:\/\/[a-z0-9-]+/i)?.[0]
    const blob = localVideoBlob(restoredReference || '')
    expect(blob?.size).toBe(bytes.byteLength)
    expect(new Uint8Array(await blob!.slice(0, 4).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(restored?.article.sourceText).not.toContain('data:video/')
    expect(restored?.article.sourceText?.length).toBeLessThan(300)
    await reopened.close()
  })

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
