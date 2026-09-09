import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function WorkbenchDialog({ title, onClose, children, headerContent, movable = false }: { title: string; onClose: () => void; children: ReactNode; headerContent?: ReactNode; movable?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const gesture = useRef<{ x: number; y: number; left: number; top: number; width: number; height: number; edge: string } | null>(null)
  function place(left: number, top: number, width: number, height: number) {
    const dialog = ref.current!
    width = Math.max(Math.min(760, innerWidth - 16), Math.min(width, innerWidth - 16))
    height = Math.max(Math.min(320, innerHeight - 16), Math.min(height, innerHeight - 16))
    left = Math.max(8, Math.min(left, innerWidth - width - 8))
    top = Math.max(8, Math.min(top, innerHeight - height - 8))
    Object.assign(dialog.style, { margin: '0', left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px', maxHeight: 'none' })
    dialog.dataset.positioned = 'true'
  }
  function start(event: PointerEvent<HTMLElement>, edge = '') {
    if (!movable || event.button !== 0 || (event.target as Element).closest('button, select, input, textarea, label, a')) return
    event.preventDefault()
    const box = ref.current!.getBoundingClientRect()
    gesture.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top, width: box.width, height: box.height, edge }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent<HTMLElement>) {
    const g = gesture.current
    if (!g) return
    const dx = event.clientX - g.x, dy = event.clientY - g.y
    if (!g.edge) { place(g.left + dx, g.top + dy, g.width, g.height); return }
    const minWidth = Math.min(760, innerWidth - 16), minHeight = Math.min(320, innerHeight - 16)
    let left = g.left, top = g.top, right = left + g.width, bottom = top + g.height
    if (g.edge.includes('w')) left = Math.max(8, Math.min(left + dx, right - minWidth))
    if (g.edge.includes('e')) right = Math.min(innerWidth - 8, Math.max(right + dx, left + minWidth))
    if (g.edge.includes('n')) top = Math.max(8, Math.min(top + dy, bottom - minHeight))
    if (g.edge.includes('s')) bottom = Math.min(innerHeight - 8, Math.max(bottom + dy, top + minHeight))
    place(left, top, right - left, bottom - top)
  }
  function end(event: PointerEvent<HTMLElement>) {
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  useEffect(() => {
    if (!movable) return
    const resize = () => {
      if (!ref.current?.dataset.positioned) return
      gesture.current = null
      const box = ref.current.getBoundingClientRect()
      place(box.left, box.top, box.width, box.height)
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [movable])
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => { if (dialog.close) dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className={`workbench-dialog${movable ? ' workbench-dialog-movable' : ''}`} aria-label={title}
    onCancel={event => { event.preventDefault(); if (!movable) onClose() }}
    onClick={event => { if (!movable && event.target === event.currentTarget) onClose() }}>
    <div className="workbench-dialog-content">
      <header onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { gesture.current = null }}>{headerContent ?? <h2>{title}</h2>}<button type="button" className="icon-button" aria-label={`关闭${title}`} title="关闭" onClick={onClose}><X size={19} /></button></header>
      {children}
    </div>
    {movable && ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'].map(edge => <div key={edge} className={`dialog-resize-handle dialog-resize-${edge}`} aria-hidden="true" onPointerDown={event => start(event, edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { gesture.current = null }} />)}
  </dialog>
}
