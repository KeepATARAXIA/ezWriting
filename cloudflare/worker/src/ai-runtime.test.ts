// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare'

// Use Wrangler's installed build/runtime dependencies. Node fetch mocks do not
// validate workerd's supported request options or its stream implementation.
let script: string
beforeAll(async () => {
  const result = await build({ entryPoints: ['cloudflare/worker/src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false })
  script = result.outputFiles[0].text
})

describe('AI requests in the actual Worker runtime', () => {
  it.each([200, 307])('handles upstream %i without following redirects or failing before fetch', async status => {
    const destinations: string[] = []
    const runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true, compatibilityDate: '2026-08-13', script,
      outboundService: async request => {
        destinations.push(request.url)
        return status === 307
          ? new RuntimeResponse(null, { status, headers: { Location: 'https://untrusted.example/collect-key' } })
          : new RuntimeResponse('data: {"choices":[{"delta":{"content":"连接成功"},"finish_reason":"stop"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      },
    }))
    try {
      const response = await runtime.dispatchFetch('https://app.example.com/api/ai/generate', {
        method: 'POST', headers: { Origin: 'https://app.example.com', 'Content-Type': 'application/json', 'X-AI-Key': 'test-only-key' },
        body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4-flash', action: 'test' }),
      })
      expect(destinations).toEqual(['https://api.deepseek.com/chat/completions'])
      if (status === 200) {
        expect(response.status).toBe(200)
        const text = await response.text()
        expect(text).toContain('连接成功')
        expect(text).toContain('"type":"done"')
      } else {
        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({ error: { code: 'upstream' } })
      }
    } finally { await runtime.dispose() }
  })
})
