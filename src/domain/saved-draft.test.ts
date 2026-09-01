import { describe, expect, it } from 'vitest'
import { normalizeXhsCardSettings, XHS_CARD_TEMPLATES } from './saved-draft'
import { getXhsDefaultPaletteId, getXhsTemplateStyle } from './xhs-template'

describe('normalizeXhsCardSettings', () => {
  it('restores old drafts with an empty image override map', () => {
    expect(normalizeXhsCardSettings({
      template: 'clean',
      showPageNumber: false,
      showFooter: false,
      footerText: '旧稿',
    })).toEqual({
      template: 'clean',
      paletteId: 'paper',
      fontMode: 'template',
      showPageNumber: false,
      showFooter: false,
      footerText: '旧稿',
      imageOverrides: {},
    })
  })

  it.each(XHS_CARD_TEMPLATES)('preserves the %s card template', (template) => {
    const normalized = normalizeXhsCardSettings({ template })
    expect(normalized.template).toBe(template)
    expect(normalized.paletteId).toBe(getXhsDefaultPaletteId(template))
    expect(getXhsTemplateStyle(template).palettes).toHaveLength(4)
  })

  it('preserves a valid template palette and font override', () => {
    expect(normalizeXhsCardSettings({
      template: 'memo',
      paletteId: 'blue-note',
      fontMode: 'serif',
    })).toMatchObject({
      template: 'memo',
      paletteId: 'blue-note',
      fontMode: 'serif',
    })
  })

  it('falls back to the selected template defaults for invalid palette and font values', () => {
    expect(normalizeXhsCardSettings({
      template: 'geometry',
      paletteId: 'not-a-geometry-palette',
      fontMode: 'comic',
    })).toMatchObject({
      template: 'geometry',
      paletteId: 'cobalt-cream',
      fontMode: 'template',
    })
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
