import { describe, expect, it, vi } from 'vitest'
import worker from './index'
import type { WorkerEnv } from './types'

function env(assetResponse = new Response('app shell')): WorkerEnv {
  return { ASSETS: { fetch: vi.fn().mockResolvedValue(assetResponse) } as unknown as Fetcher }
}

describe('local-only Worker boundary', () => {
  it('reports that the deployment uses local-only storage', async () => {
    const response = await worker.fetch(new Request('https://app.example.com/health'), env())
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(await response.json()).toEqual({ status: 'ok', storage: 'local-only' })
  })

  it.each(['/auth/session', '/auth/register', '/sync/drafts'])('retires the previous backend route %s', async pathname => {
    const response = await worker.fetch(new Request(`https://app.example.com${pathname}`), env())
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      error: { code: 'gone', message: '账号与云同步服务已停用，稿件仅保存在当前浏览器。' },
    })
  })

  it('serves application assets for normal navigation', async () => {
    const bindings = env(new Response('index', { headers: { 'Content-Type': 'text/html', 'X-Asset': 'preserved' } }))
    const response = await worker.fetch(new Request('https://app.example.com/article'), bindings)
    expect(await response.text()).toBe('index')
    expect(response.headers.get('Content-Type')).toBe('text/html')
    expect(response.headers.get('X-Asset')).toBe('preserved')
    expect(response.headers.get('Permissions-Policy')).toBe('camera=(), geolocation=(), microphone=()')
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(bindings.ASSETS.fetch).toHaveBeenCalledOnce()
  })
})
