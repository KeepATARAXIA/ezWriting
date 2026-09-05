// Keep a single Markdown paragraph and its <br> elements, while exposing each
// explicitly entered line as a preview target. Automatic visual wrapping is untouched.
export function paragraphBreakTargets(element: HTMLElement, expectedLineCount: number): HTMLElement[] | null {
  if (!element.matches('p') || expectedLineCount < 2) return null
  const breaks = Array.from(element.querySelectorAll('br'))
  if (breaks.length + 1 !== expectedLineCount) return null
  const document = element.ownerDocument
  const targets: HTMLElement[] = []
  const replacement = document.createDocumentFragment()
  const seenIds = new Set<string>()
  for (let index = 0; index <= breaks.length; index++) {
    const range = document.createRange()
    if (index) range.setStartAfter(breaks[index - 1])
    else range.setStart(element, 0)
    if (index < breaks.length) range.setEndBefore(breaks[index])
    else range.setEnd(element, element.childNodes.length)
    const target = document.createElement('span')
    target.className = 'preview-source-line-target'
    target.append(range.cloneContents())
    target.querySelectorAll('[id]').forEach(node => {
      if (seenIds.has(node.id)) node.removeAttribute('id')
      else seenIds.add(node.id)
    })
    targets.push(target)
    replacement.append(target)
    if (index < breaks.length) replacement.append(document.createElement('br'))
  }
  element.replaceChildren(replacement)
  return targets
}
