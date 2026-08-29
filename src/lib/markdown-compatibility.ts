import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { isLocalVideoReference, localVideoBlob } from './local-video-registry'
import { isSupportedVideoDataUri, localVideoFileName, supportedVideoDataMimeType } from './video-assets'

export const MARKDOWN_CALLOUT_TYPES = [
  'note',
  'summary',
  'info',
  'tip',
  'success',
  'question',
  'warning',
  'failure',
  'danger',
  'bug',
  'example',
  'quote',
] as const

export type MarkdownCalloutType = typeof MARKDOWN_CALLOUT_TYPES[number]

export interface MarkdownCalloutDefinition {
  label: string
  icon: string
  accent: string
  background: string
  border: string
}

export const MARKDOWN_CALLOUT_DEFINITIONS: Record<MarkdownCalloutType, MarkdownCalloutDefinition> = {
  note: { label: '注意', icon: 'ⓘ', accent: '#2563eb', background: '#eff6ff', border: '#bfdbfe' },
  summary: { label: '摘要', icon: 'ⓘ', accent: '#0891b2', background: '#ecfeff', border: '#a5f3fc' },
  info: { label: '信息', icon: 'ⓘ', accent: '#0284c7', background: '#f0f9ff', border: '#bae6fd' },
  tip: { label: '提示', icon: '✦', accent: '#0f9f6e', background: '#ecfdf5', border: '#a7f3d0' },
  success: { label: '完成', icon: '✓', accent: '#16a34a', background: '#f0fdf4', border: '#bbf7d0' },
  question: { label: '问题', icon: '?', accent: '#7c3aed', background: '#f5f3ff', border: '#ddd6fe' },
  warning: { label: '警告', icon: '⚠', accent: '#ea6a20', background: '#fff7ed', border: '#fed7aa' },
  failure: { label: '失败', icon: '×', accent: '#dc2626', background: '#fef2f2', border: '#fecaca' },
  danger: { label: '危险', icon: '⚠', accent: '#dc2626', background: '#fff1f2', border: '#fecdd3' },
  bug: { label: '问题', icon: '◆', accent: '#e11d48', background: '#fff1f2', border: '#fecdd3' },
  example: { label: '示例', icon: '◇', accent: '#7c3aed', background: '#f5f3ff', border: '#ddd6fe' },
  quote: { label: '引用', icon: '“', accent: '#64748b', background: '#f8fafc', border: '#cbd5e1' },
}

const CALLOUT_ALIASES: Record<string, MarkdownCalloutType> = {
  abstract: 'summary',
  tldr: 'summary',
  todo: 'info',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

// Content semantics only. Preview actions and other application control attributes must never enter imported HTML.
const SAFE_CONTENT_DATA_ATTRIBUTES = [
  'data-callout',
  'data-callout-content',
  'data-callout-fold',
  'data-callout-title',
  'data-checked',
  'data-ez-format',
  'data-ez-task-marker',
  'data-ez-video-name',
  'data-footnote-content',
  'data-footnote-item',
  'data-footnote-number',
  'data-footnote-reference',
  'data-source-spacer',
  'data-type',
]

const INTERNAL_MISSING_ASSET_DATA_ATTRIBUTES = [
  'data-missing-asset',
  'data-missing-id',
]

const FORBIDDEN_CONTENT_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'base',
  'link',
  'meta',
  'audio',
  'source',
  'track',
  'input',
  'button',
  'select',
  'textarea',
]

const FORBIDDEN_CONTENT_ATTRIBUTES = [
  'srcdoc',
  'srcset',
  'background',
  'poster',
  'autoplay',
  'preload',
  'ping',
  'action',
  'formaction',
]

