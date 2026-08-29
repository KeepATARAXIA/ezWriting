import type JSZip from 'jszip'
import type { ArticleDraft, ArticleSourceLanguage, SourceKind } from '../domain/article'
import {
  normalizeMarkdownStrongWhitespace,
  normalizeObsidianImages,
  renderMarkdownToSafeHtml,
  sanitizeContentHtml,
  sanitizeInternalContentHtml,
} from './markdown-compatibility'

const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_ARCHIVE_SOURCE_BYTES = 20 * 1024 * 1024
const MAX_ARCHIVE_FILES = 120
const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_ARCHIVE_TOTAL_BYTES = 30 * 1024 * 1024
const ARTICLE_NAMES = ['article.md', 'article.markdown', 'article.html', 'article.htm']
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22
const ZIP_MAX_COMMENT_BYTES = 0xffff

export type ImportOperation = 'initial' | 'append' | 'replace' | 'asset-supplement'
export type ImportStage = 'validate' | 'read' | 'archive' | 'assets' | 'render'

export interface ImportDiagnostic {
  version: 1
  recordedAt: string
  outcome: 'success' | 'error'
  operation: ImportOperation
  source: {
    kind: Exclude<SourceKind, 'blank'> | 'unsupported'
    bytes: number
    relatedFileCount: number
    relatedBytes: number
    relatedImageCount: number
  }
  totalMs: number
  stageMs: Partial<Record<ImportStage, number>>
  warningCount: number
  missingAssetCount: number
  errorCode?: 'invalid-input' | 'parse-failed'
}

export interface ParseContentFileOptions {
  operation?: ImportOperation
  onDiagnostic?: (diagnostic: ImportDiagnostic) => void
}

interface ImportTimer {
  measure<T>(stage: ImportStage, action: () => Promise<T>): Promise<T>
  measureSync<T>(stage: ImportStage, action: () => T): T
  snapshot(): Partial<Record<ImportStage, number>>
}

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

interface TextAssetReplacement {
  start: number
  end: number
  value: string
  missingAsset?: string
  warning?: string
}

interface ZipUint8ArrayStream {
  on(event: 'data', callback: (chunk: Uint8Array) => void): this
  on(event: 'end', callback: () => void): this
  on(event: 'error', callback: (error: Error) => void): this
  pause(): this
  resume(): this
}

interface StreamableZipEntry extends JSZip.JSZipObject {
  internalStream(type: 'uint8array'): ZipUint8ArrayStream
}

interface ArchiveReadBudget {
  totalBytes: number
}

interface FrontMatter {
  title?: string
  summary?: string
  description?: string
  tags?: string[] | string
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function roundedMilliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100
}

function createImportTimer(): ImportTimer {
  const stageMs: Partial<Record<ImportStage, number>> = {}
  const addDuration = (stage: ImportStage, startedAt: number) => {
    stageMs[stage] = roundedMilliseconds((stageMs[stage] || 0) + monotonicNow() - startedAt)
  }

  return {
    async measure(stage, action) {
      const startedAt = monotonicNow()
      try {
        return await action()
      } finally {
        addDuration(stage, startedAt)
      }
    },
    measureSync(stage, action) {
      const startedAt = monotonicNow()
      try {
        return action()
      } finally {
        addDuration(stage, startedAt)
      }
    },
    snapshot: () => ({ ...stageMs }),
  }
}

function diagnosticSourceKind(extension: string): ImportDiagnostic['source']['kind'] {
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'zip') return 'zip'
  return 'unsupported'
}

