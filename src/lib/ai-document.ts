import type { AiChatResult, AiDocumentText } from '../domain/ai-chat'
import { AI_DOCUMENT_LIMIT } from '../domain/ai-chat'
import { lexArticleMarkdown, markdownMathRanges } from './markdown-compatibility'
import { renderArticleSource } from './article-source'

export interface AiDocumentSnapshot extends AiDocumentText {
  apply: (revision: NonNullable<AiChatResult['revision']>) => string | undefined
  preview: (body: string) => string
}
export interface AiDocumentEditor { capture: () => AiDocumentSnapshot }

function structure(body: string, language: AiDocumentText['language']) {
  const document = new DOMParser().parseFromString(renderArticleSource(body, language), 'text/html')
  function elementShape(element: Element): unknown {
    // Formula and code content is immutable, including any nested rendering markup.
    if (element.matches('pre, code, [data-ez-math]')) return element.outerHTML
    return [element.tagName, [...element.attributes].map(attribute => [attribute.name, attribute.value]), [...element.children].map(elementShape)]
  }
  const shape = [...document.body.children].map(elementShape)
  const htmlTags = body.match(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g) ?? []
  const tokens: unknown[] = []
  if (language === 'markdown') {
    const walk = (items: ReturnType<typeof lexArticleMarkdown>) => {
      for (const item of items) {
        if (item.type === 'link' || item.type === 'image' || item.type === 'def') tokens.push([item.type, item.href, item.title])
        if (item.type === 'code' || item.type === 'codespan') tokens.push([item.type, item.raw])
        if ('tokens' in item && Array.isArray(item.tokens)) walk(item.tokens as ReturnType<typeof lexArticleMarkdown>)
        if (item.type === 'list') for (const child of item.items) walk(child.tokens as ReturnType<typeof lexArticleMarkdown>)
        if (item.type === 'table') for (const cell of [...item.header, ...item.rows.flat()]) walk(cell.tokens as ReturnType<typeof lexArticleMarkdown>)
      }
    }
    walk(lexArticleMarkdown(body))
    tokens.push(markdownMathRanges(body).map(range => range.raw))
  }
  // Includes editor-local media references even when the safe renderer omits their protocols.
  const references = body.match(/(?:dispatch-[\w-]+:\/\/|data:|blob:)[^\s<>"')\]]+/g) ?? []
  return JSON.stringify({ shape, htmlTags, tokens, references })
}

export function validateDocumentRevision(original: AiDocumentText, revision: NonNullable<AiChatResult['revision']>) {
  if (typeof revision.title !== 'string' || revision.title.length > 300 || /[\r\n]/.test(revision.title)
    || typeof revision.body !== 'string' || !revision.body.trim() || revision.body.length > AI_DOCUMENT_LIMIT) throw new Error('修改稿不完整或过长，已阻止应用，请重新生成。')
  if (structure(original.body, original.language) !== structure(revision.body, original.language)) {
    throw new Error('修改稿改变了文章结构、链接、媒体、代码或公式，已阻止应用。请要求只润色文字后重试。')
  }
}

export function parseChatResult(text: string, document: AiDocumentText | null): AiChatResult {
  let value: AiChatResult
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')) }
  catch { throw new Error('回复格式不完整，无法应用。请重试，原稿已保留。') }
  if (!value || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 4_000
    || (value.revision !== null && (typeof value.revision !== 'object' || !value.revision))) throw new Error('回复格式无效，请重试。')
  if (value.revision) {
    if (!document) throw new Error('本次未附带全文，不能应用文档修改。')
    validateDocumentRevision(document, value.revision)
  }
  return { reply: value.reply, revision: value.revision }
}

// Display a JSON string as it arrives without ever rendering untrusted HTML or applying partial revisions.
export function streamedChatReply(text: string): string {
  const start = /^\s*\{\s*"reply"\s*:\s*"/.exec(text)
  if (!start) return ''
  let result = ''
  for (let i = start[0].length; i < text.length; i++) {
    const char = text[i]
    if (char === '"') break
    if (char !== '\\') { result += char; continue }
    const escape = text[++i]
    if (escape === undefined) break
    if (escape === 'u') {
      const hex = text.slice(i + 1, i + 5)
      if (!/^[\da-f]{4}$/i.test(hex)) break
      result += String.fromCharCode(parseInt(hex, 16)); i += 4
    } else result += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' } as Record<string, string>)[escape] ?? ''
  }
  return result
}
