// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiSession } from '../domain/ai'
import { AI_SETTINGS_KEY, readAiSettings, saveAiSettings } from './ai-settings'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('AI settings persistence', () => {
  it('never persists Codex credentials and migrates old three-provider profiles', () => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ provider: 'deepseek', profiles: { deepseek: { model: 'old-model', apiKey: 'old-key' } } }))
    const session = readAiSettings()
    expect(session.profiles.codex).toEqual({ model: '', apiKey: '' })
    session.provider = 'codex'; session.profiles.codex = { model: 'chosen-codex', apiKey: 'must-not-save' }
    saveAiSettings(session)
    expect(localStorage.getItem(AI_SETTINGS_KEY)).not.toContain('must-not-save')
    expect(readAiSettings().profiles.deepseek.apiKey).toBe('old-key')
  })
  it('restores separate provider keys, custom models and the selected provider', () => {
    const session = createAiSession()
    session.provider = 'glm'
    session.profiles.gemini.apiKey = 'mock-gemini'
    session.profiles.deepseek = { model: 'custom-model', apiKey: 'mock-deepseek' }
    session.profiles.glm.apiKey = 'mock-glm'
    expect(saveAiSettings(session)).toBe(true)
    expect(readAiSettings()).toEqual(session)
    for (const profile of Object.values(session.profiles)) profile.apiKey = ''
    expect(saveAiSettings(session)).toBe(true)
    expect(readAiSettings()).toEqual(session)
    expect(localStorage.getItem(AI_SETTINGS_KEY)).not.toContain('mock-')
  })

  it('ignores malformed storage and invalid fields without losing valid profiles', () => {
    localStorage.setItem(AI_SETTINGS_KEY, '{broken')
    expect(readAiSettings()).toEqual(createAiSession())
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ provider: 'unknown', profiles: {
      gemini: { model: 3, apiKey: {} }, deepseek: { model: 'custom', apiKey: 'mock-key' },
      glm: { model: 'x'.repeat(129), apiKey: 'x'.repeat(4097) },
    } }))
    const restored = readAiSettings()
    expect(restored.provider).toBe('gemini')
    expect(restored.profiles.gemini).toEqual(createAiSession().profiles.gemini)
    expect(restored.profiles.glm).toEqual(createAiSession().profiles.glm)
    expect(restored.profiles.deepseek).toEqual({ model: 'custom', apiKey: 'mock-key' })
  })

  it('returns defaults on blocked reads and reports failed writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(readAiSettings()).toEqual(createAiSession())
    expect(saveAiSettings(createAiSession())).toBe(false)
  })
})
