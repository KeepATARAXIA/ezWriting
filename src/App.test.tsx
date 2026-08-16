import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
const EDGE_USER_AGENT = `${CHROME_USER_AGENT} Edg/128.0.0.0`
const originalUserAgent = window.navigator.userAgent

const bridgeMocks = vi.hoisted(() => ({
  waitForBridge: vi.fn(),
  getPlatformAccounts: vi.fn(),
  publishDraft: vi.fn(),
}))

vi.mock('./lib/wechatsync-bridge', () => bridgeMocks)

describe('App publishing engine onboarding', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    bridgeMocks.waitForBridge.mockReset()
    bridgeMocks.getPlatformAccounts.mockReset()
    bridgeMocks.publishDraft.mockReset()
    window.localStorage.clear()
    const editorRect = new DOMRect(0, 0, 120, 18)
    Range.prototype.getClientRects = () => [editorRect] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => editorRect
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: CHROME_USER_AGENT })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: originalUserAgent })
  })

  it('starts with one focused import card and defers the full workbench until a file is loaded', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(true)
    bridgeMocks.getPlatformAccounts.mockResolvedValue([
      { id: 'zhihu', name: '知乎', username: '测试账号', raw: { type: 'zhihu' } },
    ])

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('.editor-shell.empty-workbench')).not.toBeNull()
    expect(container.querySelector('.step-rail')).toBeNull()
    expect(container.querySelector('.page-intro')).toBeNull()
    expect(container.querySelector('.workbench-drop-zone')).not.toBeNull()
    expect(container.textContent).toContain('新建或导入一篇稿件')
    expect(container.querySelector('.drop-actions .primary-button')?.textContent).toContain('新建文档')
    expect(container.querySelector('.drop-actions .folder-button')?.textContent).toContain('选择文件')
    expect(container.querySelector('.directory-link')?.textContent).toContain('选择文章文件夹')
    expect(Array.from(container.querySelectorAll('.format-tags span')).map(tag => tag.textContent)).toEqual(['Markdown', 'HTML', 'ZIP'])
    expect(container.querySelector('.workbench-commandbar')).toBeNull()
    expect(container.querySelector('.editor-grid')).toBeNull()
    expect(container.querySelector('.preview-lane')).toBeNull()
    expect(container.querySelector('[role="separator"]')).toBeNull()
    expect(container.querySelectorAll('.platform-switcher button[role="tab"]')).toHaveLength(0)
    expect(container.querySelector('button[aria-label^="打开发布面板"]')).toBeNull()
  })

  it('creates an editable blank document without requiring a file', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })

    const newDocumentButton = container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')!
    await act(async () => newDocumentButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 20)))

    expect(container.querySelector('.editor-shell.has-article')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('')
    expect(container.querySelector('.content-editor-section')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="导入文档"]')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('.new-document-button')?.textContent).toContain('新建')
    expect(container.querySelector('.workbench-source')).toBeNull()
    expect(container.querySelectorAll('.workspace-mode-switcher button')).toHaveLength(3)
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="同时显示编辑端和预览端"]')?.getAttribute('aria-pressed')).toBe('true')

    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(titleInput, '当前稿件')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.new-document-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('')
  })

  it('imports into a new document by appending or replacing the current content', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 20)))

    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(titleInput, '保留当前标题')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const chooseImportMode = async (label: string) => {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="导入文档"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      const option = Array.from(container.querySelectorAll<HTMLButtonElement>('.editor-import-menu [role="menuitem"]'))
        .find(button => button.textContent?.includes(label))!
      await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    }

    const importFile = async (content: string, name: string) => {
      const input = container.querySelector<HTMLInputElement>('.editor-import-input')!
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [new File([content], name, { type: 'text/markdown' })],
      })
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(resolve => window.setTimeout(resolve, 0))
      })
      const expectedBody = content.split(/\n+/).at(-1) || ''
      await vi.waitFor(
        () => expect(container.querySelector('.source-editor .cm-content')?.textContent).toContain(expectedBody),
        { timeout: 3000 },
      )
    }

    await chooseImportMode('追加到当前内容')
    await importFile('# 第一份导入稿\n\n第一段追加正文。', 'first.md')
    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('保留当前标题')
    expect(container.querySelector('.source-editor .cm-content')?.textContent).toContain('第一段追加正文。')

    await chooseImportMode('追加到当前内容')
    await importFile('# 第二份导入稿\n\n第二段追加正文。', 'second.md')
    expect(container.querySelector('.source-editor .cm-content')?.textContent).toContain('第一段追加正文。')
    expect(container.querySelector('.source-editor .cm-content')?.textContent).toContain('第二段追加正文。')

    await chooseImportMode('替换当前内容')
    await importFile('# 替换后的标题\n\n只保留替换正文。', 'replacement.md')
    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('替换后的标题')
    expect(container.querySelector('.source-editor .cm-content')?.textContent).toContain('只保留替换正文。')
    expect(container.querySelector('.source-editor .cm-content')?.textContent).not.toContain('第一段追加正文。')
    expect(container.querySelector('.source-editor .cm-content')?.textContent).not.toContain('第二段追加正文。')
  })

  it('shows the one-time setup when the extension is missing', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<StrictMode><App /></StrictMode>)
      await Promise.resolve()
    })

    const input = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['# 测试稿件\n\n正文'], 'draft.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const publishTrigger = container.querySelector<HTMLButtonElement>('button[aria-label^="打开发布面板"]')!
    await act(async () => publishTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(container.textContent).toContain('在 Chrome 中安装发布引擎')
    expect(container.textContent).toContain('回到这里')
    expect(container.querySelector('.publish-settings-trigger')).toBeNull()
    expect(container.querySelector('.draft-picker-trigger')).toBeNull()
    expect(bridgeMocks.getPlatformAccounts).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLAnchorElement>('a[href*="chromewebstore.google.com"]')).not.toBeNull()
  })

  it('opens the Edge-specific installation guide from the waiting engine status', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: EDGE_USER_AGENT })
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const engineStatus = container.querySelector<HTMLButtonElement>('button[aria-label="打开发布引擎安装指引"]')!
    expect(engineStatus.textContent).toContain('发布引擎待连接')
    await act(async () => engineStatus.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('#dispatch-drawer-title')?.textContent).toBe('安装发布引擎')
    expect(container.textContent).toContain('在 Edge 中安装发布引擎')
    expect(container.textContent).toContain('edge://extensions')
    expect(container.querySelector<HTMLAnchorElement>('a[href*="wpics.oss-cn-shanghai.aliyuncs.com"]')?.textContent).toContain('下载 Edge 兼容安装包')
    expect(container.querySelector<HTMLAnchorElement>('a[href*="chromewebstore.google.com"]')?.textContent).toContain('也可从 Chrome 扩展商店安装')
    expect(bridgeMocks.waitForBridge).toHaveBeenCalledTimes(1)
  })

  it('selects publishing platforms inside the unified publish panel', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(true)
    bridgeMocks.getPlatformAccounts.mockResolvedValue([
      { id: 'zhihu', name: '知乎', username: '测试账号', raw: { type: 'zhihu' } },
    ])

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const input = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['# 测试稿件\n\n正文'], 'draft.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const publishTrigger = container.querySelector<HTMLButtonElement>('button[aria-label^="打开发布面板"]')!
    expect(publishTrigger.textContent).toContain('发布')
    expect(publishTrigger.textContent).toContain('0/1')
    await act(async () => publishTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(container.textContent).toContain('选择发布平台')
    const platform = container.querySelector<HTMLButtonElement>('.platform-row')!
    expect(platform.textContent).toContain('知乎')
    await act(async () => platform.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(platform.getAttribute('aria-pressed')).toBe('true')
    expect(publishTrigger.textContent).toContain('1/1')
    expect(container.textContent).toContain('同步到 1 个平台')
  })

  it('reconnects automatically after returning to the page', async () => {
    bridgeMocks.waitForBridge.mockResolvedValueOnce(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })

    bridgeMocks.waitForBridge.mockResolvedValueOnce(true)
    bridgeMocks.getPlatformAccounts.mockResolvedValueOnce([
      { id: 'zhihu', name: '知乎', username: '测试账号', raw: { type: 'zhihu' } },
    ])

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('发布引擎已就绪 · 1 平台')
  })

  it('switches a single large platform preview and lets users supplement missing Markdown images', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)
    window.localStorage.setItem('dispatch.editor-pane-percent', '42')

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })

    const articleInput = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(articleInput, 'files', {
      configurable: true,
      value: [new File(['# 三平台预览\n\n正文内容。\n\n| 平台 | 状态 |\n| --- | --- |\n| 公众号 | 待校对 |\n\n![流程图](assets/flow.png)'], 'article.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      articleInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 20)))

    expect(container.querySelector('.article-info-section')).toBeNull()
    expect(container.querySelector('.content-editor-section')).not.toBeNull()
    expect(container.querySelector('[aria-label="文章标题"]')).not.toBeNull()
    expect(container.textContent).not.toContain('封面图片')
    expect(container.textContent).toContain('正文内容')
    expect(container.querySelector('.article-stats')?.textContent).toContain('字数')
    expect(container.querySelector('.article-stats')?.textContent).toContain('图片 1')
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.platform-switcher button')).map(button => button.getAttribute('aria-label'))).toEqual(['微信公众号', '小红书', 'X 长文'])
    expect(container.querySelectorAll('.platform-switcher .platform-logo')).toHaveLength(3)
    expect(container.querySelector('.workbench-topbar .workbench-navigation > .platform-switcher')).not.toBeNull()
    expect(container.querySelector('.workbench-topbar .workbench-actions > .platform-switcher')).toBeNull()
    expect(container.querySelector('.workbench-commandbar')).toBeNull()
    expect(container.querySelector('.preview-lane .platform-switcher')).toBeNull()
    expect(container.querySelector('.platform-preview-icon')).toBeNull()
    expect(container.querySelector('.single-preview-heading')).toBeNull()
    expect(container.textContent).not.toContain('还差 1 张本地图片')
    expect(container.querySelector('.wechat-document')).not.toBeNull()
    expect(container.querySelector('.xhs-card-page')).toBeNull()
    expect(container.querySelector('.x-article')).toBeNull()
    expect(container.querySelector('.warning-summary')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('1 张图片待处理')
    await act(async () => container.querySelector<HTMLButtonElement>('.warning-summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.warning-details')?.textContent).toContain('未找到图片：assets/flow.png')
    expect(container.querySelector('.source-editor .cm-content')?.textContent).not.toContain('![流程图](assets/flow.png)')
    expect(container.querySelector('.source-editor .source-image-widget.missing')?.textContent).toContain('图片待补齐')
    expect(container.querySelector('.wechat-content .missing-image-card')).not.toBeNull()
    expect(container.querySelector('img[src="assets/flow.png"]')).toBeNull()

    const editorOnlyButton = container.querySelector<HTMLButtonElement>('button[aria-label="仅显示编辑端"]')!
    await act(async () => editorOnlyButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.editor-grid')?.classList.contains('workspace-mode-editor')).toBe(true)
    expect(editorOnlyButton.getAttribute('aria-pressed')).toBe('true')

    const previewOnlyButton = container.querySelector<HTMLButtonElement>('button[aria-label="仅显示预览端"]')!
    await act(async () => previewOnlyButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.editor-grid')?.classList.contains('workspace-mode-preview')).toBe(true)
    expect(previewOnlyButton.getAttribute('aria-pressed')).toBe('true')

    const splitViewButton = container.querySelector<HTMLButtonElement>('button[aria-label="同时显示编辑端和预览端"]')!
    await act(async () => splitViewButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.editor-grid')?.classList.contains('workspace-mode-split')).toBe(true)
    expect(splitViewButton.getAttribute('aria-pressed')).toBe('true')

    const mobilePreview = Array.from(container.querySelectorAll<HTMLButtonElement>('.device-preview-switcher button'))
      .find(button => button.textContent?.includes('手机预览'))!
    await act(async () => mobilePreview.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.preview-device-frame')?.classList.contains('mobile')).toBe(true)
    expect(container.querySelector('[role="dialog"][aria-label*="手机效果预览"]')).not.toBeNull()
    expect(container.querySelector('.phone-device')).not.toBeNull()
    expect(container.querySelector('.preview-workbench .mobile-preview-overlay')).not.toBeNull()
    const closeMobilePreview = container.querySelector<HTMLButtonElement>('button[aria-label="关闭手机预览"]')!
    await act(async () => closeMobilePreview.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.mobile-preview-overlay')).toBeNull()
    expect(container.querySelector('.preview-device-frame')?.classList.contains('desktop')).toBe(true)
    await act(async () => mobilePreview.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const desktopPreview = Array.from(container.querySelectorAll<HTMLButtonElement>('.device-preview-switcher button'))
      .find(button => button.textContent?.includes('电脑预览'))!
    await act(async () => desktopPreview.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.preview-device-frame')?.classList.contains('desktop')).toBe(true)

    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(titleInput, '补图后保留标题')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const resourceTab = container.querySelector<HTMLButtonElement>('[aria-controls="article-resource-view"]')!
    const editTab = container.querySelector<HTMLButtonElement>('[aria-controls="article-edit-view"]')!
    await act(async () => resourceTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('文档资源')
    expect(container.textContent).toContain('还差 1 张本地图片')
    expect(container.querySelectorAll('.article-resource-card')).toHaveLength(1)
    await act(async () => editTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!
    expect(separator.getAttribute('aria-valuenow')).toBe('55')
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(separator.getAttribute('aria-valuenow')).toBe('57')
    expect(window.localStorage.getItem('dispatch.editor-pane-percent.v2')).toBe('57')
    expect(window.localStorage.getItem('dispatch.editor-pane-percent')).toBe('42')

    const editorScroller = container.querySelector<HTMLElement>('.paper-panel')!
    const previewScroller = container.querySelector<HTMLElement>('.platform-preview-viewport')!
    expect(editorScroller).not.toBe(previewScroller)

    const previewBlock = container.querySelector<HTMLElement>('.wechat-content [data-source-block="0"]')!
    await act(async () => {
      previewBlock.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(container.querySelector('.source-editor .cm-content'))
    expect(container.querySelector('.preview-edit-action')).toBeNull()
    expect(container.querySelector('.wechat-content [data-source-block="0"]')?.getAttribute('data-preview-selected')).toBe('true')

    const headingButton = container.querySelector<HTMLButtonElement>('button[aria-label="二级标题"]')!
    expect(headingButton).not.toBeNull()
    expect(container.querySelector('.wechat-content table')).not.toBeNull()
    expect(container.querySelector('.wechat-layout')?.classList.contains('tool-rail-open')).toBe(true)
    const allWechatThemes = Array.from(container.querySelectorAll<HTMLButtonElement>('.wechat-theme-categories button'))
      .find(button => button.textContent === '全部')!
    await act(async () => allWechatThemes.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const wechatTheme = Array.from(container.querySelectorAll<HTMLButtonElement>('.wechat-theme-card'))
      .find(button => button.textContent?.includes('瑞士索引'))!
    await act(async () => wechatTheme.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('[data-wechat-theme="swiss-index"]')).not.toBeNull()

    const platformTabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.platform-switcher button[role="tab"]'))
    const wechatTab = platformTabs.find(button => button.getAttribute('aria-label') === '微信公众号')!
    const xTab = platformTabs.find(button => button.getAttribute('aria-label') === 'X 长文')!
    previewScroller.scrollTop = 240
    await act(async () => previewScroller.dispatchEvent(new Event('scroll', { bubbles: true })))
    await act(async () => xTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.wechat-document')).toBeNull()
    expect(container.querySelector('.x-article')).not.toBeNull()
    expect(container.querySelector('.x-native-editor')).not.toBeNull()
    expect(container.querySelector('.x-native-draftbar')).toBeNull()
    expect(container.querySelector('.x-native-toolbar')).toBeNull()
    expect(container.querySelector('.x-cover-placeholder')).toBeNull()
    expect(container.querySelector('.x-article-cover')).toBeNull()
    expect(container.querySelector('.x-article')?.textContent).toContain('正文内容')
    expect(container.textContent).not.toContain('Thread')

    const xScroller = container.querySelector<HTMLElement>('.platform-preview-viewport')!
    xScroller.scrollTop = 90
    await act(async () => xScroller.dispatchEvent(new Event('scroll', { bubbles: true })))
    await act(async () => wechatTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector<HTMLElement>('.platform-preview-viewport')?.scrollTop).toBe(240)
    await act(async () => xTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector<HTMLElement>('.platform-preview-viewport')?.scrollTop).toBe(90)

    await act(async () => resourceTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const assetInput = container.querySelector<HTMLInputElement>('.resource-panel input[accept="image/*"]')!
    Object.defineProperty(assetInput, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([137, 80, 78, 71])], 'flow.png', { type: 'image/png' })],
    })
    await act(async () => {
      assetInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    expect(container.textContent).not.toContain('还差 1 张本地图片')
    expect(container.querySelector('.x-article img[src^="data:image/png;base64,"]')).not.toBeNull()
    await act(async () => editTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('补图后保留标题')
  })

  it('customizes Xiaohongshu cards and exposes single-page and batch exports', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })

    const articleInput = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    const longArticle = [
      '# 卡片导出测试',
      ...Array.from({ length: 16 }, (_, index) => `## 第 ${index + 1} 节\n\n这是用于验证多页预览的正文内容。每一段都需要保留清晰的阅读层级，并在卡片空间不足时自动进入下一页。这里继续补充一些文字，让单页、双页和整体预览都能展示真实的多卡片状态。`),
    ].join('\n\n')
    Object.defineProperty(articleInput, 'files', {
      configurable: true,
      value: [new File([longArticle], 'cards.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      articleInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 20)))

    const xhsTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
      .find(button => button.textContent?.includes('小红书'))!
    await act(async () => xhsTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(container.querySelector('.xhs-card-page.template-focus')).not.toBeNull()
    expect(container.querySelector('.xhs-card-accent')).toBeNull()
    expect(container.querySelector('.xhs-tool-rail')).not.toBeNull()
    expect(container.querySelectorAll('.xhs-view-modes button')).toHaveLength(3)
    expect(container.textContent).toContain('下载当前页')
    expect(container.textContent).toContain('下载全部图片')

    const settingsButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-tool-rail button'))
      .find(button => button.textContent?.includes('卡片样式'))!
    await act(async () => settingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).not.toContain('顶部色条')
    const cleanTemplate = Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-template-options button'))
      .find(button => button.textContent?.includes('纯净'))!
    await act(async () => cleanTemplate.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const visibleCard = container.querySelector<HTMLElement>('.xhs-stage .xhs-card-page')!
    expect(visibleCard.classList.contains('template-clean')).toBe(true)
    expect(visibleCard.querySelector('.xhs-card-accent')).toBeNull()
    expect(visibleCard.querySelector('.xhs-card-index')).toBeNull()
    expect(visibleCard.querySelector('footer')).toBeNull()

    const spreadButton = container.querySelector<HTMLButtonElement>('button[aria-label="双页预览"]')!
    await act(async () => spreadButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelectorAll('.xhs-card-spread .xhs-card-page')).toHaveLength(2)

    const mobilePreview = Array.from(container.querySelectorAll<HTMLButtonElement>('.device-preview-switcher button'))
      .find(button => button.textContent?.includes('手机预览'))!
    await act(async () => mobilePreview.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.mobile-xhs-preview')).not.toBeNull()
    expect(container.querySelector('.mobile-xhs-card-stage .xhs-card-page')).not.toBeNull()
    expect(container.querySelector('.mobile-xhs-counter')?.textContent).toContain('1/')
    const nextMobileCard = container.querySelector<HTMLButtonElement>('button[aria-label="下一张图片"]')!
    await act(async () => nextMobileCard.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.mobile-xhs-counter')?.textContent).toContain('2/')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="关闭手机预览"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const allButton = container.querySelector<HTMLButtonElement>('button[aria-label="整体预览"]')!
    await act(async () => allButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const overviewCards = container.querySelectorAll('.xhs-overview-item')
    expect(overviewCards.length).toBeGreaterThan(2)
    expect(container.querySelectorAll('.xhs-overview-item figcaption button')).toHaveLength(overviewCards.length * 2)
    expect(Array.from(overviewCards[0].querySelectorAll<HTMLButtonElement>('figcaption button')).map(button => button.getAttribute('aria-label'))).toEqual([
      '放大查看第 1 张卡片',
      '下载第 1 张卡片',
    ])
  })
})
