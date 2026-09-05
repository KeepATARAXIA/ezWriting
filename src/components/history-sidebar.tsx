import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  CheckCircle2,
  ChevronDown,
  FileDown,
  Download,
  FileText,
  HardDrive,
  History,
  Image as ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  Upload,
} from 'lucide-react'
import type { DraftKind, DraftSummary } from '../domain/saved-draft'

export type HistorySaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface HistorySidebarProps {
  drafts: readonly DraftSummary[]
  activeDraftId?: string | null
  activeSaveStatus?: HistorySaveStatus
  isExpanded: boolean
  onToggleExpanded: () => void
  onSelectDraft: (id: string) => void
  onChangeKind: (id: string, kind: DraftKind) => void
  onDeleteDraft: (id: string) => void
  onExportBackup?: () => void
  onImportBackup?: () => void
  onExportDiagnostics?: () => void
  backupStatus?: 'idle' | 'exporting' | 'importing'
  interactionLocked?: boolean
  storagePersistent?: boolean | null
  now?: Date
  className?: string
}

type HistoryGroupKey = 'today' | 'yesterday' | 'recent' | 'older'

const HISTORY_GROUPS: Array<{ key: HistoryGroupKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'recent', label: '近 7 天' },
  { key: 'older', label: '更早' },
]

const KIND_LABELS: Record<DraftKind, string> = {
  image: '图文',
  longform: '长文',
}

function startOfLocalDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function groupForDate(timestamp: string, now: Date): HistoryGroupKey {
  const updatedAt = new Date(timestamp)
  if (Number.isNaN(updatedAt.getTime())) return 'older'

  const today = startOfLocalDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const recent = new Date(today)
  recent.setDate(recent.getDate() - 6)

  if (updatedAt >= today) return 'today'
  if (updatedAt >= yesterday) return 'yesterday'
  if (updatedAt >= recent) return 'recent'
  return 'older'
}

function absoluteTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '更新时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function relativeTime(timestamp: string, now: Date): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '时间未知'

  const difference = now.getTime() - date.getTime()
  const group = groupForDate(timestamp, now)
  if (group === 'today' && difference >= 0) {
    const minutes = Math.floor(difference / 60_000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    return `${Math.floor(minutes / 60)} 小时前`
  }

  if (group === 'yesterday') {
    return `昨天 ${new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)}`
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

function displayTitle(title: string): string {
  return title.trim() || '未命名稿件'
}

function KindIcon({ kind }: { kind: DraftKind }) {
  return kind === 'image'
    ? <ImageIcon size={13} aria-hidden="true" />
    : <FileText size={13} aria-hidden="true" />
}

export function HistorySidebar({
  drafts,
  activeDraftId = null,
  activeSaveStatus = 'saved',
  isExpanded,
  onToggleExpanded,
  onSelectDraft,
  onChangeKind,
  onDeleteDraft,
  onExportBackup,
  onImportBackup,
  onExportDiagnostics,
  backupStatus = 'idle',
  interactionLocked = false,
  storagePersistent = null,
  now = new Date(),
  className = '',
}: HistorySidebarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [dataActionsExpanded, setDataActionsExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const menuRefs = useRef(new Map<string, HTMLDivElement>())
  const draftButtonRefs = useRef(new Map<string, HTMLButtonElement>())

  const visibleDrafts = useMemo(() => drafts
    .filter(draft => !draft.deletedAt && displayTitle(draft.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()), [drafts, query])

  const groupedDrafts = useMemo(() => {
    const groups: Record<HistoryGroupKey, DraftSummary[]> = {
      today: [],
      yesterday: [],
      recent: [],
      older: [],
    }
    visibleDrafts.forEach(draft => groups[groupForDate(draft.updatedAt, now)].push(draft))
    return groups
  }, [now, visibleDrafts])

  useEffect(() => {
    if (!isExpanded) {
      setOpenMenuId(null)
      setDataActionsExpanded(false)
    }
  }, [isExpanded])

  useEffect(() => {
    if (interactionLocked) setOpenMenuId(null)
  }, [interactionLocked])

  useEffect(() => {
    if (!openMenuId) return
    const menu = menuRefs.current.get(openMenuId)
    menu?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus()

    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target
      const button = menuButtonRefs.current.get(openMenuId)
      if (!(target instanceof Node) || menu?.contains(target) || button?.contains(target)) return
      setOpenMenuId(null)
    }

    document.addEventListener('mousedown', closeOnOutsidePointer)
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer)
  }, [openMenuId])

  const closeMenu = (restoreFocus = false) => {
    const currentMenuId = openMenuId
    if (restoreFocus && currentMenuId) menuButtonRefs.current.get(currentMenuId)?.focus()
    setOpenMenuId(null)
  }

  const handleDraftKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, draftId: string) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = visibleDrafts.findIndex(draft => draft.id === draftId)
    let targetIndex = currentIndex
    if (event.key === 'Home') targetIndex = 0
    if (event.key === 'End') targetIndex = visibleDrafts.length - 1
    if (event.key === 'ArrowUp') targetIndex = Math.max(0, currentIndex - 1)
    if (event.key === 'ArrowDown') targetIndex = Math.min(visibleDrafts.length - 1, currentIndex + 1)
    draftButtonRefs.current.get(visibleDrafts[targetIndex]?.id)?.focus()
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Escape') {
      closeMenu(true)
      return
    }

    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)'))
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    let targetIndex = currentIndex
    if (event.key === 'Home') targetIndex = 0
    if (event.key === 'End') targetIndex = items.length - 1
    if (event.key === 'ArrowDown') targetIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
    if (event.key === 'ArrowUp') targetIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
    items[targetIndex]?.focus()
  }

  const draftCount = drafts.filter(draft => !draft.deletedAt).length
  const rootClassName = ['history-sidebar', isExpanded ? 'expanded' : 'collapsed', className].filter(Boolean).join(' ')

  return (
    <aside className={rootClassName} aria-label="稿件历史">
      {!isExpanded && (
        <div className="history-sidebar-rail" aria-label="已收起的历史记录侧栏">
          <button
            type="button"
            className="history-rail-button history-expand-button"
            aria-label="展开历史记录"
            aria-controls="history-sidebar-panel"
            aria-expanded="false"
            title="展开历史记录"
            onClick={onToggleExpanded}
          >
            <PanelLeftOpen size={18} aria-hidden="true" />
          </button>
          <div className="history-rail-count" aria-label={`本机共有 ${draftCount} 篇稿件`} title={`${draftCount} 篇稿件`}>
            <History size={16} aria-hidden="true" />
            <span aria-hidden="true">{draftCount > 99 ? '99+' : draftCount}</span>
          </div>
        </div>
      )}

      <div
        id="history-sidebar-panel"
        className="history-sidebar-panel"
        role="region"
        aria-labelledby="history-sidebar-title"
        hidden={!isExpanded}
      >
        <header className="history-sidebar-heading">
          <div>
            <h2 id="history-sidebar-title">历史记录</h2>
            <p>自动保存在当前浏览器</p>
            <input className="history-search" type="search" aria-label="搜索历史稿件" placeholder="搜索稿件标题" value={query} onChange={event => setQuery(event.target.value)} />
          </div>
          <button
            type="button"
            className="history-collapse-button"
            aria-label="收起历史记录"
            aria-controls="history-sidebar-panel"
            aria-expanded="true"
            title="收起历史记录"
            onClick={onToggleExpanded}
          >
            <PanelLeftClose size={18} aria-hidden="true" />
          </button>
        </header>

        <div
          id="history-draft-list"
          className="history-draft-list"
        >
          {visibleDrafts.length === 0 ? (
            <div className="history-empty-state">
              <History size={22} aria-hidden="true" />
              <strong>{query.trim() ? '没有匹配的稿件' : '还没有历史稿件'}</strong>
              <p>{query.trim() ? '换一个关键词，或清空搜索查看全部。' : '新建或导入稿件后，会自动保存在这里。'}</p>
            </div>
          ) : (
            HISTORY_GROUPS.map(group => {
              const items = groupedDrafts[group.key]
              if (items.length === 0) return null
              const headingId = `history-group-${group.key}`
              return (
                <section className="history-draft-group" aria-labelledby={headingId} key={group.key}>
                  <h3 id={headingId}>{group.label}</h3>
                  <ul>
                    {items.map(draft => {
                      const title = displayTitle(draft.title)
                      const isActive = draft.id === activeDraftId
                      const saveState = isActive ? activeSaveStatus : 'saved'
                      const saveLabel = {
                        idle: '未保存',
                        dirty: '待保存',
                        saving: '保存中',
                        saved: '已保存',
                        error: '保存失败',
                      }[saveState]
                      const isMenuOpen = draft.id === openMenuId
                      const menuId = `history-draft-menu-${draft.id}`
                      return (
                        <li className={`history-draft-item ${isActive ? 'selected' : ''}`} key={draft.id}>
                          <button
                            type="button"
                            className="history-draft-open"
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={`打开稿件“${title}”，${KIND_LABELS[draft.kind]}，${saveLabel}`}
                            ref={element => {
                              if (element) draftButtonRefs.current.set(draft.id, element)
                              else draftButtonRefs.current.delete(draft.id)
                            }}
                            onClick={() => onSelectDraft(draft.id)}
                            onKeyDown={event => handleDraftKeyDown(event, draft.id)}
                            disabled={interactionLocked}
                          >
                            <span className="history-draft-title">{title}</span>
                            <span className="history-draft-meta" aria-hidden="true">
                              <span className="history-draft-kind"><KindIcon kind={draft.kind} />{KIND_LABELS[draft.kind]}</span>
                              <span aria-hidden="true">·</span>
                              <time dateTime={draft.updatedAt} title={absoluteTime(draft.updatedAt)}>{relativeTime(draft.updatedAt, now)}</time>
                            </span>
                            <span className={`history-sync-state local ${saveState}`} title={saveState === 'saved' ? '已保存到本机' : saveLabel}>
                              {saveState === 'saving' ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : <HardDrive size={12} aria-hidden="true" />}
                              <span>{saveLabel}</span>
                            </span>
                          </button>

                          <button
                            type="button"
                            className="history-draft-menu-button"
                            aria-label={`管理稿件“${title}”`}
                            aria-haspopup="menu"
                            aria-expanded={isMenuOpen}
                            aria-controls={isMenuOpen ? menuId : undefined}
                            ref={element => {
                              if (element) menuButtonRefs.current.set(draft.id, element)
                              else menuButtonRefs.current.delete(draft.id)
                            }}
                            disabled={interactionLocked}
                            onClick={() => setOpenMenuId(current => current === draft.id ? null : draft.id)}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </button>

                          {isMenuOpen && (
                            <div
                              id={menuId}
                              className="history-draft-menu"
                              role="menu"
                              aria-label={`稿件“${title}”操作`}
                              ref={element => {
                                if (element) menuRefs.current.set(draft.id, element)
                                else menuRefs.current.delete(draft.id)
                              }}
                              onKeyDown={handleMenuKeyDown}
                            >
                              <p>主要类型</p>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={draft.kind === 'image'}
                                disabled={interactionLocked}
                                onClick={() => {
                                  if (draft.kind !== 'image') onChangeKind(draft.id, 'image')
                                  closeMenu()
                                }}
                              >
                                <ImageIcon size={14} aria-hidden="true" /> 图文
                                {draft.kind === 'image' && <CheckCircle2 size={13} aria-hidden="true" />}
                              </button>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={draft.kind === 'longform'}
                                disabled={interactionLocked}
                                onClick={() => {
                                  if (draft.kind !== 'longform') onChangeKind(draft.id, 'longform')
                                  closeMenu()
                                }}
                              >
                                <FileText size={14} aria-hidden="true" /> 长文
                                {draft.kind === 'longform' && <CheckCircle2 size={13} aria-hidden="true" />}
                              </button>
                              <span className="history-menu-divider" role="separator" />
                              <button
                                type="button"
                                role="menuitem"
                                className="history-delete-action"
                                disabled={interactionLocked}
                                onClick={() => {
                                  onDeleteDraft(draft.id)
                                  closeMenu()
                                }}
                              >
                                <Trash2 size={14} aria-hidden="true" /> 删除
                              </button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })
          )}
        </div>

        <footer className={`history-account-footer ${dataActionsExpanded ? 'expanded' : ''}`}>
          <button
            type="button"
            className="history-data-trigger"
            aria-expanded={dataActionsExpanded}
            aria-controls="history-data-actions"
            onClick={() => setDataActionsExpanded(current => !current)}
          >
            <span className="history-storage-icon"><HardDrive size={17} aria-hidden="true" /></span>
            <span>
              <strong>本地数据</strong>
              <small>{storagePersistent === true ? '已启用持久化存储' : '已自动保存在此浏览器'}</small>
            </span>
            <span className="history-data-state" aria-hidden="true">
              {storagePersistent === true && <CheckCircle2 size={15} />}
              <ChevronDown size={16} />
            </span>
          </button>
          {dataActionsExpanded && (
            <div id="history-data-actions" className="history-data-actions">
              <div className="history-backup-actions">
                <button type="button" disabled={interactionLocked || backupStatus !== 'idle'} onClick={onExportBackup}>
                  {backupStatus === 'exporting' ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                  {backupStatus === 'exporting' ? '导出中' : '导出备份'}
                </button>
                <button type="button" disabled={interactionLocked || backupStatus !== 'idle'} onClick={onImportBackup}>
                  {backupStatus === 'importing' ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}
                  {backupStatus === 'importing' ? '导入中' : '导入备份'}
                </button>
                <button type="button" disabled={interactionLocked} style={{ gridColumn: '1 / -1' }} onClick={onExportDiagnostics}>
                  <FileDown size={14} /> 导出诊断报告
                </button>
              </div>
              <p><HardDrive size={12} aria-hidden="true" /> 换域名或清理网站数据前，请先导出备份。</p>
            </div>
          )}
        </footer>
      </div>
    </aside>
  )
}
