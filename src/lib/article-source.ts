import { marked, type Token } from 'marked'
import type { ArticleDraft, ArticleSourceLanguage } from '../domain/article'
import { renderMarkdownToSafeHtml, sanitizeContentHtml, sanitizeInternalContentHtml } from './markdown-compatibility'

export interface ArticleSource {
  text: string
  language: ArticleSourceLanguage
}

interface SourceBlock {
  from: number
  to: number
  line: number
}

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g
const SOURCE_SPACER_SENTINEL = 'DISPATCH_SOURCE_SPACER'

function markdownInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ')
  if (!(node instanceof HTMLElement)) return ''
  const content = Array.from(node.childNodes).map(markdownInline).join('')
  const tag = node.tagName.toLocaleLowerCase()

  if (tag === 'br') return '\n'
  if (tag === 'strong' || tag === 'b') return content ? `**${content}**` : ''
  if (tag === 'em' || tag === 'i') return content ? `*${content}*` : ''
  if (tag === 'del' || tag === 's' || tag === 'strike') return content ? `~~${content}~~` : ''
  if (tag === 'code') return content ? `\`${content.replaceAll('`', '\\`')}\`` : ''
  if (tag === 'mark') return content ? `==${content}==` : ''
  if (tag === 'a') {
    const href = node.getAttribute('href') || ''
    return href ? `[${content || href}](${href})` : content
  }
  if (tag === 'img') {
    const source = node.getAttribute('src') || ''
    const alt = node.getAttribute('alt') || '图片'
    return source ? `![${alt}](${source})` : `![${alt}]()`
  }
  return content
}

function listItemMarkdown(item: HTMLLIElement, ordered: boolean, index: number, depth: number): string {
  const nestedLists = Array.from(item.children).filter(child => child.matches('ul, ol')) as HTMLElement[]
  const clone = item.cloneNode(true) as HTMLLIElement
  clone.querySelectorAll(':scope > ul, :scope > ol').forEach(list => list.remove())
  const taskPrefix = item.dataset.checked === 'true' ? '[x] ' : item.dataset.checked === 'false' ? '[ ] ' : ''
  const text = markdownBlockChildren(clone).replace(/\n{2,}/g, '\n').trim()
  const prefix = ordered ? `${index + 1}. ` : '- '
  const indent = '  '.repeat(depth)
  const continuation = text.replace(/\n/g, `\n${indent}  `)
  const nested = nestedLists.map(list => markdownList(list, depth + 1)).filter(Boolean).join('\n')
  return `${indent}${prefix}${taskPrefix}${continuation}${nested ? `\n${nested}` : ''}`
}

function markdownList(list: HTMLElement, depth = 0): string {
  const ordered = list.tagName.toLocaleLowerCase() === 'ol'
  return Array.from(list.children)
    .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    .map((item, index) => listItemMarkdown(item, ordered, index, depth))
    .join('\n')
}

function markdownTable(table: HTMLTableElement): string {
  const rows = Array.from(table.rows).map(row => Array.from(row.cells).map(cell => (
    markdownInline(cell).trim().replaceAll('|', '\\|').replace(/\s*\n\s*/g, '<br>')
  )))
  if (!rows.length) return ''
  const width = Math.max(...rows.map(row => row.length))
  const normalized = rows.map(row => [...row, ...Array(Math.max(0, width - row.length)).fill('')])
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(normalized[0]), line(Array(width).fill('---')), ...normalized.slice(1).map(line)].join('\n')
}

function markdownCallout(element: HTMLElement): string {
  const type = element.dataset.callout || 'note'
  const title = element.dataset.calloutTitle
    || element.querySelector<HTMLElement>('[data-callout-title]')?.textContent?.trim()
    || ''
  const contentElement = element.querySelector<HTMLElement>('[data-callout-content]')
  const content = contentElement ? markdownBlockChildren(contentElement).trim() : ''
  const lines = [`> [!${type}]${title ? ` ${title}` : ''}`]
  if (content) lines.push(...content.split('\n').map(line => line ? `> ${line}` : '>'))
  return lines.join('\n')
}

