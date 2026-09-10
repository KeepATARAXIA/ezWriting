import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, Check, FileText, Info, LoaderCircle, MessageSquare, Plus, Settings2, SlidersHorizontal, Sparkles, Square } from 'lucide-react'
import { AI_PROVIDERS, AiError, type AiSession } from '../domain/ai'
import { AI_CHAT_HISTORY_LIMIT, readChatInput, type AiChatInput, type AiChatResult } from '../domain/ai-chat'
import { parseChatResult, streamedChatReply, type AiDocumentEditor, type AiDocumentSnapshot } from '../lib/ai-document'
import { generateAiText } from '../lib/ai-client'
import { readPolishSettings, savePolishSettings } from '../lib/ai-polish-settings'
import type { PolishPreset } from '../lib/ai-polish'
import { WRITING_TONES, type WritingTone } from '../lib/ai-writing'
import { AiConnections, providerLogos } from './ai-connections'
import { AiPolishPresets } from './ai-polish-presets'
import { AiDocumentPreview } from './ai-document-preview'
import './ai-writing-workspace.css'

interface Turn {
  id: string
  instruction: string
  model: string
  scope: boolean
  status: 'running' | 'done' | 'error' | 'cancelled'
  reply: string
  received: number
  error?: string
  result?: AiChatResult
  snapshot: AiDocumentSnapshot | null
  applied?: boolean
}
interface Props {
  session: AiSession
  onChange: (session: AiSession) => void
  storageError?: boolean
  locked: boolean
  editor?: AiDocumentEditor | null
  draftTitle?: string
}
type Module = 'chat' | 'presets' | 'settings'
const moduleLabels = { chat: '对话', presets: '润色方案', settings: '模型配置' }

