import JSZip from 'jszip'
import { parse as parseYaml } from 'yaml'
import type { ArticleDraft, ArticleSourceLanguage, SourceKind } from '../domain/article'
import { normalizeObsidianImages, renderMarkdownToSafeHtml, sanitizeContentHtml } from './markdown-compatibility'

const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_ARCHIVE_SOURCE_BYTES = 20 * 1024 * 1024
const MAX_ARCHIVE_FILES = 120
const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_ARCHIVE_TOTAL_BYTES = 30 * 1024 * 1024
const ARTICLE_NAMES = ['article.md', 'article.markdown', 'article.html', 'article.htm']
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

export class FileParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileParseError'
  }
}

interface ParsedSource {
  title: string
  html: string
  markdown?: string
  sourceText: string
  sourceLanguage: ArticleSourceLanguage
  summary?: string
  tags: string[]
  warnings: string[]
  missingAssets: string[]
}

type AssetSource = File | Uint8Array

interface FrontMatter {
  title?: string
  summary?: string
  description?: string
  tags?: string[] | string
}

function sanitizeHtml(html: string): string {
  return sanitizeContentHtml(html)
}

function markMissingImages(html: string, missingAssets: string[]): string {
  if (!missingAssets.length) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  let missingIndex = 0

  document.body.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
    const source = normalizePath(decodeReference(image.getAttribute('src') || ''))
    const reference = missingAssets.find(asset => normalizePath(asset) === source)
    if (!reference) return
    image.dataset.missingAsset = reference
    image.dataset.missingId = `missing-image-${missingIndex}`
    missingIndex += 1
  })

  return sanitizeHtml(document.body.innerHTML)
}

