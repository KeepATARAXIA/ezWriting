import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticImageType, wechatImagesForExport } from './wechat-image-export'

afterEach(() => vi.unstubAllGlobals())

describe('WeChat image export', () => {
  it('recognizes static raster bytes and preserves GIF and animated PNG/WebP', () => {
    const bytes = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0))
    expect(staticImageType(bytes('\xff\xd8\xff'))).toBe('image/jpeg')
    expect(staticImageType(bytes('\x89PNG\r\n\x1a\n\0\0\0\0IEND\0\0\0\0'))).toBe('image/png')
    expect(staticImageType(bytes('\x89PNG\r\n\x1a\n\0\0\0\0acTL\0\0\0\0'))).toBeNull()
    expect(staticImageType(bytes('RIFF\0\0\0\0WEBPVP8 \0\0\0\0'))).toBe('image/webp')
    expect(staticImageType(bytes('RIFF\0\0\0\0WEBPANIM\0\0\0\0'))).toBeNull()
    expect(staticImageType(bytes('GIF89a'))).toBeNull()
    expect(staticImageType(bytes('<svg/>'))).toBeNull()
    expect(staticImageType(bytes('\x89PNG\r\n\x1a\n\xff\xff\xff\xffIDAT\0\0\0\0'))).toBeNull()
  })

  it('leaves undecorated images and formula images alone without fetching', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const source = '<p>正文</p><img src="plain.png"><img data-ez-math-image="x" src="math.png" style="border-radius:12px">'
    const output = await wechatImagesForExport(source)
    expect(output.html).toBe(source)
    expect(output.notice).toBe('')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves GIF source, caption and link with a visible limitation', async () => {
    const source = '<a href="https://example.com"><img src="animation.gif" style="border-radius:12px" alt="动图"></a><p>说明</p>'
    const output = await wechatImagesForExport(source)
    expect(output.html).toBe(source)
    expect(output.notice).toContain('1 张')
    expect(output.notice).toContain('保留原图')
  })

  it('rejects blocked remote reads instead of silently copying unframed images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(wechatImagesForExport('<img src="https://example.com/private" style="border:6px solid white">'))
      .rejects.toThrow('第 1 张图片边框合成失败，未复制')
  })
})
