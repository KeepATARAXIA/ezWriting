import type { ArticleSourceLanguage } from '../domain/article'
import type { LibraryContent } from '../domain/template-library'
import { htmlToReadableMarkdown } from './article-source'
import { renderMarkdownToSafeHtml, sanitizeContentHtml } from './markdown-compatibility'
import { validateImageResourceFiles } from './file-parser'

export function libraryTextForEditor(item: Extract<LibraryContent, { kind: 'text' }>, language: ArticleSourceLanguage): string {
  if (language === 'html') return item.language === 'html' ? sanitizeContentHtml(item.content) : renderMarkdownToSafeHtml(item.content)
  return item.language === 'html' ? htmlToReadableMarkdown(item.content) : item.content
}

export async function prepareLibraryImages(files: File[]): Promise<Blob[]> {
  validateImageResourceFiles(files)
  const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
  const blobs: Blob[] = []
  // Decode sequentially to avoid loading an entire batch of large images at once.
  for (const file of files) {
    const blob = file.slice(0, file.size, mime[file.name.split('.').at(-1)!.toLowerCase()])
    const url = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty image')
      blobs.push(blob)
    } catch {
      throw new Error(`“${file.name}”无法读取为图片，请检查文件是否损坏。`)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return blobs
}
