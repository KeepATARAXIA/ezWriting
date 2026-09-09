import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Eye, EyeOff, Info, LoaderCircle, Settings2, Sparkles, Square } from 'lucide-react'
import { AI_PROMPT_LIMIT, AI_PROVIDERS, AiError, type AiAction, type AiProfile, type AiProvider, type AiSession } from '../domain/ai'
import { generateAiText } from '../lib/ai-client'
import { CodexConnection } from './codex-connection'
import { AiPolishPresets } from './ai-polish-presets'
import { readPolishSettings, savePolishSettings } from '../lib/ai-polish-settings'
import type { PolishPreset } from '../lib/ai-polish'
import { WRITING_TONES, writingPrompt, type WritingTone } from '../lib/ai-writing'
import geminiLogo from '../../SVG/gemini-color.svg'
import deepseekLogo from '../../SVG/deepseek-color.svg'
import zaiLogo from '../../SVG/zai.svg'
import openaiLogo from '../../SVG/openai.svg'
import './ai-connections.css'

const providerLogos: Record<AiProvider, string> = { gemini: geminiLogo, deepseek: deepseekLogo, glm: zaiLogo, codex: openaiLogo }

interface Props {
  session: AiSession
  onChange: (session: AiSession) => void
  storageError?: boolean
  locked: boolean
}