export function AiWritingWorkspace({ session, onChange, storageError, locked, editor, draftTitle }: Props) {
  const [module, setModule] = useState<Module>('chat')
  const [presets, setPresets] = useState(readPolishSettings)
  const [presetIndex, setPresetIndex] = useState(-1)
  const [presetNotice, setPresetNotice] = useState('')
  const [tones, setTones] = useState<WritingTone[]>([])
  const [ready, setReady] = useState(false)
  const [testing, setTesting] = useState(false)
  const [attachDocument, setAttachDocument] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [notice, setNotice] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const active = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const following = useRef(true)
  const busy = turns.some(turn => turn.status === 'running')
  const profile = session.profiles[session.provider]
  const isCodex = session.provider === 'codex'
  const preview = turns.find(turn => turn.id === previewId)
  const blocked = locked || busy || testing
  const useDocument = Boolean(editor && attachDocument)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll && following.current) scroll.scrollTop = scroll.scrollHeight
  }, [turns, module])

  function updatePresets(next: PolishPreset[]) {
    const existing = next.indexOf(presets[presetIndex])
    setPresetIndex(presetIndex < 0 ? -1 : existing >= 0 ? existing : Math.min(presetIndex, next.length - 1))
    setPresets(next)
    setPresetNotice(savePolishSettings(next) ? '' : '方案暂未保存，请补全名称和提示词，或检查浏览器存储权限。')
  }
  const patchTurn = (id: string, patch: Partial<Turn>) => setTurns(current => current.map(turn => turn.id === id ? { ...turn, ...patch } : turn))

  async function send() {
    if (active.current || blocked || !ready || !prompt.trim()) return
    let snapshot: AiDocumentSnapshot | null, payload: AiChatInput
    try {
      snapshot = useDocument ? editor!.capture() : null
      const latest = [...turns].reverse().find(turn => turn.result?.revision)
      const previousRevision = snapshot && latest?.result?.revision && !latest.applied
        && latest.snapshot?.body === snapshot.body && latest.snapshot.title === snapshot.title
        ? { ...latest.result.revision, language: snapshot.language } : null
      // Without the attachment, exclude historical turns that carried a draft too.
      payload = readChatInput(JSON.stringify({ instruction: prompt.trim(),
        document: snapshot ? { title: snapshot.title, body: snapshot.body, language: snapshot.language } : null,
        previousRevision,
        history: turns.filter(turn => turn.status === 'done' && (useDocument || !turn.scope)).slice(-AI_CHAT_HISTORY_LIMIT).map(turn => ({ instruction: turn.instruction, reply: turn.reply })),
        ...(presets[presetIndex] ? { plan: presets[presetIndex] } : {}), refinements: tones.map(tone => WRITING_TONES[tone]),
      }))
    } catch (error) { setNotice((error as Error).message); return }
    const id = crypto.randomUUID(), controller = new AbortController()
    active.current = controller; following.current = true
    setNotice(''); setPrompt('')
    setTurns(current => [...current, { id, instruction: payload.instruction, model: `${AI_PROVIDERS[session.provider].name} · ${profile.model}`, scope: useDocument, status: 'running', reply: '', received: 0, snapshot }])
    let output = ''
    try {
      await generateAiText({ provider: session.provider, profile, action: 'chat', prompt: JSON.stringify(payload), signal: controller.signal,
        onText: text => {
          if (active.current !== controller || controller.signal.aborted) return
          output += text
          patchTurn(id, { reply: streamedChatReply(output), received: output.length })
        },
      })
      if (active.current !== controller || controller.signal.aborted) return
      const result = parseChatResult(output, payload.document)
      patchTurn(id, { status: 'done', reply: result.reply, result })
    } catch (error) {
      if (active.current !== controller) return
      const cancelled = controller.signal.aborted
      patchTurn(id, { status: cancelled ? 'cancelled' : 'error', error: cancelled ? '已停止请求，保留已收到的回复；未完成的修改稿不能应用。' : error instanceof AiError || error instanceof Error ? error.message : '请求失败，请重试。' })
    } finally {
      if (active.current === controller) active.current = null
    }
  }
  function applyPreview() {
    if (!preview?.snapshot || !preview.result?.revision || blocked) return '当前无法应用，请完成正在进行的操作。'
    const error = preview.snapshot.apply(preview.result.revision)
    if (!error) patchTurn(preview.id, { applied: true })
    return error
  }
  function starter(instruction: string) { setPrompt(instruction); setAttachDocument(true); inputRef.current?.focus() }

  return <div className="ai-writing-workspace ai-connections">
    <nav className="ai-module-navigation" aria-label="AI 工作区模块">
      {(['chat', 'presets', 'settings'] as Module[]).map(name => <button type="button" key={name} aria-pressed={module === name} aria-controls={`ai-module-${name}`} onClick={() => setModule(name)}>
        {name === 'chat' ? <MessageSquare size={15} /> : name === 'presets' ? <SlidersHorizontal size={15} /> : <Settings2 size={15} />}{moduleLabels[name]}
      </button>)}
    </nav>
    <section id="ai-module-settings" className="ai-sidebar-content" hidden={module !== 'settings'}>
      <AiConnections session={session} onChange={onChange} storageError={storageError} locked={locked || busy} onReady={setReady} onTesting={setTesting} visible={module === 'settings'} />
    </section>
    <section id="ai-module-presets" className="ai-sidebar-content" hidden={module !== 'presets'} aria-label="润色方案模块">
      <h3>写作偏好</h3><p className="ai-privacy">选择本轮风格，或维护选段润色使用的方案。</p>
      <label htmlFor="ai-writing-preset">润色方案</label>
      <select id="ai-writing-preset" value={presetIndex} disabled={blocked} onChange={event => setPresetIndex(Number(event.target.value))}>
        <option value={-1}>仅按对话要求</option>{presets.map((preset, index) => <option key={index} value={index}>{preset.name || '未命名方案'}</option>)}
      </select>
      <div className="ai-tone-chips" role="group" aria-label="快捷风格">{(Object.keys(WRITING_TONES) as WritingTone[]).map(tone => <button type="button" key={tone} aria-pressed={tones.includes(tone)} disabled={blocked} onClick={() => setTones(current => current.includes(tone) ? current.filter(item => item !== tone) : [...current, tone])}>{tone}</button>)}</div>
      <details className="ai-preset-advanced"><summary>强度与选段方案</summary><fieldset disabled={blocked}>
        {presets.map((preset, index) => <div className="ai-preset-row" key={index}>
          <label className="ai-preset-choice"><input type="checkbox" checked={preset.enabled} onChange={event => updatePresets(presets.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item))} />{preset.name}</label>
          <label className="ai-preset-strength"><input aria-label={`${preset.name}润色强度`} type="range" min="0" max="100" step="10" value={preset.strength} onChange={event => updatePresets(presets.map((item, i) => i === index ? { ...item, strength: Number(event.target.value) } : item))} /><output>{preset.strength}%</output></label>
        </div>)}
      </fieldset></details>
      <AiPolishPresets locked={blocked} presets={presets} onChange={updatePresets} />
      {presetNotice && <p className="ai-preset-hint" role="status">{presetNotice}</p>}
    </section>
    <section id="ai-module-chat" className="ai-chat-module" hidden={module !== 'chat'} aria-label="文章对话">
      <div className="ai-chat-heading"><button type="button" className="ai-current-model" title="打开模型配置" onClick={() => setModule('settings')}><img src={providerLogos[session.provider]} alt="" /><span>{profile.model || AI_PROVIDERS[session.provider].name}</span><span className={`ai-ready-dot${ready ? ' ready' : ''}`} aria-label={ready ? '已就绪' : '未连接'} /></button>
        <button type="button" className="ai-new-chat" aria-label="新建对话" title="清空本轮记录，开始新对话" disabled={blocked || !turns.length} onClick={() => { setTurns([]); setNotice(''); setPreviewId(null); inputRef.current?.focus() }}><Plus size={17} /></button>
      </div>
      <div className="ai-chat-messages" ref={scrollRef} onScroll={event => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60 }}>
        {!turns.length && <div className="ai-chat-empty"><span className="ai-chat-symbol"><Sparkles size={23} /></span><h3>一起把文章写好</h3><p>{editor ? '围绕当前稿件讨论，或直接提出全文修改要求。' : '先开始对话；打开稿件后，可以一起修改全文。'}</p>
          <div className="ai-starters"><button type="button" disabled={!editor || blocked} onClick={() => starter('请润色全文，保留事实和文章结构，让表达更自然、简洁。')}><FileText size={16} /><span>润色全文<small>保留结构，优化表达</small></span><ArrowUpRight size={15} /></button>
            <button type="button" disabled={!editor || blocked} onClick={() => starter('请阅读全文，指出表达不清和逻辑衔接的问题，先给建议，不修改原稿。')}><MessageSquare size={16} /><span>先聊修改建议<small>看看哪些地方值得调整</small></span><ArrowUpRight size={15} /></button></div>
        </div>}
        {turns.map((turn, index) => <section className="ai-chat-turn" aria-label={`第 ${index + 1} 轮对话`} key={turn.id}>
          <div className="ai-user-message"><small>{turn.scope ? '已附带全文' : '未附带全文'}</small><p>{turn.instruction}</p></div>
          <div className="ai-assistant-message"><header><Sparkles size={14} /><span>{turn.model}</span></header>
            {turn.reply && <p className="ai-chat-reply">{turn.reply}</p>}
            {turn.status === 'running' && <p className="ai-chat-progress" role="status"><LoaderCircle size={14} className="spin" />{turn.received ? `正在整理回复与修改稿 · 已收到 ${turn.received.toLocaleString()} 字符` : '正在等待模型回复…'}</p>}
            {turn.error && <p className="ai-status ai-status-error" role={turn.status === 'error' ? 'alert' : 'status'}>{turn.error}</p>}
            {turn.result?.revision && <button type="button" className="ai-revision-card" onClick={() => setPreviewId(turn.id)}><FileText size={21} /><span><strong>{turn.applied ? '已应用全文修改' : '全文修改稿'}</strong><small>{turn.result.revision.title || '未命名稿件'} · {turn.result.revision.body.length.toLocaleString()} 字符</small></span>{turn.applied ? <Check size={16} /> : <ArrowUpRight size={17} />}</button>}
            {(turn.status === 'error' || turn.status === 'cancelled') && <button type="button" className="ai-text-button" disabled={blocked} onClick={() => { setPrompt(turn.instruction); setAttachDocument(turn.scope); inputRef.current?.focus() }}>重新编辑要求</button>}
          </div>
        </section>)}
      </div>
      <footer className="ai-chat-composer">
        {notice && <p className="ai-status ai-status-error" role="alert">{notice}</p>}
        {!ready && <div className="ai-setup-hint"><span>{isCodex ? '先连接本机 Codex' : '先配置模型与 Key'}</span><button type="button" className="ai-text-button" onClick={() => setModule('settings')}>打开模型设置</button></div>}
        <div className="ai-chat-context"><button type="button" aria-pressed={useDocument} disabled={!editor || blocked} onClick={() => setAttachDocument(!attachDocument)} title={draftTitle || '当前稿件'}><FileText size={13} />{useDocument ? '全文' : '不附带全文'}{useDocument && <Check size={12} />}</button><button type="button" className="ai-text-button" onClick={() => setModule('presets')}>{presets[presetIndex]?.name || '按对话要求'}{tones.length ? ` +${tones.length}` : ''}</button>
          <div className="ai-info"><button type="button" aria-label="隐私与用量说明" aria-expanded={infoOpen} onClick={() => setInfoOpen(!infoOpen)} onKeyDown={event => { if (event.key === 'Escape' && infoOpen) { event.preventDefault(); event.stopPropagation(); setInfoOpen(false) } }}><Info size={14} /></button>
            <div role="tooltip" hidden={!infoOpen}>点击发送才会发送要求、所选风格、最近 {AI_CHAT_HISTORY_LIMIT} 轮成功对话，以及明确附带的全文和上一份修改稿。取消全文后不发送含稿件的历史。{isCodex ? '经本机 Codex 使用 ChatGPT 订阅，不经本站服务器。' : 'Key 保存在当前浏览器，请求经本站服务器转发；本站不保存或记录 Key 与正文。'}生成与测试会消耗额度。关闭 AI 工具或切换稿件会停止请求并清空对话。</div>
          </div>
        </div>
        <label className="sr-only" htmlFor="ai-chat-prompt">对话要求</label>
        <textarea ref={inputRef} id="ai-chat-prompt" value={prompt} maxLength={4000} disabled={blocked} rows={3} placeholder={useDocument ? '例如：帮我润色全文，让表达自然一些…' : '写下问题或创作要求…'} onChange={event => { setPrompt(event.target.value); setNotice('') }} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
        <div className="ai-chat-send-row"><span>{useDocument ? '发送时附带当前全文' : '仅发送对话内容'}<small>Ctrl / ⌘ + Enter</small></span>{busy ? <button type="button" className="ai-primary" onClick={() => active.current?.abort()}><Square size={15} />停止</button> : <button type="button" className="ai-primary" disabled={!ready || blocked || !prompt.trim()} onClick={() => void send()}><ArrowUp size={17} />发送</button>}</div>
      </footer>
    </section>
    {preview?.result?.revision && preview.snapshot && <AiDocumentPreview snapshot={preview.snapshot} revision={preview.result.revision} applied={Boolean(preview.applied)} locked={blocked} onApply={applyPreview} onClose={() => setPreviewId(null)} />}
  </div>
}
