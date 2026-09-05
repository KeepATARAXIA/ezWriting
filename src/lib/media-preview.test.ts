import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountGifPreview, mountVideoPreview, prepareStaticPreviewMedia, restorePreviewGifSources } from './media-preview'
import { prepareXhsImageLayout } from './xhs-image-layout'

const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7'
const cleanups: Array<() => void> = []
const visibility = new Map<Element, (visible: boolean) => void>()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(element: Element) {
      visibility.set(element, visible => this.callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
    }
    disconnect() {}
  })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
})

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  visibility.clear()
})

describe('media preview lifecycle', () => {
  it('keeps original GIF identity and export bytes while removing live preview players', () => {
    const html = `<p><img src="${gif}" alt="动图"></p><video src="blob:video" data-source-block="1"></video>`
    const originalKey = prepareXhsImageLayout(html, {}).images[0].key
    const document = new DOMParser().parseFromString(html, 'text/html')
    prepareStaticPreviewMedia(document)
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('[data-source-block="1"]')?.tagName).toBe('IMG')
    expect(document.querySelector('img')?.src).not.toBe(gif)
    const prepared = prepareXhsImageLayout(document.body.innerHTML, { [originalKey]: { layout: 'full', widthPercent: 75 } })
    expect(prepared.images[0]).toMatchObject({ key: originalKey, widthPercent: 75 })
    const exported = new DOMParser().parseFromString(restorePreviewGifSources(prepared.html), 'text/html')
    expect(exported.querySelector('img')?.getAttribute('src')).toBe(gif)
    expect(exported.querySelector('[data-ez-gif-source]')).toBeNull()
  })

  it('shares one thumbnail decode across views and releases the URL after the last view', async () => {
    const decoders: HTMLImageElement[] = []
    vi.stubGlobal('Image', class {
      constructor() { const image = document.createElement('img'); decoders.push(image); return image }
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['poster'])))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const first = document.createElement('img')
    const second = document.createElement('img')
    const disposeFirst = mountGifPreview(first, gif)
    const disposeSecond = mountGifPreview(second, gif)
    expect(decoders).toHaveLength(0)
    visibility.get(first)!(true)
    visibility.get(second)!(true)
    expect(decoders).toHaveLength(1)
    Object.defineProperties(decoders[0], { naturalWidth: { value: 100 }, naturalHeight: { value: 50 } })
    decoders[0].dispatchEvent(new Event('load'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(first.src).toBe('blob:poster')
    expect(second.src).toBe('blob:poster')
    disposeFirst()
    expect(revoke).not.toHaveBeenCalled()
    disposeSecond()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(revoke).toHaveBeenCalledWith('blob:poster')
    expect(decoders[0].hasAttribute('src')).toBe(false)
  })

  it('plays GIF only on request and stops when it leaves the viewport', () => {
    const container = document.createElement('div')
    const image = document.createElement('img')
    container.append(image)
    cleanups.push(mountGifPreview(image, gif, container))
    const button = container.querySelector('button')!
    expect(image.src).not.toBe(gif)
    button.click()
    expect(image.src).toBe(gif)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    visibility.get(image)!(false)
    expect(image.src).not.toBe(gif)
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('creates the player on request and releases its media source on hiding and unmount', () => {
    const container = document.createElement('div')
    const dispose = mountVideoPreview(container, 'blob:original-video', '演示')
    expect(container.querySelector('video')).toBeNull()
    container.querySelector('button')!.click()
    const video = container.querySelector('video')!
    expect(video.src).toBe('blob:original-video')
    visibility.get(container)!(false)
    expect(container.querySelector('video')).toBeNull()
    expect(video.hasAttribute('src')).toBe(false)
    container.querySelector('button')!.click()
    const secondVideo = container.querySelector('video')!
    dispose()
    expect(secondVideo.hasAttribute('src')).toBe(false)
    expect(container.querySelector('video')).toBeNull()
  })
})