const MARKDOWN_EMBEDDED_IMAGE_SOURCE = /!\[[^\]\n]*\]\(\s*(?:<(data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+)>|(data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+))(?:\s+(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))?\s*\)/gi
const HTML_EMBEDDED_VIDEO_SOURCE = /(<video\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi

interface EmbeddedVideoSource {
  placeholder: string
  source: string
}

function compactHtmlEmbeddedVideos(html: string): { html: string; videos: EmbeddedVideoSource[] } {
  const videos: EmbeddedVideoSource[] = []
  const compacted = html.replace(HTML_EMBEDDED_VIDEO_SOURCE, (syntax, prefix: string, quote: string, source: string) => {
    const localBlob = isLocalVideoReference(source) ? localVideoBlob(source) : null
    const localMimeType = localBlob?.type.toLocaleLowerCase()
    const mimeType = supportedVideoDataMimeType(source)
      ?? (localMimeType === 'video/mp4' || localMimeType === 'video/webm' ? localMimeType : null)
    if (!mimeType) return syntax
    const placeholder = `data:${mimeType};base64,${btoa(`ezwriting-video-${videos.length}`)}`
    videos.push({ placeholder, source })
    return `${prefix}${quote}${placeholder}${quote}`
  })
  return { html: compacted, videos }
}

function restoreHtmlEmbeddedVideos(html: string, videos: EmbeddedVideoSource[]): string {
  return videos.reduce((restored, video) => restored.replaceAll(video.placeholder, video.source), html)
}

// Keep article typography and box formatting, but exclude page-level positioning, stacking, and transforms.
const SAFE_INLINE_STYLE_PROPERTIES = new Set([
  '-webkit-box-decoration-break',
  'align-items',
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'box-decoration-break',
  'box-sizing',
  'clear',
  'color',
  'column-gap',
  'display',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'gap',
  'grid-template-columns',
  'height',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-position',
  'list-style-type',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'object-fit',
  'opacity',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'row-gap',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-indent',
  'text-overflow',
  'text-transform',
  'text-underline-offset',
  'vertical-align',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
])

const NETWORK_CAPABLE_CSS_VALUE = /(?:url|image-set|cross-fade)\s*\(|(?:expression|javascript)\s*:|(?:https?|data|blob):/i

function normalizeCssValueForSecurityCheck(value: string): string {
  const withoutCommentsOrContinuations = value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
  return withoutCommentsOrContinuations.replace(
    /\\([0-9a-f]{1,6})\s?|\\([^\r\n\f])/gi,
    (_match, hexadecimal: string | undefined, escaped: string | undefined) => {
      if (!hexadecimal) return escaped || ''
      const codePoint = Number.parseInt(hexadecimal, 16)
      return codePoint === 0 || codePoint > 0x10ffff ? '\uFFFD' : String.fromCodePoint(codePoint)
    },
  )
}

function filterInlineStyles(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')

  document.body.querySelectorAll<HTMLElement>('[style]').forEach(element => {
    const declarations = Array.from({ length: element.style.length }, (_, index) => element.style.item(index))
    const safeDeclarations: Array<{ property: string; value: string; priority: string }> = []
    declarations.forEach(property => {
      const value = element.style.getPropertyValue(property)
      if (!SAFE_INLINE_STYLE_PROPERTIES.has(property.toLocaleLowerCase())) return
      if (NETWORK_CAPABLE_CSS_VALUE.test(normalizeCssValueForSecurityCheck(value))) return
      safeDeclarations.push({ property, value, priority: element.style.getPropertyPriority(property) })
    })
    element.removeAttribute('style')
    safeDeclarations.forEach(({ property, value, priority }) => element.style.setProperty(property, value, priority))
    if (!safeDeclarations.length) element.removeAttribute('style')
  })

  return document.body.innerHTML
}

function filterLocalVideos(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.body.querySelectorAll<HTMLVideoElement>('video').forEach(video => {
    const source = video.getAttribute('src') || ''
    if (!isSupportedVideoDataUri(source)) {
      video.remove()
      return
    }
    video.controls = true
    video.autoplay = false
    video.removeAttribute('autoplay')
    video.removeAttribute('poster')
    video.setAttribute('preload', 'metadata')
    const name = localVideoFileName(video.dataset.ezVideoName || '本地视频')
    video.dataset.ezVideoName = name
    if (!video.getAttribute('aria-label')) video.setAttribute('aria-label', `视频：${name}`)
  })
  return document.body.innerHTML
}

export function normalizeMarkdownCalloutType(value: string): MarkdownCalloutType {
  const normalized = value.trim().toLocaleLowerCase()
  if ((MARKDOWN_CALLOUT_TYPES as readonly string[]).includes(normalized)) {
    return normalized as MarkdownCalloutType
  }
  return CALLOUT_ALIASES[normalized] || 'note'
}

function sanitizeContentHtmlWithAttributes(html: string, additionalAttributes: string[]): string {
  const embeddedVideos = compactHtmlEmbeddedVideos(html)
  const sanitized = DOMPurify.sanitize(embeddedVideos.html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_CONTENT_TAGS,
    FORBID_ATTR: FORBIDDEN_CONTENT_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: [...SAFE_CONTENT_DATA_ATTRIBUTES, ...additionalAttributes],
  })
  const filtered = filterLocalVideos(filterInlineStyles(sanitized))
  return restoreHtmlEmbeddedVideos(filtered, embeddedVideos.videos)
}

export function sanitizeContentHtml(html: string): string {
  return sanitizeContentHtmlWithAttributes(html, [])
}

// Only app-generated or revalidated missing-image state may use this internal boundary.
export function sanitizeInternalContentHtml(html: string): string {
  return sanitizeContentHtmlWithAttributes(html, INTERNAL_MISSING_ASSET_DATA_ATTRIBUTES)
}

export function normalizeObsidianImages(markdown: string): string {
  return markdown.replace(/!\[\[([^\]\n]+)\]\]/g, (_match, rawReference: string) => {
    const reference = rawReference.split('|')[0].trim()
    const alt = reference.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '图片'
    return `![${alt}](<${reference}>)`
  })
}

