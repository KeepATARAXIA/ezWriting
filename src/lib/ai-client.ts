import { AI_TIMEOUT_MS, AiError, isAiErrorCode, type AiAction, type AiProfile, type AiProvider } from '../domain/ai'
import { readSseData } from './ai-sse'
import { CODEX_URL, getCodexToken } from './codex-client'

export async function generateAiText(options: {
  provider: AiProvider
  profile: AiProfile
  action: AiAction
  prompt?: string
  signal: AbortSignal
  onText: (text: string) => void
}): Promise<void> {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) controller.abort()
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, AI_TIMEOUT_MS + 5_000)
  try {
    const codex = options.provider === 'codex'
    const token = codex ? getCodexToken() : ''
    if (codex && !token) throw new AiError('codex_pairing')
    const response = await fetch(codex ? `${CODEX_URL}/generate` : '/api/ai/generate', {
      method: 'POST', cache: 'no-store', credentials: 'omit', signal: controller.signal,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(codex ? { 'X-Codex-Token': token } : { 'X-AI-Key': options.profile.apiKey.trim() }) },
      body: JSON.stringify({ provider: options.provider, model: options.profile.model.trim(), action: options.action, ...(options.action !== 'test' ? { prompt: options.prompt } : {}) }),
    })
    if (!response.ok) {
      let data
      try { data = await response.json() } catch { throw new AiError('unavailable') }
      throw new AiError(isAiErrorCode(data?.error?.code) ? data.error.code : 'unavailable')
    }
    if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) throw new AiError('unavailable')
    let hasText = false
    for await (const data of readSseData(response.body, controller.signal)) {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      let event
      try { event = JSON.parse(data) } catch { throw new AiError('protocol') }
      if (event?.type === 'delta' && typeof event.text === 'string') {
        hasText ||= Boolean(event.text.trim())
        options.onText(event.text)
      } else if (event?.type === 'error' && isAiErrorCode(event.code)) {
        throw new AiError(event.code)
      } else if (event?.type === 'done') {
        if (!hasText) throw new AiError('empty')
        return
      } else throw new AiError('protocol')
    }
    throw new AiError('interrupted')
  } catch (error) {
    if (timedOut) throw new AiError('timeout')
    if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    throw error instanceof AiError ? error : new AiError(options.provider === 'codex' ? 'codex_unavailable' : 'network')
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', abort); controller.abort()
  }
}
