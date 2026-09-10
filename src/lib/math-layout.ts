export function fitMathToWidth(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.ez-math').forEach(formula => {
    const content = formula.querySelector<HTMLElement>(':scope > .katex-display, :scope > .katex')
    if (!content || !formula.clientWidth || !content.offsetWidth) return
    const scale = String(Math.min(1, formula.clientWidth / content.offsetWidth))
    if (content.style.zoom !== scale) content.style.zoom = scale
  })
}

export function observeMathLayout(root: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const observed = new Set<HTMLElement>()
  let frame = 0
  const refresh = () => {
    frame = 0
    for (const node of observed) {
      if (!root.contains(node)) { resize.unobserve(node); observed.delete(node) }
    }
    root.querySelectorAll<HTMLElement>('.ez-math').forEach(node => {
      if (!observed.has(node)) { resize.observe(node); observed.add(node) }
    })
    fitMathToWidth(root)
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh) }
  const resize = new ResizeObserver(schedule)
  const mutation = new MutationObserver(schedule)
  mutation.observe(root, { childList: true, subtree: true })
  schedule()
  document.fonts?.addEventListener('loadingdone', schedule)
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    mutation.disconnect()
    document.fonts?.removeEventListener('loadingdone', schedule)
  }
}
