import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  Columns2,
  FilePlus2,
  FileUp,
  FolderOpen,
  ImagePlus,
  Images,
  Import,
  LoaderCircle,
  PanelLeft,
  PanelLeftOpen,
  PanelRight,
  PlugZap,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react'
import type { ArticleDraft, MissingImageAction, MissingImageTarget, PlatformAccount, PublishResult } from './domain/article'
import { DEFAULT_ARTICLE_FORMATTING, type ArticleFormatting } from './domain/formatting'
import { DispatchControls, type BridgeState, type WorkState } from './components/dispatch-controls'
import { HistorySidebar, type HistoryFilter, type HistoryUndoDraft } from './components/history-sidebar'
import type { SourceEditorFocusRequest } from './components/source-editor'
import type { PreviewDevice, PreviewEditTarget, PreviewLocateRequest, PreviewPlatform } from './components/platform-previews'
import {
  DEFAULT_XHS_CARD_SETTINGS,
  normalizeXhsCardSettings,
  type DraftKind,
  type DraftSummary,
  type PersistedDraft,
  type XhsCardSettings,
} from './domain/saved-draft'
import type { DraftRepository } from './services/draft-repository'
import { LocalDraftRepository } from './services/local-draft-repository'
import {
  createDraftSnapshot,
  persistedDraftFromSnapshot,
  snapshotFromPersistedDraft,
  type DraftWorkspaceSnapshot,
} from './services/draft-workspace'
import { applyArticleFormatting } from './lib/article-formatting'
import {
  annotateLocalImagesAsMissing,
  replaceArticleSourceImage,
  resolveArticleSource,
  sourceLineForBlock,
  updateArticleFromSource,
} from './lib/article-source'
import { applyWechatTheme } from './lib/wechat-theme'
import {
  applyPlatformCompatibility,
  applyPlatformMarkdownCompatibility,
  type PlatformContentTarget,
} from './lib/platform-compatibility'
import { FileParseError, parseContentFile, pickPrimaryContentFile, sanitizeEditedHtml } from './lib/file-parser'
import { extractMissingImageTargets } from './lib/missing-assets'
import { getBrowserExtensionGuide } from './lib/browser-extension-install'
import { getPlatformAccounts, publishDraft, waitForBridge } from './lib/wechatsync-bridge'
import { useDraftAutosave } from './hooks/use-draft-autosave'
import {
  LAST_ACTIVE_DRAFT_SETTING,
  createLocalBackup,
  importLocalBackup,
  localBackupFileName,
  parseLocalBackup,
  requestPersistentLocalStorage,
  serializeLocalBackup,
} from './services/local-backup'
import brandLogo from '../SVG/资源 1.svg'
import wechatLogo from '../SVG/公众号.svg'
import xhsLogo from '../SVG/小红书.svg'
import xLogo from '../SVG/x.svg'

interface ImportContext {
  primary: File
  assets: File[]
}

interface ArticleResource {
  id: string
  src: string
  name: string
  kind: 'cover' | 'body'
  missingTarget?: MissingImageTarget
}

type HydrationPhase = 'loading' | 'ready'
type DraftSourceInfo = PersistedDraft['sourceInfo']

interface CurrentDraftSnapshot {
  article: ArticleDraft | null
  formatting: ArticleFormatting
  kind: DraftKind
  xhsSettings: XhsCardSettings
  sourceInfo: DraftSourceInfo
}

interface AppProps {
  draftRepository?: DraftRepository | null
}

type EditorView = 'edit' | 'resources'
type EditorImportMode = 'append' | 'replace'
type WorkspaceMode = 'editor' | 'split' | 'preview'

const SourceEditor = lazy(() => import('./components/source-editor').then(module => ({ default: module.SourceEditor })))
const PlatformPreviews = lazy(() => import('./components/platform-previews').then(module => ({ default: module.PlatformPreviews })))

const PREVIEW_PLATFORMS: Array<{ id: PreviewPlatform; label: string; accessibleLabel: string; logo: string }> = [
  { id: 'wechat', label: '公众号', accessibleLabel: '微信公众号', logo: wechatLogo },
  { id: 'xhs', label: '小红书', accessibleLabel: '小红书', logo: xhsLogo },
  { id: 'x', label: 'X', accessibleLabel: 'X 长文', logo: xLogo },
]

const DEFAULT_EDITOR_PANE_PERCENT = 55
const MIN_EDITOR_PANE_PERCENT = 32
const MAX_EDITOR_PANE_PERCENT = 68
const EDITOR_PANE_STORAGE_KEY = 'dispatch.editor-pane-percent.v2'
const HISTORY_SIDEBAR_STORAGE_KEY = 'dispatch.history-sidebar-expanded.v1'
const AUTOSAVE_DELAY_MS = 700

let defaultDraftRepository: DraftRepository | null | undefined

function getDefaultDraftRepository(): DraftRepository | null {
  if (defaultDraftRepository !== undefined) return defaultDraftRepository
  try {
    defaultDraftRepository = new LocalDraftRepository()
  } catch {
    defaultDraftRepository = null
  }
  return defaultDraftRepository
}

function clampEditorPanePercent(value: number): number {
  return Math.min(MAX_EDITOR_PANE_PERCENT, Math.max(MIN_EDITOR_PANE_PERCENT, Math.round(value)))
}

function readEditorPanePercent(): number {
  try {
    const saved = Number(window.localStorage.getItem(EDITOR_PANE_STORAGE_KEY))
    return Number.isFinite(saved) && saved > 0 ? clampEditorPanePercent(saved) : DEFAULT_EDITOR_PANE_PERCENT
  } catch {
    return DEFAULT_EDITOR_PANE_PERCENT
  }
}

function saveEditorPanePercent(value: number): void {
  try {
    window.localStorage.setItem(EDITOR_PANE_STORAGE_KEY, String(value))
  } catch {
    // The layout still works when storage is unavailable.
  }
}

