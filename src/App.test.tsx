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

  it('starts with one primary creation path, clear platform value, and a complete import zone', async () => {
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
    expect(container.textContent).toContain('写一次，适配并发布到多个平台')
    expect(container.textContent).toContain('支持微信公众号、小红书、X 等平台的内容编辑、预览与分发')
    expect(container.querySelectorAll('.drop-actions .primary-button')).toHaveLength(1)
    expect(container.querySelector('.drop-actions .primary-button')?.textContent).toContain('开始写稿')
    expect(container.querySelector('.drop-actions .folder-button')?.textContent).toContain('导入稿件')
    expect(container.querySelector('.home-import-zone .directory-link')?.textContent).toContain('选择文件夹')
    expect(container.querySelector('.home-import-copy')?.textContent).toContain('支持 Markdown、HTML、ZIP')
    expect(Array.from(container.querySelectorAll('.home-platform-list strong')).map(tag => tag.textContent)).toEqual(['公众号', '小红书', 'X'])
    expect(Array.from(container.querySelectorAll('.home-content-flow li')).map(step => step.textContent)).toEqual(['写稿 / 导入', '编辑与平台预览', '导出 / 同步平台草稿'])
    expect(container.querySelector('.home-status-summary')?.textContent).toContain('已连接 1 个平台文件保存在本地')
    expect(container.querySelectorAll('.home-template-card')).toHaveLength(3)
    expect(Array.from(container.querySelectorAll('.home-template-copy strong')).map(template => template.textContent)).toEqual(['公众号长文', '小红书图文', 'X 长文'])
    expect(container.querySelector('.history-sidebar')?.classList.contains('collapsed')).toBe(true)
    expect(container.querySelector('.workbench-commandbar')).toBeNull()
    expect(container.querySelector('.editor-grid')).toBeNull()
    expect(container.querySelector('.preview-lane')).toBeNull()
    expect(container.querySelector('[role="separator"]')).toBeNull()
    expect(container.querySelectorAll('.platform-switcher button[role="tab"]')).toHaveLength(0)
    expect(container.querySelector('button[aria-label^="打开发布面板"]')).toBeNull()

    const importZone = container.querySelector<HTMLElement>('.home-import-zone')!
    await act(async () => importZone.dispatchEvent(new Event('dragenter', { bubbles: true })))
    expect(importZone.classList.contains('dragging')).toBe(true)
    expect(importZone.textContent).toContain('松开即可导入内容')
    await act(async () => importZone.dispatchEvent(new Event('dragleave', { bubbles: true })))
    expect(importZone.classList.contains('dragging')).toBe(false)
  })

  it('exposes the GitHub repository as a direct external icon link', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })

    const link = container.querySelector<HTMLAnchorElement>('.github-repository-link')!
    expect(link.href).toBe('https://github.com/KeepATARAXIA/ezWriting')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    const iconSource = link.querySelector<HTMLImageElement>('img')?.src || ''
    expect(iconSource).toContain('data:image/svg+xml')
    expect(decodeURIComponent(iconSource)).toContain('<title>GitHub</title>')
    expect(container.querySelector('.brand-cluster details')).toBeNull()
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
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="打开发布面板"]')?.disabled).toBe(true)
    expect(container.querySelector('.preview-current-block')).toBeNull()
    expect(container.textContent).not.toContain('在右侧预览')

    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(titleInput, '当前稿件')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.new-document-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('')
  })

  it('creates a real local draft from a platform template and opens the matching preview', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })

    const templateButton = container.querySelector<HTMLButtonElement>('[aria-label="使用小红书图文模板开始"]')!
    await act(async () => templateButton.click())
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 20)))

    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('小红书图文草稿')
    expect(container.querySelector('.editor-grid')?.getAttribute('data-preview-platform')).toBe('xhs')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="小红书"]')?.getAttribute('aria-selected')).toBe('true')
    await vi.waitFor(() => {
      const characterCount = Array.from(container.querySelectorAll<HTMLElement>('.source-document-stats > span'))
        .find(item => item.textContent?.startsWith('字数'))
        ?.querySelector('strong')?.textContent
      expect(Number(characterCount)).toBeGreaterThan(40)
    }, { timeout: 1000 })
  })

  it('uses independent platform pane widths, persists the v3 mapping, and restores only the current platform', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click())

    const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!
    const editorGrid = container.querySelector<HTMLElement>('.editor-grid')!
    expect(separator.getAttribute('aria-valuenow')).toBe('44')
    expect(separator.getAttribute('aria-valuetext')).toBe('编辑区 44%，预览区 56%')
    expect(editorGrid.getAttribute('data-preview-platform')).toBe('wechat')
    expect(Array.from(container.querySelectorAll<HTMLElement>('.topbar-workbench [data-topbar-group]')).map(group => group.dataset.topbarGroup)).toEqual([
      'new',
      'platform',
      'view',
      'status',
      'publish',
    ])

    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(separator.getAttribute('aria-valuenow')).toBe('46')
    expect(JSON.parse(window.localStorage.getItem('dispatch.editor-pane-percent.v3') || '{}')).toEqual({
      wechat: 46,
      xhs: 42,
      x: 40,
    })

    const xhsTab = container.querySelector<HTMLButtonElement>('button[aria-label="小红书"]')!
    const xTab = container.querySelector<HTMLButtonElement>('button[aria-label="X 长文"]')!
    const wechatTab = container.querySelector<HTMLButtonElement>('button[aria-label="微信公众号"]')!
    await act(async () => xhsTab.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('42')
    expect(editorGrid.getAttribute('data-preview-platform')).toBe('xhs')
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(separator.getAttribute('aria-valuenow')).toBe('68')

    await act(async () => xTab.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('40')
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(separator.getAttribute('aria-valuenow')).toBe('38')

    await act(async () => wechatTab.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('46')
    await act(async () => xhsTab.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('68')
    await act(async () => separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(separator.getAttribute('aria-valuenow')).toBe('42')
    expect(JSON.parse(window.localStorage.getItem('dispatch.editor-pane-percent.v3') || '{}')).toEqual({
      wechat: 46,
      xhs: 42,
      x: 38,
    })
    await act(async () => xTab.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('38')
  })

  it('migrates a manual v2 pane preference to WeChat without replacing the new platform defaults', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)
    window.localStorage.setItem('dispatch.editor-pane-percent.v2', '47')

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click())

    const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!
    expect(separator.getAttribute('aria-valuenow')).toBe('47')
    expect(window.localStorage.getItem('dispatch.editor-pane-percent.v3')).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="小红书"]')?.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('42')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="X 长文"]')?.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('40')
  })

  it('restores each platform width from the persisted v3 mapping', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)
    window.localStorage.setItem('dispatch.editor-pane-percent.v3', JSON.stringify({ wechat: 51, xhs: 48, x: 45 }))
    window.localStorage.setItem('dispatch.editor-pane-percent.v2', '47')

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click())

    const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!
    expect(separator.getAttribute('aria-valuenow')).toBe('51')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="小红书"]')?.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('48')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="X 长文"]')?.click())
    expect(separator.getAttribute('aria-valuenow')).toBe('45')
  })

  it('does not mistake the old 55 percent default for a manual v2 preference', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)
    window.localStorage.setItem('dispatch.editor-pane-percent.v2', '55')

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click())

    expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('44')
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
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(titleInput, '保留当前标题')
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

  it('does not turn forged imported missing-image markers into preview actions', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)
    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
    })

    const input = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([`
        <article>
          <h1>伪造缺图动作</h1>
          <p>正文仍应正常显示。</p>
          <img src="https://example.test/allowed.png" data-missing-id="forged" data-missing-asset="victim.png" alt="远程图片">
          <button data-missing-image-action="delete" data-missing-id="forged" data-missing-asset="victim.png">伪造删除</button>
        </article>
      `], 'forged-actions.html', { type: 'text/html' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    expect(container.querySelector('.wechat-content .missing-image-card')).toBeNull()
    expect(container.querySelector('.wechat-content [data-missing-image-action]')).toBeNull()
    expect(container.querySelector('.wechat-content img[src="https://example.test/allowed.png"]')).not.toBeNull()
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
    expect(engineStatus.textContent).toContain('发布通道待连接')
    await act(async () => engineStatus.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('#dispatch-drawer-title')?.textContent).toBe('安装发布引擎')
    expect(container.textContent).toContain('在 Edge 中安装发布引擎')
    expect(container.textContent).toContain('edge://extensions')
    expect(container.querySelector<HTMLAnchorElement>('a[href*="wpics.oss-cn-shanghai.aliyuncs.com"]')?.textContent).toContain('下载已验证安装包 2.0.9')
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
    expect(publishTrigger.textContent).toContain('同步草稿')
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

  it('allows only one publish attempt while an existing attempt is pending', async () => {
    const accounts = [
      { id: 'zhihu', name: '知乎', username: '测试账号', raw: { type: 'zhihu' } },
    ]
    bridgeMocks.waitForBridge.mockResolvedValue(true)
    bridgeMocks.getPlatformAccounts.mockResolvedValue(accounts)
    let resolvePublish: ((results: Array<{ platform: string; name: string; status: 'done'; delivery: 'draft' }>) => void) | undefined
    bridgeMocks.publishDraft.mockImplementation(() => new Promise(resolve => {
      resolvePublish = resolve
    }))

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const input = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['# 互斥发布\n\n正文'], 'publish-once.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="打开发布面板"]')?.click())
    await act(async () => container.querySelector<HTMLButtonElement>('.platform-row')?.click())

    const publishButton = container.querySelector<HTMLButtonElement>('.publish-button')!
    await act(async () => {
      publishButton.click()
      publishButton.click()
      await Promise.resolve()
    })
    expect(bridgeMocks.publishDraft).toHaveBeenCalledTimes(1)
    expect(publishButton.disabled).toBe(true)

    await act(async () => {
      resolvePublish?.([{ platform: 'zhihu', name: '知乎', status: 'done', delivery: 'draft' }])
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('1 个草稿已创建')
  })

  it('retries only failed or unstarted platforms after a later publish group fails', async () => {
    const accounts = [
      { id: 'weixin', name: '微信公众号', username: '微信账号', raw: { type: 'weixin' } },
      { id: 'xiaohongshu', name: '小红书', username: '小红书账号', raw: { type: 'xiaohongshu' } },
    ]
    bridgeMocks.waitForBridge.mockResolvedValue(true)
    bridgeMocks.getPlatformAccounts.mockResolvedValue(accounts)
    bridgeMocks.publishDraft
      .mockResolvedValueOnce([{ platform: 'weixin', name: '微信公众号', status: 'done', delivery: 'draft' }])
      .mockImplementationOnce(async (_article, _accounts, onProgress) => {
        onProgress([{ platform: 'xiaohongshu', name: '小红书', status: 'uploading', delivery: 'draft' }])
        throw new Error('小红书桥接中断')
      })
      .mockResolvedValueOnce([{ platform: 'xiaohongshu', name: '小红书', status: 'done', delivery: 'draft' }])

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const input = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['# 分组重试\n\n正文'], 'retry.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="打开发布面板"]')?.click())
    for (const row of container.querySelectorAll<HTMLButtonElement>('.platform-row')) {
      await act(async () => row.click())
    }

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.publish-button')?.click()
      await vi.waitFor(() => expect(bridgeMocks.publishDraft).toHaveBeenCalledTimes(2))
    })
    expect(container.textContent).toContain('已成功的平台不会在下次重试时自动重发')
    expect(container.textContent).toContain('任务状态未知，请先检查平台草稿箱再重试')
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.platform-row'))
    expect(rows.find(row => row.textContent?.includes('微信公众号'))?.getAttribute('aria-pressed')).toBe('false')
    expect(rows.find(row => row.textContent?.includes('小红书'))?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.publish-button')?.click()
      await vi.waitFor(() => expect(bridgeMocks.publishDraft).toHaveBeenCalledTimes(3))
    })
    expect((bridgeMocks.publishDraft.mock.calls[2][1] as typeof accounts).map(account => account.id)).toEqual(['xiaohongshu'])
  })

  it('keeps the three X layouts out of other platform previews and published drafts', async () => {
    const accounts = [
      { id: 'weixin', name: '微信公众号', username: '微信账号', raw: { type: 'weixin' } },
      { id: 'xiaohongshu', name: '小红书', username: '小红书账号', raw: { type: 'xiaohongshu' } },
      { id: 'x', name: 'X', username: '@writer', raw: { type: 'x' } },
      { id: 'zhihu', name: '知乎', username: '知乎账号', raw: { type: 'zhihu' } },
    ]
    bridgeMocks.waitForBridge.mockResolvedValue(true)
    bridgeMocks.getPlatformAccounts.mockResolvedValue(accounts)
    bridgeMocks.publishDraft.mockImplementation(async (_article, selectedAccounts) => selectedAccounts.map((account: typeof accounts[number]) => ({
      platform: account.id,
      name: account.name,
      status: 'done' as const,
      delivery: 'draft' as const,
    })))

    await act(async () => {
      root.render(<App />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const input = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['# 测试稿件\n\n## 分节标题\n\n> 引用内容\n\n正文 ==重点内容=='], 'highlight.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    const xTab = container.querySelector<HTMLButtonElement>('button[aria-label="X 长文"]')!
    const xhsTab = container.querySelector<HTMLButtonElement>('button[aria-label="小红书"]')!
    const wechatTab = container.querySelector<HTMLButtonElement>('button[aria-label="微信公众号"]')!
    await act(async () => {
      xTab.click()
      await vi.dynamicImportSettled()
    })
    const editorialLayout = Array.from(container.querySelectorAll<HTMLButtonElement>('#x-settings-layout-panel [role="radio"]'))
      .find(button => button.textContent === '刊物')!
    await act(async () => editorialLayout.click())
    expect(container.querySelector('.preview-workbench')?.classList.contains('theme-editorial')).toBe(true)
    expect(container.querySelector<HTMLElement>('.x-article-content h2')?.style.fontFamily).toContain('Noto Serif SC')
    expect(container.querySelector<HTMLElement>('.x-article-content blockquote')?.style.background).toBe('rgb(245, 241, 234)')

    await act(async () => xhsTab.click())
    expect(container.querySelector('.preview-workbench')?.classList.contains('theme-clean')).toBe(true)
    expect(container.querySelector<HTMLElement>('.xhs-card-content h2')?.style.fontFamily).toContain('MiSans')
    expect(container.querySelector<HTMLElement>('.xhs-card-content blockquote')?.style.background).toBe('rgb(245, 247, 249)')
    await act(async () => container.querySelector<HTMLButtonElement>('#xhs-settings-font-trigger')?.click())
    const largeFont = Array.from(container.querySelectorAll<HTMLButtonElement>('#xhs-settings-font-panel [aria-label="选择文章字号"] button'))
      .find(button => button.textContent === '大')!
    await act(async () => largeFont.click())
    await act(async () => wechatTab.click())
    expect(container.querySelector('.preview-workbench')?.classList.contains('theme-clean')).toBe(true)
    expect(container.querySelector('[data-wechat-theme="literary"]')).not.toBeNull()
    await act(async () => xTab.click())
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('#x-settings-layout-panel [role="radio"]'))
      .find(button => button.textContent === '刊物')?.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector<HTMLElement>('.x-article-content p')?.style.fontSize).toBe('19px')

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="打开发布面板"]')?.click())
    for (const row of container.querySelectorAll<HTMLButtonElement>('.platform-row')) {
      await act(async () => row.click())
    }
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.publish-button')?.click()
      await vi.waitFor(() => expect(bridgeMocks.publishDraft).toHaveBeenCalledTimes(4))
    })

    const articleFor = (platform: string) => bridgeMocks.publishDraft.mock.calls.find(([, selected]) => (
      selected as typeof accounts
    )[0]?.id === platform)?.[0] as { html: string; markdown?: string }
    const wechat = articleFor('weixin')
    const xhs = articleFor('xiaohongshu')
    const x = articleFor('x')
    const generic = articleFor('zhihu')
    const parsedXhs = new DOMParser().parseFromString(xhs.html, 'text/html')
    const parsedX = new DOMParser().parseFromString(x.html, 'text/html')
    const parsedGeneric = new DOMParser().parseFromString(generic.html, 'text/html')

    expect(wechat.html).not.toContain('<mark')
    expect(wechat.html).toContain('data-ez-format="highlight"')
    expect(wechat.html).toContain('data-wechat-theme="literary"')
    expect(wechat.markdown).toContain('<span style=')
    expect(xhs.html).toContain('font-weight: 750')
    expect(xhs.markdown).toContain('**重点内容**')
    expect(parsedXhs.querySelector<HTMLElement>('h2')?.style.fontFamily).toContain('MiSans')
    expect(parsedXhs.querySelector<HTMLElement>('blockquote')?.style.background).toBe('rgb(245, 247, 249)')
    expect(parsedXhs.querySelector<HTMLElement>('p')?.style.fontSize).toBe('19px')
    expect(x.html).toContain('text-decoration-line: underline')
    expect(x.html).not.toContain('background-color: rgb(255, 241, 168)')
    expect(x.markdown).toContain('**重点内容**')
    expect(parsedX.querySelector<HTMLElement>('h2')?.style.fontFamily).toContain('Noto Serif SC')
    expect(parsedX.querySelector<HTMLElement>('blockquote')?.style.background).toBe('rgb(245, 241, 234)')
    expect(generic.html).toContain('data-ez-format="highlight"')
    expect(parsedGeneric.querySelector<HTMLElement>('h2')?.style.fontFamily).toContain('MiSans')
    expect(parsedGeneric.querySelector<HTMLElement>('blockquote')?.style.background).toBe('rgb(245, 247, 249)')
    expect(parsedGeneric.querySelector<HTMLElement>('p')?.style.fontSize).toBe('19px')
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

    expect(container.textContent).toContain('已连接 1 个平台')
    expect(container.textContent).toContain('文件保存在本地')
  })

  it('switches a single large platform preview and supplements missing Markdown images from a mixed folder', async () => {
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
    expect(container.querySelector('.source-document-stats')?.textContent).toContain('字数')
    expect(container.querySelector('.source-document-stats')?.textContent).toContain('图片 1')
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
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(titleInput, '补图后保留标题')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const resourceTab = container.querySelector<HTMLButtonElement>('[aria-controls="article-resource-view"]')!
    const editTab = container.querySelector<HTMLButtonElement>('[aria-controls="article-edit-view"]')!
    await act(async () => resourceTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('文档资源')
    expect(container.textContent).toContain('还差 1 张本地图片')
    expect(container.querySelectorAll('.article-resource-card')).toHaveLength(1)
    const previewViewport = container.querySelector<HTMLElement>('.platform-preview-viewport')!
    Object.defineProperties(previewViewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1600 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === previewViewport) return new DOMRect(0, 100, 800, 400)
      if (this instanceof HTMLElement && this.classList.contains('missing-image-card')) {
        return new DOMRect(0, 700 - previewViewport.scrollTop, 500, 80)
      }
      return new DOMRect()
    })
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      previewViewport.scrollTop = Number(options.top) || 0
    })
    Object.defineProperty(previewViewport, 'scrollTo', { configurable: true, value: scrollTo })
    await act(async () => container.querySelector<HTMLButtonElement>('.resource-card-locate')?.click())
    const locatedMissingImage = container.querySelector<HTMLElement>('.wechat-content .missing-image-card')!
    expect(container.querySelector('.editor-grid')?.classList.contains('workspace-mode-split')).toBe(true)
    expect(container.querySelector('.preview-device-frame')?.classList.contains('desktop')).toBe(true)
    expect(locatedMissingImage?.classList.contains('preview-located-target')).toBe(true)
    expect(locatedMissingImage?.getAttribute('data-preview-selected')).toBe('true')
    await vi.waitFor(
      () => expect(scrollTo).toHaveBeenCalledWith({ top: 440, behavior: 'auto' }),
      { timeout: 500 },
    )
    await act(async () => editTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const separator = container.querySelector<HTMLDivElement>('[role="separator"]')!
    expect(separator.getAttribute('aria-valuenow')).toBe('44')
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(separator.getAttribute('aria-valuenow')).toBe('46')
    expect(JSON.parse(window.localStorage.getItem('dispatch.editor-pane-percent.v3') || '{}')).toEqual({ wechat: 46, xhs: 42, x: 40 })
    expect(window.localStorage.getItem('dispatch.editor-pane-percent')).toBe('42')

    const editorScroller = container.querySelector<HTMLElement>('.paper-panel')!
    const previewScroller = container.querySelector<HTMLElement>('.platform-preview-viewport')!
    expect(editorScroller).not.toBe(previewScroller)

    const previewBlock = container.querySelector<HTMLElement>('.wechat-content [data-source-block="0"]')!
    await act(async () => {
      previewBlock.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 100))
    })
    expect(document.activeElement).toBe(container.querySelector('.source-editor .cm-content'))
    expect(container.querySelector('.preview-edit-action')).toBeNull()
    expect(container.querySelector('.wechat-content [data-source-block="0"]')?.getAttribute('data-preview-selected')).toBe('true')

    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 1600))
    })
    expect(container.querySelector('.wechat-content [data-preview-selected="true"]')).toBeNull()
    expect(container.querySelector('.wechat-content .missing-image-card')?.classList.contains('preview-located-target')).toBe(false)

    const headingButton = container.querySelector<HTMLButtonElement>('button[aria-label="二级标题"]')!
    expect(headingButton).not.toBeNull()
    expect(container.querySelector('.wechat-content table')).not.toBeNull()
    expect(container.querySelector('.wechat-layout')?.classList.contains('tool-rail-open')).toBe(false)
    await act(async () => container.querySelector<HTMLButtonElement>('.preview-settings-toggle')?.click())
    const allWechatThemes = Array.from(container.querySelectorAll<HTMLButtonElement>('.wechat-theme-categories button'))
      .find(button => button.textContent === '全部')!
    await act(async () => allWechatThemes.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const wechatTheme = Array.from(container.querySelectorAll<HTMLElement>('.wechat-theme-card'))
      .find(card => card.textContent?.includes('瑞士索引'))!
    const wechatThemeSelect = wechatTheme.querySelector<HTMLButtonElement>('.wechat-theme-select-target')!
    await act(async () => wechatThemeSelect.dispatchEvent(new MouseEvent('click', { bubbles: true })))
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
    const assetDirectoryInput = container.querySelector<HTMLInputElement>('.resource-panel input[webkitdirectory]')!
    Object.defineProperty(assetDirectoryInput, 'files', {
      configurable: true,
      value: [
        new File(['# ignored article'], 'article.md', { type: 'text/markdown' }),
        new File(['ignored metadata'], '.DS_Store', { type: 'application/octet-stream' }),
      ],
    })
    await act(async () => {
      assetDirectoryInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })
    expect(container.textContent).toContain('没有找到支持的图片文件')
    expect(container.textContent).toContain('还差 1 张本地图片')

    Object.defineProperty(assetDirectoryInput, 'files', {
      configurable: true,
      value: [
        new File(['# ignored article'], 'article.md', { type: 'text/markdown' }),
        new File(['ignored metadata'], '.DS_Store', { type: 'application/octet-stream' }),
        new File([new Uint8Array([137, 80, 78, 71])], 'flow.png', { type: 'image/png' }),
      ],
    })
    await act(async () => {
      assetDirectoryInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('还差 1 张本地图片')
      expect(container.querySelector('.x-article img[src^="blob:"]')).not.toBeNull()
    }, { timeout: 1000 })
    await act(async () => editTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('补图后保留标题')
  })

  it('supplements a Windows absolute Markdown image from a selected folder', async () => {
    bridgeMocks.waitForBridge.mockResolvedValue(false)
    const absoluteReference = 'C:/Users/29769/Documents/Codex/2026-09-01/output/assets/flow.png'

    await act(async () => {
      root.render(<App draftRepository={null} />)
      await Promise.resolve()
    })

    const articleInput = container.querySelector<HTMLInputElement>('input[accept=".md,.markdown,.html,.htm,.zip"]')!
    Object.defineProperty(articleInput, 'files', {
      configurable: true,
      value: [new File([`# 绝对路径补图\n\n![流程图](${absoluteReference})`], 'article.md', { type: 'text/markdown' })],
    })
    await act(async () => {
      articleInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 20))
    })

    expect(container.textContent).toContain('1 张图片待处理')
    const resourceTab = container.querySelector<HTMLButtonElement>('[aria-controls="article-resource-view"]')!
    await act(async () => resourceTab.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('还差 1 张本地图片')

    const image = new File([new Uint8Array([137, 80, 78, 71])], 'flow.png', { type: 'image/png' })
    Object.defineProperty(image, 'webkitRelativePath', {
      configurable: true,
      value: 'assets/flow.png',
    })
    const assetDirectoryInput = container.querySelector<HTMLInputElement>('.resource-panel input[webkitdirectory]')!
    Object.defineProperty(assetDirectoryInput, 'files', {
      configurable: true,
      value: [image],
    })
    await act(async () => {
      assetDirectoryInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 20))
    })

    expect(container.textContent).not.toContain('还差 1 张本地图片')
    expect(container.textContent).not.toContain('1 张图片待处理')
    expect(container.querySelector('.resource-card-copy strong')?.textContent).toBe('流程图')
    await vi.waitFor(() => {
      expect(container.querySelector('.wechat-content img[src^="blob:"]')).not.toBeNull()
    }, { timeout: 1000 })
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
    await act(async () => {
      xhsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.dynamicImportSettled()
    })

    expect(container.querySelector('.xhs-card-page.template-focus')).not.toBeNull()
    expect(container.querySelector('.xhs-tool-rail')).not.toBeNull()
    expect(container.querySelectorAll('.xhs-view-modes button')).toHaveLength(3)
    expect(container.textContent).toContain('下载当前页')
    expect(container.textContent).toContain('下载全部图片')

    expect(container.querySelector('[aria-label="小红书设置模块"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="小红书视觉模板"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="小红书输出信息"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="选择文章版式"]')).toBeNull()
    expect(container.querySelectorAll('[aria-label="选择模板分类"] [role="tab"]')).toHaveLength(5)
    expect(container.querySelectorAll('.xhs-template-options button')).toHaveLength(4)
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-tool-rail button')).some(button => button.textContent?.includes('卡片样式'))).toBe(false)
    expect(container.textContent).not.toContain('顶部色条')
    const layoutTrigger = container.querySelector<HTMLButtonElement>('#xhs-settings-layout-trigger')!
    const fontTrigger = container.querySelector<HTMLButtonElement>('#xhs-settings-font-trigger')!
    expect(layoutTrigger.getAttribute('aria-expanded')).toBe('true')
    await act(async () => fontTrigger.click())
    expect(layoutTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(fontTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('#xhs-tool-panel .settings-accordion-panel:not([hidden])')).toHaveLength(2)
    expect(container.querySelector('#xhs-settings-font-panel [aria-label="选择文章字号"]')).not.toBeNull()
    await act(async () => layoutTrigger.click())
    expect(layoutTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(fontTrigger.getAttribute('aria-expanded')).toBe('true')
    await act(async () => layoutTrigger.click())
    expect(layoutTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(fontTrigger.getAttribute('aria-expanded')).toBe('true')
    const cleanTemplate = Array.from(container.querySelectorAll<HTMLButtonElement>('.xhs-template-options button'))
      .find(button => button.getAttribute('aria-label')?.startsWith('简约基础：'))!
    await act(async () => cleanTemplate.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    for (let attempt = 0; attempt < 100 && container.querySelector('.preview-sync-status')?.textContent?.includes('正在生成'); attempt++) {
      await act(async () => new Promise(resolve => setTimeout(resolve, 20)))
    }
    expect(container.querySelector('.preview-sync-status')?.textContent).toContain('自动分页')

    const visibleCard = container.querySelector<HTMLElement>('.xhs-stage .xhs-card-page')!
    expect(visibleCard.classList.contains('template-clean')).toBe(true)
    expect(visibleCard.querySelector('.xhs-card-index')).not.toBeNull()
    expect(visibleCard.querySelector('footer')).not.toBeNull()

    const spreadButton = container.querySelector<HTMLButtonElement>('button[aria-label="双页预览"]')!
    await act(async () => spreadButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelectorAll('.xhs-card-spread .xhs-card-page')).toHaveLength(2)
    expect(container.querySelectorAll('.xhs-card-spread .xhs-card-footer-actions')).toHaveLength(2)

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
