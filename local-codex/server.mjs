import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AI_PROMPT_LIMIT, AI_TIMEOUT_MS, AiError } from '../src/domain/ai.ts'
import { POLISH_INSTRUCTION, readPolishInput } from '../src/lib/ai-polish.ts'
import { codexError } from './runtime.mjs'

export const CODEX_PORT = 48765
export const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:4173', 'http://localhost:4173',
  'http://127.0.0.1:4174', 'http://localhost:4174', 'https://ezwriting.online', 'https://www.ezwriting.online'])

export async function subscriptionAccount(rpc) {
  const { account } = await rpc.request('account/read')
  if (account?.type !== 'chatgpt') throw new AiError('codex_login')
  return { plan: account.planType ?? null }
}

export async function connectionStatus(rpc) {
  const account = await subscriptionAccount(rpc)
  const models = []
  let cursor = null
  do {
    const result = await rpc.request('model/list', { limit: 100, cursor, includeHidden: false })
    models.push(...result.data.filter(model => !model.hidden && model.inputModalities.includes('text'))
      .map(model => ({ id: model.model, name: model.displayName, isDefault: model.isDefault })))
    cursor = result.nextCursor
  } while (cursor && models.length < 500)
  let limits = []
  try {
    const result = await rpc.request('account/rateLimits/read')
    const buckets = result.rateLimitsByLimitId ? Object.values(result.rateLimitsByLimitId) : [result.rateLimits]
    limits = buckets.filter(Boolean).map(bucket => ({ name: bucket.limitName ?? bucket.limitId ?? 'Codex',
      windows: [bucket.primary, bucket.secondary].filter(Boolean).map(window => ({
        usedPercent: window.usedPercent, minutes: window.windowDurationMins, resetsAt: window.resetsAt,
      })) }))
  } catch { /* Account/model access remains usable if quota reporting is unavailable. */ }
  return { ...account, models, limits }
}

export function validatePayload(payload) {
  if (!payload || !['generate', 'polish', 'test'].includes(payload.action)
    || typeof payload.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(payload.model)
    || (payload.action !== 'test' && (typeof payload.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > AI_PROMPT_LIMIT))) throw new AiError('invalid_request')
  let input
  if (payload.action === 'polish') {
    try { input = readPolishInput(payload.prompt) } catch { throw new AiError('invalid_request') }
  }
  return { model: payload.model, action: payload.action,
    ...(input ? { optionCount: input.plans.length } : {}),
    prompt: payload.action === 'test' ? '请只回复：连接成功' : input ? JSON.stringify(input) : payload.prompt }
}

// Every request gets an isolated ephemeral thread and an app-server process.
// Cancellation kills that process even if turn/start has not returned its id yet.
export async function runGeneration(rpc, payload, cwd, signal, emit) {
  await subscriptionAccount(rpc) // Refuse API-key mode: never silently switch billing.
  const thread = await rpc.request('thread/start', { model: payload.model, modelProvider: 'openai', cwd,
    approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, environments: [],
    selectedCapabilityRoots: [], dynamicTools: [],
    baseInstructions: '你是 EZWRITING 的文字编辑。只根据用户本次提供的内容输出文字。不要使用工具、读取文件、执行命令或联网。',
    developerInstructions: payload.action === 'polish' ? POLISH_INSTRUCTION : '直接回答用户的写作请求，不附加工作进度或操作说明。',
    config: { 'project_doc_max_bytes': 0, 'web_search': 'disabled', 'features.shell_tool': false,
      'features.multi_agent': false, 'features.memories': false, 'features.apps': false, 'mcp_servers': {}, ...rpc.safeConfig },
  })
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const threadId = thread.thread.id
  await new Promise((resolve, reject) => {
    const items = new Map()
    let total = 0
    const cleanup = () => { rpc.off('notification', notification); rpc.off('closed', closed); signal.removeEventListener('abort', abort) }
    const finish = error => { cleanup(); error ? reject(error) : resolve() }
    const abort = () => finish(new DOMException('Aborted', 'AbortError'))
    const closed = error => finish(error)
    const notification = ({ method, params }) => {
      if (params?.threadId !== threadId) return
      if (method === 'item/agentMessage/delta') {
        // Buffer per item: progress messages must not contaminate three-option JSON.
        const current = items.get(params.itemId) ?? { text: '', phase: null }
        current.text += params.delta; total += params.delta.length; items.set(params.itemId, current)
        if (total > 64_000) finish(new AiError('too_large'))
      } else if (method === 'item/completed' && params.item?.type === 'agentMessage') {
        items.set(params.item.id, { text: params.item.text, phase: params.item.phase })
      } else if (method === 'turn/completed') {
        if (params.turn.status !== 'completed') { finish(codexError(params.turn.error)); return }
        const messages = [...items.values()]
        const text = messages.filter(item => item.phase === 'final_answer').map(item => item.text).join('\n')
          || messages.filter(item => item.phase !== 'commentary').at(-1)?.text
        if (!text?.trim()) { finish(new AiError('empty')); return }
        if (text.length > 64_000) { finish(new AiError('too_large')); return }
        emit({ type: 'delta', text }); emit({ type: 'done' }); finish()
      }
    }
    rpc.on('notification', notification); rpc.on('closed', closed); signal.addEventListener('abort', abort, { once: true })
    rpc.request('turn/start', { threadId, input: [{ type: 'text', text: payload.prompt, text_elements: [] }],
      environments: [], effort: 'low', ...(payload.action === 'polish' ? { outputSchema: {
        type: 'object', properties: { options: { type: 'array', items: { type: 'string' }, minItems: payload.optionCount ?? 3, maxItems: payload.optionCount ?? 3 } },
        required: ['options'], additionalProperties: false,
      } } : {}),
    }).catch(finish)
  })
}

