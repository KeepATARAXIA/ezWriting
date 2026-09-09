// @vitest-environment node
import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridge, runGeneration, subscriptionAccount, validatePayload } from './server.mjs'
import { codexError } from './runtime.mjs'

class FakeRpc extends EventEmitter {
  safeConfig = { 'mcp_servers.example.enabled': false }
  closed = false
  initialize = vi.fn(async () => {})
  request = vi.fn(async (method, params) => {
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } }
    if (method === 'model/list') return { data: [{ model: 'test-model', displayName: 'Test model', inputModalities: ['text'], isDefault: true }], nextCursor: null }
    if (method === 'account/rateLimits/read') return { rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1788700000 } } }
    if (method === 'thread/start') return { thread: { id: 'isolated' } }
    if (method === 'turn/start') {
      queueMicrotask(() => {
        this.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', id: 'progress', phase: 'commentary', text: '内部进度' } } })
        this.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: params.threadId, itemId: 'answer', delta: '完成文字。' } })
        this.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: '完成文字。' } } })
        this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } } })
      })
      return { turn: { id: 'turn' } }
    }
  })
  close() { this.closed = true; this.emit('closed', new Error('Closed')) }
}
const servers = []
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } })
async function fixture(factory = () => new FakeRpc()) {
  const server = createBridge({ token: 'pairing-code', cwd: '/empty', createRpc: factory, port: 0 })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server)
  const url = `http://127.0.0.1:${server.address().port}/api/codex`
  const post = (path, body = {}, headers = {}, signal) => fetch(url + path, { method: 'POST', headers: {
    Origin: 'http://127.0.0.1:4173', 'X-Codex-Token': 'pairing-code', 'Content-Type': 'application/json', ...headers,
  }, body: JSON.stringify(body), signal })
  return { post, url }
}

describe('Codex subscription boundary', () => {
  it('uses the chosen preset count in the constrained output schema', async () => {
    const plans = [{ name: '自然表达', instruction: '只微调措辞。', strength: 10 }]
    const payload = validatePayload({ action: 'polish', model: 'test', prompt: JSON.stringify({
      original: '选段', language: 'markdown', contextBefore: '', contextAfter: '', plans,
    }) })
    expect(JSON.parse(payload.prompt).plans).toEqual(plans)
    const rpc = new FakeRpc()
    await runGeneration(rpc, payload, '/empty', new AbortController().signal, () => {})
    expect(rpc.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      outputSchema: expect.objectContaining({ properties: { options: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1 } } }),
    }))
  })
  it.each([null, { type: 'apiKey' }, { type: 'amazonBedrock' }])('refuses non-subscription account %j', async account => {
    await expect(subscriptionAccount({ request: async () => ({ account }) })).rejects.toMatchObject({ code: 'codex_login' })
  })
  it('uses a fixed test prompt and validates polish and model input', () => {
    expect(validatePayload({ action: 'test', model: 'model', prompt: 'PRIVATE DRAFT' }).prompt).toBe('请只回复：连接成功')
    for (const payload of [{ action: 'polish', model: 'model', prompt: '{}' }, { action: 'generate', model: '../bad', prompt: 'hello' }, { action: 'generate', model: 'm', prompt: 'x'.repeat(8001) }]) {
      expect(() => validatePayload(payload)).toThrow()
    }
  })
  it('isolates each turn, disables inherited MCP, omits progress and emits completion once', async () => {
    const rpc = new FakeRpc(), events = []
    await runGeneration(rpc, { action: 'polish', model: 'test', prompt: '{}' }, '/empty', new AbortController().signal, event => events.push(event))
    expect(events).toEqual([{ type: 'delta', text: '完成文字。' }, { type: 'done' }])
    expect(rpc.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ ephemeral: true, environments: [], sandbox: 'read-only', config: expect.objectContaining({ 'mcp_servers.example.enabled': false }) }))
    expect(rpc.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ outputSchema: expect.objectContaining({ required: ['options'] }) }))
    expect(rpc.listenerCount('notification')).toBe(0)
  })
  it('sanitizes error payloads', () => {
    expect(codexError({ codexErrorInfo: 'usageLimitExceeded', message: 'PRIVATE' })).toMatchObject({ code: 'quota' })
    expect(codexError({ message: 'PRIVATE' }).message).not.toContain('PRIVATE')
  })
})

describe('Local HTTP bridge', () => {
  it('requires the pairing code, allowlisted origin and local Host before starting Codex', async () => {
    const factory = vi.fn(() => new FakeRpc()), { post, url } = await fixture(factory)
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { 'X-Codex-Token': 'wrong' }]) {
      expect((await post('/status', {}, headers)).status).toBeGreaterThanOrEqual(400)
    }
    const badHost = await new Promise(resolve => {
      const req = httpRequest(url + '/status', { method: 'POST', headers: { Host: 'evil.example', Origin: 'http://127.0.0.1:4173', 'Content-Type': 'application/json', 'X-Codex-Token': 'pairing-code' } }, res => { res.resume(); resolve(res.statusCode) })
      req.end('{}')
    })
    expect(badHost).toBe(403)
    expect(factory).not.toHaveBeenCalled()
    const preflight = await fetch(url + '/status', { method: 'OPTIONS', headers: { Origin: 'https://ezwriting.online' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Private-Network')).toBe('true')
  })
  it('returns only account summary, models and limits and closes the process', async () => {
    const rpc = new FakeRpc(), { post } = await fixture(() => rpc)
    const response = await post('/status'), data = await response.json()
    expect(data.plan).toBe('plus'); expect(data.models[0].id).toBe('test-model')
    expect(data.limits[0].windows[0].usedPercent).toBe(25)
    expect(JSON.stringify(data)).not.toMatch(/email|token|apiKey/)
    expect(rpc.closed).toBe(true)
  })
  it('rejects malformed requests before spawning and streams a normalized complete response', async () => {
    const factory = vi.fn(() => new FakeRpc()), { post } = await fixture(factory)
    expect((await post('/generate', { action: 'polish', model: 'm', prompt: '{}' })).status).toBe(502)
    expect((await post('/generate', { excess: 'x'.repeat(50 * 1024) })).status).toBe(502)
    expect(factory).not.toHaveBeenCalled()
    const response = await post('/generate', { action: 'test', model: 'test-model' })
    expect(await response.text()).toBe('data: {"type":"delta","text":"完成文字。"}\n\ndata: {"type":"done"}\n\n')
  })
  it('rejects concurrent requests and kills a pending process when the browser stops', async () => {
    const rpc = new FakeRpc()
    const original = rpc.request
    rpc.request = vi.fn((method, params) => method === 'turn/start' ? Promise.resolve({ turn: { id: 'pending' } }) : original(method, params))
    const { post } = await fixture(() => rpc)
    const controller = new AbortController()
    const response = await post('/generate', { action: 'test', model: 'test' }, {}, controller.signal)
    const body = response.text().catch(() => '')
    expect((await post('/status')).status).toBe(409)
    controller.abort(); await body
    await vi.waitFor(() => expect(rpc.closed).toBe(true))
    expect((await post('/status')).status).toBe(200)
  })
})
