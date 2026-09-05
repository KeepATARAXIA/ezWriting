import { compactLocalVideoData } from './local-video-registry'
import type { ArticleDraft } from '../domain/article'

// Session-only URLs. IndexedDB still owns the original bytes; never persist a blob URL.
const images = new Map<string, { source: string; blob: Blob }>()
const sources = new Map<string, string>()

export function localImageSource(reference: string): string | undefined {
  return images.get(reference)?.source
}

export function localImageBlob(reference: string): Blob | undefined {
  return images.get(reference)?.blob
}

export function localImageReferences(): string[] {
  return [...images.keys()]
}

export function registerLocalImage(source: string): string {
  if (!/^data:image\//i.test(source) || typeof URL.createObjectURL !== 'function') return source
  const existing = sources.get(source)
  if (existing) return existing
  const comma = source.indexOf(',')
  if (comma < 0) return source
  const metadata = source.slice(5, comma)
  let blob: Blob
  try {
    if (/;base64/i.test(metadata)) {
      const binary = atob(source.slice(comma + 1).replace(/\s/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      blob = new Blob([bytes], { type: metadata.split(';')[0] })
    } else {
      blob = new Blob([decodeURIComponent(source.slice(comma + 1))], { type: metadata.split(';')[0] })
    }
  } catch {
    // Preserve malformed imports for the existing validation/missing-media path.
    return source
  }
  const reference = URL.createObjectURL(blob)
  images.set(reference, { source, blob })
  sources.set(source, reference)
  return reference
}

export function compactLocalImages(value: string): string {
  if (!/data:image\//i.test(value)) return value
  const markdown = value.replace(/(!\[[^\]\n]*\]\(\s*<?)(data:image\/[^\s"'<>)]*)/gi,
    (_syntax, prefix: string, source: string) => `${prefix}${registerLocalImage(source)}`)
  return markdown.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/[^"']+)\2/gi,
    (_syntax, prefix: string, quote: string, source: string) => `${prefix}${quote}${registerLocalImage(source)}${quote}`)
}

export function compactArticleMedia(article: ArticleDraft): ArticleDraft {
  const compact = (value: string) => compactLocalImages(compactLocalVideoData(value))
  const html = compact(article.html)
  const markdown = article.markdown === undefined ? undefined : compact(article.markdown)
  const sourceText = article.sourceText === article.markdown ? markdown
    : article.sourceText === undefined ? undefined : compact(article.sourceText)
  return html === article.html && markdown === article.markdown && sourceText === article.sourceText
    ? article : { ...article, html, markdown, sourceText }
}

export function expandLocalImageReferences(value: string): string {
  if (!value.includes('blob:')) return value
  return value.replace(/blob:[^\s"'<>)]*/g, reference => localImageSource(reference) ?? reference)
}

// Called on document replacement, not on individual edits: undo still owns deleted images.
export function retainLocalImageReferences(values: string[]): void {
  const retained = new Set(values.flatMap(value => value.match(/blob:[^\s"'<>)]*/g) ?? []))
  for (const [reference, entry] of images) {
    if (retained.has(reference)) continue
    URL.revokeObjectURL(reference)
    images.delete(reference)
    sources.delete(entry.source)
  }
}

export function protectLocalImageReferences(html: string): { html: string; restore: (value: string) => string } {
  const replacements = new Map<string, string>()
  const compacted = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(blob:[^"']+)\2/gi,
    (syntax, prefix: string, quote: string, reference: string) => {
      if (!images.has(reference)) return syntax
      const placeholder = `data:image/png;ez-local=${crypto.randomUUID()};base64,AA==`
      replacements.set(placeholder, reference)
      return `${prefix}${quote}${placeholder}${quote}`
    })
  return {
    html: compacted,
    restore: value => [...replacements].reduce((result, [placeholder, reference]) => result.replaceAll(placeholder, reference), value),
  }
}
