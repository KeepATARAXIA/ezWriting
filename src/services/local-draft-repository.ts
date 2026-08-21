import type { ArticleDraft } from '../domain/article'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import type { DraftSummary, PersistedDraft } from '../domain/saved-draft'
import { normalizeXhsCardSettings, SAVED_DRAFT_SCHEMA_VERSION, toDraftSummary } from '../domain/saved-draft'
import type {
  AtomicDraftImportOptions,
  DraftListOptions,
  DraftRepository,
  DraftSaveOptions,
} from './draft-repository'
import { normalizeWechatThemeSettings } from '../lib/wechat-theme'

export const LOCAL_DRAFT_DATABASE_NAME = 'dispatch-workbench-local'
export const LOCAL_DRAFT_DATABASE_VERSION = 2
export const DRAFT_ASSET_PROTOCOL = 'dispatch-asset://'

const DRAFTS_STORE = 'drafts'
const ASSETS_STORE = 'assets'
const SETTINGS_STORE = 'settings'
const DRAFT_ID_INDEX = 'draftId'

interface StoredAsset {
  key: string
  id: string
  draftId: string
  blob: Blob
  bytes: ArrayBuffer
  mimeType: string
  byteSize: number
  updatedAt: string
}

interface StoredSetting {
  key: string
  value: unknown
}

export interface LocalDraftRepositoryOptions {
  databaseName?: string
  indexedDB?: IDBFactory
  now?: () => Date
}

export class DraftConflictError extends Error {
  readonly code = 'draft-conflict'
  readonly draftId: string
  readonly expectedUpdatedAt: string | null
  readonly actualUpdatedAt: string | null

  constructor(draftId: string, expectedUpdatedAt: string | null, actualUpdatedAt: string | null) {
    super('这篇稿件已在其他标签页中更新，请重新载入后再保存。')
    this.name = 'DraftConflictError'
    this.draftId = draftId
    this.expectedUpdatedAt = expectedUpdatedAt
    this.actualUpdatedAt = actualUpdatedAt
  }
}

interface ExtractedArticle {
  article: ArticleDraft
  assets: Map<string, Omit<StoredAsset, 'key' | 'draftId' | 'updatedAt'>>
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB 请求失败。')), { once: true })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB 事务已中止。')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB 事务失败。')), { once: true })
  })
}

async function abortTransaction(transaction: IDBTransaction, done: Promise<void>): Promise<void> {
  try {
    transaction.abort()
  } catch {
    // The transaction may already be aborted or complete.
  }
  try {
    await done
  } catch {
    // The original operation error is more useful to the caller.
  }
}

function assetKey(draftId: string, assetId: string): string {
  return `${draftId}:${assetId}`
}

function assetReference(assetId: string): string {
  return `${DRAFT_ASSET_PROTOCOL}${assetId}`
}

function monotonicUpdatedAt(candidate: string, previous: string | undefined): string {
  if (!previous) return candidate
  const candidateTime = Date.parse(candidate)
  const previousTime = Date.parse(previous)
  if (!Number.isFinite(candidateTime) || !Number.isFinite(previousTime) || candidateTime > previousTime) return candidate
  return new Date(previousTime + 1).toISOString()
}

function assetIdFromReference(value: string | undefined): string | null {
  if (!value?.startsWith(DRAFT_ASSET_PROTOCOL)) return null
  const id = value.slice(DRAFT_ASSET_PROTOCOL.length)
  return id && /^[a-z0-9-]+$/i.test(id) ? id : null
}

