import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  Info,
  Ellipsis,
  History,
  PanelLeftClose,
  Trash2,
} from 'lucide-react'
import type { DraftSummary } from '../domain/saved-draft'

export type HistorySaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface HistorySidebarProps {
  drafts: readonly DraftSummary[]
  activeDraftId?: string | null
  activeSaveStatus?: HistorySaveStatus
  isExpanded: boolean
  onToggleExpanded: () => void
  onSelectDraft: (id: string) => void
  onDeleteDraft: (id: string) => void
  interactionLocked?: boolean
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

export function HistorySidebar({
  drafts,
  activeDraftId = null,
  activeSaveStatus = 'saved',
  isExpanded,
  onToggleExpanded,
  onSelectDraft,
  onDeleteDraft,
  interactionLocked = false,
  now = new Date(),
  className = '',
}: HistorySidebarProps) {
  const [query, setQuery] = useState('')
  const [menuDraftId, setMenuDraftId] = useState<string | null>(null)
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

  const rootClassName = ['history-sidebar', isExpanded ? 'expanded' : 'collapsed', className].filter(Boolean).join(' ')

  return (
    <aside className={rootClassName} aria-label="稿件历史">
      <div
        id="history-sidebar-panel"
        className="history-sidebar-panel"
        role="region"
        aria-labelledby="history-sidebar-title"
        hidden={!isExpanded}
      >
        <header className="history-sidebar-heading">
          <div>
            <h2 id="history-sidebar-title">历史记录 <button type="button" className="history-info" aria-label="自动保存在当前浏览器" title="自动保存在当前浏览器"><Info size={14} aria-hidden="true" /></button></h2>
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
          <input className="history-search" type="search" aria-label="搜索历史稿件" placeholder="搜索历史记录" value={query} onChange={event => { setQuery(event.target.value); setMenuDraftId(null) }} />
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
                      return (
                        <li className={`history-draft-item ${isActive ? 'selected' : ''}`} key={draft.id}
                          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuDraftId(null) }}
                          onKeyDown={event => {
                            if (event.key === 'Escape' && menuDraftId === draft.id) {
                              event.stopPropagation()
                              setMenuDraftId(null)
                              event.currentTarget.querySelector<HTMLButtonElement>('.history-draft-menu-button')?.focus()
                            }
                          }}>
                          <button
                            type="button"
                            className="history-draft-open"
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={`打开稿件“${title}”，${saveLabel}`}
                            ref={element => {
                              if (element) draftButtonRefs.current.set(draft.id, element)
                              else draftButtonRefs.current.delete(draft.id)
                            }}
                            onClick={() => { setMenuDraftId(null); onSelectDraft(draft.id) }}
                            onKeyDown={event => handleDraftKeyDown(event, draft.id)}
                            disabled={interactionLocked}
                          >
                            <span className="history-draft-title" title={title}>{title}</span>
                            <span className="history-draft-meta" aria-hidden="true">
                              <time dateTime={draft.updatedAt} title={absoluteTime(draft.updatedAt)}>{relativeTime(draft.updatedAt, now)}</time>
                            </span>
                            {saveState === 'error' && <span className="history-sync-state local error" role="status">保存失败</span>}
                          </button>

                          <button
                            type="button"
                            className="history-draft-menu-button"
                            aria-label={`稿件“${title}”的更多操作`}
                            title="更多操作"
                            aria-expanded={menuDraftId === draft.id}
                            disabled={interactionLocked}
                            onClick={() => setMenuDraftId(menuDraftId === draft.id ? null : draft.id)}
                          >
                            <Ellipsis size={18} aria-hidden="true" />
                          </button>
                          {menuDraftId === draft.id && <div className="history-draft-menu">
                            <button type="button" className="history-delete-action" aria-label={`删除稿件“${title}”`} disabled={interactionLocked}
                              onClick={() => { setMenuDraftId(null); onDeleteDraft(draft.id) }}>
                              <Trash2 size={15} aria-hidden="true" />删除稿件（可撤销）
                            </button>
                          </div>}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })
          )}
        </div>
      </div>
    </aside>
  )
}
