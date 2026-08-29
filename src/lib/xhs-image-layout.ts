import {
  normalizeXhsImageOverride,
  type XhsImageLayout,
  type XhsImageOverride,
} from '../domain/saved-draft'
import { applyPlatformCompatibilityToDocument } from './platform-compatibility'

export interface XhsPreparedImage {
  key: string
  alt: string
  layout: XhsImageLayout
  widthPercent: number
  canPair: boolean
}

export interface XhsPreparedLayout {
  html: string
  images: XhsPreparedImage[]
}

function sourceFingerprint(source: string): string {
  const sample = source.length > 8192
    ? `${source.slice(0, 4096)}:${source.length}:${source.slice(-4096)}`
    : source
  let hash = 0x811c9dc5
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function topLevelBlock(image: HTMLImageElement, body: HTMLElement): HTMLElement | null {
  let block: HTMLElement = image
  while (block.parentElement && block.parentElement !== body) block = block.parentElement
  return block.parentElement === body ? block : null
}

function isImageOnlyBlock(block: HTMLElement, image: HTMLImageElement): boolean {
  const contentWithoutMedia = block.cloneNode(true) as HTMLElement
  contentWithoutMedia.querySelectorAll('img, figcaption').forEach(element => element.remove())
  return block.querySelectorAll('img').length === 1
    && block.contains(image)
    && !(contentWithoutMedia.textContent || '').trim()
}

function canPairWithImage(block: Element | null): block is HTMLElement {
  return block instanceof HTMLElement
    && block.matches('p, ul, ol, blockquote, aside[data-callout]')
    && !block.querySelector('img, table, pre')
}

function defaultOverride(): XhsImageOverride {
  return { layout: 'full', widthPercent: 100 }
}

function nodeContainsImage(node: Node): boolean {
  return node instanceof Element
    && (node.matches('img') || Boolean(node.querySelector('img')))
}

function hasRenderableContent(nodes: Node[]): boolean {
  return nodes.some(node => node instanceof Element || Boolean(node.textContent?.trim()))
}

function cloneParagraphWithNodes(paragraph: HTMLParagraphElement, nodes: Node[]): HTMLParagraphElement {
  const fragment = paragraph.cloneNode(false) as HTMLParagraphElement
  nodes.forEach(node => fragment.append(node.cloneNode(true)))
  return fragment
}

function splitMixedImageParagraphs(document: Document): void {
  Array.from(document.body.querySelectorAll<HTMLParagraphElement>(':scope > p')).forEach(paragraph => {
    const nodes = Array.from(paragraph.childNodes)
    if (!nodes.some(nodeContainsImage)) return

    const fragments: HTMLParagraphElement[] = []
    let textNodes: Node[] = []
    const pushTextFragment = () => {
      if (hasRenderableContent(textNodes)) fragments.push(cloneParagraphWithNodes(paragraph, textNodes))
      textNodes = []
    }

    nodes.forEach(node => {
      if (!nodeContainsImage(node)) {
        textNodes.push(node)
        return
      }
      pushTextFragment()
      fragments.push(cloneParagraphWithNodes(paragraph, [node]))
    })
    pushTextFragment()

    if (fragments.length > 1) paragraph.replaceWith(...fragments)
  })
}

export function prepareXhsImageLayout(
  html: string,
  imageOverrides: Record<string, XhsImageOverride>,
): XhsPreparedLayout {
  if (!/<(?:img|video|mark)\b/i.test(html)) return { html, images: [] }
  const document = new DOMParser().parseFromString(html, 'text/html')
  applyPlatformCompatibilityToDocument(document, 'xhs')
  splitMixedImageParagraphs(document)
  const occurrences = new Map<string, number>()
  const images: XhsPreparedImage[] = []

  Array.from(document.body.querySelectorAll<HTMLImageElement>('img')).forEach(image => {
    const fingerprint = sourceFingerprint(image.getAttribute('src') || image.getAttribute('data-missing-asset') || image.alt)
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1
    occurrences.set(fingerprint, occurrence)
    const key = `xhs-img-${fingerprint}-${occurrence}`
    const requested = normalizeXhsImageOverride(imageOverrides[key]) ?? defaultOverride()
    const block = topLevelBlock(image, document.body)
    const canPair = Boolean(block && isImageOnlyBlock(block, image) && canPairWithImage(block.nextElementSibling))
    let effective = requested

    if (requested.layout !== 'full') {
      const textBlock = block?.nextElementSibling ?? null
      if (!canPair || !block || !canPairWithImage(textBlock)) {
        effective = { layout: 'full', widthPercent: Math.min(100, Math.max(35, requested.widthPercent)) }
      } else {
        const group = document.createElement('section')
        group.className = `xhs-media-layout ${requested.layout}`
        group.dataset.xhsMediaLayout = requested.layout
        group.dataset.xhsImageKey = key
        group.style.setProperty('--xhs-image-column', `${requested.widthPercent}%`)
        const imageSlot = document.createElement('div')
        imageSlot.className = 'xhs-media-image'
        const textSlot = document.createElement('div')
        textSlot.className = 'xhs-media-text'
        block.replaceWith(group)
        imageSlot.append(block)
        textSlot.append(textBlock)
        if (requested.layout === 'image-left') group.append(imageSlot, textSlot)
        else group.append(textSlot, imageSlot)
      }
    }

    image.dataset.xhsImageKey = key
    image.dataset.xhsImageLayout = effective.layout
    image.dataset.xhsImageWidth = String(effective.widthPercent)
    image.draggable = false
    image.tabIndex = 0
    image.setAttribute('role', 'button')
    image.setAttribute('aria-label', `调整${image.alt || `正文图片 ${images.length + 1}`}的布局和大小`)
    if (effective.layout === 'full') {
      image.style.width = `${effective.widthPercent}%`
      image.style.maxWidth = '100%'
      block?.classList.add('xhs-media-full')
    } else {
      image.style.width = '100%'
      image.style.maxWidth = '100%'
    }
    images.push({ key, alt: image.alt || `正文图片 ${images.length + 1}`, canPair, ...effective })
  })

  return { html: document.body.innerHTML, images }
}
