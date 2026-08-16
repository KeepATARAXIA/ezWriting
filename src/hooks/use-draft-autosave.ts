import { useCallback, useEffect, useRef, useState } from 'react'

export type DraftRevision = string | number

export type DraftAutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface UseDraftAutosaveOptions<T extends { article: { id: string } | null }> {
  snapshot: T
  revision: DraftRevision
  persist: (snapshot: T, revision: DraftRevision) => Promise<unknown> | unknown
  enabled: boolean
  debounceMs?: number
}

export interface DraftAutosaveControls<T extends { article: { id: string } | null }> {
  status: DraftAutosaveStatus
  error: Error | null
  saveNow: (snapshot: T, revision?: DraftRevision) => Promise<void>
  flush: () => Promise<void>
  markSaved: (snapshot?: T, revision?: DraftRevision) => void
  cancel: () => void
}

interface RevisionIdentity {
  articleId: string
  revision: DraftRevision
}

const DEFAULT_DEBOUNCE_MS = 700

function toIdentity<T extends { article: { id: string } | null }>(
  snapshot: T,
  revision: DraftRevision,
): RevisionIdentity | null {
  return snapshot.article ? { articleId: snapshot.article.id, revision } : null
}

function isSameIdentity(left: RevisionIdentity | null, right: RevisionIdentity | null): boolean {
  if (left === null || right === null) return left === right
  return left.articleId === right.articleId && Object.is(left.revision, right.revision)
}

function identityKey(identity: RevisionIdentity): string {
  return `${identity.articleId}\u0000${typeof identity.revision}\u0000${String(identity.revision)}`
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function useDraftAutosave<T extends { article: { id: string } | null }>({
  snapshot,
  revision,
  persist,
  enabled,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseDraftAutosaveOptions<T>): DraftAutosaveControls<T> {
  const [status, setStatus] = useState<DraftAutosaveStatus>('idle')
  const [error, setError] = useState<Error | null>(null)

  const mountedRef = useRef(false)
  const snapshotRef = useRef(snapshot)
  const revisionRef = useRef(revision)
  const persistRef = useRef(persist)
  const enabledRef = useRef(enabled)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)
  const savedIdentityRef = useRef<RevisionIdentity | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingTasksRef = useRef(new Map<string, Promise<void>>())

  snapshotRef.current = snapshot
  revisionRef.current = revision
  persistRef.current = persist
  enabledRef.current = enabled

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const isCurrentIdentity = useCallback((identity: RevisionIdentity) => {
    return isSameIdentity(identity, toIdentity(snapshotRef.current, revisionRef.current))
  }, [])

  const saveNow = useCallback((nextSnapshot: T, nextRevision = revisionRef.current): Promise<void> => {
    const identity = toIdentity(nextSnapshot, nextRevision)
    if (!enabledRef.current || identity === null) return Promise.resolve()

    if (isCurrentIdentity(identity)) clearTimer()
    if (isSameIdentity(identity, savedIdentityRef.current)) return queueRef.current

    const key = identityKey(identity)
    const existingTask = pendingTasksRef.current.get(key)
    if (existingTask) return existingTask

    const taskGeneration = generationRef.current
    let task: Promise<void>
    task = queueRef.current
      .then(async () => {
        if (taskGeneration !== generationRef.current || !enabledRef.current) return
        if (isSameIdentity(identity, savedIdentityRef.current)) return

        if (mountedRef.current && isCurrentIdentity(identity)) {
          setStatus('saving')
          setError(null)
        }

        try {
          await persistRef.current(nextSnapshot, nextRevision)
        } catch (persistError) {
          if (
            mountedRef.current
            && taskGeneration === generationRef.current
            && isCurrentIdentity(identity)
          ) {
            setStatus('error')
            setError(normalizeError(persistError))
          }
          throw persistError
        }

        if (taskGeneration !== generationRef.current) return
        if (isCurrentIdentity(identity)) {
          savedIdentityRef.current = identity
        }
        if (mountedRef.current && isCurrentIdentity(identity)) {
          setStatus('saved')
          setError(null)
        }
      })
      .finally(() => {
        if (pendingTasksRef.current.get(key) === task) {
          pendingTasksRef.current.delete(key)
        }
      })

    pendingTasksRef.current.set(key, task)
    queueRef.current = task.catch(() => undefined)
    return task
  }, [clearTimer, isCurrentIdentity])

  const flush = useCallback(async (): Promise<void> => {
    clearTimer()
    const latestSnapshot = snapshotRef.current
    const latestRevision = revisionRef.current
    const identity = toIdentity(latestSnapshot, latestRevision)

    if (
      enabledRef.current
      && identity !== null
      && !isSameIdentity(identity, savedIdentityRef.current)
    ) {
      await saveNow(latestSnapshot, latestRevision)
      return
    }

    await queueRef.current
  }, [clearTimer, saveNow])

  const markSaved = useCallback((
    savedSnapshot = snapshotRef.current,
    savedRevision = revisionRef.current,
  ) => {
    const identity = toIdentity(savedSnapshot, savedRevision)
    savedIdentityRef.current = identity

    if (isSameIdentity(identity, toIdentity(snapshotRef.current, revisionRef.current))) {
      clearTimer()
      if (mountedRef.current) {
        setStatus(identity === null ? 'idle' : 'saved')
        setError(null)
      }
    }
  }, [clearTimer])

  const cancel = useCallback(() => {
    clearTimer()
    generationRef.current += 1
    pendingTasksRef.current.clear()
    if (mountedRef.current) {
      setStatus('idle')
      setError(null)
    }
  }, [clearTimer])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      generationRef.current += 1
      pendingTasksRef.current.clear()
    }
  }, [clearTimer])

  useEffect(() => {
    clearTimer()

    const identity = toIdentity(snapshotRef.current, revisionRef.current)
    if (!enabled) {
      generationRef.current += 1
      pendingTasksRef.current.clear()
      setStatus('idle')
      setError(null)
      return
    }

    if (identity === null) {
      setStatus('idle')
      setError(null)
      return
    }

    if (isSameIdentity(identity, savedIdentityRef.current)) {
      setStatus('saved')
      setError(null)
      return
    }

    setStatus('dirty')
    setError(null)
    const timerGeneration = generationRef.current
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (timerGeneration !== generationRef.current || !enabledRef.current) return
      void saveNow(snapshotRef.current, revisionRef.current).catch(() => undefined)
    }, Math.max(0, debounceMs))

    return clearTimer
  }, [clearTimer, debounceMs, enabled, revision, saveNow, snapshot.article?.id])

  return { status, error, saveNow, flush, markSaved, cancel }
}
