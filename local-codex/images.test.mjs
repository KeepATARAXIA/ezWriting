// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imagePayload, imageResult, runImageGeneration } from './images.mjs'
import { createBridge } from './server.mjs'
import { CodexRpc } from './runtime.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
class ImageRpc extends EventEmitter {
  safeConfig = { 'mcp_servers.private.enabled': false }
  initialize = vi.fn(async () => {})
  close = vi.fn(() => this.emit('closed', new Error('closed')))
  enabled = true
  account = 'chatgpt'
  result = png
  hold = false
  request = vi.fn(async (method, params) => {
    if (method === 'account/read') return { account: { type: this.account } }
    if (method === 'modelProvider/capabilities/read') return { imageGeneration: this.enabled }
    if (method === 'thread/start') return { thread: { id: 'picture' } }
    if (method === 'turn/start' && !this.hold) queueMicrotask(() => {
      if (this.result) this.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'imageGeneration', status: 'completed', result: this.result, savedPath: '/private/do-not-read' } } })
      this.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } } })
    })
    return {}
  })
}
const servers = []
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } })
describe('native Codex images', () => {
  it('allows image startup beyond 25 seconds and reports its own timeout', async () => {
    vi.useFakeTimers()
    try {
      const rpc = { images: true, closed: false, counter: 0, pending: new Map(), send: vi.fn() }
      const request = CodexRpc.prototype.request.call(rpc, 'thread/start')
      const rejected = expect(request).rejects.toMatchObject({ code: 'image_connection_timeout' })
      await vi.advanceTimersByTimeAsync(25_000)
      expect(rpc.pending.size).toBe(1)
      await vi.advanceTimersByTimeAsync(35_000)
      await rejected
      expect(rpc.pending.size).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('returns a completed image without waiting for a trailing turn completion', async () => {
    const rpc = new ImageRpc(); rpc.hold = true
    const result = runImageGeneration(rpc, { model: 'test', prompt: '图片' }, '/empty', new AbortController().signal)
    await vi.waitFor(() => expect(rpc.listenerCount('notification')).toBe(1))
    rpc.emit('notification', { method: 'item/completed', params: { threadId: 'picture', item: { type: 'imageGeneration', status: 'completed', result: png } } })
    expect(await result).toEqual(imageResult(png))
    expect(rpc.listenerCount('notification')).toBe(0)
  })
  it('accepts only bounded prompt/model and native raster data', () => {
    expect(imagePayload({ prompt: ' 描述 ', model: 'test', apiKey: 'secret' })).toEqual({ prompt: '描述', model: 'test' })
    for (const prompt of ['', 'x'.repeat(8001)]) expect(() => imagePayload({ prompt, model: 'test' })).toThrow()
    expect(() => imagePayload({ prompt: '描述', model: '../model' })).toThrow()
    expect(imageResult(png)).toEqual({ dataUrl: `data:image/png;base64,${png}`, mime: 'image/png' })
    for (const value of ['https://example.com/image.png', Buffer.from('<svg/>').toString('base64'), 'not base64']) expect(() => imageResult(value)).toThrow()
  })
  it('uses a subscription-only ephemeral image turn with no inherited tools', async () => {
    const rpc = new ImageRpc()
    expect(await runImageGeneration(rpc, { model: 'test', prompt: '浅色配图' }, '/empty', new AbortController().signal)).toEqual(imageResult(png))
    expect(rpc.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ ephemeral: true, environments: [], dynamicTools: [], sandbox: 'read-only', config: expect.objectContaining({ 'features.image_generation': true, 'features.shell_tool': false, 'mcp_servers.private.enabled': false }) }))
    expect(rpc.listenerCount('notification')).toBe(0)
  })
  it('refuses API billing, unsupported capability and text-only results', async () => {
    const rpc = new ImageRpc(), payload = { model: 'test', prompt: '图片' }, signal = new AbortController().signal
    rpc.account = 'apiKey'
    await expect(runImageGeneration(rpc, payload, '/empty', signal)).rejects.toMatchObject({ code: 'codex_login' })
    rpc.account = 'chatgpt'; rpc.enabled = false
    await expect(runImageGeneration(rpc, payload, '/empty', signal)).rejects.toMatchObject({ code: 'image_unavailable' })
    rpc.enabled = true; rpc.result = ''
    await expect(runImageGeneration(rpc, payload, '/empty', signal)).rejects.toMatchObject({ code: 'image_empty' })
  })
  it('cancels an unfinished image and cleans listeners', async () => {
    const rpc = new ImageRpc(); rpc.hold = true
    const controller = new AbortController()
    const result = runImageGeneration(rpc, { model: 'test', prompt: '图片' }, '/empty', controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(rpc.listenerCount('notification')).toBe(1))
    controller.abort(); await rejected
    expect(rpc.listenerCount('notification')).toBe(0)
  })
  it('protects the image endpoint with pairing and origin, returning no saved paths', async () => {
    const rpc = new ImageRpc(), createRpc = vi.fn(() => rpc)
    const server = createBridge({ token: 'paired', createRpc, cwd: '/empty', port: 0 })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server)
    const url = `http://127.0.0.1:${server.address().port}/api/codex/images`
    const post = token => fetch(url, { method: 'POST', headers: { Origin: 'http://127.0.0.1:4174', 'X-Codex-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'test', prompt: '图片' }) })
    expect((await post('wrong')).status).toBe(401); expect(createRpc).not.toHaveBeenCalled()
    const response = await post('paired')
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(imageResult(png))
    expect(createRpc).toHaveBeenCalledWith({ images: true }); expect(rpc.close).toHaveBeenCalled()
  })
})
