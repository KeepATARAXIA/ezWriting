import { layer, RectangleMarker } from '@codemirror/view'

// Read only rendered text. A separate CodeMirror layer leaves content, media,
// selection and undo history untouched, including during IME composition.
export function editorRowStripes() {
  let previous = new Map<number, number>()
  return layer({
    above: false,
    class: 'source-row-stripes',
    update(update) {
      if (update.docChanged) previous.clear()
      return update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet
    },
    markers(view) {
      const scroller = view.scrollDOM.getBoundingClientRect()
      const originLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX
      const originTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY
      const lines = []
      for (const element of view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')) {
        const box = element.getBoundingClientRect()
        if (!box.height || !box.width) continue
        const bands: Array<{ top: number; bottom: number }> = []
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
          acceptNode: node => node.parentElement?.closest('.source-image-widget, [aria-hidden="true"]')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        })
        const range = document.createRange()
        while (walker.nextNode()) {
          range.selectNodeContents(walker.currentNode)
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && rect.height > 0) bands.push({ top: rect.top, bottom: rect.bottom })
          }
        }
        bands.sort((a, b) => a.top - b.top)
        const rows: typeof bands = []
        for (const band of bands) {
          const last = rows.at(-1)
          // Bold, links and other inline spans can share the same visual row.
          if (last && band.top < last.bottom - 1) last.bottom = Math.max(last.bottom, band.bottom)
          else rows.push({ ...band })
        }
        const hasWidget = Boolean(element.querySelector('.source-image-widget, .cm-md-horizontal-rule'))
        // Empty separators do not consume a color. Wrapped text belongs to one
        // source line, so paint its full height as a single block.
        if (!element.textContent?.trim() || !rows.length) continue
        if (!hasWidget) rows.splice(0, rows.length, { top: box.top, bottom: box.bottom })
        const leading = Math.max(0, (Number.parseFloat(getComputedStyle(element).lineHeight) * view.scaleY - (rows[0]?.bottom - rows[0]?.top || 0)) / 2)
        const from = view.posAtDOM(element)
        lines.push({ from, box, rows: rows.map((row, index) => ({
          top: index ? (rows[index - 1].bottom + row.top) / 2 : hasWidget ? Math.max(box.top, row.top - leading) : box.top,
          bottom: index < rows.length - 1 ? (row.bottom + rows[index + 1].top) / 2 : hasWidget ? Math.min(box.bottom, row.bottom + leading) : box.bottom,
        })) })
      }

      // Preserve the phase on overlapping virtual viewports when scrolling.
      // A jump to an unseen region can start either color; source lines still alternate.
      let phase = 0
      let precedingLines = 0
      for (const line of lines) {
        const known = previous.get(line.from)
        if (known !== undefined) { phase = (known + precedingLines) % 2; break }
        precedingLines++
      }
      const markers: RectangleMarker[] = []
      const next = new Map<number, number>()
      for (const line of lines) {
        next.set(line.from, phase)
        for (const row of line.rows) {
          if (phase === 0) markers.push(new RectangleMarker('source-row-stripe',
            line.box.left - originLeft, row.top - originTop, line.box.width, row.bottom - row.top))
        }
        phase = 1 - phase
      }
      if (lines.length) previous = next
      return markers
    },
  })
}
