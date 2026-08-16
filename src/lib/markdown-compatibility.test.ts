import { describe, expect, it } from 'vitest'
import { renderMarkdownToSafeHtml } from './markdown-compatibility'

describe('renderMarkdownToSafeHtml', () => {
  it('converts Obsidian callouts into semantic editable containers', () => {
    const html = renderMarkdownToSafeHtml([
      '> [!warning] 先备份，再接入同步',
      '> 第一次配置时，先选一台设备作为主设备。',
      '>',
      '> 复制整个 Vault 文件夹作为备份。',
    ].join('\n'))

    const document = new DOMParser().parseFromString(html, 'text/html')
    const callout = document.querySelector('aside[data-callout="warning"]')

    expect(callout?.getAttribute('data-callout-title')).toBe('先备份，再接入同步')
    expect(callout?.querySelector('[data-callout-title]')?.textContent).toBe('先备份，再接入同步')
    expect(callout?.querySelector('[data-callout-content]')?.textContent).toContain('第一次配置时')
    expect(callout?.querySelectorAll('[data-callout-content] p')).toHaveLength(2)
    expect(html).not.toContain('[!warning]')
  })

  it('normalizes callout aliases and preserves fold state', () => {
    const html = renderMarkdownToSafeHtml('> [!abstract]- 本文摘要\n> 摘要正文')
    const document = new DOMParser().parseFromString(html, 'text/html')
    const callout = document.querySelector('aside')

    expect(callout?.dataset.callout).toBe('summary')
    expect(callout?.dataset.calloutFold).toBe('collapsed')
  })

  it('keeps GFM task lists editable instead of flattening their checkboxes', () => {
    const html = renderMarkdownToSafeHtml('- [x] 已完成\n- [ ] 待处理')
    const document = new DOMParser().parseFromString(html, 'text/html')
    const items = document.querySelectorAll('li[data-type="taskItem"]')

    expect(document.querySelector('ul[data-type="taskList"]')).not.toBeNull()
    expect(items).toHaveLength(2)
    expect(items[0].getAttribute('data-checked')).toBe('true')
    expect(items[1].getAttribute('data-checked')).toBe('false')
    expect(document.querySelector('input')).toBeNull()
  })

  it('supports common Obsidian inline syntax without exposing vault-only markup', () => {
    const html = renderMarkdownToSafeHtml('#### 小标题\n\n==重点==、[[说明页|查看说明]]。%%内部备注%%')

    expect(html).toContain('<h4>小标题</h4>')
    expect(html).toContain('<mark>重点</mark>')
    expect(html).toContain('查看说明')
    expect(html).not.toContain('[[')
    expect(html).not.toContain('内部备注')
  })

  it('sanitizes unsafe HTML embedded in Markdown', () => {
    const html = renderMarkdownToSafeHtml('正文<script>alert(1)</script><img src="x" onerror="alert(2)">')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('preserves extra top-level Markdown blank lines as visible spacers', () => {
    const html = renderMarkdownToSafeHtml('第一段\n\n\n\n第二段')
    const document = new DOMParser().parseFromString(html, 'text/html')

    expect(document.querySelectorAll('[data-source-spacer="true"]')).toHaveLength(2)
    expect(document.querySelector('[data-source-spacer]')?.getAttribute('style')).toContain('height: 1.72em')
    expect(document.body.textContent).toContain('第一段')
    expect(document.body.textContent).toContain('第二段')
  })

  it('keeps one structural blank line invisible and does not alter fenced code spacing', () => {
    const html = renderMarkdownToSafeHtml('第一段\n\n第二段\n\n```text\n第一行\n\n\n第三行\n```')
    const document = new DOMParser().parseFromString(html, 'text/html')

    expect(document.querySelector('[data-source-spacer]')).toBeNull()
    expect(document.querySelector('pre')?.textContent).toContain('第一行\n\n\n第三行')
  })
})
