import { AI_PROVIDERS, createAiSession, isAiProvider, type AiSession } from '../domain/ai'

// Separate from draft storage, exports and diagnostics.
export const AI_SETTINGS_KEY = 'dispatch.ai-settings.v1'

export function readAiSettings(): AiSession {
  const session = createAiSession()
  try {
    const saved = JSON.parse(window.localStorage.getItem(AI_SETTINGS_KEY) ?? 'null')
    if (!saved || typeof saved !== 'object') return session
    if (isAiProvider(saved.provider)) session.provider = saved.provider
    for (const provider of Object.keys(AI_PROVIDERS)) {
      if (!isAiProvider(provider)) continue
      const profile = saved.profiles?.[provider]
      if (typeof profile?.model === 'string' && profile.model.length <= 128) session.profiles[provider].model = profile.model
      if (provider !== 'codex' && typeof profile?.apiKey === 'string' && profile.apiKey.length <= 4096) session.profiles[provider].apiKey = profile.apiKey
    }
  } catch { /* Unavailable or malformed storage leaves the default configuration usable. */ }
  return session
}

export function saveAiSettings(session: AiSession): boolean {
  try {
    window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ ...session,
      profiles: { ...session.profiles, codex: { model: session.profiles.codex.model, apiKey: '' } },
    }))
    return true
  } catch { return false }
}
