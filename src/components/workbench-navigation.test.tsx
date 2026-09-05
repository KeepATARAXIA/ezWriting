import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchNavigation, type WorkbenchNavigationProps } from './workbench-navigation'

describe('WorkbenchNavigation', () => {
  let container: HTMLDivElement
  let root: Root
  let props: WorkbenchNavigationProps
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    props = { historyOpen: false, draftCount: 2, interactionLocked: false, panel: null,
      notificationsOpen: false, notificationCount: 2, onNew: vi.fn(), onHistory: vi.fn(), onPanelChange: vi.fn(), onHelp: vi.fn(), onNotificationsChange: vi.fn() }
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  async function render(overrides: Partial<WorkbenchNavigationProps> = {}) {
    props = { ...props, ...overrides }; await act(async () => root.render(<WorkbenchNavigation {...props} />))
  }
  it('routes global actions and keeps document assets out of global navigation', async () => {
    await render()
    await act(async () => { button('新建文档').click(); button('打开历史记录').click(); button('设置').click(); button('帮助').click() })
    expect(props.onNew).toHaveBeenCalledOnce(); expect(props.onHistory).toHaveBeenCalledOnce()
    expect(props.onPanelChange).toHaveBeenCalledWith('settings'); expect(props.onHelp).toHaveBeenCalledOnce()
    expect(container.querySelector('[aria-label="素材管理"]')).toBeNull()
    await act(async () => { button('模板素材库（规划中）').click(); button('AI 工具（规划中）').click() })
    expect(props.onPanelChange).toHaveBeenCalledWith('library'); expect(props.onPanelChange).toHaveBeenCalledWith('ai')
  })
  it('focuses notices and restores focus on Escape', async () => {
    await render({ notificationsOpen: true })
    expect(document.activeElement).toBe(button('关闭通知'))
    await act(async () => button('关闭通知').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(props.onNotificationsChange).toHaveBeenCalledWith(false)
    expect(document.activeElement).toBe(button('通知，2 项'))
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(props.onNotificationsChange).toHaveBeenCalledWith(false)
  })
  it('locks new documents during exclusive operations but leaves help reachable', async () => {
    await render({ interactionLocked: true })
    expect(button('新建文档').disabled).toBe(true); expect(button('帮助').disabled).toBe(false)
  })
})