function emitImportDiagnostic(options: ParseContentFileOptions, diagnostic: ImportDiagnostic): void {
  try {
    options.onDiagnostic?.(diagnostic)
  } catch {
    // Diagnostics must never interrupt the import path.
  }
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

  return sanitizeInternalContentHtml(document.body.innerHTML)
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

function validateZipCentralDirectory(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const searchStart = Math.max(0, bytes.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES - ZIP_MAX_COMMENT_BYTES)
  let endOffset = -1

  for (let offset = bytes.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue
    const commentBytes = view.getUint16(offset + 20, true)
    if (offset + ZIP_END_OF_CENTRAL_DIRECTORY_BYTES + commentBytes !== bytes.byteLength) continue
    endOffset = offset
    break
  }

  if (endOffset < 0) throw new FileParseError('ZIP 文件结构无效。')

  const diskNumber = view.getUint16(endOffset + 4, true)
  const centralDirectoryDisk = view.getUint16(endOffset + 6, true)
  const diskEntryCount = view.getUint16(endOffset + 8, true)
  const totalEntryCount = view.getUint16(endOffset + 10, true)
  const centralDirectoryBytes = view.getUint32(endOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== totalEntryCount) {
    throw new FileParseError('暂不支持分卷 ZIP 文件。')
  }
  if (totalEntryCount === 0xffff || centralDirectoryBytes === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new FileParseError('ZIP 文件条目数量或目录大小超出支持范围。')
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes
  if (centralDirectoryEnd > endOffset || centralDirectoryOffset > bytes.byteLength) {
    throw new FileParseError('ZIP 文件结构无效。')
  }

  const decoder = new TextDecoder()
  const paths = new Set<string>()
  let fileCount = 0
  let offset = centralDirectoryOffset

  for (let entryIndex = 0; entryIndex < totalEntryCount; entryIndex += 1) {
    if (offset + 46 > centralDirectoryEnd || view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new FileParseError('ZIP 文件结构无效。')
    }

    const nameBytes = view.getUint16(offset + 28, true)
    const extraBytes = view.getUint16(offset + 30, true)
    const commentBytes = view.getUint16(offset + 32, true)
    const entryEnd = offset + 46 + nameBytes + extraBytes + commentBytes
    if (entryEnd > centralDirectoryEnd) throw new FileParseError('ZIP 文件结构无效。')

    const rawPath = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameBytes))
    const isDirectory = rawPath.endsWith('/') || rawPath.endsWith('\\')
    if (!isDirectory) {
      fileCount += 1
      if (fileCount > MAX_ARCHIVE_FILES) {
        throw new FileParseError(`ZIP 文件数量不能超过 ${MAX_ARCHIVE_FILES} 个。`)
      }
      if (isUnsafeArchivePath(rawPath)) throw new FileParseError('ZIP 包含不安全的文件路径。')

      const normalizedPath = normalizePath(rawPath)
      if (!normalizedPath) throw new FileParseError('ZIP 包含无效的文件路径。')
      if (paths.has(normalizedPath)) throw new FileParseError(`ZIP 包含重复的文件路径：${normalizedPath}`)
      paths.add(normalizedPath)
    }

    offset = entryEnd
  }

  if (offset !== centralDirectoryEnd) throw new FileParseError('ZIP 文件结构无效。')
}

function readZipEntryBytes(entry: JSZip.JSZipObject, budget: ArchiveReadBudget): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    const stream = (entry as StreamableZipEntry).internalStream('uint8array')
    let entryBytes = 0
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      chunks.length = 0
      stream.pause()
      reject(error)
    }

    stream
      .on('data', chunk => {
        if (settled) return
        const nextEntryBytes = entryBytes + chunk.byteLength
        if (nextEntryBytes > MAX_ARCHIVE_ENTRY_BYTES) {
          fail(new FileParseError(`文件 ${entry.name} 超过 8 MB。`))
          return
        }
        if (budget.totalBytes + nextEntryBytes > MAX_ARCHIVE_TOTAL_BYTES) {
          fail(new FileParseError('ZIP 解压后的总大小不能超过 30 MB。'))
          return
        }
        chunks.push(chunk)
        entryBytes = nextEntryBytes
      })
      .on('error', error => fail(error))
      .on('end', () => {
        if (settled) return
        settled = true
        const bytes = new Uint8Array(entryBytes)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        chunks.length = 0
        budget.totalBytes += entryBytes
        resolve(bytes)
      })
      .resume()
  })
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