export function AiConnections({ session, onChange, storageError, locked }: Props) {
  const [presets, setPresets] = useState(readPolishSettings)
  const [presetIndex, setPresetIndex] = useState(() => Math.max(0, presets.findIndex(preset => preset.enabled)))
  const [presetNotice, setPresetNotice] = useState('')
  const [tones, setTones] = useState<WritingTone[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [managingPresets, setManagingPresets] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [codexConnected, setCodexConnected] = useState(false)
  const [prompt, setPrompt] = useState('用两句话介绍一个帮助创作者整理灵感的写作工具。')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<{ kind: 'idle' | 'running' | 'success' | 'error' | 'cancelled'; text: string }>({ kind: 'idle', text: '' })
  const active = useRef<AbortController | null>(null)
  const profile = session.profiles[session.provider]
  const provider = AI_PROVIDERS[session.provider]
  const busy = status.kind === 'running'
  const isCodex = session.provider === 'codex'
  const ready = Boolean(profile.model.trim() && (isCodex ? codexConnected : profile.apiKey.trim()))
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  function updatePresets(next: PolishPreset[]) {
    const existing = next.indexOf(presets[presetIndex])
    setPresetIndex(presetIndex < 0 ? -1 : existing >= 0 ? existing : Math.min(presetIndex, next.length - 1))
    setPresets(next)
    setPresetNotice(savePolishSettings(next) ? '' : '方案暂未保存，请补全名称和提示词，或检查浏览器存储权限。')
  }

  function changeProfile(patch: Partial<AiProfile>) {
    onChange({ ...session, profiles: { ...session.profiles, [session.provider]: { ...profile, ...patch } } })
    setStatus({ kind: 'idle', text: '' }); setOutput('')
  }
  function changeProvider(next: AiProvider) {
    onChange({ ...session, provider: next })
    setCodexConnected(false)
    setShowKey(false); setStatus({ kind: 'idle', text: '' }); setOutput('')
  }
  function clearKeys() {
    onChange({ ...session, profiles: {
      gemini: { ...session.profiles.gemini, apiKey: '' },
      deepseek: { ...session.profiles.deepseek, apiKey: '' },
      glm: { ...session.profiles.glm, apiKey: '' },
      codex: { ...session.profiles.codex, apiKey: '' },
    } })
    setShowKey(false); setStatus({ kind: 'idle', text: '已清空当前配置中的所有 API Key。' }); setOutput('')
  }
  async function run(action: AiAction) {
    if (active.current || locked || !ready || (action === 'generate' && !prompt.trim())) return
    let submittedPrompt: string | undefined
    try { if (action === 'generate') submittedPrompt = writingPrompt(prompt, presets[presetIndex], tones) }
    catch (error) { setStatus({ kind: 'error', text: (error as Error).message }); return }
    const controller = new AbortController()
    active.current = controller
    setOutput('')
    setStatus({ kind: 'running', text: action === 'test' ? '正在验证模型连接…' : '正在等待模型回复…' })
    try {
      await generateAiText({
        provider: session.provider, profile, action, prompt: submittedPrompt, signal: controller.signal,
        onText: text => {
          if (active.current !== controller || controller.signal.aborted) return
          if (action === 'generate') setOutput(previous => previous + text)
          setStatus({ kind: 'running', text: action === 'test' ? '已收到回复，正在确认完成…' : '正在生成…' })
        },
      })
      if (active.current === controller) setStatus({ kind: 'success', text: action === 'test' ? `${provider.name} · ${profile.model.trim()} 连接成功。` : '生成完成。' })
    } catch (error) {
      if (active.current !== controller) return
      setStatus(controller.signal.aborted
        ? { kind: 'cancelled', text: '已停止请求，保留已收到的文字。提供商可能已产生用量。' }
        : { kind: 'error', text: error instanceof AiError ? error.message : '请求失败，请重试。' })
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  return <div className="ai-connections ai-writing-tool">
    <div className="ai-sidebar-content">
      <section className="ai-writing-presets" aria-label="润色方案">
        <label htmlFor="ai-writing-preset">润色方案</label>
        <div className="ai-preset-picker"><select id="ai-writing-preset" value={presetIndex} disabled={busy || locked} onChange={event => setPresetIndex(Number(event.target.value))}>
          <option value={-1}>自由试写</option>
          {presets.map((preset, index) => <option key={index} value={index}>{preset.name || '未命名方案'}</option>)}
        </select><button type="button" className="ai-text-button" aria-label="管理方案" aria-expanded={managingPresets} aria-controls="ai-preset-manager" onClick={() => setManagingPresets(!managingPresets)}>管理</button></div>
        <div className="ai-tone-chips" role="group" aria-label="快捷风格">
          {(Object.keys(WRITING_TONES) as WritingTone[]).map(tone => <button type="button" key={tone} aria-pressed={tones.includes(tone)} disabled={busy || locked} onClick={() => setTones(current => current.includes(tone) ? current.filter(item => item !== tone) : [...current, tone])}>{tone}</button>)}
        </div>
        <details className="ai-preset-advanced">
          <summary>高级调整</summary>
          <fieldset disabled={busy || locked}>
            {presets.map((preset, index) => <div className="ai-preset-row" key={index}>
              <label className="ai-preset-choice"><input type="checkbox" checked={preset.enabled} onChange={event => updatePresets(presets.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item))} />{preset.name || '未命名方案'}</label>
              <label className="ai-preset-strength"><input aria-label={`${preset.name || '未命名方案'}润色强度`} type="range" min="0" max="100" step="10" value={preset.strength} onChange={event => updatePresets(presets.map((item, i) => i === index ? { ...item, strength: Number(event.target.value) } : item))} /><output>{preset.strength}%</output></label>
            </div>)}
          </fieldset>
        </details>
        <p className="ai-preset-strength-summary" aria-label="方案强度摘要">{presets.map(preset => `${({ 精简表达: '精简', 增强表现力: '表现力', '去 AI 味': '去AI味' } as Record<string, string>)[preset.name] ?? preset.name} ${preset.strength}%${preset.enabled ? '' : '（未勾选）'}`).join(' · ')}</p>
        {managingPresets && <AiPolishPresets locked={busy || locked} presets={presets} onChange={updatePresets} />}
        {presetNotice && <p className="ai-preset-hint" role="status">{presetNotice}</p>}
      </section>
      <section className="ai-model-picker" aria-label="模型选择">
        <label htmlFor="ai-provider">模型</label>
        <div className="ai-model-row">
          <div className="ai-model-select"><img className="ai-provider-logo" src={providerLogos[session.provider]} alt="" aria-hidden="true" />
            <select id="ai-provider" value={session.provider} disabled={busy || locked} onChange={event => changeProvider(event.target.value as AiProvider)}>
              {(Object.keys(AI_PROVIDERS) as AiProvider[]).map(id => <option key={id} value={id}>{session.profiles[id].model === AI_PROVIDERS[id].model
                ? { gemini: 'Gemini 3.8 Flash', deepseek: 'DeepSeek V4 Flash', glm: 'GLM 5.3', codex: 'Codex · 本机订阅' }[id]
                : AI_PROVIDERS[id].name + ' · ' + (session.profiles[id].model || '未设置模型')}</option>)}
            </select>
          </div>
          <button type="button" className="ai-settings-toggle" aria-label="模型设置" title="模型设置" aria-expanded={settingsOpen} aria-controls="ai-model-settings" onClick={() => { setSettingsOpen(!settingsOpen); setShowKey(false) }}><Settings2 size={18} /></button>
        </div>
      </section>
      <div id="ai-model-settings" className="ai-model-settings" hidden={!settingsOpen}>
        <h3>模型设置</h3>
        {isCodex ? <CodexConnection model={profile.model} disabled={busy || locked} onModel={model => changeProfile({ model })} onConnected={setCodexConnected} /> : <fieldset className="ai-config" disabled={busy || locked}>
          <label htmlFor="ai-model">模型名称</label>
          <input id="ai-model" value={profile.model} maxLength={128} spellCheck={false} autoComplete="off" placeholder={provider.model} onChange={event => changeProfile({ model: event.target.value })} />
          <div className="ai-key-heading"><label htmlFor="ai-key">API Key</label><a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">获取 Key<ArrowUpRight size={13} aria-hidden="true" /></a></div>
          <div className="ai-key-input"><input id="ai-key" type={showKey ? 'text' : 'password'} value={profile.apiKey} maxLength={4096} autoComplete="off" spellCheck={false} autoCapitalize="none" aria-describedby="ai-data-info" placeholder={provider.name + ' API Key'} onChange={event => changeProfile({ apiKey: event.target.value })} />
            <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </fieldset>}
        <div className="ai-connection-actions">
          <button type="button" disabled={!ready || busy || locked} onClick={() => void run('test')}>测试连接</button>
          {!isCodex && <button type="button" className="ai-text-button" disabled={busy || locked || !Object.values(session.profiles).some(item => item.apiKey)} onClick={clearKeys}>清除所有 Key</button>}
        </div>
      </div>
      {storageError && <p className="ai-status ai-status-error" role="alert">浏览器未能保存本次配置。当前页面仍可使用，刷新可能恢复旧配置；如需彻底移除已保存的 Key，请清理本站的网站数据。</p>}
      <section className="ai-playground" aria-label="试写">
        <div className="ai-section-heading"><label htmlFor="ai-prompt">试写</label>
          <div className="ai-info" onMouseEnter={() => setInfoOpen(true)} onMouseLeave={() => setInfoOpen(false)}>
            <button type="button" aria-label="隐私与用量说明" aria-describedby="ai-data-info" aria-expanded={infoOpen} onFocus={() => setInfoOpen(true)} onBlur={() => setInfoOpen(false)} onClick={() => setInfoOpen(true)} onKeyDown={event => { if (event.key === 'Escape' && infoOpen) { event.preventDefault(); event.stopPropagation(); setInfoOpen(false) } }}><Info size={15} /></button>
            <div id="ai-data-info" role="tooltip" hidden={!infoOpen}>{isCodex
              ? '只发送试写框内容、所选方案和快捷风格，经本机 Codex 使用 ChatGPT 订阅；不经本站服务器。连接码仅保留在标签页会话中。'
              : '只发送试写框内容、所选方案和快捷风格。Key 保存在当前浏览器，可在模型设置中清除。请求经本站服务器转发，本站不保存或记录 Key 与正文。'}测试与生成会消耗模型额度，关闭面板会停止当前请求。当前稿件不会自动发送或修改。</div>
          </div>
        </div>
        <textarea id="ai-prompt" value={prompt} maxLength={AI_PROMPT_LIMIT} disabled={busy || locked} placeholder="写下要生成的内容，或粘贴一段文字试试…" onChange={event => { setPrompt(event.target.value); setStatus({ kind: 'idle', text: '' }); setOutput('') }} />
        <div className="ai-writing-count">{prompt.length.toLocaleString()} / {AI_PROMPT_LIMIT.toLocaleString()}</div>
      </section>
      {status.text && <p className={'ai-status ai-status-' + status.kind} role={status.kind === 'error' ? 'alert' : 'status'}>{busy && <LoaderCircle className="spin" size={15} />}{status.kind === 'success' && <Check size={15} />}{status.text}</p>}
      {output && <section className="ai-output" aria-label="生成结果" aria-busy={busy}><h3>生成结果{status.kind === 'error' || status.kind === 'cancelled' ? <small>未完成</small> : null}</h3><div>{output}</div></section>}
    </div>
    <footer className="ai-writing-footer">
      {!ready && <div className="ai-setup-hint"><span>{isCodex ? '先连接本机 Codex' : '先配置模型与 Key'}</span><button type="button" className="ai-text-button" onClick={() => setSettingsOpen(true)}>打开模型设置</button></div>}
      {busy ? <button type="button" className="ai-primary" onClick={() => active.current?.abort()}><Square size={15} />停止</button>
        : <button type="button" className="ai-primary" disabled={!ready || !prompt.trim() || locked} onClick={() => void run('generate')}><Sparkles size={16} />生成文字</button>}
    </footer>
  </div>
}