export function normalizeMarkdownStrongWhitespace(markdown: string): string {
  let fencedCodeMarker: string | null = null

  return markdown
    .split('\n')
    .map(line => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/)
      if (fence) {
        const marker = fence[1]
        if (!fencedCodeMarker) {
          fencedCodeMarker = marker
        } else if (marker[0] === fencedCodeMarker[0] && marker.length >= fencedCodeMarker.length) {
          fencedCodeMarker = null
        }
        return line
      }

      if (fencedCodeMarker) return line

      return line
        .split(/(`+[^`\n]*?`+)/g)
        .map(segment => segment.startsWith('`')
          ? segment
          : segment.replace(
              /(^|[^\\*])\*\*([ \t]*)([^*\n]*?\S)([ \t]*)\*\*([ \t]*)(?!\*)/g,
              (
                _match,
                prefix: string,
                openingSpace: string,
                content: string,
                closingSpace: string,
                outerSpace: string,
              ) => {
                const leadingSpace = openingSpace && prefix && !/[ \t]$/.test(prefix) ? openingSpace : ''
                return `${prefix}${leadingSpace}**${content}**${outerSpace || closingSpace}`
              },
            ))
        .join('')
    })
    .join('\n')
}

interface MarkdownFootnoteDefinition {
  key: string
  markdown: string
}

interface MarkdownFootnoteReference {
  definition: MarkdownFootnoteDefinition
  number: number
  referenceIds: string[]
}

function normalizeFootnoteKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function indentedFootnoteLine(line: string): string | null {
  const match = line.match(/^(?: {4}|\t)(.*)$/)
  return match ? match[1] : null
}

