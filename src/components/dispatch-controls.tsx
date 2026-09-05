import { useEffect, useRef } from 'react'
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

export type BridgeState = 'checking' | 'connected' | 'missing' | 'error'
export type WorkState = 'idle' | 'parsing' | 'ready' | 'publishing' | 'completed'

interface DispatchControlsProps {
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
  const platformAccounts = accounts.filter(account => !(account.raw && typeof account.raw === 'object' && 'type' in account.raw && account.raw.type === 'zip-download'))
  const selectedPlatforms = platformAccounts.filter(account => selectedIds.includes(account.id)).length
  const selectedDownloads = selectedIds.length - selectedPlatforms
  const isPublishing = workState === 'publishing'
  const terminalResults = results.filter(result => result.status === 'done' || result.status === 'failed')
  const hasFailures = results.some(result => result.status === 'failed')
  const successfulDrafts = results.filter(result => result.status === 'done' && result.delivery === 'draft').length
  const pendingDownloadChecks = results.filter(result => result.status === 'done' && result.requiresManualVerification).length
  const hasConnectedAccounts = bridgeState === 'connected' && accounts.length > 0
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
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen, onOpenChange])

  return (
    <>
      {showPublishTrigger && (
        <div className="dispatch-controls">
          <button
            type="button"
            className="publish-trigger"
            aria-label={`打开发布面板，已选 ${selectedPlatforms} 个，共 ${platformAccounts.length} 个平台`}
            title={hasArticle ? '实验性草稿同步 · Beta' : '填写正文后可同步草稿'}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            disabled={interactionLocked}
            onClick={() => {
              onOpenChange(true)
            }}
          >
            {isPublishing ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            <span>发布</span>
          </button>
        </div>
      )}

      {isOpen && (
        <div className="drawer-layer">
          <button type="button" className="drawer-backdrop" onClick={() => onOpenChange(false)} aria-label="关闭发布设置" />
          <aside className="dispatch-drawer" role="dialog" aria-modal="true" aria-labelledby="dispatch-drawer-title">
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">DELIVERY LANE</p>
                <h2 id="dispatch-drawer-title">{drawerTitle}</h2>
              </div>
              <button ref={drawerCloseRef} type="button" className="drawer-close" onClick={() => onOpenChange(false)} aria-label="关闭发布设置"><X size={18} /></button>
            </div>

            <div className={`bridge-status ${bridgeState}`}>
              {bridgeState === 'checking' && <><LoaderCircle className="spin" size={17} /><span>正在连接发布引擎</span><small>保留当前稿件</small></>}
              {bridgeState === 'connected' && <><PlugZap size={17} /><span>发布引擎已就绪</span><small>Wechatsync · {platformAccounts.length} 平台</small></>}
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
            ) : (
              <div className="drawer-platform-picker" aria-label="选择发布平台">
                <div className="drawer-platform-heading">
                  <div>
                    <strong>选择发布平台</strong>
                    <small>将分别创建平台草稿</small>
                  </div>
                  <span><b>{selectedPlatforms}</b>/{platformAccounts.length} 平台{selectedDownloads > 0 ? ` · ${selectedDownloads} 项本地下载` : ''}</span>
                </div>
                <div className="platform-list">
                  {accounts.map(account => {
                    const selected = selectedIds.includes(account.id)
                    const result = results.find(item => item.platform === account.id)
                    return (
                      <button
                        type="button"
                        key={account.id}
                        className={`platform-row ${selected ? 'selected' : ''}`}
                        onClick={() => !interactionLocked && onTogglePlatform(account.id)}
                        disabled={interactionLocked}
                        aria-pressed={selected}
                      >
                        <span className="platform-check">{selected && <Check size={13} />}</span>
                        {account.icon
                          ? <img src={account.icon} alt="" />
                          : <span className="platform-fallback">{account.name.slice(0, 1)}</span>}
                        <span className="platform-copy">
                          <strong>{account.name}</strong>
                          <small>{result ? statusLabel(result) : account.username || '已登录'}</small>
                        </span>
                        {result?.status === 'done' && <CheckCircle2 className="result-success" size={16} />}
                        {result?.status === 'failed' && <XCircle className="result-failed" size={16} />}
                        {result?.status === 'uploading' && <LoaderCircle className="spin" size={16} />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {terminalResults.length > 0 && (
              <div className="result-feedback" aria-live="polite">
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

            <div className="dispatch-footer">
              {workState === 'completed' && (
                <div className={`completion-note ${hasFailures ? 'partial' : ''}`}>
                  {hasFailures ? <CircleAlert size={20} /> : <CheckCircle2 size={20} />}
                  <span><strong>{successfulDrafts} 个草稿已创建</strong>{pendingDownloadChecks > 0 ? `另有 ${pendingDownloadChecks} 项下载待确认` : '请进入平台完成最终检查'}</span>
                </div>
              )}
              <div className="readiness-list" aria-label="发布前检查">
                <div className={hasArticle ? 'ready' : ''}>
                  {hasArticle ? <Check size={12} /> : <span className="readiness-dot" />}
                  <span>{hasArticle ? '稿件已在本地准备' : '请先导入稿件'}</span>
                </div>
                <div className={bridgeState === 'connected' ? 'ready' : ''}>
                  {bridgeState === 'connected' ? <Check size={12} /> : <span className="readiness-dot" />}
                  <span>{bridgeState === 'checking' ? '正在连接发布引擎' : bridgeState === 'connected' ? '发布引擎已就绪' : '发布引擎尚未就绪'}</span>
                </div>
                <div className={selectedIds.length > 0 ? 'ready' : ''}>
                  {selectedIds.length > 0 ? <Check size={12} /> : <span className="readiness-dot" />}
                  <span>{selectedIds.length > 0 ? `已选择 ${selectedPlatforms} 个平台${selectedDownloads ? `与 ${selectedDownloads} 项本地下载` : ''}` : hasConnectedAccounts ? '请选择至少一个平台' : '等待可用平台'}</span>
                </div>
              </div>
              <button type="button" className="publish-button" onClick={onPublish} disabled={!hasArticle || selectedIds.length === 0 || bridgeState !== 'connected' || interactionLocked}>
                {isPublishing ? <><LoaderCircle className="spin" size={18} /> 正在同步草稿</> : <><Send size={18} />{selectedDownloads ? `同步 ${selectedPlatforms} 个平台并下载 ${selectedDownloads} 项` : `同步到 ${selectedPlatforms} 个平台`}</>}
              </button>
              <p className="draft-policy">只创建草稿，不会自动公开发布</p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
