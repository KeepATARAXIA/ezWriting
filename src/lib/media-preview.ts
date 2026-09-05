import { localImageSource } from './local-image-registry'
// Presentation-only thumbnails. Original media stays in the article/export path.
type MediaKind = 'gif' | 'video'
type Thumbnail = { url: string; width: number; height: number }
type CachedThumbnail = {
  promise: Promise<Thumbnail | null>
  controller: AbortController
  users: number
  thumbnail: Thumbnail | null
  timer?: ReturnType<typeof setTimeout>
}
const thumbnails = new Map<string, CachedThumbnail>()
let running = 0
const queue: Array<() => void> = []

export function isGifSource(source: string): boolean {
  source = localImageSource(source) ?? source
  return /^data:image\/gif[;,]/i.test(source) || /\.gif(?:[?#]|$)/i.test(source)
}

export function mediaPlaceholder(source = ''): string {
  source = localImageSource(source) ?? source
  let width = 16
  let height = 9
  // Read just the GIF logical screen header, never decode the full Base64 payload.
  const header = /^data:image\/gif;base64,([a-z0-9+/]{16})/i.exec(source)
  if (header) {
    const bytes = atob(header[1])
    width = bytes.charCodeAt(6) | bytes.charCodeAt(7) << 8
    height = bytes.charCodeAt(8) | bytes.charCodeAt(9) << 8
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width || 16}" height="${height || 9}"><rect width="100%" height="100%" fill="#edf1f5"/></svg>`)}`
}

function captureFrame(source: string, kind: MediaKind, signal: AbortSignal): Promise<Thumbnail | null> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(null); return }
    const media = kind === 'gif' ? new Image() : document.createElement('video')
    let finished = false
    const finish = (thumbnail: Thumbnail | null) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      media.onload = media.onerror = null
      if (media instanceof HTMLVideoElement) {
        media.onloadeddata = null
        media.removeAttribute('src')
        media.load()
      } else media.removeAttribute('src')
      resolve(thumbnail)
    }
    const abort = () => finish(null)
    const timer = setTimeout(abort, 8_000)
    const draw = () => {
      if (signal.aborted || finished) return
      const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
      const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
      if (!width || !height) { finish(null); return }
      const scale = Math.min(1, 960 / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      try {
        const context = canvas.getContext('2d')
        if (!context) { finish(null); return }
        // Canvas draws the animation's default/first frame, per the HTML standard.
        context.drawImage(media, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => {
          if (finished) return
          finish(blob ? { url: URL.createObjectURL(blob), width, height } : null)
        }, 'image/png')
      } catch {
        // Remote media without CORS can still be opened explicitly in the editor.
        finish(null)
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    media.onerror = abort
    if (/^https?:/i.test(source)) media.crossOrigin = 'anonymous'
    if (media instanceof HTMLVideoElement) {
      media.preload = 'auto'
      media.muted = true
      media.playsInline = true
      media.onloadeddata = draw
    } else media.onload = draw
    media.src = source
  })
}

function acquireThumbnail(source: string, kind: MediaKind) {
  // Source URLs already identify the immutable media; avoid copying a large Data URI.
  const key = source
  let entry = thumbnails.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { controller, users: 0, thumbnail: null, promise: Promise.resolve(null) }
    const current = entry
    entry.promise = new Promise(resolve => {
      const start = () => {
        running++
        void captureFrame(source, kind, controller.signal).then(result => {
          current.thumbnail = result
          resolve(result)
        }).finally(() => { running--; queue.shift()?.() })
      }
      if (running < 2) start()
      else queue.push(start)
    })
    thumbnails.set(key, entry)
  }
  entry.users++
  clearTimeout(entry.timer)
  const current = entry
  const evict = () => {
    if (current.users || thumbnails.get(key) !== current) return
    current.controller.abort()
    if (current.thumbnail) URL.revokeObjectURL(current.thumbnail.url)
    thumbnails.delete(key)
  }
  return {
    promise: current.promise,
    release: () => {
      current.users--
      if (current.users) return
      // Cancel in-flight decoders immediately. Keep at most four idle posters for
      // 20 seconds so editor/preview replacement can reuse a completed thumbnail.
      if (!current.thumbnail) { evict(); return }
      current.timer = setTimeout(evict, 20_000)
      const idle = Array.from(thumbnails.entries()).filter(([, value]) => !value.users)
      for (const [idleKey, value] of idle.slice(0, Math.max(0, idle.length - 4))) {
        clearTimeout(value.timer)
        if (value.thumbnail) URL.revokeObjectURL(value.thumbnail.url)
        thumbnails.delete(idleKey)
      }
    },
  }
}

function watchVisibility(element: HTMLElement, onVisible: () => void, onHidden: () => void) {
  let intersecting = false
  const sync = () => {
    if (intersecting && !document.hidden) onVisible()
    else onHidden()
  }
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    intersecting = entries[0]?.isIntersecting ?? false
    sync()
  })
  observer?.observe(element)
  document.addEventListener('visibilitychange', sync)
  return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', sync) }
}

