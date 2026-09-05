import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, X } from 'lucide-react'

const STEPS = [
  { title: '准备一篇稿件', text: '点击新建，选择空白文档或导入文件。支持 Markdown、HTML 和 ZIP 内容包，也可以导入文章文件夹。', target: '.new-document-button', action: '新建文档' },
  { title: '编辑标题与正文', text: '在编辑器第一行写文章标题，回车后继续正文。选中文字或使用工具栏排版；编辑会自动保存到当前浏览器。', target: '.content-editor-section', action: '进入正文' },
  { title: '检查文档素材', text: '在「文档素材」查看当前稿件的图片、GIF 和视频。缺失图片可按文件名补齐，点击素材可返回正文定位。', target: '.document-assets-tab', action: '查看素材' },
  { title: '选择平台与排版', text: '点击公众号、小红书或 X 图标查看对应效果。右上角排版图标可调整主题、字体、间距和颜色。', target: '.workbar-navigation', action: '选择平台' },
  { title: '预览与检查', text: '使用电脑、手机图标检查阅读效果。左下角通知集中显示缺图和媒体适配提醒；也可复制格式或下载小红书图片。', target: '.workbar-preview-tools', action: '查看预览' },
  { title: '同步到平台草稿箱', text: '点击发布，连接 Wechatsync 扩展并选择已登录的平台，再同步草稿。扩展未连接时，可按面板指引安装；也可返回工具栏复制或导出后手动使用。', target: '.publish-trigger', action: '打开发布面板' },
  { title: '前往平台复核', text: '同步结果会显示在发布面板。打开目标平台草稿，检查图片和排版，手动上传需要补充的视频，确认后在平台完成发布。', target: '.publish-trigger', action: '查看同步结果' },
]

export function WorkbenchHelp({ onClose, onNavigate }: { onClose: () => void; onNavigate: (step: number) => void }) {
  const [step, setStep] = useState(0)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => { close.current?.focus() }, [])
  useEffect(() => {
    const target = document.querySelector(STEPS[step].target)
    target?.classList.add('help-highlight')
    return () => target?.classList.remove('help-highlight')
  }, [step])
  return <aside className="workbench-help" role="dialog" aria-label="使用引导" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
  }}>
    <header><span>使用引导 · {step + 1} / {STEPS.length}</span><button ref={close} type="button" className="icon-button" onClick={onClose} aria-label="跳过引导" title="跳过引导"><X size={17} /></button></header>
    <div className="help-progress" aria-hidden="true">{STEPS.map((_, index) => <i key={index} className={index <= step ? 'complete' : ''} />)}</div>
    <div aria-live="polite"><h3>{STEPS[step].title}</h3><p>{STEPS[step].text}</p></div>
    <button type="button" className="help-action" onClick={() => onNavigate(step)}>{STEPS[step].action}<ArrowRight size={15} /></button>
    <footer><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft size={15} />上一步</button>
      <button type="button" className="primary-button" onClick={() => step === STEPS.length - 1 ? onClose() : setStep(step + 1)}>{step === STEPS.length - 1 ? <><Check size={15} />完成</> : <>下一步<ArrowRight size={15} /></>}</button></footer>
  </aside>
}
