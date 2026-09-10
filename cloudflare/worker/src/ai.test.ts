// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_TIMEOUT_MS } from '../../../src/domain/ai'
import worker from './index'
import type { WorkerEnv } from './types'

const bindings = { ASSETS: { fetch: vi.fn() } } as unknown as WorkerEnv
const frame = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`
const streamResponse = (text = frame('你好') + frame('', 'stop') + 'data: [DONE]\n\n') => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
function request(payload: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request('https://app.example.com/api/ai/generate', {
    method: 'POST', headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json', 'X-AI-Key': 'private-key', ...headers },
    body: JSON.stringify({ provider: 'gemini', model: 'gemini-3.8-flash', action: 'generate', prompt: '写一句话', ...payload }),
  })
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('AI forwarding boundary', () => {
  it('forwards explicit article context with the shared chat contract and strips unknown fields', async () => {
    const fetch = vi.fn().mockResolvedValue(streamResponse()); vi.stubGlobal('fetch', fetch)
    const chat = { instruction: '继续精简', document: { title: '文章', body: '文'.repeat(16_000), language: 'markdown' },
      previousRevision: null, history: [{ instruction: '给建议', reply: '减少重复。' }], refinements: [], apiKey: 'not-a-prompt' }
    const response = await worker.fetch(request({ action: 'chat', prompt: JSON.stringify(chat) }), bindings)
    expect(response.status).toBe(200); await response.text()
    const sent = JSON.parse(fetch.mock.calls[0][1].body)
    expect(sent.messages[0].role).toBe('system')
    expect(sent.messages[0].content).toContain('previousRevision')
    expect(JSON.parse(sent.messages[1].content).document.body).toHaveLength(16_000)
    expect(sent.messages[1].content).not.toContain('not-a-prompt')
  })
  it('rejects malformed chat context before contacting a provider', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request({ action: 'chat', prompt: '{"instruction":"修改全文"}' }), bindings)
    expect(response.status).toBe(400); expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['deepseek', 'https://api.deepseek.com/chat/completions'],
    ['glm', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ])('forwards %s only to its official endpoint and normalizes streamed text', async (provider, endpoint) => {
    const fetch = vi.fn().mockResolvedValue(streamResponse())
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request({ provider, model: 'chosen-model', endpoint: 'https://attacker.example' }), bindings)
    expect(response.headers.get('Cache-Control')).toBe('no-store, no-transform')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const text = await response.text()
    expect(text).toContain('"text":"你好"')
    expect(text).toContain('"type":"done"')
    expect(text).not.toContain('private-key')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(endpoint)
    expect(init.headers.Authorization).toBe('Bearer private-key')
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(init.body)).toEqual({ model: 'chosen-model', stream: true, max_tokens: 4096, messages: [{ role: 'user', content: '写一句话' }] })
    expect(init.signal.aborted).toBe(true)
  })

  it('tests with a fixed short prompt, ignoring any submitted draft', async () => {
    const fetch = vi.fn().mockResolvedValue(streamResponse())
    vi.stubGlobal('fetch', fetch)
    await (await worker.fetch(request({ action: 'test', prompt: '稿件绝不能发送' }), bindings)).text()
    expect(fetch.mock.calls[0][1].body).toContain('请只回复：连接成功')
    expect(fetch.mock.calls[0][1].body).not.toContain('稿件绝不能发送')
  })

  it.each([
    [{ provider: 'codex' }, {}],
    [{ provider: 'constructor' }, {}], [{ model: '../../unsafe' }, {}], [{ model: '' }, {}],
    [{ action: 'publish' }, {}], [{ prompt: '' }, {}], [{ prompt: ' '.repeat(20) }, {}],
    [{ prompt: '文'.repeat(8001) }, {}], [{}, { 'X-AI-Key': '' }], [{}, { 'X-AI-Key': 'invalid key' }],
    [{}, { Origin: 'https://evil.example' }], [{}, { Origin: '' }], [{}, { 'Content-Type': 'text/plain' }],
  ])('rejects invalid input before using the key (%j, %j)', async (payload, headers) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request(payload, headers), bindings)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('bounds streamed request size even without Content-Length', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(request({ unused: 'x'.repeat(50 * 1024) }), bindings)
    expect(await response.json()).toEqual({ error: { code: 'too_large' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON, non-POST methods, and unknown AI routes', async () => {
    const badJson = new Request('https://app.example.com/api/ai/generate', { method: 'POST', headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json', 'X-AI-Key': 'key' }, body: '{' })
    expect((await worker.fetch(badJson, bindings)).status).toBe(400)
    const get = await worker.fetch(new Request('https://app.example.com/api/ai/generate'), bindings)
    expect(get.status).toBe(405); expect(get.headers.get('Allow')).toBe('POST')
    expect((await worker.fetch(new Request('https://app.example.com/api/ai/unknown'), bindings)).status).toBe(404)
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it.each([[401, 'invalid_key'], [403, 'forbidden'], [404, 'model_unavailable'], [429, 'quota'], [402, 'quota'], [500, 'upstream'], [400, 'invalid_request']])('sanitizes vendor HTTP %i errors', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-key and private draft', { status: Number(status) })))
    const response = await worker.fetch(request(), bindings)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: { code } })
  })

  it.each([
    [frame('', 'stop'), 'empty'],
    [frame('部分内容', 'length'), 'truncated'],
    [frame('部分内容'), 'interrupted'],
    [frame('', 'content_filter'), 'filtered'],
    ['data: {"error":{"message":"private-key"}}\n\n', 'upstream'],
    ['data: invalid-private-key\n\n', 'protocol'],
    ['data: [DONE]\n\n', 'empty'],
  ])('never reports an incomplete or invalid stream as successful', async (body, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(body)))
    const text = await (await worker.fetch(request(), bindings)).text()
    expect(text).toContain(`"code":"${code}"`)
    expect(text).not.toContain('"type":"done"')
    expect(text).not.toContain('private-key')
  })

  it('omits reasoning and cancels upstream when the reader cancels', async () => {
    let signal: AbortSignal
    const cancelled = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"private thought"},"finish_reason":null}]}\n\n' + frame('正文')))
      }, cancel: cancelled }), { headers: { 'Content-Type': 'text/event-stream' } })
    }))
    const reader = (await worker.fetch(request(), bindings)).body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('正文'); expect(first).not.toContain('private thought')
    await reader.cancel()
    expect(signal!.aborted).toBe(true)
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('times out upstream connection without returning raw errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('private-key')))
    })))
    const response = worker.fetch(request(), bindings)
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 1)
    expect(await (await response).json()).toEqual({ error: { code: 'timeout' } })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out a stalled stream after preserving received text', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame('已经收到')))
      init.signal.addEventListener('abort', () => controller.error(new Error('aborted')))
    } }), { headers: { 'Content-Type': 'text/event-stream' } })))
    const response = await worker.fetch(request(), bindings)
    const text = response.text()
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 1)
    expect(await text).toContain('已经收到')
    expect(await text).toContain('"code":"timeout"')
    expect(vi.getTimerCount()).toBe(0)
  })
})