function normalizePath(value: string): string {
  const segments: string[] = []
  for (const segment of value.replaceAll('\\', '/').replace(/^\//, '').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function isUnsafeArchivePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/')
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.split('/').includes('..')
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function mimeFor(name: string): string {
  const ext = extensionOf(name)
  const mime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }
  return mime[ext] ?? 'application/octet-stream'
}

function toDataUri(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

async function assetBytes(source: AssetSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source
  return new Uint8Array(await source.arrayBuffer())
}

function titleFromFile(name: string): string {
  return name.replace(/\.(markdown|md|html?|zip)$/i, '').replaceAll(/[-_]+/g, ' ').trim() || '未命名文章'
}

function splitFrontMatter(markdown: string): { metadata: FrontMatter; body: string; warning?: string } {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) return { metadata: {}, body: markdown }

  try {
    const parsed = parseYaml(match[1])
    const metadata = parsed && typeof parsed === 'object' ? parsed as FrontMatter : {}
    return { metadata, body: markdown.slice(match[0].length) }
  } catch {
    return { metadata: {}, body: markdown.slice(match[0].length), warning: 'YAML 元信息格式有误，已忽略。' }
  }
}

function normalizeTags(tags: FrontMatter['tags']): string[] {
  if (Array.isArray(tags)) return tags.map(String).map(tag => tag.trim()).filter(Boolean)
  if (typeof tags === 'string') return tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
  return []
}

function sourcePathForFile(file: File): string {
  return normalizePath(file.webkitRelativePath || file.name)
}

function decodeReference(value: string): string {
  const trimmed = value.trim().replace(/^<|>$/g, '').replace(/[?#].*$/, '')
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function isExternalAsset(reference: string): boolean {
  return /^(https?:|data:|blob:)/i.test(reference)
}

function findAsset(
  reference: string,
  articlePath: string,
  assets: Map<string, AssetSource>,
): { path?: string; source?: AssetSource; ambiguous?: boolean } {
  const decoded = decodeReference(reference).replaceAll('\\', '/')
  const base = articlePath.includes('/') ? articlePath.slice(0, articlePath.lastIndexOf('/') + 1) : ''
  const exactPaths = [normalizePath(base + decoded), normalizePath(decoded)]

  for (const path of exactPaths) {
    const source = assets.get(path)
    if (source) return { path, source }
  }

  const normalizedReference = normalizePath(decoded).toLowerCase()
  const fileName = normalizedReference.split('/').pop()
  const candidates = [...assets.entries()].filter(([path]) => {
    const normalizedPath = path.toLowerCase()
    return normalizedPath.endsWith(`/${normalizedReference}`)
      || (fileName && normalizedPath.split('/').pop() === fileName)
  })

  if (candidates.length === 1) {
    const [path, source] = candidates[0]
    return { path, source }
  }
  return { ambiguous: candidates.length > 1 }
}

async function assetDataUri(path: string, source: AssetSource): Promise<string> {
  return toDataUri(await assetBytes(source), mimeFor(path))
}

function buildFileAssets(files: File[]): Map<string, AssetSource> {
  const imageFiles = files.filter(file => IMAGE_EXTENSIONS.has(extensionOf(file.name)))
  if (imageFiles.length > MAX_ARCHIVE_FILES) {
    throw new FileParseError(`图片文件数量不能超过 ${MAX_ARCHIVE_FILES} 个。`)
  }
  if (imageFiles.some(file => file.size > MAX_ARCHIVE_ENTRY_BYTES)) {
    throw new FileParseError('存在超过 8 MB 的单张图片。')
  }
  const totalBytes = imageFiles.reduce((total, file) => total + file.size, 0)
  if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
    throw new FileParseError('图片总大小不能超过 30 MB。')
  }

  return new Map(imageFiles.map(file => [sourcePathForFile(file), file]))
}

async function replaceMarkdownAssets(
  markdown: string,
  articlePath: string,
  assets: Map<string, AssetSource>,
  warnings: string[],
): Promise<{ markdown: string; missingAssets: string[] }> {
  const normalizedMarkdown = normalizeObsidianImages(markdown)
  const matches = [...normalizedMarkdown.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)]
  const missingAssets: string[] = []
  let result = normalizedMarkdown

  for (const match of matches) {
    const reference = match[2] || match[3]
    if (isExternalAsset(reference)) continue
    const resolved = findAsset(reference, articlePath, assets)
    if (!resolved.source || !resolved.path) {
      const normalizedReference = decodeReference(reference)
      if (!missingAssets.includes(normalizedReference)) missingAssets.push(normalizedReference)
      warnings.push(resolved.ambiguous ? `图片存在重名，无法确定：${normalizedReference}` : `未找到图片：${normalizedReference}`)
      continue
    }
    const dataUri = await assetDataUri(resolved.path, resolved.source)
    result = result.replace(match[0], `![${match[1]}](${dataUri})`)
  }
  return { markdown: result, missingAssets }
}

async function replaceHtmlAssets(
  html: string,
  articlePath: string,
  assets: Map<string, AssetSource>,
  warnings: string[],
): Promise<{ html: string; missingAssets: string[] }> {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const missingAssets: string[] = []

  for (const image of document.querySelectorAll<HTMLImageElement>('img[src]')) {
    const reference = image.getAttribute('src') ?? ''
    if (isExternalAsset(reference)) continue
    const resolved = findAsset(reference, articlePath, assets)
    if (!resolved.source || !resolved.path) {
      const normalizedReference = decodeReference(reference)
      if (!missingAssets.includes(normalizedReference)) missingAssets.push(normalizedReference)
      warnings.push(resolved.ambiguous ? `图片存在重名，无法确定：${normalizedReference}` : `未找到图片：${normalizedReference}`)
      continue
    }
    image.src = await assetDataUri(resolved.path, resolved.source)
  }

  return { html: document.documentElement.outerHTML, missingAssets }
}

function parseMarkdown(markdown: string, fallbackTitle: string, warnings: string[]): ParsedSource {
  const { metadata, body: rawBody, warning } = splitFrontMatter(markdown)
  if (warning) warnings.push(warning)

  const heading = rawBody.match(/^#\s+(.+)$/m)
  const title = metadata.title?.trim() || heading?.[1]?.trim() || fallbackTitle
  const body = heading && heading[1].trim() === title
    ? rawBody.replace(/^#\s+.+\r?\n+/, '')
    : rawBody
  return {
    title,
    html: renderMarkdownToSafeHtml(body),
    markdown: body,
    sourceText: body,
    sourceLanguage: 'markdown',
    summary: metadata.summary || metadata.description,
    tags: normalizeTags(metadata.tags),
    warnings,
    missingAssets: [],
  }
}

function parseHtml(html: string, fallbackTitle: string, warnings: string[]): ParsedSource {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const title = document.querySelector('h1')?.textContent?.trim()
    || document.querySelector('title')?.textContent?.trim()
    || fallbackTitle
  const summary = document.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')?.content
  const content = document.querySelector('article') || document.querySelector('main') || document.body

  content.querySelectorAll('script, iframe, object, embed, form').forEach(node => node.remove())
  const firstHeading = content.querySelector('h1')
  if (firstHeading?.textContent?.trim() === title) firstHeading.remove()

  const safeHtml = sanitizeHtml(content.innerHTML)
  return {
    title,
    html: safeHtml,
    sourceText: safeHtml,
    sourceLanguage: 'html',
    summary,
    tags: [],
    warnings,
    missingAssets: [],
  }
}

async function parseZip(file: File): Promise<ParsedSource> {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter(entry => !entry.dir)
  if (entries.length > MAX_ARCHIVE_FILES) throw new FileParseError(`ZIP 文件数量不能超过 ${MAX_ARCHIVE_FILES} 个。`)
  if (entries.some(entry => isUnsafeArchivePath(entry.unsafeOriginalName || entry.name))) {
    throw new FileParseError('ZIP 包含不安全的文件路径。')
  }
  const declaredSizes = entries.map(entry => {
    const internalData = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
    return internalData?.uncompressedSize
  })
  if (declaredSizes.some(size => typeof size === 'number' && size > MAX_ARCHIVE_ENTRY_BYTES)) {
    throw new FileParseError('ZIP 中存在解压后超过 8 MB 的单个文件。')
  }
  const declaredTotal = declaredSizes.reduce<number>((total, size) => total + (size || 0), 0)
  if (declaredTotal > MAX_ARCHIVE_TOTAL_BYTES) {
    throw new FileParseError('ZIP 解压后的总大小不能超过 30 MB。')
  }

  const articleEntry = entries.find(entry => ARTICLE_NAMES.includes(normalizePath(entry.name).toLowerCase()))
    || entries.find(entry => /\.(md|markdown|html?)$/i.test(entry.name))
  if (!articleEntry) throw new FileParseError('ZIP 中没有找到 article.md 或 article.html。')

  const assets = new Map<string, AssetSource>()
  let totalBytes = 0
  for (const entry of entries) {
    const bytes = await entry.async('uint8array')
    if (bytes.byteLength > MAX_ARCHIVE_ENTRY_BYTES) throw new FileParseError(`文件 ${entry.name} 超过 8 MB。`)
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) throw new FileParseError('ZIP 解压后的总大小不能超过 30 MB。')
    if (IMAGE_EXTENSIONS.has(extensionOf(entry.name))) assets.set(normalizePath(entry.name), bytes)
  }

  const warnings: string[] = []
  const articleText = await articleEntry.async('text')
  const fallback = titleFromFile(file.name)
  if (/\.(md|markdown)$/i.test(articleEntry.name)) {
    const replaced = await replaceMarkdownAssets(articleText, normalizePath(articleEntry.name), assets, warnings)
    const parsed = parseMarkdown(replaced.markdown, fallback, warnings)
    parsed.missingAssets = replaced.missingAssets
    parsed.html = markMissingImages(parsed.html, replaced.missingAssets)
    return parsed
  }

  const replaced = await replaceHtmlAssets(articleText, normalizePath(articleEntry.name), assets, warnings)
  const parsed = parseHtml(replaced.html, fallback, warnings)
  parsed.missingAssets = replaced.missingAssets
  parsed.html = markMissingImages(parsed.html, replaced.missingAssets)
  return parsed
}

export function pickPrimaryContentFile(files: File[]): File {
  const supported = files.filter(file => ['md', 'markdown', 'html', 'htm', 'zip'].includes(extensionOf(file.name)))
  if (!supported.length) throw new FileParseError('没有找到可导入的 Markdown、HTML 或 ZIP 文件。')
  return supported.find(file => ARTICLE_NAMES.includes(file.name.toLowerCase())) || supported[0]
}

export async function parseContentFile(file: File, relatedFiles: File[] = []): Promise<ArticleDraft> {
  if (extensionOf(file.name) === 'zip' && file.size > MAX_ARCHIVE_SOURCE_BYTES) {
    throw new FileParseError('ZIP 内容包不能超过 20 MB。')
  }
  if (file.size > MAX_SOURCE_BYTES && extensionOf(file.name) !== 'zip') {
    throw new FileParseError('单个文章文件不能超过 5 MB；包含图片时请使用 ZIP 内容包。')
  }

  const extension = extensionOf(file.name)
  let source: ParsedSource
  let sourceKind: SourceKind
  const assets = buildFileAssets(relatedFiles)
  const sourcePath = sourcePathForFile(file)

  if (extension === 'md' || extension === 'markdown') {
    sourceKind = 'markdown'
    const warnings: string[] = []
    const replaced = await replaceMarkdownAssets(await file.text(), sourcePath, assets, warnings)
    source = parseMarkdown(replaced.markdown, titleFromFile(file.name), warnings)
    source.missingAssets = replaced.missingAssets
    source.html = markMissingImages(source.html, replaced.missingAssets)
  } else if (extension === 'html' || extension === 'htm') {
    sourceKind = 'html'
    const warnings: string[] = []
    const replaced = await replaceHtmlAssets(await file.text(), sourcePath, assets, warnings)
    source = parseHtml(replaced.html, titleFromFile(file.name), warnings)
    source.missingAssets = replaced.missingAssets
    source.html = markMissingImages(source.html, replaced.missingAssets)
  } else if (extension === 'zip') {
    sourceKind = 'zip'
    source = await parseZip(file)
  } else {
    throw new FileParseError('暂不支持该格式，请导入 .md、.html 或 .zip。')
  }

  return {
    id: crypto.randomUUID(),
    ...source,
    sourceFile: file.name,
    sourceKind,
    importedAt: new Date().toISOString(),
  }
}

export function sanitizeEditedHtml(html: string): string {
  return sanitizeHtml(html)
}
