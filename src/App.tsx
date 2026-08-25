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
  Clock3,
  Columns2,
  FileText,
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
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react'
import type { ArticleDraft, MissingImageAction, MissingImageTarget, PlatformAccount, PublishResult } from './domain/article'
import { DEFAULT_ARTICLE_FORMATTING, type ArticleFormatting } from './domain/formatting'
import { DispatchControls, type BridgeState, type WorkState } from './components/dispatch-controls'
import { HistorySidebar, type HistoryUndoDraft } from './components/history-sidebar'
import type { SourceEditorActiveLocation, SourceEditorFocusRequest } from './components/source-editor'
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
import { DraftConflictError, LocalDraftRepository } from './services/local-draft-repository'
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
import {
  FileParseError,
  parseContentFile,
  pickPrimaryContentFile,
  sanitizeEditedHtml,
  selectImageResourceFiles,
  validateImageResourceFiles,
} from './lib/file-parser'
import { extractMissingImageTargets } from './lib/missing-assets'
import { normalizeMarkdownStrongWhitespace } from './lib/markdown-compatibility'
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
import {
  createReliabilityReport,
  recordImportDiagnostic,
  reliabilityReportFileName,
  serializeReliabilityReport,
} from './services/local-diagnostics'
import brandLogo from '../SVG/资源 1.svg'
import githubLogo from '../SVG/github.svg'
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
  kind: 'body'
  blockIndex?: number
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
type ExclusiveOperation =
  | 'create-draft'
  | 'content-import'
  | 'asset-import'
  | 'backup-export'
  | 'backup-import'
  | 'switch-draft'
  | 'change-kind'
  | 'delete-draft'
  | 'restore-draft'
  | 'publish'

const SourceEditor = lazy(() => import('./components/source-editor').then(module => ({ default: module.SourceEditor })))
const PlatformPreviews = lazy(() => import('./components/platform-previews').then(module => ({ default: module.PlatformPreviews })))

const PREVIEW_PLATFORMS: Array<{ id: PreviewPlatform; label: string; accessibleLabel: string; logo: string }> = [
  { id: 'wechat', label: '公众号', accessibleLabel: '微信公众号', logo: wechatLogo },
  { id: 'xhs', label: '小红书', accessibleLabel: '小红书', logo: xhsLogo },
  { id: 'x', label: 'X', accessibleLabel: 'X 长文', logo: xLogo },
]

interface HomeStarterTemplate {
  id: string
  title: string
  description: string
  initialTitle: string
  platform: PreviewPlatform
  kind: DraftKind
  source: string
}

const HOME_STARTER_TEMPLATES: HomeStarterTemplate[] = [
  {
    id: 'wechat-longform',
    title: '公众号长文',
    description: '用开场、正文与结尾搭好一篇完整长文。',
    initialTitle: '公众号长文草稿',
    platform: 'wechat',
    kind: 'longform',
    source: '## 开场\n\n用一个具体问题或真实场景，让读者知道这篇内容和自己有什么关系。\n\n## 核心内容\n\n写下你的主要观点，并用案例、步骤或证据把它讲清楚。\n\n## 结尾\n\n总结最值得记住的一点，并给出下一步行动。',
  },
  {
    id: 'xhs-image-post',
    title: '小红书图文',
    description: '从一句亮点和三条要点快速组织图文内容。',
    initialTitle: '小红书图文草稿',
    platform: 'xhs',
    kind: 'image',
    source: '## 一句话亮点\n\n先写下这篇内容最想让人记住的一句话。\n\n## 重点清单\n\n- 要点一：给出最直接的结论\n- 要点二：补充具体方法或经验\n- 要点三：提醒容易忽略的问题\n\n## 行动建议\n\n告诉读者看完之后可以马上做什么。',
  },
  {
    id: 'x-longform',
    title: 'X 长文',
    description: '围绕一个鲜明观点展开论据与结论。',
    initialTitle: 'X 长文草稿',
    platform: 'x',
    kind: 'longform',
    source: '## 核心观点\n\n用一句清楚、可讨论的话写下你的判断。\n\n## 为什么\n\n补充事实、案例或推理，让观点站得住。\n\n## 结论\n\n收束全文，并留下一个值得继续讨论的问题。',
  },
]

type EditorPanePercents = Record<PreviewPlatform, number>

const LEGACY_DEFAULT_EDITOR_PANE_PERCENT = 55
const DEFAULT_EDITOR_PANE_PERCENT_BY_PLATFORM: EditorPanePercents = {
  wechat: 44,
  xhs: 42,
  x: 40,
}
const MIN_EDITOR_PANE_PERCENT = 32
const MAX_EDITOR_PANE_PERCENT = 68
const EDITOR_PANE_STORAGE_KEY = 'dispatch.editor-pane-percent.v3'
const LEGACY_EDITOR_PANE_STORAGE_KEY = 'dispatch.editor-pane-percent.v2'
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

function articleFormattingForTarget(formatting: ArticleFormatting, target: PlatformContentTarget): ArticleFormatting {
  if (target === 'x' || formatting.theme === 'clean') return formatting
  return { ...formatting, theme: 'clean' }
}

function readEditorPanePercents(): EditorPanePercents {
  const defaults = { ...DEFAULT_EDITOR_PANE_PERCENT_BY_PLATFORM }
  try {
    const saved = window.localStorage.getItem(EDITOR_PANE_STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<Record<PreviewPlatform, unknown>>
        if (parsed && typeof parsed === 'object') {
          let hasValidPlatformValue = false
          const normalized = PREVIEW_PLATFORMS.reduce<EditorPanePercents>((result, platform) => {
            const value = parsed[platform.id]
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
              result[platform.id] = clampEditorPanePercent(value)
              hasValidPlatformValue = true
            }
            return result
          }, defaults)
          if (hasValidPlatformValue) return normalized
        }
      } catch {
        // Fall through to the legacy preference when the v3 mapping is malformed.
      }
    }

    const legacySaved = Number(window.localStorage.getItem(LEGACY_EDITOR_PANE_STORAGE_KEY))
    if (Number.isFinite(legacySaved) && legacySaved > 0) {
      const legacyPercent = clampEditorPanePercent(legacySaved)
      if (legacyPercent !== LEGACY_DEFAULT_EDITOR_PANE_PERCENT) defaults.wechat = legacyPercent
    }
    return defaults
  } catch {
    return defaults
  }
}

