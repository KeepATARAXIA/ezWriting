import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { AiChatResult } from '../domain/ai-chat'
import type { AiDocumentSnapshot } from '../lib/ai-document'
import { textDifferences } from '../lib/ai-polish'
import { WorkbenchDialog } from './workbench-dialog'

export function AiDocumentPreview({ snapshot, revision, applied, locked, onApply, onClose }: {
  snapshot: AiDocumentSnapshot
  revision: NonNullable<AiChatResult['revision']>
  applied: boolean
  locked: boolean
  onApply: () => string | undefined
  onClose: () => void
}) {
  const [difference, setDifference] = useState(false)
  const [error, setError] = useState('')
  const html = useMemo(() => snapshot.preview(revision.body), [snapshot, revision.body])
  const changes = useMemo(() => difference ? textDifferences(snapshot.title + '\n\n' + snapshot.body, revision.title + '\n\n' + revision.body) : [], [difference, snapshot, revision])
  return <WorkbenchDialog title="全文修改预览" onClose={onClose}>
    <div className="ai-document-preview">
      <div className="ai-document-preview-toolbar"><span>确认后替换全文 · 可在编辑器撤销</span>
        <button type="button" aria-pressed={difference} onClick={() => setDifference(!difference)}>{difference ? '阅读修改稿' : '查看改动'}</button>
      </div>
      <div className="ai-document-preview-scroll">
        {difference ? <section className="ai-document-difference" aria-label="全文改动对比">{changes.map((part, index) => part.kind === 'added' ? <ins key={index}>{part.text}</ins> : part.kind === 'removed' ? <del key={index}>{part.text}</del> : <span key={index}>{part.text}</span>)}</section>
          : <article className="ai-document-reading"><h1>{revision.title || '未命名稿件'}</h1><div dangerouslySetInnerHTML={{ __html: html }} /></article>}
      </div>
      <footer>{error && <p role="alert">{error}</p>}{applied && <p role="status">已应用全文；关闭后可继续对话，或在编辑器撤销。</p>}
        <button type="button" onClick={onClose}>返回对话</button>
        <button type="button" className="ai-primary" disabled={applied || locked} onClick={() => setError(onApply() ?? '')}>{applied && <Check size={16} />}{applied ? '已应用' : '应用全文修改'}</button>
      </footer>
    </div>
  </WorkbenchDialog>
}