function extractMarkdownFootnotes(markdown: string): {
  body: string
  definitions: Map<string, MarkdownFootnoteDefinition>
} {
  const lines = markdown.split(/\r?\n/)
  const bodyLines: string[] = []
  const definitions = new Map<string, MarkdownFootnoteDefinition>()
  let fence: { character: string; length: number } | null = null
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { character: marker[0], length: marker.length }
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null
      bodyLines.push(line)
      index += 1
      continue
    }

    const definitionMatch = !fence
      ? line.match(/^ {0,3}\[\^([^\]\r\n]+)\]:[ \t]*(.*)$/)
      : null
    if (!definitionMatch) {
      bodyLines.push(line)
      index += 1
      continue
    }

    const key = normalizeFootnoteKey(definitionMatch[1])
    if (!key) {
      bodyLines.push(line)
      index += 1
      continue
    }
    const contentLines = [definitionMatch[2]]
    let nextIndex = index + 1
    while (nextIndex < lines.length) {
      const continuation = indentedFootnoteLine(lines[nextIndex])
      if (continuation !== null) {
        contentLines.push(continuation)
        nextIndex += 1
        continue
      }
      if (!lines[nextIndex].trim() && indentedFootnoteLine(lines[nextIndex + 1] || '') !== null) {
        contentLines.push('')
        nextIndex += 1
        continue
      }
      break
    }

    if (!definitions.has(key)) {
      definitions.set(key, { key, markdown: contentLines.join('\n').trim() })
    }
    const previousLine = bodyLines.at(-1)
    const nextLine = lines[nextIndex]
    if (previousLine?.trim() && nextLine?.trim() && !/^ {0,3}\[\^([^\]\r\n]+)\]:/.test(nextLine)) {
      bodyLines.push('')
    }
    index = nextIndex
  }

  return { body: bodyLines.join('\n'), definitions }
}

function injectMarkdownFootnoteReferences(
  markdown: string,
  definitions: Map<string, MarkdownFootnoteDefinition>,
): { markdown: string; references: Map<string, MarkdownFootnoteReference> } {
  const references = new Map<string, MarkdownFootnoteReference>()
  let fencedCodeMarker: string | null = null

  const rendered = markdown
    .split('\n')
    .map(line => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/)
      if (fence) {
        const marker = fence[1]
        if (!fencedCodeMarker) fencedCodeMarker = marker
        else if (marker[0] === fencedCodeMarker[0] && marker.length >= fencedCodeMarker.length) fencedCodeMarker = null
        return line
      }
      if (fencedCodeMarker) return line

      return line
        .split(/(`+[^`\n]*?`+)/g)
        .map(segment => {
          if (segment.startsWith('`')) return segment
          return segment.replace(/(\\*)\[\^([^\]\n]+)\]/g, (match, slashes: string, rawKey: string) => {
            if (slashes.length % 2 === 1) return match
            const key = normalizeFootnoteKey(rawKey)
            const definition = definitions.get(key)
            if (!definition) return match

            let reference = references.get(key)
            if (!reference) {
              reference = { definition, number: references.size + 1, referenceIds: [] }
              references.set(key, reference)
            }
            const occurrence = reference.referenceIds.length + 1
            const referenceId = occurrence === 1
              ? `ez-footnote-ref-${reference.number}`
              : `ez-footnote-ref-${reference.number}-${occurrence}`
            reference.referenceIds.push(referenceId)
            return `${slashes}<sup data-footnote-reference="${reference.number}" id="${referenceId}"><a href="#ez-footnote-${reference.number}" aria-label="跳转到脚注 ${reference.number}">${reference.number}</a></sup>`
          })
        })
        .join('')
    })
    .join('\n')

  return { markdown: rendered, references }
}

function appendMarkdownFootnotes(
  document: Document,
  references: Map<string, MarkdownFootnoteReference>,
): void {
  references.forEach(reference => {
    const item = document.createElement('div')
    item.dataset.footnoteItem = 'true'
    item.id = `ez-footnote-${reference.number}`

    const number = document.createElement('span')
    number.dataset.footnoteNumber = 'true'
    number.textContent = `${reference.number}.`

    const content = document.createElement('div')
    content.dataset.footnoteContent = 'true'
    content.innerHTML = String(marked.parseInline(reference.definition.markdown, { gfm: true, breaks: false }))
    reference.referenceIds.forEach((referenceId, index) => {
      const backlink = document.createElement('a')
      backlink.className = 'ez-footnote-backref'
      backlink.setAttribute('href', `#${referenceId}`)
      backlink.setAttribute('aria-label', `返回脚注引用 ${reference.number}${reference.referenceIds.length > 1 ? `-${index + 1}` : ''}`)
      backlink.textContent = '↩'
      content.append(' ', backlink)
    })

    item.append(number, content)
    document.body.append(item)
  })
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]<>#])/g, '\\$1')
}