function isImageDataUri(value: string | undefined): value is string {
  return Boolean(value && /^data:image\//i.test(value))
}

function bytesFromDataUri(dataUri: string): { bytes: Uint8Array; mimeType: string } {
  const commaIndex = dataUri.indexOf(',')
  if (commaIndex < 0) throw new Error('图片 Data URI 格式无效。')

  const metadata = dataUri.slice(5, commaIndex).split(';')
  const mimeType = metadata[0]?.toLowerCase()
  if (!mimeType?.startsWith('image/')) throw new Error('仅支持持久化图片 Data URI。')

  const payload = dataUri.slice(commaIndex + 1)
  if (metadata.some(part => part.toLowerCase() === 'base64')) {
    const binary = atob(payload.replace(/\s/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return { bytes, mimeType }
  }

  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType }
}

function fallbackHash(bytes: Uint8Array): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193)
    second = Math.imul(second ^ byte, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}${bytes.byteLength.toString(16)}`
}

async function contentHash(bytes: Uint8Array, mimeType: string): Promise<string> {
  const mimeBytes = new TextEncoder().encode(`${mimeType}\0`)
  const input = new Uint8Array(mimeBytes.byteLength + bytes.byteLength)
  input.set(mimeBytes)
  input.set(bytes, mimeBytes.byteLength)

  if (!globalThis.crypto?.subtle) return fallbackHash(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function storedAssetFromDataUri(dataUri: string): Promise<Omit<StoredAsset, 'key' | 'draftId' | 'updatedAt'>> {
  const { bytes, mimeType } = bytesFromDataUri(dataUri)
  const id = `sha256-${await contentHash(bytes, mimeType)}`
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return {
    id,
    blob: new Blob([buffer], { type: mimeType }),
    bytes: buffer,
    mimeType,
    byteSize: bytes.byteLength,
  }
}

async function extractArticleAssets(article: ArticleDraft): Promise<ExtractedArticle> {
  const { cover: _legacyCover, ...articleWithoutCover } = article as ArticleDraft & { cover?: unknown }
  const assets = new Map<string, Omit<StoredAsset, 'key' | 'draftId' | 'updatedAt'>>()
  const replacements = new Map<string, string>()

  const register = async (dataUri: string): Promise<string> => {
    const existing = replacements.get(dataUri)
    if (existing) return existing
    const asset = await storedAssetFromDataUri(dataUri)
    const reference = assetReference(asset.id)
    assets.set(asset.id, asset)
    replacements.set(dataUri, reference)
    return reference
  }

  let html = articleWithoutCover.html
  if (/data:image\//i.test(html)) {
    const document = new DOMParser().parseFromString(html, 'text/html')
    for (const image of document.body.querySelectorAll<HTMLImageElement>('img[src]')) {
      const source = image.getAttribute('src') ?? ''
      if (isImageDataUri(source)) image.setAttribute('src', await register(source))
    }
    html = document.body.innerHTML
  }

  let markdown = articleWithoutCover.markdown
  if (markdown) {
    for (const [dataUri, reference] of replacements) markdown = markdown.replaceAll(dataUri, reference)
  }
  let sourceText = articleWithoutCover.sourceText
  if (sourceText) {
    for (const [dataUri, reference] of replacements) sourceText = sourceText.replaceAll(dataUri, reference)
  }

  return {
    article: {
      ...articleWithoutCover,
      html,
      markdown,
      sourceText,
      tags: [...articleWithoutCover.tags],
      warnings: [...articleWithoutCover.warnings],
      missingAssets: articleWithoutCover.missingAssets ? [...articleWithoutCover.missingAssets] : undefined,
    },
    assets,
  }
}

function referencedAssetIds(article: ArticleDraft): Set<string> {
  const ids = new Set<string>()
  const document = new DOMParser().parseFromString(article.html, 'text/html')
  document.body.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
    const id = assetIdFromReference(image.getAttribute('src') ?? undefined)
    if (id) ids.add(id)
  })

  if (article.markdown) {
    const pattern = new RegExp(`${DRAFT_ASSET_PROTOCOL}([a-z0-9-]+)`, 'gi')
    for (const match of article.markdown.matchAll(pattern)) ids.add(match[1])
  }
  if (article.sourceText) {
    const pattern = new RegExp(`${DRAFT_ASSET_PROTOCOL}([a-z0-9-]+)`, 'gi')
    for (const match of article.sourceText.matchAll(pattern)) ids.add(match[1])
  }
  return ids
}

function readAssetBytes(asset: StoredAsset): Promise<Uint8Array> {
  if (asset.bytes && typeof asset.bytes.byteLength === 'number') {
    return Promise.resolve(new Uint8Array(asset.bytes))
  }
  if (typeof asset.blob.arrayBuffer === 'function') {
    return asset.blob.arrayBuffer().then(buffer => new Uint8Array(buffer))
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result))
      else reject(new Error('本地图片读取失败。'))
    }, { once: true })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('本地图片读取失败。')), { once: true })
    reader.readAsArrayBuffer(asset.blob)
  })
}

async function blobToDataUri(asset: StoredAsset): Promise<string> {
  const bytes = await readAssetBytes(asset)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${asset.mimeType};base64,${btoa(binary)}`
}

