import { normalizeMarkdownStrongWhitespace } from './markdown-compatibility'

export type PlatformContentTarget = 'wechat' | 'xhs' | 'x' | 'generic'

export interface PlatformCompatibilityOptions {
  replaceVideos?: boolean
}

const DEFAULT_HIGHLIGHT_COLOR = '#fff1a8'

const VIDEO_PLATFORM_INSTRUCTIONS: Record<PlatformContentTarget, string> = {
  wechat: '复制后请在公众号后台使用视频组件原生上传。',
  xhs: '导出的卡片只保留视频提示，发布时请在小红书原生上传。',
  x: '复制正文后请在 X 发布界面原生上传视频。',
  generic: '请在目标平台发布界面原生上传视频。',
}

function replaceMark(mark: HTMLElement, target: PlatformContentTarget): void {
  const replacement = mark.ownerDocument.createElement('span')
  Array.from(mark.attributes).forEach(attribute => replacement.setAttribute(attribute.name, attribute.value))
  replacement.dataset.ezFormat = 'highlight'

  const highlightColor = mark.style.backgroundColor || mark.style.background || DEFAULT_HIGHLIGHT_COLOR
  replacement.style.background = ''
  replacement.style.backgroundColor = highlightColor
  replacement.style.color = mark.style.color || 'inherit'

  if (target === 'wechat') {
    replacement.style.display = 'inline'
    replacement.style.padding = mark.style.padding || '0.08em 0.2em'
    replacement.style.borderRadius = mark.style.borderRadius || '3px'
    replacement.style.boxDecorationBreak = 'clone'
    replacement.style.setProperty('-webkit-box-decoration-break', 'clone')
  } else if (target === 'xhs') {
    replacement.style.padding = mark.style.padding || '0.06em 0.16em'
    replacement.style.borderRadius = mark.style.borderRadius || '3px'
    replacement.style.fontWeight = '750'
  } else if (target === 'x') {
    replacement.style.backgroundColor = ''
    replacement.style.padding = ''
    replacement.style.borderRadius = ''
    replacement.style.fontWeight = '700'
    replacement.style.textDecorationLine = 'underline'
    replacement.style.textDecorationColor = highlightColor
    replacement.style.textDecorationThickness = '0.16em'
    replacement.style.textUnderlineOffset = '0.14em'
  }

  replacement.append(...Array.from(mark.childNodes))
  mark.replaceWith(replacement)
}

function replaceVideo(video: HTMLVideoElement, target: PlatformContentTarget): void {
  const placeholder = video.ownerDocument.createElement('section')
  const name = video.dataset.ezVideoName?.trim() || '本地视频'
  placeholder.className = 'ez-video-platform-placeholder'
  placeholder.dataset.ezVideoPlaceholder = 'true'
  placeholder.setAttribute('aria-label', `视频素材：${name}`)
  placeholder.style.cssText = 'box-sizing:border-box;width:100%;margin:1.2em 0;padding:16px 18px;border:1px solid #d8e0e8;border-left:4px solid #1648ff;border-radius:9px;background:#f7f9fc;color:#34404b;line-height:1.6;'

  const title = video.ownerDocument.createElement('strong')
  title.style.cssText = 'display:block;margin-bottom:3px;font-size:0.95em;'
  title.textContent = `视频素材：${name}`
  const instruction = video.ownerDocument.createElement('span')
  instruction.style.cssText = 'display:block;color:#687580;font-size:0.82em;'
  instruction.textContent = VIDEO_PLATFORM_INSTRUCTIONS[target]
  placeholder.append(title, instruction)
  video.replaceWith(placeholder)
}

export function applyPlatformCompatibilityToDocument(
  document: Document,
  target: PlatformContentTarget,
  options: PlatformCompatibilityOptions = {},
): void {
  document.body.querySelectorAll<HTMLElement>('mark').forEach(mark => replaceMark(mark, target))
  if (options.replaceVideos ?? true) {
    document.body.querySelectorAll<HTMLVideoElement>('video').forEach(video => replaceVideo(video, target))
  }

  document.body.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    image.loading = 'lazy'
    image.decoding = 'async'
    image.style.maxWidth = '100%'
    image.style.height = 'auto'
  })
}

export function applyPlatformCompatibility(html: string, target: PlatformContentTarget): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  applyPlatformCompatibilityToDocument(document, target)
  return document.body.innerHTML
}

function replaceMarkdownHighlightsOutsideCode(
  markdown: string,
  replacer: (content: string) => string,
): string {
  let fencedCodeMarker: string | null = null

  return markdown
    .split('\n')
    .map(line => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/)
      if (fence) {
        const marker = fence[1]
        if (!fencedCodeMarker) {
          fencedCodeMarker = marker
        } else if (marker[0] === fencedCodeMarker[0] && marker.length >= fencedCodeMarker.length) {
          fencedCodeMarker = null
        }
        return line
      }

      if (fencedCodeMarker) return line

      return line
        .split(/(`+[^`\n]*?`+)/g)
        .map(segment =>
          segment.startsWith('`') ? segment : segment.replace(/==([^=\n]+)==/g, (_, content) => replacer(content)),
        )
        .join('')
    })
    .join('\n')
}

export function applyPlatformMarkdownCompatibility(
  markdown: string | undefined,
  target: PlatformContentTarget,
): string | undefined {
  if (markdown === undefined) return undefined
  const normalizedMarkdown = normalizeMarkdownStrongWhitespace(markdown)
  if (target === 'wechat') {
    return replaceMarkdownHighlightsOutsideCode(
      normalizedMarkdown,
      content =>
        `<span style="background-color:#fff1a8;padding:0.08em 0.2em;border-radius:3px">${content}</span>`,
    )
  }
  return replaceMarkdownHighlightsOutsideCode(normalizedMarkdown, content => `**${content}**`)
}
