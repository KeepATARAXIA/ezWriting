import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function WorkbenchDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => { if (dialog.close) dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="workbench-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="workbench-dialog-content">
      <header><h2>{title}</h2><button type="button" className="icon-button" aria-label={`关闭${title}`} title="关闭" onClick={onClose}><X size={19} /></button></header>
      {children}
    </div>
  </dialog>
}
