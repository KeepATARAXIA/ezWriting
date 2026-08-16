function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('图片资源读取失败。'))
    reader.onerror = () => reject(reader.error || new Error('图片资源读取失败。'))
    reader.readAsDataURL(blob)
  })
}

async function inlineImageSources(element: HTMLElement): Promise<void> {
  const images = Array.from(element.querySelectorAll<HTMLImageElement>('img[src]'))
  await Promise.all(images.map(async image => {
    const source = image.src
    if (!source || source.startsWith('data:')) return

    try {
      const response = await fetch(source)
      if (!response.ok) throw new Error(String(response.status))
      image.src = await blobToDataUrl(await response.blob())
    } catch {
      throw new Error('部分外链图片无法写入卡片，请先改用本地图片后再导出。')
    }
  }))
}

function inlineComputedStyles(source: Element, clone: Element): void {
  if (source instanceof HTMLElement && clone instanceof HTMLElement) {
    const computed = window.getComputedStyle(source)
    const declarations: string[] = []
    for (const property of Array.from(computed)) {
      declarations.push(`${property}:${computed.getPropertyValue(property)};`)
    }
    clone.setAttribute('style', declarations.join(''))
  }

  Array.from(source.children).forEach((child, index) => {
    const clonedChild = clone.children[index]
    if (clonedChild) inlineComputedStyles(child, clonedChild)
  })
}

function loadSvgImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('卡片图像生成失败，请重试。'))
    image.src = source
  })
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 文件生成失败。')), 'image/png')
  })
}

export function safeDownloadName(value: string): string {
  const normalized = value.trim().replace(/[\\/:：*?？"“”<>《》|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-')
  return normalized.replace(/^-|-$/g, '').slice(0, 64) || '小红书卡片'
}

export async function captureXhsCard(element: HTMLElement): Promise<Blob> {
  const bounds = element.getBoundingClientRect()
  const sourceWidth = Math.max(1, Math.round(bounds.width || element.offsetWidth || 540))
  const sourceHeight = Math.max(1, Math.round(bounds.height || element.offsetHeight || sourceWidth * 4 / 3))
  const clone = element.cloneNode(true) as HTMLElement

  inlineComputedStyles(element, clone)
  await inlineImageSources(clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  clone.style.width = `${sourceWidth}px`
  clone.style.height = `${sourceHeight}px`
  clone.style.margin = '0'
  clone.style.transform = 'none'

  const markup = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 ${sourceWidth} ${sourceHeight}"><foreignObject width="${sourceWidth}" height="${sourceHeight}">${markup}</foreignObject></svg>`
  const image = await loadSvgImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1440
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法生成卡片图片。')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return await canvasToPng(canvas)
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