function readHistorySidebarExpanded(): boolean {
  try {
    return window.localStorage.getItem(HISTORY_SIDEBAR_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function isHistoryOverlayViewport(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1280px)').matches
}

function sourceLabel(article: ArticleDraft): string {
  if (article.sourceKind === 'blank') return '新建文档'
  if (article.sourceKind === 'markdown') return 'MARKDOWN'
  if (article.sourceKind === 'html') return 'HTML'
  return 'CONTENT ZIP'
}

function accountMatchesPreview(account: PlatformAccount, platform: PreviewPlatform): boolean {
  const rawType = account.raw && typeof account.raw === 'object' && 'type' in account.raw
    ? String((account.raw as { type?: unknown }).type || '')
    : ''
  const id = account.id.toLocaleLowerCase()
  const name = account.name.toLocaleLowerCase()
  const type = rawType.toLocaleLowerCase()

  if (platform === 'wechat') return [id, name, type].some(value => /wechat|weixin|公众号|微信/.test(value))
  if (platform === 'xhs') return [id, name, type].some(value => /xiaohongshu|xhs|redbook|小红书/.test(value))
  return id === 'x' || type === 'x' || [id, name, type].some(value => /twitter|x\.com|推特/.test(value))
}

function getResourceName(source: string, alt: string | null, index: number): string {
  if (alt?.trim()) return alt.trim()
  if (source.startsWith('data:image/')) return `本地图片 ${index + 1}`
  const pathName = source.split(/[?#]/)[0].split('/').pop()
  if (!pathName) return `正文图片 ${index + 1}`
  try {
    return decodeURIComponent(pathName)
  } catch {
    return pathName
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function fileNameForReference(reference: string): string {
  const name = reference.replaceAll('\\', '/').split('/').pop() || reference
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

async function resolveMissingImagesFromFiles(article: ArticleDraft, files: File[]): Promise<ArticleDraft> {
  const filesByName = new Map(files.map(file => [file.name.toLocaleLowerCase(), file]))
  let nextArticle = article

  for (const target of extractMissingImageTargets(article.html)) {
    const file = filesByName.get(fileNameForReference(target.reference).toLocaleLowerCase())
    if (!file) continue
    nextArticle = replaceArticleSourceImage(nextArticle, target.reference, await readFileAsDataUrl(file), file.name)
  }

  return reconcileSourceUpdate(article, nextArticle)
}

function reconcileMissingAssetState(article: ArticleDraft, nextHtml: string, previousHtml = article.html): ArticleDraft {
  const previousBodyReferences = new Set(extractMissingImageTargets(previousHtml).map(target => target.reference))
  const nextBodyReferences = [...new Set(extractMissingImageTargets(nextHtml).map(target => target.reference))]
  const nonBodyMissing = (article.missingAssets || []).filter(reference => !previousBodyReferences.has(reference))
  const nextMissingAssets = [...new Set([...nonBodyMissing, ...nextBodyReferences])]
  const resolvedReferences = [...previousBodyReferences].filter(reference => !nextBodyReferences.includes(reference))
  const addedReferences = nextBodyReferences.filter(reference => !previousBodyReferences.has(reference))
  const nextWarnings = article.warnings
    .filter(warning => !resolvedReferences.some(reference => warning.endsWith(`：${reference}`)))
    .concat(addedReferences.filter(reference => !article.warnings.some(warning => warning.endsWith(`：${reference}`))).map(reference => `未找到图片：${reference}`))

  return { ...article, html: nextHtml, missingAssets: nextMissingAssets, warnings: nextWarnings }
}

function reconcileSourceUpdate(previous: ArticleDraft, next: ArticleDraft): ArticleDraft {
  const annotated = annotateLocalImagesAsMissing(next.html)
  return reconcileMissingAssetState(next, annotated.html, previous.html)
}

function createBlankArticle(): ArticleDraft {
  return {
    id: crypto.randomUUID(),
    title: '',
    html: '<p></p>',
    markdown: '',
    sourceText: '',
    sourceLanguage: 'markdown',
    tags: [],
    sourceFile: '未命名文档',
    sourceKind: 'blank',
    importedAt: new Date().toISOString(),
    warnings: [],
    missingAssets: [],
  }
}

function hasArticleBodyContent(html: string): boolean {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return Boolean(
    document.body.textContent?.trim()
    || document.body.querySelector('img, table, hr, pre, blockquote, ul, ol'),
  )
}

function appendImportedArticle(current: ArticleDraft, imported: ArticleDraft): ArticleDraft {
  const currentSource = resolveArticleSource(current)
  const importedSource = resolveArticleSource(imported)
  const hasCurrentContent = hasArticleBodyContent(current.html)
  const sameLanguage = currentSource.language === importedSource.language
  const combinedSource = hasCurrentContent
    ? sameLanguage
      ? `${currentSource.text.trimEnd()}\n\n${importedSource.text.trimStart()}`
      : sanitizeEditedHtml(`${current.html}${imported.html}`)
    : importedSource.text
  const combinedLanguage = hasCurrentContent && !sameLanguage ? 'html' : importedSource.language
  const base: ArticleDraft = {
    ...current,
    title: current.title.trim() ? current.title : imported.title,
    sourceText: combinedSource,
    sourceLanguage: combinedLanguage,
    markdown: combinedLanguage === 'markdown' ? combinedSource : undefined,
    cover: current.cover || imported.cover,
    summary: current.summary || imported.summary,
    tags: [...new Set([...current.tags, ...imported.tags])],
    warnings: [...new Set([...current.warnings, ...imported.warnings])],
    missingAssets: [...new Set([...(current.missingAssets || []), ...(imported.missingAssets || [])])],
  }
  return reconcileSourceUpdate(current, updateArticleFromSource(base, combinedSource))
}

function analyzeArticleContent(html: string, cover?: string): { characterCount: number; bodyImageCount: number; resources: ArticleResource[] } {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const text = (document.body.textContent || '').replace(/\s+/g, '')
  const bodyResources = Array.from(document.body.querySelectorAll('img')).map((image, index) => {
    const src = image.getAttribute('src') || ''
    const missingId = image.dataset.missingId
    const missingReference = image.dataset.missingAsset
    return {
      id: `body-${index}`,
      src,
      name: getResourceName(src, image.getAttribute('alt'), index),
      kind: 'body' as const,
      missingTarget: missingId && missingReference ? { id: missingId, reference: missingReference } : undefined,
    }
  })
  const resources: ArticleResource[] = cover
    ? [{ id: 'cover', src: cover, name: '随稿封面', kind: 'cover' }, ...bodyResources]
    : bodyResources
  return { characterCount: Array.from(text).length, bodyImageCount: bodyResources.length, resources }
}

function mergeResolvedAssets(current: ArticleDraft, previousHtml: string, nextHtml: string): ArticleDraft {
  const previousDocument = new DOMParser().parseFromString(previousHtml, 'text/html')
  const nextDocument = new DOMParser().parseFromString(nextHtml, 'text/html')
  const previousImages = Array.from(previousDocument.body.querySelectorAll('img'))
  const nextImages = Array.from(nextDocument.body.querySelectorAll('img'))
  let updated = current

  previousImages.forEach((previousImage, index) => {
    const nextImage = nextImages[index]
    const previousSource = previousImage.getAttribute('src') || ''
    const nextSource = nextImage?.getAttribute('src') || ''
    if (!previousSource || !nextSource || previousSource === nextSource) return
    updated = replaceArticleSourceImage(updated, previousSource, nextSource, nextImage.getAttribute('alt') || undefined)
  })

  return reconcileSourceUpdate(current, updated)
}

export function App({ draftRepository: repositoryOverride }: AppProps = {}) {
  const draftRepository = useMemo(
    () => repositoryOverride === undefined ? getDefaultDraftRepository() : repositoryOverride,
    [repositoryOverride],
  )
  const installGuide = useMemo(
    () => getBrowserExtensionGuide(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    [],
  )
  const [article, setArticle] = useState<ArticleDraft | null>(null)
  const [fileInfo, setFileInfo] = useState<DraftSourceInfo>(null)
  const [hydrationPhase, setHydrationPhase] = useState<HydrationPhase>(() => draftRepository ? 'loading' : 'ready')
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [draftKind, setDraftKind] = useState<DraftKind>('longform')
  const [xhsSettings, setXhsSettings] = useState<XhsCardSettings>(() => normalizeXhsCardSettings(DEFAULT_XHS_CARD_SETTINGS))
  const [draftRevision, setDraftRevision] = useState(0)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [historyExpanded, setHistoryExpanded] = useState(readHistorySidebarExpanded)
  const [historyOverlayOpen, setHistoryOverlayOpen] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [undoDraft, setUndoDraft] = useState<HistoryUndoDraft | null>(null)
  const [backupStatus, setBackupStatus] = useState<'idle' | 'exporting' | 'importing'>('idle')
  const [backupNotice, setBackupNotice] = useState<string | null>(null)
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null)
  const [workState, setWorkState] = useState<WorkState>('idle')
  const [bridgeState, setBridgeState] = useState<BridgeState>('checking')
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [isDispatchDrawerOpen, setIsDispatchDrawerOpen] = useState(false)
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [results, setResults] = useState<PublishResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [activePlatform, setActivePlatform] = useState<PreviewPlatform>('wechat')
  const [formatting, setFormatting] = useState<ArticleFormatting>(DEFAULT_ARTICLE_FORMATTING)
  const [editorPanePercent, setEditorPanePercent] = useState(readEditorPanePercent)
  const [editorFocusRequest, setEditorFocusRequest] = useState<SourceEditorFocusRequest | null>(null)
  const [previewLocateRequest, setPreviewLocateRequest] = useState<PreviewLocateRequest | null>(null)
  const [activeEditorBlockIndex, setActiveEditorBlockIndex] = useState<number | null>(null)
  const [editorView, setEditorView] = useState<EditorView>('edit')
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('split')
  const [warningsExpanded, setWarningsExpanded] = useState(false)
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const directoryInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const editorImportInputRef = useRef<HTMLInputElement>(null)
  const editorImportMenuRef = useRef<HTMLDivElement>(null)
  const assetInputRef = useRef<HTMLInputElement>(null)
  const assetDirectoryInputRef = useRef<HTMLInputElement>(null)
  const missingImageInputRef = useRef<HTMLInputElement>(null)
  const pendingMissingImageActionRef = useRef<{ target: MissingImageTarget; action: Exclude<MissingImageAction, 'delete'> } | null>(null)
  const pendingEditorImportModeRef = useRef<EditorImportMode>('append')
  const importContextRef = useRef<ImportContext | null>(null)
  const bridgeRequestRef = useRef(0)
  const editorGridRef = useRef<HTMLDivElement>(null)
  const editorPanePercentRef = useRef(editorPanePercent)
  const paneResizeActiveRef = useRef(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const resourcesPanelRef = useRef<HTMLElement>(null)
  const focusRequestIdRef = useRef(0)
  const previewLocateRequestIdRef = useRef(0)
  const locatedFieldRef = useRef<HTMLElement | null>(null)
  const locatedFieldTimerRef = useRef<number | null>(null)
  const activeDraftRecordRef = useRef<PersistedDraft | null>(null)
  const activeDraftIdRef = useRef<string | null>(null)
  const draftRevisionRef = useRef(0)
  const documentGenerationRef = useRef(0)
  const undoTimerRef = useRef<number | null>(null)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const historySidebarSlotRef = useRef<HTMLDivElement>(null)
  const topbarRef = useRef<HTMLElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const applyPersistedDraftRef = useRef<(draft: PersistedDraft) => void>(() => undefined)

  activeDraftIdRef.current = article?.id ?? null

  const currentDraftSnapshot = useMemo<CurrentDraftSnapshot>(() => ({
    article,
    formatting,
    kind: draftKind,
    xhsSettings,
    sourceInfo: fileInfo,
  }), [article, draftKind, fileInfo, formatting, xhsSettings])

  const markDraftDirty = useCallback(() => {
    draftRevisionRef.current += 1
    setDraftRevision(draftRevisionRef.current)
  }, [])

  const refreshDraftSummaries = useCallback(async () => {
    if (!draftRepository) return []
    const nextDrafts = await draftRepository.listDrafts()
    setDrafts(nextDrafts)
    return nextDrafts
  }, [draftRepository])

  const persistDraftSnapshot = useCallback(async (snapshot: CurrentDraftSnapshot) => {
    if (!draftRepository || !snapshot.article) return
    const current = activeDraftRecordRef.current?.id === snapshot.article.id
      ? activeDraftRecordRef.current
      : await draftRepository.getDraft(snapshot.article.id)
    const saved = await draftRepository.saveDraft(persistedDraftFromSnapshot(snapshot as DraftWorkspaceSnapshot, current))
    if (activeDraftIdRef.current === saved.id) {
      activeDraftRecordRef.current = saved
      await draftRepository.putSetting(LAST_ACTIVE_DRAFT_SETTING, saved.id)
    }
    await refreshDraftSummaries()
  }, [draftRepository, refreshDraftSummaries])

  const autosave = useDraftAutosave({
    snapshot: currentDraftSnapshot,
    revision: draftRevision,
    persist: persistDraftSnapshot,
    enabled: hydrationPhase === 'ready' && Boolean(draftRepository),
    debounceMs: AUTOSAVE_DELAY_MS,
  })

  const closeHistoryOverlay = useCallback((restoreFocus = true) => {
    setHistoryOverlayOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => historyTriggerRef.current?.focus())
  }, [])

  const toggleHistorySidebar = useCallback(() => {
    if (historyOverlayOpen || isHistoryOverlayViewport()) {
      if (historyOverlayOpen) closeHistoryOverlay()
      else setHistoryOverlayOpen(true)
      return
    }
    setHistoryExpanded(current => !current)
  }, [closeHistoryOverlay, historyOverlayOpen])

  useEffect(() => {
    let cancelled = false
    void requestPersistentLocalStorage().then(persistent => {
      if (!cancelled) setStoragePersistent(persistent)
    }).catch(() => {
      if (!cancelled) setStoragePersistent(null)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_SIDEBAR_STORAGE_KEY, String(historyExpanded))
    } catch {
      // The sidebar remains usable when localStorage is unavailable.
    }
  }, [historyExpanded])

  useEffect(() => {
    if (!historyOverlayOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    topbarRef.current?.setAttribute('inert', '')
    workspaceRef.current?.setAttribute('inert', '')
    window.requestAnimationFrame(() => {
      historySidebarSlotRef.current?.querySelector<HTMLButtonElement>('.history-collapse-button')?.focus()
    })
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeHistoryOverlay()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      topbarRef.current?.removeAttribute('inert')
      workspaceRef.current?.removeAttribute('inert')
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [closeHistoryOverlay, historyOverlayOpen])

  const applyPersistedDraft = useCallback((persisted: PersistedDraft) => {
    const restored = snapshotFromPersistedDraft(persisted)
    const snapshot: CurrentDraftSnapshot = {
      ...restored,
      article: {
        ...restored.article,
        html: sanitizeEditedHtml(restored.article.html),
        tags: Array.isArray(restored.article.tags) ? restored.article.tags : [],
        warnings: Array.isArray(restored.article.warnings) ? restored.article.warnings : [],
        missingAssets: Array.isArray(restored.article.missingAssets) ? restored.article.missingAssets : [],
      },
    }
    documentGenerationRef.current += 1
    draftRevisionRef.current += 1
    activeDraftRecordRef.current = persisted
    activeDraftIdRef.current = persisted.id
    autosave.markSaved(snapshot, draftRevisionRef.current)
    setDraftRevision(draftRevisionRef.current)
    setArticle(snapshot.article)
    setFormatting(snapshot.formatting)
    setDraftKind(snapshot.kind)
    setXhsSettings(snapshot.xhsSettings)
    setFileInfo(snapshot.sourceInfo)
    setWorkState('ready')
    setResults([])
    setError(null)
    setEditorFocusRequest(null)
    setEditorView('edit')
    setPreviewDevice('desktop')
    setWarningsExpanded(false)
    setIsImportMenuOpen(false)
    importContextRef.current = null
  }, [autosave.markSaved])
  applyPersistedDraftRef.current = applyPersistedDraft

  const activateNewDraft = useCallback((snapshot: DraftWorkspaceSnapshot) => {
    documentGenerationRef.current += 1
    draftRevisionRef.current += 1
    activeDraftRecordRef.current = null
    activeDraftIdRef.current = snapshot.article.id
    setDraftRevision(draftRevisionRef.current)
    setArticle(snapshot.article)
    setFormatting(snapshot.formatting)
    setDraftKind(snapshot.kind)
    setXhsSettings(snapshot.xhsSettings)
    setFileInfo(snapshot.sourceInfo)
    setWorkState('ready')
    setActivePlatform('wechat')
    setResults([])
    setError(null)
    setEditorFocusRequest(null)
    setEditorView('edit')
    setPreviewDevice('desktop')
    setWorkspaceMode('split')
    setWarningsExpanded(false)
    setIsImportMenuOpen(false)
    importContextRef.current = null
    void autosave.saveNow(snapshot, draftRevisionRef.current).catch(saveError => {
      setHistoryError(`本地保存失败：${(saveError as Error).message}`)
    })
  }, [autosave.saveNow])

  const clearActiveDraft = useCallback(() => {
    documentGenerationRef.current += 1
    autosave.cancel()
    activeDraftRecordRef.current = null
    activeDraftIdRef.current = null
    draftRevisionRef.current += 1
    const emptySnapshot: CurrentDraftSnapshot = {
      article: null,
      formatting: { ...DEFAULT_ARTICLE_FORMATTING },
      kind: 'longform',
      xhsSettings: normalizeXhsCardSettings(DEFAULT_XHS_CARD_SETTINGS),
      sourceInfo: null,
    }
    autosave.markSaved(emptySnapshot, draftRevisionRef.current)
    setDraftRevision(draftRevisionRef.current)
    setArticle(null)
    setFileInfo(null)
    setResults([])
    setError(null)
    setWorkState('idle')
    setActivePlatform('wechat')
    setFormatting(emptySnapshot.formatting)
    setDraftKind(emptySnapshot.kind)
    setXhsSettings(emptySnapshot.xhsSettings)
    setEditorFocusRequest(null)
    setPreviewLocateRequest(null)
    setActiveEditorBlockIndex(null)
    setEditorView('edit')
    setPreviewDevice('desktop')
    setWorkspaceMode('split')
    setWarningsExpanded(false)
    setIsImportMenuOpen(false)
    importContextRef.current = null
  }, [autosave.cancel, autosave.markSaved])

  useEffect(() => {
    let cancelled = false
    if (!draftRepository) {
      setHydrationPhase('ready')
      return
    }

    setHydrationPhase('loading')
    setHistoryError(null)
    void (async () => {
      try {
        const [nextDrafts, lastActiveId] = await Promise.all([
          draftRepository.listDrafts(),
          draftRepository.getSetting<string>(LAST_ACTIVE_DRAFT_SETTING),
        ])
        let persisted = lastActiveId ? await draftRepository.getDraft(lastActiveId) : null
        if (persisted?.deletedAt) persisted = null
        if (!persisted && nextDrafts[0]) persisted = await draftRepository.getDraft(nextDrafts[0].id)
        if (cancelled) return
        setDrafts(nextDrafts)
        if (persisted) applyPersistedDraft(persisted)
      } catch (loadError) {
        if (cancelled) return
        setHistoryError(`本地历史暂不可用：${(loadError as Error).message}`)
      } finally {
        if (!cancelled) setHydrationPhase('ready')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyPersistedDraft, draftRepository])

  useEffect(() => {
    const flushOnPageExit = () => {
      void autosave.flush().catch(() => undefined)
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushOnPageExit()
    }
    window.addEventListener('pagehide', flushOnPageExit)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushOnPageExit)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [autosave.flush])

  const refreshBridge = useCallback(async () => {
    const requestId = ++bridgeRequestRef.current
    setBridgeState('checking')
    setBridgeError(null)
    try {
      const available = await waitForBridge()
      if (requestId !== bridgeRequestRef.current) return
      if (!available) {
        setAccounts([])
        setBridgeState('missing')
        return
      }
      const nextAccounts = await getPlatformAccounts()
      if (requestId !== bridgeRequestRef.current) return
      setAccounts(nextAccounts)
      setSelectedIds(current => current.filter(id => nextAccounts.some(account => account.id === id)))
      setBridgeState('connected')
    } catch (bridgeError) {
      if (requestId !== bridgeRequestRef.current) return
      setBridgeState('error')
      setBridgeError((bridgeError as Error).message)
    }
  }, [])

  useEffect(() => {
    void refreshBridge()
  }, [refreshBridge])

  useEffect(() => () => {
    document.body.classList.remove('is-resizing-panes')
    if (locatedFieldTimerRef.current !== null) window.clearTimeout(locatedFieldTimerRef.current)
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    locatedFieldRef.current?.classList.remove('editor-located-target')
  }, [])

  useEffect(() => {
    const reconnectOnReturn = () => {
      if (bridgeState !== 'connected' && workState !== 'publishing') void refreshBridge()
    }
    window.addEventListener('focus', reconnectOnReturn)
    return () => window.removeEventListener('focus', reconnectOnReturn)
  }, [bridgeState, refreshBridge, workState])

  useEffect(() => {
    if (!isImportMenuOpen) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!editorImportMenuRef.current?.contains(event.target as Node)) setIsImportMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsImportMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isImportMenuOpen])

  const importFile = async (file?: File, relatedFiles: File[] = []) => {
    if (!file) return
    const operationGeneration = ++documentGenerationRef.current
    setError(null)
    setResults([])
    setEditorFocusRequest(null)
    setPreviewLocateRequest(null)
    setActiveEditorBlockIndex(null)
    setWarningsExpanded(false)
    setWorkspaceMode('split')
    setWorkState('parsing')
    const assetFiles = relatedFiles.filter(related => related !== file)
    importContextRef.current = { primary: file, assets: assetFiles }
    const sourceInfo = {
      name: file.name,
      size: file.size + assetFiles.reduce((total, asset) => total + asset.size, 0),
      assetCount: assetFiles.filter(asset => asset.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(asset.name)).length,
    }
    setFileInfo(sourceInfo)
    try {
      const parsed = await parseContentFile(file, assetFiles)
      if (operationGeneration !== documentGenerationRef.current) return
      activateNewDraft(createDraftSnapshot(parsed, sourceInfo))
      importContextRef.current = { primary: file, assets: assetFiles }
    } catch (parseError) {
      if (operationGeneration !== documentGenerationRef.current) return
      clearActiveDraft()
      setWorkState('idle')
      setError(parseError instanceof FileParseError ? parseError.message : '文件解析失败，请检查内容包后重试。')
    }
  }

  const importSelection = async (files: File[]) => {
    if (!files.length) return
    try {
      const primary = pickPrimaryContentFile(files)
      await importFile(primary, files.filter(file => file !== primary))
    } catch (selectionError) {
      setError(selectionError instanceof FileParseError ? selectionError.message : '没有找到可导入的文章文件。')
    }
  }

  const createNewArticle = async () => {
    try {
      await autosave.flush()
    } catch (saveError) {
      setHistoryError(`新建前保存失败：${(saveError as Error).message}`)
      return
    }
    activateNewDraft(createDraftSnapshot(createBlankArticle()))
  }

  const exportLocalData = async () => {
    if (!draftRepository || backupStatus !== 'idle') return
    setBackupStatus('exporting')
    setBackupNotice(null)
    setHistoryError(null)
    try {
      await autosave.flush()
      const payload = await createLocalBackup(draftRepository)
      const url = URL.createObjectURL(serializeLocalBackup(payload))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = localBackupFileName()
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setBackupNotice(`已导出 ${payload.drafts.length} 篇稿件及其本地图片。`)
    } catch (backupError) {
      setHistoryError(`导出备份失败：${(backupError as Error).message}`)
    } finally {
      setBackupStatus('idle')
    }
  }

  const importLocalData = async (file?: File) => {
    if (!file || !draftRepository || backupStatus !== 'idle') return
    setBackupStatus('importing')
    setBackupNotice(null)
    setHistoryError(null)
    try {
      const payload = await parseLocalBackup(file)
      const existingIds = new Set((await draftRepository.listDrafts({ includeDeleted: true })).map(draft => draft.id))
      const replacements = payload.drafts.filter(draft => existingIds.has(draft.id)).length
      if (replacements > 0 && !window.confirm(`备份中有 ${replacements} 篇稿件与本机记录相同。继续导入会用备份版本覆盖这些稿件，是否继续？`)) return
      await autosave.flush()
      const result = await importLocalBackup(draftRepository, payload)
      const nextDrafts = await refreshDraftSummaries()
      const preferredId = result.activeDraftId || nextDrafts[0]?.id || null
      const preferred = preferredId ? await draftRepository.getDraft(preferredId) : null
      if (preferred && !preferred.deletedAt) applyPersistedDraft(preferred)
      setBackupNotice(`已导入 ${result.draftCount} 篇稿件；相同稿件已使用备份版本。`)
    } catch (backupError) {
      setHistoryError(`导入备份失败：${(backupError as Error).message}`)
    } finally {
      setBackupStatus('idle')
      if (backupInputRef.current) backupInputRef.current.value = ''
    }
  }

  const requestEditorImport = (mode: EditorImportMode) => {
    pendingEditorImportModeRef.current = mode
    setIsImportMenuOpen(false)
    if (editorImportInputRef.current) {
      editorImportInputRef.current.value = ''
      editorImportInputRef.current.click()
    }
  }

  const importIntoEditor = async (file?: File) => {
    if (!file) return
    const mode = pendingEditorImportModeRef.current
    const targetDraftId = activeDraftIdRef.current
    const operationGeneration = documentGenerationRef.current
    setError(null)
    setResults([])
    setEditorFocusRequest(null)
    setPreviewLocateRequest(null)
    setActiveEditorBlockIndex(null)
    setWarningsExpanded(false)
    setWorkState('parsing')

    try {
      const parsed = await parseContentFile(file)
      if (operationGeneration !== documentGenerationRef.current || activeDraftIdRef.current !== targetDraftId) return
      setArticle(current => {
        if (!current) return parsed
        if (mode === 'replace') return { ...parsed, id: current.id, importedAt: current.importedAt }
        return appendImportedArticle(current, parsed)
      })
      importContextRef.current = { primary: file, assets: [] }
      if (mode === 'replace') {
        setFileInfo({ name: file.name, size: file.size, assetCount: 0 })
      }
      setEditorView('edit')
      setWorkState('ready')
      markDraftDirty()
    } catch (parseError) {
      setWorkState('ready')
      setError(parseError instanceof FileParseError ? parseError.message : '文件解析失败，当前内容已保留。')
    }
  }

  const supplementAssets = async (files: File[]) => {
    const context = importContextRef.current
    if (!files.length) return
    if (!context) {
      const currentArticle = article
      if (!currentArticle) return
      const operationGeneration = documentGenerationRef.current
      setError(null)
      setResults([])
      setWorkState('parsing')
      try {
        const resolved = await resolveMissingImagesFromFiles(currentArticle, files)
        if (operationGeneration !== documentGenerationRef.current || activeDraftIdRef.current !== currentArticle.id) return
        setArticle(resolved)
        markDraftDirty()
        setWorkState('ready')
      } catch {
        setWorkState('ready')
        setError('图片补齐失败，请检查所选文件后重试。')
      }
      return
    }
    const known = new Map(context.assets.map(file => [file.webkitRelativePath || `${file.name}:${file.size}:${file.lastModified}`, file]))
    files.forEach(file => known.set(file.webkitRelativePath || `${file.name}:${file.size}:${file.lastModified}`, file))
    const nextAssets = [...known.values()]
    const targetDraftId = activeDraftIdRef.current
    const operationGeneration = documentGenerationRef.current
    setError(null)
    setResults([])
    setWorkState('parsing')
    try {
      const [previousParsed, nextParsed] = await Promise.all([
        parseContentFile(context.primary, context.assets),
        parseContentFile(context.primary, nextAssets),
      ])
      if (operationGeneration !== documentGenerationRef.current || activeDraftIdRef.current !== targetDraftId) return
      setArticle(current => {
        if (!current) return nextParsed
        return {
          ...mergeResolvedAssets(current, previousParsed.html, nextParsed.html),
          title: current.title,
          cover: nextParsed.cover || current.cover,
        }
      })
      markDraftDirty()
      importContextRef.current = { primary: context.primary, assets: nextAssets }
      setFileInfo({
        name: context.primary.name,
        size: context.primary.size + nextAssets.reduce((total, asset) => total + asset.size, 0),
        assetCount: nextAssets.filter(asset => asset.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(asset.name)).length,
      })
      setWorkState('ready')
    } catch (parseError) {
      setWorkState('ready')
      setError(parseError instanceof FileParseError ? parseError.message : '图片补齐失败，请检查所选文件后重试。')
    }
  }

  const requestMissingImageAction = (target: MissingImageTarget, action: MissingImageAction) => {
    setError(null)
    if (action === 'delete') {
      setArticle(current => current
        ? reconcileSourceUpdate(current, replaceArticleSourceImage(current, target.reference, null))
        : current)
      markDraftDirty()
      return
    }

    pendingMissingImageActionRef.current = { target, action }
    if (missingImageInputRef.current) {
      missingImageInputRef.current.value = ''
      missingImageInputRef.current.click()
    }
  }

  const applyMissingImageFile = async (file?: File) => {
    const pending = pendingMissingImageActionRef.current
    pendingMissingImageActionRef.current = null
    if (!file || !pending) return
    const targetDraftId = activeDraftIdRef.current
    const operationGeneration = documentGenerationRef.current

    if (pending.action === 'relink' && file.name.toLocaleLowerCase() !== fileNameForReference(pending.target.reference).toLocaleLowerCase()) {
      setError(`重新链接需要选择“${fileNameForReference(pending.target.reference)}”；如需使用其他图片，请选择“替换图片”。`)
      return
    }

    try {
      const source = await readFileAsDataUrl(file)
      if (operationGeneration !== documentGenerationRef.current || activeDraftIdRef.current !== targetDraftId) return
      setArticle(current => current
        ? reconcileSourceUpdate(current, replaceArticleSourceImage(current, pending.target.reference, source, file.name))
        : current)
      markDraftDirty()
    } catch {
      setError('图片读取失败，请重新选择。')
    }
  }

  const togglePlatform = (id: string) => {
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  const updateEditorPanePercent = (value: number, persist = false) => {
    const next = clampEditorPanePercent(value)
    editorPanePercentRef.current = next
    setEditorPanePercent(next)
    if (persist) saveEditorPanePercent(next)
  }

  const resizeEditorPane = (clientX: number) => {
    const grid = editorGridRef.current
    if (!grid) return
    const bounds = grid.getBoundingClientRect()
    if (!bounds.width) return
    updateEditorPanePercent(((clientX - bounds.left) / bounds.width) * 100)
  }

  const startPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    paneResizeActiveRef.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing-panes')
    resizeEditorPane(event.clientX)
  }

  const movePaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!paneResizeActiveRef.current) return
    resizeEditorPane(event.clientX)
  }

  const finishPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!paneResizeActiveRef.current) return
    paneResizeActiveRef.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('is-resizing-panes')
    saveEditorPanePercent(editorPanePercentRef.current)
  }

  const adjustPaneWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next = editorPanePercentRef.current
    if (event.key === 'ArrowLeft') next -= 2
    else if (event.key === 'ArrowRight') next += 2
    else if (event.key === 'Home') next = MIN_EDITOR_PANE_PERCENT
    else if (event.key === 'End') next = MAX_EDITOR_PANE_PERCENT
    else return
    event.preventDefault()
    updateEditorPanePercent(next, true)
  }

  const locateEditorField = (element: HTMLElement | null, focusTarget?: HTMLElement | null) => {
    if (!element) return
    if (locatedFieldTimerRef.current !== null) window.clearTimeout(locatedFieldTimerRef.current)
    locatedFieldRef.current?.classList.remove('editor-located-target')
    locatedFieldRef.current = element
    element.classList.add('editor-located-target')
    element.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    focusTarget?.focus()
    locatedFieldTimerRef.current = window.setTimeout(() => {
      element.classList.remove('editor-located-target')
      if (locatedFieldRef.current === element) locatedFieldRef.current = null
      locatedFieldTimerRef.current = null
    }, 2000)
  }

  const editPreviewTarget = (target: PreviewEditTarget) => {
    if (target.kind === 'title') {
      locateEditorField(titleInputRef.current, titleInputRef.current)
      return
    }
    if (target.kind === 'cover') {
      setEditorView('resources')
      window.requestAnimationFrame(() => {
        const coverResource = resourcesPanelRef.current?.querySelector<HTMLElement>('[data-resource-kind="cover"]')
        locateEditorField(coverResource || resourcesPanelRef.current)
      })
      return
    }
    if (!article) return
    const source = resolveArticleSource(article)
    focusRequestIdRef.current += 1
    setEditorFocusRequest({
      line: target.line ?? sourceLineForBlock(source.text, source.language, target.blockIndex),
      requestId: focusRequestIdRef.current,
    })
  }

  const previewCurrentEditorBlock = () => {
    if (activeEditorBlockIndex === null) return
    setWorkspaceMode('split')
    setPreviewDevice('desktop')
    previewLocateRequestIdRef.current += 1
    setPreviewLocateRequest({
      blockIndex: activeEditorBlockIndex,
      requestId: previewLocateRequestIdRef.current,
    })
  }

  const updateArticleTitle = (title: string) => {
    setArticle(current => current ? { ...current, title } : current)
    markDraftDirty()
  }

  const updateArticleSource = (sourceText: string) => {
    startTransition(() => {
      setArticle(current => current
        ? reconcileSourceUpdate(current, updateArticleFromSource(current, sourceText))
        : current)
      markDraftDirty()
    })
  }

  const updateArticleFormatting = (nextFormatting: ArticleFormatting) => {
    setFormatting(nextFormatting)
    markDraftDirty()
  }

  const updateXhsCardSettings = (nextSettings: XhsCardSettings) => {
    setXhsSettings(nextSettings)
    markDraftDirty()
  }

  const selectHistoryDraft = async (id: string) => {
    if (!draftRepository || isPublishing || id === activeDraftIdRef.current) {
      closeHistoryOverlay(false)
      return
    }
    const operationGeneration = ++documentGenerationRef.current
    setWorkState('parsing')
    setHistoryError(null)
    try {
      await autosave.flush()
      const persisted = await draftRepository.getDraft(id)
      if (operationGeneration !== documentGenerationRef.current) return
      if (!persisted || persisted.deletedAt) throw new Error('这篇稿件已不存在。')
      applyPersistedDraft(persisted)
      await draftRepository.putSetting(LAST_ACTIVE_DRAFT_SETTING, id)
      closeHistoryOverlay(false)
    } catch (switchError) {
      if (operationGeneration !== documentGenerationRef.current) return
      setWorkState(article ? 'ready' : 'idle')
      setHistoryError(`无法打开稿件：${(switchError as Error).message}`)
    }
  }

  const changeHistoryDraftKind = async (id: string, kind: DraftKind) => {
    if (!draftRepository) return
    setHistoryError(null)
    if (id === activeDraftIdRef.current) {
      setDraftKind(kind)
      markDraftDirty()
      return
    }
    try {
      const persisted = await draftRepository.getDraft(id)
      if (!persisted || persisted.deletedAt) return
      await draftRepository.saveDraft({ ...persisted, kind })
      await refreshDraftSummaries()
    } catch (kindError) {
      setHistoryError(`类型修改失败：${(kindError as Error).message}`)
    }
  }

  const deleteHistoryDraft = async (id: string) => {
    if (!draftRepository || isPublishing) return
    const summary = drafts.find(draft => draft.id === id)
    const deletingActiveDraft = id === activeDraftIdRef.current
    setHistoryError(null)
    if (deletingActiveDraft) {
      documentGenerationRef.current += 1
      autosave.cancel()
    }
    try {
      const deleted = await draftRepository.softDeleteDraft(id)
      if (!deleted) return
      setUndoDraft({ id, title: summary?.title || deleted.article.title })
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = window.setTimeout(() => setUndoDraft(null), 7000)
      const nextDrafts = await refreshDraftSummaries()
      if (deletingActiveDraft) {
        clearActiveDraft()
        const next = nextDrafts[0] ? await draftRepository.getDraft(nextDrafts[0].id) : null
        if (next && !next.deletedAt) {
          applyPersistedDraft(next)
          await draftRepository.putSetting(LAST_ACTIVE_DRAFT_SETTING, next.id)
        } else {
          await draftRepository.deleteSetting(LAST_ACTIVE_DRAFT_SETTING)
        }
      }
    } catch (deleteError) {
      setHistoryError(`删除失败：${(deleteError as Error).message}`)
    }
  }

  const undoDeleteHistoryDraft = async (id: string) => {
    if (!draftRepository) return
    setHistoryError(null)
    try {
      await draftRepository.restoreDraft(id)
      await refreshDraftSummaries()
      setUndoDraft(null)
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    } catch (restoreError) {
      setHistoryError(`撤销删除失败：${(restoreError as Error).message}`)
    }
  }

  const handlePublish = async () => {
    if (!article || selectedIds.length === 0 || bridgeState !== 'connected') return
    const selectedAccounts = accounts.filter(account => selectedIds.includes(account.id))
    const sanitizedHtml = sanitizeEditedHtml(article.html)
    const normalizedArticle = { ...article, html: sanitizedHtml }
    const formattedHtml = applyArticleFormatting(sanitizedHtml, formatting)
    const targetForAccount = (account: PlatformAccount): PlatformContentTarget => {
      if (accountMatchesPreview(account, 'wechat')) return 'wechat'
      if (accountMatchesPreview(account, 'xhs')) return 'xhs'
      if (accountMatchesPreview(account, 'x')) return 'x'
      return 'generic'
    }
    const buildPlatformArticle = (target: PlatformContentTarget): ArticleDraft => {
      const themedHtml = target === 'wechat'
        ? applyWechatTheme(formattedHtml, formatting.wechat, formatting)
        : formattedHtml
      return {
        ...normalizedArticle,
        html: applyPlatformCompatibility(themedHtml, target),
        markdown: applyPlatformMarkdownCompatibility(normalizedArticle.markdown, target),
      }
    }
    const groups = (['wechat', 'xhs', 'x', 'generic'] as const)
      .map(target => ({
        target,
        accounts: selectedAccounts.filter(account => targetForAccount(account) === target),
      }))
      .filter(group => group.accounts.length > 0)
      .map(group => ({
        accounts: group.accounts,
        article: buildPlatformArticle(group.target),
      }))
    setArticle(normalizedArticle)
    if (normalizedArticle.html !== article.html) markDraftDirty()
    setWorkState('publishing')
    setError(null)
    try {
      const resultsByPlatform = new Map<string, PublishResult>()
      const updateGroupResults = (groupResults: PublishResult[]) => {
        groupResults.forEach(result => resultsByPlatform.set(result.platform, result))
        setResults(selectedAccounts.map(account => resultsByPlatform.get(account.id) ?? {
          platform: account.id,
          name: account.name,
          status: 'pending' as const,
          delivery: account.id === 'zip-download' ? 'download' as const : 'draft' as const,
          message: '等待扩展处理',
        }))
      }
      for (const group of groups) {
        const groupResults = await publishDraft(group.article, group.accounts, updateGroupResults)
        groupResults.forEach(result => resultsByPlatform.set(result.platform, result))
      }
      const finalResults = selectedAccounts.map(account => resultsByPlatform.get(account.id)).filter((result): result is PublishResult => Boolean(result))
      setResults(finalResults)
      setWorkState('completed')
    } catch (publishError) {
      setWorkState('ready')
      setError((publishError as Error).message)
    }
  }

  const handleBridgeStatusClick = () => {
    if (bridgeState === 'missing' || bridgeState === 'error') {
      setIsDispatchDrawerOpen(true)
      return
    }
    void refreshBridge()
  }

  const isPublishing = workState === 'publishing'
  const articleHtml = article?.html ?? ''
  const deferredArticleHtml = useDeferredValue(articleHtml)
  const deferredFormatting = useDeferredValue(formatting)
  const isPreviewUpdating = deferredArticleHtml !== articleHtml || deferredFormatting !== formatting
  const previewHtml = useMemo(
    () => deferredArticleHtml
      ? applyArticleFormatting(sanitizeEditedHtml(deferredArticleHtml), deferredFormatting)
      : '',
    [deferredArticleHtml, deferredFormatting],
  )
  const articleSource = useMemo(
    () => article ? resolveArticleSource(article) : null,
    [article?.html, article?.markdown, article?.sourceLanguage, article?.sourceText],
  )
  const articleContent = useMemo(
    () => article ? analyzeArticleContent(article.html, article.cover) : { characterCount: 0, bodyImageCount: 0, resources: [] },
    [article?.cover, article?.html],
  )
  const previewAccount = useMemo(
    () => accounts.find(account => accountMatchesPreview(account, activePlatform)),
    [accounts, activePlatform],
  )

  return (
    <div className="app-shell article-open">
      <header ref={topbarRef} className={`topbar ${article ? 'workbench-topbar' : ''}`}>
        <a className="brand" href="/" aria-label="EZWRITING 首页">
          <span className="brand-mark" aria-hidden="true"><img src={brandLogo} alt="" /></span>
          <span>EZWRITING</span>
        </a>
        {article ? (
          <div className="topbar-workbench">
            <div className="workbench-navigation">
              <button
                type="button"
                className="new-document-button"
                aria-label="新建文档"
                onClick={() => void createNewArticle()}
                disabled={workState === 'parsing' || isPublishing}
                title="保存当前稿件并新建文档"
              >
                <FilePlus2 size={16} />
                <span>新建</span>
              </button>

              <div className="workspace-mode-switcher" role="group" aria-label="工作区显示方式">
                <button
                  type="button"
                  className={workspaceMode === 'editor' ? 'active' : ''}
                  aria-pressed={workspaceMode === 'editor'}
                  aria-label="仅显示编辑端"
                  title="仅显示编辑端"
                  onClick={() => setWorkspaceMode('editor')}
                ><PanelLeft size={17} /></button>
                <button
                  type="button"
                  className={workspaceMode === 'split' ? 'active' : ''}
                  aria-pressed={workspaceMode === 'split'}
                  aria-label="同时显示编辑端和预览端"
                  title="同时显示编辑端和预览端"
                  onClick={() => setWorkspaceMode('split')}
                ><Columns2 size={17} /></button>
                <button
                  type="button"
                  className={workspaceMode === 'preview' ? 'active' : ''}
                  aria-pressed={workspaceMode === 'preview'}
                  aria-label="仅显示预览端"
                  title="仅显示预览端"
                  onClick={() => setWorkspaceMode('preview')}
                ><PanelRight size={17} /></button>
              </div>

              <span className="workbench-navigation-divider" aria-hidden="true" />

              <div className="platform-switcher" role="tablist" aria-label="选择预览平台">
                {PREVIEW_PLATFORMS.map(platform => (
                  <button
                    type="button"
                    role="tab"
                    key={platform.id}
                    aria-label={platform.accessibleLabel}
                    aria-selected={activePlatform === platform.id}
                    aria-controls="platform-preview-panel"
                    className={activePlatform === platform.id ? 'active' : ''}
                    onClick={() => setActivePlatform(platform.id)}
                  >
                    <span className={`platform-logo ${platform.id}`} aria-hidden="true"><img src={platform.logo} alt="" /></span>
                    <strong>{platform.label}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div className="workbench-actions">
              <button
                type="button"
                className={`extension-chip ${bridgeState}`}
                onClick={handleBridgeStatusClick}
                disabled={bridgeState === 'checking' || isPublishing}
                aria-label={bridgeState === 'missing' || bridgeState === 'error' ? '打开发布引擎安装指引' : '重新检测发布引擎'}
                aria-expanded={bridgeState === 'missing' || bridgeState === 'error' ? isDispatchDrawerOpen : undefined}
                aria-haspopup={bridgeState === 'missing' || bridgeState === 'error' ? 'dialog' : undefined}
                aria-live="polite"
              >
                {bridgeState === 'checking' && <LoaderCircle className="spin" size={15} />}
                {bridgeState === 'connected' && <PlugZap size={15} />}
                {(bridgeState === 'missing' || bridgeState === 'error') && <CircleAlert size={15} />}
                {bridgeState === 'checking' ? '正在连接发布引擎' : bridgeState === 'connected' ? `引擎已就绪 · ${accounts.length} 平台` : bridgeState === 'error' ? '引擎连接异常' : '引擎待连接'}
              </button>

              <DispatchControls
                accounts={accounts}
                bridgeError={bridgeError}
                bridgeState={bridgeState}
                hasArticle
                installGuide={installGuide}
                isOpen={isDispatchDrawerOpen}
                results={results}
                selectedIds={selectedIds}
                workState={workState}
                onOpenChange={setIsDispatchDrawerOpen}
                onPublish={() => void handlePublish()}
                onRefresh={() => void refreshBridge()}
                onTogglePlatform={togglePlatform}
              />
            </div>
            <input
              ref={missingImageInputRef}
              className="missing-image-file-input"
              type="file"
              accept="image/*"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                void applyMissingImageFile(file)
                event.target.value = ''
              }}
            />
          </div>
        ) : (
          <div className="topbar-meta">
            <button
              type="button"
              className={`extension-chip ${bridgeState}`}
              onClick={handleBridgeStatusClick}
              disabled={bridgeState === 'checking' || isPublishing}
              aria-label={bridgeState === 'missing' || bridgeState === 'error' ? '打开发布引擎安装指引' : '重新检测发布引擎'}
              aria-expanded={bridgeState === 'missing' || bridgeState === 'error' ? isDispatchDrawerOpen : undefined}
              aria-haspopup={bridgeState === 'missing' || bridgeState === 'error' ? 'dialog' : undefined}
              aria-live="polite"
            >
              {bridgeState === 'checking' && <LoaderCircle className="spin" size={14} />}
              {bridgeState === 'connected' && <PlugZap size={14} />}
              {(bridgeState === 'missing' || bridgeState === 'error') && <CircleAlert size={14} />}
              {bridgeState === 'checking' ? '正在连接发布引擎' : bridgeState === 'connected' ? `发布引擎已就绪 · ${accounts.length} 平台` : bridgeState === 'error' ? '发布引擎连接异常' : '发布引擎待连接'}
            </button>
            <span className="privacy-chip"><ShieldCheck size={14} /> 文件留在本地</span>
            <span className="version-chip">PUBLIC MVP · 02</span>
            <DispatchControls
              accounts={accounts}
              bridgeError={bridgeError}
              bridgeState={bridgeState}
              hasArticle={false}
              installGuide={installGuide}
              isOpen={isDispatchDrawerOpen}
              results={results}
              selectedIds={selectedIds}
              showPublishTrigger={false}
              workState={workState}
              onOpenChange={setIsDispatchDrawerOpen}
              onPublish={() => void handlePublish()}
              onRefresh={() => void refreshBridge()}
              onTogglePlatform={togglePlatform}
            />
          </div>
        )}
      </header>

      <div className="workbench-layout">
        <button
          ref={historyTriggerRef}
          type="button"
          className="history-mobile-trigger"
          aria-label="打开历史记录"
          aria-expanded={historyOverlayOpen}
          onClick={() => setHistoryOverlayOpen(true)}
        >
          <PanelLeftOpen size={18} />
        </button>
        <button
          type="button"
          className={`history-sidebar-backdrop ${historyOverlayOpen ? 'visible' : ''}`}
          aria-label="关闭历史记录"
          tabIndex={historyOverlayOpen ? 0 : -1}
          onClick={() => closeHistoryOverlay()}
        />
        <div ref={historySidebarSlotRef} className={`history-sidebar-slot ${historyOverlayOpen ? 'overlay-open' : ''}`}>
          <input
            ref={backupInputRef}
            type="file"
            accept=".json,.ezwriting-backup.json,application/json"
            hidden
            onChange={event => void importLocalData(event.target.files?.[0])}
          />
          <HistorySidebar
            drafts={drafts}
            activeDraftId={article?.id}
            isExpanded={historyOverlayOpen || historyExpanded}
            filter={historyFilter}
            undoDraft={undoDraft}
            onToggleExpanded={toggleHistorySidebar}
            onFilterChange={setHistoryFilter}
            onSelectDraft={id => void selectHistoryDraft(id)}
            onChangeKind={(id, kind) => void changeHistoryDraftKind(id, kind)}
            onDeleteDraft={id => void deleteHistoryDraft(id)}
            onUndoDelete={id => void undoDeleteHistoryDraft(id)}
            onExportBackup={() => void exportLocalData()}
            onImportBackup={() => {
              if (backupInputRef.current) {
                backupInputRef.current.value = ''
                backupInputRef.current.click()
              }
            }}
            backupStatus={backupStatus}
            storagePersistent={storagePersistent}
          />
        </div>

      <main ref={workspaceRef} className="workspace article-open">
        <section className="work-area">
          <div className={`editor-shell ${article ? 'has-article' : 'empty-workbench'}`}>
            {hydrationPhase === 'loading' ? (
              <section className="history-hydration-state" aria-live="polite">
                <LoaderCircle className="spin" size={24} />
                <strong>正在恢复本地稿件…</strong>
              </section>
            ) : !article ? (
              <section className="empty-import-stage">
                <section
                  className={`workbench-drop-zone empty-import-card ${isDragging ? 'dragging' : ''}`}
                  aria-label="导入稿件"
                  onDragEnter={event => { event.preventDefault(); setIsDragging(true) }}
                  onDragOver={event => event.preventDefault()}
                  onDragLeave={event => { event.preventDefault(); setIsDragging(false) }}
                  onDrop={event => {
                    event.preventDefault()
                    setIsDragging(false)
                    void importSelection(Array.from(event.dataTransfer.files))
                  }}
                >
                  <input ref={fileInputRef} type="file" accept=".md,.markdown,.html,.htm,.zip" onChange={event => void importSelection(Array.from(event.target.files || []))} hidden />
                  <input ref={directoryInputRef} type="file" multiple onChange={event => void importSelection(Array.from(event.target.files || []))} {...{ webkitdirectory: '', directory: '' }} hidden />
                  <div className="drop-orbit" aria-hidden="true">{workState === 'parsing' ? <LoaderCircle className="spin" size={34} /> : <Upload size={34} />}</div>
                  <p className="drop-index">START YOUR DRAFT</p>
                  <h2>{workState === 'parsing' ? '正在拆解内容…' : '新建或导入一篇稿件'}</h2>
                  <p>从空白文档开始，或把本地稿件带入工作台</p>
                  {error && (
                    <div className="import-error" role="alert">
                      <CircleAlert size={16} />
                      <span>{error}</span>
                      <button type="button" onClick={() => setError(null)} aria-label="关闭错误提示"><XCircle size={15} /></button>
                    </div>
                  )}
                  <div className="drop-actions">
                    <button type="button" className="primary-button" onClick={() => void createNewArticle()} disabled={workState === 'parsing'}><FilePlus2 size={18} /> 新建文档 <ArrowRight size={18} /></button>
                    <button type="button" className="folder-button" onClick={() => fileInputRef.current?.click()} disabled={workState === 'parsing'}><FileUp size={16} /> 选择文件</button>
                  </div>
                  <button type="button" className="directory-link" onClick={() => directoryInputRef.current?.click()} disabled={workState === 'parsing'}><FolderOpen size={14} /> 文章和配图在同一目录？选择文章文件夹</button>
                  <div className="format-tags" aria-label="支持的文件格式">
                    <span>Markdown</span>
                    <span>HTML</span>
                    <span>ZIP</span>
                  </div>
                </section>
              </section>
            ) : (
              <div
                ref={editorGridRef}
                className={`editor-grid workspace-mode-${workspaceMode}`}
                style={{ '--editor-pane-width': `${editorPanePercent}%` } as CSSProperties}
              >
                  <section className="paper-panel">
                    <div className="article-workspace-pane">
                  {error && (
                    <div className="error-banner" role="alert">
                      <CircleAlert size={18} />
                      <span>{error}</span>
                      <button type="button" onClick={() => setError(null)} aria-label="关闭错误提示"><XCircle size={17} /></button>
                    </div>
                  )}
                  {article.warnings.length > 0 && (
                    <aside className={`warning-notice ${warningsExpanded ? 'expanded' : ''}`}>
                      <button type="button" className="warning-summary" aria-expanded={warningsExpanded} onClick={() => setWarningsExpanded(current => !current)}>
                        <CircleAlert size={17} />
                        <strong>{(article.missingAssets?.length || 0) > 0 ? `${article.missingAssets?.length} 张图片待处理` : `${article.warnings.length} 条导入提醒`}</strong>
                        <span>{warningsExpanded ? '收起详情' : '查看详情'}</span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                      {warningsExpanded && <div className="warning-details">{article.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
                    </aside>
                  )}

                  <nav className="editor-view-tabs" aria-label="编辑区视图">
                    <div className="editor-view-tab-list" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={editorView === 'edit'}
                        aria-controls="article-edit-view"
                        className={editorView === 'edit' ? 'active' : ''}
                        onClick={() => setEditorView('edit')}
                      >编辑</button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={editorView === 'resources'}
                        aria-controls="article-resource-view"
                        className={editorView === 'resources' ? 'active' : ''}
                        onClick={() => setEditorView('resources')}
                      ><Images size={15} />资源 <span>{articleContent.resources.length}</span></button>
                    </div>
                    <div className="editor-import" ref={editorImportMenuRef}>
                      <input
                        ref={editorImportInputRef}
                        className="editor-import-input"
                        type="file"
                        accept=".md,.markdown,.html,.htm,.zip"
                        hidden
                        onChange={event => {
                          const file = event.target.files?.[0]
                          void importIntoEditor(file)
                          event.target.value = ''
                        }}
                      />
                      <button
                        type="button"
                        className="editor-import-trigger"
                        aria-label="导入文档"
                        aria-haspopup="menu"
                        aria-expanded={isImportMenuOpen}
                        disabled={workState === 'parsing'}
                        onClick={() => setIsImportMenuOpen(current => !current)}
                      >
                        {workState === 'parsing' ? <LoaderCircle className="spin" size={15} /> : <Import size={15} />}
                        <span>{workState === 'parsing' ? '导入中' : '导入'}</span>
                        <ChevronDown size={14} />
                      </button>
                      {isImportMenuOpen && (
                        <div className="editor-import-menu" role="menu" aria-label="选择导入方式">
                          <button type="button" role="menuitem" onClick={() => requestEditorImport('append')}>
                            <span className="import-option-icon append"><FilePlus2 size={17} /></span>
                            <span><strong>追加到当前内容</strong><small>保留正在写的内容，将文件接在正文后面</small></span>
                          </button>
                          <button type="button" role="menuitem" onClick={() => requestEditorImport('replace')}>
                            <span className="import-option-icon replace"><RotateCcw size={17} /></span>
                            <span><strong>替换当前内容</strong><small>清空当前标题、正文与资源，使用导入文件</small></span>
                          </button>
                        </div>
                      )}
                    </div>
                  </nav>

                  {editorView === 'edit' ? (
                    <div className="article-form editor-view-panel" id="article-edit-view" role="tabpanel">
                      <label className="editor-title-field" htmlFor="article-title">
                        <input
                          ref={titleInputRef}
                          id="article-title"
                          className="title-input"
                          aria-label="文章标题"
                          placeholder="请输入标题（可选）"
                          value={article.title}
                          onChange={event => updateArticleTitle(event.target.value)}
                        />
                      </label>

                      <section className="content-editor-section" aria-label="正文内容">
                        <Suspense fallback={<div className="article-editor-loading">正在准备编辑器…</div>}>
                          <SourceEditor
                            key={article.id}
                            value={articleSource?.text || ''}
                            language={articleSource?.language || 'markdown'}
                            focusRequest={editorFocusRequest}
                            onChange={updateArticleSource}
                            onActiveBlockChange={setActiveEditorBlockIndex}
                          />
                        </Suspense>
                      </section>

                      <footer className="article-stats" aria-label="稿件统计">
                        <span>字数 <strong>{articleContent.characterCount}</strong></span>
                        <span>图片 <strong>{articleContent.bodyImageCount}</strong></span>
                        <span>{sourceLabel(article)}</span>
                        <button
                          type="button"
                          className="preview-current-block"
                          disabled={activeEditorBlockIndex === null}
                          onClick={previewCurrentEditorBlock}
                        >
                          <ScanSearch size={14} />在右侧预览
                        </button>
                      </footer>
                    </div>
                  ) : (
                    <section ref={resourcesPanelRef} className="resource-panel editor-view-panel" id="article-resource-view" role="tabpanel" aria-labelledby="resource-panel-heading">
                      <header className="resource-panel-heading">
                        <div>
                          <p>DOCUMENT ASSETS</p>
                          <h2 id="resource-panel-heading">文档资源</h2>
                          <span>集中预览正文图片；缺图时可一次选择多张图片或整个文件夹补齐。</span>
                        </div>
                        <div className="resource-actions">
                          <input ref={assetInputRef} type="file" accept="image/*" multiple onChange={event => void supplementAssets(Array.from(event.target.files || []))} hidden />
                          <input ref={assetDirectoryInputRef} type="file" multiple onChange={event => void supplementAssets(Array.from(event.target.files || []))} {...{ webkitdirectory: '', directory: '' }} hidden />
                          <button type="button" onClick={() => assetInputRef.current?.click()}><ImagePlus size={15} /> 批量选择图片</button>
                          <button type="button" onClick={() => assetDirectoryInputRef.current?.click()}><FolderOpen size={15} /> 选择文件夹</button>
                        </div>
                      </header>

                      {(article.missingAssets?.length || 0) > 0 && (
                        <div className="asset-repair" role="status">
                          <div className="asset-repair-icon"><ImagePlus size={18} /></div>
                          <div className="asset-repair-copy"><strong>还差 {article.missingAssets?.length} 张本地图片</strong><p>{article.missingAssets?.slice(0, 3).join(' · ')}</p></div>
                          <div className="asset-repair-actions">
                            <button type="button" onClick={() => assetInputRef.current?.click()}>选择图片</button>
                            <button type="button" onClick={() => assetDirectoryInputRef.current?.click()}>选择文件夹</button>
                          </div>
                        </div>
                      )}

                      {articleContent.resources.length > 0 ? (
                        <div className="resource-grid" aria-label={`共 ${articleContent.resources.length} 张图片`}>
                          {articleContent.resources.map((resource, index) => (
                            <figure className={`article-resource-card ${resource.missingTarget ? 'missing' : ''}`} data-resource-kind={resource.kind} key={resource.id}>
                              <div className="resource-thumbnail">
                                {resource.missingTarget
                                  ? <div className="resource-missing-thumbnail"><ImagePlus size={22} /><span>图片待处理</span></div>
                                  : <img src={resource.src} alt={resource.name} />}
                              </div>
                              <figcaption>
                                <strong>{resource.name}</strong>
                                <span>{resource.missingTarget ? resource.missingTarget.reference : resource.kind === 'cover' ? '封面资源' : resource.src.startsWith('data:image/') ? '本地图片' : /^https?:\/\//i.test(resource.src) ? '外链图片' : '文档路径'}</span>
                              </figcaption>
                              <small>{String(index + 1).padStart(2, '0')}</small>
                              {resource.missingTarget && (
                                <div className="resource-card-actions">
                                  <button type="button" onClick={() => requestMissingImageAction(resource.missingTarget!, 'relink')}>重新链接</button>
                                  <button type="button" onClick={() => requestMissingImageAction(resource.missingTarget!, 'replace')}>替换</button>
                                  <button type="button" className="delete" onClick={() => requestMissingImageAction(resource.missingTarget!, 'delete')}>删除</button>
                                </div>
                              )}
                            </figure>
                          ))}
                        </div>
                      ) : (
                        <div className="resource-empty"><Images size={25} /><strong>正文里还没有图片</strong><span>在编辑工具栏中插入图片后，会自动出现在这里。</span></div>
                      )}
                    </section>
                  )}
                    </div>
                  </section>

                  <div
                    className="pane-resizer"
                    role="separator"
                    tabIndex={0}
                    aria-label="调整编辑区和预览区宽度"
                    aria-orientation="vertical"
                    aria-valuemin={MIN_EDITOR_PANE_PERCENT}
                    aria-valuemax={MAX_EDITOR_PANE_PERCENT}
                    aria-valuenow={editorPanePercent}
                    aria-valuetext={`编辑区 ${editorPanePercent}%，预览区 ${100 - editorPanePercent}%`}
                    title="拖动调整宽度，双击恢复默认比例"
                    onPointerDown={startPaneResize}
                    onPointerMove={movePaneResize}
                    onPointerUp={finishPaneResize}
                    onPointerCancel={finishPaneResize}
                    onDoubleClick={() => updateEditorPanePercent(DEFAULT_EDITOR_PANE_PERCENT, true)}
                    onKeyDown={adjustPaneWithKeyboard}
                  >
                    <span aria-hidden="true" />
                  </div>

                  <div className="preview-lane" id="platform-preview-panel" role="tabpanel">
                    <div className="preview-lane-content">
                      <Suspense fallback={<div className="preview-loading"><LoaderCircle className="spin" size={22} /> 正在生成平台预览…</div>}>
                        <div className={`preview-device-frame ${previewDevice}`}>
                          <PlatformPreviews
                            key={article.id}
                            activePlatform={activePlatform}
                            title={article.title}
                            html={previewHtml}
                            sourceText={articleSource?.text}
                            sourceLanguage={articleSource?.language}
                            cover={article.cover}
                            formatting={formatting}
                            onFormattingChange={updateArticleFormatting}
                            xhsSettings={xhsSettings}
                            onXhsSettingsChange={updateXhsCardSettings}
                            previewAccount={previewAccount}
                            previewDevice={previewDevice}
                            isUpdating={isPreviewUpdating}
                            onPreviewDeviceChange={setPreviewDevice}
                            locateRequest={previewLocateRequest}
                            onEditTarget={editPreviewTarget}
                            onMissingImageAction={requestMissingImageAction}
                          />
                        </div>
                      </Suspense>
                    </div>
                  </div>
                </div>
            )}
            </div>
        </section>
      </main>
      </div>
      {(historyError || autosave.error || backupNotice) && (
        <div className={`local-history-notice ${historyError || autosave.error ? 'error' : ''}`} role="status" aria-live="polite">
          <span>{historyError || (autosave.error ? `自动保存失败：${autosave.error.message}` : backupNotice)}</span>
          <button type="button" aria-label="关闭提示" onClick={() => { setHistoryError(null); setBackupNotice(null) }}><XCircle size={15} /></button>
        </div>
      )}
    </div>
  )
}
