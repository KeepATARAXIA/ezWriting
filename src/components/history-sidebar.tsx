import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  CheckCircle2,
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
  Undo2,
  Upload,
} from 'lucide-react'
import type { DraftKind, DraftSummary } from '../domain/saved-draft'

export type HistoryFilter = 'all' | DraftKind

export interface HistoryUndoDraft {
  id: string
  title: string
}

export interface HistorySidebarProps {
  drafts: readonly DraftSummary[]
  activeDraftId?: string | null
  isExpanded: boolean
  filter: HistoryFilter
  undoDraft?: HistoryUndoDraft | null
  onToggleExpanded: () => void
  onFilterChange: (filter: HistoryFilter) => void
  onSelectDraft: (id: string) => void
  onChangeKind: (id: string, kind: DraftKind) => void
  onDeleteDraft: (id: string) => void
  onUndoDelete?: (id: string) => void
  onExportBackup?: () => void
  onImportBackup?: () => void
  backupStatus?: 'idle' | 'exporting' | 'importing'
  storagePersistent?: boolean | null
  now?: Date
  className?: string
}

type HistoryGroupKey = 'today' | 'yesterday' | 'recent' | 'older'

const FILTER_OPTIONS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图文' },
  { value: 'longform', label: '长文' },
]

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
  isExpanded,
  filter,
  undoDraft = null,
  onToggleExpanded,
  onFilterChange,
  onSelectDraft,
  onChangeKind,
  onDeleteDraft,
  onUndoDelete,
  onExportBackup,
  onImportBackup,
  backupStatus = 'idle',
  storagePersistent = null,
  now = new Date(),
  className = '',
}: HistorySidebarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const menuRefs = useRef(new Map<string, HTMLDivElement>())
  const draftButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const filterButtonRefs = useRef(new Map<HistoryFilter, HTMLButtonElement>())

  const visibleDrafts = useMemo(() => drafts
    .filter(draft => !draft.deletedAt && (filter === 'all' || draft.kind === filter))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()), [drafts, filter])

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
    if (!isExpanded) setOpenMenuId(null)
  }, [isExpanded])

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

  const handleFilterKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = FILTER_OPTIONS.findIndex(option => option.value === filter)
    let targetIndex = currentIndex
    if (event.key === 'Home') targetIndex = 0
    if (event.key === 'End') targetIndex = FILTER_OPTIONS.length - 1
    if (event.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + FILTER_OPTIONS.length) % FILTER_OPTIONS.length
    if (event.key === 'ArrowRight') targetIndex = (currentIndex + 1) % FILTER_OPTIONS.length
    const target = FILTER_OPTIONS[targetIndex].value
    onFilterChange(target)
    filterButtonRefs.current.get(target)?.focus()
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

  const activeFilterId = `history-filter-${filter}`
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

        <div className="history-filter-tabs" role="tablist" aria-label="筛选历史稿件" onKeyDown={handleFilterKeyDown}>
          {FILTER_OPTIONS.map(option => (
            <button
              type="button"
              role="tab"
              id={`history-filter-${option.value}`}
              key={option.value}
              className={filter === option.value ? 'selected' : ''}
              aria-selected={filter === option.value}
              aria-controls="history-draft-list"
              tabIndex={filter === option.value ? 0 : -1}
              ref={element => {
                if (element) filterButtonRefs.current.set(option.value, element)
                else filterButtonRefs.current.delete(option.value)
              }}
              onClick={() => onFilterChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div
          id="history-draft-list"
          className="history-draft-list"
          role="tabpanel"
          aria-labelledby={activeFilterId}
          tabIndex={-1}
        >
          {visibleDrafts.length === 0 ? (
            <div className="history-empty-state">
              <History size={22} aria-hidden="true" />
              <strong>{draftCount === 0 ? '还没有历史稿件' : `没有${KIND_LABELS[filter as DraftKind]}稿件`}</strong>
              <p>{draftCount === 0 ? '新建或导入稿件后，会自动保存在这里。' : '切换到“全部”查看其他稿件。'}</p>
              {draftCount > 0 && filter !== 'all' && (
                <button type="button" onClick={() => onFilterChange('all')}>查看全部</button>
              )}
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
                      const isMenuOpen = draft.id === openMenuId
                      const menuId = `history-draft-menu-${draft.id}`
                      return (
                        <li className={`history-draft-item ${isActive ? 'selected' : ''}`} key={draft.id}>
                          <button
                            type="button"
                            className="history-draft-open"
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={`打开稿件“${title}”，${KIND_LABELS[draft.kind]}，已保存到本机`}
                            ref={element => {
                              if (element) draftButtonRefs.current.set(draft.id, element)
                              else draftButtonRefs.current.delete(draft.id)
                            }}
                            onClick={() => onSelectDraft(draft.id)}
                            onKeyDown={event => handleDraftKeyDown(event, draft.id)}
                          >
                            <span className="history-draft-title">{title}</span>
                            <span className="history-draft-meta" aria-hidden="true">
                              <span className="history-draft-kind"><KindIcon kind={draft.kind} />{KIND_LABELS[draft.kind]}</span>
                              <span aria-hidden="true">·</span>
                              <time dateTime={draft.updatedAt} title={absoluteTime(draft.updatedAt)}>{relativeTime(draft.updatedAt, now)}</time>
                            </span>
                            <span className="history-sync-state local" title="已保存到本机">
                              <HardDrive size={12} aria-hidden="true" />
                              <span>已保存</span>
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

        {undoDraft && onUndoDelete && (
          <div className="history-undo-notice" role="status" aria-live="polite">
            <span><Trash2 size={13} aria-hidden="true" />“{displayTitle(undoDraft.title)}”已删除</span>
            <button type="button" onClick={() => onUndoDelete(undoDraft.id)}>
              <Undo2 size={13} aria-hidden="true" /> 撤销
            </button>
          </div>
        )}

        <footer className="history-account-footer">
          <div className="history-local-storage">
            <span className="history-storage-icon"><HardDrive size={17} aria-hidden="true" /></span>
            <span>
              <strong>本地数据</strong>
              <small>{storagePersistent === true ? '已启用持久化存储' : '建议定期导出备份'}</small>
            </span>
            {storagePersistent === true && <CheckCircle2 size={15} aria-hidden="true" />}
          </div>
          <div className="history-backup-actions">
            <button type="button" disabled={backupStatus !== 'idle'} onClick={onExportBackup}>
              {backupStatus === 'exporting' ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
              {backupStatus === 'exporting' ? '导出中' : '导出备份'}
            </button>
            <button type="button" disabled={backupStatus !== 'idle'} onClick={onImportBackup}>
              {backupStatus === 'importing' ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}
              {backupStatus === 'importing' ? '导入中' : '导入备份'}
            </button>
          </div>
          <p><HardDrive size={12} aria-hidden="true" /> 数据仅保存在此设备和浏览器；换域名或清理网站数据前请先导出。</p>
        </footer>
      </div>
    </aside>
  )
}