function normalizeObsidianInlineSyntax(markdown: string): string {
  return markdown
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/(?<!!)\[\[([^\]\n]+)\]\]/g, (_match, rawReference: string) => {
      const [reference, alias] = rawReference.split('|')
      const label = (alias || reference).split('#').pop()?.trim() || reference.trim()
      return escapeMarkdownText(label)
    })
}

function separateCalloutMarker(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const result: string[] = []

  lines.forEach((line, index) => {
    result.push(line)
    const marker = line.match(/^(\s*(?:>\s*)+)\[![a-z0-9-]+\][+-]?(?:\s+.*)?$/i)
    if (!marker) return

    const nextLine = lines[index + 1]
    if (!nextLine || !nextLine.startsWith(marker[1]) || nextLine.trim() === marker[1].trim()) return
    result.push(marker[1].trimEnd())
  })

  return result.join('\n')
}

const SOURCE_SPACER_HTML = '<div data-source-spacer="true" style="height: 1.72em; min-height: 1.72em; display: block" aria-hidden="true"></div>'

function preserveMarkdownBlankLines(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const result: string[] = []
  let fence: { character: string; length: number } | null = null
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { character: marker[0], length: marker.length }
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null
      result.push(line)
      index += 1
      continue
    }

    if (fence || line.trim()) {
      result.push(line)
      index += 1
      continue
    }

    let end = index
    while (end < lines.length && !lines[end].trim()) end += 1
    const blankLineCount = end - index
    const isBetweenBlocks = index > 0 && end < lines.length
    result.push('')
    if (isBetweenBlocks) {
      for (let extra = 1; extra < blankLineCount; extra += 1) {
        result.push(SOURCE_SPACER_HTML, '')
      }
    } else {
      result.push(...Array(Math.max(0, blankLineCount - 1)).fill(''))
    }
    index = end
  }

  return result.join('\n')
}

function convertTaskLists(document: Document): void {
  document.body.querySelectorAll<HTMLUListElement>('ul').forEach(list => {
    const directItems = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    const isTaskList = directItems.some(item => item.querySelector(':scope > input[type="checkbox"]'))
    if (isTaskList) list.dataset.type = 'taskList'
    list.classList.remove('contains-task-list')
  })

  document.body.querySelectorAll<HTMLLIElement>('ul[data-type="taskList"] > li').forEach(item => {
    const checkbox = item.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]')
    item.dataset.type = 'taskItem'
    item.dataset.checked = checkbox?.checked ? 'true' : 'false'
    item.classList.remove('task-list-item')
    checkbox?.remove()

    const content = document.createElement('div')
    const inlineNodes: ChildNode[] = []
    while (item.firstChild) {
      const child = item.firstChild
      if (child instanceof HTMLUListElement || child instanceof HTMLOListElement) {
        if (inlineNodes.length) {
          const paragraph = document.createElement('p')
          paragraph.append(...inlineNodes.splice(0))
          content.append(paragraph)
        }
        content.append(child)
      } else if (child instanceof HTMLParagraphElement) {
        if (inlineNodes.length) {
          const paragraph = document.createElement('p')
          paragraph.append(...inlineNodes.splice(0))
          content.append(paragraph)
        }
        content.append(child)
      } else {
        item.removeChild(child)
        inlineNodes.push(child)
      }
    }
    if (inlineNodes.length || !content.childNodes.length) {
      const paragraph = document.createElement('p')
      paragraph.append(...inlineNodes)
      content.prepend(paragraph)
    }
    item.append(content)
  })
}

