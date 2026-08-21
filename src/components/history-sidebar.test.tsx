import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftSummary } from '../domain/saved-draft'
import { HistorySidebar, type HistorySidebarProps } from './history-sidebar'

const NOW = new Date(2026, 7, 13, 12, 0, 0)

function at(day: number, hour = 10): string {
  return new Date(2026, 7, day, hour, 0, 0).toISOString()
}

function draft(overrides: Partial<DraftSummary> & Pick<DraftSummary, 'id'>): DraftSummary {
  return {
    id: overrides.id,
    title: overrides.title ?? `稿件 ${overrides.id}`,
    kind: overrides.kind ?? 'image',
    sourceKind: overrides.sourceKind ?? 'blank',
    createdAt: overrides.createdAt ?? at(1),
    updatedAt: overrides.updatedAt ?? at(13),
    deletedAt: overrides.deletedAt ?? null,
  }
}

describe('HistorySidebar', () => {
  let container: HTMLDivElement
  let root: Root
  let props: HistorySidebarProps

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    props = {
      drafts: [],
      activeDraftId: null,
      isExpanded: true,
      onToggleExpanded: vi.fn(),
      onSelectDraft: vi.fn(),
      onChangeKind: vi.fn(),
      onDeleteDraft: vi.fn(),
      onUndoDelete: vi.fn(),
      onExportBackup: vi.fn(),
      onImportBackup: vi.fn(),
      onExportDiagnostics: vi.fn(),
      now: NOW,
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function render(nextProps: Partial<HistorySidebarProps> = {}) {
    props = { ...props, ...nextProps }
    await act(async () => {
      root.render(<HistorySidebar {...props} />)
      await Promise.resolve()
    })
  }

  it('groups non-deleted drafts by recency, sorts each group, and marks the active draft', async () => {
    await render({
      activeDraftId: 'today-new',
      drafts: [
        draft({ id: 'old', title: '更早稿件', updatedAt: at(1) }),
        draft({ id: 'today-old', title: '今日早稿', updatedAt: at(13, 8) }),
        draft({ id: 'recent', title: '本周稿件', updatedAt: at(9), kind: 'longform' }),
        draft({ id: 'yesterday', title: '昨日稿件', updatedAt: at(12) }),
        draft({ id: 'today-new', title: '', updatedAt: at(13, 11) }),
        draft({ id: 'deleted', title: '已经删除', updatedAt: at(13), deletedAt: at(13) }),
      ],
    })

    expect(Array.from(container.querySelectorAll('.history-draft-group h3')).map(element => element.textContent))
      .toEqual(['今天', '昨天', '近 7 天', '更早'])
    expect(Array.from(container.querySelectorAll('.history-draft-title')).map(element => element.textContent))
      .toEqual(['未命名稿件', '今日早稿', '昨日稿件', '本周稿件', '更早稿件'])
    expect(container.textContent).not.toContain('已经删除')
    expect(container.querySelector<HTMLButtonElement>('[aria-current="page"]')?.textContent).toContain('未命名稿件')
    expect(container.textContent).toContain('已保存')
  })

  it('shows every draft without category filters', async () => {
    await render({
      drafts: [
        draft({ id: 'image', title: '图文稿件', kind: 'image' }),
        draft({ id: 'longform', title: '长文稿件', kind: 'longform' }),
      ],
    })

    expect(container.querySelector('.history-filter-tabs')).toBeNull()
    expect(container.querySelector('[aria-label="筛选历史稿件"]')).toBeNull()
    expect(container.textContent).toContain('图文稿件')
    expect(container.textContent).toContain('长文稿件')
  })

  it('shows the real autosave state for the active draft', async () => {
    await render({
      activeDraftId: 'active',
      activeSaveStatus: 'dirty',
      drafts: [draft({ id: 'active' }), draft({ id: 'saved' })],
    })
    expect(container.querySelector('.history-draft-item.selected .history-sync-state')?.textContent).toContain('待保存')
    expect(container.querySelector('.history-draft-item:not(.selected) .history-sync-state')?.textContent).toContain('已保存')

    await render({ activeSaveStatus: 'saving' })
    expect(container.querySelector('.history-draft-item.selected .history-sync-state')?.textContent).toContain('保存中')

    await render({ activeSaveStatus: 'error' })
    expect(container.querySelector('.history-draft-item.selected .history-sync-state')?.textContent).toContain('保存失败')
  })

  it('supports arrow-key navigation across draft rows', async () => {
    await render({
      drafts: [
        draft({ id: 'first', title: '第一篇', updatedAt: at(13, 11) }),
        draft({ id: 'second', title: '第二篇', updatedAt: at(13, 10) }),
      ],
    })

    const openButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-draft-open'))
    openButtons[0].focus()
    const rowEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    await act(async () => openButtons[0].dispatchEvent(rowEvent))
    expect(rowEvent.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(openButtons[1])
  })

  it('selects drafts and exposes editable kind and soft-delete actions in an accessible menu', async () => {
    const onSelectDraft = vi.fn()
    const onChangeKind = vi.fn()
    const onDeleteDraft = vi.fn()
    await render({
      onSelectDraft,
      onChangeKind,
      onDeleteDraft,
      drafts: [draft({ id: 'draft-1', title: '内容策略', kind: 'image' })],
    })

    const openButton = container.querySelector<HTMLButtonElement>('.history-draft-open')!
    await act(async () => openButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onSelectDraft).toHaveBeenCalledWith('draft-1')

    const menuButton = container.querySelector<HTMLButtonElement>('.history-draft-menu-button')!
    await act(async () => {
      menuButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu.getAttribute('aria-label')).toContain('内容策略')
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio')

    const longformAction = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      .find(button => button.textContent?.includes('长文'))!
    await act(async () => longformAction.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onChangeKind).toHaveBeenCalledWith('draft-1', 'longform')
    expect(container.querySelector('[role="menu"]')).toBeNull()

    await act(async () => {
      menuButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    const deleteAction = container.querySelector<HTMLButtonElement>('.history-delete-action')!
    await act(async () => deleteAction.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onDeleteDraft).toHaveBeenCalledWith('draft-1')
  })

  it('closes a draft menu with Escape and restores focus to its trigger', async () => {
    await render({ drafts: [draft({ id: 'escape', title: '键盘稿件' })] })
    const menuButton = container.querySelector<HTMLButtonElement>('.history-draft-menu-button')!
    await act(async () => {
      menuButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const menu = container.querySelector<HTMLElement>('[role="menu"]')!
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => menu.dispatchEvent(escapeEvent))

    expect(escapeEvent.defaultPrevented).toBe(true)
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(menuButton)
  })

  it('renders the undo notice and local backup actions', async () => {
    const onUndoDelete = vi.fn()
    const onExportBackup = vi.fn()
    const onImportBackup = vi.fn()
    const onExportDiagnostics = vi.fn()
    await render({
      undoDraft: { id: 'deleted-id', title: '误删稿件' },
      onUndoDelete,
      onExportBackup,
      onImportBackup,
      onExportDiagnostics,
    })

    expect(container.querySelector('[role="status"]')?.textContent).toContain('“误删稿件”已删除')
    const undoButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('撤销'))!
    await act(async () => undoButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onUndoDelete).toHaveBeenCalledWith('deleted-id')

    const exportButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-backup-actions button'))
      .find(button => button.textContent?.includes('导出备份'))!
    const importButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-backup-actions button'))
      .find(button => button.textContent?.includes('导入备份'))!
    const diagnosticsButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.history-backup-actions button'))
      .find(button => button.textContent?.includes('导出诊断报告'))!
    await act(async () => exportButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => importButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => diagnosticsButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onExportBackup).toHaveBeenCalledTimes(1)
    expect(onImportBackup).toHaveBeenCalledTimes(1)
    expect(onExportDiagnostics).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('数据仅保存在此设备和浏览器')
  })

  it('disables draft mutations and backup actions while an exclusive operation is running', async () => {
    await render({
      drafts: [draft({ id: 'locked' })],
      undoDraft: { id: 'deleted-id', title: '待恢复稿件' },
      interactionLocked: true,
    })

    expect(container.querySelector<HTMLButtonElement>('.history-draft-open')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('.history-draft-menu-button')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('.history-undo-notice button')?.disabled).toBe(true)
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.history-backup-actions button')).every(button => button.disabled)).toBe(true)
  })

  it('uses a compact semantic rail when collapsed', async () => {
    const onToggleExpanded = vi.fn()
    await render({
      isExpanded: false,
      onToggleExpanded,
      drafts: [draft({ id: 'one' }), draft({ id: 'two' })],
    })

    const panel = container.querySelector<HTMLElement>('#history-sidebar-panel')!
    expect(panel.hidden).toBe(true)
    expect(container.querySelector('.history-sidebar')?.classList.contains('collapsed')).toBe(true)
    expect(container.querySelector('.history-rail-count')?.getAttribute('aria-label')).toBe('本机共有 2 篇稿件')

    const expandButton = container.querySelector<HTMLButtonElement>('[aria-label="展开历史记录"]')!
    expect(expandButton.getAttribute('aria-expanded')).toBe('false')
    await act(async () => expandButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onToggleExpanded).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label*="登录"]')).toBeNull()
  })

  it('shows when the browser granted persistent storage', async () => {
    await render({ storagePersistent: true })
    expect(container.textContent).toContain('本地数据')
    expect(container.textContent).toContain('已启用持久化存储')
    expect(container.textContent).not.toContain('登录')
    expect(container.textContent).not.toContain('同步')
  })

  it('shows a useful empty state before the first draft exists', async () => {
    await render()
    expect(container.textContent).toContain('还没有历史稿件')
    expect(container.textContent).toContain('新建或导入稿件后，会自动保存在这里。')
    expect(container.querySelector('.history-empty-state button')).toBeNull()
  })
})
