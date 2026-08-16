import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useDraftAutosave,
  type DraftAutosaveControls,
  type DraftRevision,
} from './use-draft-autosave'

interface TestSnapshot {
  article: { id: string } | null
  value: string
}

interface HarnessProps {
  snapshot: TestSnapshot
  revision: DraftRevision
  persist: (snapshot: TestSnapshot, revision: DraftRevision) => Promise<unknown> | unknown
  enabled?: boolean
  debounceMs?: number
  onControls: (controls: DraftAutosaveControls<TestSnapshot>) => void
}

function Harness(props: HarnessProps) {
  const controls = useDraftAutosave({
    enabled: props.enabled ?? true,
    debounceMs: props.debounceMs,
    persist: props.persist,
    revision: props.revision,
    snapshot: props.snapshot,
  })
  props.onControls(controls)
  return <output data-status={controls.status}>{controls.error?.message}</output>
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useDraftAutosave', () => {
  let container: HTMLDivElement
  let root: Root
  let controls: DraftAutosaveControls<TestSnapshot>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function render(props: Omit<HarnessProps, 'onControls'>, strict = false) {
    const harness = <Harness {...props} onControls={nextControls => { controls = nextControls }} />
    await act(async () => {
      root.render(strict ? <StrictMode>{harness}</StrictMode> : harness)
      await Promise.resolve()
    })
  }

  it('debounces the latest revision once under StrictMode', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const snapshot = { article: { id: 'draft-1' }, value: 'first' }

    await render({ snapshot, revision: 1, persist }, true)
    expect(controls.status).toBe('dirty')

    await act(async () => vi.advanceTimersByTimeAsync(699))
    expect(persist).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(snapshot, 1)
    expect(controls.status).toBe('saved')
  })

  it('does not persist while disabled or without an article', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    await render({
      snapshot: { article: { id: 'draft-1' }, value: 'disabled' },
      revision: 'disabled',
      persist,
      enabled: false,
    })

    await act(async () => {
      await controls.saveNow({ article: { id: 'draft-1' }, value: 'manual' })
      await controls.flush()
      await vi.runAllTimersAsync()
    })
    expect(persist).not.toHaveBeenCalled()
    expect(controls.status).toBe('idle')

    await render({
      snapshot: { article: null, value: 'empty' },
      revision: 'empty',
      persist,
      enabled: true,
    })
    await act(async () => vi.runAllTimersAsync())
    expect(persist).not.toHaveBeenCalled()
  })

  it('runs saves serially and deduplicates the same pending revision', async () => {
    const first = deferred()
    const second = deferred()
    const persist = vi.fn((_: TestSnapshot, revision: DraftRevision) => (
      revision === 1 ? first.promise : second.promise
    ))
    const snapshot1 = { article: { id: 'draft-1' }, value: 'first' }
    const snapshot2 = { article: { id: 'draft-1' }, value: 'second' }
    await render({ snapshot: snapshot1, revision: 1, persist })

    let firstSave!: Promise<void>
    let duplicateSave!: Promise<void>
    let secondSave!: Promise<void>
    await act(async () => {
      firstSave = controls.saveNow(snapshot1, 1)
      duplicateSave = controls.saveNow(snapshot1, 1)
      secondSave = controls.saveNow(snapshot2, 2)
      await Promise.resolve()
    })

    expect(duplicateSave).toBe(firstSave)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenNthCalledWith(1, snapshot1, 1)

    await act(async () => {
      first.resolve()
      await firstSave
      await Promise.resolve()
    })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist).toHaveBeenNthCalledWith(2, snapshot2, 2)

    await act(async () => {
      second.resolve()
      await secondSave
    })
  })

  it('does not let an old response mark a newer revision as saved', async () => {
    const oldSave = deferred()
    const persist = vi.fn((_: TestSnapshot, revision: DraftRevision) => (
      revision === 1 ? oldSave.promise : Promise.resolve()
    ))
    const first = { article: { id: 'draft-1' }, value: 'old' }
    const latest = { article: { id: 'draft-1' }, value: 'latest' }
    await render({ snapshot: first, revision: 1, persist, debounceMs: 50 })

    let firstTask!: Promise<void>
    await act(async () => {
      firstTask = controls.saveNow(first, 1)
      await Promise.resolve()
    })
    await render({ snapshot: latest, revision: 2, persist, debounceMs: 50 })
    expect(controls.status).toBe('dirty')

    await act(async () => {
      oldSave.resolve()
      await firstTask
    })
    expect(controls.status).toBe('dirty')

    await act(async () => vi.advanceTimersByTimeAsync(50))
    expect(persist).toHaveBeenLastCalledWith(latest, 2)
    expect(controls.status).toBe('saved')
  })

  it('flushes immediately and markSaved suppresses redundant persistence', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const snapshot = { article: { id: 'draft-1' }, value: 'flush me' }
    await render({ snapshot, revision: 'r1', persist })

    await act(async () => controls.flush())
    expect(persist).toHaveBeenCalledTimes(1)
    expect(controls.status).toBe('saved')

    const hydrated = { article: { id: 'draft-2' }, value: 'from storage' }
    await act(async () => controls.markSaved(hydrated, 'hydrated'))
    await render({ snapshot: hydrated, revision: 'hydrated', persist })
    await act(async () => vi.runAllTimersAsync())
    expect(persist).toHaveBeenCalledTimes(1)
    expect(controls.status).toBe('saved')
  })

  it('cancel clears timers, skips queued work, and ignores an in-flight response', async () => {
    const inFlight = deferred()
    const persist = vi.fn(() => inFlight.promise)
    const first = { article: { id: 'draft-1' }, value: 'first' }
    const queued = { article: { id: 'draft-1' }, value: 'queued' }
    await render({ snapshot: first, revision: 1, persist, debounceMs: 20 })

    let firstTask!: Promise<void>
    let queuedTask!: Promise<void>
    await act(async () => {
      firstTask = controls.saveNow(first, 1)
      queuedTask = controls.saveNow(queued, 2)
      await Promise.resolve()
    })
    expect(persist).toHaveBeenCalledTimes(1)

    await act(async () => controls.cancel())
    expect(controls.status).toBe('idle')

    await act(async () => {
      inFlight.resolve()
      await firstTask
      await queuedTask
      await vi.runAllTimersAsync()
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(controls.status).toBe('idle')
  })
})
