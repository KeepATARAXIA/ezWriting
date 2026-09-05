import { useEffect, useRef, type ReactNode, type Ref } from 'react'
import { Bell, FilePlus2, History, LayoutGrid, CircleHelp, Settings2, Sparkles, X } from 'lucide-react'

export type WorkbenchPanel = 'new' | 'settings' | 'library' | 'ai' | null
export interface WorkbenchNavigationProps {
  historyOpen: boolean
  draftCount: number
  interactionLocked: boolean
  historyTriggerRef?: Ref<HTMLButtonElement>
  onNew: () => void
  onHistory: () => void
  panel: WorkbenchPanel
  onPanelChange: (panel: WorkbenchPanel) => void
  onHelp: () => void
  notificationsOpen: boolean
  notificationCount: number
  onNotificationsChange: (open: boolean) => void
  children?: ReactNode
}

export function WorkbenchNavigation(props: WorkbenchNavigationProps) {
  const notificationRef = useRef<HTMLDivElement>(null)
  const notificationTrigger = useRef<HTMLButtonElement>(null)
  const notificationClose = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!props.notificationsOpen) return
    notificationClose.current?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !notificationRef.current?.contains(event.target)) props.onNotificationsChange(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      props.onNotificationsChange(false)
      notificationTrigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [props.notificationsOpen, props.onNotificationsChange])
  return <nav className="workbench-rail" aria-label="工作台导航">
    <div className="workbench-rail-actions">
      <button type="button" className="rail-action new-document-button" aria-label="新建文档" title="新建或导入文档" disabled={props.interactionLocked} aria-haspopup="dialog" onClick={props.onNew}><FilePlus2 size={21} /><span>新建</span></button>
      <button ref={props.historyTriggerRef} type="button" className="rail-action" aria-label="打开历史记录" title="历史记录" aria-expanded={props.historyOpen} aria-controls="history-sidebar-panel" onClick={props.onHistory}>
        <span className="rail-icon"><History size={21} />{props.draftCount > 0 && <span className="rail-count" aria-hidden="true">{props.draftCount > 99 ? '99+' : props.draftCount}</span>}</span><span>历史</span>
      </button>
      <button type="button" className="rail-action" aria-label="模板素材库（规划中）" title="模板素材库 · 规划中" aria-expanded={props.panel === 'library'} onClick={() => props.onPanelChange('library')}><LayoutGrid size={21} /><span>模板</span></button>
      <button type="button" className="rail-action" aria-label="AI 工具（规划中）" title="AI 工具 · 规划中" aria-expanded={props.panel === 'ai'} onClick={() => props.onPanelChange('ai')}><Sparkles size={21} /><span>AI</span></button>
    </div>
    <div className="workbench-rail-utilities">
      <div ref={notificationRef} className="notification-anchor">
        <button ref={notificationTrigger} type="button" className={`rail-action notification-trigger${props.notificationCount ? ' has-notices' : ''}`} title="通知" aria-label={`通知，${props.notificationCount} 项`} aria-expanded={props.notificationsOpen} aria-controls="notification-panel" onClick={() => props.onNotificationsChange(!props.notificationsOpen)}>
          <span className="rail-icon"><Bell size={20} />{props.notificationCount > 0 && <span className="rail-count" aria-hidden="true">{props.notificationCount}</span>}</span><span>通知</span>
        </button>
        {props.notificationsOpen && <div className="notification-panel" id="notification-panel" role="dialog" aria-label="工作台通知">
          <header><h2>通知</h2><button ref={notificationClose} type="button" className="icon-button" title="关闭通知" aria-label="关闭通知" onClick={() => { props.onNotificationsChange(false); notificationTrigger.current?.focus() }}><X size={18} /></button></header>
          {props.notificationCount ? props.children : <p className="notification-empty">当前没有待处理事项。</p>}
        </div>}
      </div>
      <button type="button" className="rail-action" aria-label="帮助" title="使用帮助" onClick={props.onHelp}><CircleHelp size={21} /><span>帮助</span></button>
      <button type="button" className="rail-action" aria-label="设置" title="设置与本地数据" aria-expanded={props.panel === 'settings'} onClick={() => props.onPanelChange('settings')}><Settings2 size={21} /><span>设置</span></button>
    </div>
  </nav>
}
