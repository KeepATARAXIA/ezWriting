// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createAiSession } from '../domain/ai'
import { generateAiText } from './ai-client'
import { CODEX_URL, getCodexToken, readCodexStatus, setCodexToken } from './codex-client'

afterEach(() => { setCodexToken(''); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('sends Codex only to localhost and never attaches another provider key', async () => {
  setCodexToken('local-pairing')
  const fetch = vi.fn().mockResolvedValue(new Response('data: {"type":"delta","text":"文字"}\n\ndata: {"type":"done"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetch)
  await generateAiText({ provider: 'codex', profile: { model: 'model', apiKey: 'must-not-send' }, action: 'generate', prompt: '本次内容', signal: new AbortController().signal, onText: vi.fn() })
  expect(fetch.mock.calls[0][0]).toBe(`${CODEX_URL}/generate`)
  expect(fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-Codex-Token': 'local-pairing' })
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('must-not-send')
  expect(fetch.mock.calls[0][1].redirect).toBe('error')
})

it('requires pairing before any generation request and reports local failures', async () => {
  setCodexToken('')
  const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetch)
  const options = { provider: 'codex' as const, profile: createAiSession().profiles.codex, action: 'test' as const, signal: new AbortController().signal, onText: vi.fn() }
  await expect(generateAiText(options)).rejects.toMatchObject({ code: 'codex_pairing' })
  expect(fetch).not.toHaveBeenCalled()
  setCodexToken('paired')
  await expect(generateAiText(options)).rejects.toMatchObject({ code: 'codex_unavailable' })
})

it('remembers pairing across page sessions and forgets it explicitly', async () => {
  setCodexToken(' remembered ')
  window.sessionStorage.clear()
  vi.resetModules()
  const fresh = await import('./codex-client')
  expect(fresh.getCodexToken()).toBe('remembered')
  expect(fresh.setCodexToken('')).toBe(true)
  expect(window.localStorage.getItem('dispatch.codex-connection.v1')).toBeNull()
})

it('reports blocked persistent storage while retaining current-page access', () => {
  const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked') })
  expect(setCodexToken('memory-only')).toBe(false)
  expect(getCodexToken()).toBe('memory-only')
  expect(save).toHaveBeenCalledTimes(1)
  setCodexToken(''); expect(getCodexToken()).toBe('')
})

it('does not expose raw backend errors in status checks', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'unknown', message: 'sensitive text' } }, { status: 500 })))
  await expect(readCodexStatus('code', new AbortController().signal)).rejects.toMatchObject({ code: 'codex_unavailable', message: expect.not.stringContaining('sensitive text') })
})