function markdownBlock(element: HTMLElement): string {
  const tag = element.tagName.toLocaleLowerCase()
  if (element.hasAttribute('data-source-spacer')) return SOURCE_SPACER_SENTINEL
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${markdownInline(element).trim()}`
  if (tag === 'p') return markdownInline(element).trim()
  if (tag === 'pre') {
    const code = element.textContent?.replace(/\n$/, '') || ''
    return `\`\`\`\n${code}\n\`\`\``
  }
  if (tag === 'blockquote') {
    return markdownBlockChildren(element).trim().split('\n').map(line => line ? `> ${line}` : '>').join('\n')
  }
  if (tag === 'aside' && element.dataset.callout) return markdownCallout(element)
  if (tag === 'ul' || tag === 'ol') return markdownList(element)
  if (tag === 'table') return markdownTable(element as HTMLTableElement)
  if (tag === 'hr') return '---'
  if (tag === 'img') return markdownInline(element)
  return markdownBlockChildren(element)
}

function markdownBlockChildren(element: HTMLElement): string {
  const parts: string[] = []
  let inlineBuffer = ''
  const flushInline = () => {
    const value = inlineBuffer.trim()
    if (value) parts.push(value)
    inlineBuffer = ''
  }

  Array.from(element.childNodes).forEach(node => {
    if (node instanceof HTMLElement && /^(address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|ul)$/i.test(node.tagName)) {
      flushInline()
      const value = markdownBlock(node).trim()
      if (value) parts.push(value)
    } else {
      inlineBuffer += markdownInline(node)
    }
  })
  flushInline()
  return parts.join('\n\n')
}

export function htmlToReadableMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(sanitizeContentHtml(html), 'text/html')
  const compact = markdownBlockChildren(document.body)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  return compact
    .replace(new RegExp(`(?:\\n\\n${SOURCE_SPACER_SENTINEL})+\\n\\n`, 'g'), match => {
      const count = match.match(new RegExp(SOURCE_SPACER_SENTINEL, 'g'))?.length ?? 0
      return '\n'.repeat(count + 2)
    })
    .trim()
}

function lineAtOffset(text: string, offset: number): number {
  return text.slice(0, Math.max(0, offset)).split(/\r?\n/).length
}

