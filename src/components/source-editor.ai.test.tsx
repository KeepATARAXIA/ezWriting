import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceEditor } from './source-editor'
import type { AiSelection } from '../lib/ai-polish'

describe('AI editor selection', () => {
  let container: HTMLDivElement, root: Root
  let target: AiSelection | undefined
  const source = '# 标题\n\n前文。\n\n这句话非常非常好。\n\n后文。'
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    if (!Range.prototype.getBoundingClientRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container); target = undefined
    await act(async () => root.render(<SourceEditor value={source} titleInDocument language="markdown" onChange={vi.fn()} onAiSelection={selection => { target = selection }} />))
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  const view = () => EditorView.findFromDOM(container.querySelector('.cm-content')!)!
  async function select(from: number, to: number) {
    await act(async () => view().dispatch({ selection: { anchor: from, head: to } }))
    await act(async () => document.querySelector<HTMLButtonElement>('.source-selection-menu [aria-label="AI 优化选中文字"]')!.click())
  }
  it('captures context and replaces only the original range as one undoable edit even after moving the caret', async () => {
    const from = source.indexOf('这句话'), to = source.indexOf('\n\n后文')
    await select(from, to)
    expect(target?.original).toBe('这句话非常非常好。')
    expect(target?.contextBefore).toContain('前文'); expect(target?.contextAfter).toContain('后文')
    await act(async () => view().dispatch({ selection: { anchor: 0 } }))
    await act(async () => expect(target!.apply('这句话很好。')).toBeUndefined())
    expect(view().state.doc.toString()).toBe(source.replace('这句话非常非常好。', '这句话很好。'))
    await act(async () => { undo(view()) })
    expect(view().state.doc.toString()).toBe(source)
    await act(async () => { redo(view()) })
    expect(view().state.doc.toString()).toContain('这句话很好。')
  })
  it('rejects stale results instead of overwriting intervening edits', async () => {
    await select(source.indexOf('这句话'), source.indexOf('\n\n后文'))
    await act(async () => view().dispatch({ changes: { from: source.length, insert: '新写的内容' } }))
    expect(target!.apply('旧方案')).toContain('已发生变化')
    expect(view().state.doc.toString()).toBe(source + '新写的内容')
  })
  it('protects the document title', async () => {
    await select(0, 4)
    expect(target).toBeUndefined()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('标题下方')
  })
})
