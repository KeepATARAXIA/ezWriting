import { describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { applyArticleFormatting } from './article-formatting'
import { renderMarkdownToSafeHtml } from './markdown-compatibility'

describe('applyArticleFormatting', () => {
  it('applies the selected typography and accent to publishable HTML', () => {
    const html = applyArticleFormatting(
      '<h2>小标题</h2><p>正文</p><blockquote>重点</blockquote><a href="https://example.com">链接</a>',
      DEFAULT_ARTICLE_FORMATTING,
    )
    const document = new DOMParser().parseFromString(html, 'text/html')

    expect(document.querySelector('p')?.style.fontSize).toBe('17px')
    expect(document.querySelector('p')?.style.lineHeight).toBe('1.9')
    expect(document.querySelector('h2')?.style.borderLeftColor).toBe('rgb(22, 72, 255)')
    expect(document.querySelector('blockquote')?.style.borderLeftColor).toBe('rgb(22, 72, 255)')
    expect(document.querySelector('a')?.style.color).toBe('rgb(22, 72, 255)')
  })

  it('gives semantic strong text an explicit publishable weight', () => {
    const html = applyArticleFormatting(
      '<p style="font-weight:400">普通正文 <strong>0.15 美元</strong> 与 <b>0.50 美元</b></p>',
      DEFAULT_ARTICLE_FORMATTING,
    )
    const document = new DOMParser().parseFromString(html, 'text/html')

    expect(document.querySelector<HTMLElement>('p')?.style.fontWeight).toBe('')
    expect(document.querySelector<HTMLElement>('strong')?.style.fontWeight).toBe('800')
    expect(document.querySelector<HTMLElement>('b')?.style.fontWeight).toBe('800')
  })

  it('keeps image dimensions responsive for platform previews and drafts', () => {
    const html = applyArticleFormatting(
      '<img src="data:image/png;base64,AAAA" alt="配图">',
      { ...DEFAULT_ARTICLE_FORMATTING, theme: 'wechat', accent: 'green' },
    )
    const image = new DOMParser().parseFromString(html, 'text/html').querySelector('img')

    expect(image?.style.maxWidth).toBe('100%')
    expect(image?.style.height).toBe('auto')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('turns callouts and task lists into static platform-safe blocks', () => {
    const html = applyArticleFormatting(
      '<h4>准备工作</h4><aside data-callout="warning" data-callout-title="先备份"><div data-callout-title>先备份</div><div data-callout-content><p>复制 Vault。</p></div></aside><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>已备份</p></div></li></ul>',
      DEFAULT_ARTICLE_FORMATTING,
    )
    const document = new DOMParser().parseFromString(html, 'text/html')
    const callout = document.querySelector<HTMLElement>('aside[data-callout="warning"]')
    const task = document.querySelector<HTMLElement>('li[data-checked="true"]')

    expect(document.querySelector<HTMLElement>('h4')?.style.fontSize).toBe('17px')
    expect(callout?.style.borderLeftColor).toBe('rgb(234, 106, 32)')
    expect(callout?.querySelector('[data-callout-title]')?.textContent).toContain('先备份')
    expect(task?.textContent).toContain('☑')
    expect(task?.querySelector('input')).toBeNull()
    expect(task?.querySelector<HTMLElement>(':scope > div')?.style.textDecoration).toBe('line-through')
  })

  it('restores task markers after Markdown normalization so content stays in the wide grid column', () => {
    const normalizedHtml = renderMarkdownToSafeHtml([
      '- [x] 已完成：导入文档。',
      '- [ ] 待检查：Markdown 样式。',
      '- [ ] 待检查：小红书分页和图片布局。',
    ].join('\n'))
    const html = applyArticleFormatting(normalizedHtml, DEFAULT_ARTICLE_FORMATTING)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const tasks = Array.from(document.querySelectorAll<HTMLElement>('li[data-type="taskItem"]'))

    expect(tasks).toHaveLength(3)
    expect(tasks.map(task => task.querySelector<HTMLElement>(':scope > [data-ez-task-marker]')?.textContent)).toEqual(['☑', '☐', '☐'])
    expect(tasks.every(task => task.firstElementChild?.hasAttribute('data-ez-task-marker'))).toBe(true)
    expect(tasks.every(task => task.children[1]?.tagName === 'DIV')).toBe(true)
    expect(tasks.every(task => task.style.gridTemplateColumns === '1.4em minmax(0, 1fr)')).toBe(true)
    expect(document.querySelector('input')).toBeNull()

    const reapplied = new DOMParser().parseFromString(
      applyArticleFormatting(html, DEFAULT_ARTICLE_FORMATTING),
      'text/html',
    )
    expect(reapplied.querySelectorAll('[data-ez-task-marker]')).toHaveLength(3)
  })

  it('inlines resilient code, link, mark, and table styles for platform drafts', () => {
    const html = applyArticleFormatting(
      '<pre><code class="language-bash">bash &lt;(curl -fsSL https://example.com/install.sh)</code></pre><p><code>Ctrl+Shift+V</code> <a href="https://example.com">docs</a> <mark>important</mark> <del>old</del></p><table><thead><tr><th>Command</th></tr></thead><tbody><tr><td>install</td></tr></tbody></table>',
      DEFAULT_ARTICLE_FORMATTING,
    )
    const document = new DOMParser().parseFromString(html, 'text/html')
    const pre = document.querySelector<HTMLElement>('pre')
    const blockCode = pre?.querySelector<HTMLElement>('code')
    const inlineCode = document.querySelector<HTMLElement>('p code')

    expect(pre?.style.backgroundColor).toBe('rgb(17, 24, 32)')
    expect(pre?.style.whiteSpace).toBe('pre-wrap')
    expect(pre?.style.overflowX).toBe('hidden')
    expect(blockCode?.style.whiteSpace).toBe('inherit')
    expect(inlineCode?.style.backgroundColor).toBe('rgb(243, 245, 247)')
    expect(inlineCode?.style.wordBreak).toBe('break-word')
    expect(document.querySelector<HTMLElement>('a')?.style.textDecoration).toBe('underline')
    expect(document.querySelector<HTMLElement>('mark')?.style.backgroundColor).toBe('rgb(255, 241, 168)')
    expect(document.querySelector<HTMLElement>('del')?.style.color).toBe('rgb(119, 129, 139)')
    expect(document.querySelector<HTMLTableElement>('table')?.style.borderCollapse).toBe('collapse')
    expect(document.querySelector<HTMLElement>('th')?.style.backgroundColor).toBe('rgb(245, 247, 249)')
  })

  it('uses stable glyph icons instead of font-dependent hand-drawn circles in callouts', () => {
    const html = applyArticleFormatting(
      '<aside data-callout="summary"><div data-callout-title>Overview</div><div data-callout-content><p>Body</p></div></aside>',
      DEFAULT_ARTICLE_FORMATTING,
    )
    const document = new DOMParser().parseFromString(html, 'text/html')
    const icon = document.querySelector<HTMLElement>('aside [data-callout-title] > span')

    expect(icon?.textContent).toBe('ⓘ')
    expect(icon?.style.display).toBe('inline-block')
    expect(icon?.style.lineHeight).toBe('1.2em')
    expect(icon?.style.border).toBe('')
  })
})
