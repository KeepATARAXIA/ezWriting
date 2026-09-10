import { describe, expect, it } from 'vitest'
import { parseChatResult, streamedChatReply, validateDocumentRevision } from './ai-document'
import { AI_CHAT_PROMPT_LIMIT, readChatInput } from '../domain/ai-chat'

const original = { title: '原稿', language: 'markdown' as const, body: '## 小标题\n\n这句话非常非常好，参考[资料](./guide.md)。\n\n![示意图](dispatch-editor-image://image-0)\n\n- 要点一\n- 要点二\n\n| 名称 | 数值 |\n| --- | --- |\n| 项目 | 5 |\n\n`const x = 1` 与 $x^2$。' }
const revised = { title: '修改稿', body: original.body.replace('非常非常好', '很好') }
const input = { instruction: '润色全文', document: original, previousRevision: null, history: [], refinements: [] }

describe('article conversation contract', () => {
  it('keeps a full article, prior revision and explicit recent context, excluding unknown fields', () => {
    const parsed = readChatInput(JSON.stringify({ ...input, apiKey: 'secret', history: [{ instruction: '先给建议', reply: '精简重复表达。' }], previousRevision: { ...revised, language: 'markdown' } }))
    expect(parsed.document).toEqual(original)
    expect(parsed.previousRevision?.body).toBe(revised.body)
    expect(JSON.stringify(parsed)).not.toContain('secret')
    expect(parsed.history).toHaveLength(1)
  })
  it('bounds article, request, history and instructions without silently cutting the draft', () => {
    for (const patch of [
      { document: { ...original, body: '文'.repeat(24_001) } },
      { instruction: '文'.repeat(4_001) },
      { history: Array.from({ length: 7 }, () => ({ instruction: '问', reply: '答' })) },
      { document: null, previousRevision: { ...revised, language: 'markdown' } },
    ]) expect(() => readChatInput(JSON.stringify({ ...input, ...patch }))).toThrow()
    expect(() => readChatInput('x'.repeat(AI_CHAT_PROMPT_LIMIT + 1))).toThrow('总长度')
  })
  it('accepts complete changes that preserve links, media, structure, math and code', () => {
    expect(parseChatResult(JSON.stringify({ reply: '已精简重复措辞。', revision: revised }), original).revision).toEqual(revised)
    expect(parseChatResult('{"reply":"建议删去重复表达。","revision":null}', original).revision).toBeNull()
  })
  it.each([
    (body: string) => body.replace('./guide.md', 'https://other.example'),
    (body: string) => body.replace('image-0', 'image-1'),
    (body: string) => body.replace('## 小标题', '### 小标题'),
    (body: string) => body.replace('- 要点二', ''),
    (body: string) => body.replace('const x = 1', 'const x = 2'),
    (body: string) => body.replace('$x^2$', '$x^3$'),
    (body: string) => body + '\n<script>alert(1)</script>',
  ])('rejects structural and protected-content changes', transform => {
    expect(() => validateDocumentRevision(original, { ...revised, body: transform(revised.body) })).toThrow('文章结构')
  })
  it('preserves HTML tags, style attributes and media while allowing text edits', () => {
    const html = { title: 'HTML 稿', language: 'html' as const, body: '<h2>小标题</h2><p style="color: red">原文<a href="../guide">资料</a></p><img src="dispatch-editor-image://image-0" alt="配图">' }
    expect(() => validateDocumentRevision(html, { title: html.title, body: html.body.replace('原文', '改好后的文字') })).not.toThrow()
    expect(() => validateDocumentRevision(html, { title: html.title, body: html.body.replace('color: red', 'color: blue') })).toThrow()
  })
  it('never treats partial or malformed responses as applicable revisions', () => {
    for (const text of ['{"reply":"完成",', '{"reply":"完成"}', '{"reply":"完成","revision":{}}', '{"reply":"完成","revision":{"title":"标题","body":""}}']) {
      expect(() => parseChatResult(text, original)).toThrow()
    }
    expect(() => parseChatResult(JSON.stringify({ reply: '完成', revision: revised }), null)).toThrow('未附带全文')
  })
  it('decodes incremental reply strings without exposing JSON or interpreting HTML', () => {
    expect(streamedChatReply('{"reply":"第一行\\n第二行\\u4f')).toBe('第一行\n第二行')
    expect(streamedChatReply('{"reply":"<script>示例</script>\\u4f60","revision":null}')).toBe('<script>示例</script>你')
    expect(streamedChatReply('{"revision":')).toBe('')
  })
})
