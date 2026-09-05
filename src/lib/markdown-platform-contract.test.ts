import { describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { applyArticleFormatting } from './article-formatting'
import { renderMarkdownToSafeHtml } from './markdown-compatibility'
import { applyWechatTheme, WECHAT_THEMES } from './wechat-theme'
import { paginateForXhsCards } from './xhs-pagination'

const COMPATIBILITY_MARKDOWN = [
  '## Markdown 兼容性',
  '',
  '正文包含 **粗体**、*斜体*、~~删除线~~、==高亮==、`行内代码`与[链接](https://example.com)。',
  '',
  '截图中的异常写法也应修复：支持** 100 万 Token 上下文**。',
  '',
  '请注意，是**整次请求！**都按高价算；也支持**“带引号的加粗”**紧贴正文。',
  '',
  '- [x] 已完成任务',
  '- [ ] 待处理任务',
  '',
  '> 引用内容',
  '',
  '| 平台 | 状态 |',
  '| --- | --- |',
  '| 小红书 | 正常 |',
  '| 公众号 | 正常 |',
  '',
  '正文脚注[^note]。',
  '',
  ...Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 段分页校准文字：${'所有 Markdown 语义需要在图片分页后保持完整。'.repeat(4)}`),
  '',
  '[^note]: 脚注中的 **重点说明**。',
].join('\n')

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function expectCompatibilitySemantics(document: Document, label: string): void {
  expect(Array.from(document.querySelectorAll('strong')).some(element => element.textContent === '粗体'), label).toBe(true)
  expect(Array.from(document.querySelectorAll('strong')).some(element => element.textContent === '100 万 Token 上下文'), label).toBe(true)
  expect(Array.from(document.querySelectorAll('strong')).some(element => element.textContent === '整次请求！'), label).toBe(true)
  expect(Array.from(document.querySelectorAll('strong')).some(element => element.textContent === '“带引号的加粗”'), label).toBe(true)
  expect(document.querySelector('em')?.textContent, label).toBe('斜体')
  expect(document.querySelector('del')?.textContent, label).toBe('删除线')
  expect(document.querySelector('mark')?.textContent, label).toBe('高亮')
  expect(document.querySelector('code')?.textContent, label).toBe('行内代码')
  expect(document.querySelector('a[href="https://example.com"]')?.textContent, label).toBe('链接')
  expect(document.querySelectorAll('li[data-type="taskItem"]'), label).toHaveLength(2)
  expect(document.querySelector('blockquote')?.textContent, label).toContain('引用内容')
  expect(document.querySelectorAll('table tbody tr'), label).toHaveLength(2)
  expect(document.querySelector('sup[data-footnote-reference]')?.textContent, label).toBe('1')
  expect(document.querySelector('[data-footnote-item] strong')?.textContent, label).toBe('重点说明')
}

describe('Markdown platform compatibility contract', () => {
  const normalized = renderMarkdownToSafeHtml(COMPATIBILITY_MARKDOWN)
  const formatted = applyArticleFormatting(normalized, DEFAULT_ARTICLE_FORMATTING)

  it('keeps the shared Markdown semantics in every WeChat theme', () => {
    WECHAT_THEMES.forEach(theme => {
      const document = parse(applyWechatTheme(formatted, { themeId: theme.id }, DEFAULT_ARTICLE_FORMATTING))
      expectCompatibilitySemantics(document, theme.id)
      expect(document.querySelector<HTMLElement>('em')?.style.fontStyle, theme.id).toBe('italic')
    })
  })

  it('keeps the shared Markdown semantics after Xiaohongshu card pagination', () => {
    const pages = paginateForXhsCards(formatted, { title: 'Markdown 兼容性' })
    const document = parse(pages.join(''))

    expect(pages.length).toBeGreaterThan(1)
    expectCompatibilitySemantics(document, 'xhs')
    expect(Array.from(document.querySelectorAll<HTMLElement>('strong')).every(element => element.style.fontWeight === '800')).toBe(true)
  })
})
