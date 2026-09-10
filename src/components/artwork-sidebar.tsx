import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { ArtworkEditor, CoverImage, IllustrationTarget } from '../domain/artwork'
import { IMAGE_SIZES, validImageSize } from '../domain/artwork'
import { cropArtwork, generateArtwork, readImageStyles, saveImageStyles } from '../lib/artwork'
import { CodexConnection } from './codex-connection'
import './ai-sidebar.css'
import './artwork-sidebar.css'

interface Props {
  mode: 'illustration' | 'cover'
  editor?: ArtworkEditor | null
  title: string
  cover?: CoverImage
  model: string
  locked: boolean
  onModel: (model: string) => void
  onSaveCover: (cover: CoverImage) => string | undefined
  onClose: () => void
}

export function ArtworkSidebar(props: Props) {
  const coverMode = props.mode === 'cover'
  const name = coverMode ? '封面' : '配图'
  const [title, setTitle] = useState(coverMode ? props.cover?.title ?? props.title : props.title)
  const [target, setTarget] = useState<IllustrationTarget | null>(null)
  const [subject, setSubject] = useState('')
  const [brief, setBrief] = useState('')
  const [styles, setStyles] = useState(readImageStyles)
  const [styleId, setStyleId] = useState(styles[0].id)
  const [styleName, setStyleName] = useState(styles[0].name)
  const [stylePrompt, setStylePrompt] = useState(styles[0].prompt)
  const [width, setWidth] = useState(coverMode ? props.cover?.width ?? 1880 : 1536)
  const [height, setHeight] = useState(coverMode ? props.cover?.height ?? 800 : 864)
  const [source, setSource] = useState(coverMode ? props.cover?.source ?? '' : '')
  const [preview, setPreview] = useState('')
  const [x, setX] = useState(50)
  const [y, setY] = useState(50)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [cropping, setCropping] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [applied, setApplied] = useState(false)
  const active = useRef<AbortController | null>(null)
  const validSize = validImageSize(width, height)

  function capture(quiet = false) {
    try {
      if (!props.editor) throw new Error('请先打开一篇稿件。')
      const selection = props.editor.capture()
      setTarget(selection); setSubject(selection.text); setError(''); setApplied(false)
    } catch (cause) { if (!quiet) setError((cause as Error).message) }
  }
  useEffect(() => { capture(true); return () => { active.current?.abort() } }, [])
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  useEffect(() => {
    let cancelled = false
    setPreview(''); setApplied(false)
    if (!source || !validSize) { setCropping(false); return }
    setCropping(true)
    void cropArtwork(source, width, height, x, y).then(result => { if (!cancelled) setPreview(result) })
      .catch(cause => { if (!cancelled) setError((cause as Error).message) })
      .finally(() => { if (!cancelled) setCropping(false) })
    return () => { cancelled = true }
  }, [source, width, height, x, y, validSize])

  async function generate() {
    if (active.current || props.locked || !connected || !validSize) return
    const controller = new AbortController(); active.current = controller
    setElapsed(0); setBusy(true); setError(''); setNotice('')
    const prompt = [`请使用内置 gpt-image-2 生成一张${name}。`, `目标画布 ${width}×${height}，保持主体完整并为裁切留白。`,
      coverMode ? `封面标题（画面文字）：${title}` : '正文插图，默认不要添加文字。',
      `用户选定的主题或摘要：${subject}`, `画面要求：${brief}`, `视觉风格：${stylePrompt}`].join('\n')
    try {
      const result = await generateArtwork(prompt, props.model, controller.signal)
      if (controller.signal.aborted) return
      setSource(result); setX(50); setY(50); setApplied(false)
      setNotice('已生成，可调整裁切后确认使用。')
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message)
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }
  function saveStyle(copy: boolean) {
    try {
      if (copy && styles.length >= 20) throw new Error('最多保存 20 个风格，请修改已有风格。')
      const item = { id: copy ? crypto.randomUUID() : styleId, name: styleName.trim(), prompt: stylePrompt.trim() }
      const next = copy ? [...styles, item] : styles.map(style => style.id === styleId ? item : style)
      saveImageStyles(next); setStyles(next); setStyleId(item.id); setNotice('风格已保存在当前浏览器。'); setError('')
    } catch (cause) { setError((cause as Error).message) }
  }
  function apply() {
    if (!preview || props.locked || busy || cropping || applied) return
    const problem = coverMode ? props.onSaveCover({ source: preview, title, width, height })
      : target ? target.insert(preview, brief.trim().slice(0, 200) || '文章配图') : '请先选择正文并点击“使用当前选段”。'
    if (problem) { setError(problem); return }
    setError(''); setApplied(true); setNotice(coverMode ? '封面已保存到当前稿件，可下载后用于平台封面。' : '配图已插入选段之后，可在编辑器撤销。')
  }
  return <aside className="ai-sidebar artwork-sidebar" id="artwork-sidebar" aria-label={name} onKeyDown={event => { if (event.key === 'Escape') props.onClose() }}>
    <header><h2><ImagePlus size={18} />{name}</h2><button type="button" className="icon-button" aria-label={`关闭${name}`} onClick={props.onClose}><X size={18} /></button></header>
    <div className="ai-sidebar-content artwork-content">
      <p className="artwork-caption">Codex · Image 2 · 使用 ChatGPT 订阅额度</p>
      <details className="artwork-connection" open={!connected}><summary>本机连接与额度</summary><CodexConnection model={props.model} disabled={busy || props.locked} onModel={props.onModel} onConnected={setConnected} /></details>
      <fieldset disabled={busy || props.locked}>
        {coverMode && <label>封面标题<input value={title} maxLength={300} onChange={event => { setTitle(event.target.value); setApplied(false) }} /></label>}
        <label>{coverMode ? '主题或摘要' : '配图选段'}<textarea rows={4} maxLength={3000} value={subject} onChange={event => setSubject(event.target.value)} placeholder={coverMode ? '手动填写，或从正文选择一段摘要' : '先在编辑器选择一段正文'} /></label>
        <button type="button" disabled={!props.editor} onClick={() => capture()}>使用当前选段</button>
        <label>画面描述<textarea rows={3} maxLength={1500} value={brief} onChange={event => setBrief(event.target.value)} placeholder="主体、构图、需要突出或避免的元素" /></label>
        <label>尺寸<select aria-label="尺寸" value={IMAGE_SIZES.findIndex(item => item.width === width && item.height === height)} onChange={event => { const size = IMAGE_SIZES[Number(event.target.value)]; if (size) { setWidth(size.width); setHeight(size.height) } else { setWidth(1024); setHeight(768) } }}>
          {IMAGE_SIZES.map((item, i) => <option key={item.name} value={i}>{item.name} · {item.width} × {item.height}</option>)}<option value={-1}>自定义尺寸</option>
        </select></label>
        <div className="artwork-dimensions"><label>宽度<input type="number" min={256} max={4096} value={width} onChange={event => setWidth(Number(event.target.value))} /></label><span>×</span><label>高度<input type="number" min={256} max={4096} value={height} onChange={event => setHeight(Number(event.target.value))} /></label></div>
        {!validSize && <p role="alert">尺寸需为 256–4096 像素，总像素不超过 8 百万。</p>}
        <label>视觉风格<select aria-label="视觉风格" value={styleId} onChange={event => { const style = styles.find(item => item.id === event.target.value)!; setStyleId(style.id); setStyleName(style.name); setStylePrompt(style.prompt) }}>{styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></label>
        <details><summary>编辑风格 / 另存模板</summary><label>风格名称<input value={styleName} maxLength={40} onChange={event => setStyleName(event.target.value)} /></label><label>风格描述<textarea aria-label="风格描述" rows={4} value={stylePrompt} maxLength={2000} onChange={event => setStylePrompt(event.target.value)} /></label><div className="artwork-actions"><button type="button" onClick={() => saveStyle(false)}>保存修改</button><button type="button" onClick={() => saveStyle(true)}>另存为新风格</button></div></details>
      </fieldset>
      <p className="artwork-caption">仅发送上方填写的文字。每次生成消耗 Codex 额度，图片通常比文字消耗更多；尺寸通过本地裁切精确输出。修改文字后需重新生成。</p>
      {source && <section aria-label="图片预览" className="artwork-preview">
        {preview ? <img src={preview} alt={`${name}裁切预览`} /> : <p role="status">{cropping ? '正在调整裁切…' : '请填写有效尺寸。'}</p>}
        <label>水平构图<input type="range" min={0} max={100} value={x} onChange={event => setX(Number(event.target.value))} /></label>
        <label>垂直构图<input type="range" min={0} max={100} value={y} onChange={event => setY(Number(event.target.value))} /></label>
        {coverMode && preview && <details><summary>查看方形裁切</summary><img className="artwork-square" src={preview} alt="封面方形裁切参考" /></details>}
        <div className="artwork-actions"><button type="button" disabled={!preview || cropping || busy || props.locked || applied || (!coverMode && !target)} onClick={apply}>{applied ? '已使用' : coverMode ? '保存为稿件封面' : '插入选段之后'}</button>{preview && <a href={preview} download={`${name}-${width}x${height}.png`}>下载 PNG</a>}</div>
      </section>}
      {error && <p role="alert" className="ai-status-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    </div>
    <footer>{busy ? <div className="artwork-progress">
      <div className="artwork-progress-heading"><span role="status">正在等待 Image 2 返回图片…</span><span className="artwork-elapsed">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span></div>
      <div className="artwork-progress-track" role="progressbar" aria-label={`${name}生成进度`} aria-valuetext="等待图片结果，完成比例未知"><span /></div>
      <p>{elapsed >= 300 ? '等待较久，仍在请求中；超过 10 分钟会自动停止。' : '生成可能需要数分钟，暂不提供完成百分比。'}</p>
      <button type="button" onClick={() => { active.current?.abort(); setNotice('已停止生成。') }}>停止生成</button>
    </div> : <button type="button" className="artwork-generate" disabled={props.locked || !connected || !validSize || (!subject.trim() && !brief.trim() && !(coverMode && title.trim()))} onClick={() => void generate()}>{source ? '重新生成' : `生成${name}`}</button>}</footer>
  </aside>
}