function decodeReference(value: string): string {
  const trimmed = value.trim().replace(/^<|>$/g, '').replace(/[?#].*$/, '')
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function sameReference(left: string, right: string): boolean {
  return decodeReference(left).replaceAll('\\', '/') === decodeReference(right).replaceAll('\\', '/')
}

function markdownBlocks(text: string): SourceBlock[] {
  const tokens = marked.lexer(text, { gfm: true })
  const blocks: SourceBlock[] = []
  let cursor = 0

  tokens.forEach((token: Token) => {
    const raw = 'raw' in token && typeof token.raw === 'string' ? token.raw : ''
    const located = raw ? text.indexOf(raw, cursor) : cursor
    const from = located >= cursor ? located : cursor
    if (token.type !== 'space') blocks.push({ from, to: from + raw.length, line: lineAtOffset(text, from) })
    cursor = Math.max(cursor, from + raw.length)
  })

  return blocks
}

function htmlBlocks(text: string): SourceBlock[] {
  const document = new DOMParser().parseFromString(text, 'text/html')
  const blocks: SourceBlock[] = []
  let cursor = 0

  Array.from(document.body.children).forEach(element => {
    const matcher = new RegExp(`<${element.tagName.toLocaleLowerCase()}(?:\\s|>)`, 'i')
    const relative = text.slice(cursor).search(matcher)
    const from = relative >= 0 ? cursor + relative : cursor
    blocks.push({ from, to: text.length, line: lineAtOffset(text, from) })
    cursor = Math.max(cursor, from + 1)
  })

  blocks.forEach((block, index) => {
    block.to = blocks[index + 1]?.from ?? text.length
  })

  return blocks
}

function sourceBlocks(text: string, language: ArticleSourceLanguage): SourceBlock[] {
  return language === 'markdown' ? markdownBlocks(text) : htmlBlocks(text)
}

export function resolveArticleSource(article: ArticleDraft): ArticleSource {
  if (typeof article.sourceText === 'string') {
    const language = article.sourceLanguage ?? (typeof article.markdown === 'string' ? 'markdown' : 'html')
    return {
      text: language === 'html' ? htmlToReadableMarkdown(article.sourceText) : article.sourceText,
      language: 'markdown',
    }
  }
  if (typeof article.markdown === 'string') return { text: article.markdown, language: 'markdown' }
  return { text: htmlToReadableMarkdown(article.html), language: 'markdown' }
}

export function renderArticleSource(text: string, language: ArticleSourceLanguage): string {
  return language === 'markdown' ? renderMarkdownToSafeHtml(text) : sanitizeContentHtml(text)
}

export function updateArticleFromSource(article: ArticleDraft, text: string): ArticleDraft {
  const language = resolveArticleSource(article).language
  return {
    ...article,
    html: renderArticleSource(text, language),
    markdown: language === 'markdown' ? text : undefined,
    sourceText: text,
    sourceLanguage: language,
  }
}

export function sourceLineForBlock(text: string, language: ArticleSourceLanguage, blockIndex: number): number {
  return sourceBlocks(text, language)[blockIndex]?.line ?? 1
}

function sourceLineNumbers(text: string, block: SourceBlock): number[] {
  const lines: number[] = []
  let offset = block.from

  while (offset < block.to) {
    const lineEnd = text.indexOf('\n', offset)
    const end = lineEnd >= 0 && lineEnd < block.to ? lineEnd : block.to
    const lineText = text.slice(offset, end).replace(/\r$/, '').trim()
    const tableDivider = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(lineText)
    if (lineText && !tableDivider) lines.push(lineAtOffset(text, offset))
    if (lineEnd < 0 || lineEnd >= block.to) break
    offset = lineEnd + 1
  }

  return lines.length ? lines : [block.line]
}

function compactImageDataForAnalysis(text: string): string {
  return text.replace(MARKDOWN_IMAGE, (syntax, _alt: string, angleSource: string, plainSource: string) => {
    const source = angleSource || plainSource || ''
    return /^data:image\//i.test(source) ? syntax.replace(source, 'data:image/embedded') : syntax
  })
}

export function sourceLinesByBlock(text: string, language: ArticleSourceLanguage): number[][] {
  const analysisText = language === 'markdown' ? compactImageDataForAnalysis(text) : text
  return sourceBlocks(analysisText, language).map(block => sourceLineNumbers(analysisText, block))
}

export function sourceLinesForBlock(text: string, language: ArticleSourceLanguage, blockIndex: number): number[] {
  return sourceLinesByBlock(text, language)[blockIndex] ?? []
}

export function sourceBlockIndexAtOffset(text: string, language: ArticleSourceLanguage, offset: number): number | null {
  const blocks = sourceBlocks(text, language)
  if (!blocks.length) return null
  let match = 0
  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].from > offset) break
    match = index
  }
  return match
}

export function annotateLocalImagesAsMissing(html: string): { html: string; references: string[] } {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const references: string[] = []
  let missingIndex = 0

  document.body.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
    const source = image.getAttribute('src') || ''
    if (!source || /^(https?:|data:|blob:)/i.test(source)) return
    const reference = decodeReference(source)
    if (!references.includes(reference)) references.push(reference)
    image.dataset.missingAsset = reference
    image.dataset.missingId = `missing-image-${missingIndex}`
    missingIndex += 1
  })

  return { html: sanitizeInternalContentHtml(document.body.innerHTML), references }
}

export function replaceArticleSourceImage(
  article: ArticleDraft,
  reference: string,
  replacement: string | null,
  replacementAlt?: string,
): ArticleDraft {
  const source = resolveArticleSource(article)

  if (source.language === 'markdown') {
    const nextText = source.text.replace(MARKDOWN_IMAGE, (match, alt: string, angleReference: string, plainReference: string) => {
      const currentReference = angleReference || plainReference || ''
      if (!sameReference(currentReference, reference)) return match
      if (!replacement) return ''
      return `![${replacementAlt || alt}](${replacement})`
    })
    return updateArticleFromSource(article, nextText)
  }

  const document = new DOMParser().parseFromString(source.text, 'text/html')
  document.body.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
    if (!sameReference(image.getAttribute('src') || '', reference)) return
    if (!replacement) image.remove()
    else {
      image.setAttribute('src', replacement)
      if (replacementAlt) image.setAttribute('alt', replacementAlt)
      image.removeAttribute('data-missing-id')
      image.removeAttribute('data-missing-asset')
    }
  })
  return updateArticleFromSource(article, document.body.innerHTML)
}
