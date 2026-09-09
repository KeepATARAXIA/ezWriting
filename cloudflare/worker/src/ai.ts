import { AI_PROMPT_LIMIT, AI_TIMEOUT_MS, AiError, isAiProvider, type AiProvider, type AiStreamEvent } from '../../../src/domain/ai'
import { readSseData } from '../../../src/lib/ai-sse'
import { POLISH_INSTRUCTION, readPolishInput } from '../../../src/lib/ai-polish'

// Only these official endpoints can receive keys. Client-supplied URLs are never used.
const ENDPOINTS: Record<Exclude<AiProvider, 'codex'>, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
}
const errorResponse = (code: AiError['code'], status: number) => Response.json({ error: { code } }, {
  status, headers: { 'Cache-Control': 'no-store' },
})

async function readPayload(request: Request): Promise<unknown> {
  const limit = 48 * 1024
  if (Number(request.headers.get('Content-Length')) > limit || !request.body) throw new AiError('too_large')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw new AiError('too_large')
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function* normalizeStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<AiStreamEvent> {
  let hasText = false
  for await (const data of readSseData(body, signal)) {
    if (data === '[DONE]') throw new AiError(hasText ? 'interrupted' : 'empty')
    let chunk
    try { chunk = JSON.parse(data) } catch { throw new AiError('protocol') }
    if (!chunk || typeof chunk !== 'object') throw new AiError('protocol')
    if (chunk.error) throw new AiError('upstream')
    if (!Array.isArray(chunk.choices)) throw new AiError('protocol')
    const choice = chunk.choices[0]
    if (!choice) continue // Usage-only events are valid.
    const content = choice.delta?.content
    if (content != null && typeof content !== 'string') throw new AiError('protocol')
    if (content) {
      hasText ||= Boolean(content.trim())
      yield { type: 'delta', text: content }
    }
    if (choice.finish_reason) {
      if (choice.finish_reason === 'length') throw new AiError('truncated')
      if (choice.finish_reason !== 'stop') throw new AiError('filtered')
      if (!hasText) throw new AiError('empty')
      yield { type: 'done' }
      return
    }
  }
  throw new AiError('interrupted')
}

export async function handleAi(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })
  if (request.headers.get('Origin') !== new URL(request.url).origin) return errorResponse('origin', 403)
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return errorResponse('invalid_request', 415)
  const apiKey = request.headers.get('X-AI-Key')?.trim() ?? ''
  if (!/^[\x21-\x7e]{1,4096}$/.test(apiKey)) return errorResponse('invalid_key', 400)
  let payload
  try { payload = await readPayload(request) } catch (error) {
    return errorResponse(error instanceof AiError ? error.code : 'invalid_request', 400)
  }
  if (!payload || typeof payload !== 'object') return errorResponse('invalid_request', 400)
  const { provider, model, action, prompt } = payload as Record<string, unknown>
  if (!isAiProvider(provider) || provider === 'codex' || typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)
    || (action !== 'test' && action !== 'generate' && action !== 'polish')
    || (action !== 'test' && (typeof prompt !== 'string' || !prompt.trim() || prompt.length > AI_PROMPT_LIMIT))) {
    return errorResponse('invalid_request', 400)
  }

  let polishInput: ReturnType<typeof readPolishInput> | undefined
  if (action === 'polish') {
    try { polishInput = readPolishInput(prompt as string) }
    catch { return errorResponse('invalid_request', 400) }
  }
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, AI_TIMEOUT_MS)
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) controller.abort()
  const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort) }
  let upstream: Response
  try {
    upstream = await fetch(ENDPOINTS[provider], {
      // workerd rejects redirect: 'error'. Manual keeps keys on the allowlisted
      // endpoint; the non-2xx check below rejects all redirect responses.
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
      body: JSON.stringify({
        model, stream: true, max_tokens: polishInput ? Math.min(8192, Math.max(768, polishInput.maxOptionCharacters * polishInput.plans.length * 2 + 256)) : 4096,
        ...(polishInput && provider === 'deepseek' ? { thinking: { type: 'disabled' }, response_format: { type: 'json_object' } } : {}),
        messages: [...(polishInput ? [{ role: 'system', content: POLISH_INSTRUCTION }] : []), { role: 'user', content: action === 'test' ? '请只回复：连接成功' : polishInput ? JSON.stringify(polishInput) : prompt }],
      }),
    })
  } catch {
    cleanup()
    return errorResponse(timedOut ? 'timeout' : 'upstream', timedOut ? 504 : 502)
  }
  if (!upstream.ok || !upstream.body || !upstream.headers.get('Content-Type')?.includes('text/event-stream')) {
    cleanup(); controller.abort()
    void upstream.body?.cancel().catch(() => undefined)
    const code = upstream.status === 401 ? 'invalid_key' : upstream.status === 403 ? 'forbidden'
      : upstream.status === 404 ? 'model_unavailable' : [402, 429].includes(upstream.status) ? 'quota'
        : upstream.status === 400 ? 'invalid_request' : upstream.ok ? 'protocol' : 'upstream'
    // Never forward vendor error bodies: they may echo credentials or submitted text.
    return errorResponse(code, 502)
  }

  const iterator = normalizeStream(upstream.body, controller.signal)
  let cancelled = false
  const encoder = new TextEncoder()
  const encode = (event: AiStreamEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const next = await iterator.next()
        if (next.done) { cleanup(); stream.close(); return }
        stream.enqueue(encode(next.value))
        if (next.value.type === 'done') {
          cleanup(); controller.abort(); stream.close()
          await iterator.return(undefined)
        }
      } catch (error) {
        if (!cancelled) {
          stream.enqueue(encode({ type: 'error', code: timedOut ? 'timeout' : error instanceof AiError ? error.code : 'interrupted' }))
          stream.close()
        }
        cleanup(); controller.abort()
      }
    },
    async cancel() { cancelled = true; cleanup(); controller.abort(); await iterator.return(undefined).catch(() => undefined) },
  })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform' } })
}
