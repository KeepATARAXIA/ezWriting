import { afterEach, describe, expect, it } from 'vitest'
import {
  clearLocalVideoRegistry,
  localVideoBlob,
  registerLocalVideo,
  retainLocalVideoReferences,
} from './local-video-registry'
import { renderMarkdownToSafeHtml, sanitizeContentHtml } from './markdown-compatibility'
import { applyPlatformCompatibility } from './platform-compatibility'
import { prepareXhsImageLayout } from './xhs-image-layout'
import {
  MAX_LOCAL_VIDEO_BYTES,
  isSupportedVideoDataUri,
  validateLocalVideoFile,
} from './video-assets'

afterEach(() => clearLocalVideoRegistry())

describe('local video assets', () => {
  it('accepts MP4 and WebM while rejecting unsupported, empty, oversized, and quota-constrained files', async () => {
    await expect(validateLocalVideoFile(new File(['mp4'], 'demo.mp4', { type: 'video/mp4' }), undefined)).resolves.toBe('video/mp4')
    await expect(validateLocalVideoFile(new File(['webm'], 'demo.webm'), undefined)).resolves.toBe('video/webm')
    await expect(validateLocalVideoFile(new File(['mov'], 'demo.mov', { type: 'video/quicktime' }), undefined)).rejects.toThrow('仅支持 MP4 或 WebM')
    await expect(validateLocalVideoFile(new File([], 'empty.mp4', { type: 'video/mp4' }), undefined)).rejects.toThrow('视频文件为空')
    await expect(validateLocalVideoFile({
      name: 'large.mp4',
      type: 'video/mp4',
      size: MAX_LOCAL_VIDEO_BYTES + 1,
    } as File, undefined)).rejects.toThrow('不能超过 50 MiB')
    await expect(validateLocalVideoFile(new File(['video'], 'demo.mp4', { type: 'video/mp4' }), {
      estimate: async () => ({ quota: 5 * 1024 * 1024, usage: 1 }),
    })).rejects.toThrow('本地存储空间不足')
  })

  it('keeps only local MP4/WebM data in sanitized article HTML', () => {
    const localSource = 'data:video/mp4;base64,AQIDBA=='
    const safe = sanitizeContentHtml(`<video autoplay poster="https://network.test/poster.png" src="${localSource}" data-ez-video-name="演示.mp4"></video>`)
    const safeDocument = new DOMParser().parseFromString(safe, 'text/html')
    const video = safeDocument.querySelector<HTMLVideoElement>('video')

    expect(isSupportedVideoDataUri(video?.getAttribute('src'))).toBe(true)
    expect(video?.controls).toBe(true)
    expect(video?.preload).toBe('metadata')
    expect(video?.autoplay).toBe(false)
    expect(video?.hasAttribute('poster')).toBe(false)
    expect(video?.dataset.ezVideoName).toBe('演示.mp4')

    const unsafe = sanitizeContentHtml('<video controls src="https://network.test/video.mp4"><source src="https://network.test/fallback.mp4"></video>')
    expect(unsafe).not.toContain('<video')
    expect(unsafe).not.toContain('<source')
  })

  it('keeps a registered local video as a compact editable reference', () => {
    const reference = registerLocalVideo(new Blob(['clip'], { type: 'video/mp4' }))
    const safe = sanitizeContentHtml(`<p>正文</p><video controls src="${reference}" data-ez-video-name="演示.mp4"></video>`)

    expect(safe).toContain(reference)
    expect(safe).not.toContain('data:video/')
    expect(localVideoBlob(reference)?.size).toBe(4)
    expect(applyPlatformCompatibility(safe, 'wechat')).not.toContain('<video')
  })

  it('releases videos that are no longer referenced by the active draft', () => {
    const retained = registerLocalVideo(new Blob(['keep'], { type: 'video/mp4' }))
    const released = registerLocalVideo(new Blob(['drop'], { type: 'video/webm' }))

    retainLocalVideoReferences([`<video src="${retained}"></video>`])

    expect(localVideoBlob(retained)?.size).toBe(4)
    expect(localVideoBlob(released)).toBeNull()
  })

  it('renders a compacted local video block from Markdown without losing its source', () => {
    const source = 'data:video/webm;base64,V0VCTQ=='
    const html = renderMarkdownToSafeHtml(`正文\n\n<video controls src="${source}" data-ez-video-name="片段.webm"></video>\n\n结尾`)
    const document = new DOMParser().parseFromString(html, 'text/html')

    expect(document.querySelector<HTMLVideoElement>('video')?.src).toBe(source)
    expect(document.body.textContent).toContain('正文')
    expect(document.body.textContent).toContain('结尾')
    expect(html).not.toContain('embedded-video')
  })

  it('turns videos into explicit native-upload instructions for platform output and XHS cards', () => {
    const html = '<p>正文</p><video controls src="data:video/mp4;base64,AQID" data-ez-video-name="产品演示.mp4"></video>'
    const wechat = applyPlatformCompatibility(html, 'wechat')
    const wechatDocument = new DOMParser().parseFromString(wechat, 'text/html')
    const xhs = prepareXhsImageLayout(html, {})
    const xhsDocument = new DOMParser().parseFromString(xhs.html, 'text/html')

    expect(wechatDocument.querySelector('video')).toBeNull()
    expect(wechatDocument.querySelector('[data-ez-video-placeholder]')?.textContent).toContain('公众号后台')
    expect(wechatDocument.body.textContent).toContain('产品演示.mp4')
    expect(xhsDocument.querySelector('video')).toBeNull()
    expect(xhsDocument.querySelector('[data-ez-video-placeholder]')?.textContent).toContain('小红书原生上传')
  })
})
