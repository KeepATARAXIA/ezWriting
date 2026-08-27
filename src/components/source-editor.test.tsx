import { act } from 'react'
import { EditorView } from '@codemirror/view'
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
    vi.restoreAllMocks()
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

  it('prevents editor and toolbar mutations while read-only', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value="锁定内容" language="markdown" readOnly onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="警告块"]')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 300))
    })
    expect(container.querySelector('.cm-content')?.textContent).toContain('锁定内容')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('警告标题')
    expect(onChange).not.toHaveBeenCalled()
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
    expect(widget?.querySelector('figcaption')?.textContent).not.toContain('流程图')
    expect(widget?.getAttribute('aria-label')).toBe('图片：流程图')
    expect(widget?.querySelector('button')?.getAttribute('aria-label')).toBe('替换图片 流程图')
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

  it('keeps controlled source refreshes out of the local undo history', async () => {
    await act(async () => root.render(
      <SourceEditor value="第一版正文" language="markdown" onChange={vi.fn()} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    await act(async () => root.render(
      <SourceEditor value="父级恢复的第二版正文" language="markdown" onChange={vi.fn()} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    expect(container.querySelector('.cm-content')?.textContent).toBe('父级恢复的第二版正文')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="撤销"]')?.disabled).toBe(true)
  })

  it('restores cut content at its original position after a controlled source refresh', async () => {
    const onChange = vi.fn()
    const original = '开头段落\n需要恢复的内容\n结尾段落'
    const afterCut = '开头段落\n结尾段落'
    await act(async () => root.render(
      <SourceEditor value={original} language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const editor = container.querySelector<HTMLElement>('.cm-content')!
    const view = EditorView.findFromDOM(editor)!
    const from = original.indexOf('需要恢复的内容')
    const to = from + '需要恢复的内容\n'.length
    await act(async () => {
      view.dispatch({ changes: { from, to }, userEvent: 'delete.cut' })
      await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith(afterCut), { timeout: 600 })
    })

    const refreshed = `${afterCut}\n父层同步补充`
    await act(async () => root.render(
      <SourceEditor value={refreshed} language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'z',
        ctrlKey: true,
      }))
      await Promise.resolve()
    })

    expect(view.state.doc.toString()).toBe(`${original}\n父层同步补充`)
  })

  it('ignores a delayed local source echo after the editor has moved ahead', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value="初始内容" language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const editor = container.querySelector<HTMLElement>('.cm-content')!
    const view = EditorView.findFromDOM(editor)!
    await act(async () => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '第一次编辑' } })
      await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('初始内容第一次编辑'), { timeout: 600 })
    })

    await act(async () => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '第二次编辑' } })
      root.render(
        <SourceEditor value="初始内容第一次编辑" language="markdown" onChange={onChange} />,
      )
      await Promise.resolve()
    })

    expect(editor.textContent).toBe('初始内容第一次编辑第二次编辑')
  })

  it('opens safe Markdown links from the editor with Ctrl or Command click', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await act(async () => root.render(
      <SourceEditor value="[打开 OpenAI](https://openai.com/index/example)" language="markdown" onChange={vi.fn()} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const link = container.querySelector<HTMLElement>('.cm-editor-direct-link')!
    expect(link.getAttribute('title')).toBe('Ctrl / Command + 点击打开链接')

    await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(open).not.toHaveBeenCalled()

    await act(async () => link.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    })))
    expect(open).toHaveBeenCalledWith('https://openai.com/index/example', '_blank', 'noopener,noreferrer')
  })

  it('moves the editor selection without adding a preview-location highlight', async () => {
    await act(async () => root.render(
      <SourceEditor
        value={'第一段\n第二段\n第三段'}
        language="markdown"
        focusRequest={{ line: 2, requestId: 1 }}
        onChange={vi.fn()}
      />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const editor = container.querySelector<HTMLElement>('.cm-content')!
    const view = EditorView.findFromDOM(editor)!
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2)
    expect(container.querySelector('.cm-located-source-line')).toBeNull()

    await act(async () => root.render(
      <SourceEditor
        value={'第一段\n第二段\n第三段'}
        language="markdown"
        focusRequest={{ line: 3, requestId: 2 }}
        onChange={vi.fn()}
      />,
    ))

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3)
    expect(container.querySelector('.cm-located-source-line')).toBeNull()
  })

  it('does not echo a preview-driven focus request back as an editor location change', async () => {
    const onActiveBlockChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor
        value={'第一段\n\n- 项目一\n- 项目二'}
        language="markdown"
        focusRequest={{ line: 4, requestId: 1 }}
        onChange={vi.fn()}
        onActiveBlockChange={onActiveBlockChange}
      />,
    ))

    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 100))
    })
    expect(onActiveBlockChange).not.toHaveBeenCalled()

    await act(async () => {
      container.querySelector<HTMLElement>('.cm-content')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.waitFor(
        () => expect(onActiveBlockChange).toHaveBeenLastCalledWith({ blockIndex: 1, line: 4 }),
        { timeout: 500 },
      )
    })
  })

  it('cancels a queued editor location change when preview focus takes control', async () => {
    const onActiveBlockChange = vi.fn()
    const value = '第一段\n\n第二段\n\n第三段'
    await act(async () => root.render(
      <SourceEditor
        value={value}
        language="markdown"
        onChange={vi.fn()}
        onActiveBlockChange={onActiveBlockChange}
      />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const editor = container.querySelector<HTMLElement>('.cm-content')!
    const view = EditorView.findFromDOM(editor)!
    await act(async () => {
      view.dispatch({ selection: { anchor: view.state.doc.line(3).to } })
    })
    await act(async () => {
      root.render(
        <SourceEditor
          value={value}
          language="markdown"
          focusRequest={{ line: 5, requestId: 1 }}
          onChange={vi.fn()}
          onActiveBlockChange={onActiveBlockChange}
        />,
      )
    })
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 100))
    })

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)
    expect(onActiveBlockChange).not.toHaveBeenCalled()
  })

  it('waits for Chinese IME composition to finish before syncing a Markdown heading', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value="企业缺的不是模型" language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const editor = container.querySelector<HTMLElement>('.cm-content')!
    editor.focus()

    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: '2',
        ctrlKey: true,
        altKey: true,
      }))
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'xian' }))
      const line = editor.querySelector<HTMLElement>('.cm-line')!
      line.textContent = '## 企业缺的不是xian'
      editor.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'xian' }))
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'xian',
        inputType: 'insertCompositionText',
        isComposing: true,
      }))
      await new Promise(resolve => window.setTimeout(resolve, 320))
    })

    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      const line = editor.querySelector<HTMLElement>('.cm-line')!
      line.textContent = '## 企业缺的不是现实'
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '现实' }))
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: '现实',
        inputType: 'insertText',
        isComposing: false,
      }))
      await vi.waitFor(
        () => expect(onChange).toHaveBeenLastCalledWith('## 企业缺的不是现实'),
        { timeout: 700 },
      )
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('preserves the outer workspace scroll position while undoing repeatedly', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(
      <SourceEditor value="撤销稳定性正文" language="markdown" onChange={onChange} />,
    ))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const editor = container.querySelector<HTMLElement>('.cm-content')!
    editor.focus()
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', ctrlKey: true }))
      editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'b', ctrlKey: true }))
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 600 })
    })

    container.scrollTop = 420
    for (let index = 0; index < 3; index += 1) {
      await act(async () => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true })
        editor.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        await new Promise(resolve => window.setTimeout(resolve, 40))
      })
      expect(container.scrollTop).toBe(420)
    }
  })
})
