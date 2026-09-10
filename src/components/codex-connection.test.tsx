import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodexConnection } from './codex-connection'
import { getCodexToken, setCodexToken } from '../lib/codex-client'

let container: HTMLDivElement
let root: Root
const onConnected = vi.fn()
const status = { plan: 'plus', models: [{ id: 'test', name: 'Test', isDefault: true }], limits: [] }
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setCodexToken('')
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  onConnected.mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); setCodexToken(''); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function render() {
  await act(async () => root.render(<CodexConnection model="test" disabled={false} onModel={vi.fn()} onConnected={onConnected} />))
}
async function click(text: string) {
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text)!.click())
}
it('shows startup instructions only after clicking connect, without making an unpaired request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await render()
  expect(container.querySelector('#codex-code')).toBeNull()
  await click('连接本机 Codex')
  expect(container.textContent).toContain('npm.cmd run codex:bridge')
  expect(container.querySelector('#codex-code')).not.toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
it('automatically reconnects remembered devices and forgets them', async () => {
  setCodexToken('saved')
  const fetch = vi.fn().mockResolvedValue(Response.json(status)); vi.stubGlobal('fetch', fetch)
  await render()
  expect(fetch.mock.calls[0][1].headers['X-Codex-Token']).toBe('saved')
  expect(onConnected).toHaveBeenLastCalledWith(true)
  await click('忘记此设备')
  expect(getCodexToken()).toBe('')
  expect(onConnected).toHaveBeenLastCalledWith(false)
})
it('saves the first pairing only after successful verification', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'codex_pairing' } }, { status: 401 }))
    .mockResolvedValue(Response.json(status))
  vi.stubGlobal('fetch', fetch)
  await render()
  await click('连接本机 Codex')
  const input = container.querySelector<HTMLInputElement>('#codex-code')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'first-code')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('连接本机 Codex')
  expect(getCodexToken()).toBe('')
  await click('连接本机 Codex')
  expect(getCodexToken()).toBe('first-code')
  expect(onConnected).toHaveBeenLastCalledWith(true)
})
it('keeps authorization when offline and retries after the connector starts', async () => {
  setCodexToken('saved')
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(Response.json(status))
  vi.stubGlobal('fetch', fetch)
  await render()
  expect(container.textContent).toContain('请先启动本机连接程序')
  expect(getCodexToken()).toBe('saved')
  await click('重试连接')
  expect(onConnected).toHaveBeenLastCalledWith(true)
  expect(container.querySelector('#codex-code')).toBeNull()
})
