import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { XHS_CARD_TEMPLATES, type XhsCardTemplate } from '../domain/saved-draft'
import { createXhsCardPageMeasurer } from './xhs-pagination-measurement'

const templates: XhsCardTemplate[] = [...XHS_CARD_TEMPLATES]

function mockCardBounds() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 540,
    bottom: 720,
    left: 0,
    width: 540,
    height: 720,
    toJSON: () => ({}),
  })
}

function createMeasurer(template: XhsCardTemplate, showFooter = true) {
  return createXhsCardPageMeasurer({
    title: '分页测量标题',
    template,
    showFooter,
    footerText: 'EZWRITING',
    variables: {
      '--article-accent': '#1648ff',
      '--article-font-family': 'sans-serif',
      '--xhs-body-font-size': '14px',
      '--xhs-body-line-height': '1.7',
    },
  })
}

describe('createXhsCardPageMeasurer', () => {
  beforeEach(() => {
    mockCardBounds()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it.each(templates)('uses the same %s template class for measurement', (template) => {
    const measurer = createMeasurer(template)
    expect(measurer).not.toBeNull()

    measurer!.fits('<p>第一页正文</p>', 0)
    const page = document.body.querySelector<HTMLElement>('.xhs-card-page')!
    expect(page.classList.contains(`template-${template}`)).toBe(true)
    expect(page.classList.contains('is-cover')).toBe(true)
    expect(page.querySelector('h1')?.textContent).toBe('分页测量标题')

    measurer!.fits('<p>第二页正文</p>', 1)
    expect(page.classList.contains('is-cover')).toBe(false)
    expect(page.querySelector('h1')).toBeNull()

    measurer!.dispose()
    expect(document.body.querySelector('.xhs-card-page')).toBeNull()
  })

  it('matches the visible footer structure only when footer information is enabled', () => {
    const withFooter = createMeasurer('headline', true)!
    withFooter.fits('<p>正文</p>', 0)
    expect(document.body.querySelector('.xhs-card-page > footer')?.textContent).toBe('EZWRITING00 / 00')
    withFooter.dispose()

    const withoutFooter = createMeasurer('headline', false)!
    withoutFooter.fits('<p>正文</p>', 0)
    expect(document.body.querySelector('.xhs-card-page > footer')).toBeNull()
    withoutFooter.dispose()
  })
})
