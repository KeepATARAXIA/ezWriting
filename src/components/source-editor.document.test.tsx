import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceEditor } from './source-editor'
import type { AiDocumentEditor } from '../lib/ai-document'

describe('full-document AI edits', () => {
  let container: HTMLDivElement, root: Root, editor: AiDocumentEditor | null
  const source = '# 标题\n\n## 小标题\n\n这句话非常非常好。\n\n![图](https://example.com/image.png)'
  const ready = (value: AiDocumentEditor | null) => { editor = value }
  const render = (readOnly = false) => root.render(<SourceEditor value={source} titleInDocument language="markdown" onChange={vi.fn()} onAiDocumentReady={ready} readOnly={readOnly} />)
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    if (!Range.prototype.getBoundingClientRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container); editor = null
    await act(async () => render())
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  const view = () => EditorView.findFromDOM(container.querySelector('.cm-content')!)!
  it('captures live text before the debounce and applies title/body as one undo step', async () => {
    await act(async () => view().dispatch({ changes: { from: source.indexOf('这句话'), insert: '其实' } }))
    const before = view().state.doc.toString(), snapshot = editor!.capture()
    expect(snapshot.body).toContain('其实这句话')
    const revision = { title: '新的标题', body: snapshot.body.replace('非常非常好', '很好') }
    await act(async () => expect(snapshot.apply(revision)).toBeUndefined())
    expect(view().state.doc.toString()).toContain('# 新的标题')
    expect(view().state.doc.toString()).toContain('其实这句话很好。')
    await act(async () => { undo(view()) })
    expect(view().state.doc.toString()).toBe(before)
    await act(async () => { redo(view()) })
    expect(view().state.doc.toString()).toContain('新的标题')
  })
  it('rejects intervening edits, read-only state and stale editor handles', async () => {
    const snapshot = editor!.capture(), revision = { title: snapshot.title, body: snapshot.body.replace('非常非常好', '很好') }
    await act(async () => view().dispatch({ changes: { from: source.length, insert: '新内容' } }))
    expect(snapshot.apply(revision)).toContain('已发生变化')
    await act(async () => render(true))
    expect(snapshot.apply(revision)).toContain('暂不可修改')
    expect(() => editor!.capture()).toThrow('暂不可读取')
    await act(async () => root.render(null))
    expect(editor).toBeNull()
    expect(snapshot.apply(revision)).toContain('已切换')
  })
  it('keeps embedded image bytes local and restores them in preview and change events', async () => {
    const imageSource = '# 标题\n\n原文。\n\n![图](data:image/png;base64,aGVsbG8=)'
    const change = vi.fn()
    await act(async () => root.render(<SourceEditor value={imageSource} titleInDocument language="markdown" onChange={change} onAiDocumentReady={ready} />))
    const snapshot = editor!.capture()
    expect(snapshot.body).toContain('dispatch-editor-image://')
    expect(snapshot.body).not.toContain('base64')
    expect(snapshot.preview(snapshot.body)).toContain('data:image/png;base64,aGVsbG8=')
    await act(async () => expect(snapshot.apply({ title: snapshot.title, body: snapshot.body.replace('原文', '新文') })).toBeUndefined())
    expect(change.mock.calls.at(-1)?.[0]).toContain('data:image/png;base64,aGVsbG8=')
  })
})
