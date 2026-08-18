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
