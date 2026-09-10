import katexCss from 'katex/dist/katex.min.css?raw'
import mathCss from '../components/math.css?raw'
import { markdownMathRanges } from './markdown-compatibility'
import { hydrateMath, mathPlaceholder } from './markdown-math'

const fontUrls = import.meta.glob<string>('/node_modules/katex/dist/fonts/*.woff2', {
  eager: true, query: '?url', import: 'default',
})
let embeddedCss: Promise<string> | undefined

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('公式字体读取失败，请重试。'))
    reader.readAsDataURL(blob)
  })
}

function exportCss(): Promise<string> {
  embeddedCss ??= (async () => {
    const fonts = new Map(await Promise.all(Object.entries(fontUrls).map(async ([path, url]) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('公式字体加载失败，请刷新后重试。')
      return [path.split('/').pop()!, await asDataUrl(await response.blob())] as const
    })))
    // SVG image documents cannot load external fonts. Embed bundled WOFF2 only.
    return katexCss.replace(/src:[^;}]+/g, declaration => {
      const name = declaration.match(/fonts\/([^)'"\s]+\.woff2)/)?.[1]
      return name && fonts.has(name) ? `src:url("${fonts.get(name)}") format("woff2")` : declaration
    }) + mathCss
  })().catch(error => { embeddedCss = undefined; throw error })
  return embeddedCss
}

async function formulaPng(formula: HTMLElement, css: string): Promise<HTMLImageElement> {
  const computed = getComputedStyle(formula)
  const fontSize = computed.fontSize || formula.style.fontSize || '16px'
  const color = computed.color || formula.style.color || '#111820'
  const display = formula.dataset.ezMathDisplay === 'true'
  const source = formula.dataset.ezMath ?? ''
  const measure = document.createElement('div')
  measure.style.cssText = `position:fixed;left:-100000px;top:0;width:max-content;font-size:${fontSize};color:${color};pointer-events:none;`
  // Card snapshots inline computed widths. Rebuild the formula so those widths
  // and preview zoom cannot clip glyphs when rendered outside the card.
  const parsed = new DOMParser().parseFromString(mathPlaceholder({ raw: '', text: source, display }), 'text/html')
  hydrateMath(parsed)
  const content = parsed.body.firstElementChild as HTMLElement
  content.style.cssText = `display:inline-block;width:max-content;max-width:none;overflow:visible;margin:0;padding:4px;font-size:${fontSize};color:${color};`
  measure.append(content)
  document.body.append(measure)
  try {
    await document.fonts.ready
    const bounds = content.getBoundingClientRect()
    const width = Math.ceil(bounds.width)
    const height = Math.ceil(bounds.height)
    if (!width || !height || width > 8192 || height > 4096 || width * height > 4_000_000) {
      throw new Error('公式尺寸过大，无法生成图片，请拆分公式后重试。')
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', String(width * 2))
    svg.setAttribute('height', String(height * 2))
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject')
    foreign.setAttribute('width', String(width))
    foreign.setAttribute('height', String(height))
    const body = document.createElement('div')
    const style = document.createElement('style')
    style.textContent = css
    body.append(style, content.cloneNode(true))
    foreign.append(body)
    svg.append(foreign)
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('公式图片生成失败，请重试。'))
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法生成公式图片。')
    context.drawImage(image, 0, 0)
    const result = document.createElement('img')
    result.src = canvas.toDataURL('image/png')
    result.alt = `公式：${source}`
    result.dataset.ezMathImage = source
    result.width = width
    result.height = height
    result.style.cssText = `display:${display ? 'block' : 'inline-block'};width:${width}px;max-width:100%;height:auto;margin:${display ? '1em auto' : '0'};vertical-align:middle;border:0;`
    return result
  } finally { measure.remove() }
}

export async function replaceMathWithImages(root: HTMLElement): Promise<void> {
  const formulas = Array.from(root.querySelectorAll<HTMLElement>('[data-ez-math]:not([data-ez-math-error])'))
  if (!formulas.length) return
  const css = await exportCss()
  // Sequential rendering bounds canvas memory for long technical articles.
  for (const formula of formulas) formula.replaceWith(await formulaPng(formula, css))
}

export async function mathHtmlForExport(html: string): Promise<string> {
  if (!html.includes('data-ez-math')) return html
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:640px;font-size:16px;color:#111820;pointer-events:none;'
  host.innerHTML = html
  document.body.append(host)
  try {
    await replaceMathWithImages(host)
    return host.innerHTML
  } finally { host.remove() }
}

export function mathMarkdownForExport(markdown: string | undefined, html: string): string | undefined {
  if (!markdown?.includes('$')) return markdown
  const document = new DOMParser().parseFromString(html, 'text/html')
  const images = new Map(Array.from(document.querySelectorAll<HTMLImageElement>('img[data-ez-math-image]'), image => [image.dataset.ezMathImage!, image.getAttribute('src')!]))
  let result = markdown
  for (const range of markdownMathRanges(markdown).reverse()) {
    const source = images.get(range.text)
    if (source) result = result.slice(0, range.from) + `![公式](<${source}>)` + result.slice(range.to)
  }
  return result
}
