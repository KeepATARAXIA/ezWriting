import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { expect, it, vi } from 'vitest'
import { SourceEditor } from './source-editor'

it('renders punctuation and comment-adjacent bold without changing source or code examples', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const source = '<!-- 编辑说明 -->缓一缓：**先解决问题。**\n\n是**“重点！”**再说\n\n`**代码！**`和\\*\\*转义\\*\\*'
  const onChange = vi.fn()
  try {
    await act(async () => root.render(<SourceEditor value={source} language="markdown" onChange={onChange} />))
    const editor = container.querySelector<HTMLElement>('.cm-content')!
    expect(Array.from(editor.querySelectorAll('.cm-md-strong'), element => element.textContent)).toEqual(['先解决问题。', '“重点！”'])
    expect(editor.textContent).not.toContain('**先解决问题。**')
    expect(editor.textContent).toContain('**代码！**')
    expect(EditorView.findFromDOM(editor)?.state.doc.toString()).toBe(source)
    expect(onChange).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
