import * as xhsMeasurement from '../lib/xhs-pagination-measurement'
import { getXhsTemplateStyle } from '../domain/xhs-template'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { DEFAULT_XHS_CARD_SETTINGS, type XhsCardSettings } from '../domain/saved-draft'
import * as xhsExport from '../lib/xhs-export'
import * as xhsPagination from '../lib/xhs-pagination'
import { clearLocalVideoRegistry, registerLocalVideo } from '../lib/local-video-registry'
import * as wechatTheme from '../lib/wechat-theme'
import { PlatformPreviews } from './platform-previews'

describe('PlatformPreviews editor-to-preview locating', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    clearLocalVideoRegistry()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('centers and highlights the requested source block in the right preview', async () => {
    let resizeCallback: ResizeObserverCallback | null = null
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe() {}
      disconnect() { disconnect() }
      unobserve() {}
    })

    await act(async () => {
      root.render(
        <PlatformPreviews
          activePlatform="wechat"
          title="Preview locate"
          html="<p>First block</p><p>Second block</p><p>Third block</p>"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          previewDevice="desktop"
          onPreviewDeviceChange={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        await new Promise(resolve => window.setTimeout(resolve, 0))
      })
    }

    const viewport = container.querySelector<HTMLElement>('.platform-preview-viewport')!
    let targetOffsetTop = 600
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1600 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === viewport) return new DOMRect(0, 100, 800, 400)
      if (this instanceof HTMLElement && this.dataset.sourceBlock === '1') {
        return new DOMRect(0, 100 + targetOffsetTop - viewport.scrollTop, 500, 40)
      }
      return new DOMRect()
    })
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      viewport.scrollTop = Number(options.top) || 0
    })
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo })

    await act(async () => {
      root.render(
        <PlatformPreviews
          activePlatform="wechat"
          title="Preview locate"
          html="<p>First block</p><p>Second block</p><p>Third block</p>"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          previewDevice="desktop"
          onPreviewDeviceChange={vi.fn()}
          locateRequest={{ blockIndex: 1, requestId: 1 }}
        />,
      )
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        await new Promise(resolve => window.setTimeout(resolve, 0))
      })
    }

    const target = container.querySelector<HTMLElement>('[data-source-block="1"]')
    expect(target?.textContent).toBe('Second block')
    expect(target?.getAttribute('data-preview-selected')).toBe('true')
    expect(target?.classList.contains('preview-located-target')).toBe(true)
    await vi.waitFor(
      () => expect(scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: 'auto' }),
      { timeout: 500 },
    )

    targetOffsetTop += 200
    await act(async () => {
      resizeCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver)
    })
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 620, behavior: 'auto' })
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('lets a preview click cancel pending editor-driven centering and clears its flash', async () => {
    let resizeCallback: ResizeObserverCallback | null = null
    let observing = false
    const disconnect = vi.fn(() => { observing = false })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe() { observing = true }
      disconnect() { disconnect() }
      unobserve() {}
    })
    const onEditTarget = vi.fn()
    const renderPreview = (locateRequest?: { blockIndex: number; requestId: number }) => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Preview takeover"
        html="<p>First block</p><p>Second block</p><p>Third block</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
        onEditTarget={onEditTarget}
        locateRequest={locateRequest}
      />,
    )

    await act(async () => {
      renderPreview()
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const viewport = container.querySelector<HTMLElement>('.platform-preview-viewport')!
    let firstTargetOffsetTop = 600
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1600 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === viewport) return new DOMRect(0, 100, 800, 400)
      if (this.dataset.sourceBlock === '0') {
        return new DOMRect(0, 100 + firstTargetOffsetTop - viewport.scrollTop, 500, 40)
      }
      return new DOMRect()
    })
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      viewport.scrollTop = Number(options.top) || 0
    })
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo })

    await act(async () => {
      renderPreview({ blockIndex: 0, requestId: 1 })
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled(), { timeout: 500 })

    const thirdTarget = container.querySelector<HTMLElement>('[data-source-block="2"]')!
    await act(async () => thirdTarget.click())
    expect(onEditTarget).toHaveBeenLastCalledWith({ kind: 'body', blockIndex: 2 })
    expect(container.querySelector('[data-source-block="2"]')?.getAttribute('data-preview-selected')).toBe('true')
    expect(disconnect).toHaveBeenCalled()

    const callsAfterClick = scrollTo.mock.calls.length
    firstTargetOffsetTop += 200
    await act(async () => {
      if (observing) resizeCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver)
    })
    expect(scrollTo).toHaveBeenCalledTimes(callsAfterClick)

    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 1600))
    })
    expect(container.querySelector('[data-source-block="2"]')?.getAttribute('data-preview-selected')).toBeNull()
  })

  it('locates a fresh editor target after a transient preview selection', async () => {
    const renderPreview = (locateRequest?: { blockIndex: number; requestId: number }) => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Alternating locate"
        html="<p>First block</p><p>Second block</p><p>Third block</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
        onEditTarget={vi.fn()}
        locateRequest={locateRequest}
      />,
    )

    await act(async () => renderPreview())
    await act(async () => container.querySelector<HTMLElement>('[data-source-block="2"]')?.click())
    expect(container.querySelector('[data-source-block="2"]')?.getAttribute('data-preview-selected')).toBe('true')

    await act(async () => {
      renderPreview({ blockIndex: 1, requestId: 1 })
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))
    }

    const locatedTarget = container.querySelector<HTMLElement>('[data-source-block="1"]')
    expect(locatedTarget?.getAttribute('data-preview-selected')).toBe('true')
    expect(locatedTarget?.classList.contains('preview-located-target')).toBe(true)
  })

  it('uses the requested source line when one preview block contains several line targets', async () => {
    await act(async () => {
      root.render(
        <PlatformPreviews
          activePlatform="wechat"
          title="Preview line locate"
          html="<ul><li>项目一</li><li>项目二</li></ul>"
          sourceText={'- 项目一\n- 项目二'}
          sourceLanguage="markdown"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          previewDevice="desktop"
          onPreviewDeviceChange={vi.fn()}
          locateRequest={{ blockIndex: 0, line: 2, requestId: 1 }}
        />,
      )
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const target = container.querySelector<HTMLElement>('[data-source-block="0"][data-source-line="2"]')
    expect(target?.textContent).toBe('项目二')
    expect(target?.getAttribute('data-preview-selected')).toBe('true')
    expect(target?.classList.contains('preview-located-target')).toBe(true)

    await act(async () => {
      root.render(
        <PlatformPreviews
          activePlatform="wechat"
          title="Preview line locate"
          html="<ul><li>项目一</li><li>项目二</li></ul>"
          sourceText={'- 项目一\n- 项目二'}
          sourceLanguage="markdown"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          previewDevice="desktop"
          onPreviewDeviceChange={vi.fn()}
          locateRequest={{ blockIndex: 0, line: 1, requestId: 2 }}
        />,
      )
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    expect(container.querySelector('[data-source-block="0"][data-source-line="1"]')?.getAttribute('data-preview-selected')).toBe('true')
    expect(container.querySelectorAll('.preview-located-target')).toHaveLength(1)
  })

  it('falls back to the matching block when a source line has no separate preview element', async () => {
    await act(async () => {
      root.render(
        <PlatformPreviews
          activePlatform="wechat"
          title="Preview block fallback"
          html={'<p>第一行\n第二行</p>'}
          sourceText={'第一行\n第二行'}
          sourceLanguage="markdown"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          previewDevice="desktop"
          onPreviewDeviceChange={vi.fn()}
          locateRequest={{ blockIndex: 0, line: 2, requestId: 1 }}
        />,
      )
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const target = container.querySelector<HTMLElement>('p[data-source-block="0"]')
    expect(target?.getAttribute('data-source-line')).toBe('1')
    expect(target?.getAttribute('data-preview-selected')).toBe('true')
    expect(target?.classList.contains('preview-located-target')).toBe(true)
  })

  it('only runs the expensive formatter for the active platform', async () => {
    const paginate = vi.spyOn(xhsPagination, 'paginateForXhsCards')
    const applyWechat = vi.spyOn(wechatTheme, 'applyWechatTheme')
    const renderPreview = (activePlatform: 'wechat' | 'xhs' | 'x') => root.render(
      <PlatformPreviews
        activePlatform={activePlatform}
        title="Active formatter"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    )

    await act(async () => renderPreview('x'))
    expect(paginate).not.toHaveBeenCalled()
    expect(applyWechat).not.toHaveBeenCalled()

    await act(async () => renderPreview('xhs'))
    expect(paginate).toHaveBeenCalledTimes(1)
    expect(applyWechat).not.toHaveBeenCalled()

    await act(async () => renderPreview('wechat'))
    expect(applyWechat).toHaveBeenCalledTimes(1)
  })

  it('keeps formatting controls current while rendering a deferred formatting snapshot', async () => {
    const applyWechat = vi.spyOn(wechatTheme, 'applyWechatTheme')
    const currentFormatting = { ...DEFAULT_ARTICLE_FORMATTING, fontSize: 'large' as const }
    const deferredFormatting = { ...DEFAULT_ARTICLE_FORMATTING, fontSize: 'small' as const }

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Deferred formatting"
        html="<p>Body</p>"
        formatting={currentFormatting}
        renderFormatting={deferredFormatting}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(applyWechat).toHaveBeenLastCalledWith(expect.any(String), expect.any(Object), deferredFormatting)
    await act(async () => container.querySelector<HTMLButtonElement>('#wechat-settings-style-trigger')?.click())
    const large = Array.from(container.querySelectorAll<HTMLButtonElement>('#wechat-settings-style-panel [role="radio"]'))
      .find(button => button.textContent === '大')
    expect(large?.getAttribute('aria-checked')).toBe('true')
  })

  it('shows when the deferred preview is catching up with the editor', async () => {
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="x"
        title="Updating preview"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        isUpdating
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(container.querySelector('.preview-sync-status')?.textContent).toContain('正在同步最新编辑')
    expect(container.querySelector('.preview-sync-status')?.classList.contains('updating')).toBe(true)
  })

  it('defaults WeChat themes to the compact category, keeps All last, and removes the duplicate generic layout control', async () => {
    const onFormattingChange = vi.fn()
    await act(async () => {
      root.render(
        <PlatformPreviews
          activePlatform="wechat"
          title="Theme preview"
          html="<h2>Heading</h2><p>Body</p>"
          formatting={DEFAULT_ARTICLE_FORMATTING}
          onFormattingChange={onFormattingChange}
          previewDevice="desktop"
          onPreviewDeviceChange={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const categoryButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.wechat-theme-categories button'))
    expect(categoryButtons.map(button => button.textContent)).toEqual(['简约', '书卷', '杂志', '商务', '科技', '活力', '全部'])
    expect(categoryButtons[0].getAttribute('aria-selected')).toBe('true')
    expect(container.querySelectorAll('.wechat-theme-card').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.wechat-theme-card').length).toBeLessThan(26)
    expect(container.querySelectorAll('.wechat-theme-card .wechat-theme-graphic')).toHaveLength(
      container.querySelectorAll('.wechat-theme-card').length,
    )
    expect(container.querySelectorAll('.wechat-theme-card [data-preview-part="title"]')).toHaveLength(
      container.querySelectorAll('.wechat-theme-card').length,
    )
    expect(container.querySelectorAll('.wechat-theme-card [data-preview-part="quote"]')).toHaveLength(
      container.querySelectorAll('.wechat-theme-card').length,
    )
    expect(container.querySelector('.wechat-theme-card .wechat-theme-preview-document')).toBeNull()
    expect(container.querySelectorAll('.wechat-theme-card .wechat-theme-select-target')).toHaveLength(
      container.querySelectorAll('.wechat-theme-card').length,
    )
    expect(container.querySelector('.wechat-layout')?.classList.contains('tool-rail-open')).toBe(false)
    await act(async () => container.querySelector<HTMLButtonElement>('.preview-settings-toggle')?.click())
    expect(container.querySelector('.wechat-viewport')?.nextElementSibling?.classList.contains('preview-tool-resizer')).toBe(true)
    expect(container.querySelector('.preview-context-actions .preview-settings-toggle')?.getAttribute('aria-label')).toContain('排版')
    expect(container.querySelector('.wechat-content [data-wechat-theme="literary"]')).not.toBeNull()
    expect(container.querySelector('#wechat-settings-layout-trigger')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelectorAll('#wechat-theme-panel .inspector-tabs [role="tab"]')).toHaveLength(2)
    expect(container.querySelector('#wechat-settings-layout-panel [aria-label="选择文章版式"]')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('#wechat-settings-style-trigger')?.click())
    expect(container.querySelector('#wechat-settings-layout-trigger')?.getAttribute('aria-selected')).toBe('false')
    expect(container.querySelector('#wechat-settings-style-trigger')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelectorAll('#wechat-theme-panel .inspector-tab-panel:not([hidden])')).toHaveLength(1)
    const lineHeightControls = container.querySelector<HTMLElement>('[aria-label="选择文章行距"]')!
    const airyButton = Array.from(lineHeightControls.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '宽松')!
    await act(async () => airyButton.click())
    expect(onFormattingChange).toHaveBeenCalledWith(expect.objectContaining({ lineHeight: 'airy' }))
    onFormattingChange.mockClear()

    await act(async () => container.querySelector<HTMLButtonElement>('#wechat-settings-layout-trigger')?.click())
    await act(async () => categoryButtons.at(-1)?.click())
    const cards = container.querySelectorAll<HTMLElement>('.wechat-theme-card')
    expect(cards).toHaveLength(26)
    const swiss = Array.from(cards).find(card => card.textContent?.includes('瑞士索引'))!
    const swissSelect = swiss.querySelector<HTMLButtonElement>('.wechat-theme-select-target')!

    await act(async () => swissSelect.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(container.querySelector('.wechat-content [data-wechat-theme="literary"]')).not.toBeNull()
    expect(container.querySelector('.wechat-content [data-wechat-theme="swiss-index"]')).toBeNull()
    expect(onFormattingChange).not.toHaveBeenCalled()

    await act(async () => swissSelect.click())
    expect(container.querySelector('.wechat-content [data-wechat-theme="swiss-index"]')).not.toBeNull()
    expect(onFormattingChange).not.toHaveBeenCalled()
    await act(async () => container.querySelector<HTMLButtonElement>('.wechat-theme-action-buttons .primary-button')?.click())
    expect(onFormattingChange).toHaveBeenCalledWith(expect.objectContaining({
      wechat: expect.objectContaining({ themeId: 'swiss-index' }),
    }))
  })

  it('restores unapplied themes and styles, and discards previews on close or platform change', async () => {
    const onFormattingChange = vi.fn()
    const render = (platform: 'wechat' | 'x' = 'wechat', formatting = DEFAULT_ARTICLE_FORMATTING) => root.render(
      <PlatformPreviews activePlatform={platform} title="主题试用" html="<p>保留正文</p>"
        formatting={formatting} onFormattingChange={onFormattingChange}
        previewDevice="desktop" onPreviewDeviceChange={vi.fn()} />,
    )
    const click = async (selector: string) => act(async () => container.querySelector<HTMLButtonElement>(selector)!.click())
    await act(async () => render())
    await click('.preview-settings-toggle')
    await click('button[aria-label^="预览克莱因蓝主题"]')
    await click('#wechat-settings-style-trigger')
    await click('[aria-label="选择文章字号"] button:last-child')
    expect(onFormattingChange).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLButtonElement>('.wechat-copy-button')!.disabled).toBe(true)
    await click('.wechat-theme-action-buttons button:first-child')
    expect(container.querySelector('.wechat-content [data-wechat-theme="literary"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="选择文章字号"] button:last-child')?.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector<HTMLButtonElement>('.wechat-copy-button')!.disabled).toBe(false)
    await click('#wechat-settings-layout-trigger')
    await click('button[aria-label^="预览克莱因蓝主题"]')
    await click('.settings-close')
    expect(container.querySelector('.wechat-content [data-wechat-theme="literary"]')).not.toBeNull()
    await click('.preview-settings-toggle')
    await click('button[aria-label^="预览克莱因蓝主题"]')
    await act(async () => render('x'))
    await act(async () => render())
    expect(container.querySelector('.wechat-content [data-wechat-theme="literary"]')).not.toBeNull()
    await click('button[aria-label^="预览克莱因蓝主题"]')
    const externalFormatting = { ...DEFAULT_ARTICLE_FORMATTING, fontSize: 'small' as const }
    await act(async () => render('wechat', externalFormatting))
    expect(container.querySelector('.wechat-content [data-wechat-theme="literary"]')).not.toBeNull()
    expect(onFormattingChange).not.toHaveBeenCalled()
  })

  it('copies the inline-styled WeChat body as rich HTML', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    let clipboardPayload: Record<string, Blob> | undefined
    class ClipboardItemMock {
      constructor(payload: Record<string, Blob>) {
        clipboardPayload = payload
      }
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemMock)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    })

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Clipboard preview"
        html="<h2>复制标题</h2><p>保留公众号排版</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="复制公众号格式"]')!
    await act(async () => {
      copyButton.click()
      await Promise.resolve()
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(clipboardPayload?.['text/html']).toBeInstanceOf(Blob)
    expect(clipboardPayload?.['text/html'].type).toBe('text/html')
    expect(clipboardPayload?.['text/plain'].type).toBe('text/plain')
    expect(copyButton.getAttribute('aria-label')).toContain('已复制')
    expect(copyButton.getAttribute('aria-label')).toBe('公众号格式已复制')
  })

  it('keeps right-side videos static while preserving a playable video in WeChat clipboard HTML', async () => {
    const reference = registerLocalVideo(new Blob(['clip'], { type: 'video/mp4' }))
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7'
    const write = vi.fn().mockResolvedValue(undefined)
    let clipboardPayload: Record<string, Blob> | undefined
    class ClipboardItemMock {
      constructor(payload: Record<string, Blob>) {
        clipboardPayload = payload
      }
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemMock)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    })

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Static video preview"
        html={`<p>正文</p><video controls src="${reference}" data-ez-video-name="演示.mp4"></video><p><img src="${gif}"></p>`}
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(container.querySelector('.wechat-content video')).toBeNull()
    const poster = container.querySelector<HTMLImageElement>('.wechat-content .ez-static-video')!
    expect(poster).not.toBeNull()
    expect(poster.dataset.ezVideoPreview).toBe('static')
    expect(poster.alt).toContain('在左侧编辑区播放')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="复制公众号格式"]')?.click()
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1), { timeout: 800 })
    })

    const copiedHtml = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true })
      reader.addEventListener('error', () => reject(reader.error), { once: true })
      reader.readAsText(clipboardPayload!['text/html'])
    })
    expect(copiedHtml).toContain('<video')
    expect(copiedHtml).toContain('controls=""')
    expect(copiedHtml).toContain('src="data:video/mp4;base64,Y2xpcA=="')
    expect(copiedHtml).not.toContain('data-ez-video-preview')
    expect(copiedHtml).not.toContain('data-ez-video-placeholder')
    expect(copiedHtml).toContain(`src="${gif}"`)
    expect(copiedHtml).not.toContain('data-ez-gif-source')
  })

  it('focuses the left source immediately when a preview block is selected and has no floating edit button', async () => {
    const onEditTarget = vi.fn()
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="x"
        title="Direct edit"
        html="<p>First</p><p>Second</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
        onEditTarget={onEditTarget}
      />,
    ))

    await act(async () => container.querySelector<HTMLElement>('[data-source-block="1"]')?.click())
    expect(onEditTarget).toHaveBeenCalledWith({ kind: 'body', blockIndex: 1 })
    expect(container.querySelector('.preview-edit-action')).toBeNull()
    expect(container.querySelector('.x-layout')?.classList.contains('tool-rail-open')).toBe(false)
    expect(container.querySelector<HTMLElement>('#x-formatting-panel')?.hidden).toBe(true)
    expect(container.querySelector('.preview-tool-collapsed-rail')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开 X 长文排版侧栏"]')?.click())
    expect(container.querySelector('.x-layout')?.classList.contains('tool-rail-open')).toBe(true)
    expect(container.querySelector<HTMLElement>('#x-formatting-panel')?.hidden).toBe(false)

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="收起 X 长文排版侧栏"]')?.click())
    expect(container.querySelector('.x-layout')?.classList.contains('tool-rail-open')).toBe(false)
  })

  it('selects text and standalone image lines separately inside one rendered paragraph', async () => {
    const onEditTarget = vi.fn()
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Mixed paragraph mapping"
        html={'<p>正文内容<img src="first.png" alt="第一张图"><img src="second.png" alt="第二张图"></p>'}
        sourceText={'正文内容\n![第一张图](first.png)\n![第二张图](second.png)'}
        sourceLanguage="markdown"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
        onEditTarget={onEditTarget}
      />,
    ))

    const textTarget = container.querySelector<HTMLElement>('.wechat-content [data-source-line="1"]')
    const firstImageTarget = container.querySelector<HTMLElement>('.wechat-content img[data-source-line="2"]')
    const secondImageTarget = container.querySelector<HTMLElement>('.wechat-content img[data-source-line="3"]')

    expect(textTarget?.textContent).toBe('正文内容')
    expect(firstImageTarget?.getAttribute('alt')).toBe('第一张图')
    expect(secondImageTarget?.getAttribute('alt')).toBe('第二张图')

    await act(async () => firstImageTarget?.click())
    expect(onEditTarget).toHaveBeenLastCalledWith({ kind: 'body', blockIndex: 0, line: 2 })
    expect(container.querySelector('.wechat-content img[data-source-line="2"]')?.getAttribute('data-preview-selected')).toBe('true')
    expect(container.querySelector('.wechat-content p[data-source-block="0"]')?.getAttribute('data-preview-selected')).toBeNull()
  })

  it('renders source spacers without shifting the following editable block mapping', async () => {
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="x"
        title="Blank line mapping"
        html={'<p>第一段</p><div data-source-spacer="true" style="height: 1.72em; min-height: 1.72em; display: block" aria-hidden="true"></div><div data-source-spacer="true" style="height: 1.72em; min-height: 1.72em; display: block" aria-hidden="true"></div><p>第二段</p>'}
        sourceText={'第一段\n\n\n\n第二段'}
        sourceLanguage="markdown"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    const paragraphs = container.querySelectorAll<HTMLElement>('.x-article-content > p')
    const spacers = container.querySelectorAll<HTMLElement>('.x-article-content > [data-source-spacer]')
    expect(paragraphs[0].getAttribute('data-source-block')).toBe('0')
    expect(paragraphs[1].getAttribute('data-source-block')).toBe('1')
    expect(spacers).toHaveLength(2)
    expect(Array.from(spacers).every(spacer => !spacer.hasAttribute('data-source-block'))).toBe(true)
  })

  it('collapses and expands the WeChat and Xiaohongshu right tool rails in place', async () => {
    const onFormattingChange = vi.fn()
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Rail controls"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(container.querySelector<HTMLElement>('#wechat-theme-panel')?.hidden).toBe(true)
    await act(async () => container.querySelector<HTMLButtonElement>('.preview-settings-toggle')?.click())
    const wechatToggle = container.querySelector<HTMLButtonElement>('.preview-context-actions button[aria-label="收起公众号排版侧栏"]')!
    expect(wechatToggle.getAttribute('aria-expanded')).toBe('true')
    await act(async () => wechatToggle.click())
    expect(container.querySelector('.wechat-layout')?.classList.contains('tool-rail-open')).toBe(false)
    expect(container.querySelector<HTMLElement>('#wechat-theme-panel')?.hidden).toBe(true)
    expect(container.querySelector('.preview-tool-collapsed-rail')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('.preview-context-actions button[aria-label="展开公众号排版侧栏"]')).not.toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开公众号排版侧栏"]')?.click())
    expect(container.querySelector('.wechat-layout')?.classList.contains('tool-rail-open')).toBe(true)

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="Rail controls"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        onFormattingChange={onFormattingChange}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(container.querySelector('.xhs-layout')?.classList.contains('tool-rail-open')).toBe(false)
    await act(async () => container.querySelector<HTMLButtonElement>('.preview-settings-toggle')?.click())
    const xhsResizer = container.querySelector<HTMLElement>('[aria-label="调整小红书工具侧栏宽度"]')
    expect(xhsResizer?.getAttribute('role')).toBe('separator')
    expect(xhsResizer?.nextElementSibling?.id).toBe('xhs-tool-panel')
    const categoryTabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="选择模板分类"] [role="tab"]'))
    expect(categoryTabs.map(tab => tab.textContent)).toEqual(['灵感', '杂志', '纸感', '信息', '构成'])
    expect(categoryTabs.find(tab => tab.textContent?.startsWith('信息'))?.getAttribute('aria-selected')).toBe('true')
    const categoryExpectations = [
      ['灵感', '明快、手写与情绪表达', ['灵感备忘', '轻感明快', '涂鸦马克', '黄昏手稿']],
      ['杂志', '网格、几何与编辑设计', ['线条复古', '优雅几何', '杂志先锋', '文艺清新']],
      ['纸感', '手帐、纹理与书卷气质', ['手帐书写', '素雅底纹', '黑白极简', '札记集尘']],
      ['信息', '知识、结构与清晰阅读', ['清晰明朗', '理性现代', '逻辑结构', '简约基础']],
      ['构成', '大图、叙事与色块编排', ['大图纯字', '平实叙事', '拼接色块', '交叉拓扑']],
    ] as const
    expect(container.querySelector('.xhs-template-category-summary')).toBeNull()
    for (const [category, , expectedTemplates] of categoryExpectations) {
      await act(async () => categoryTabs.find(tab => tab.textContent?.startsWith(category))?.click())
      const templateLabels = Array.from(container.querySelectorAll<HTMLElement>('.xhs-template-showcase > footer strong'))
        .map(label => label.textContent)
      expect(container.querySelector('.xhs-template-category-description')).toBeNull()
      expect(templateLabels).toEqual(expectedTemplates)
      expect(container.querySelectorAll('.xhs-template-gallery [role="radio"]')).toHaveLength(4)
      expect(container.querySelectorAll('.xhs-template-gallery .xhs-template-graphic')).toHaveLength(4)
      expect(container.querySelectorAll('.xhs-template-gallery .xhs-template-graphic-panel')).toHaveLength(12)
      expect(container.querySelectorAll('.xhs-template-gallery [data-preview-part="cover"]')).toHaveLength(4)
      expect(container.querySelectorAll('.xhs-template-gallery [data-preview-part="article"]')).toHaveLength(4)
      expect(container.querySelectorAll('.xhs-template-gallery [data-preview-part="image"]')).toHaveLength(4)
      expect(container.querySelectorAll('.xhs-template-gallery .xhs-template-graphic-picture')).toHaveLength(4)
      expect(container.querySelector('.xhs-template-gallery .xhs-template-use-case')).toBeNull()
      expect(container.querySelector('.xhs-template-gallery .xhs-template-preview-page')).toBeNull()
      expect(container.querySelector('.xhs-template-gallery .xhs-template-preview-image')).toBeNull()
    }
    await act(async () => categoryTabs.find(tab => tab.textContent?.startsWith('信息'))?.click())
    expect(container.querySelectorAll('.xhs-template-gallery [role="radio"][aria-checked="true"]')).toHaveLength(1)
    expect(container.querySelector('#xhs-settings-layout-panel [aria-label="选择文章版式"]')).toBeNull()

    const xhsLayoutTrigger = container.querySelector<HTMLButtonElement>('#xhs-settings-layout-trigger')!
    const xhsFontTrigger = container.querySelector<HTMLButtonElement>('#xhs-settings-style-trigger')!
    expect(container.querySelectorAll('#xhs-tool-panel .inspector-tabs [role="tab"]')).toHaveLength(2)
    expect(xhsLayoutTrigger.getAttribute('aria-selected')).toBe('true')
    await act(async () => xhsFontTrigger.click())
    expect(xhsLayoutTrigger.getAttribute('aria-selected')).toBe('false')
    expect(xhsFontTrigger.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelectorAll('#xhs-tool-panel .inspector-tab-panel:not([hidden])')).toHaveLength(1)
    await act(async () => xhsFontTrigger.click())
    expect(xhsLayoutTrigger.getAttribute('aria-selected')).toBe('false')
    expect(container.querySelectorAll('#xhs-tool-panel .inspector-tab-panel:not([hidden])')).toHaveLength(1)
    await act(async () => xhsFontTrigger.click())
    const largeFontButton = Array.from(container.querySelectorAll<HTMLButtonElement>('#xhs-settings-style-panel [aria-label="选择文章字号"] button'))
      .find(button => button.textContent === '大')!
    await act(async () => largeFontButton.click())
    expect(onFormattingChange).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 'large' }))
    expect(container.querySelector('[aria-label="小红书输出信息"]')?.textContent).toContain('输出信息')
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-card-footer-actions button')).map(button => button.getAttribute('aria-label'))).toEqual(['放大查看第 1 张卡片', '下载第 1 张卡片'])
    expect(container.querySelector('.xhs-download-tools .xhs-card-footer-actions')).toBeNull()
    expect(container.querySelector('.xhs-download-tools')).toBeNull()
    expect(container.querySelector('.preview-context-actions [aria-label="下载全部图片"]')).not.toBeNull()

    const xhsViewSwitcher = container.querySelector<HTMLElement>('.preview-context-actions [aria-label="切换小红书预览方式"]')!
    expect(container.querySelector('#xhs-tool-panel [aria-label="切换小红书预览方式"]')).toBeNull()
    await act(async () => Array.from(xhsViewSwitcher.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.getAttribute('aria-label') === '双页预览')?.click())
    expect(container.querySelectorAll('.xhs-card-spread .xhs-card-footer-actions')).toHaveLength(1)

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="收起小红书设置侧栏"]')?.click())
    expect(container.querySelector('.xhs-layout')?.classList.contains('tool-rail-open')).toBe(false)
    expect(container.querySelector<HTMLElement>('#xhs-tool-panel')?.hidden).toBe(true)
    expect(container.querySelector('.preview-tool-collapsed-rail')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开小红书设置侧栏"]')?.click())
    expect(container.querySelector('.xhs-layout')?.classList.contains('tool-rail-open')).toBe(true)
    expect(container.querySelector<HTMLElement>('#xhs-tool-panel')?.hidden).toBe(false)
  })

  it('keeps one WeChat tab open and remembers each platform selection', async () => {
    const formatting = {
      ...DEFAULT_ARTICLE_FORMATTING,
      wechat: { ...DEFAULT_ARTICLE_FORMATTING.wechat, themeId: 'night-film' as const },
    }
    const renderPlatform = async (activePlatform: 'wechat' | 'xhs' | 'x') => {
      await act(async () => root.render(
        <PlatformPreviews
          activePlatform={activePlatform}
          title="Accordion memory"
          html="<p>Body</p>"
          formatting={formatting}
          previewDevice="desktop"
          onPreviewDeviceChange={vi.fn()}
        />,
      ))
    }

    await renderPlatform('wechat')
    const wechatColorTrigger = container.querySelector<HTMLButtonElement>('#wechat-settings-style-trigger')!
    const wechatColorPanelId = wechatColorTrigger.getAttribute('aria-controls')!
    await act(async () => wechatColorTrigger.click())
    expect(wechatColorTrigger.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector(`#${wechatColorPanelId}`)?.getAttribute('role')).toBe('tabpanel')
    expect(container.querySelector(`#${wechatColorPanelId}`)?.getAttribute('aria-labelledby')).toBe(wechatColorTrigger.id)
    expect(container.querySelector('#wechat-settings-style-panel')?.textContent).toContain('重置配色')
    expect(container.querySelectorAll('#wechat-settings-style-panel input[type="color"]').length).toBeGreaterThan(0)

    await renderPlatform('xhs')
    expect(container.querySelector('#xhs-settings-layout-trigger')?.getAttribute('aria-selected')).toBe('true')
    await act(async () => container.querySelector<HTMLButtonElement>('#xhs-settings-style-trigger')?.click())
    expect(container.querySelector('#xhs-settings-style-trigger')?.getAttribute('aria-selected')).toBe('true')

    await renderPlatform('wechat')
    expect(container.querySelector('#wechat-settings-style-trigger')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('#wechat-settings-layout-trigger')?.getAttribute('aria-selected')).toBe('false')
    expect(container.querySelectorAll('#wechat-theme-panel .inspector-tab-panel:not([hidden])')).toHaveLength(1)

    await renderPlatform('xhs')
    expect(container.querySelector('#xhs-settings-style-trigger')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('#xhs-settings-layout-trigger')?.getAttribute('aria-selected')).toBe('false')
    expect(container.querySelectorAll('#xhs-tool-panel .inspector-tab-panel:not([hidden])')).toHaveLength(1)
  })

  it('starts with the X drawer closed despite saved expansion and keeps its formatting options', async () => {
    window.localStorage.setItem('dispatch.preview-tool-rail-open.v2', JSON.stringify({ wechat: true, xhs: true, x: true }))

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="x"
        title="Saved X rail"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(container.querySelector('.x-layout')?.classList.contains('tool-rail-open')).toBe(false)
    expect(container.querySelector<HTMLElement>('#x-formatting-panel')?.hidden).toBe(true)
    await act(async () => container.querySelector<HTMLButtonElement>('.preview-settings-toggle')?.click())
    expect(container.querySelector<HTMLElement>('#x-formatting-panel')?.hidden).toBe(false)
    expect(container.querySelectorAll('#x-formatting-panel .inspector-tabs [role="tab"]')).toHaveLength(2)
    expect(container.querySelector('#x-settings-layout-trigger')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelectorAll('#x-settings-layout-panel [aria-label="选择文章版式"] [role="radio"]')).toHaveLength(3)
    expect(container.querySelector('#x-formatting-panel [aria-label="选择模板分类"]')).toBeNull()
    expect(container.querySelector('#x-formatting-panel .wechat-theme-grid')).toBeNull()
  })

  it('groups 31 Xiaohongshu cards into compact non-overlapping page ranges', async () => {
    vi.spyOn(xhsPagination, 'paginateForXhsCards').mockReturnValue(
      Array.from({ length: 31 }, (_, index) => `<p data-source-block="${index}">第 ${index + 1} 张卡片</p>`),
    )

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="分组跳页"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    const pageJump = container.querySelector<HTMLButtonElement>('.xhs-page-jump-trigger')!
    expect(pageJump.textContent).toContain('01–10')
    expect(pageJump.textContent).toContain('01 / 31')
    expect(pageJump.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[aria-label="选择卡片页码"]')).toBeNull()

    await act(async () => pageJump.click())
    expect(pageJump.getAttribute('aria-expanded')).toBe('true')
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="选择卡片范围"] button')).map(button => button.textContent))
      .toEqual(['01–10', '11–20', '21–30', '31'])
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="选择具体卡片"] button')).map(button => button.textContent))
      .toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'])

    const secondRange = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="选择卡片范围"] button'))
      .find(button => button.textContent === '11–20')!
    await act(async () => secondRange.click())
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="选择具体卡片"] button')).map(button => button.textContent))
      .toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19', '20'])

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="查看第 17 张卡片"]')?.click())
    expect(container.querySelector('[aria-label="选择卡片页码"]')).toBeNull()
    expect(container.querySelector('.xhs-page-jump-trigger')?.textContent).toContain('17 / 31')
    expect(container.querySelector('.xhs-stage .xhs-card-content')?.textContent).toContain('第 17 张卡片')

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="双页预览"]')?.click())
    expect(container.querySelector('.xhs-page-jump-trigger')?.textContent).toContain('17–18 / 31')

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="整体预览"]')?.click())
    expect(container.querySelector('.xhs-page-navigator')).toBeNull()
  })

  it('reuses measured pages for palette changes but invalidates them for font geometry', async () => {
    vi.spyOn(xhsMeasurement, 'waitForXhsPaginationAssets').mockResolvedValue()
    const measure = vi.spyOn(xhsMeasurement, 'createXhsCardPageMeasurer').mockImplementation(() => ({ fits: () => true, dispose: vi.fn() }))
    const palettes = getXhsTemplateStyle(DEFAULT_XHS_CARD_SETTINGS.template).palettes
    const render = (paletteId: string, fontSize: 'medium' | 'large' = 'medium') => root.render(
      <PlatformPreviews activePlatform="xhs" title="颜色缓存" html="<p>正文</p>"
        formatting={{ ...DEFAULT_ARTICLE_FORMATTING, fontSize }}
        xhsSettings={{ ...DEFAULT_XHS_CARD_SETTINGS, paletteId }} previewDevice="desktop" onPreviewDeviceChange={vi.fn()} />,
    )
    await act(async () => render(palettes[0].id))
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
    expect(measure).toHaveBeenCalledTimes(1)
    const pages = container.querySelector('.xhs-card-content')!.innerHTML
    await act(async () => render(palettes[1].id))
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
    expect(measure).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.xhs-card-content')!.innerHTML).toBe(pages)
    expect(container.querySelector('.xhs-card-page')?.getAttribute('data-xhs-palette')).toBe(palettes[1].id)
    await act(async () => render(palettes[1].id, 'large'))
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('discards an older measurement that finishes after a newer article revision', async () => {
    vi.spyOn(xhsMeasurement, 'waitForXhsPaginationAssets').mockResolvedValue()
    const dispose = vi.fn()
    vi.spyOn(xhsMeasurement, 'createXhsCardPageMeasurer').mockImplementation(() => ({ fits: () => true, dispose }))
    let finishOld!: (pages: string[]) => void
    const paginate = vi.spyOn(xhsPagination, 'paginateForXhsCardsAsync')
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValue(['<p>新修订结果</p>'])
    const render = (html: string) => root.render(<PlatformPreviews activePlatform="xhs" title="修订测试" html={html}
      formatting={DEFAULT_ARTICLE_FORMATTING} previewDevice="desktop" onPreviewDeviceChange={vi.fn()} />)
    await act(async () => render('<p>旧正文</p>'))
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
    expect(paginate).toHaveBeenCalledTimes(1)
    await act(async () => render('<p>新正文</p>'))
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)))
    expect(container.querySelector('.xhs-card-content')?.textContent).toBe('新修订结果')
    await act(async () => finishOld(['<p>过期结果</p>']))
    expect(container.querySelector('.xhs-card-content')?.textContent).toBe('新修订结果')
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('defers long Xiaohongshu pagination until the browser is idle', async () => {
    const idleCallbacks: IdleRequestCallback[] = []
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    }))
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    const paginate = vi.spyOn(xhsPagination, 'paginateForXhsCardsAsync').mockResolvedValue(['<p>分页完成</p>'])
    const html = Array.from({ length: 600 }, (_, index) => `<p>第 ${index + 1} 段用于长文分页性能回归。</p>`).join('')

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="长文分页"
        html={html}
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(paginate).not.toHaveBeenCalled()
    expect(container.querySelector('[data-xhs-pagination-pending]')).not.toBeNull()
    await act(async () => idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 20 }))

    expect(paginate).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.xhs-card-content')?.textContent).toContain('分页完成')
  })

  it('keeps page number, footer, signature, and image overrides when switching Xiaohongshu templates', async () => {
    const onXhsSettingsChange = vi.fn()
    const xhsSettings: XhsCardSettings = {
      template: 'clean',
      paletteId: 'paper',
      fontMode: 'template',
      showPageNumber: false,
      showFooter: false,
      footerText: '独立署名',
      imageOverrides: {
        'xhs-image-1': { layout: 'image-right', widthPercent: 52 },
      },
    }

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="模板设置"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        xhsSettings={xhsSettings}
        onXhsSettingsChange={onXhsSettingsChange}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    const editorialCategory = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="选择模板分类"] [role="tab"]'))
      .find(button => button.textContent?.startsWith('杂志'))!
    await act(async () => editorialCategory.click())
    const geometryTemplate = Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-template-gallery button'))
      .find(button => button.getAttribute('aria-label')?.startsWith('优雅几何：'))!
    await act(async () => geometryTemplate.click())

    expect(onXhsSettingsChange).toHaveBeenCalledTimes(1)
    expect(onXhsSettingsChange).toHaveBeenCalledWith({
      ...xhsSettings,
      template: 'geometry',
      paletteId: 'cobalt-cream',
    })
  })

  it('applies template palettes, template fonts, and readable dark highlights as one Xiaohongshu preset', async () => {
    const onXhsSettingsChange = vi.fn()
    const renderSettings = async (settings: XhsCardSettings) => act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="暗色高亮适配"
        html="<p>正文 <mark>需要看清的高亮</mark></p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        xhsSettings={settings}
        onXhsSettingsChange={onXhsSettingsChange}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))
    const memoSettings: XhsCardSettings = {
      ...DEFAULT_XHS_CARD_SETTINGS,
      template: 'memo',
      paletteId: 'yellow-note',
      fontMode: 'template',
    }

    await renderSettings(memoSettings)
    const darkPage = container.querySelector<HTMLElement>('.xhs-card-page')!
    expect(darkPage.dataset.xhsPalette).toBe('yellow-note')
    expect(darkPage.style.getPropertyValue('--xhs-bg')).toBe('#2d2e2c')
    expect(darkPage.style.getPropertyValue('--xhs-highlight-bg')).toBe('#f3d64e')
    expect(darkPage.style.getPropertyValue('--xhs-highlight-ink')).toBe('#171816')
    expect(darkPage.style.getPropertyValue('--xhs-title-font')).toContain('MiSans')
    expect(darkPage.textContent).toContain('需要看清的高亮')

    await act(async () => container.querySelector<HTMLButtonElement>('#xhs-settings-style-trigger')?.click())
    expect(container.querySelectorAll('[aria-label="选择小红书模板色板"]')).toHaveLength(1)
    const bluePalette = container.querySelector<HTMLButtonElement>('#xhs-settings-style-panel [aria-label="蓝标黑色板"]')!
    await act(async () => bluePalette.click())
    expect(onXhsSettingsChange).toHaveBeenLastCalledWith({ ...memoSettings, paletteId: 'blue-note' })

    const blueSettings = { ...memoSettings, paletteId: 'blue-note' }
    await renderSettings(blueSettings)
    const bluePage = container.querySelector<HTMLElement>('.xhs-card-page')!
    expect(bluePage.style.getPropertyValue('--xhs-bg')).toBe('#25292d')
    expect(bluePage.style.getPropertyValue('--xhs-accent')).toBe('#52b7ff')
    expect(container.querySelector<HTMLElement>('.xhs-template-showcase.selected .xhs-template-graphic')?.style.getPropertyValue('--xhs-bg')).toBe('#25292d')

    const journalSettings: XhsCardSettings = {
      ...memoSettings,
      template: 'journal',
      paletteId: 'kraft',
    }
    await renderSettings(journalSettings)
    expect(container.querySelector<HTMLElement>('.xhs-card-page')?.style.getPropertyValue('--xhs-title-font')).toContain('LXGW WenKai')

    await act(async () => container.querySelector<HTMLButtonElement>('#xhs-settings-style-trigger')?.click())
    expect(container.querySelector('.xhs-template-font-intro')?.textContent).toContain('手写楷体')
    const serifFont = Array.from(container.querySelectorAll<HTMLButtonElement>('#xhs-settings-style-panel [aria-label="选择小红书文章字体"] button'))
      .find(button => button.textContent === '宋体')!
    await act(async () => serifFont.click())
    expect(onXhsSettingsChange).toHaveBeenLastCalledWith({ ...journalSettings, fontMode: 'serif' })
  })

  it('selects a Xiaohongshu image and edits its layout and width without editing the source body', async () => {
    const onEditTarget = vi.fn()
    const capture = vi.spyOn(xhsExport, 'captureXhsCard').mockImplementation(async element => {
      expect(element.querySelector('.xhs-media-layout.image-left')).not.toBeNull()
      expect(element.querySelector('.xhs-image-resize-handle')).toBeNull()
      return new Blob(['layout-preview'], { type: 'image/png' })
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:xhs-layout-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="图片排版"
        html={'<p><img src="data:image/png;base64,AAAA" alt="流程图"></p><p>这段文字需要和图片并排。</p>'}
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
        onEditTarget={onEditTarget}
      />,
    ))

    vi.spyOn(container.querySelector<HTMLElement>('.xhs-layout')!, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}),
    })
    vi.spyOn(container.querySelector<HTMLElement>('.xhs-viewport')!, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 820, bottom: 800, width: 820, height: 800, x: 0, y: 0, toJSON: () => ({}),
    })
    vi.spyOn(container.querySelector<HTMLElement>('.xhs-card-page')!, 'getBoundingClientRect').mockReturnValue({
      left: 150, top: 40, right: 650, bottom: 707, width: 500, height: 667, x: 150, y: 40, toJSON: () => ({}),
    })
    const image = container.querySelector<HTMLImageElement>('.xhs-card-content img[data-xhs-image-key]')!
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
      left: 200, top: 150, right: 600, bottom: 400, width: 400, height: 250, x: 200, y: 150, toJSON: () => ({}),
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('img[data-xhs-image-key]')) return new DOMRect(200, 150, 400, 250)
      return new DOMRect()
    })
    await act(async () => image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 320, clientY: 240 })))

    expect(onEditTarget).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.xhs-image-resize-handle')).toHaveLength(4)
    const selectionOverlay = container.querySelector<HTMLElement>('.xhs-image-selection-overlay')!
    expect(selectionOverlay.style.left).toBe('200px')
    expect(selectionOverlay.style.top).toBe('150px')
    expect(selectionOverlay.style.width).toBe('400px')
    expect(selectionOverlay.style.height).toBe('250px')
    expect(container.querySelector('.xhs-image-tools')).toBeNull()
    const popover = container.querySelector<HTMLElement>('.xhs-image-popover')!
    expect(popover).not.toBeNull()
    expect(popover.textContent).toContain('流程图')
    expect(popover.getAttribute('role')).toBe('dialog')
    expect(popover.style.left).toBe('662px')
    expect(popover.style.top).toBe('137.5px')

    const leftLayout = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="选择图片布局"] button'))
      .find(button => button.textContent === '左图右文')!
    await act(async () => leftLayout.click())

    expect(container.querySelector('.xhs-media-layout.image-left')).not.toBeNull()
    const width = container.querySelector<HTMLInputElement>('input[aria-label="调整选中图片宽度"]')!
    expect(width.value).toBe('45')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(width, '55')
      width.dispatchEvent(new Event('input', { bubbles: true }))
      width.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelector<HTMLOutputElement>('.xhs-image-width-control output')?.textContent).toBe('55%')

    const previewButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-card-footer-actions button'))
      .find(button => button.getAttribute('aria-label')?.includes('放大查看'))!
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 1300))
    })
    await act(async () => {
      previewButton.click()
      await vi.waitFor(() => expect(capture).toHaveBeenCalled(), { timeout: 500 })
    })
    expect(container.querySelector('.xhs-export-sheet')).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('.xhs-image-preview-close')?.click())

    await act(async () => container.querySelector<HTMLButtonElement>('.xhs-image-reset')?.click())
    expect(container.querySelector('.xhs-media-layout')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[aria-label="调整选中图片宽度"]')?.value).toBe('100')

    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(container.querySelector('.xhs-image-popover')).toBeNull()

    await act(async () => container.querySelector<HTMLElement>('.xhs-card-content [data-source-block="1"]')?.click())
    expect(onEditTarget).toHaveBeenCalledWith({ kind: 'body', blockIndex: 1 })
  })

  it('previews Xiaohongshu image resizing in the DOM and commits settings only once on release', async () => {
    const onXhsSettingsChange = vi.fn()
    const settings: XhsCardSettings = {
      template: 'clean',
      paletteId: 'paper',
      fontMode: 'template',
      showPageNumber: true,
      showFooter: true,
      footerText: 'EZWRITING',
      imageOverrides: {},
    }
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="拖动性能"
        html={'<p><img src="data:image/png;base64,AAAA" alt="流程图"></p><p>配套文字</p>'}
        formatting={DEFAULT_ARTICLE_FORMATTING}
        xhsSettings={settings}
        onXhsSettingsChange={onXhsSettingsChange}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    const content = container.querySelector<HTMLElement>('.xhs-card-content')!
    const image = content.querySelector<HTMLImageElement>('img[data-xhs-image-key]')!
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('xhs-layout')) return new DOMRect(0, 0, 900, 760)
      if (this.classList.contains('xhs-card-content')) return new DOMRect(100, 100, 400, 500)
      if (this.matches('img[data-xhs-image-key]')) return new DOMRect(150, 180, 300, 180)
      return new DOMRect()
    })

    await act(async () => image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 320, clientY: 240 })))
    const handle = container.querySelector<HTMLButtonElement>('.xhs-image-selection-overlay .xhs-image-resize-handle.nw')!

    await act(async () => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 200 }))
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 240 }))
      await new Promise(resolve => window.setTimeout(resolve, 25))
    })

    expect(onXhsSettingsChange).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLImageElement>('.xhs-card-content img[data-xhs-image-key]')?.style.width).toBe('90%')
    expect(container.querySelector('.xhs-image-width-control output')?.textContent).toBe('90%')

    await act(async () => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 240 })))
    expect(onXhsSettingsChange).toHaveBeenCalledTimes(1)
    expect(onXhsSettingsChange).toHaveBeenCalledWith(expect.objectContaining({
      imageOverrides: expect.objectContaining({
        [image.dataset.xhsImageKey!]: { layout: 'full', widthPercent: 90 },
      }),
    }))

    onXhsSettingsChange.mockClear()
    const slider = container.querySelector<HTMLInputElement>('input[aria-label="调整选中图片宽度"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '82')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '78')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onXhsSettingsChange).not.toHaveBeenCalled()
    expect(container.querySelector('.xhs-image-width-control output')?.textContent).toBe('78%')

    await act(async () => slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8 })))
    expect(onXhsSettingsChange).toHaveBeenCalledTimes(1)
    expect(onXhsSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      imageOverrides: expect.objectContaining({
        [image.dataset.xhsImageKey!]: { layout: 'full', widthPercent: 78 },
      }),
    }))
  })

  it('opens each Xiaohongshu card as an image with zoom controls', async () => {
    vi.spyOn(xhsExport, 'captureXhsCard').mockImplementation(async () => {
      expect(document.body.querySelector('.xhs-export-sheet')).not.toBeNull()
      return new Blob(['preview'], { type: 'image/png' })
    })
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:xhs-preview')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="xhs"
        title="Image preview"
        html="<p>Body</p>"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
      />,
    ))

    expect(container.querySelector('.xhs-export-sheet')).toBeNull()

    const previewButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-card-footer-actions button'))
      .find(button => button.getAttribute('aria-label')?.includes('放大查看'))!
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 1300))
    })
    await act(async () => {
      previewButton.click()
      await vi.waitFor(() => expect(xhsExport.captureXhsCard).toHaveBeenCalled(), { timeout: 500 })
    })

    expect(xhsExport.captureXhsCard).toHaveBeenCalledWith(expect.any(HTMLElement))
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(container.querySelector('[role="dialog"][aria-label="小红书第 1 张图片放大预览"]')).not.toBeNull()
    expect(container.querySelector('.xhs-image-zoom-value')?.textContent).toBe('100%')
    expect(container.querySelector('.xhs-export-sheet')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="放大图片"]')?.click())
    expect(container.querySelector('.xhs-image-zoom-value')?.textContent).toBe('125%')

    await act(async () => container.querySelector<HTMLButtonElement>('.xhs-image-preview-close')?.click())
    expect(container.querySelector('.xhs-image-preview-layer')).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:xhs-preview')
  })

  it('selects an individual Markdown list line instead of the whole preview list', async () => {
    const onEditTarget = vi.fn()
    await act(async () => root.render(
      <PlatformPreviews
        activePlatform="wechat"
        title="Line locate"
        html="<ul><li>第一行</li><li>第二行</li><li>第三行</li></ul>"
        sourceText={'- 第一行\n- 第二行\n- 第三行'}
        sourceLanguage="markdown"
        formatting={DEFAULT_ARTICLE_FORMATTING}
        previewDevice="desktop"
        onPreviewDeviceChange={vi.fn()}
        onEditTarget={onEditTarget}
      />,
    ))

    const secondLine = container.querySelector<HTMLElement>('[data-source-line="2"]')
    expect(secondLine?.textContent).toBe('第二行')
    expect(secondLine?.getAttribute('role')).toBe('button')
    await act(async () => secondLine?.click())
    expect(onEditTarget).toHaveBeenCalledWith({ kind: 'body', blockIndex: 0, line: 2 })
    expect(container.querySelector('[data-source-line="2"]')?.getAttribute('data-preview-selected')).toBe('true')
    expect(container.querySelector('ul')?.getAttribute('data-preview-selected')).toBeNull()
  })
})
