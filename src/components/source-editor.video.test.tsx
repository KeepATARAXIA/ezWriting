import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLocalVideoRegistry } from '../lib/local-video-registry'
import { SourceEditor } from './source-editor'

describe('SourceEditor local video', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    if (!Range.prototype.getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    }
    if (!Range.prototype.getBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
      })
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    clearLocalVideoRegistry()
    vi.restoreAllMocks()
  })

  it('uploads an MP4 into a playable editor card while keeping the saved source expanded', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(<SourceEditor value="正文" language="markdown" onChange={onChange} />))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const input = container.querySelector<HTMLInputElement>('input[accept=".mp4,.webm,video/mp4,video/webm"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['clip'], '产品演示.mp4', { type: 'video/mp4' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 800 })
    })

    const saved = onChange.mock.lastCall?.[0] as string
    expect(saved).toMatch(/<video controls src="dispatch-local-video:\/\/[a-z0-9-]+"/i)
    expect(saved).not.toContain('data:video/')
    expect(saved).toContain('data-ez-video-name="产品演示.mp4"')
    expect(container.querySelector<HTMLVideoElement>('.source-video-widget video')?.src).toMatch(/^(?:blob:|dispatch-local-video:)/)
    expect(container.querySelector('.source-video-widget')?.textContent).toContain('产品演示.mp4')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('data:video/mp4')
  })

  it('shows a clear error for an unsupported video without changing the article', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(<SourceEditor value="正文" language="markdown" onChange={onChange} />))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const input = container.querySelector<HTMLInputElement>('input[accept=".mp4,.webm,video/mp4,video/webm"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['mov'], '演示.mov', { type: 'video/quicktime' })],
    })
    expect(input.files?.[0]?.name).toBe('演示.mov')
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent ?? '').toContain('仅支持 MP4 或 WebM'), { timeout: 500 })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders mixed video and image cards in document order', async () => {
    const value = [
      '<video controls src="data:video/mp4;base64,Y2xpcA==" data-ez-video-name="演示.mp4"></video>',
      '',
      '![封面](data:image/png;base64,aW1hZ2U=)',
    ].join('\n')

    await act(async () => root.render(<SourceEditor value={value} language="markdown" onChange={() => undefined} />))
    await act(async () => new Promise(resolve => window.setTimeout(resolve, 0)))

    const mediaCards = Array.from(container.querySelectorAll('.cm-content figure'))
    expect(mediaCards).toHaveLength(2)
    expect(mediaCards[0]?.classList.contains('source-video-widget')).toBe(true)
    expect(mediaCards[1]?.classList.contains('source-image-widget')).toBe(true)
  })
})
