import { useEffect, useRef, useState } from 'react'
import { RotateCw, Sparkles, Square, FileText, Settings2, Info, Type, ChevronDown } from 'lucide-react'
import { AI_PROVIDERS, type AiProvider, type AiSession } from '../domain/ai'
import { completedPolishOptions, parsePolishOptions, polishPrompt, textDifferences, type AiSelection, type PolishPreset } from '../lib/ai-polish'
import { readPolishSettings, savePolishSettings } from '../lib/ai-polish-settings'
import { generateAiText } from '../lib/ai-client'
import { getCodexToken } from '../lib/codex-client'
import { WorkbenchDialog } from './workbench-dialog'
import './ai-connections.css'
import './ai-polish-dialog.css'
import './ai-polish-presets.css'

interface Props {
  selection: AiSelection
  session: AiSession
  onChange: (session: AiSession) => void
  storageError?: boolean
  locked: boolean
  onClose: () => void
  onConfigure: () => void
}

export function AiPolishDialog({ selection, session, onChange, storageError, locked, onClose, onConfigure }: Props) {
  const [options, setOptions] = useState<string[]>([])
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null)
  const applied = appliedIndex !== null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showChanges, setShowChanges] = useState<number[]>([])
  const [presets, setPresets] = useState(readPolishSettings)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [adjusting, setAdjusting] = useState(false)
  const [runSession, setRunSession] = useState<AiSession | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const adjustRef = useRef<HTMLElement>(null)
  const adjustButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (adjusting) adjustRef.current?.querySelector<HTMLSelectElement>('select')?.focus() }, [adjusting])
  const [runPresets, setRunPresets] = useState<PolishPreset[]>([])
  const [storageNotice, setStorageNotice] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [received, setReceived] = useState({ characters: 0, completed: 0 })
  const startedAt = useRef(0)
  const lastReceivedAt = useRef(0)
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    // A new result always starts at the beginning of the shared reading surface.
    if (options.length && bodyRef.current) bodyRef.current.scrollTop = 0
  }, [options])
  const profile = session.profiles[session.provider]
  const ready = Boolean(profile.model.trim() && (session.provider === 'codex' ? getCodexToken() : profile.apiKey.trim()))
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  const selected = presets.filter(preset => preset.enabled)
  const count = runPresets.length || selected.length
  const completed = Math.min(received.completed, count)
  const percent = count ? Math.floor(completed / count * 100) : 0
  const stalled = busy && elapsed >= 20 && Date.now() - lastReceivedAt.current >= 20_000

  function updatePresets(next: PolishPreset[]) {
    setPresets(next)
    setStorageNotice(savePolishSettings(next) ? '' : '设置暂未保存。请补全名称和提示词；若仍无法保存，请检查浏览器存储权限。')
    if (options.length) setNotice('设置已更改，下次生成生效。当前结果仍使用生成时的方案与强度。')
  }
  function updatePreset(index: number, patch: Partial<PolishPreset>) {
    updatePresets(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))
  }
  function stop() {
    const controller = active.current
    active.current = null
    controller?.abort()
    setBusy(false); setNotice('已停止生成，原文保持不变。')
  }

  function close() {
    onClose()
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.cm-content')?.focus())
  }
  async function generate(reuse = false) {
    const config = reuse && runSession ? runSession : session
    const plans = reuse ? runPresets : selected
    const targetProfile = config.profiles[config.provider]
    if (locked || applied || active.current || !targetProfile.model.trim() || !(config.provider === 'codex' ? getCodexToken() : targetProfile.apiKey.trim())) return
    let prompt: string
    try { prompt = polishPrompt(selection, plans) } catch (error) { setError((error as Error).message); return }
    setError(''); setNotice(''); setOptions([]); setShowChanges([]); setAdjusting(false); setSourceOpen(false)
    const controller = new AbortController()
    active.current = controller; setBusy(true)
    setSettingsOpen(false)
    setRunPresets(plans.map(preset => ({ ...preset })))
    setRunSession({ ...config, profiles: { ...config.profiles, [config.provider]: { ...targetProfile } } })
    startedAt.current = Date.now(); lastReceivedAt.current = Date.now()
    setElapsed(0); setReceived({ characters: 0, completed: 0 })
    let text = ''
    try {
      await generateAiText({ provider: config.provider, profile: targetProfile, action: 'polish', prompt, signal: controller.signal, onText: chunk => {
        if (active.current !== controller || controller.signal.aborted) return
        text += chunk
        if (chunk) lastReceivedAt.current = Date.now()
        setReceived({ characters: text.length, completed: completedPolishOptions(text) })
      } })
      if (active.current !== controller || controller.signal.aborted) return
      setOptions(parsePolishOptions(text, selection.original, plans.length).map((option, index) => plans[index].strength === 0 ? selection.original : option))
      setNotice('仅替换选中文字；确认应用后，可在编辑器撤销。')
    } catch (error) {
      if (active.current !== controller) return
      if (controller.signal.aborted) setNotice('已停止生成，原文保持不变。')
      else setError(error instanceof Error ? error.message : '生成失败，请重试。')
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }

  const hasResults = options.length > 0
  const modelPicker = <label className="ai-polish-model"><select aria-label="润色模型" value={session.provider} disabled={busy || locked} onChange={event => {
          onChange({ ...session, provider: event.target.value as AiProvider })
          setError('')
          if (options.length) setNotice('模型已切换，下次生成生效。当前结果保持不变。')
        }}>{(Object.keys(AI_PROVIDERS) as AiProvider[]).map(id => <option key={id} value={id}>{AI_PROVIDERS[id].name} · {session.profiles[id].model || '未设置模型'}</option>)}</select></label>
  const presetSettings = <details className="ai-preset-settings" open={adjusting || settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
        <summary><Settings2 size={20} />方案与强度 <span>已选 {selected.length} 个</span></summary>
        <fieldset disabled={busy || locked}>
          <p className="ai-preset-hint">勾选本次方案；强度越低，越贴近原文。百分比是改写幅度指导，不代表精确修改字数；0% 保留原文。</p>
          {presets.map((preset, index) => <div className="ai-preset-row" key={index}>
            <div className="ai-preset-controls">
              <label className="ai-preset-choice"><input aria-label={preset.name || '未命名方案'} type="checkbox" checked={preset.enabled} onChange={event => updatePreset(index, { enabled: event.target.checked })} />{index === 0 ? <FileText size={20} /> : index === 1 ? <Sparkles size={20} /> : <Type size={20} />}<span className="ai-preset-copy"><strong>{preset.name || '未命名方案'}</strong><small title={preset.instruction}>{index === 0 && preset.name === '精简表达' ? '删除冗余，表达更简洁' : index === 1 && preset.name === '增强表现力' ? '优化用词，增强感染力' : index === 2 && preset.name === '去 AI 味' ? '更自然、直接的表达' : preset.instruction}</small></span></label>
              <label className="ai-preset-strength"><input aria-label={`${preset.name || '未命名方案'}润色强度`} type="range" min="0" max="100" step="10" value={preset.strength} onChange={event => updatePreset(index, { strength: Number(event.target.value) })} /><output>{preset.strength}%</output></label>
            </div>
          </div>)}
          <p className="ai-preset-hint ai-preset-manage-note"><Info size={16} />新增方案、编辑名称和提示词，请前往左侧「AI 工具 → 润色方案」。</p>
        </fieldset>
      </details>

  return <WorkbenchDialog title="AI 选段润色" onClose={close} movable headerContent={<>
        <h2><Sparkles size={24} />AI 选段润色</h2>
        {hasResults ? <span className="ai-polish-meta">{runSession && AI_PROVIDERS[runSession.provider].name} · {runSession?.profiles[runSession.provider].model}</span> : modelPicker}
        <span className="ai-polish-meta">选中 {selection.original.length} 字</span>

      </>}>
    <div className={`ai-polish-dialog ai-connections ai-polish-comparison${hasResults ? ' ai-polish-results' : ''}`}>
      {hasResults && <div className="ai-results-toolbar"><h3 className="ai-results-heading">润色结果 <span>· {options.length} 个方案</span></h3>
        <button type="button" className="ai-text-button" aria-expanded={sourceOpen} aria-controls="ai-polish-source" onClick={() => { setSourceOpen(!sourceOpen); if (bodyRef.current) bodyRef.current.scrollTop = 0 }}>{sourceOpen ? '收起原文与上下文' : '查看原文与上下文'}</button>
      </div>}
      <div className="ai-polish-body" ref={bodyRef}>
      {(!hasResults || sourceOpen) && <aside id="ai-polish-source" className="ai-comparison-source" aria-label="原文与上下文">
        <details className="ai-context-preview" role="region" aria-label="上文" open={Boolean(selection.contextBefore)}><summary><ChevronDown size={16} /><strong>上文</strong><span>（{selection.contextBefore.length} 字）</span><small>{selection.contextBefore || '暂无上文'}</small></summary><p>{selection.contextBefore || '暂无上文'}</p></details>
        <section className="ai-polish-original" aria-label="待润色原文"><h3><FileText size={18} />原文 <span>（{selection.original.length} 字）</span><em>当前选中</em></h3><p id="ai-original-text">{selection.original}</p></section>
        <details className="ai-context-preview" role="region" aria-label="下文" open={Boolean(selection.contextAfter)}><summary><ChevronDown size={16} /><strong>下文</strong><span>（{selection.contextAfter.length} 字）</span><small>{selection.contextAfter || '暂无下文'}</small></summary><p>{selection.contextAfter || '暂无下文'}</p></details>
      </aside>}
      <div className="ai-comparison-versions">


      {!hasResults && presetSettings}
      {storageError && <p className="ai-polish-notice" role="status">模型选择暂未保存，当前页面仍可使用。</p>}
      {storageNotice && <p className="ai-polish-notice" role="status">{storageNotice}</p>}
      {!selected.length && <p className="ai-polish-notice">请至少勾选一个方案。</p>}
      {busy && <div className="ai-polish-progress">
        <div className="ai-progress-heading"><span role="status">{received.characters ? completed >= count ? '方案已接收，等待生成确认…' : '正在生成方案…' : '等待模型响应…'}</span><span>已等待 {elapsed} 秒</span></div>
        <progress aria-label="方案接收进度" max={count || 1} value={completed} />
        <div className="ai-progress-detail"><span>已接收 {completed}/{count} 个完整方案</span><strong>{percent}%</strong></div>
        <p>{stalled ? '暂未收到新内容，可继续等待或停止后重试；超时会自动结束。' : session.provider === 'codex' && !received.characters ? '本机 Codex 完成后统一返回方案，等待期间保持 0%。' : '百分比按完整方案计数；全部校验通过后才能应用。'}</p>
      </div>}
      {options.length > 0 && <div className="ai-option-list">{options.map((text, index) => <section className="ai-option-card" key={index} aria-label={runPresets[index].name}>
        <div className="ai-option-heading">
          <h3><span className={`ai-variant-label ai-variant-label-${index % 3}`}>{runPresets[index].name}</span><span className="ai-option-meta">方案 0{index + 1} · 强度 {runPresets[index].strength}%</span></h3>

        </div>
        <div className="ai-option-actions"><button type="button" className="ai-text-button ai-difference-toggle" aria-pressed={showChanges.includes(index)} aria-controls={`ai-option-content-${index}`} onClick={() => setShowChanges(current => current.includes(index) ? current.filter(item => item !== index) : [...current, index])}>{showChanges.includes(index) ? '阅读修改稿' : '查看改动'}</button>
          <button type="button" className="ai-apply-option" aria-label={`应用「${runPresets[index].name}」`} disabled={locked || applied} onClick={() => {
            const message = selection.apply(text)
            if (message) { setError(message); setNotice(''); return }
            setError(''); setAppliedIndex(index)
            setNotice('已替换选中文字。返回编辑器后，点击撤销或按 Ctrl / ⌘ + Z 可恢复原文。')
          }}>{appliedIndex === index ? '已应用' : '应用选段'}</button>
        </div>
        {showChanges.includes(index) ? <section id={`ai-option-content-${index}`} className="ai-option-difference" aria-label={`${runPresets[index].name}改动对比`}>
          <div className="ai-difference-text">{textDifferences(selection.original, text).map((part, i) => part.kind === 'removed' ? <del key={i}>{part.text}</del> : part.kind === 'added' ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>)}</div>
        </section> : <div id={`ai-option-content-${index}`} className="ai-option-text">{text}</div>}
      </section>)}</div>}
      </div>
      </div>
      {hasResults && adjusting && <section ref={adjustRef} className="ai-regenerate-panel" aria-label="调整后生成">
        <h3>调整后生成</h3>
        <div className="ai-regenerate-panel-body">
        {modelPicker}
        {presetSettings}
        {!ready && <p className="ai-polish-notice">当前模型尚未配置，请先设置模型或连接。</p>}
        </div>
        <div className="ai-regenerate-panel-actions">
          <button type="button" className="ai-text-button" onClick={() => { setAdjusting(false); adjustButtonRef.current?.focus() }}>返回结果</button>
          {!ready ? <button type="button" onClick={onConfigure}>设置模型与 Key</button> : <button type="button" className="ai-primary" disabled={locked || busy || applied || !selected.length} onClick={() => void generate()}>生成 {selected.length} 个润色方案</button>}
        </div>
      </section>}
      <footer className="ai-polish-footer">
        {error && <p className="ai-status ai-status-error" role="alert">{error}</p>}
        {notice && <p className="ai-polish-notice" role="status">{notice}</p>}
        {!hasResults && !ready && <p>{session.provider === 'codex' ? '请先连接本机 Codex 并选择模型。' : '请先配置模型和 API Key。'}</p>}
        <div>
          {hasResults && <button ref={adjustButtonRef} type="button" className="ai-regenerate-toggle" aria-label="调整后生成" aria-expanded={adjusting} disabled={applied || busy || locked} onClick={() => setAdjusting(!adjusting)}><ChevronDown size={16} /></button>}
          {!hasResults && !ready ? <button type="button" className="ai-primary" onClick={onConfigure}>{session.provider === 'codex' ? '连接 Codex' : '设置模型与 Key'}</button>
            : <button type="button" className="ai-primary" disabled={applied || !busy && (locked || !hasResults && !selected.length)} onClick={() => busy ? stop() : void generate(hasResults)}>{busy ? <Square size={16} /> : hasResults ? <RotateCw size={16} /> : <Sparkles size={16} />}{busy ? '停止生成' : hasResults ? '重新生成' : `生成 ${selected.length} 个润色方案`}</button>}
          <button type="button" className="ai-text-button" onClick={close}>{hasResults ? '返回编辑器' : '取消'}</button>
        </div>
      </footer>
    </div>
  </WorkbenchDialog>
}
