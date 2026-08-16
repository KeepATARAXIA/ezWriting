import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    await repository.close()
    await resetLocalDraftDatabase(databaseName)
  })

  async function renderApp() {
    await repository.listDrafts()
    await repository.getSetting('last-active-draft-id')
    await act(async () => root.render(<App draftRepository={repository} />))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 30)))
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
      await new Promise(resolve => window.setTimeout(resolve, 30))
    })
    expect(await repository.listDrafts()).toHaveLength(0)
    expect(container.textContent).toContain('本地历史测试稿”已删除')

    const undoButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-undo-notice button'))[0]
    await act(async () => {
      undoButton.click()
      await new Promise(resolve => window.setTimeout(resolve, 30))
    })
    expect((await repository.listDrafts()).map(draft => draft.title)).toEqual(['本地历史测试稿'])
  })

  it('shows local backup controls without account or cloud-sync entry points', async () => {
    await renderApp()
    expect(container.textContent).toContain('本地数据')
    expect(container.textContent).toContain('导出备份')
    expect(container.textContent).toContain('导入备份')
    expect(container.textContent).not.toContain('登录 / 注册')
    expect(container.textContent).not.toContain('同步历史记录')
  })
})