async function hydrateArticle(article: ArticleDraft, assets: StoredAsset[]): Promise<ArticleDraft> {
  const { cover: _legacyCover, ...articleWithoutCover } = article as ArticleDraft & { cover?: unknown }
  const replacements = new Map<string, string>()
  await Promise.all(assets.map(async asset => {
    replacements.set(assetReference(asset.id), await blobToDataUri(asset))
  }))

  let html = articleWithoutCover.html
  if (html.includes(DRAFT_ASSET_PROTOCOL)) {
    const document = new DOMParser().parseFromString(html, 'text/html')
    document.body.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
      const source = image.getAttribute('src') ?? ''
      const dataUri = replacements.get(source)
      if (dataUri) image.setAttribute('src', dataUri)
    })
    html = document.body.innerHTML
  }

  let markdown = articleWithoutCover.markdown
  if (markdown) {
    for (const [reference, dataUri] of replacements) markdown = markdown.replaceAll(reference, dataUri)
  }
  let sourceText = articleWithoutCover.sourceText
  if (sourceText) {
    for (const [reference, dataUri] of replacements) sourceText = sourceText.replaceAll(reference, dataUri)
  }

  return {
    ...articleWithoutCover,
    html,
    markdown,
    sourceText,
    tags: [...articleWithoutCover.tags],
    warnings: [...articleWithoutCover.warnings],
    missingAssets: articleWithoutCover.missingAssets ? [...articleWithoutCover.missingAssets] : undefined,
  }
}

function createStores(database: IDBDatabase, transaction: IDBTransaction): void {
  const drafts = database.objectStoreNames.contains(DRAFTS_STORE)
    ? transaction.objectStore(DRAFTS_STORE)
    : database.createObjectStore(DRAFTS_STORE, { keyPath: 'id' })
  if (!drafts.indexNames.contains('updatedAt')) drafts.createIndex('updatedAt', 'updatedAt')
  if (!drafts.indexNames.contains('deletedAt')) drafts.createIndex('deletedAt', 'deletedAt')

  const assets = database.objectStoreNames.contains(ASSETS_STORE)
    ? transaction.objectStore(ASSETS_STORE)
    : database.createObjectStore(ASSETS_STORE, { keyPath: 'key' })
  if (!assets.indexNames.contains(DRAFT_ID_INDEX)) assets.createIndex(DRAFT_ID_INDEX, DRAFT_ID_INDEX)

  if (database.objectStoreNames.contains('outbox')) database.deleteObjectStore('outbox')

  if (!database.objectStoreNames.contains(SETTINGS_STORE)) database.createObjectStore(SETTINGS_STORE, { keyPath: 'key' })
}

export class LocalDraftRepository implements DraftRepository {
  private readonly databaseName: string
  private readonly factory: IDBFactory
  private readonly now: () => Date
  private databasePromise: Promise<IDBDatabase> | null = null

