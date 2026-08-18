import type { XhsCardTemplate } from '../domain/saved-draft'
import type { XhsPageFits } from './xhs-pagination'

export interface XhsCardMeasurementOptions {
  title: string
  cover?: string
  template: XhsCardTemplate
  showFooter: boolean
  footerText: string
  variables: Record<string, string>
}

export interface XhsCardPageMeasurer {
  fits: XhsPageFits
  dispose: () => void
}

const CARD_WIDTH = 540
const CARD_HEIGHT = 720
const CONTENT_FOOTER_GAP = 8

function numericStyle(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function renderedContentBottom(content: HTMLElement): number {
  let bottom = content.offsetTop + content.offsetHeight
  Array.from(content.children).forEach(child => {
    const marginBottom = numericStyle(window.getComputedStyle(child).marginBottom)
    bottom = Math.max(bottom, (child as HTMLElement).offsetTop + (child as HTMLElement).offsetHeight + marginBottom)
  })
  return bottom
}

export function createXhsCardPageMeasurer(options: XhsCardMeasurementOptions): XhsCardPageMeasurer | null {
  if (typeof document === 'undefined' || !document.body) return null

  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    `width:${CARD_WIDTH}px`,
    `height:${CARD_HEIGHT}px`,
    'visibility:hidden',
    'pointer-events:none',
    'overflow:hidden',
    'z-index:-1',
  ].join(';')
  Object.entries(options.variables).forEach(([name, value]) => root.style.setProperty(name, value))

  const page = document.createElement('section')
  page.className = `xhs-card-page template-${options.template}`
  page.style.width = `${CARD_WIDTH}px`
  page.style.height = `${CARD_HEIGHT}px`
  page.style.aspectRatio = 'auto'
  root.append(page)
  document.body.append(root)

  const initialBounds = page.getBoundingClientRect()
  if (initialBounds.width < CARD_WIDTH - 1 || initialBounds.height < CARD_HEIGHT - 1) {
    root.remove()
    return null
  }

  const cache = new Map<string, boolean>()
  const fits: XhsPageFits = (pageHtml, pageIndex) => {
    const cacheKey = `${pageIndex}:${pageHtml}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached

    page.replaceChildren()
    if (pageIndex === 0) {
      const title = document.createElement('h1')
      title.textContent = options.title || '未命名文章'
      page.append(title)
      if (options.cover) {
        const cover = document.createElement('img')
        cover.className = 'xhs-card-cover'
        cover.src = options.cover
        cover.alt = ''
        page.append(cover)
      }
    }

    const content = document.createElement('div')
    content.className = 'xhs-card-content'
    content.innerHTML = pageHtml
    page.append(content)

    let footer: HTMLElement | null = null
    if (options.showFooter) {
      footer = document.createElement('footer')
      const label = document.createElement('span')
      label.textContent = options.footerText || ' '
      const count = document.createElement('span')
      count.textContent = '00 / 00'
      footer.append(label, count)
      page.append(footer)
    }

    const pageStyle = window.getComputedStyle(page)
    const safeBottom = footer
      ? footer.offsetTop - CONTENT_FOOTER_GAP
      : page.clientHeight - numericStyle(pageStyle.paddingBottom)
    const result = renderedContentBottom(content) <= safeBottom + 0.5
    cache.set(cacheKey, result)
    return result
  }

  return {
    fits,
    dispose: () => root.remove(),
  }
}

function imageSources(html: string, cover?: string): string[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const sources = Array.from(parsed.images, image => image.getAttribute('src') || '').filter(Boolean)
  if (cover) sources.push(cover)
  return Array.from(new Set(sources))
}

function waitForImage(source: string): Promise<void> {
  return new Promise(resolve => {
    const image = new Image()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const timer = window.setTimeout(finish, 1200)
    image.onload = () => {
      window.clearTimeout(timer)
      finish()
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      finish()
    }
    image.src = source
    if (image.complete) {
      window.clearTimeout(timer)
      finish()
    }
  })
}

export async function waitForXhsPaginationAssets(html: string, cover?: string): Promise<void> {
  const fontsReady = 'fonts' in document
    ? Promise.race([
      document.fonts.ready.then(() => undefined),
      new Promise<void>(resolve => window.setTimeout(resolve, 1200)),
    ])
    : Promise.resolve()
  await Promise.all([fontsReady, ...imageSources(html, cover).map(waitForImage)])
}
