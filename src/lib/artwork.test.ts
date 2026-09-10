import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_STYLES, validImageSize } from '../domain/artwork'
import { generateArtwork, readImageStyles, saveImageStyles } from './artwork'
import { setCodexToken } from './codex-client'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); setCodexToken('') })
describe('image client and styles', () => {
  it.each(['image_timeout', 'image_connection_timeout'])('preserves actionable %s errors without retry', async code => {
    setCodexToken('paired')
    const fetcher = vi.fn(async () => Response.json({ error: { code } }, { status: 504 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(generateArtwork('封面', 'model', new AbortController().signal)).rejects.toMatchObject({ code })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('shares five editable styles and restores custom styles after reload', () => {
    const styles = readImageStyles(); expect(styles).toEqual(IMAGE_STYLES)
    styles.push({ id: 'custom', name: '我的风格', prompt: '浅色钴蓝' }); saveImageStyles(styles)
    expect(readImageStyles()).toEqual(styles); expect(IMAGE_STYLES).toHaveLength(5)
    localStorage.setItem('dispatch.image-styles.v1', '[null]')
    expect(readImageStyles()).toHaveLength(5)
    expect(() => saveImageStyles([{ id: 'empty', name: '', prompt: '' }])).toThrow()
    expect(validImageSize(1880, 800)).toBe(true); expect(validImageSize(4096, 4096)).toBe(false)
  })
  it('requires pairing and only sends explicit text/model to the local endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ dataUrl: 'data:image/png;base64,AQIDBA==' }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(generateArtwork('配图', 'model', new AbortController().signal)).rejects.toMatchObject({ code: 'codex_pairing' })
    expect(fetcher).not.toHaveBeenCalled(); setCodexToken('paired')
    expect(await generateArtwork('配图', 'model', new AbortController().signal)).toBe('data:image/png;base64,AQIDBA==')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:48765/api/codex/images', expect.objectContaining({ body: JSON.stringify({ prompt: '配图', model: 'model' }), credentials: 'omit', redirect: 'error' }))
  })
  it('reports native quota errors without retrying or switching billing', async () => {
    setCodexToken('paired')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'quota' } }), { status: 502 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(generateArtwork('配图', 'model', new AbortController().signal)).rejects.toMatchObject({ code: 'quota' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
