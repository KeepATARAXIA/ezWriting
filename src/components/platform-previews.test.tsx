import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import * as xhsExport from '../lib/xhs-export'
import * as xhsPagination from '../lib/xhs-pagination'
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('centers and highlights the requested source block in the right preview', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
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
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' })
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

  it('defaults WeChat themes to the compact category, keeps All last, and shares article formatting controls', async () => {
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
    expect(container.querySelector('.wechat-layout')?.classList.contains('tool-rail-open')).toBe(true)
    expect(container.querySelector('.wechat-viewport')?.nextElementSibling?.classList.contains('preview-tool-resizer')).toBe(true)
    expect(container.querySelector('.preview-context-actions')?.textContent).not.toContain('公众号主题')
    expect(container.querySelector('[data-wechat-theme="literary"]')).not.toBeNull()

    const lineHeightControls = container.querySelector<HTMLElement>('[aria-label="选择文章行距"]')!
    const airyButton = Array.from(lineHeightControls.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '宽松')!
    await act(async () => airyButton.click())
    expect(onFormattingChange).toHaveBeenCalledWith(expect.objectContaining({ lineHeight: 'airy' }))
    onFormattingChange.mockClear()

    await act(async () => categoryButtons.at(-1)?.click())
    const cards = container.querySelectorAll<HTMLButtonElement>('.wechat-theme-card')
    expect(cards).toHaveLength(26)
    const swiss = Array.from(cards).find(card => card.textContent?.includes('瑞士索引'))!

    await act(async () => swiss.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(container.querySelector('[data-wechat-theme="literary"]')).not.toBeNull()
    expect(container.querySelector('[data-wechat-theme="swiss-index"]')).toBeNull()
    expect(onFormattingChange).not.toHaveBeenCalled()

    await act(async () => swiss.click())
    expect(onFormattingChange).toHaveBeenCalledWith(expect.objectContaining({
      wechat: expect.objectContaining({ themeId: 'swiss-index' }),
    }))
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
    expect(copyButton.textContent).toContain('已复制')
    expect(copyButton.getAttribute('aria-label')).toBe('公众号格式已复制')
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
    expect(container.querySelector('.x-layout')?.classList.contains('tool-rail-open')).toBe(true)
    expect(container.querySelector('.preview-context-actions')?.textContent).not.toContain('X 长文排版')

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="收起 X 长文排版侧栏"]')?.click())
    expect(container.querySelector('.x-layout')?.classList.contains('tool-rail-open')).toBe(false)
    const collapsedXPanel = container.querySelector<HTMLElement>('#x-formatting-panel')!
    expect(collapsedXPanel.hidden).toBe(true)

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开 X 长文排版侧栏"]')?.click())
    expect(container.querySelector('.x-layout')?.classList.contains('tool-rail-open')).toBe(true)
    expect(container.querySelector<HTMLElement>('#x-formatting-panel')?.hidden).toBe(false)
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

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="收起公众号主题侧栏"]')?.click())
    expect(container.querySelector('.wechat-layout')?.classList.contains('tool-rail-open')).toBe(false)
    expect(container.querySelector<HTMLElement>('#wechat-theme-panel')?.hidden).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="展开公众号主题侧栏"]')).not.toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开公众号主题侧栏"]')?.click())
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

    expect(container.querySelector('.xhs-layout')?.classList.contains('tool-rail-open')).toBe(true)
    const xhsResizer = container.querySelector<HTMLElement>('[aria-label="调整小红书工具侧栏宽度"]')
    expect(xhsResizer?.getAttribute('role')).toBe('separator')
    expect(xhsResizer?.nextElementSibling?.id).toBe('xhs-tool-panel')
    expect(container.querySelector('[aria-label="小红书样式与排版"]')).not.toBeNull()
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '卡片样式')).toBe(false)
    const largeFontButton = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="小红书样式与排版"] [aria-label="选择文章字号"] button'))
      .find(button => button.textContent === '大')!
    await act(async () => largeFontButton.click())
    expect(onFormattingChange).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 'large' }))
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-card-footer-actions button')).map(button => button.textContent)).toEqual(['放大查看', '下载当前页'])
    expect(container.querySelector('.xhs-download-tools .xhs-card-footer-actions')).toBeNull()
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-download-tools button')).map(button => button.textContent)).toEqual(['下载全部图片'])

    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="切换小红书预览方式"] button'))
      .find(button => button.textContent === '双页')?.click())
    expect(container.querySelectorAll('.xhs-card-spread .xhs-card-footer-actions')).toHaveLength(1)

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="收起小红书工具侧栏"]')?.click())
    expect(container.querySelector('.xhs-layout')?.classList.contains('tool-rail-open')).toBe(false)
    expect(container.querySelector<HTMLElement>('#xhs-tool-panel')?.hidden).toBe(true)

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="展开小红书工具侧栏"]')?.click())
    expect(container.querySelector('.xhs-layout')?.classList.contains('tool-rail-open')).toBe(true)
    expect(container.querySelector<HTMLElement>('#xhs-tool-panel')?.hidden).toBe(false)
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
    await act(async () => image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 320, clientY: 240 })))

    expect(onEditTarget).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.xhs-image-resize-handle')).toHaveLength(4)
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
      .find(button => button.textContent?.includes('放大查看'))!
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
      .find(button => button.textContent?.includes('放大查看'))!
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