  constructor(options: LocalDraftRepositoryOptions = {}) {
    if (!options.indexedDB && !globalThis.indexedDB) throw new Error('当前浏览器不支持 IndexedDB。')
    this.databaseName = options.databaseName ?? LOCAL_DRAFT_DATABASE_NAME
    this.factory = options.indexedDB ?? globalThis.indexedDB
    this.now = options.now ?? (() => new Date())
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise

    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, LOCAL_DRAFT_DATABASE_VERSION)
      request.addEventListener('upgradeneeded', () => {
        if (!request.transaction) return
        createStores(request.result, request.transaction)
      })
      request.addEventListener('success', () => {
        const database = request.result
        database.addEventListener('versionchange', () => {
          database.close()
          this.databasePromise = null
        })
        resolve(database)
      }, { once: true })
      request.addEventListener('error', () => {
        this.databasePromise = null
        reject(request.error ?? new Error('无法打开本地稿件数据库。'))
      }, { once: true })
      request.addEventListener('blocked', () => {
        this.databasePromise = null
        reject(new Error('本地稿件数据库升级被其他页面阻止，请关闭其他页面后重试。'))
      }, { once: true })
    })

    return this.databasePromise
  }

  async saveDraft(draft: PersistedDraft, options: DraftSaveOptions = {}): Promise<PersistedDraft> {
    const database = await this.openDatabase()
    const updatedAt = options.preserveUpdatedAt ? draft.updatedAt : this.now().toISOString()
    const extracted = await extractArticleAssets({ ...draft.article, id: draft.id })
    const nextDraft: PersistedDraft = {
      ...draft,
      id: draft.id,
      article: extracted.article,
      formatting: {
        ...draft.formatting,
        wechat: normalizeWechatThemeSettings(draft.formatting.wechat),
      },
      xhsSettings: normalizeXhsCardSettings(draft.xhsSettings),
      updatedAt,
    }
    const retainedAssetIds = referencedAssetIds(nextDraft.article)
    const transaction = database.transaction([DRAFTS_STORE, ASSETS_STORE], 'readwrite')
    const done = transactionDone(transaction)
    const drafts = transaction.objectStore(DRAFTS_STORE)
    const assets = transaction.objectStore(ASSETS_STORE)
    const existingDraftRequest = drafts.get(draft.id) as IDBRequest<PersistedDraft | undefined>
    const existingKeysRequest = assets.index(DRAFT_ID_INDEX).getAllKeys(draft.id)

    const [existingDraft, existingKeys] = await Promise.all([
      requestResult(existingDraftRequest),
      requestResult(existingKeysRequest),
    ])
    if (options.expectedUpdatedAt !== undefined) {
      const actualUpdatedAt = existingDraft?.updatedAt ?? null
      if (actualUpdatedAt !== options.expectedUpdatedAt) {
        const conflict = new DraftConflictError(draft.id, options.expectedUpdatedAt, actualUpdatedAt)
        await abortTransaction(transaction, done)
        throw conflict
      }
    }
    const storedDraft: PersistedDraft = {
      ...nextDraft,
      updatedAt: options.preserveUpdatedAt ? nextDraft.updatedAt : monotonicUpdatedAt(nextDraft.updatedAt, existingDraft?.updatedAt),
      deletedAt: existingDraft && !options.replaceDeletionState ? existingDraft.deletedAt : nextDraft.deletedAt,
    }
    drafts.put(storedDraft)
    for (const asset of extracted.assets.values()) {
      assets.put({
        ...asset,
        key: assetKey(draft.id, asset.id),
        draftId: draft.id,
        updatedAt: storedDraft.updatedAt,
      } satisfies StoredAsset)
    }

    for (const key of existingKeys) {
      if (typeof key !== 'string') continue
      const assetId = key.slice(`${draft.id}:`.length)
      if (!retainedAssetIds.has(assetId)) assets.delete(key)
    }

    await done
    const saved = await this.getDraft(draft.id)
    if (!saved) throw new Error('本地稿件保存后无法读取。')
    return saved
  }

  async importDraftsAtomically(
    draftsToImport: readonly PersistedDraft[],
    options: AtomicDraftImportOptions = {},
  ): Promise<void> {
    const draftIds = new Set<string>()
    for (const draft of draftsToImport) {
      if (draftIds.has(draft.id)) throw new Error(`原子导入包含重复稿件：${draft.id}`)
      draftIds.add(draft.id)
    }

    const preparedDrafts = await Promise.all(draftsToImport.map(async draft => {
      const extracted = await extractArticleAssets({ ...draft.article, id: draft.id })
      const storedDraft: PersistedDraft = {
        ...draft,
        id: draft.id,
        article: extracted.article,
        formatting: {
          ...draft.formatting,
          wechat: normalizeWechatThemeSettings(draft.formatting.wechat),
        },
        xhsSettings: normalizeXhsCardSettings(draft.xhsSettings),
      }
      return {
        storedDraft,
        assets: extracted.assets,
        retainedAssetIds: referencedAssetIds(storedDraft.article),
      }
    }))

    const database = await this.openDatabase()
    const transaction = database.transaction([DRAFTS_STORE, ASSETS_STORE, SETTINGS_STORE], 'readwrite')
    const done = transactionDone(transaction)
    const drafts = transaction.objectStore(DRAFTS_STORE)
    const assets = transaction.objectStore(ASSETS_STORE)
    const settings = transaction.objectStore(SETTINGS_STORE)

    try {
      const existingKeysByDraft = await Promise.all(preparedDrafts.map(({ storedDraft }) => (
        requestResult(assets.index(DRAFT_ID_INDEX).getAllKeys(storedDraft.id))
      )))

      preparedDrafts.forEach(({ storedDraft, assets: extractedAssets, retainedAssetIds }, draftIndex) => {
        drafts.put(storedDraft)
        for (const asset of extractedAssets.values()) {
          assets.put({
            ...asset,
            key: assetKey(storedDraft.id, asset.id),
            draftId: storedDraft.id,
            updatedAt: storedDraft.updatedAt,
          } satisfies StoredAsset)
        }

        for (const key of existingKeysByDraft[draftIndex]) {
          if (typeof key !== 'string') continue
          const assetId = key.slice(`${storedDraft.id}:`.length)
          if (!retainedAssetIds.has(assetId)) assets.delete(key)
        }
      })

      for (const mutation of options.settingMutations ?? []) {
        if (mutation.type === 'put') settings.put({ key: mutation.key, value: mutation.value } satisfies StoredSetting)
        else settings.delete(mutation.key)
      }

      await done
    } catch (error) {
      await abortTransaction(transaction, done)
      throw error
    }
  }

  async getDraft(id: string): Promise<PersistedDraft | null> {
    const database = await this.openDatabase()
    const transaction = database.transaction([DRAFTS_STORE, ASSETS_STORE], 'readonly')
    const done = transactionDone(transaction)
    const draftRequest = transaction.objectStore(DRAFTS_STORE).get(id) as IDBRequest<PersistedDraft | undefined>
    const assetsRequest = transaction.objectStore(ASSETS_STORE).index(DRAFT_ID_INDEX).getAll(id) as IDBRequest<StoredAsset[]>
    const [draft, assets] = await Promise.all([requestResult(draftRequest), requestResult(assetsRequest)])
    await done
    if (!draft) return null

    return {
      schemaVersion: SAVED_DRAFT_SCHEMA_VERSION,
      id: draft.id,
      article: await hydrateArticle(draft.article, assets),
      formatting: {
        ...DEFAULT_ARTICLE_FORMATTING,
        ...draft.formatting,
        wechat: normalizeWechatThemeSettings(draft.formatting?.wechat),
      },
      kind: draft.kind === 'image' ? 'image' : 'longform',
      xhsSettings: normalizeXhsCardSettings(draft.xhsSettings),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      deletedAt: draft.deletedAt ?? null,
      sourceInfo: draft.sourceInfo ? { ...draft.sourceInfo } : null,
    }
  }

  async listDrafts(options: DraftListOptions = {}): Promise<DraftSummary[]> {
    const database = await this.openDatabase()
    const transaction = database.transaction(DRAFTS_STORE, 'readonly')
    const done = transactionDone(transaction)
    const request = transaction.objectStore(DRAFTS_STORE).getAll() as IDBRequest<PersistedDraft[]>
    const drafts = await requestResult(request)
    await done

    return drafts
      .filter(draft => options.includeDeleted || !draft.deletedAt)
      .filter(draft => !options.kind || draft.kind === options.kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toDraftSummary)
  }

  async softDeleteDraft(id: string): Promise<PersistedDraft | null> {
    return this.updateDeletionState(id, this.now().toISOString())
  }

  async restoreDraft(id: string): Promise<PersistedDraft | null> {
    return this.updateDeletionState(id, null)
  }

  private async updateDeletionState(id: string, deletedAt: string | null): Promise<PersistedDraft | null> {
    const database = await this.openDatabase()
    const transaction = database.transaction(DRAFTS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(DRAFTS_STORE)
    const draft = await requestResult(store.get(id) as IDBRequest<PersistedDraft | undefined>)
    if (!draft) {
      transaction.abort()
      try {
        await done
      } catch {
        // A missing draft is a normal no-op for this operation.
      }
      return null
    }

    store.put({ ...draft, deletedAt, updatedAt: this.now().toISOString() })
    await done
    return this.getDraft(id)
  }

  async deleteDraft(id: string): Promise<void> {
    const database = await this.openDatabase()
    const transaction = database.transaction([DRAFTS_STORE, ASSETS_STORE], 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(DRAFTS_STORE).delete(id)

    const assets = transaction.objectStore(ASSETS_STORE)
    const assetKeys = await requestResult(assets.index(DRAFT_ID_INDEX).getAllKeys(id))
    assetKeys.forEach(key => assets.delete(key))

    await done
  }

  async putSetting<T>(key: string, value: T): Promise<void> {
    const database = await this.openDatabase()
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(SETTINGS_STORE).put({ key, value } satisfies StoredSetting)
    await done
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const database = await this.openDatabase()
    const transaction = database.transaction(SETTINGS_STORE, 'readonly')
    const done = transactionDone(transaction)
    const record = await requestResult(transaction.objectStore(SETTINGS_STORE).get(key) as IDBRequest<StoredSetting | undefined>)
    await done
    return record?.value as T | undefined
  }

  async deleteSetting(key: string): Promise<void> {
    const database = await this.openDatabase()
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(SETTINGS_STORE).delete(key)
    await done
  }

  async close(): Promise<void> {
    const databasePromise = this.databasePromise
    this.databasePromise = null
    if (!databasePromise) return
    const database = await databasePromise
    database.close()
  }
}

export async function resetLocalDraftDatabase(
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
  factory: IDBFactory = globalThis.indexedDB,
): Promise<void> {
  if (!factory) return
  const request = factory.deleteDatabase(databaseName)
  await requestResult(request)
}
