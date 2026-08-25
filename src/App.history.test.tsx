import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { DEFAULT_ARTICLE_FORMATTING } from './domain/formatting'
import { createPersistedDraft } from './domain/saved-draft'
import { LOCAL_BACKUP_FORMAT, LOCAL_BACKUP_VERSION } from './services/local-backup'
import { LocalDraftRepository, resetLocalDraftDatabase } from './services/local-draft-repository'

const bridgeMocks = vi.hoisted(() => ({
  waitForBridge: vi.fn(),
  getPlatformAccounts: vi.fn(),
  publishDraft: vi.fn(),
}))

vi.mock('./lib/wechatsync-bridge', () => bridgeMocks)

describe('App local draft history', () => {
  let container: HTMLDivElement
  let root: Root
  let repository: LocalDraftRepository
  let databaseName: string

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    databaseName = `dispatch-app-history-${crypto.randomUUID()}`
    repository = new LocalDraftRepository({ databaseName })
    bridgeMocks.waitForBridge.mockResolvedValue(false)
    bridgeMocks.getPlatformAccounts.mockResolvedValue([])
    bridgeMocks.publishDraft.mockReset()
    window.localStorage.clear()
    const editorRect = new DOMRect(0, 0, 120, 18)
    Range.prototype.getClientRects = () => [editorRect] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => editorRect
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    await repository.close()
    await resetLocalDraftDatabase(databaseName)
    vi.restoreAllMocks()
  })

  async function renderApp() {
    await repository.listDrafts()
    await repository.getSetting('last-active-draft-id')
    await act(async () => root.render(<App draftRepository={repository} />))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 30)))
  }

  async function openLocalDataActions() {
    const expandHistory = container.querySelector<HTMLButtonElement>('[aria-label="展开历史记录"]')
    if (expandHistory) await act(async () => expandHistory.click())
    const trigger = container.querySelector<HTMLButtonElement>('.history-data-trigger')!
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      await act(async () => trigger.click())
    }
  }

  it('autosaves a new draft, restores it after remount, and supports delete undo', async () => {
    await renderApp()
    const createButton = container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')!
    expect(createButton, container.textContent || '').not.toBeNull()
    await act(async () => {
      createButton.click()
      await new Promise(resolve => window.setTimeout(resolve, 30))
    })

    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(titleInput, '本地历史测试稿')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 760))
    })

    const summaries = await repository.listDrafts()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].title).toBe('本地历史测试稿')
    expect((await repository.getDraft(summaries[0].id))?.article.title).toBe('本地历史测试稿')

    await act(async () => root.unmount())
    container.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await renderApp()

    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('本地历史测试稿')
    expect(container.querySelector('.history-draft-title')?.textContent).toBe('本地历史测试稿')

    const menuButton = container.querySelector<HTMLButtonElement>('.history-draft-menu-button')!
    await act(async () => menuButton.click())
    const deleteButton = container.querySelector<HTMLButtonElement>('.history-delete-action')!
    await act(async () => {
      deleteButton.click()
      await new Promise(resolve => window.setTimeout(resolve, 50))
    })
    expect(container.textContent).toContain('本地历史测试稿”已删除')
    expect(await repository.listDrafts()).toHaveLength(0)

    const undoButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-undo-notice button'))[0]
    await act(async () => {
      undoButton.click()
      await new Promise(resolve => window.setTimeout(resolve, 50))
    })
    expect((await repository.listDrafts()).map(draft => draft.title)).toEqual(['本地历史测试稿'])
  })

  it('repairs and autosaves malformed strong spacing when restoring an existing Markdown draft', async () => {
    const malformedSource = '- **问题选择： **判断哪个问题值得解决；'
    const draft = createPersistedDraft({
      id: 'legacy-strong-spacing',
      title: '旧加粗语法',
      html: '<ul><li>**问题选择： **判断哪个问题值得解决；</li></ul>',
      markdown: malformedSource,
      sourceText: malformedSource,
      sourceLanguage: 'markdown',
      tags: [],
      sourceFile: 'legacy.md',
      sourceKind: 'markdown',
      importedAt: '2026-08-25T00:00:00.000Z',
      warnings: [],
      missingAssets: [],
    }, DEFAULT_ARTICLE_FORMATTING)
    await repository.saveDraft(draft)

    await renderApp()
    await act(async () => {
      await vi.waitFor(() => {
        expect(container.querySelector('.cm-content')?.textContent).toContain('**问题选择：** 判断哪个问题值得解决；')
        expect(container.querySelector('.wechat-content strong')?.textContent).toBe('问题选择：')
      })
      await new Promise(resolve => window.setTimeout(resolve, 760))
    })

    const saved = await repository.getDraft(draft.id)
    expect(saved?.article.sourceText).toBe('- **问题选择：** 判断哪个问题值得解决；')
    expect(saved?.article.markdown).toBe(saved?.article.sourceText)
    expect(saved?.article.html).toContain('<strong>问题选择：</strong> 判断哪个问题值得解决；')
  })

  it('shows local backup controls without account or cloud-sync entry points', async () => {
    await renderApp()
    expect(container.textContent).not.toContain('导出备份')
    await openLocalDataActions()
    expect(container.textContent).toContain('本地数据')
    expect(container.textContent).toContain('导出备份')
    expect(container.textContent).toContain('导入备份')
    expect(container.textContent).not.toContain('登录 / 注册')
    expect(container.textContent).not.toContain('同步历史记录')
  })

  it('flushes the latest active edit before delete so undo restores that edit', async () => {
    await renderApp()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 40))
    })
    const draftId = (await repository.listDrafts())[0].id
    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(titleInput, '删除前最后一版')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => container.querySelector<HTMLButtonElement>('.history-draft-menu-button')?.click())
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.history-delete-action')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 50))
    })
    expect((await repository.getDraft(draftId))?.article.title).toBe('删除前最后一版')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.history-undo-notice button')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 50))
    })
    expect((await repository.getDraft(draftId))?.article.title).toBe('删除前最后一版')
  })

  it('deduplicates simultaneous backup exports', async () => {
    await renderApp()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 40))
    })
    await openLocalDataActions()
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const exportButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-backup-actions button'))
      .find(button => button.textContent?.includes('导出备份'))!

    await act(async () => {
      exportButton.click()
      exportButton.click()
      exportButton.click()
      await vi.waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
    })
    anchorClick.mockRestore()
  })

  it('shows emergency-backup success even when autosave is still failing', async () => {
    await renderApp()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 40))
    })
    vi.spyOn(repository, 'saveDraft').mockRejectedValue(new DOMException('Storage quota exceeded', 'QuotaExceededError'))
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    let backupBlob: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      backupBlob = blob as Blob
      return 'blob:emergency-backup'
    })
    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(titleInput, '配额失败时的当前编辑')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await openLocalDataActions()
    const exportButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-backup-actions button'))
      .find(button => button.textContent?.includes('导出备份'))!
    await act(async () => {
      exportButton.click()
      await vi.waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
    })

    const notice = container.querySelector('.local-history-notice')
    expect(notice?.textContent).toContain('本地保存失败，但已将当前编辑直接写入备份')
    expect(notice?.classList.contains('error')).toBe(false)
    const payload = JSON.parse(await backupBlob!.text()) as { drafts: Array<{ article: { title: string } }> }
    expect(payload.drafts[0].article.title).toBe('配额失败时的当前编辑')
  })

  it('cancels the old autosave generation after an atomic backup import', async () => {
    await renderApp()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 40))
    })
    const stored = await repository.getDraft((await repository.listDrafts())[0].id)
    expect(stored).not.toBeNull()
    const backupDraft = {
      ...stored!,
      article: { ...stored!.article, title: '备份中的最终版本' },
      updatedAt: '2026-08-20T03:00:00.000Z',
    }
    const backup = new File([JSON.stringify({
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      exportedAt: '2026-08-20T03:00:00.000Z',
      activeDraftId: backupDraft.id,
      drafts: [backupDraft],
    })], 'atomic.ezwriting-backup.json', { type: 'application/json' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const titleInput = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(titleInput, '不应在导入后反写的旧编辑')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const backupInput = container.querySelector<HTMLInputElement>('input[accept*=".ezwriting-backup"]')!
    Object.defineProperty(backupInput, 'files', { configurable: true, value: [backup] })
    await act(async () => {
      backupInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 900))
    })

    expect(container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')?.value).toBe('备份中的最终版本')
    expect((await repository.getDraft(backupDraft.id))?.article.title).toBe('备份中的最终版本')
  })

  it('rejects a stale save from a second tab instead of overwriting the newer draft', async () => {
    await renderApp()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.drop-actions .primary-button')?.click()
      await new Promise(resolve => window.setTimeout(resolve, 40))
    })
    const firstTitle = container.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(firstTitle, '共享初始稿')
      firstTitle.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => window.setTimeout(resolve, 760))
    })
    const draftId = (await repository.listDrafts())[0].id

    const secondRepository = new LocalDraftRepository({ databaseName })
    const secondContainer = document.createElement('div')
    document.body.appendChild(secondContainer)
    const secondRoot = createRoot(secondContainer)
    try {
      await secondRepository.listDrafts()
      await act(async () => {
        secondRoot.render(<App draftRepository={secondRepository} />)
        await new Promise(resolve => window.setTimeout(resolve, 40))
      })

      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(firstTitle, '标签页 A 的新版本')
        firstTitle.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => window.setTimeout(resolve, 760))
      })

      const secondTitle = secondContainer.querySelector<HTMLInputElement>('[aria-label="文章标题"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(secondTitle, '标签页 B 的旧快照修改')
        secondTitle.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => window.setTimeout(resolve, 760))
      })

      expect((await repository.getDraft(draftId))?.article.title).toBe('标签页 A 的新版本')
      expect(secondContainer.textContent).toContain('另一标签页已更新这篇稿件')
    } finally {
      await act(async () => secondRoot.unmount())
      await secondRepository.close()
      secondContainer.remove()
    }
  })
})
