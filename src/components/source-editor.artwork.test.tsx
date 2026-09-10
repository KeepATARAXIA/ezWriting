import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceEditor } from './source-editor'
import type { ArtworkEditor } from '../domain/artwork'

describe('selected paragraph artwork', () => {
  let container: HTMLDivElement, root: Root, editor: ArtworkEditor | null
  const source = '# 标题\n\n这是一段正文。\n\n下一段保持不变。'
  const ready = (value: ArtworkEditor | null) => { editor = value }
  const change = vi.fn()
  const render = (readOnly = false) => root.render(<SourceEditor value={source} titleInDocument language="markdown" onChange={change} onArtworkReady={ready} readOnly={readOnly} />)
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    if (!Range.prototype.getBoundingClientRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container); editor = null; change.mockClear()
    await act(async () => render())
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  const view = () => EditorView.findFromDOM(container.querySelector('.cm-content')!)!
  const select = async () => { await act(async () => view().dispatch({ selection: { anchor: source.indexOf('这是一段'), head: source.indexOf('这是一段') + 4 } })) }
  it('inserts after the selected paragraph without replacing it, and undoes in one step', async () => {
    await select(); const target = editor!.capture()
    expect(target.text).toBe('这是一段')
    await act(async () => expect(target.insert('data:image/png;base64,AQIDBA==', '配图')).toBeUndefined())
    const result = view().state.doc.toString()
    expect(result).toContain('这是一段正文。\n\n![配图](dispatch-editor-image://')
    expect(result).toContain('下一段保持不变。')
    expect(change.mock.calls.at(-1)?.[0]).toContain('data:image/png;base64,AQIDBA==')
    await act(async () => { undo(view()) }); expect(view().state.doc.toString()).toBe(source)
  })
  it('rejects empty/title selections, stale locations and locked editors', async () => {
    expect(() => editor!.capture()).toThrow('请先选择')
    await act(async () => view().dispatch({ selection: { anchor: 0, head: 4 } }))
    expect(() => editor!.capture()).toThrow('请先选择')
    await select(); const target = editor!.capture()
    await act(async () => view().dispatch({ changes: { from: source.length, insert: '新的编辑' } }))
    expect(target.insert('data:image/png;base64,AQIDBA==', '配图')).toContain('已变化')
    expect(view().state.doc.toString()).not.toContain('dispatch-editor-image')
    await act(async () => render(true))
    expect(target.insert('data:image/png;base64,AQIDBA==', '配图')).toContain('暂不可修改')
    await act(async () => root.render(null))
    expect(target.insert('data:image/png;base64,AQIDBA==', '配图')).toContain('已切换')
  })
})
