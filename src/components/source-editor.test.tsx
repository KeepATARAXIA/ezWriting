import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceEditor } from './source-editor'

describe('SourceEditor', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    if (!Range.prototype.getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    }
    if (!Range.prototype.getBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
      })
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders a line-numbered Markdown source surface and inserts warning syntax', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value={'第一行\n\n第二行'} language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    expect(container.querySelector('[aria-label="Markdown 文本编辑器"]')).not.toBeNull()
    expect(container.querySelector('.cm-gutters')).not.toBeNull()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="警告块"]')?.click()
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 500 })
    })
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('> [!warning] 警告标题'))
  })

  it('renders embedded image data directly without exposing Markdown or Base64 source', async () => {
    const dataUri = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiIGZpbGw9IiMxNjQ4ZmYiLz48L3N2Zz4='
    await act(async () => root.render(
      <SourceEditor value={`正文\n\n![流程图](${dataUri})\n\n结尾`} language="markdown" onChange={vi.fn()} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const widget = container.querySelector('.source-image-widget.block')
    expect(widget).not.toBeNull()
    expect(widget?.querySelector('img')?.getAttribute('src')).toBe(dataUri)
    expect(widget?.querySelector('figcaption')?.textContent).toContain('流程图')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('![流程图]')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('PHN2Zy')
  })

  it('shows a quiet missing-image card and deletes the underlying image syntax', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value={'正文\n\n![待补流程图](assets/flow.png)\n\n结尾'} language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const widget = container.querySelector('.source-image-widget.missing')
    expect(widget?.textContent).toContain('图片待补齐')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('![待补流程图]')

    await act(async () => {
      widget?.querySelector<HTMLButtonElement>('button.delete')?.click()
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 500 })
    })
    expect(onChange).toHaveBeenLastCalledWith('正文\n\n\n\n结尾')
    expect(container.querySelector('.source-image-widget')).toBeNull()
  })

  it('replaces an editor image while keeping Markdown as the saved source', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value={'![旧图](assets/old.png)'} language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const input = container.querySelector<HTMLInputElement>('.source-image-widget input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['new'], '新流程图.png', { type: 'image/png' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.waitFor(
        () => expect(onChange).toHaveBeenLastCalledWith('![新流程图](data:image/png;base64,bmV3)'),
        { timeout: 500 },
      )
    })

    expect(onChange).toHaveBeenLastCalledWith('![新流程图](data:image/png;base64,bmV3)')
    expect(container.querySelector('.source-image-widget img')?.getAttribute('src')).toBe('data:image/png;base64,bmV3')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('data:image/png')
  })

  it('shows the selection menu and supports formatting, undo, and redo shortcuts', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value="快捷键正文" language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const editor = container.querySelector<HTMLElement>('.cm-content')!
    const press = async (key: string, init: KeyboardEventInit = {}) => {
      await act(async () => {
        editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init }))
        await Promise.resolve()
      })
    }

    editor.focus()
    await press('a', { ctrlKey: true })
    expect(document.body.querySelector('[aria-label="选中文字快捷排版"]')).not.toBeNull()

    await press('b', { ctrlKey: true })
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('**快捷键正文**'), { timeout: 500 })

    await press('z', { ctrlKey: true })
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('快捷键正文'), { timeout: 500 })
    expect(editor.textContent).toBe('快捷键正文')

    await press('y', { ctrlKey: true })
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('**快捷键正文**'), { timeout: 500 })
    expect(editor.textContent).toBe('**快捷键正文**')

    await press('z', { ctrlKey: true })
    await press('z', { ctrlKey: true, shiftKey: true })
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('**快捷键正文**'), { timeout: 500 })
    expect(editor.textContent).toBe('**快捷键正文**')

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="撤销"]')?.click())
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('快捷键正文'), { timeout: 500 })

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="重做"]')?.click())
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('**快捷键正文**'), { timeout: 500 })
  })
})
