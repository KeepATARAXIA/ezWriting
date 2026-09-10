import { useEffect, useRef } from 'react'
import { PanelLeftClose, Sparkles } from 'lucide-react'
import type { AiSession } from '../domain/ai'
import { AiWritingWorkspace } from './ai-writing-workspace'
import type { AiDocumentEditor } from '../lib/ai-document'
import './ai-sidebar.css'

interface Props {
  session: AiSession
  onChange: (session: AiSession) => void
  storageError?: boolean
  locked: boolean
  onClose: () => void
  editor?: AiDocumentEditor | null
  draftTitle?: string
}

export function AiSidebar({ session, onChange, storageError, locked, onClose, editor, draftTitle }: Props) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('dialog[open]')) return
      event.preventDefault(); closeRef.current()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [])
  return <aside className="ai-sidebar" id="ai-sidebar" aria-labelledby="ai-sidebar-heading">
    <header><h2 id="ai-sidebar-heading"><Sparkles size={18} />AI 工具</h2><button type="button" className="icon-button" aria-label="关闭 AI 工具" title="收起 AI 工具" onClick={onClose}><PanelLeftClose size={19} /></button></header>
    <AiWritingWorkspace editor={editor} draftTitle={draftTitle} storageError={storageError} session={session} onChange={onChange} locked={locked} />
  </aside>
}
