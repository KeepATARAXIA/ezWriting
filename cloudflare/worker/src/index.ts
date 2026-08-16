import type { WorkerEnv } from './types'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
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
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<WorkerEnv>
