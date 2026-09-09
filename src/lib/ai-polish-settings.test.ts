import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_POLISH_PRESETS } from './ai-polish'
import { POLISH_SETTINGS_KEY, readPolishSettings, savePolishSettings } from './ai-polish-settings'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

it('restores names, prompts, selection and intensity without retaining unrelated fields', () => {
  const presets = [...DEFAULT_POLISH_PRESETS.map(preset => ({ ...preset, enabled: false, strength: 10 })), {
    name: '我的方案', instruction: '只修改生硬衔接。', strength: 20, enabled: true, secret: 'omit-me',
  }]
  expect(savePolishSettings(presets)).toBe(true)
  expect(readPolishSettings()).toEqual(presets.map(({ name, instruction, strength, enabled }) => ({ name, instruction, strength, enabled })))
  expect(localStorage.getItem(POLISH_SETTINGS_KEY)).not.toContain('omit-me')
})

it('keeps independent defaults after corrupt or unavailable storage and reports save failure', () => {
  for (const data of ['bad', '[]', '[{"name":"bad"}]']) {
    localStorage.setItem(POLISH_SETTINGS_KEY, data)
    const presets = readPolishSettings()
    expect(presets).toEqual(DEFAULT_POLISH_PRESETS)
    presets[0].strength = 0
    expect(DEFAULT_POLISH_PRESETS[0].strength).toBe(50)
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  expect(readPolishSettings()).toEqual(DEFAULT_POLISH_PRESETS)
  expect(savePolishSettings(DEFAULT_POLISH_PRESETS)).toBe(false)
})
