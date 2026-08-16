import type { MissingImageTarget } from '../domain/article'

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function targetForImage(image: HTMLImageElement): MissingImageTarget | null {
  const id = image.dataset.missingId
  const reference = image.dataset.missingAsset
  return id && reference ? { id, reference } : null
}

export function extractMissingImageTargets(html: string): MissingImageTarget[] {
  const document = parseHtml(html)
  return Array.from(document.body.querySelectorAll<HTMLImageElement>('img[data-missing-id][data-missing-asset]'))
    .map(targetForImage)
    .filter((target): target is MissingImageTarget => Boolean(target))
}

export function replaceMissingImage(html: string, target: MissingImageTarget, source: string, alt?: string): string {
  const document = parseHtml(html)
  const image = Array.from(document.body.querySelectorAll<HTMLImageElement>('img[data-missing-id]'))
    .find(candidate => candidate.dataset.missingId === target.id)
  if (!image) return html

  image.setAttribute('src', source)
  if (alt) image.setAttribute('alt', alt)
  image.removeAttribute('data-missing-id')
  image.removeAttribute('data-missing-asset')
  return document.body.innerHTML
}

export function deleteMissingImage(html: string, target: MissingImageTarget): string {
  const document = parseHtml(html)
  const image = Array.from(document.body.querySelectorAll<HTMLImageElement>('img[data-missing-id]'))
    .find(candidate => candidate.dataset.missingId === target.id)
  if (!image) return html

  const parent = image.parentElement
  image.remove()
  if (parent?.tagName === 'P' && !parent.textContent?.trim() && parent.children.length === 0) parent.remove()
  return document.body.innerHTML
}

export function renderMissingImagePlaceholders(html: string): string {
  const document = parseHtml(html)
  document.body.querySelectorAll<HTMLImageElement>('img[data-missing-id][data-missing-asset]').forEach(image => {
    const target = targetForImage(image)
    if (!target) return

    const card = document.createElement('figure')
    card.className = 'missing-image-card'
    card.dataset.missingId = target.id
    card.dataset.missingAsset = target.reference
    card.setAttribute('role', 'group')
    card.setAttribute('aria-label', `缺少图片：${target.reference}`)

    const icon = document.createElement('span')
    icon.className = 'missing-image-card-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = '▧'

    const copy = document.createElement('figcaption')
    const title = document.createElement('strong')
    title.textContent = image.getAttribute('alt')?.trim() || '图片暂时缺失'
    const reference = document.createElement('span')
    reference.textContent = target.reference
    copy.append(title, reference)

    const actions = document.createElement('div')
    actions.className = 'missing-image-actions'
    ;([
      ['relink', '重新链接'],
      ['replace', '替换图片'],
      ['delete', '删除'],
    ] as const).forEach(([action, label]) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.missingImageAction = action
      button.dataset.missingId = target.id
      button.dataset.missingAsset = target.reference
      button.textContent = label
      actions.append(button)
    })

    card.append(icon, copy, actions)
    const parent = image.parentElement
    if (parent?.tagName === 'P' && !parent.textContent?.trim() && parent.children.length === 1) parent.replaceWith(card)
    else image.replaceWith(card)
  })
  return document.body.innerHTML
}
