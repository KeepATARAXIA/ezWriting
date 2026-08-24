import { describe, expect, it } from 'vitest'
import { normalizeXhsCardSettings } from './saved-draft'

describe('normalizeXhsCardSettings', () => {
  it('restores old drafts with an empty image override map', () => {
    expect(normalizeXhsCardSettings({
      template: 'clean',
      showPageNumber: false,
      showFooter: false,
      footerText: '旧稿',
    })).toEqual({
      template: 'clean',
      showPageNumber: false,
      showFooter: false,
      footerText: '旧稿',
      imageOverrides: {},
    })
  })

  it.each(['index', 'headline'] as const)('preserves the %s card template', (template) => {
    expect(normalizeXhsCardSettings({ template }).template).toBe(template)
  })

  it('falls back to focus for an invalid card template', () => {
    expect(normalizeXhsCardSettings({ template: 'unknown' }).template).toBe('focus')
  })

  it('drops invalid image overrides and clamps valid widths by layout', () => {
    expect(normalizeXhsCardSettings({
      imageOverrides: {
        full: { layout: 'full', widthPercent: 130 },
        split: { layout: 'image-right', widthPercent: 8 },
        invalid: { layout: 'stacked', widthPercent: 50 },
      },
    }).imageOverrides).toEqual({
      full: { layout: 'full', widthPercent: 100 },
      split: { layout: 'image-right', widthPercent: 30 },
    })
  })
})
