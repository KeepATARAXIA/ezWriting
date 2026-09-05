import { useLayoutEffect, useRef, type HTMLAttributes } from 'react'

// Only accepts HTML already sanitized by the article/preview pipeline.
// React's innerHTML assignment replaces decoded media even on unrelated renders.
export function PreviewHtml({ html, ...props }: HTMLAttributes<HTMLDivElement> & { html: string }) {
  const root = useRef<HTMLDivElement>(null)
  const snapshots = useRef(new WeakMap<Node, Node>())
  useLayoutEffect(() => {
    if (!root.current) return
    const template = document.createElement('template')
    template.innerHTML = html
    const previous = snapshots.current
    const mediaKey = (node: Node): string => {
      if (!(node instanceof Element)) return ''
      const images = node.matches('img') ? [node] : [...node.querySelectorAll('img')]
      return images.length ? `${node.tagName}:${images.map(image => image.getAttribute('data-ez-gif-source')
        || image.getAttribute('data-ez-video-source') || image.getAttribute('src') || '').join('|')}` : ''
    }
    const remember = (live: Node, desired: Node) => {
      previous.set(live, desired)
      live.childNodes.forEach((child, index) => remember(child, desired.childNodes[index]))
    }
    const sync = (parent: Node, desiredParent: Node) => {
      const available = [...parent.childNodes]
      const keyed = new Map<string, Node[]>()
      for (const node of available) {
        const key = mediaKey(previous.get(node) ?? node)
        if (key) keyed.set(key, [...(keyed.get(key) ?? []), node])
      }
      const used = new Set<Node>()
      const desiredKeys = new Set([...desiredParent.childNodes].map(mediaKey).filter(Boolean))
      let cursor = parent.firstChild
      for (const desired of desiredParent.childNodes) {
        const key = mediaKey(desired)
        const exact = key ? keyed.get(key)?.find(node => !used.has(node)) : undefined
        const live = exact ?? available.find(node => {
          if (used.has(node) || node.nodeName !== desired.nodeName) return false
          const oldKey = mediaKey(previous.get(node) ?? node)
          // A container's descendants may change while its surviving media stay mounted.
          // Reserve exact matches for their own siblings and replace changed image sources.
          return (!key && !oldKey) || (desired.nodeName !== 'IMG' && !desiredKeys.has(oldKey))
        })
        if (!live) {
          const clone = desired.cloneNode(true)
          parent.insertBefore(clone, cursor)
          remember(clone, desired)
          continue
        }
        used.add(live)
        if (live !== cursor) parent.insertBefore(live, cursor)
        cursor = live.nextSibling
        const old = previous.get(live)
        if (live instanceof Element && desired instanceof Element) {
          if (old instanceof Element) for (const attr of old.attributes) {
            if (!desired.hasAttribute(attr.name)) live.removeAttribute(attr.name)
          }
          for (const attr of desired.attributes) {
            // Ignore runtime poster src / selection attributes when source HTML is unchanged.
            if (!(old instanceof Element) || old.getAttribute(attr.name) !== attr.value) {
              live.setAttribute(attr.name, attr.value)
            }
          }
          sync(live, desired)
        } else if (live.nodeValue !== desired.nodeValue) live.nodeValue = desired.nodeValue
        previous.set(live, desired)
      }
      available.forEach(node => { if (!used.has(node)) node.parentNode?.removeChild(node) })
    }
    sync(root.current, template.content)
  }, [html])
  return <div {...props} ref={root} />
}
