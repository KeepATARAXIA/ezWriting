import { describe, expect, it } from 'vitest'
import { prepareXhsImageLayout } from './xhs-image-layout'
import { paginateForXhsCards } from './xhs-pagination'

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

  it('treats a captioned figure as an image-only block and keeps its caption attached', () => {
    const html = '<figure class="article-image-figure"><img src="image.png" alt="流程图"><figcaption>图 1：发布流程</figcaption></figure><p>配套说明文字</p>'
    const initial = prepareXhsImageLayout(html, {})
    const key = initial.images[0].key
    const prepared = prepareXhsImageLayout(html, { [key]: { layout: 'image-left', widthPercent: 46 } })
    const document = new DOMParser().parseFromString(prepared.html, 'text/html')

    expect(prepared.images[0].canPair).toBe(true)
    expect(document.querySelector('.xhs-media-image figcaption')?.textContent).toBe('图 1：发布流程')
    expect(document.querySelector('.xhs-media-text')?.textContent).toBe('配套说明文字')
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

  it('splits text and consecutive images into independently paginated blocks', () => {
    const html = '<p data-source-block="12" role="button" tabindex="0"><u>第一张图前的说明</u>\n<img src="one.png" alt="图一" data-source-line="42"><img src="two.png" alt="图二" data-source-line="43"><strong>两张图后的结论</strong><img src="three.png" alt="图三" data-source-line="45"></p>'

    const prepared = prepareXhsImageLayout(html, {})
    const document = new DOMParser().parseFromString(prepared.html, 'text/html')
    const blocks = Array.from(document.body.children)
    const pages = paginateForXhsCards(prepared.html, { title: '连续图片分页' })
    const imagesPerPage = pages.map(page => new DOMParser().parseFromString(page, 'text/html').images.length)

    expect(blocks.map(block => block.querySelectorAll('img').length)).toEqual([0, 1, 1, 0, 1])
    expect(blocks.every(block => block.getAttribute('data-source-block') === '12')).toBe(true)
    expect(document.querySelector('u')?.textContent).toBe('第一张图前的说明')
    expect(document.querySelector('strong')?.textContent).toBe('两张图后的结论')
    expect(Array.from(document.images, image => image.dataset.sourceLine)).toEqual(['42', '43', '45'])
    expect(imagesPerPage.reduce((total, count) => total + count, 0)).toBe(3)
    expect(Math.max(...imagesPerPage)).toBeLessThanOrEqual(2)
    expect(pages.length).toBeGreaterThan(1)
  })
})
