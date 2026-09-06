import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react'
import type { PlatformAccount, PublishResult } from '../domain/article'
import type { BrowserExtensionGuide } from '../lib/browser-extension-install'
import './dispatch-controls.css'

export type BridgeState = 'checking' | 'connected' | 'missing' | 'error'
export type WorkState = 'idle' | 'parsing' | 'ready' | 'publishing' | 'completed'

interface DispatchControlsProps {
  drawerTarget?: HTMLElement | null
  accounts: PlatformAccount[]
  bridgeError: string | null
  bridgeState: BridgeState
  hasArticle: boolean
  installGuide: BrowserExtensionGuide
  interactionLocked?: boolean
  isOpen: boolean
  results: PublishResult[]
  selectedIds: string[]
  showPublishTrigger?: boolean
  workState: WorkState
  onOpenChange: (open: boolean) => void
  onPublish: () => void
  onRefresh: () => void
  onTogglePlatform: (id: string) => void
}

function statusLabel(result: PublishResult): string {
  if (result.status === 'done' && result.delivery === 'download') return '已请求下载'
  return {
    pending: '等待中',
    uploading: '处理中',
    done: '草稿已创建',
    failed: '同步失败',
  }[result.status]
}

export function DispatchControls({
  drawerTarget,
  accounts,
  bridgeError,
  bridgeState,
  hasArticle,
  installGuide,
  interactionLocked = false,
  isOpen,
  results,
  selectedIds,
  showPublishTrigger = true,
  workState,
  onOpenChange,
  onPublish,
  onRefresh,
  onTogglePlatform,
}: DispatchControlsProps) {
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const [drawerWidth, setDrawerWidth] = useState(() => {
    try {
      const saved = window.localStorage.getItem('dispatch.publish-sidebar-width.v1')
      const width = saved === null ? 360 : Number(saved)
      return Number.isFinite(width) ? Math.max(280, Math.min(440, width)) : 360
    } catch { return 360 }
  })
  const dragWidth = useRef<number | null>(null)
  const saveWidth = (width: number) => {
    setDrawerWidth(width)
    try { window.localStorage.setItem('dispatch.publish-sidebar-width.v1', String(width)) } catch { /* Resizing still works without storage. */ }
  }
  const platformAccounts = accounts.filter(account => !(account.raw && typeof account.raw === 'object' && 'type' in account.raw && account.raw.type === 'zip-download'))
  const downloadAccounts = accounts.filter(account => !platformAccounts.includes(account))
  const chosenPlatforms = platformAccounts.filter(account => selectedIds.includes(account.id))
  const selectedPlatforms = chosenPlatforms.length
  const selectedDownloads = downloadAccounts.filter(account => selectedIds.includes(account.id)).length
  const isPublishing = workState === 'publishing'
  const terminalResults = results.filter(result => result.status === 'done' || result.status === 'failed')
  const hasFailures = results.some(result => result.status === 'failed')
  const successfulDrafts = results.filter(result => result.status === 'done' && result.delivery === 'draft').length
  const pendingDownloadChecks = results.filter(result => result.status === 'done' && result.requiresManualVerification).length
  const hasConnectedAccounts = bridgeState === 'connected' && accounts.length > 0
  const selectionLocked = interactionLocked || isPublishing || bridgeState !== 'connected'
  const disabledReason = isPublishing ? '正在同步草稿'
    : interactionLocked ? '请等待当前操作完成'
      : !hasArticle ? '请先填写正文'
        : bridgeState === 'checking' ? '正在连接发布引擎'
          : bridgeState !== 'connected' ? '请先连接发布引擎'
            : !hasConnectedAccounts ? '请先登录并连接平台'
              : selectedPlatforms + selectedDownloads === 0 ? '请至少选择 1 个平台' : ''
  const targetNames = chosenPlatforms.map(account => account.name === '微信公众号' ? '微信' : account.name).join('、')
  const publishLabel = selectedDownloads
    ? selectedPlatforms ? `同步到 ${selectedPlatforms} 个平台并下载` : `下载 ${selectedDownloads} 项到本地`
    : selectedPlatforms <= 2 && targetNames.length <= 18 ? `同步到${targetNames}` : `同步到 ${selectedPlatforms} 个平台`
  const repeatDrafts = results.filter(result => result.status === 'done' && result.delivery === 'draft' && selectedIds.includes(result.platform)).length
  const renderAccount = (account: PlatformAccount, download = false) => {
    const selected = selectedIds.includes(account.id)
    const result = results.find(item => item.platform === account.id)
    const unavailable = bridgeState !== 'connected' ? bridgeState === 'checking' ? '连接中' : '未连接'
      : isPublishing ? '同步中' : interactionLocked ? '操作中' : ''
    const label = bridgeState === 'connected' && result ? statusLabel(result) : unavailable || (selected ? '已选' : download ? '可下载' : '可选')
    return <button type="button" key={account.id} className={`platform-row ${selected ? 'selected' : ''}`}
      onClick={() => { if (!selectionLocked) onTogglePlatform(account.id) }} disabled={selectionLocked} aria-pressed={selected}
      title={unavailable ? `${account.name}：${unavailable}` : `${account.name}${account.username ? ` · ${account.username}` : ''}`}>
      {account.icon ? <img src={account.icon} alt="" /> : <span className="platform-fallback">{account.name.slice(0, 1)}</span>}
      <span className="platform-copy"><strong>{account.name}</strong><small>{account.username || (download ? '保存到本机' : '已读取登录账号')}</small></span>
      <span className={`platform-row-status ${result?.status || ''}`}>{result?.status === 'uploading' && <LoaderCircle className="spin" size={12} />}{label}</span>
      <span className="platform-check" aria-hidden="true">{selected && <Check size={12} />}</span>
    </button>
  }
  const drawerTitle = bridgeState === 'missing'
    ? '安装发布引擎'
    : bridgeState === 'error'
      ? '恢复发布引擎'
      : bridgeState === 'checking'
        ? '正在连接发布引擎'
    : '同步平台草稿 · Beta'

  useEffect(() => {
    if (!isOpen) return
    drawerCloseRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onOpenChange(false)
        document.querySelector<HTMLButtonElement>('.publish-trigger')?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape, true)
    return () => document.removeEventListener('keydown', closeOnEscape, true)
  }, [isOpen, onOpenChange])

  const drawer = isOpen && (
        <div ref={drawerRef} className="drawer-layer dispatch-dock" style={{ '--dispatch-sidebar-width': `${drawerWidth}px` } as CSSProperties}>
          <div className="dispatch-resizer" role="separator" tabIndex={0} aria-label="调整发布侧栏宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={440} aria-valuenow={drawerWidth}
            title="拖动调整宽度；双击恢复默认宽度"
            onPointerDown={event => {
              event.preventDefault()
              dragWidth.current = drawerWidth
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={event => {
              if (dragWidth.current === null || !drawerRef.current) return
              const width = Math.max(280, Math.min(440, drawerRef.current.getBoundingClientRect().right - event.clientX))
              dragWidth.current = width
              setDrawerWidth(width)
            }}
            onPointerUp={event => {
              if (dragWidth.current === null) return
              saveWidth(dragWidth.current)
              dragWidth.current = null
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onLostPointerCapture={() => { dragWidth.current = null }}
            onDoubleClick={() => saveWidth(360)}
            onKeyDown={event => {
              if (event.key === 'Home') { event.preventDefault(); onOpenChange(false); document.querySelector<HTMLButtonElement>('.publish-trigger')?.focus(); return }
              const next = event.key === 'ArrowLeft' ? drawerWidth + 16 : event.key === 'ArrowRight' ? drawerWidth - 16 : event.key === 'End' ? 440 : null
              if (next === null) return
              event.preventDefault()
              saveWidth(Math.max(280, Math.min(440, next)))
            }}><span /></div>
          <aside className="dispatch-drawer" role="dialog" aria-labelledby="dispatch-drawer-title">
            <div className="drawer-heading">
              <div>
                <h2 id="dispatch-drawer-title">{drawerTitle}</h2>
              </div>
              <button ref={drawerCloseRef} type="button" className="drawer-close" onClick={() => onOpenChange(false)} aria-label="关闭发布设置"><X size={18} /></button>
            </div>

            <div className="dispatch-body">
            <div className={`bridge-status ${bridgeState}`} role="status">
              {bridgeState === 'checking' && <><LoaderCircle className="spin" size={17} /><span>正在连接发布引擎</span><small>保留当前稿件</small></>}
              {bridgeState === 'connected' && <><PlugZap size={15} /><span>已连接 {platformAccounts.length} 个平台</span><button type="button" className="dispatch-refresh" aria-label="刷新平台连接" title="刷新平台连接" disabled={selectionLocked} onClick={onRefresh}><RefreshCw size={14} /></button></>}
              {bridgeState === 'missing' && <><CircleAlert size={17} /><span>需要一次安装</span><small>约 1 分钟</small></>}
              {bridgeState === 'error' && <><XCircle size={17} /><span>发布引擎连接异常</span><small>稿件未丢失</small></>}
            </div>

            {(bridgeState !== 'connected' || platformAccounts.length === 0) && (
              <p className="privacy-note">本地编辑、预览与导出不需要连接发布引擎。<button type="button" className="soft-button" onClick={() => onOpenChange(false)}>继续本地编辑</button></p>
            )}

            {bridgeState === 'checking' ? (
              <div className="bridge-waiting" aria-live="polite"><span /><span /><span /></div>
            ) : bridgeState === 'missing' ? (
              <div className="bridge-onboarding">
                <p className="bridge-card-kicker">ONE-TIME SETUP</p>
                <h3>{installGuide.heading}</h3>
                <p className="bridge-card-copy">{installGuide.copy}</p>
                <ol className="setup-steps">
                  {installGuide.steps.map((step, index) => (
                    <li key={step.title}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                    </li>
                  ))}
                </ol>
                <div className="bridge-actions">
                  <a href={installGuide.primaryUrl} target="_blank" rel="noreferrer" className="outline-button">{installGuide.primaryLabel} <ExternalLink size={15} /></a>
                  {installGuide.secondaryUrl && (
                    <a href={installGuide.secondaryUrl} target="_blank" rel="noreferrer" className="soft-button" style={{ textDecoration: 'none' }}>{installGuide.secondaryLabel} <ExternalLink size={14} /></a>
                  )}
                  <button type="button" className="soft-button" disabled={interactionLocked} onClick={onRefresh}><RefreshCw size={14} /> 已安装，重新连接</button>
                </div>
                <p className="privacy-note"><ShieldCheck size={13} /> {installGuide.compatibilityNote}</p>
              </div>
            ) : bridgeState === 'error' ? (
              <div className="bridge-recovery">
                <strong>当前稿件已保留，可以安全重试。</strong>
                <p>{bridgeError || '扩展没有返回可识别的平台数据。请确认扩展已启用后重新连接。'}</p>
                <button type="button" className="outline-button" disabled={interactionLocked} onClick={onRefresh}>重新连接 <RefreshCw size={14} /></button>
              </div>
            ) : accounts.length === 0 ? (
              <div className="bridge-empty">
                <strong>引擎已经连接，还差平台登录。</strong>
                <p>请在当前浏览器登录目标内容平台，返回后重新读取账号。</p>
                <button type="button" className="soft-button" disabled={interactionLocked} onClick={onRefresh}><RefreshCw size={14} /> 重新读取账号</button>
              </div>
            ) : null}

            {accounts.length > 0 && (
              <div className="drawer-platform-picker" aria-label="选择发布平台">
                <div className="drawer-platform-heading">
                  <strong>选择发布平台</strong>
                  <span aria-live="polite">已选 <b>{selectedPlatforms}</b> / {platformAccounts.length}</span>
                </div>
                <div className="platform-selection-actions"><span>先选平台，再同步草稿</span><button type="button" disabled={selectionLocked || selectedPlatforms === platformAccounts.length} onClick={() => platformAccounts.filter(account => !selectedIds.includes(account.id)).forEach(account => onTogglePlatform(account.id))}>全选</button><button type="button" disabled={selectionLocked || selectedIds.length === 0} onClick={() => selectedIds.forEach(onTogglePlatform)}>清空</button></div>
                <div className="platform-list">{platformAccounts.map(account => renderAccount(account))}</div>
                {downloadAccounts.length > 0 && <div className="dispatch-downloads"><h3>本地下载 <small>不计入同步平台</small></h3>{downloadAccounts.map(account => renderAccount(account, true))}</div>}
              </div>
            )}

            {terminalResults.length > 0 && (
              <div className="result-feedback" aria-live="polite">
                <h3>同步结果 · {terminalResults.length} / {results.length}</h3>
                {terminalResults.map(result => (
                  <div className={`result-feedback-item ${result.status}`} key={result.platform}>
                    <div className="result-feedback-heading"><strong>{result.name}</strong><span>{statusLabel(result)}</span></div>
                    {result.error && <p>{result.error}</p>}
                    {result.requiresManualVerification && <p>{result.message}</p>}
                    {result.status === 'done' && result.delivery === 'draft' && !result.draftUrl && <p>扩展未返回草稿链接，请进入平台草稿箱核对。</p>}
                    {result.draftUrl && <a href={result.draftUrl} target="_blank" rel="noreferrer">打开草稿 <ExternalLink size={13} /></a>}
                    {result.helpUrl && <a href={result.helpUrl} target="_blank" rel="noreferrer">{result.helpLabel || '查看帮助'} <ExternalLink size={13} /></a>}
                  </div>
                ))}
              </div>
            )}
            </div>

            <div className="dispatch-footer">
              {workState === 'completed' && (
                <div className={`completion-note ${hasFailures ? 'partial' : ''}`}>
                  {hasFailures ? <CircleAlert size={20} /> : <CheckCircle2 size={20} />}
                  <span><strong>{successfulDrafts} 个草稿已创建</strong>{pendingDownloadChecks > 0 ? `另有 ${pendingDownloadChecks} 项下载待确认` : '请进入平台完成最终检查'}</span>
                </div>
              )}
              <div className="readiness-list" aria-label="发布前检查">
                <h3>{isPublishing ? `正在同步 · ${terminalResults.length} / ${results.length}` : '同步前检查'}</h3>
                <div className={hasArticle ? 'ready' : ''}>
                  {hasArticle ? <Check size={12} /> : <span className="readiness-dot" />}
                  <span>{hasArticle ? '正文已准备' : '请先填写正文'}</span>
                </div>
                <div className={bridgeState === 'connected' ? 'ready' : ''}>
                  {bridgeState === 'connected' ? <Check size={12} /> : <span className="readiness-dot" />}
                  <span>{bridgeState === 'checking' ? '正在连接发布引擎' : bridgeState === 'connected' ? '发布引擎已就绪' : '发布引擎尚未就绪'}</span>
                </div>
                <div className={selectedPlatforms + selectedDownloads > 0 ? 'ready' : ''}>
                  {selectedPlatforms + selectedDownloads > 0 ? <Check size={12} /> : <span className="readiness-dot" />}
                  <span>{selectedPlatforms + selectedDownloads > 0 ? selectedPlatforms ? `将同步到 ${selectedPlatforms} 个平台${selectedDownloads ? `，并下载 ${selectedDownloads} 项` : ''}` : `将下载 ${selectedDownloads} 项到本地` : hasConnectedAccounts ? '请至少选择 1 个平台' : '等待可用平台'}</span>
                </div>
                {!isPublishing && repeatDrafts > 0 && <p className="dispatch-check-warning">{repeatDrafts} 个已选平台已创建草稿，再次同步可能产生重复草稿。</p>}
                {!isPublishing && results.some(result => result.requiresManualVerification && selectedIds.includes(result.platform)) && <p className="dispatch-check-warning">部分结果待核对，请先查看平台草稿箱或本地下载，再决定是否重试。</p>}
                {bridgeState === 'connected' && <p className="dispatch-permission-note">平台权限将在同步时验证。</p>}
              </div>
              <button type="button" className="publish-button" onClick={onPublish} disabled={Boolean(disabledReason)} title={disabledReason || publishLabel}>
                {isPublishing ? <><LoaderCircle className="spin" size={18} /> 正在同步草稿</> : <><Send size={17} />{disabledReason || publishLabel}</>}
              </button>
              <p className="draft-policy">只创建草稿，不会自动公开发布</p>
            </div>
          </aside>
        </div>
      )
  return (
    <>
      {showPublishTrigger && <div className="dispatch-controls">
        <button type="button" className="publish-trigger"
          aria-label={`打开发布面板，已选 ${selectedPlatforms} 个，共 ${platformAccounts.length} 个平台`}
          title={hasArticle ? '实验性草稿同步 · Beta' : '填写正文后可同步草稿'}
          aria-expanded={isOpen} aria-haspopup="dialog" disabled={interactionLocked}
          onClick={() => onOpenChange(!isOpen)}>
          {isPublishing ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}<span>发布</span>
        </button>
      </div>}
      {drawerTarget ? createPortal(drawer, drawerTarget) : drawer}
    </>
  )
}
