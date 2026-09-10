import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Eye, EyeOff, LoaderCircle, Square } from 'lucide-react'
import { AI_PROVIDERS, AiError, type AiProfile, type AiProvider, type AiSession } from '../domain/ai'
import { generateAiText } from '../lib/ai-client'
import { CodexConnection } from './codex-connection'
import geminiLogo from '../../SVG/gemini-color.svg'
import deepseekLogo from '../../SVG/deepseek-color.svg'
import zaiLogo from '../../SVG/zai.svg'
import openaiLogo from '../../SVG/openai.svg'
import './ai-connections.css'

export const providerLogos: Record<AiProvider, string> = { gemini: geminiLogo, deepseek: deepseekLogo, glm: zaiLogo, codex: openaiLogo }

interface Props {
  session: AiSession
  onChange: (session: AiSession) => void
  storageError?: boolean
  locked: boolean
  onReady: (ready: boolean) => void
  onTesting: (testing: boolean) => void
  visible: boolean
}

// Connection state stays mounted while moving between writing and configuration.
export function AiConnections({ session, onChange, storageError, locked, onReady, onTesting, visible }: Props) {
  const [showKey, setShowKey] = useState(false)
  const [codexConnected, setCodexConnected] = useState(false)
  const [status, setStatus] = useState({ kind: 'idle', text: '' })
  const active = useRef<AbortController | null>(null)
  const profile = session.profiles[session.provider]
  const provider = AI_PROVIDERS[session.provider]
  const busy = status.kind === 'running'
  const isCodex = session.provider === 'codex'
  const ready = Boolean(profile.model.trim() && (isCodex ? codexConnected : profile.apiKey.trim()))
  useEffect(() => { onReady(ready) }, [ready, onReady])
  useEffect(() => { if (!visible) setShowKey(false) }, [visible])
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  function changeProfile(patch: Partial<AiProfile>) {
    onChange({ ...session, profiles: { ...session.profiles, [session.provider]: { ...profile, ...patch } } })
    setStatus({ kind: 'idle', text: '' })
  }
  function changeProvider(next: AiProvider) {
    onChange({ ...session, provider: next })
    setCodexConnected(false); setShowKey(false); setStatus({ kind: 'idle', text: '' })
  }
  function clearKeys() {
    onChange({ ...session, profiles: {
      gemini: { ...session.profiles.gemini, apiKey: '' }, deepseek: { ...session.profiles.deepseek, apiKey: '' },
      glm: { ...session.profiles.glm, apiKey: '' }, codex: { ...session.profiles.codex, apiKey: '' },
    } })
    setShowKey(false); setStatus({ kind: 'idle', text: '已清空当前配置中的所有 API Key。' })
  }
  async function testConnection() {
    if (active.current || locked || !ready) return
    const controller = new AbortController(); active.current = controller
    onTesting(true); setStatus({ kind: 'running', text: '正在验证模型连接…' })
    try {
      await generateAiText({ provider: session.provider, profile, action: 'test', signal: controller.signal, onText: () => {} })
      if (active.current === controller) setStatus({ kind: 'success', text: provider.name + ' · ' + profile.model.trim() + ' 连接成功。' })
    } catch (error) {
      if (active.current !== controller) return
      setStatus(controller.signal.aborted ? { kind: 'cancelled', text: '已停止连接测试。' }
        : { kind: 'error', text: error instanceof AiError ? error.message : '连接失败，请重试。' })
    } finally {
      if (active.current === controller) { active.current = null; onTesting(false) }
    }
  }

  return <section className="ai-connections ai-config-module" aria-label="模型连接配置">
    <h3>连接你的模型</h3><p className="ai-privacy">连接配置在当前浏览器保存，与稿件内容分开。</p>
    <label htmlFor="ai-provider">模型</label>
    <div className="ai-model-select"><img className="ai-provider-logo" src={providerLogos[session.provider]} alt="" />
      <select id="ai-provider" value={session.provider} disabled={busy || locked} onChange={event => changeProvider(event.target.value as AiProvider)}>
        {(Object.keys(AI_PROVIDERS) as AiProvider[]).map(id => <option key={id} value={id}>{id === 'codex' ? 'Codex · 本机订阅' : AI_PROVIDERS[id].name + ' · ' + (session.profiles[id].model || '未设置模型')}</option>)}
      </select>
    </div>
    <div id="ai-model-settings" className="ai-model-settings">
      {isCodex ? <CodexConnection model={profile.model} disabled={busy || locked} onModel={model => changeProfile({ model })} onConnected={setCodexConnected} /> : <fieldset className="ai-config" disabled={busy || locked}>
        <label htmlFor="ai-model">模型名称</label>
        <input id="ai-model" value={profile.model} maxLength={128} spellCheck={false} autoComplete="off" placeholder={provider.model} onChange={event => changeProfile({ model: event.target.value })} />
        <div className="ai-key-heading"><label htmlFor="ai-key">API Key</label><a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">获取 Key<ArrowUpRight size={13} /></a></div>
        <div className="ai-key-input"><input id="ai-key" type={showKey ? 'text' : 'password'} value={profile.apiKey} maxLength={4096} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder={provider.name + ' API Key'} onChange={event => changeProfile({ apiKey: event.target.value })} />
          <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
        </div>
      </fieldset>}
      <div className="ai-connection-actions">
        {busy ? <button type="button" onClick={() => active.current?.abort()}><Square size={14} />停止测试</button>
          : <button type="button" disabled={!ready || locked} onClick={() => void testConnection()}>测试连接</button>}
        {!isCodex && <button type="button" className="ai-text-button" disabled={busy || locked || !Object.values(session.profiles).some(item => item.apiKey)} onClick={clearKeys}>清除所有 Key</button>}
      </div>
    </div>
    {storageError && <p className="ai-status ai-status-error" role="alert">浏览器未能保存本次配置。当前页面仍可使用，刷新可能恢复旧配置；如需彻底移除已保存的 Key，请清理本站的网站数据。</p>}
    {status.text && <p className={'ai-status ai-status-' + status.kind} role={status.kind === 'error' ? 'alert' : 'status'}>{busy && <LoaderCircle className="spin" size={15} />}{status.text}</p>}
  </section>
}
