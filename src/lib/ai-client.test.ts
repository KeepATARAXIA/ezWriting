// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiError } from '../domain/ai'
import { generateAiText } from './ai-client'
import { readSseData } from './ai-sse'

const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const delta = event({ type: 'delta', text: '第一句。' })
const done = event({ type: 'done' })
const response = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
const options = () => ({ provider: 'gemini' as const, profile: { model: 'gemini-3.8-flash', apiKey: 'private-key' }, action: 'generate' as const, prompt: '输入内容', signal: new AbortController().signal, onText: vi.fn() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('SSE decoding', () => {
  it('handles byte-split Chinese, CRLF, comments, and multi-line data', async () => {
    const bytes = new TextEncoder().encode(': ping\r\ndata: 中文\r\ndata: 第二行\r\n\r\ndata: 最后\n\n')
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } })
    const items = []
    for await (const data of readSseData(body)) items.push(data)
    expect(items).toEqual(['中文\n第二行', '最后'])
  })
  it('rejects oversized and unterminated events', async () => {
    for (const text of ['data: never finished', 'data: ' + 'x'.repeat(129 * 1024) + '\n\n']) {
      await expect((async () => { for await (const _data of readSseData(new Response(text).body!)) { /* consume */ } })()).rejects.toBeInstanceOf(AiError)
    }
  })
})

describe('AI client', () => {
  it('finishes after done even if transport cancellation never settles', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(delta + done)) }, cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } })))
    await generateAiText(options())
    expect(cancel).toHaveBeenCalledOnce()
  }, 1000)

  it('stops an idle response even when its stream ignores the fetch signal', async () => {
    const abort = new AbortController()
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Type': 'text/event-stream' },
    })))
    const run = generateAiText({ ...options(), signal: abort.signal })
    await Promise.resolve(); await Promise.resolve()
    abort.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  }, 1000)
  it('sends keys only in the header and accepts normalized completion', async () => {
    const fetch = vi.fn().mockResolvedValue(response(delta + done)); vi.stubGlobal('fetch', fetch)
    const config = options()
    await generateAiText(config)
    expect(config.onText).toHaveBeenCalledWith('第一句。')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/ai/generate')
    expect(init.headers['X-AI-Key']).toBe('private-key')
    expect(init.body).not.toContain('private-key')
    expect(init.cache).toBe('no-store'); expect(init.credentials).toBe('omit')
  })
  it.each([
    [delta, 'interrupted'], [done, 'empty'], [delta + event({ type: 'error', code: 'truncated' }), 'truncated'],
    [event({ type: 'unexpected', text: 'private-key' }), 'protocol'],
  ])('requires a complete terminal event and preserves partial text', async (text, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(text)))
    const config = options()
    await expect(generateAiText(config)).rejects.toMatchObject({ code })
    if (text.startsWith(delta)) expect(config.onText).toHaveBeenCalledWith('第一句。')
  })
  it('identifies static fallback HTML as an unavailable backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>app shell</html>', { headers: { 'Content-Type': 'text/html' } })))
    await expect(generateAiText(options())).rejects.toMatchObject({ code: 'unavailable' })
  })
  it('displays only recognized error codes, never arbitrary error messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'invalid_key', message: 'private-key' } }, { status: 502 })))
    await expect(generateAiText(options())).rejects.toMatchObject({ code: 'invalid_key', message: expect.not.stringContaining('private-key') })
  })
  it('propagates cancellation to a streaming fetch and releases its reader', async () => {
    const abort = new AbortController()
    const config = options()
    let signal: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(delta))
        signal.addEventListener('abort', () => controller.error(new DOMException('Abort', 'AbortError')))
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }))
    const run = generateAiText({ ...config, signal: abort.signal, onText: text => { config.onText(text); abort.abort() } })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal!.aborted).toBe(true)
  })
  it('bounds time spent waiting for the server', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))))
    const assertion = expect(generateAiText(options())).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(125_001)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
  it('honors cancellation even when the completion event is already buffered', async () => {
    const abort = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(delta + done)))
    await expect(generateAiText({ ...options(), signal: abort.signal, onText: () => abort.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
