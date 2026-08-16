import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { RichTextEditor } from './rich-text-editor'

describe('RichTextEditor keyboard and selection tools', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const selectionRect = new DOMRect(24, 24, 120, 22)
    Range.prototype.getClientRects = () => [selectionRect] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => selectionRect
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    container = document.createElement('div')
    container.className = 'paper-panel'
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <RichTextEditor
          content="<p>第一段测试文字</p>"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          onChange={vi.fn()}
          onFormattingChange={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    await new Promise(resolve => window.setTimeout(resolve, 0))
    container.remove()
    document.querySelectorAll('.selection-bubble-menu').forEach(element => element.remove())
    vi.restoreAllMocks()
  })

  it('opens editor panels with Word-style link and find shortcuts', async () => {
    const editor = container.querySelector<HTMLElement>('.article-editor')!

    const findEvent = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => editor.dispatchEvent(findEvent))
    expect(findEvent.defaultPrevented).toBe(true)
    expect(container.querySelector('[role="search"]')).not.toBeNull()
    expect(document.activeElement).toBe(container.querySelector('.search-panel input'))

    const linkEvent = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => editor.dispatchEvent(linkEvent))
    expect(linkEvent.defaultPrevented).toBe(true)
    expect(container.querySelector('[role="search"]')).toBeNull()
    expect(container.querySelector('[role="dialog"][aria-label="插入链接"]')).not.toBeNull()
    expect(document.activeElement).toBe(container.querySelector('input[aria-label="链接地址"]'))
  })

  it('keeps undo and redo history on the standard Word shortcuts', async () => {
    const editor = container.querySelector<HTMLElement>('.article-editor')!
    const headingButton = container.querySelector<HTMLButtonElement>('button[aria-label="二级标题"]')!

    await act(async () => headingButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(editor.querySelector('h2')).not.toBeNull()

    await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })))
    expect(editor.querySelector('h2')).toBeNull()
    expect(editor.querySelector('p')).not.toBeNull()

    await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })))
    expect(editor.querySelector('h2')).not.toBeNull()
  })

  it('shows the compact formatting menu for a non-empty text selection', async () => {
    const editor = container.querySelector<HTMLElement>('.article-editor')!
    const textNode = editor.querySelector('p')?.firstChild
    expect(textNode).not.toBeNull()

    editor.focus()
    const range = document.createRange()
    range.setStart(textNode!, 0)
    range.setEnd(textNode!, 3)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const menu = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="选中文字快捷排版"]')
    expect(menu).not.toBeNull()
    const boldButton = menu?.querySelector<HTMLButtonElement>('button[aria-label="加粗"]')
    expect(boldButton).not.toBeNull()
    expect(menu?.querySelector('button[aria-label="清除格式"]')).not.toBeNull()
    expect(menu?.querySelector('button[aria-label="插入本地图片"]')).toBeNull()

    await act(async () => boldButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(editor.querySelector('strong')?.textContent).toBe('第一段')
  })

  it('does not take over browser shortcuts outside the editor', () => {
    const outsideInput = document.createElement('input')
    document.body.appendChild(outsideInput)
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    outsideInput.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(container.querySelector('[role="search"]')).toBeNull()
    outsideInput.remove()
  })

  it('locates the exact requested block, centers it, and applies the temporary highlight', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    await act(async () => {
      root.render(
        <RichTextEditor
          content="<p>第一段内容</p><p>第二段需要定位</p><p>第三段内容</p>"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          focusRequest={{ blockIndex: 1, requestId: 1 }}
          onChange={vi.fn()}
          onFormattingChange={vi.fn()}
        />,
      )
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const located = container.querySelector<HTMLElement>('.article-editor .editor-located-target')
    expect(located?.textContent).toBe('第二段需要定位')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(document.activeElement).toBe(container.querySelector('.article-editor'))
  })

  it('reports the top-level block containing the current editor selection', async () => {
    const onActiveBlockChange = vi.fn()
    await act(async () => {
      root.render(
        <RichTextEditor
          content="<p>First block</p><p>Second block</p><p>Third block</p>"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          onChange={vi.fn()}
          onActiveBlockChange={onActiveBlockChange}
          onFormattingChange={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const editor = container.querySelector<HTMLElement>('.article-editor')!
    const textNode = editor.querySelectorAll('p')[1]?.firstChild
    expect(textNode).not.toBeNull()
    editor.focus()
    const range = document.createRange()
    range.setStart(textNode!, 3)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
      await Promise.resolve()
    })

    expect(onActiveBlockChange).toHaveBeenLastCalledWith(1)
  })

  it('renders unresolved images as actionable cards instead of broken images', async () => {
    const onMissingImageAction = vi.fn()
    await act(async () => {
      root.render(
        <RichTextEditor
          content={'<img src="assets/flow.png" alt="流程图" data-missing-id="missing-image-0" data-missing-asset="assets/flow.png">'}
          formatting={DEFAULT_ARTICLE_FORMATTING}
          onChange={vi.fn()}
          onFormattingChange={vi.fn()}
          onMissingImageAction={onMissingImageAction}
        />,
      )
      await Promise.resolve()
    })

    expect(container.querySelector('.editor-missing-image-card')).not.toBeNull()
    expect(container.querySelector('.article-editor img[src="assets/flow.png"]')).toBeNull()
    const replaceButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.editor-missing-image-card button'))
      .find(button => button.textContent?.includes('替换图片'))!
    await act(async () => replaceButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(onMissingImageAction).toHaveBeenCalledWith(
      { id: 'missing-image-0', reference: 'assets/flow.png' },
      'replace',
    )
  })

  it('renders imported Obsidian callouts as editable semantic cards', async () => {
    await act(async () => {
      root.render(
        <RichTextEditor
          content={'<aside data-callout="warning" data-callout-title="先备份"><div data-callout-title>先备份</div><div data-callout-content><p>复制 Vault 后再同步。</p></div></aside>'}
          formatting={DEFAULT_ARTICLE_FORMATTING}
          onChange={vi.fn()}
          onFormattingChange={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const callout = container.querySelector<HTMLElement>('.editor-callout[data-callout="warning"]')
    expect(callout).not.toBeNull()
    expect(callout?.querySelector<HTMLInputElement>('input')?.value).toBe('先备份')
    expect(callout?.querySelector('.editor-callout-content')?.textContent).toContain('复制 Vault 后再同步。')
    expect(container.querySelector('.article-editor')?.textContent).not.toContain('[!warning]')
  })

  it('converts pasted Markdown callouts and task lists inside the editor', async () => {
    const editor = container.querySelector<HTMLElement>('.article-editor')!
    editor.focus()
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: (type: string) => type === 'text/plain'
          ? '> [!tip] 推荐设置\n> 先完成备份。\n\n- [x] 已备份\n- [ ] 开始同步'
          : '',
      },
    })

    await act(async () => editor.dispatchEvent(pasteEvent))

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(container.querySelector('.editor-callout[data-callout="tip"]')).not.toBeNull()
    expect(editor.innerHTML).toContain('data-type="taskList"')
    expect(container.querySelectorAll('ul[data-type="taskList"] li[data-checked]')).toHaveLength(2)
    expect(container.querySelector<HTMLInputElement>('li[data-checked="true"] input')?.checked).toBe(true)
  })

  it('turns an Obsidian callout shortcut into a card when Enter is pressed', async () => {
    await act(async () => {
      root.render(
        <RichTextEditor
          content="<blockquote><p>[!warning] 操作前备份</p></blockquote>"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          onChange={vi.fn()}
          onFormattingChange={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const editor = container.querySelector<HTMLElement>('.article-editor')!
    const textNode = editor.querySelector('blockquote p')?.firstChild
    expect(textNode).not.toBeNull()
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(textNode!)
    range.collapse(false)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
      await Promise.resolve()
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })

    expect(container.querySelector('.editor-callout[data-callout="warning"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('.editor-callout-heading input')?.value).toBe('操作前备份')
  })
})
