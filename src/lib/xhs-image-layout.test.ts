import { describe, expect, it } from 'vitest'
import { prepareXhsImageLayout } from './xhs-image-layout'

describe('prepareXhsImageLayout', () => {
  it('assigns stable unique keys to images without changing the default full-width flow', () => {
    const html = '<p><img src="data:image/png;base64,AAAA" alt="示例图"></p><p><img src="data:image/png;base64,AAAA" alt="重复图"></p>'

    const first = prepareXhsImageLayout(html, {})
    const second = prepareXhsImageLayout(html, {})
    const document = new DOMParser().parseFromString(first.html, 'text/html')

    expect(first.images.map(image => image.key)).toEqual(second.images.map(image => image.key))
    expect(new Set(first.images.map(image => image.key)).size).toBe(2)
    expect(document.querySelectorAll('[data-xhs-image-key]')).toHaveLength(2)
    expect(document.querySelector('[data-xhs-media-layout]')).toBeNull()
  })

  it('pairs an image with the following text block in left-image or right-image layouts', () => {
    const html = '<p data-source-block="2"><img src="image.png" alt="流程图"></p><p data-source-block="3">配套说明文字</p>'
    const initial = prepareXhsImageLayout(html, {})
    const key = initial.images[0].key

    const left = prepareXhsImageLayout(html, { [key]: { layout: 'image-left', widthPercent: 46 } })
    const leftDocument = new DOMParser().parseFromString(left.html, 'text/html')
    const leftGroup = leftDocument.querySelector<HTMLElement>('[data-xhs-media-layout="image-left"]')
    expect(leftGroup?.style.getPropertyValue('--xhs-image-column')).toBe('46%')
    expect(leftGroup?.querySelector('.xhs-media-image img')?.getAttribute('data-xhs-image-key')).toBe(key)
    expect(leftGroup?.querySelector('.xhs-media-text')?.textContent).toBe('配套说明文字')

    const right = prepareXhsImageLayout(html, { [key]: { layout: 'image-right', widthPercent: 52 } })
    const rightDocument = new DOMParser().parseFromString(right.html, 'text/html')
    const rightGroup = rightDocument.querySelector<HTMLElement>('[data-xhs-media-layout="image-right"]')
    expect(rightGroup?.firstElementChild?.classList.contains('xhs-media-text')).toBe(true)
    expect(rightGroup?.lastElementChild?.classList.contains('xhs-media-image')).toBe(true)
  })

  it('keeps an image full-width when no suitable neighboring text block exists', () => {
    const html = '<p><img src="solo.png" alt="单图"></p><table><tbody><tr><td>数据</td></tr></tbody></table>'
    const initial = prepareXhsImageLayout(html, {})
    const key = initial.images[0].key
    const prepared = prepareXhsImageLayout(html, { [key]: { layout: 'image-left', widthPercent: 45 } })
    const document = new DOMParser().parseFromString(prepared.html, 'text/html')

    expect(document.querySelector('[data-xhs-media-layout]')).toBeNull()
    expect(document.querySelector<HTMLImageElement>('[data-xhs-image-key]')?.dataset.xhsImageLayout).toBe('full')
  })
})
