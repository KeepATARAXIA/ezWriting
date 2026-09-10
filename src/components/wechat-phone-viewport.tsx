import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function WechatPhoneViewport({ active, children }: { active: boolean; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!active || !viewport) return
    const measure = () => {
      // Leave room for the close caption and the device's surrounding space.
      const scale = Math.max(0, Math.min(1, (viewport.clientWidth - 24) / 404, (viewport.clientHeight - 80) / 858))
      viewport.style.setProperty('--wechat-phone-scale', String(scale))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [active])

  return active ? <div ref={viewportRef} className="wechat-phone-viewport">{children}</div> : children
}
