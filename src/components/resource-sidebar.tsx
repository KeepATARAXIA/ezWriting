import { useRef, type ReactNode } from 'react'

export function ResourceSidebar({ width, onWidthChange, onClose, children }: { width: number; onWidthChange: (width: number) => void; onClose: () => void; children: ReactNode }) {
  const drag = useRef<{ start: number; width: number } | null>(null)
  const resize = (value: number) => {
    const next = Math.max(260, Math.min(440, Math.round(value)))
    onWidthChange(next)
    try { window.localStorage.setItem('dispatch.resource-width.v1', String(next)) } catch { /* Width still works for this session. */ }
  }
  return <aside className="resource-sidebar" aria-label="素材侧栏">
    <button className="resource-sidebar-close" type="button" onClick={onClose}>关闭素材</button>
    {children}
    <div className="resource-sidebar-resizer" role="separator" aria-label="调整素材侧栏宽度" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={440} aria-valuenow={width} tabIndex={0}
      onPointerDown={event => { event.preventDefault(); drag.current = { start: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.start) }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={() => { drag.current = null }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        resize(event.key === 'Home' ? 260 : event.key === 'End' ? 440 : width + (event.key === 'ArrowRight' ? 20 : -20))
      }} />
  </aside>
}
