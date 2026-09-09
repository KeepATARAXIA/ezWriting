import { DEFAULT_POLISH_PRESETS, POLISH_PRESET_LIMIT, readPolishPlans, type PolishPreset } from './ai-polish'

export const POLISH_SETTINGS_KEY = 'dispatch.ai-polish-presets.v1'

export function readPolishSettings(): PolishPreset[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(POLISH_SETTINGS_KEY) ?? 'null')
    if (Array.isArray(saved) && saved.length && saved.length <= POLISH_PRESET_LIMIT
      && saved.every(item => typeof item?.enabled === 'boolean')) {
      return readPolishPlans(saved).map((plan, index) => ({ ...plan, enabled: saved[index].enabled }))
    }
  } catch { /* Invalid or unavailable storage keeps defaults usable. */ }
  return DEFAULT_POLISH_PRESETS.map(preset => ({ ...preset }))
}

export function savePolishSettings(presets: PolishPreset[]): boolean {
  try {
    const plans = readPolishPlans(presets)
    window.localStorage.setItem(POLISH_SETTINGS_KEY, JSON.stringify(plans.map((plan, index) => ({ ...plan, enabled: presets[index].enabled }))))
    return true
  } catch { return false }
}
