import { validateLibraryItem, type LibraryItem } from '../domain/template-library'

export const TEMPLATE_LIBRARY_DATABASE = 'ezwriting-template-library'

// A separate local collection keeps reusable originals independent of draft deletion.
// Each operation closes its connection; writes compare revisions inside one transaction.
export class TemplateLibraryRepository {
  constructor(private readonly databaseName = TEMPLATE_LIBRARY_DATABASE) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('当前浏览器无法使用本地素材存储。')); return }
      const request = indexedDB.open(this.databaseName, 1)
      let blocked = false
      request.onupgradeneeded = () => { request.result.createObjectStore('items', { keyPath: 'id' }) }
      request.onerror = () => reject(request.error)
      request.onblocked = () => { blocked = true; reject(new Error('请关闭其他打开素材库的标签页后重试。')) }
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    })
  }

  async list(): Promise<LibraryItem[]> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('items', 'readonly')
      const request = transaction.objectStore('items').getAll()
      transaction.oncomplete = () => {
        db.close()
        resolve((request.result as LibraryItem[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      }
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('素材库读取失败。')) }
    })
  }

  async save(items: LibraryItem[]): Promise<void> {
    const normalized = items.map(validateLibraryItem)
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('不能重复保存同一素材。')
    await this.mutate(normalized, false)
  }

  async remove(item: LibraryItem): Promise<void> {
    await this.mutate([item], true)
  }

  private async mutate(items: LibraryItem[], remove: boolean): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('items', 'readwrite')
      const store = transaction.objectStore('items')
      let failure: Error | null = null
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => { db.close(); reject(failure || transaction.error || new Error('素材保存失败，请检查浏览器存储空间。')) }
      const request = store.getAll()
      request.onsuccess = () => {
        try {
          const current = new Map((request.result as LibraryItem[]).map(item => [item.id, item]))
          for (const item of items) {
            if ((current.get(item.id)?.revision ?? 0) !== item.revision) {
              throw new Error('素材已在其他窗口更新或删除，请关闭编辑表单并刷新列表后重试。')
            }
            if (remove) current.delete(item.id)
            else current.set(item.id, { ...item, revision: item.revision + 1, updatedAt: new Date().toISOString() })
          }
          if (current.size > 500) throw new Error('素材库最多保存 500 项，请先整理已有素材。')
          const bytes = [...current.values()].reduce((total, item) => total + (item.kind === 'image' ? item.blob.size : item.content.length * 2), 0)
          if (bytes > 128 * 1024 * 1024) throw new Error('素材库已达到 128 MB，请先整理已有素材。')
          for (const item of items) {
            if (remove) store.delete(item.id)
            else store.put(current.get(item.id)!)
          }
        } catch (error) {
          failure = error as Error
          transaction.abort()
        }
      }
    })
  }
}
