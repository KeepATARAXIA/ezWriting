import { AiError, isAiErrorCode } from '../domain/ai'

export const CODEX_URL = 'http://127.0.0.1:48765/api/codex'
const TOKEN_KEY = 'dispatch.codex-connection.v1'
let connectionToken = ''

// The connector's pairing code is separate from OpenAI credentials and draft storage.
export function getCodexToken(): string {
  try { return window.sessionStorage.getItem(TOKEN_KEY) ?? connectionToken } catch { return connectionToken }
}
export function setCodexToken(token: string) {
  connectionToken = token.trim()
  try {
    if (connectionToken) window.sessionStorage.setItem(TOKEN_KEY, connectionToken)
    else window.sessionStorage.removeItem(TOKEN_KEY)
  } catch { /* Session memory still supports browsers that block storage. */ }
}

export interface CodexStatus {
  plan: string | null
  models: { id: string; name: string; isDefault: boolean }[]
  limits: { name: string; windows: { usedPercent: number; minutes: number; resetsAt: number }[] }[]
}

export async function readCodexStatus(token: string, signal: AbortSignal): Promise<CodexStatus> {
  try {
    const response = await fetch(`${CODEX_URL}/status`, { method: 'POST', cache: 'no-store', credentials: 'omit',
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
      headers: { 'Content-Type': 'application/json', 'X-Codex-Token': token.trim() }, body: '{}' })
    const data = await response.json()
    if (!response.ok) throw new AiError(isAiErrorCode(data?.error?.code) ? data.error.code : 'codex_unavailable')
    if (!Array.isArray(data?.models) || !Array.isArray(data?.limits)) throw new AiError('protocol')
    return data as CodexStatus
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    throw error instanceof AiError ? error : new AiError('codex_unavailable')
  }
}
