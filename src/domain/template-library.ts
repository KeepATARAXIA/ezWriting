import type { ArticleSourceLanguage } from './article'

export type LibraryContent =
  | { kind: 'text'; content: string; language: ArticleSourceLanguage }
  | { kind: 'image'; blob: Blob }

export type LibraryItem = LibraryContent & {
  id: string
  title: string
  category: string
  updatedAt: string
  revision: number
}

export interface LibraryInsertRequest {
  requestId: number
  item: LibraryItem
}

export function newLibraryItem(content: LibraryContent): LibraryItem {
  return { ...content, id: crypto.randomUUID(), title: '', category: '', updatedAt: '', revision: 0 }
}

export function validateLibraryItem(item: LibraryItem): LibraryItem {
  const title = item.title.trim()
  const category = item.category.trim()
  if (!title || title.length > 120) throw new Error('请填写 1–120 字的素材名称。')
  if (category.length > 40) throw new Error('分类名称不能超过 40 字。')
  if (item.kind === 'text') {
    if (!item.content.trim()) throw new Error('模板内容不能为空。')
    if (item.content.length > 64_000) throw new Error('单个文字模板不能超过 64,000 字。')
    if (/(?:blob:|dispatch-(?:editor-image|editor-video|local-video|asset):\/\/)/i.test(item.content)) {
      throw new Error('选中内容含当前稿件的临时媒体引用，请只收藏文字；图片可在素材库单独上传。')
    }
  } else {
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(item.blob.type)) throw new Error('不支持这种图片格式。')
    if (!item.blob.size || item.blob.size > 8 * 1024 * 1024) throw new Error('图片不能为空，单张不能超过 8 MB。')
  }
  return { ...item, title, category }
}