async function readBody(request) {
  const chunks = []; let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 48 * 1024) throw new AiError('too_large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AiError('invalid_request') }
}

export function createBridge({ token, createRpc, cwd, port = CODEX_PORT }) {
  let busy = false
  const live = new Set()
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const error = (code, status = 400) => {
      if (response.destroyed) return
      if (response.headersSent) { response.end(`data: ${JSON.stringify({ type: 'error', code })}\n\n`); return }
      response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code } }))
    }
    const boundPort = port || server.address()?.port
    if (![`127.0.0.1:${boundPort}`, `localhost:${boundPort}`].includes(request.headers.host)
      || !ALLOWED_ORIGINS.has(request.headers.origin)) { error('origin', 403); return }
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
    response.setHeader('Vary', 'Origin')
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Codex-Token', 'Access-Control-Allow-Private-Network': 'true' })
      response.end(); return
    }
    if (request.method !== 'POST') { error('invalid_request', 405); return }
    const supplied = Buffer.from(String(request.headers['x-codex-token'] ?? ''))
    const expected = Buffer.from(token)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { error('codex_pairing', 401); return }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { error('invalid_request', 415); return }
    if (!['/api/codex/status', '/api/codex/generate'].includes(request.url)) { error('invalid_request', 404); return }
    if (busy) { error('codex_busy', 409); return }
    busy = true
    const controller = new AbortController()
    let rpc
    const timer = setTimeout(() => controller.abort(new AiError('timeout')), AI_TIMEOUT_MS)
    const abort = () => { if (!response.writableEnded) controller.abort() }
    response.on('close', abort)
    controller.signal.addEventListener('abort', () => { rpc?.close(); error(controller.signal.reason instanceof AiError ? controller.signal.reason.code : 'interrupted', 504) }, { once: true })
    try {
      const body = await readBody(request)
      const payload = request.url.endsWith('/generate') ? validatePayload(body) : null
      if (controller.signal.aborted) return
      rpc = createRpc(); live.add(rpc)
      await rpc.initialize()
      if (payload) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
        response.flushHeaders()
        await runGeneration(rpc, payload, cwd, controller.signal, event => {
          if (!response.destroyed) response.write(`data: ${JSON.stringify(event)}\n\n`)
        })
        response.end()
      } else {
        const status = await connectionStatus(rpc)
        if (!response.destroyed && !response.writableEnded) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(status)) }
      }
    } catch (cause) {
      if (!response.writableEnded) error(cause instanceof AiError ? cause.code : 'codex_unavailable', 502)
    } finally {
      clearTimeout(timer); response.off('close', abort); rpc?.close(); live.delete(rpc); busy = false
    }
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.on('close', () => { for (const rpc of live) rpc.close() })
  return server
}