function convertCallouts(document: Document): void {
  const blockquotes = Array.from(document.body.querySelectorAll('blockquote')).reverse()

  blockquotes.forEach(blockquote => {
    const marker = blockquote.firstElementChild
    if (!(marker instanceof HTMLParagraphElement)) return
    const match = marker.textContent?.trim().match(/^\[!([a-z0-9-]+)\]([+-])?\s*(.*)$/i)
    if (!match) return

    const type = normalizeMarkdownCalloutType(match[1])
    const title = match[3].trim() || MARKDOWN_CALLOUT_DEFINITIONS[type].label
    const callout = document.createElement('aside')
    callout.dataset.callout = type
    callout.dataset.calloutTitle = title
    if (match[2]) callout.dataset.calloutFold = match[2] === '-' ? 'collapsed' : 'expanded'

    const heading = document.createElement('div')
    heading.dataset.calloutTitle = ''
    heading.textContent = title

    const content = document.createElement('div')
    content.dataset.calloutContent = ''
    marker.remove()
    while (blockquote.firstChild) content.append(blockquote.firstChild)
    if (!content.childNodes.length) content.append(document.createElement('p'))

    callout.append(heading, content)
    blockquote.replaceWith(callout)
  })
}

function compactMarkdownEmbeddedImages(markdown: string): { markdown: string; images: Array<{ placeholder: string; source: string }> } {
  let placeholderBase = 'https://embedded-image.invalid/'
  while (markdown.includes(placeholderBase)) placeholderBase = `${placeholderBase}safe/`
  const images: Array<{ placeholder: string; source: string }> = []
  const compacted = markdown.replace(MARKDOWN_EMBEDDED_IMAGE_SOURCE, (syntax, angleSource: string, plainSource: string) => {
    const source = angleSource || plainSource || ''
    const placeholder = `${placeholderBase}${images.length}`
    images.push({ placeholder, source })
    return syntax.replace(source, placeholder)
  })
  return { markdown: compacted, images }
}

function restoreMarkdownEmbeddedImages(html: string, images: Array<{ placeholder: string; source: string }>): string {
  const sources = new Map(images.map(image => [image.placeholder, image.source]))
  return html.replace(
    /https:\/\/embedded-image\.invalid\/(?:safe\/)*\d+/g,
    placeholder => sources.get(placeholder) ?? placeholder,
  )
}

function convertStandaloneImageCaptions(document: Document): void {
  Array.from(document.body.querySelectorAll<HTMLParagraphElement>('p')).forEach(paragraph => {
    const image = paragraph.querySelector<HTMLImageElement>(':scope > img[title]')
    const caption = image?.getAttribute('title')?.trim()
    if (!image || !caption) return
    const containsOnlyImage = Array.from(paragraph.childNodes).every(node => (
      node === image || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())
    ))
    if (!containsOnlyImage) return

    const figure = document.createElement('figure')
    figure.className = 'article-image-figure'
    figure.style.cssText = 'margin: 1.5em auto; text-align: center;'
    const figcaption = document.createElement('figcaption')
    figcaption.className = 'article-image-caption'
    figcaption.style.cssText = 'margin-top: 0.55em; color: #65707d; font-size: 0.86em; line-height: 1.55; text-align: center;'
    figcaption.textContent = caption
    image.removeAttribute('title')
    figure.append(image, figcaption)
    paragraph.replaceWith(figure)
  })
}

export function renderMarkdownToSafeHtml(markdown: string): string {
  const embeddedVideos = compactHtmlEmbeddedVideos(markdown)
  const embeddedImages = compactMarkdownEmbeddedImages(embeddedVideos.html)
  const syntaxNormalized = separateCalloutMarker(
    normalizeObsidianInlineSyntax(normalizeObsidianImages(normalizeMarkdownStrongWhitespace(embeddedImages.markdown))),
  )
  const extracted = extractMarkdownFootnotes(syntaxNormalized)
  const footnotes = injectMarkdownFootnoteReferences(extracted.body, extracted.definitions)
  const normalized = preserveMarkdownBlankLines(footnotes.markdown)
  const parsed = String(marked.parse(normalized, { gfm: true, breaks: true }))
  const document = new DOMParser().parseFromString(parsed, 'text/html')

  appendMarkdownFootnotes(document, footnotes.references)
  convertTaskLists(document)
  convertCallouts(document)
  convertStandaloneImageCaptions(document)

  return restoreHtmlEmbeddedVideos(
    restoreMarkdownEmbeddedImages(sanitizeContentHtml(document.body.innerHTML), embeddedImages.images),
    embeddedVideos.videos,
  )
}
