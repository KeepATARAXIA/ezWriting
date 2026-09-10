import { isGifSource } from './media-preview'

const DECORATION = ['border', 'border-radius', 'padding', 'box-shadow', 'background-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius']

function hasDecoration(image: HTMLImageElement): boolean {
  const style = image.style
  return /[1-9]/.test(style.borderWidth + style.borderRadius + style.padding)
    || Boolean(style.boxShadow && style.boxShadow !== 'none')
}

// Inspect bytes rather than extensions: CDN URLs often omit the real format.
export function staticImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (text(0, 8) === '\x89PNG\r\n\x1a\n') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset)
      if (offset + length + 12 > bytes.length) return null
      const type = text(offset + 4, 4)
      if (type === 'acTL') return null
      if (type === 'IEND') return 'image/png'
      offset += length + 12
    }
    return null
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset + 4, true)
      if (offset + length + 8 > bytes.length) return null
      if (text(offset, 4) === 'ANIM' || text(offset, 4) === 'ANMF') return null
      offset += 8 + length + (length % 2)
    }
    return 'image/webp'
  }
  // GIF, SVG, AVIF and unknown formats stay intact to avoid flattening animation.
  return null
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const finish = (error?: Error) => {
      clearTimeout(timer)
      image.onload = image.onerror = null
      if (error) { image.removeAttribute('src'); reject(error) } else resolve(image)
    }
    const timer = setTimeout(() => finish(new Error('图片加载超时')), 15000)
    image.onload = () => finish()
    image.onerror = () => finish(new Error('图片无法解码'))
    image.src = source
  })
}

async function framedPng(original: HTMLImageElement, source: string): Promise<void> {
  const decoded = await loadImage(source)
  if (!decoded.naturalWidth || !decoded.naturalHeight || decoded.naturalWidth * decoded.naturalHeight > 40_000_000) {
    throw new Error('图片尺寸过大，请缩小图片后重试')
  }
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:640px;pointer-events:none;'
  const image = document.createElement('img')
  image.src = source
  image.style.cssText = 'display:block;box-sizing:border-box;max-width:100%;height:auto;margin:0;'
  image.style.width = original.style.width || `${Math.min(640, decoded.naturalWidth)}px`
  for (const property of DECORATION) {
    if (original.style.getPropertyValue(property)) image.style.setProperty(property, original.style.getPropertyValue(property))
  }
  host.append(image)
  document.body.append(host)
  try {
    await image.decode()
    const bounds = image.getBoundingClientRect()
    // Leave enough transparent space for every shadow layer, including spread.
    const shadowExtents = image.style.boxShadow && image.style.boxShadow !== 'none'
      ? image.style.boxShadow.replace(/rgba?\([^)]*\)/g, '').split(',').map(layer => {
        const [x = 0, y = 0, blur = 0, spread = 0] = (layer.match(/-?[\d.]+(?:px)?/g) ?? []).map(Number.parseFloat)
        return Math.max(Math.abs(x), Math.abs(y)) + blur * 1.5 + Math.abs(spread) + 2
      }) : []
    const gutter = Math.ceil(Math.max(0, ...shadowExtents))
    const width = Math.ceil(bounds.width + gutter * 2)
    const height = Math.ceil(bounds.height + gutter * 2)
    if (!width || !height || width > 4096 || height > 8192 || width * height > 3_000_000) {
      throw new Error('图片尺寸过大，请缩小图片后重试')
    }
    image.style.width = `${bounds.width}px`
    image.style.height = `${bounds.height}px`
    image.style.maxWidth = 'none'
    const wrapper = document.createElement('div')
    wrapper.style.cssText = `box-sizing:border-box;width:${width}px;height:${height}px;padding:${gutter}px;`
    wrapper.append(image.cloneNode(true))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', String(width * 2))
    svg.setAttribute('height', String(height * 2))
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject')
    foreign.setAttribute('width', String(width))
    foreign.setAttribute('height', String(height))
    foreign.append(wrapper)
    svg.append(foreign)
    const rendered = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`)
    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法合成图片')
    context.drawImage(rendered, 0, 0)
    const png = canvas.toDataURL('image/png')
    if (!png.startsWith('data:image/png')) throw new Error('图片合成失败')
    original.src = png
    original.removeAttribute('srcset')
    original.removeAttribute('sizes')
    original.removeAttribute('width')
    original.removeAttribute('height')
    for (const property of DECORATION) original.style.removeProperty(property)
    original.style.border = '0'
    original.style.borderRadius = '0'
    original.style.padding = '0'
    original.style.boxShadow = 'none'
    original.style.backgroundColor = 'transparent'
    original.style.width = `${width}px`
    original.style.maxWidth = '100%'
    original.style.height = 'auto'
    original.dataset.ezImageFrame = 'baked'
  } finally { host.remove() }
}

export async function wechatImagesForExport(html: string): Promise<{ html: string; notice: string }> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let preserved = 0
  // Sequential processing limits decoded-image/canvas memory.
  for (const [index, image] of Array.from(doc.images).entries()) {
    if (!hasDecoration(image) || image.hasAttribute('data-ez-math-image') || image.dataset.ezImageFrame === 'baked') continue
    const source = image.getAttribute('src') || ''
    if (isGifSource(source)) { preserved++; continue }
    try {
      const response = await fetch(source, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('图片下载失败')
      const blob = await response.blob()
      if (blob.size > 30_000_000) throw new Error('图片文件过大')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const type = staticImageType(bytes)
      if (!type) { preserved++; continue }
      await framedPng(image, await dataUrl(new Blob([bytes], { type })))
    } catch {
      throw new Error(`第 ${index + 1} 张图片边框合成失败，未复制。远程图片可能限制跨域读取；请将图片下载后重新插入，或选择“无边框”再复制。`)
    }
  }
  return { html: doc.body.innerHTML, notice: preserved ? `${preserved} 张动图或暂不支持合成的图片已保留原图，其边框可能在公众号中丢失。` : '' }
}
