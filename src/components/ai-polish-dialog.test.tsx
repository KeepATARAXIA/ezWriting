import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAiSession } from '../domain/ai'
import { generateAiText } from '../lib/ai-client'
import type { AiSelection } from '../lib/ai-polish'
import { AiPolishDialog } from './ai-polish-dialog'

vi.mock('../lib/ai-client', () => ({ generateAiText: vi.fn() }))
let container: HTMLDivElement, root: Root, selection: AiSelection
const options = ['这句话很好。', '这句话写得真好。', '这句话说得好。']
const request = vi.mocked(generateAiText)
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); request.mockReset()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  selection = { id: 'selection', original: '这句话非常非常好。', contextBefore: '前文', contextAfter: '后文', language: 'markdown', apply: vi.fn(() => undefined) }
  request.mockImplementation(async args => { args.onText(JSON.stringify({ options })) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
async function render(locked = false) {
  const session = createAiSession(); session.profiles.gemini.apiKey = 'mock-key'
  await act(async () => root.render(<AiPolishDialog selection={selection} session={session} onChange={vi.fn()} locked={locked} onClose={vi.fn()} onConfigure={vi.fn()} />))
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === text)!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
const applyButton = () => container.querySelector<HTMLButtonElement>('[aria-label="应用「精简表达」"]')!

it('keeps a rejected application visible in the footer without marking any result applied', async () => {
  let changed = false
  selection.apply = vi.fn(() => changed ? '稿件已发生变化，请重新选择文字。' : undefined)
  request.mockImplementation(async args => { changed = true; args.onText(JSON.stringify({ options })) })
  await render(); await click('生成 3 个润色方案')
  await act(async () => applyButton().click())
  expect(selection.apply).toHaveBeenCalledWith(options[0])
  expect(container.querySelector('.ai-polish-footer [role="alert"]')?.textContent).toContain('已发生变化')
  expect(applyButton().textContent).toBe('应用选段')
  expect(applyButton().disabled).toBe(false)
  expect(container.querySelector('.ai-polish-footer [role="status"]')).toBeNull()
})

it('applies only a complete selected result once and prevents applying or regenerating while locked', async () => {
  let finish: (() => void) | undefined
  request.mockImplementation(args => new Promise<void>(resolve => { finish = () => { args.onText(JSON.stringify({ options })); resolve() } }))
  await render(); await click('生成 3 个润色方案')
  expect(container.querySelectorAll('.ai-apply-option')).toHaveLength(0)
  await act(async () => finish!())
  await render(true)
  await act(async () => applyButton().click())
  expect(selection.apply).not.toHaveBeenCalled()
  await render(false)
  await act(async () => { applyButton().click() })
  await act(async () => { applyButton().click() })
  expect(selection.apply).toHaveBeenCalledExactlyOnceWith(options[0])
  expect(applyButton().textContent).toBe('已应用')
  expect([...container.querySelectorAll<HTMLButtonElement>('.ai-apply-option')].every(button => button.disabled)).toBe(true)
  expect(container.querySelector('.ai-polish-footer [role="status"]')?.textContent).toContain('撤销')
  await click('重新生成')
  expect(request).toHaveBeenCalledTimes(1)
})
