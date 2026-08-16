import DOMPurify from 'dompurify'
import { marked } from 'marked'

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

export function normalizeMarkdownCalloutType(value: string): MarkdownCalloutType {
  const normalized = value.trim().toLocaleLowerCase()
  if ((MARKDOWN_CALLOUT_TYPES as readonly string[]).includes(normalized)) {
    return normalized as MarkdownCalloutType
  }
  return CALLOUT_ALIASES[normalized] || 'note'
}

export function sanitizeContentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['srcdoc'],
  })
}

export function normalizeObsidianImages(markdown: string): string {
  return markdown.replace(/!\[\[([^\]\n]+)\]\]/g, (_match, rawReference: string) => {
    const reference = rawReference.split('|')[0].trim()
    const alt = reference.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '图片'
    return `![${alt}](<${reference}>)`
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

export function renderMarkdownToSafeHtml(markdown: string): string {
  const normalized = preserveMarkdownBlankLines(separateCalloutMarker(
    normalizeObsidianInlineSyntax(normalizeObsidianImages(markdown)),
  ))
  const parsed = String(marked.parse(normalized, { gfm: true, breaks: false }))
  const document = new DOMParser().parseFromString(parsed, 'text/html')

  convertTaskLists(document)
  convertCallouts(document)

  return sanitizeContentHtml(document.body.innerHTML)
}
