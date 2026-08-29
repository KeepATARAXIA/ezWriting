export const LOCAL_VIDEO_PROTOCOL = 'dispatch-local-video://'

interface LocalVideoEntry {
  blob: Blob
  objectUrl: string | null
}

const entries = new Map<string, LocalVideoEntry>()
let fallbackSequence = 0

function removeEntry(reference: string): void {
  const entry = entries.get(reference)
  if (entry?.objectUrl && typeof URL?.revokeObjectURL === 'function') URL.revokeObjectURL(entry.objectUrl)
  entries.delete(reference)
}

function safeId(value: string): string | null {
  return /^[a-z0-9-]+$/i.test(value) ? value : null
}

function nextId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  fallbackSequence += 1
  return `session-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`
}

function objectUrlFor(blob: Blob): string | null {
  return typeof URL?.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
}

export function isLocalVideoReference(value: string | null | undefined): value is string {
  if (!value?.startsWith(LOCAL_VIDEO_PROTOCOL)) return false
  return safeId(value.slice(LOCAL_VIDEO_PROTOCOL.length)) !== null
}

export function registerLocalVideo(blob: Blob, preferredId?: string): string {
  const id = safeId(preferredId || '') || nextId()
  const reference = `${LOCAL_VIDEO_PROTOCOL}${id}`
  const previous = entries.get(reference)
  if (previous && preferredId) return reference
  if (previous) removeEntry(reference)
  entries.set(reference, { blob, objectUrl: objectUrlFor(blob) })
  return reference
}

export function localVideoBlob(reference: string): Blob | null {
  return isLocalVideoReference(reference) ? entries.get(reference)?.blob ?? null : null
}

export function localVideoPreviewUrl(reference: string): string | null {
  return isLocalVideoReference(reference) ? entries.get(reference)?.objectUrl ?? null : null
}

export function materializeLocalVideoHtml(html: string): string {
  if (!html.includes(LOCAL_VIDEO_PROTOCOL)) return html
  return html.replace(
    /(<video\b[^>]*?\bsrc\s*=\s*)(["'])(dispatch-local-video:\/\/[a-z0-9-]+)\2/gi,
    (syntax, prefix: string, quote: string, reference: string) => {
      const objectUrl = localVideoPreviewUrl(reference)
      return objectUrl ? `${prefix}${quote}${objectUrl}${quote}` : syntax
    },
  )
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('本地视频读取失败。'))
    }, { once: true })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('本地视频读取失败。')), { once: true })
    reader.readAsDataURL(blob)
  })
}

export async function expandLocalVideoReferences(value: string): Promise<string> {
  if (!value.includes(LOCAL_VIDEO_PROTOCOL)) return value
  const references = Array.from(new Set(value.match(/dispatch-local-video:\/\/[a-z0-9-]+/gi) ?? []))
  const replacements = await Promise.all(references.map(async reference => {
    const blob = localVideoBlob(reference)
    if (!blob) throw new Error('本地视频数据已失效，请重新选择视频后再导出备份。')
    return [reference, await blobToDataUri(blob)] as const
  }))
  return replacements.reduce((result, [reference, dataUri]) => result.replaceAll(reference, dataUri), value)
}

export function localVideoReferences(values: string[]): Set<string> {
  return new Set(values.flatMap(value => value.match(/dispatch-local-video:\/\/[a-z0-9-]+/gi) ?? []))
}

export function retainLocalVideoReferences(values: string[]): void {
  const retained = localVideoReferences(values)
  Array.from(entries.keys()).forEach(reference => {
    if (!retained.has(reference)) removeEntry(reference)
  })
}

export function clearLocalVideoRegistry(): void {
  Array.from(entries.keys()).forEach(removeEntry)
}
