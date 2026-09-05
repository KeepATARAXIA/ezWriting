import { useEffect, useRef, useState, type ReactNode } from 'react'
import './xhs-overview-page.css'

export function XhsOverviewPage({ index, active, children }: { index: number; active: boolean; children: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = slot.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      // Retain a focused page until focus moves, so keyboard controls do not disappear.
      setVisible(entries[0].isIntersecting || element.contains(document.activeElement))
    }, { root: element.closest('.platform-preview-viewport'), rootMargin: '720px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <div ref={slot} className="xhs-overview-slot" data-overview-page={index}>
    {visible || active ? children : <figure className="xhs-card-item">
      <div className="xhs-card-frame xhs-page-placeholder" aria-hidden="true" />
      <figcaption><span>图片 {String(index + 1).padStart(2, '0')}</span>
        <button type="button" onClick={() => {
          setVisible(true)
          requestAnimationFrame(() => slot.current?.querySelector<HTMLButtonElement>('button')?.focus())
        }}>显示第 {index + 1} 页</button>
      </figcaption>
    </figure>}
  </div>
}
