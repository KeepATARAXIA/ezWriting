import { clearLocalVideoRegistry, localVideoBlob, expandLocalVideoReferences } from './local-video-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compactArticleMedia, expandLocalImageReferences, localImageBlob, registerLocalImage, retainLocalImageReferences } from './local-image-registry'
import { sanitizeContentHtml } from './markdown-compatibility'
import { updateArticleFromSource } from './article-source'
import { prepareXhsImageLayout } from './xhs-image-layout'
import { isGifSource } from './media-preview'
import type { ArticleDraft } from '../domain/article'

const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7'
afterEach(() => { retainLocalImageReferences([]); clearLocalVideoRegistry(); vi.restoreAllMocks() })

describe('local image runtime references', () => {
  it('reuses the original bytes and preserves GIF identity through sanitization', async () => {
    const source = registerLocalImage(gif)
    expect(source).toMatch(/^blob:/)
    expect(registerLocalImage(gif)).toBe(source)
    expect(isGifSource(source)).toBe(true)
    expect(localImageBlob(source)?.type).toBe('image/gif')
    expect(Array.from(new Uint8Array(await localImageBlob(source)!.arrayBuffer())))
      .toEqual(Array.from(atob(gif.split(',')[1]), character => character.charCodeAt(0)))
    const clean = sanitizeContentHtml(`<img src="${source}" onerror="alert(1)"><script>bad()</script>`)
    expect(clean).toContain(source)
    expect(clean).not.toContain('onerror')
    expect(clean).not.toContain('script')
    expect(expandLocalImageReferences(clean)).toContain(gif)
    expect(sanitizeContentHtml('<img src="blob:unregistered" onerror="bad()">')).not.toContain('blob:unregistered')
  })

  it('compacts imported inline videos and restores their original bytes at the export boundary', async () => {
    const video = 'data:video/webm;base64,dmlkZW8='
    const article: ArticleDraft = { id: 'video-draft', title: '', html: `<video src="${video}" controls></video>`,
      markdown: `<video src="${video}" controls></video>`, tags: [], warnings: [], sourceFile: 'test.md', sourceKind: 'markdown', importedAt: '' }
    const compact = compactArticleMedia(article)
    const reference = compact.html.match(/src="([^"]+)"/)![1]
    expect(reference).toMatch(/^dispatch-local-video:/)
    expect(compact.markdown).toBe(compact.html)
    expect(localVideoBlob(reference)?.size).toBe(5)
    expect(await expandLocalVideoReferences(compact.html)).toBe(article.html)
  })

  it('keeps all article fields short and parses edits without the multi-megabyte payload', () => {
    const large = `${gif}${'A'.repeat(4 * 1024 * 1024)}`
    const sourceText = `正文\n\n![动图](${large})`
    const article: ArticleDraft = { id: 'image-draft', title: '测试', html: `<p><img src="${large}"></p>`,
      sourceText, markdown: sourceText, sourceLanguage: 'markdown', tags: [], warnings: [],
      sourceFile: 'test.md', sourceKind: 'markdown', importedAt: new Date().toISOString() }
    const compact = compactArticleMedia(article)
    expect(compact.html.length).toBeLessThan(200)
    expect(compact.sourceText!.length).toBeLessThan(200)
    expect(compactArticleMedia(compact)).toBe(compact)
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    const edited = updateArticleFromSource(compact, `${compact.sourceText}\n\n新增正文`)
    expect(Math.max(...parse.mock.calls.map(([text]) => String(text).length))).toBeLessThan(2000)
    expect(expandLocalImageReferences(edited.sourceText!)).toBe(`${sourceText}\n\n新增正文`)
  })

  it('preserves existing image layout keys and only releases media on document replacement', () => {
    const original = prepareXhsImageLayout(`<p><img src="${gif}"></p>`, {})
    const reference = registerLocalImage(gif)
    const compact = prepareXhsImageLayout(`<p><img src="${reference}"></p>`, {
      [original.images[0].key]: { layout: 'full', widthPercent: 60 },
    })
    expect(compact.images[0].key).toBe(original.images[0].key)
    expect(compact.images[0].widthPercent).toBe(60)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    retainLocalImageReferences([`![撤销中的图片](${reference})`])
    expect(revoke).not.toHaveBeenCalled()
    retainLocalImageReferences([])
    expect(revoke).toHaveBeenCalledWith(reference)
    expect(localImageBlob(reference)).toBeUndefined()
  })
})
