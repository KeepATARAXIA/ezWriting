import type { WorkerEnv } from './types'

const SECURITY_HEADERS = {
  'Content-Security-Policy': "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function json(body: unknown, status = 200): Response {
  return withSecurityHeaders(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  }))
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/health') {
      return json({ status: 'ok', storage: 'local-only' })
    }
    if (pathname.startsWith('/auth/') || pathname.startsWith('/sync/')) {
      return json({ error: { code: 'gone', message: '账号与云同步服务已停用，稿件仅保存在当前浏览器。' } }, 410)
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request))
  },
} satisfies ExportedHandler<WorkerEnv>
