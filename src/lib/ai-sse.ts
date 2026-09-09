import { AiError } from '../domain/ai'

// Handles UTF-8 and SSE lines split across arbitrary network chunks.
export async function* readSseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', cancel, { once: true })
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let eventSize = 0
  let bytes = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (value) {
        bytes += value.byteLength
        if (bytes > 4 * 1024 * 1024) throw new AiError('too_large')
      }
      buffer += decoder.decode(value, { stream: !done })
      let match: RegExpExecArray | null
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break
        const line = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        eventSize += line.length
        if (eventSize > 128 * 1024) throw new AiError('too_large')
        if (!line) {
          if (data.length) yield data.join('\n')
          data = []; eventSize = 0
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
      }
      if (buffer.length + eventSize > 128 * 1024) throw new AiError('too_large')
      if (done) break
    }
    // An unterminated frame is incomplete, never a successful terminal event.
    if (buffer.trim() || data.length) throw new AiError('interrupted')
  } finally {
    signal?.removeEventListener('abort', cancel)
    // Transport teardown may never settle. Completion and stop must not wait on it.
    cancel()
    reader.releaseLock()
  }
}