async function splitFrontMatter(markdown: string): Promise<{ metadata: FrontMatter; body: string; warning?: string }> {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) return { metadata: {}, body: markdown }

  try {
    const { parse: parseYaml } = await import('yaml')
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

export function validateImageResourceFiles(files: File[]): File[] {
  if (files.some(file => !IMAGE_EXTENSIONS.has(extensionOf(file.name)))) {
    throw new FileParseError('图片资源仅支持 PNG、JPG、JPEG、GIF、WebP 或 SVG 格式。')
  }
  if (files.length > MAX_ARCHIVE_FILES) {
    throw new FileParseError(`图片文件数量不能超过 ${MAX_ARCHIVE_FILES} 个。`)
  }
  if (files.some(file => file.size > MAX_ARCHIVE_ENTRY_BYTES)) {
    throw new FileParseError('存在超过 8 MB 的单张图片。')
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  if (totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
    throw new FileParseError('图片总大小不能超过 30 MB。')
  }

  return files
}

export function selectImageResourceFiles(files: File[]): File[] {
  const imageFiles = files.filter(file => IMAGE_EXTENSIONS.has(extensionOf(file.name)))
  if (!imageFiles.length) {
    throw new FileParseError('所选内容中没有找到支持的图片文件（PNG、JPG、JPEG、GIF、WebP 或 SVG）。')
  }

  return validateImageResourceFiles(imageFiles)
}

function buildFileAssets(files: File[]): Map<string, AssetSource> {
  const imageFiles = validateImageResourceFiles(files.filter(file => IMAGE_EXTENSIONS.has(extensionOf(file.name))))

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
  const dataUriCache = new Map<string, Promise<string>>()
  const replacements = await Promise.all(matches.map(async (match): Promise<TextAssetReplacement> => {
    const reference = match[2] || match[3]
    const start = match.index ?? 0
    const unchanged: TextAssetReplacement = { start, end: start + match[0].length, value: match[0] }
    if (isExternalAsset(reference)) return unchanged
    const resolved = findAsset(reference, articlePath, assets)
    if (!resolved.source || !resolved.path) {
      const normalizedReference = decodeReference(reference)
      return {
        ...unchanged,
        missingAsset: normalizedReference,
        warning: resolved.ambiguous
          ? `图片存在重名，无法确定：${normalizedReference}`
          : `未找到图片：${normalizedReference}`,
      }
    }
    let dataUri = dataUriCache.get(resolved.path)
    if (!dataUri) {
      dataUri = assetDataUri(resolved.path, resolved.source)
      dataUriCache.set(resolved.path, dataUri)
    }
    return { ...unchanged, value: `![${match[1]}](${await dataUri})` }
  }))

  const parts: string[] = []
  let cursor = 0
  for (const replacement of replacements) {
    parts.push(normalizedMarkdown.slice(cursor, replacement.start), replacement.value)
    cursor = replacement.end
    if (!replacement.missingAsset) continue
    if (!missingAssets.includes(replacement.missingAsset)) missingAssets.push(replacement.missingAsset)
    if (replacement.warning) warnings.push(replacement.warning)
  }
  parts.push(normalizedMarkdown.slice(cursor))
  return { markdown: parts.join(''), missingAssets }
}

async function replaceHtmlAssets(
  html: string,
  articlePath: string,
  assets: Map<string, AssetSource>,
  warnings: string[],
): Promise<{ html: string; missingAssets: string[] }> {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const missingAssets: string[] = []
  const dataUriCache = new Map<string, Promise<string>>()
  const images = [...document.querySelectorAll<HTMLImageElement>('img[src]')]
  const replacements = await Promise.all(images.map(async image => {
    const reference = image.getAttribute('src') ?? ''
    if (isExternalAsset(reference)) return { image }
    const resolved = findAsset(reference, articlePath, assets)
    if (!resolved.source || !resolved.path) {
      const normalizedReference = decodeReference(reference)
      return {
        image,
        missingAsset: normalizedReference,
        warning: resolved.ambiguous
          ? `图片存在重名，无法确定：${normalizedReference}`
          : `未找到图片：${normalizedReference}`,
      }
    }
    let dataUri = dataUriCache.get(resolved.path)
    if (!dataUri) {
      dataUri = assetDataUri(resolved.path, resolved.source)
      dataUriCache.set(resolved.path, dataUri)
    }
    return { image, dataUri: await dataUri }
  }))

  for (const replacement of replacements) {
    if (replacement.dataUri) replacement.image.src = replacement.dataUri
    if (!replacement.missingAsset) continue
    if (!missingAssets.includes(replacement.missingAsset)) missingAssets.push(replacement.missingAsset)
    if (replacement.warning) warnings.push(replacement.warning)
  }

  return { html: document.documentElement.outerHTML, missingAssets }
}

async function parseMarkdown(markdown: string, fallbackTitle: string, warnings: string[]): Promise<ParsedSource> {
  const { metadata, body: rawBody, warning } = await splitFrontMatter(markdown)
  if (warning) warnings.push(warning)

  const normalizedBody = normalizeMarkdownStrongWhitespace(rawBody)
  const heading = normalizedBody.match(/^#\s+(.+)$/m)
  const title = metadata.title?.trim() || heading?.[1]?.trim() || fallbackTitle
  const body = heading && heading[1].trim() === title
    ? normalizedBody.replace(/^#\s+.+\r?\n+/, '')
    : normalizedBody
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

async function parseZip(file: File, timer: ImportTimer): Promise<ParsedSource> {
  const archiveBytes = await timer.measure('archive', () => file.arrayBuffer())
  timer.measureSync('validate', () => validateZipCentralDirectory(new Uint8Array(archiveBytes)))
  const { default: JSZip } = await import('jszip')
  const zip = await timer.measure('archive', () => JSZip.loadAsync(archiveBytes))
  const entries = Object.values(zip.files).filter(entry => !entry.dir)
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
  const readBudget: ArchiveReadBudget = { totalBytes: 0 }
  let fileCount = 0
  let articleBytes: Uint8Array | undefined
  for (const entry of entries) {
    fileCount += 1
    if (fileCount > MAX_ARCHIVE_FILES) throw new FileParseError(`ZIP 文件数量不能超过 ${MAX_ARCHIVE_FILES} 个。`)
    const bytes = await timer.measure('archive', () => readZipEntryBytes(entry, readBudget))
    if (entry === articleEntry) articleBytes = bytes
    if (IMAGE_EXTENSIONS.has(extensionOf(entry.name))) assets.set(normalizePath(entry.name), bytes)
  }

  const warnings: string[] = []
  if (!articleBytes) throw new FileParseError('ZIP 中的文章文件读取失败。')
  const articleText = timer.measureSync('read', () => new TextDecoder().decode(articleBytes))
  const fallback = titleFromFile(file.name)
  if (/\.(md|markdown)$/i.test(articleEntry.name)) {
    const replaced = await timer.measure('assets', () => replaceMarkdownAssets(articleText, normalizePath(articleEntry.name), assets, warnings))
    const parsed = await timer.measure('render', async () => {
      const next = await parseMarkdown(replaced.markdown, fallback, warnings)
      next.missingAssets = replaced.missingAssets
      next.html = markMissingImages(next.html, replaced.missingAssets)
      return next
    })
    return parsed
  }

  const replaced = await timer.measure('assets', () => replaceHtmlAssets(articleText, normalizePath(articleEntry.name), assets, warnings))
  const parsed = timer.measureSync('render', () => {
    const next = parseHtml(replaced.html, fallback, warnings)
    next.missingAssets = replaced.missingAssets
    next.html = markMissingImages(next.html, replaced.missingAssets)
    return next
  })
  return parsed
}

export function pickPrimaryContentFile(files: File[]): File {
  const supported = files.filter(file => ['md', 'markdown', 'html', 'htm', 'zip'].includes(extensionOf(file.name)))
  if (!supported.length) throw new FileParseError('没有找到可导入的 Markdown、HTML 或 ZIP 文件。')
  return supported.find(file => ARTICLE_NAMES.includes(file.name.toLowerCase())) || supported[0]
}

export async function parseContentFile(
  file: File,
  relatedFiles: File[] = [],
  options: ParseContentFileOptions = {},
): Promise<ArticleDraft> {
  const startedAt = monotonicNow()
  const extension = extensionOf(file.name)
  const timer = createImportTimer()
  const diagnosticBase = {
    version: 1 as const,
    operation: options.operation || 'initial',
    source: {
      kind: diagnosticSourceKind(extension),
      bytes: file.size,
      relatedFileCount: relatedFiles.length,
      relatedBytes: relatedFiles.reduce((total, related) => total + related.size, 0),
      relatedImageCount: relatedFiles.filter(related => IMAGE_EXTENSIONS.has(extensionOf(related.name))).length,
    },
  }

  try {
    const { assets, sourcePath } = timer.measureSync('validate', () => {
      if (file.size === 0) {
        throw new FileParseError('文章文件为空，请选择包含正文的文件。')
      }
      if (extension === 'zip' && file.size > MAX_ARCHIVE_SOURCE_BYTES) {
        throw new FileParseError('ZIP 内容包不能超过 20 MB。')
      }
      if (file.size > MAX_SOURCE_BYTES && extension !== 'zip') {
        throw new FileParseError('单个文章文件不能超过 5 MB；包含图片时请使用 ZIP 内容包。')
      }
      if (!['md', 'markdown', 'html', 'htm', 'zip'].includes(extension)) {
        throw new FileParseError('暂不支持该格式，请导入 .md、.html 或 .zip。')
      }
      return {
        assets: extension === 'zip' ? new Map<string, AssetSource>() : buildFileAssets(relatedFiles),
        sourcePath: sourcePathForFile(file),
      }
    })

    let source: ParsedSource
    let sourceKind: Exclude<SourceKind, 'blank'>

    if (extension === 'md' || extension === 'markdown') {
      sourceKind = 'markdown'
      const warnings: string[] = []
      const text = await timer.measure('read', () => file.text())
      const replaced = await timer.measure('assets', () => replaceMarkdownAssets(text, sourcePath, assets, warnings))
      source = await timer.measure('render', async () => {
        const next = await parseMarkdown(replaced.markdown, titleFromFile(file.name), warnings)
        next.missingAssets = replaced.missingAssets
        next.html = markMissingImages(next.html, replaced.missingAssets)
        return next
      })
    } else if (extension === 'html' || extension === 'htm') {
      sourceKind = 'html'
      const warnings: string[] = []
      const text = await timer.measure('read', () => file.text())
      const replaced = await timer.measure('assets', () => replaceHtmlAssets(text, sourcePath, assets, warnings))
      source = timer.measureSync('render', () => {
        const next = parseHtml(replaced.html, titleFromFile(file.name), warnings)
        next.missingAssets = replaced.missingAssets
        next.html = markMissingImages(next.html, replaced.missingAssets)
        return next
      })
    } else {
      sourceKind = 'zip'
      source = await parseZip(file, timer)
    }

    const article = {
      id: crypto.randomUUID(),
      ...source,
      sourceFile: file.name,
      sourceKind,
      importedAt: new Date().toISOString(),
    }
    emitImportDiagnostic(options, {
      ...diagnosticBase,
      recordedAt: new Date().toISOString(),
      outcome: 'success',
      totalMs: roundedMilliseconds(monotonicNow() - startedAt),
      stageMs: timer.snapshot(),
      warningCount: source.warnings.length,
      missingAssetCount: source.missingAssets.length,
    })
    return article
  } catch (error) {
    emitImportDiagnostic(options, {
      ...diagnosticBase,
      recordedAt: new Date().toISOString(),
      outcome: 'error',
      totalMs: roundedMilliseconds(monotonicNow() - startedAt),
      stageMs: timer.snapshot(),
      warningCount: 0,
      missingAssetCount: 0,
      errorCode: error instanceof FileParseError ? 'invalid-input' : 'parse-failed',
    })
    throw error
  }
}

export function sanitizeEditedHtml(html: string): string {
  return sanitizeInternalContentHtml(html)
}