function saveEditorPanePercents(value: EditorPanePercents): void {
  try {
    window.localStorage.setItem(EDITOR_PANE_STORAGE_KEY, JSON.stringify(value))
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

function platformAccountType(account: PlatformAccount): string {
  return account.raw && typeof account.raw === 'object' && 'type' in account.raw
    ? String((account.raw as { type?: unknown }).type || '')
    : ''
}

function accountMatchesPreview(account: PlatformAccount, platform: PreviewPlatform): boolean {
  const rawType = platformAccountType(account)
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

function repairLoadedMarkdownStrongWhitespace(article: ArticleDraft): { article: ArticleDraft; changed: boolean } {
  if (article.sourceLanguage !== 'markdown' && typeof article.markdown !== 'string') {
    return { article, changed: false }
  }

  const source = resolveArticleSource(article)
  const normalizedSource = normalizeMarkdownStrongWhitespace(source.text)
  if (normalizedSource === source.text) return { article, changed: false }

  return {
    article: reconcileSourceUpdate(article, updateArticleFromSource(article, normalizedSource)),
    changed: true,
  }
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

function createStarterArticle(template: HomeStarterTemplate): ArticleDraft {
  const article = createBlankArticle()
  return updateArticleFromSource({
    ...article,
    title: template.initialTitle,
    sourceFile: `${template.title}模板`,
  }, template.source)
}

function formatHomeDraftDate(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '最近编辑'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
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
    summary: current.summary || imported.summary,
    tags: [...new Set([...current.tags, ...imported.tags])],
    warnings: [...new Set([...current.warnings, ...imported.warnings])],
    missingAssets: [...new Set([...(current.missingAssets || []), ...(imported.missingAssets || [])])],
  }
  return reconcileSourceUpdate(current, updateArticleFromSource(base, combinedSource))
}

function analyzeArticleContent(html: string): { characterCount: number; bodyImageCount: number; resources: ArticleResource[] } {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const text = (document.body.textContent || '').replace(/\s+/g, '')
  const bodyBlocks = Array.from(document.body.children).filter(element => !element.hasAttribute('data-source-spacer'))
  const bodyResources = Array.from(document.body.querySelectorAll('img')).map((image, index) => {
    const src = image.getAttribute('src') || ''
    const missingId = image.dataset.missingId
    const missingReference = image.dataset.missingAsset
    let sourceBlock: Element = image
    while (sourceBlock.parentElement && sourceBlock.parentElement !== document.body) {
      sourceBlock = sourceBlock.parentElement
    }
    return {
      id: `body-${index}`,
      src,
      name: getResourceName(src, image.getAttribute('alt'), index),
      kind: 'body' as const,
      blockIndex: bodyBlocks.indexOf(sourceBlock),
      missingTarget: missingId && missingReference ? { id: missingId, reference: missingReference } : undefined,
    }
  })
  return { characterCount: Array.from(text).length, bodyImageCount: bodyResources.length, resources: bodyResources }
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
  const [historyExpanded, setHistoryExpanded] = useState(readHistorySidebarExpanded)
  const [historyOverlayOpen, setHistoryOverlayOpen] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [undoDraft, setUndoDraft] = useState<HistoryUndoDraft | null>(null)
  const [backupStatus, setBackupStatus] = useState<'idle' | 'exporting' | 'importing'>('idle')
  const [backupNotice, setBackupNotice] = useState<string | null>(null)
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null)
  const [workState, setWorkState] = useState<WorkState>('idle')
  const [exclusiveOperation, setExclusiveOperation] = useState<ExclusiveOperation | null>(null)
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
  const [editorPanePercents, setEditorPanePercents] = useState(readEditorPanePercents)
  const [editorFocusRequest, setEditorFocusRequest] = useState<SourceEditorFocusRequest | null>(null)
  const [previewLocateRequest, setPreviewLocateRequest] = useState<PreviewLocateRequest | null>(null)
  const [activeEditorLocation, setActiveEditorLocation] = useState<SourceEditorActiveLocation | null>(null)
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
  const editorPanePercentsRef = useRef(editorPanePercents)
  const paneResizeActiveRef = useRef(false)
  const paneResizePlatformRef = useRef<PreviewPlatform | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const resourcesPanelRef = useRef<HTMLElement>(null)
  const focusRequestIdRef = useRef(0)
  const previewLocateRequestIdRef = useRef(0)
  const locatedFieldRef = useRef<HTMLElement | null>(null)
  const locatedFieldTimerRef = useRef<number | null>(null)
  const activeDraftRecordRef = useRef<PersistedDraft | null>(null)
  const activeDraftIdRef = useRef<string | null>(null)
  const previousHomeDraftCountRef = useRef<number | null>(null)
  const draftRevisionRef = useRef(0)
  const documentGenerationRef = useRef(0)
  const exclusiveOperationRef = useRef<ExclusiveOperation | null>(null)
  const publishAttemptRef = useRef(0)
  const undoTimerRef = useRef<number | null>(null)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const historySidebarSlotRef = useRef<HTMLDivElement>(null)
  const topbarRef = useRef<HTMLElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const applyPersistedDraftRef = useRef<(draft: PersistedDraft) => void>(() => undefined)

  activeDraftIdRef.current = article?.id ?? null

  const beginExclusiveOperation = useCallback((operation: ExclusiveOperation): boolean => {
    if (exclusiveOperationRef.current !== null) return false
    exclusiveOperationRef.current = operation
    setExclusiveOperation(operation)
    return true
  }, [])

  const endExclusiveOperation = useCallback((operation: ExclusiveOperation) => {
    if (exclusiveOperationRef.current !== operation) return
    exclusiveOperationRef.current = null
    setExclusiveOperation(null)
  }, [])

  const currentDraftSnapshot = useMemo<CurrentDraftSnapshot>(() => ({
    article,
    formatting,
    kind: draftKind,
    xhsSettings,
    sourceInfo: fileInfo,
  }), [article, draftKind, fileInfo, formatting, xhsSettings])

  const homeDrafts = useMemo(() => drafts
    .filter(draft => !draft.deletedAt)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()), [drafts])

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
    let saved: PersistedDraft
    try {
      saved = await draftRepository.saveDraft(
        persistedDraftFromSnapshot(snapshot as DraftWorkspaceSnapshot, current),
        { expectedUpdatedAt: current?.updatedAt ?? null },
      )
    } catch (saveError) {
      if (saveError instanceof DraftConflictError || (saveError as { code?: string })?.code === 'draft-conflict') {
        setHistoryError('检测到另一标签页已更新这篇稿件；当前编辑仍保留，但没有覆盖较新的版本。请先导出备份，再刷新页面重新载入。')
      }
      throw saveError
    }
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
    if (hydrationPhase !== 'ready') return
    const previousCount = previousHomeDraftCountRef.current
    if (homeDrafts.length === 0) setHistoryExpanded(false)
    else if (previousCount === 0) setHistoryExpanded(true)
    previousHomeDraftCountRef.current = homeDrafts.length
  }, [homeDrafts.length, hydrationPhase])

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
    const restoredArticle: ArticleDraft = {
      ...restored.article,
      html: sanitizeEditedHtml(restored.article.html),
      tags: Array.isArray(restored.article.tags) ? restored.article.tags : [],
      warnings: Array.isArray(restored.article.warnings) ? restored.article.warnings : [],
      missingAssets: Array.isArray(restored.article.missingAssets) ? restored.article.missingAssets : [],
    }
    const persistedSnapshot: CurrentDraftSnapshot = {
      ...restored,
      article: restoredArticle,
    }
    const repaired = repairLoadedMarkdownStrongWhitespace(restoredArticle)
    const snapshot: CurrentDraftSnapshot = { ...persistedSnapshot, article: repaired.article }
    documentGenerationRef.current += 1
    draftRevisionRef.current += 1
    activeDraftRecordRef.current = persisted
    activeDraftIdRef.current = persisted.id
    autosave.markSaved(persistedSnapshot, draftRevisionRef.current)
    if (repaired.changed) draftRevisionRef.current += 1
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
    setPreviewLocateRequest(null)
    setActiveEditorLocation(null)
    setEditorView('edit')
    setPreviewDevice('desktop')
    setWarningsExpanded(false)
    setIsImportMenuOpen(false)
    importContextRef.current = null
  }, [autosave.markSaved])
  applyPersistedDraftRef.current = applyPersistedDraft

  const activateNewDraft = useCallback((snapshot: DraftWorkspaceSnapshot, platform: PreviewPlatform = 'wechat') => {
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
    setActivePlatform(platform)
    setResults([])
    setError(null)
    setEditorFocusRequest(null)
    setPreviewLocateRequest(null)
    setActiveEditorLocation(null)
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
    setActiveEditorLocation(null)
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
    setActiveEditorLocation(null)
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
      const parsed = await parseContentFile(file, assetFiles, {
        operation: 'initial',
        onDiagnostic: recordImportDiagnostic,
      })
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
    if (!files.length || !beginExclusiveOperation('content-import')) return
    try {
      const primary = pickPrimaryContentFile(files)
      await importFile(primary, files.filter(file => file !== primary))
    } catch (selectionError) {
      setError(selectionError instanceof FileParseError ? selectionError.message : '没有找到可导入的文章文件。')
    } finally {
      endExclusiveOperation('content-import')
    }
  }

  const createNewArticle = async () => {
    if (!beginExclusiveOperation('create-draft')) return
    try {
      await autosave.flush()
    } catch (saveError) {
      setHistoryError(`新建前保存失败：${(saveError as Error).message}`)
      return
    } finally {
      endExclusiveOperation('create-draft')
    }
    activateNewDraft(createDraftSnapshot(createBlankArticle()))
  }

  const createArticleFromTemplate = async (template: HomeStarterTemplate) => {
    if (!beginExclusiveOperation('create-draft')) return
    try {
      await autosave.flush()
    } catch (saveError) {
      setHistoryError(`使用模板前保存失败：${(saveError as Error).message}`)
      return
    } finally {
      endExclusiveOperation('create-draft')
    }
    const snapshot = createDraftSnapshot(createStarterArticle(template))
    activateNewDraft({ ...snapshot, kind: template.kind }, template.platform)
  }

  const exportLocalData = async () => {
    if (!draftRepository || !beginExclusiveOperation('backup-export')) return
    setBackupStatus('exporting')
    setBackupNotice(null)
    setHistoryError(null)
    try {
      let unsavedDraft: PersistedDraft | undefined
      try {
        await autosave.flush()
      } catch {
        if (!currentDraftSnapshot.article) throw new Error('当前稿件保存失败，且没有可加入备份的编辑内容。')
        const current = activeDraftRecordRef.current?.id === currentDraftSnapshot.article.id
          ? activeDraftRecordRef.current
          : await draftRepository.getDraft(currentDraftSnapshot.article.id)
        unsavedDraft = persistedDraftFromSnapshot(currentDraftSnapshot as DraftWorkspaceSnapshot, current)
      }
      const payload = await createLocalBackup(draftRepository, new Date(), unsavedDraft)
      const url = URL.createObjectURL(serializeLocalBackup(payload))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = localBackupFileName()
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setBackupNotice(unsavedDraft
        ? `本地保存失败，但已将当前编辑直接写入备份；共导出 ${payload.drafts.length} 篇稿件。`
        : `已导出 ${payload.drafts.length} 篇稿件及其本地图片。`)
    } catch (backupError) {
      setHistoryError(`导出备份失败：${(backupError as Error).message}`)
    } finally {
      setBackupStatus('idle')
      endExclusiveOperation('backup-export')
    }
  }

  const importLocalData = async (file?: File) => {
    if (!file || !draftRepository || !beginExclusiveOperation('backup-import')) return
    if (typeof draftRepository.importDraftsAtomically !== 'function') {
      setHistoryError('当前稿件仓库不支持原子整库导入，已停止且未写入备份稿件。')
      endExclusiveOperation('backup-import')
      if (backupInputRef.current) backupInputRef.current.value = ''
      return
    }
    setBackupStatus('importing')
    setBackupNotice(null)
    setHistoryError(null)
    try {
      const payload = await parseLocalBackup(file)
      const existingIds = new Set((await draftRepository.listDrafts({ includeDeleted: true })).map(draft => draft.id))
      const replacements = payload.drafts.filter(draft => existingIds.has(draft.id)).length
      if (replacements > 0 && !window.confirm(`备份中有 ${replacements} 篇稿件与本机记录相同。继续导入会用备份版本覆盖这些稿件，是否继续？`)) return
      await autosave.flush()
      documentGenerationRef.current += 1
      autosave.cancel()
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
      endExclusiveOperation('backup-import')
      if (backupInputRef.current) backupInputRef.current.value = ''
    }
  }

  const exportReliabilityData = () => {
    setBackupNotice(null)
    setHistoryError(null)
    try {
      const report = createReliabilityReport({
        bridgeState,
        draftCount: drafts.length,
        storagePersistent,
      })
      const url = URL.createObjectURL(serializeReliabilityReport(report))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = reliabilityReportFileName()
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setBackupNotice(`已导出脱敏诊断报告，包含最近 ${report.recentImports.length} 次导入计时。`)
    } catch (diagnosticError) {
      setHistoryError(`导出诊断报告失败：${(diagnosticError as Error).message}`)
    }
  }

  const requestEditorImport = (mode: EditorImportMode) => {
    if (exclusiveOperationRef.current !== null) return
    pendingEditorImportModeRef.current = mode
    setIsImportMenuOpen(false)
    if (editorImportInputRef.current) {
      editorImportInputRef.current.value = ''
      editorImportInputRef.current.click()
    }
  }

  const importIntoEditor = async (file?: File) => {
    if (!file || !beginExclusiveOperation('content-import')) return
    const mode = pendingEditorImportModeRef.current
    const targetDraftId = activeDraftIdRef.current
    const operationGeneration = documentGenerationRef.current
    setError(null)
    setResults([])
    setEditorFocusRequest(null)
    setPreviewLocateRequest(null)
    setActiveEditorLocation(null)
    setWarningsExpanded(false)
    setWorkState('parsing')

    try {
      const parsed = await parseContentFile(file, [], {
        operation: mode,
        onDiagnostic: recordImportDiagnostic,
      })
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
    } finally {
      endExclusiveOperation('content-import')
    }
  }

  const supplementAssets = async (files: File[]) => {
    const context = importContextRef.current
    if (!files.length || !beginExclusiveOperation('asset-import')) return
    try {
      const validatedFiles = selectImageResourceFiles(files)
      if (!context) {
        const currentArticle = article
        if (!currentArticle) return
        const operationGeneration = documentGenerationRef.current
        setError(null)
        setResults([])
        setWorkState('parsing')
        const resolved = await resolveMissingImagesFromFiles(currentArticle, validatedFiles)
        if (operationGeneration !== documentGenerationRef.current || activeDraftIdRef.current !== currentArticle.id) return
        setArticle(resolved)
        markDraftDirty()
        setWorkState('ready')
        return
      }
      const known = new Map(context.assets.map(file => [file.webkitRelativePath || `${file.name}:${file.size}:${file.lastModified}`, file]))
      validatedFiles.forEach(file => known.set(file.webkitRelativePath || `${file.name}:${file.size}:${file.lastModified}`, file))
      const nextAssets = [...known.values()]
      const targetDraftId = activeDraftIdRef.current
      const operationGeneration = documentGenerationRef.current
      setError(null)
      setResults([])
      setWorkState('parsing')
      const [previousParsed, nextParsed] = await Promise.all([
        parseContentFile(context.primary, context.assets),
        parseContentFile(context.primary, nextAssets, {
          operation: 'asset-supplement',
          onDiagnostic: recordImportDiagnostic,
        }),
      ])
      if (operationGeneration !== documentGenerationRef.current || activeDraftIdRef.current !== targetDraftId) return
      setArticle(current => {
        if (!current) return nextParsed
        return {
          ...mergeResolvedAssets(current, previousParsed.html, nextParsed.html),
          title: current.title,
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
    } finally {
      endExclusiveOperation('asset-import')
    }
  }

  const requestMissingImageAction = (target: MissingImageTarget, action: MissingImageAction) => {
    if (exclusiveOperationRef.current !== null) return
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
    if (!file || !pending || !beginExclusiveOperation('asset-import')) return
    const targetDraftId = activeDraftIdRef.current
    const operationGeneration = documentGenerationRef.current

    try {
      if (pending.action === 'relink' && file.name.toLocaleLowerCase() !== fileNameForReference(pending.target.reference).toLocaleLowerCase()) {
        setError(`重新链接需要选择“${fileNameForReference(pending.target.reference)}”；如需使用其他图片，请选择“替换图片”。`)
        return
      }
      validateImageResourceFiles([file])
      const source = await readFileAsDataUrl(file)
      if (operationGeneration !== documentGenerationRef.current || activeDraftIdRef.current !== targetDraftId) return
      setArticle(current => current
        ? reconcileSourceUpdate(current, replaceArticleSourceImage(current, pending.target.reference, source, file.name))
        : current)
      markDraftDirty()
    } catch (imageError) {
      setError(imageError instanceof FileParseError ? imageError.message : '图片读取失败，请重新选择。')
    } finally {
      endExclusiveOperation('asset-import')
    }
  }

  const togglePlatform = (id: string) => {
    if (exclusiveOperationRef.current !== null) return
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  const editorPanePercent = editorPanePercents[activePlatform]

  const updateEditorPanePercent = (value: number, persist = false, platform = activePlatform) => {
    const next = clampEditorPanePercent(value)
    const nextPercents = { ...editorPanePercentsRef.current, [platform]: next }
    editorPanePercentsRef.current = nextPercents
    setEditorPanePercents(nextPercents)
    if (persist) saveEditorPanePercents(nextPercents)
  }

  const resizeEditorPane = (clientX: number, platform: PreviewPlatform) => {
    const grid = editorGridRef.current
    if (!grid) return
    const bounds = grid.getBoundingClientRect()
    if (!bounds.width) return
    updateEditorPanePercent(((clientX - bounds.left) / bounds.width) * 100, false, platform)
  }

  const startPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    paneResizeActiveRef.current = true
    paneResizePlatformRef.current = activePlatform
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing-panes')
    resizeEditorPane(event.clientX, activePlatform)
  }

  const movePaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const platform = paneResizePlatformRef.current
    if (!paneResizeActiveRef.current || !platform) return
    resizeEditorPane(event.clientX, platform)
  }

  const finishPaneResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!paneResizeActiveRef.current) return
    paneResizeActiveRef.current = false
    paneResizePlatformRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('is-resizing-panes')
    saveEditorPanePercents(editorPanePercentsRef.current)
  }

  const adjustPaneWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next = editorPanePercentsRef.current[activePlatform]
    if (event.key === 'ArrowLeft') next -= 2
    else if (event.key === 'ArrowRight') next += 2
    else if (event.key === 'Home') next = MIN_EDITOR_PANE_PERCENT
    else if (event.key === 'End') next = MAX_EDITOR_PANE_PERCENT
    else return
    event.preventDefault()
    updateEditorPanePercent(next, true, activePlatform)
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
    if (!article) return
    const source = resolveArticleSource(article)
    focusRequestIdRef.current += 1
    setEditorFocusRequest({
      line: target.line ?? sourceLineForBlock(source.text, source.language, target.blockIndex),
      requestId: focusRequestIdRef.current,
    })
  }

  const updateActiveEditorLocation = (location: SourceEditorActiveLocation | null) => {
    setActiveEditorLocation(location)
  }

  const locateResourceInPreview = (resource: ArticleResource) => {
    if (resource.kind !== 'body' || resource.blockIndex === undefined || resource.blockIndex < 0) return
    setWorkspaceMode('split')
    setPreviewDevice('desktop')
    previewLocateRequestIdRef.current += 1
    setPreviewLocateRequest({
      blockIndex: resource.blockIndex,
      requestId: previewLocateRequestIdRef.current,
    })
  }

  const updateArticleTitle = (title: string) => {
    if (exclusiveOperationRef.current !== null) return
    setArticle(current => current ? { ...current, title } : current)
    markDraftDirty()
  }

  const updateArticleSource = (sourceText: string) => {
    if (exclusiveOperationRef.current !== null) return
    startTransition(() => {
      setArticle(current => current
        ? reconcileSourceUpdate(current, updateArticleFromSource(current, sourceText))
        : current)
      markDraftDirty()
    })
  }

  const updateArticleFormatting = (nextFormatting: ArticleFormatting) => {
    if (exclusiveOperationRef.current !== null) return
    setFormatting(nextFormatting)
    markDraftDirty()
  }

  const updateXhsCardSettings = (nextSettings: XhsCardSettings) => {
    if (exclusiveOperationRef.current !== null) return
    setXhsSettings(nextSettings)
    markDraftDirty()
  }

  const selectHistoryDraft = async (id: string) => {
    if (!draftRepository || id === activeDraftIdRef.current) {
      closeHistoryOverlay(false)
      return
    }
    if (!beginExclusiveOperation('switch-draft')) return
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
    } finally {
      endExclusiveOperation('switch-draft')
    }
  }

  const changeHistoryDraftKind = async (id: string, kind: DraftKind) => {
    if (!draftRepository || !beginExclusiveOperation('change-kind')) return
    setHistoryError(null)
    try {
      if (id === activeDraftIdRef.current) {
        setDraftKind(kind)
        markDraftDirty()
        return
      }
      const persisted = await draftRepository.getDraft(id)
      if (!persisted || persisted.deletedAt) return
      await draftRepository.saveDraft(
        { ...persisted, kind },
        { expectedUpdatedAt: persisted.updatedAt },
      )
      await refreshDraftSummaries()
    } catch (kindError) {
      setHistoryError(`类型修改失败：${(kindError as Error).message}`)
    } finally {
      endExclusiveOperation('change-kind')
    }
  }

  const deleteHistoryDraft = async (id: string) => {
    if (!draftRepository || !beginExclusiveOperation('delete-draft')) return
    const summary = drafts.find(draft => draft.id === id)
    const deletingActiveDraft = id === activeDraftIdRef.current
    setHistoryError(null)
    try {
      if (deletingActiveDraft) {
        try {
          await autosave.flush()
        } catch (saveError) {
          setHistoryError(`删除前保存失败，稿件未删除：${(saveError as Error).message}`)
          return
        }
        documentGenerationRef.current += 1
        autosave.cancel()
      }
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
    } finally {
      endExclusiveOperation('delete-draft')
    }
  }

  const undoDeleteHistoryDraft = async (id: string) => {
    if (!draftRepository || !beginExclusiveOperation('restore-draft')) return
    setHistoryError(null)
    try {
      await draftRepository.restoreDraft(id)
      await refreshDraftSummaries()
      setUndoDraft(null)
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    } catch (restoreError) {
      setHistoryError(`撤销删除失败：${(restoreError as Error).message}`)
    } finally {
      endExclusiveOperation('restore-draft')
    }
  }

  const handlePublish = async () => {
    if (!article || selectedIds.length === 0 || bridgeState !== 'connected') return
    const sanitizedHtml = sanitizeEditedHtml(article.html)
    if (!hasArticleBodyContent(sanitizedHtml)) {
      setError('正文为空，至少填写一段内容后再发布。')
      setIsDispatchDrawerOpen(true)
      return
    }
    if (!beginExclusiveOperation('publish')) return
    const publishAttempt = ++publishAttemptRef.current
    const selectedAccounts = accounts.filter(account => selectedIds.includes(account.id))
    if (selectedAccounts.length === 0) {
      setError('所选平台已失效，请重新选择后再发布。')
      endExclusiveOperation('publish')
      return
    }
    const normalizedArticle = { ...article, html: sanitizedHtml }
    const targetForAccount = (account: PlatformAccount): PlatformContentTarget => {
      if (accountMatchesPreview(account, 'wechat')) return 'wechat'
      if (accountMatchesPreview(account, 'xhs')) return 'xhs'
      if (accountMatchesPreview(account, 'x')) return 'x'
      return 'generic'
    }
    const buildPlatformArticle = (target: PlatformContentTarget): ArticleDraft => {
      const targetFormatting = articleFormattingForTarget(formatting, target)
      const formattedHtml = applyArticleFormatting(sanitizedHtml, targetFormatting)
      const themedHtml = target === 'wechat'
        ? applyWechatTheme(formattedHtml, targetFormatting.wechat, targetFormatting)
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
      const isCurrentPublish = () => publishAttemptRef.current === publishAttempt
      const updateGroupResults = (groupResults: PublishResult[]) => {
        if (!isCurrentPublish()) return
        groupResults.forEach(result => resultsByPlatform.set(result.platform, result))
        setResults(selectedAccounts.map(account => resultsByPlatform.get(account.id) ?? {
          platform: account.id,
          name: account.name,
          status: 'pending' as const,
          delivery: platformAccountType(account) === 'zip-download' ? 'download' as const : 'draft' as const,
          message: '等待扩展处理',
        }))
      }
      updateGroupResults([])
      for (const [groupIndex, group] of groups.entries()) {
        try {
          const groupResults = await publishDraft(group.article, group.accounts, updateGroupResults)
          if (!isCurrentPublish()) return
          groupResults.forEach(result => resultsByPlatform.set(result.platform, result))
        } catch (groupError) {
          if (!isCurrentPublish()) return
          const failingIds = new Set(group.accounts.map(account => account.id))
          const notStartedIds = new Set(groups.slice(groupIndex + 1).flatMap(pendingGroup => pendingGroup.accounts.map(account => account.id)))
          const failureMessage = (groupError as Error).message
          const interruptedResults = selectedAccounts.map(account => {
            const existing = resultsByPlatform.get(account.id)
            if (existing && (existing.status === 'done' || existing.status === 'failed')) return existing
            return {
              platform: account.id,
              name: account.name,
              status: 'failed' as const,
              delivery: platformAccountType(account) === 'zip-download' ? 'download' as const : 'draft' as const,
              message: failingIds.has(account.id) ? '任务状态未知，请先检查平台草稿箱再重试。' : '因前序平台异常，本次未执行。',
              error: failingIds.has(account.id) ? failureMessage : notStartedIds.has(account.id) ? '本次未执行' : failureMessage,
              requiresManualVerification: failingIds.has(account.id),
            }
          })
          setResults(interruptedResults)
          setSelectedIds(interruptedResults.filter(result => result.status !== 'done').map(result => result.platform))
          setWorkState('ready')
          setError(`发布未全部完成：${failureMessage}。已成功的平台不会在下次重试时自动重发。`)
          return
        }
      }
      if (!isCurrentPublish()) return
      const finalResults = selectedAccounts.map(account => resultsByPlatform.get(account.id) ?? {
        platform: account.id,
        name: account.name,
        status: 'failed' as const,
        delivery: platformAccountType(account) === 'zip-download' ? 'download' as const : 'draft' as const,
        message: '发布引擎未返回该平台的最终状态',
      })
      setResults(finalResults)
      const retryIds = finalResults.filter(result => result.status !== 'done').map(result => result.platform)
      if (retryIds.length > 0) setSelectedIds(retryIds)
      setWorkState('completed')
    } catch (publishError) {
      if (publishAttemptRef.current !== publishAttempt) return
      setWorkState('ready')
      setError((publishError as Error).message)
    } finally {
      endExclusiveOperation('publish')
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
  const isOperationLocked = exclusiveOperation !== null
  const hasPublishableArticle = Boolean(article && hasArticleBodyContent(article.html))
  const articleHtml = article?.html ?? ''
  const deferredArticleHtml = useDeferredValue(articleHtml)
  const deferredFormatting = useDeferredValue(formatting)
  const isPreviewUpdating = deferredArticleHtml !== articleHtml || deferredFormatting !== formatting
  useEffect(() => {
    if (!article || !activeEditorLocation || isPreviewUpdating) return
    previewLocateRequestIdRef.current += 1
    setPreviewLocateRequest({
      blockIndex: activeEditorLocation.blockIndex,
      line: activeEditorLocation.line,
      requestId: previewLocateRequestIdRef.current,
    })
  }, [activeEditorLocation, activePlatform, article?.id, isPreviewUpdating])
  const previewFormatting = useMemo(
    () => articleFormattingForTarget(formatting, activePlatform),
    [activePlatform, formatting],
  )
  const previewHtml = useMemo(
    () => deferredArticleHtml
      ? applyArticleFormatting(
          sanitizeEditedHtml(deferredArticleHtml),
          articleFormattingForTarget(deferredFormatting, activePlatform),
        )
      : '',
    [activePlatform, deferredArticleHtml, deferredFormatting],
  )
  const articleSource = useMemo(
    () => article ? resolveArticleSource(article) : null,
    [article?.html, article?.markdown, article?.sourceLanguage, article?.sourceText],
  )
  const articleContent = useMemo(
    () => article ? analyzeArticleContent(article.html) : { characterCount: 0, bodyImageCount: 0, resources: [] },
    [article?.html],
  )
  const previewAccount = useMemo(
    () => accounts.find(account => accountMatchesPreview(account, activePlatform)),
    [accounts, activePlatform],
  )

  return (
    <div className="app-shell article-open">
      <header ref={topbarRef} className={`topbar ${article ? 'workbench-topbar' : ''}`}>
        <div className="brand-cluster">
          <a className="brand" href="/" aria-label="EZWRITING 首页">
            <span className="brand-mark" aria-hidden="true"><img src={brandLogo} alt="" /></span>
            <span>EZWRITING</span>
          </a>
          <a
            className="github-repository-link"
            href="https://github.com/KeepATARAXIA/ezWriting"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在新标签页打开 GitHub 仓库"
            title="GitHub 仓库"
          ><img src={githubLogo} alt="" aria-hidden="true" /></a>
        </div>
        {article ? (
          <div className="topbar-workbench" role="group" aria-label="工作台操作">
            <nav className="workbench-navigation topbar-command-flow" aria-label="新建、平台与视图">
              <button
                type="button"
                className="new-document-button topbar-document-command"
                data-topbar-group="new"
                aria-label="新建文档"
                onClick={() => void createNewArticle()}
                disabled={workState === 'parsing' || isOperationLocked}
                title="保存当前稿件并新建文档"
              >
                <FilePlus2 size={16} />
                <span>新建</span>
              </button>

              <span className="workbench-navigation-divider" aria-hidden="true" />

              <div className="platform-switcher topbar-platform-group" data-topbar-group="platform" role="tablist" aria-label="选择预览平台">
                {PREVIEW_PLATFORMS.map(platform => (
                  <button
                    type="button"
                    role="tab"
                    key={platform.id}
                    aria-label={platform.accessibleLabel}
                    aria-selected={activePlatform === platform.id}
                    aria-controls="platform-preview-panel"
                    className={activePlatform === platform.id ? 'active' : ''}
                    disabled={isOperationLocked}
                    onClick={() => setActivePlatform(platform.id)}
                  >
                    <span className={`platform-logo ${platform.id}`} aria-hidden="true"><img src={platform.logo} alt="" /></span>
                    <strong>{platform.label}</strong>
                  </button>
                ))}
              </div>

              <span className="workbench-navigation-divider" aria-hidden="true" />

              <div className="workspace-mode-switcher topbar-view-group" data-topbar-group="view" role="group" aria-label="工作区显示方式">
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
            </nav>

            <div className="workbench-actions" role="group" aria-label="发布状态与操作">
              <button
                type="button"
                className={`extension-chip topbar-status-command ${bridgeState}`}
                data-topbar-group="status"
                onClick={handleBridgeStatusClick}
                disabled={bridgeState === 'checking' || isOperationLocked}
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

              <div className="topbar-publish-group" data-topbar-group="publish" role="group" aria-label="发布操作">
                <DispatchControls
                  accounts={accounts}
                  bridgeError={bridgeError}
                  bridgeState={bridgeState}
                  hasArticle={hasPublishableArticle}
                  installGuide={installGuide}
                  interactionLocked={isOperationLocked}
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
          <div className="topbar-meta home-topbar-meta">
            <button
              type="button"
              className={`home-status-summary ${bridgeState}`}
              onClick={handleBridgeStatusClick}
              disabled={bridgeState === 'checking' || isOperationLocked}
              aria-label={bridgeState === 'missing' || bridgeState === 'error' ? '打开发布引擎安装指引' : '重新检测发布引擎'}
              aria-expanded={bridgeState === 'missing' || bridgeState === 'error' ? isDispatchDrawerOpen : undefined}
              aria-haspopup={bridgeState === 'missing' || bridgeState === 'error' ? 'dialog' : undefined}
              aria-live="polite"
            >
              {bridgeState === 'checking' && <LoaderCircle className="spin" size={14} />}
              {bridgeState === 'connected' && <PlugZap size={14} />}
              {(bridgeState === 'missing' || bridgeState === 'error') && <CircleAlert size={14} />}
              <span>{bridgeState === 'checking' ? '正在检测发布通道' : bridgeState === 'connected' ? `已连接 ${accounts.length} 个平台` : bridgeState === 'error' ? '发布通道异常' : '发布通道待连接'}</span>
              <span className="home-status-divider" aria-hidden="true" />
              <ShieldCheck size={14} aria-hidden="true" />
              <span>文件保存在本地</span>
            </button>
            <span className="version-chip home-version-chip">BETA · 0.2</span>
            <DispatchControls
              accounts={accounts}
              bridgeError={bridgeError}
              bridgeState={bridgeState}
              hasArticle={false}
              installGuide={installGuide}
              interactionLocked={isOperationLocked}
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
            activeSaveStatus={autosave.status}
            isExpanded={historyOverlayOpen || historyExpanded}
            undoDraft={undoDraft}
            onToggleExpanded={toggleHistorySidebar}
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
            onExportDiagnostics={exportReliabilityData}
            backupStatus={backupStatus}
            interactionLocked={isOperationLocked}
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
                <div className="empty-workbench-content">
                  <input ref={fileInputRef} type="file" accept=".md,.markdown,.html,.htm,.zip" onChange={event => void importSelection(Array.from(event.target.files || []))} hidden />
                  <input ref={directoryInputRef} type="file" multiple onChange={event => void importSelection(Array.from(event.target.files || []))} {...{ webkitdirectory: '', directory: '' }} hidden />
                  <section className="empty-workbench-hero" aria-labelledby="empty-workbench-title">
                    <div className="home-platform-list" aria-label="支持的内容平台">
                      {PREVIEW_PLATFORMS.map(platform => (
                        <span key={platform.id}>
                          <span className={`platform-logo ${platform.id}`} aria-hidden="true"><img src={platform.logo} alt="" /></span>
                          <strong>{platform.label}</strong>
                        </span>
                      ))}
                      <small>持续扩展</small>
                    </div>
                    <h1 id="empty-workbench-title">写一次，适配并发布到多个平台</h1>
                    <p>支持微信公众号、小红书、X 等平台的内容编辑、预览与分发</p>
                    <div className="drop-actions">
                      <button type="button" className="primary-button" onClick={() => void createNewArticle()} disabled={workState === 'parsing' || isOperationLocked}>
                        <FilePlus2 size={19} />
                        开始创作
                        <ArrowRight size={18} />
                      </button>
                    </div>
                  </section>

                  <section
                    className={`workbench-drop-zone home-import-zone ${isDragging ? 'dragging' : ''}`}
                    aria-label="导入已有内容"
                    aria-busy={workState === 'parsing'}
                    onDragEnter={event => { event.preventDefault(); setIsDragging(true) }}
                    onDragOver={event => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                      setIsDragging(true)
                    }}
                    onDragLeave={event => {
                      event.preventDefault()
                      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                      setIsDragging(false)
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      setIsDragging(false)
                      void importSelection(Array.from(event.dataTransfer.files))
                    }}
                  >
                    <button
                      type="button"
                      className="home-import-drop-target"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={workState === 'parsing' || isOperationLocked}
                    >
                      <span className="home-import-icon" aria-hidden="true">
                        {workState === 'parsing' ? <LoaderCircle className="spin" size={28} /> : <FileUp size={28} />}
                      </span>
                      <span className="home-import-copy" aria-live="polite">
                        <strong>{workState === 'parsing' ? '正在解析并整理内容…' : isDragging ? '松开即可导入内容' : '将文件拖到这里，或点击选择文件'}</strong>
                        <span>{isDragging ? '我们会在本地解析文件，并直接打开编辑工作台' : '支持 Markdown、HTML、ZIP · 导入后进入编辑与多平台预览'}</span>
                      </span>
                    </button>
                    <div className="home-import-actions">
                      <button type="button" className="folder-button" onClick={() => fileInputRef.current?.click()} disabled={workState === 'parsing' || isOperationLocked}><FileUp size={17} /> 选择文件</button>
                      <button type="button" className="directory-link" onClick={() => directoryInputRef.current?.click()} disabled={workState === 'parsing' || isOperationLocked}><FolderOpen size={17} /> 选择文件夹</button>
                    </div>
                    {error && (
                      <div className="import-error" role="alert">
                        <CircleAlert size={17} />
                        <span>{error}</span>
                        <button type="button" onClick={() => setError(null)} aria-label="关闭错误提示"><XCircle size={16} /></button>
                      </div>
                    )}
                  </section>

                  <section className="home-workbench-overview" aria-labelledby="home-workbench-heading">
                    <header>
                      <div>
                        <h2 id="home-workbench-heading">内容从文件进入发布轨道</h2>
                        <p>本地完成整理和预览，确认后再保存到各平台草稿箱。</p>
                      </div>
                      <dl className="home-workbench-stats" aria-label="工作台状态">
                        <div><dt>本地草稿</dt><dd>{homeDrafts.length}</dd></div>
                        <div><dt>已连接平台</dt><dd>{bridgeState === 'connected' ? accounts.length : '—'}</dd></div>
                      </dl>
                    </header>
                    <ol className="home-workflow">
                      <li>
                        <span><FilePlus2 size={21} /></span>
                        <div><strong>创建或导入</strong><small>从空白文档、文件或内容包开始</small></div>
                        <ArrowRight className="home-workflow-arrow" size={18} aria-hidden="true" />
                      </li>
                      <li>
                        <span><Columns2 size={21} /></span>
                        <div><strong>编辑与预览</strong><small>同步检查不同平台的实际效果</small></div>
                        <ArrowRight className="home-workflow-arrow" size={18} aria-hidden="true" />
                      </li>
                      <li>
                        <span><Upload size={21} /></span>
                        <div><strong>保存或发布</strong><small>人工复核后，再进入平台发布流程</small></div>
                      </li>
                    </ol>
                  </section>

                  {homeDrafts.length > 0 && (
                    <section className="home-recent-section" aria-labelledby="home-recent-heading">
                      <header>
                        <div>
                          <h2 id="home-recent-heading">最近文档</h2>
                          <p>继续处理保存在本机的内容。</p>
                        </div>
                        <span>{homeDrafts.length} 篇本地稿件</span>
                      </header>
                      <div className="home-recent-grid">
                        {homeDrafts.slice(0, 3).map(draft => (
                          <button type="button" key={draft.id} onClick={() => void selectHistoryDraft(draft.id)} disabled={isOperationLocked}>
                            <span className="home-recent-icon"><FileText size={20} aria-hidden="true" /></span>
                            <span>
                              <strong>{draft.title.trim() || '未命名稿件'}</strong>
                              <small><Clock3 size={13} aria-hidden="true" /> {formatHomeDraftDate(draft.updatedAt)}</small>
                            </span>
                            <ArrowRight size={17} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="home-template-section" aria-labelledby="home-template-heading">
                    <header>
                      <div>
                        <h2 id="home-template-heading">常用模板</h2>
                        <p>{homeDrafts.length === 0 ? '还没有最近文档，先用一个轻量结构开始。' : '需要新起一篇时，直接套用常用结构。'}</p>
                      </div>
                      <span>3 个起稿模板</span>
                    </header>
                    <div className="home-template-grid">
                      {HOME_STARTER_TEMPLATES.map(template => {
                        const platform = PREVIEW_PLATFORMS.find(item => item.id === template.platform)!
                        return (
                          <button
                            type="button"
                            className="home-template-card"
                            key={template.id}
                            onClick={() => void createArticleFromTemplate(template)}
                            disabled={isOperationLocked}
                            aria-label={`使用${template.title}模板开始`}
                          >
                            <span className={`platform-logo ${platform.id}`} aria-hidden="true"><img src={platform.logo} alt="" /></span>
                            <span className="home-template-copy">
                              <strong>{template.title}</strong>
                              <small>{template.description}</small>
                            </span>
                            <ArrowRight size={17} aria-hidden="true" />
                          </button>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </section>
            ) : (
              <div
                ref={editorGridRef}
                className={`editor-grid workspace-mode-${workspaceMode}`}
                data-preview-platform={activePlatform}
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
                        disabled={workState === 'parsing' || isOperationLocked}
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
                          disabled={isOperationLocked}
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
                            readOnly={isOperationLocked}
                            onChange={updateArticleSource}
                            onActiveBlockChange={updateActiveEditorLocation}
                          />
                        </Suspense>
                      </section>

                      <footer className="article-stats" aria-label="稿件统计">
                        <span>字数 <strong>{articleContent.characterCount}</strong></span>
                        <span>图片 <strong>{articleContent.bodyImageCount}</strong></span>
                        <span>{sourceLabel(article)}</span>
                      </footer>
                    </div>
                  ) : (
                    <section ref={resourcesPanelRef} className="resource-panel editor-view-panel" id="article-resource-view" role="tabpanel" aria-labelledby="resource-panel-heading">
                      <header className="resource-panel-heading">
                        <div>
                          <p>DOCUMENT ASSETS</p>
                          <h2 id="resource-panel-heading">文档资源</h2>
                          <span>点击正文图片可在右侧定位上下文；缺图时可一次选择多张图片或整个文件夹补齐。</span>
                        </div>
                        <div className="resource-actions">
                          <input ref={assetInputRef} type="file" accept="image/*" multiple onChange={event => void supplementAssets(Array.from(event.target.files || []))} hidden />
                          <input ref={assetDirectoryInputRef} type="file" multiple onChange={event => void supplementAssets(Array.from(event.target.files || []))} {...{ webkitdirectory: '', directory: '' }} hidden />
                          <button type="button" disabled={isOperationLocked} onClick={() => assetInputRef.current?.click()}><ImagePlus size={15} /> 批量选择图片</button>
                          <button type="button" disabled={isOperationLocked} onClick={() => assetDirectoryInputRef.current?.click()}><FolderOpen size={15} /> 选择文件夹</button>
                        </div>
                      </header>

                      {(article.missingAssets?.length || 0) > 0 && (
                        <div className="asset-repair" role="status">
                          <div className="asset-repair-icon"><ImagePlus size={18} /></div>
                          <div className="asset-repair-copy"><strong>还差 {article.missingAssets?.length} 张本地图片</strong><p>{article.missingAssets?.slice(0, 3).join(' · ')}</p></div>
                          <div className="asset-repair-actions">
                            <button type="button" disabled={isOperationLocked} onClick={() => assetInputRef.current?.click()}>选择图片</button>
                            <button type="button" disabled={isOperationLocked} onClick={() => assetDirectoryInputRef.current?.click()}>选择文件夹</button>
                          </div>
                        </div>
                      )}

                      {articleContent.resources.length > 0 ? (
                        <div className="resource-grid" aria-label={`共 ${articleContent.resources.length} 张图片`}>
                          {articleContent.resources.map((resource, index) => (
                            <figure className={`article-resource-card ${resource.missingTarget ? 'missing' : ''}`} data-resource-kind={resource.kind} key={resource.id}>
                              <button
                                type="button"
                                className="resource-card-locate"
                                aria-label={`在右侧定位：${resource.name}`}
                                disabled={resource.blockIndex === undefined || resource.blockIndex < 0}
                                onClick={() => locateResourceInPreview(resource)}
                              >
                                <span className="resource-thumbnail">
                                  {resource.missingTarget
                                    ? <span className="resource-missing-thumbnail"><ImagePlus size={22} /><span>图片待处理</span></span>
                                    : <img src={resource.src} alt={resource.name} />}
                                </span>
                                <span className="resource-card-copy">
                                  <strong>{resource.name}</strong>
                                  <span>{resource.missingTarget ? resource.missingTarget.reference : resource.src.startsWith('data:image/') ? '本地图片' : /^https?:\/\//i.test(resource.src) ? '外链图片' : '文档路径'}</span>
                                </span>
                                <small>{String(index + 1).padStart(2, '0')}</small>
                              </button>
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
                    title="拖动调整宽度，双击恢复当前平台默认比例"
                    onPointerDown={startPaneResize}
                    onPointerMove={movePaneResize}
                    onPointerUp={finishPaneResize}
                    onPointerCancel={finishPaneResize}
                    onDoubleClick={() => updateEditorPanePercent(DEFAULT_EDITOR_PANE_PERCENT_BY_PLATFORM[activePlatform], true, activePlatform)}
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
                            formatting={previewFormatting}
                            onFormattingChange={nextFormatting => updateArticleFormatting(
                              activePlatform === 'x'
                                ? nextFormatting
                                : { ...nextFormatting, theme: formatting.theme },
                            )}
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
      {(backupNotice || historyError || autosave.error) && (
        <div className={`local-history-notice ${!backupNotice && (historyError || autosave.error) ? 'error' : ''}`} role="status" aria-live="polite">
          <span>{backupNotice || historyError || (autosave.error ? `自动保存失败：${autosave.error.message}` : null)}</span>
          <button type="button" aria-label="关闭提示" onClick={() => { setHistoryError(null); setBackupNotice(null) }}><XCircle size={15} /></button>
        </div>
      )}
    </div>
  )
}
