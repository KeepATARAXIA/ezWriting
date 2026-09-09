import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { getCodexToken, readCodexStatus, setCodexToken, type CodexStatus } from '../lib/codex-client'

interface Props {
  model: string
  disabled: boolean
  onModel: (model: string) => void
  onConnected: (connected: boolean) => void
}

export function CodexConnection({ model, disabled, onModel, onConnected }: Props) {
  const [code, setCode] = useState(getCodexToken)
  const [info, setInfo] = useState<CodexStatus | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const active = useRef<AbortController | null>(null)
  const callbacks = useRef({ model, onModel, onConnected })
  callbacks.current = { model, onModel, onConnected }

  async function connect(token: string) {
    if (active.current) return
    const controller = new AbortController(); active.current = controller
    setChecking(true); setError(''); callbacks.current.onConnected(false)
    try {
      const result = await readCodexStatus(token, controller.signal)
      if (controller.signal.aborted) return
      setCodexToken(token); setInfo(result)
      if (!result.models.some(item => item.id === callbacks.current.model)) {
        callbacks.current.onModel((result.models.find(item => item.isDefault) ?? result.models[0])?.id ?? '')
      }
      callbacks.current.onConnected(result.models.length > 0)
    } catch (cause) {
      if (!controller.signal.aborted) { setInfo(null); setError(cause instanceof Error ? cause.message : '连接失败，请重试。') }
    } finally {
      if (active.current === controller) { active.current = null; setChecking(false) }
    }
  }
  useEffect(() => {
    const saved = getCodexToken()
    if (saved) void connect(saved)
    return () => { active.current?.abort(); active.current = null }
  }, [])

  return <section className="ai-codex-connection" aria-label="Codex 本地连接">
    <p className="ai-privacy">使用本机已登录的 ChatGPT 订阅，额度与 Codex 共用。无需 API Key。</p>
    {!info && <details className="ai-codex-help" open>
      <summary>启动本机连接</summary>
      <p>在本项目目录打开终端，运行：</p><code>npm run codex:bridge</code>
      <p>保持连接程序运行，将窗口中的连接码粘贴到下方。尚未登录时，先运行 <code>codex login</code> 并选择 ChatGPT 登录。</p>
    </details>}
    <fieldset className="ai-config" disabled={disabled || checking}>
      <legend className="sr-only">Codex 连接配置</legend>
      {!info && <><label htmlFor="codex-code">本机连接码</label>
        <input id="codex-code" type="password" value={code} maxLength={128} autoComplete="off" spellCheck={false} placeholder="粘贴连接程序中的连接码" onChange={event => { setCode(event.target.value); setError('') }} /></>}
      {info && <><label htmlFor="ai-model">模型名称</label>
        <select id="ai-model" value={model} onChange={event => onModel(event.target.value)}>
          {!info.models.length && <option value="">账号暂无可用文本模型</option>}
          {info.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></>}
      <div className="ai-connection-actions">
        <button type="button" disabled={!code.trim()} onClick={() => void connect(code)}>{checking ? <LoaderCircle size={14} className="spin" /> : info ? <Check size={14} /> : null}{checking ? '正在连接…' : info ? '刷新连接与额度' : '连接本机 Codex'}</button>
        {getCodexToken() && <button type="button" className="ai-text-button" onClick={() => { setCodexToken(''); setCode(''); setInfo(null); setError(''); onConnected(false) }}>断开连接</button>}
      </div>
    </fieldset>
    {info && <div className="ai-codex-account" role="status">
      <p>已连接{info.plan ? ` · ${info.plan}` : ''} · ChatGPT 订阅</p>
      {info.limits.length ? info.limits.map((bucket, i) => <div key={i}>
        <span>{bucket.name}</span>
        {bucket.windows.map((window, j) => <p key={j}>{window.minutes >= 1440 ? `${Math.round(window.minutes / 1440)} 天` : `${window.minutes / 60} 小时`}额度剩余 <strong>{Math.max(0, Math.min(100, 100 - window.usedPercent))}%</strong>
          <small>{new Date(window.resetsAt * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 重置</small></p>)}
      </div>) : <p>暂时无法读取剩余额度。</p>}
      {!info.models.length && <p>此账号暂无可用文本模型。</p>}
    </div>}
    {error && <p className="ai-status ai-status-error" role="alert">{error}</p>}
    <p className="ai-privacy">连接码仅保留在当前标签页会话中。试写和选段内容经本机 Codex 发送给 OpenAI，不经过本站服务器。</p>
  </section>
}