export function mountGifPreview(image: HTMLImageElement, source: string, controls?: HTMLElement, onResize?: () => void) {
  const placeholder = mediaPlaceholder(source)
  image.src = placeholder
  image.dataset.ezGifPreview = 'static'
  let poster = placeholder
  let thumbnail: ReturnType<typeof acquireThumbnail> | undefined
  let disposed = false
  let playing = false
  const button = controls ? document.createElement('button') : null
  const stop = () => {
    playing = false
    image.src = poster
    image.dataset.ezGifPreview = 'static'
    if (button) { button.textContent = '播放 GIF'; button.setAttribute('aria-pressed', 'false') }
  }
  const load = () => {
    if (thumbnail) return
    thumbnail = acquireThumbnail(source, 'gif')
    void thumbnail.promise.then(result => {
      if (disposed) return
      if (result) poster = result.url
      if (!playing) image.src = poster
      if (!result) image.title = '静态预览暂不可用，可在编辑区播放原图'
      onResize?.()
    })
  }
  if (button) {
    button.type = 'button'
    button.className = 'media-play-toggle'
    button.setAttribute('aria-pressed', 'false')
    button.textContent = '播放 GIF'
    button.onclick = event => {
      event.preventDefault()
      event.stopPropagation()
      if (playing) { stop(); return }
      load()
      playing = true
      image.src = source
      image.dataset.ezGifPreview = 'playing'
      button.textContent = '暂停 GIF'
      button.setAttribute('aria-pressed', 'true')
    }
    controls?.append(button)
  }
  const unwatch = watchVisibility(image, load, stop)
  return () => { disposed = true; unwatch(); thumbnail?.release(); button?.remove(); image.removeAttribute('src') }
}

export function mountVideoPreview(container: HTMLElement, source: string, name: string, onResize?: () => void) {
  const image = document.createElement('img')
  image.alt = `视频封面：${name}`
  image.src = mediaPlaceholder()
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'media-play-toggle'
  button.textContent = '播放视频'
  button.setAttribute('aria-label', `播放视频：${name}`)
  container.append(image, button)
  let video: HTMLVideoElement | null = null
  let thumbnail: ReturnType<typeof acquireThumbnail> | undefined
  let disposed = false
  const stop = () => {
    if (video) {
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      video = null
    }
    image.hidden = false
    button.textContent = '播放视频'
    button.setAttribute('aria-label', `播放视频：${name}`)
  }
  const load = () => {
    if (thumbnail) return
    thumbnail = acquireThumbnail(source, 'video')
    void thumbnail.promise.then(result => {
      if (disposed || !result) return
      image.src = result.url
      onResize?.()
    })
  }
  button.onclick = event => {
    event.preventDefault()
    event.stopPropagation()
    if (video) { stop(); return }
    video = document.createElement('video')
    video.controls = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = source
    video.setAttribute('aria-label', `视频播放器：${name}`)
    video.onerror = () => { stop(); button.textContent = '无法播放，点击重试' }
    image.hidden = true
    container.prepend(video)
    button.textContent = '收起视频'
    button.setAttribute('aria-label', `收起视频：${name}`)
    void video.play().catch(() => { /* Native controls remain available if playback is blocked. */ })
  }
  const unwatch = watchVisibility(container, load, stop)
  return () => { disposed = true; unwatch(); stop(); thumbnail?.release() }
}

export function prepareStaticPreviewMedia(document: Document): void {
  document.querySelectorAll('video').forEach(video => {
    const name = video.dataset.ezVideoName || '本地视频'
    const poster = document.createElement('img')
    poster.className = 'ez-static-video'
    poster.alt = `视频：${name}（在左侧编辑区播放）`
    poster.dataset.ezVideoSource = video.getAttribute('src') || ''
    poster.dataset.ezVideoPreview = 'static'
    poster.src = mediaPlaceholder()
    poster.title = `视频：${name} · 在左侧编辑区播放`
    for (const attribute of ['data-source-block', 'data-source-line']) {
      if (video.hasAttribute(attribute)) poster.setAttribute(attribute, video.getAttribute(attribute)!)
    }
    const frame = document.createElement('span')
    frame.className = 'ez-video-preview-frame'
    const label = document.createElement('span')
    label.className = 'ez-video-preview-label'
    label.textContent = '视频 · 在编辑区播放'
    label.setAttribute('aria-hidden', 'true')
    frame.append(poster, label)
    video.replaceWith(frame)
  })
  document.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
    const source = image.getAttribute('src') || ''
    if (!isGifSource(source)) return
    image.dataset.ezGifSource = source
    image.src = mediaPlaceholder(source)
  })
}

export function restorePreviewGifSources(html: string): string {
  if (!html.includes('data-ez-gif-source')) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll<HTMLImageElement>('img[data-ez-gif-source]').forEach(image => {
    image.src = image.dataset.ezGifSource!
    image.removeAttribute('data-ez-gif-source')
  })
  return document.body.innerHTML
}

export function observeStaticPreviewMedia(root: HTMLElement): () => void {
  const cleanups = new Map<HTMLImageElement, () => void>()
  const scan = () => {
    for (const [image, cleanup] of cleanups) {
      if (!root.contains(image)) { cleanup(); cleanups.delete(image) }
    }
    root.querySelectorAll<HTMLImageElement>('img[data-ez-gif-source], img[data-ez-video-source]').forEach(image => {
      if (cleanups.has(image) || image.closest('.xhs-export-sheet')) return
      if (image.dataset.ezGifSource) {
        cleanups.set(image, mountGifPreview(image, image.dataset.ezGifSource))
      } else {
        let thumbnail: ReturnType<typeof acquireThumbnail> | undefined
        let disposed = false
        const unwatch = watchVisibility(image, () => {
          if (thumbnail) return
          thumbnail = acquireThumbnail(image.dataset.ezVideoSource!, 'video')
          void thumbnail.promise.then(result => { if (!disposed && result) image.src = result.url })
        }, () => undefined)
        cleanups.set(image, () => { disposed = true; unwatch(); thumbnail?.release() })
      }
    })
  }
  scan()
  const observer = new MutationObserver(scan)
  observer.observe(root, { childList: true, subtree: true })
  return () => { observer.disconnect(); cleanups.forEach(cleanup => cleanup()); cleanups.clear() }
}
