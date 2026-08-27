import JSZip from 'jszip'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
} from 'react'
import {
  BatteryFull,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  Heart,
  Layers3,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Minus,
  Monitor,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Share2,
  Signal,
  Smartphone,
  Square,
  UserRound,
  Wifi,
  X as CloseIcon,
} from 'lucide-react'
import {
  ARTICLE_ACCENT_COLORS,
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_SIZES,
  ARTICLE_LINE_HEIGHTS,
  type ArticleFormatting,
} from '../domain/formatting'
import {
  DEFAULT_XHS_CARD_SETTINGS,
  normalizeXhsImageOverride,
  type XhsCardSettings,
  type XhsCardTemplate,
  type XhsImageLayout,
} from '../domain/saved-draft'
import { captureXhsCard, downloadBlob, safeDownloadName } from '../lib/xhs-export'
import { paginateForXhsCards } from '../lib/xhs-pagination'
import { createXhsCardPageMeasurer, waitForXhsPaginationAssets } from '../lib/xhs-pagination-measurement'
import { renderMissingImagePlaceholders } from '../lib/missing-assets'
import {
  applyWechatTheme,
  getWechatTheme,
  getWechatThemeCategory,
  getWechatThemeColorSlots,
  normalizeWechatThemeSettings,
  WECHAT_THEME_CATEGORIES,
  WECHAT_THEMES,
  type WechatThemeCategory,
  type WechatThemeId,
} from '../lib/wechat-theme'
import type { ArticleSourceLanguage, MissingImageAction, MissingImageTarget, PlatformAccount } from '../domain/article'
import { sourceLinesByBlock } from '../lib/article-source'
import { applyPlatformCompatibilityToDocument, type PlatformContentTarget } from '../lib/platform-compatibility'
import { prepareXhsImageLayout, type XhsPreparedImage } from '../lib/xhs-image-layout'
import xhsLogo from '../../SVG/小红书.svg'
import xLogo from '../../SVG/x.svg'

export type PreviewPlatform = 'wechat' | 'xhs' | 'x'
export type PreviewDevice = 'desktop' | 'mobile'
export type PreviewEditTarget =
  | { kind: 'title' }
  | { kind: 'body'; blockIndex: number; line?: number }
export interface PreviewLocateRequest {
  blockIndex: number
  line?: number
  requestId: number
}

type XhsPreviewMode = 'single' | 'spread' | 'all'
type WechatCopyState = 'idle' | 'copying' | 'success' | 'error'
type FormattingSection = 'layout' | 'font' | 'spacing' | 'color'

interface XhsImagePopoverPosition {
  key: string
  left: number
  top: number
}

interface PlatformPreviewsProps {
  activePlatform: PreviewPlatform
  title: string
  html: string
  sourceText?: string
  sourceLanguage?: ArticleSourceLanguage
  formatting: ArticleFormatting
  onFormattingChange?: (formatting: ArticleFormatting) => void
  xhsSettings?: XhsCardSettings
  onXhsSettingsChange?: (settings: XhsCardSettings) => void
  previewAccount?: PlatformAccount
  previewDevice: PreviewDevice
  isUpdating?: boolean
  onPreviewDeviceChange: (device: PreviewDevice) => void
  locateRequest?: PreviewLocateRequest | null
  onEditTarget?: (target: PreviewEditTarget) => void
  onMissingImageAction?: (target: MissingImageTarget, action: MissingImageAction) => void
}

interface XhsTemplateOption {
  value: XhsCardTemplate
  label: string
  detail: string
}

type XhsTemplateCategoryId = 'inspiration' | 'editorial' | 'paper' | 'information' | 'composition'

interface XhsTemplateCategory {
  id: XhsTemplateCategoryId
  label: string
  detail: string
  templates: XhsTemplateOption[]
}

const XHS_TEMPLATE_CATEGORIES: XhsTemplateCategory[] = [
  {
    id: 'inspiration',
    label: '灵感',
    detail: '明快、手写与情绪表达',
    templates: [
      { value: 'memo', label: '灵感备忘', detail: '深色卡片 · 亮黄标注' },
      { value: 'quote', label: '轻感明快', detail: '柠檬纸色 · 大号引语' },
      { value: 'doodle', label: '涂鸦马克', detail: '手写标记 · 蓝色涂鸦' },
      { value: 'soft', label: '黄昏手稿', detail: '暖粉纸色 · 手稿气质' },
    ],
  },
  {
    id: 'editorial',
    label: '杂志',
    detail: '网格、几何与编辑设计',
    templates: [
      { value: 'retro', label: '线条复古', detail: '细线框架 · 复古图文' },
      { value: 'geometry', label: '优雅几何', detail: '留白几何 · 柔色构成' },
      { value: 'headline', label: '杂志先锋', detail: '荧光标题 · 杂志网格' },
      { value: 'editorial', label: '文艺清新', detail: '书卷留白 · 图文散文' },
    ],
  },
  {
    id: 'paper',
    label: '纸感',
    detail: '手帐、纹理与书卷气质',
    templates: [
      { value: 'journal', label: '手帐书写', detail: '胶带照片 · 旅行手帐' },
      { value: 'texture', label: '素雅底纹', detail: '淡蓝纸纹 · 典雅宋体' },
      { value: 'mono', label: '黑白极简', detail: '暖白纸张 · 极简长文' },
      { value: 'dust', label: '札记集尘', detail: '竖排题签 · 旧纸札记' },
    ],
  },
  {
    id: 'information',
    label: '信息',
    detail: '知识、结构与清晰阅读',
    templates: [
      { value: 'focus', label: '清晰明朗', detail: '建筑留白 · 清晰标题' },
      { value: 'index', label: '理性现代', detail: '红黑秩序 · 学术信息' },
      { value: 'logic', label: '逻辑结构', detail: '粉色标线 · 逻辑拆解' },
      { value: 'clean', label: '简约基础', detail: '中性留白 · 基础长文' },
    ],
  },
  {
    id: 'composition',
    label: '构成',
    detail: '大图、叙事与色块编排',
    templates: [
      { value: 'hero', label: '大图纯字', detail: '大图封面 · 纯字叠加' },
      { value: 'narrative', label: '平实叙事', detail: '黑白图文 · 平实叙述' },
      { value: 'fresh', label: '拼接色块', detail: '荧光拼接 · 信息卡片' },
      { value: 'topology', label: '交叉拓扑', detail: '绿橙色块 · 交叉构成' },
    ],
  },
]

const XHS_TEMPLATE_OPTIONS = XHS_TEMPLATE_CATEGORIES.flatMap(category => category.templates)

function xhsTemplateCategoryFor(template: XhsCardTemplate): XhsTemplateCategoryId {
  return XHS_TEMPLATE_CATEGORIES.find(category => category.templates.some(option => option.value === template))?.id ?? 'information'
}

const TOOL_RAIL_DEFAULT_WIDTH = 280
const TOOL_RAIL_MIN_WIDTH = 240
const TOOL_RAIL_MAX_WIDTH = 420
const TOOL_RAIL_COLLAPSE_WIDTH = 180
const TOOL_RAIL_WIDTH_KEY = 'dispatch.preview-tool-rail-width.v1'
const TOOL_RAIL_OPEN_KEY = 'dispatch.preview-tool-rail-open.v1'
const XHS_FONT_SIZE_SCALE = { small: 0.9, medium: 1, large: 1.1 } as const
const XHS_LINE_HEIGHT_SCALE = { compact: 0.92, comfortable: 1, airy: 1.1 } as const
const XHS_FONT_SIZES = { small: '13.5px', medium: '15px', large: '16.5px' } as const
const XHS_LINE_HEIGHTS = { compact: '1.58', comfortable: '1.72', airy: '1.9' } as const
const XHS_PREVIEW_MIN_ZOOM = 25
const XHS_PREVIEW_MAX_ZOOM = 300
const XHS_PREVIEW_ZOOM_STEP = 25
const XHS_IMAGE_FULL_MIN_WIDTH = 35
const XHS_IMAGE_SPLIT_MIN_WIDTH = 30
const XHS_IMAGE_SPLIT_MAX_WIDTH = 70
const XHS_IMAGE_POPOVER_WIDTH = 300
const XHS_IMAGE_POPOVER_HEIGHT = 205
const XHS_IMAGE_POPOVER_GAP = 12
const XHS_PAGE_RANGE_SIZE = 10
const PREVIEW_LOCATE_SETTLE_MS = 1000
const PREVIEW_TARGET_FLASH_MS = 1500

interface XhsImageResizeSession {
  pointerId: number
  key: string
  startX: number
  startWidth: number
  direction: -1 | 1
  layout: XhsImageLayout
  contentWidth: number
}

interface XhsPageRange {
  start: number
  end: number
  label: string
}

function formatXhsPageNumber(value: number, total: number): string {
  return String(value).padStart(Math.max(2, String(total).length), '0')
}

function createXhsPageRanges(total: number): XhsPageRange[] {
  return Array.from({ length: Math.ceil(total / XHS_PAGE_RANGE_SIZE) }, (_, rangeIndex) => {
    const start = rangeIndex * XHS_PAGE_RANGE_SIZE
    const end = Math.min(total - 1, start + XHS_PAGE_RANGE_SIZE - 1)
    const first = formatXhsPageNumber(start + 1, total)
    const last = formatXhsPageNumber(end + 1, total)
    return { start, end, label: start === end ? first : `${first}–${last}` }
  })
}

function readToolRailWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(TOOL_RAIL_WIDTH_KEY))
    return Number.isFinite(value) ? Math.min(TOOL_RAIL_MAX_WIDTH, Math.max(TOOL_RAIL_MIN_WIDTH, value)) : TOOL_RAIL_DEFAULT_WIDTH
  } catch {
    return TOOL_RAIL_DEFAULT_WIDTH
  }
}

function readToolRailOpen(): Record<PreviewPlatform, boolean> {
  try {
    const value = JSON.parse(window.localStorage.getItem(TOOL_RAIL_OPEN_KEY) || '{}') as Partial<Record<PreviewPlatform, boolean>>
    return { wechat: value.wechat ?? true, xhs: value.xhs ?? true, x: value.x ?? false }
  } catch {
    return { wechat: true, xhs: true, x: false }
  }
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function plainTextLength(html: string): number {
  const document = parseHtml(html)
  document.body.querySelectorAll('.missing-image-actions').forEach(element => element.remove())
  return Array.from(document.body.textContent || '').length
}

function directImageLineTarget(node: ChildNode): HTMLElement | null {
  if (node instanceof HTMLImageElement) return node
  if (!(node instanceof HTMLElement) || node.childElementCount !== 1 || node.textContent?.trim()) return null
  return node.firstElementChild instanceof HTMLImageElement ? node : null
}

function mixedParagraphLineTargets(element: HTMLElement, expectedLineCount: number): HTMLElement[] | null {
  if (!element.matches('p') || expectedLineCount < 2) return null

  const groups: Array<{ nodes: ChildNode[]; imageTarget?: HTMLElement }> = []
  let inlineNodes: ChildNode[] = []
  let hasImageLine = false
  const flushInlineNodes = () => {
    if (inlineNodes.some(node => node instanceof Element || Boolean(node.textContent?.trim()))) {
      groups.push({ nodes: inlineNodes })
    }
    inlineNodes = []
  }

  Array.from(element.childNodes).forEach(node => {
    const imageTarget = directImageLineTarget(node)
    if (!imageTarget) {
      inlineNodes.push(node)
      return
    }
    flushInlineNodes()
    groups.push({ nodes: [node], imageTarget })
    hasImageLine = true
  })
  flushInlineNodes()

  if (!hasImageLine || groups.length !== expectedLineCount) return null

  return groups.map(group => {
    if (group.imageTarget) return group.imageTarget
    const wrapper = element.ownerDocument.createElement('span')
    wrapper.className = 'preview-source-line-target'
    group.nodes[0].before(wrapper)
    wrapper.append(...group.nodes)
    return wrapper
  })
}

function previewLineTargets(element: HTMLElement, expectedLineCount: number): HTMLElement[] {
  if (element.matches('ul, ol')) {
    return Array.from(element.querySelectorAll<HTMLElement>(':scope > li'))
  }
  if (element.matches('table')) {
    return Array.from(element.querySelectorAll<HTMLElement>('tr'))
  }
  if (element.matches('aside[data-callout]')) {
    const title = element.querySelector<HTMLElement>('[data-callout-title]')
    const content = element.querySelector<HTMLElement>('[data-callout-content]')
    const contentLines = content
      ? Array.from(content.querySelectorAll<HTMLElement>(':scope > p, :scope > ul > li, :scope > ol > li, :scope > pre, :scope > blockquote'))
      : []
    return [...(title ? [title] : []), ...contentLines]
  }
  if (element.matches('blockquote')) {
    const children = Array.from(element.querySelectorAll<HTMLElement>(':scope > p, :scope > ul > li, :scope > ol > li'))
    if (children.length) return children
  }
  const mixedParagraphTargets = mixedParagraphLineTargets(element, expectedLineCount)
  if (mixedParagraphTargets) return mixedParagraphTargets
  return [element]
}

function samePages(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((page, index) => page === right[index])
}

function copyRichHtmlWithSelection(html: string): void {
  const container = document.createElement('div')
  container.contentEditable = 'true'
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;opacity:0;pointer-events:none;'
  container.innerHTML = html
  document.body.append(container)

  const selection = window.getSelection()
  const previousRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : []
  const range = document.createRange()
  range.selectNodeContents(container)
  selection?.removeAllRanges()
  selection?.addRange(range)

  try {
    if (!document.execCommand?.('copy')) throw new Error('当前浏览器不支持复制公众号格式')
  } finally {
    selection?.removeAllRanges()
    previousRanges.forEach(previousRange => selection?.addRange(previousRange))
    container.remove()
  }
}

async function copyRichHtml(html: string): Promise<void> {
  const document = parseHtml(html)
  const plainText = (document.body.textContent || '').trim()
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plainText], { type: 'text/plain' }),
    })])
    return
  }
  copyRichHtmlWithSelection(html)
}

function makePreviewTarget(element: HTMLElement, blockIndex: number, line?: number): void {
  element.setAttribute('data-source-block', String(blockIndex))
  if (line !== undefined) element.setAttribute('data-source-line', String(line))
  element.setAttribute('tabindex', '0')
  element.setAttribute('role', 'button')
  element.setAttribute('aria-label', line === undefined
    ? `选择第 ${blockIndex + 1} 个内容块，在左侧编辑`
    : `选择源码第 ${line} 行，在左侧编辑`)
}

function mapPreviewBlocks(
  html: string,
  sourceLines: number[][] = [],
  target: PlatformContentTarget = 'generic',
): { html: string; blockCount: number } {
  const document = parseHtml(html)
  applyPlatformCompatibilityToDocument(document, target)
  const themedContainer = document.body.querySelector<HTMLElement>(':scope > [data-wechat-theme]')
  const blocks = Array.from(themedContainer?.children ?? document.body.children) as HTMLElement[]
  let blockIndex = 0
  blocks.forEach(element => {
    if (element.hasAttribute('data-source-spacer')) return
    const index = blockIndex
    blockIndex += 1
    element.setAttribute('data-source-block', String(index))
    if (element.classList.contains('missing-image-card')) return
    const lines = sourceLines[index] ?? []
    const targets = lines.length ? previewLineTargets(element, lines.length) : [element]
    targets.forEach((target, targetIndex) => {
      makePreviewTarget(target, index, lines[targetIndex] ?? lines[lines.length - 1])
    })
  })
  document.body.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    image.loading = 'lazy'
    image.decoding = 'async'
  })
  return { html: document.body.innerHTML, blockCount: blockIndex }
}

function decorateInteractiveXhsImage(pageHtml: string, selectedKey: string | null): string {
  if (!selectedKey) return pageHtml
  const document = parseHtml(pageHtml)
  const image = Array.from(document.body.querySelectorAll<HTMLImageElement>('img[data-xhs-image-key]'))
    .find(candidate => candidate.dataset.xhsImageKey === selectedKey)
  if (!image) return pageHtml

  const frame = document.createElement('span')
  frame.className = 'xhs-image-selection-frame'
  frame.dataset.xhsImageKey = selectedKey
  frame.style.width = image.style.width || '100%'
  image.style.width = '100%'
  image.dataset.xhsImageSelected = 'true'
  image.replaceWith(frame)
  frame.append(image)

  ;(['nw', 'ne', 'sw', 'se'] as const).forEach(handle => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `xhs-image-resize-handle ${handle}`
    button.dataset.xhsResizeHandle = handle
    button.dataset.xhsImageKey = selectedKey
    button.tabIndex = -1
    button.setAttribute('aria-label', `从${handle.includes('n') ? '上' : '下'}${handle.includes('w') ? '左' : '右'}角调整图片大小`)
    frame.append(button)
  })

  return document.body.innerHTML
}

function FontControls({
  formatting,
  onChange,
}: {
  formatting: ArticleFormatting
  onChange?: (formatting: ArticleFormatting) => void
}) {
  return (
    <div className="article-formatting-controls article-font-controls">
      <section className="x-formatting-section">
        <strong>字体</strong>
        <div className="x-formatting-options" role="radiogroup" aria-label="选择文章字体">
          {([['sans', '黑体'], ['serif', '宋体']] as const).map(([value, label]) => <button type="button" role="radio" aria-checked={formatting.font === value} className={formatting.font === value ? 'selected' : ''} key={value} onClick={() => onChange?.({ ...formatting, font: value })}>{label}</button>)}
        </div>
      </section>
      <section className="x-formatting-section">
        <strong>字号</strong>
        <div className="x-formatting-options three" role="radiogroup" aria-label="选择文章字号">
          {([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button type="button" role="radio" aria-checked={formatting.fontSize === value} className={formatting.fontSize === value ? 'selected' : ''} key={value} onClick={() => onChange?.({ ...formatting, fontSize: value })}>{label}</button>)}
        </div>
      </section>
    </div>
  )
}

function SpacingControls({
  formatting,
  onChange,
}: {
  formatting: ArticleFormatting
  onChange?: (formatting: ArticleFormatting) => void
}) {
  return (
    <div className="article-formatting-controls article-spacing-controls">
      <section className="x-formatting-section">
        <strong>行距</strong>
        <div className="x-formatting-options three" role="radiogroup" aria-label="选择文章行距">
          {([['compact', '紧凑'], ['comfortable', '舒适'], ['airy', '宽松']] as const).map(([value, label]) => <button type="button" role="radio" aria-checked={formatting.lineHeight === value} className={formatting.lineHeight === value ? 'selected' : ''} key={value} onClick={() => onChange?.({ ...formatting, lineHeight: value })}>{label}</button>)}
        </div>
      </section>
    </div>
  )
}

function AccentControls({
  formatting,
  onChange,
}: {
  formatting: ArticleFormatting
  onChange?: (formatting: ArticleFormatting) => void
}) {
  return (
    <div className="article-formatting-controls article-color-controls">
      <section className="x-formatting-section">
        <strong>强调色</strong>
        <div className="x-accent-options" role="radiogroup" aria-label="选择文章强调色">
          {(Object.keys(ARTICLE_ACCENT_COLORS) as Array<keyof typeof ARTICLE_ACCENT_COLORS>).map(value => <button type="button" role="radio" aria-label={value} aria-checked={formatting.accent === value} className={formatting.accent === value ? 'selected' : ''} key={value} style={{ background: ARTICLE_ACCENT_COLORS[value] }} onClick={() => onChange?.({ ...formatting, accent: value })} />)}
        </div>
      </section>
    </div>
  )
}

const FORMATTING_SECTION_META: Array<{
  value: FormattingSection
  label: string
  detail: string
}> = [
  { value: 'layout', label: '排版', detail: '主题与视觉结构' },
  { value: 'font', label: '字体', detail: '字体与字号' },
  { value: 'spacing', label: '间距', detail: '正文行距' },
  { value: 'color', label: '颜色', detail: '强调色与主题配色' },
]

function FormattingAccordion({
  idPrefix,
  label,
  openSection,
  onSectionToggle,
  formatting,
  onFormattingChange,
  layoutContent,
  colorContent,
}: {
  idPrefix: string
  label: string
  openSection: FormattingSection | null
  onSectionToggle: (section: FormattingSection) => void
  formatting: ArticleFormatting
  onFormattingChange?: (formatting: ArticleFormatting) => void
  layoutContent: ReactNode
  colorContent?: ReactNode
}) {
  const contentBySection: Record<FormattingSection, ReactNode> = {
    layout: layoutContent,
    font: <FontControls formatting={formatting} onChange={onFormattingChange} />,
    spacing: <SpacingControls formatting={formatting} onChange={onFormattingChange} />,
    color: (
      <>
        <AccentControls formatting={formatting} onChange={onFormattingChange} />
        {colorContent}
      </>
    ),
  }

  return (
    <div className="settings-accordion" aria-label={label}>
      {FORMATTING_SECTION_META.map(section => {
        const expanded = openSection === section.value
        const triggerId = `${idPrefix}-${section.value}-trigger`
        const panelId = `${idPrefix}-${section.value}-panel`
        return (
          <section className={`settings-accordion-item section-${section.value}${expanded ? ' expanded' : ''}`} key={section.value}>
            <button
              id={triggerId}
              type="button"
              className="settings-accordion-trigger"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => onSectionToggle(section.value)}
            >
              <span className="settings-accordion-copy"><strong>{section.label}</strong><small>{section.detail}</small></span>
              <ChevronDown className="settings-accordion-chevron" size={15} aria-hidden="true" />
            </button>
            <div
              id={panelId}
              className="settings-accordion-panel"
              role="region"
              aria-labelledby={triggerId}
              hidden={!expanded}
            >
              {contentBySection[section.value]}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function PlatformPreviews({ activePlatform, title, html, sourceText, sourceLanguage, formatting, onFormattingChange, xhsSettings: controlledXhsSettings, onXhsSettingsChange, previewAccount, previewDevice, isUpdating = false, onPreviewDeviceChange, locateRequest, onEditTarget, onMissingImageAction }: PlatformPreviewsProps) {
  const [uncontrolledXhsSettings, setUncontrolledXhsSettings] = useState<XhsCardSettings>(DEFAULT_XHS_CARD_SETTINGS)
  const xhsSettings = controlledXhsSettings ?? uncontrolledXhsSettings
  const updateXhsSettings = onXhsSettingsChange ?? setUncontrolledXhsSettings
  const [xhsTemplateCategory, setXhsTemplateCategory] = useState<XhsTemplateCategoryId>(() => xhsTemplateCategoryFor(xhsSettings.template))
  const activeXhsTemplateCategory = XHS_TEMPLATE_CATEGORIES.find(category => category.id === xhsTemplateCategory) ?? XHS_TEMPLATE_CATEGORIES[3]
  const [selectedTarget, setSelectedTarget] = useState<PreviewEditTarget | null>(null)
  const [activeCard, setActiveCard] = useState(0)
  const [xhsPreviewMode, setXhsPreviewMode] = useState<XhsPreviewMode>('single')
  const [xhsPageJumpOpen, setXhsPageJumpOpen] = useState(false)
  const [selectedXhsImageKey, setSelectedXhsImageKey] = useState<string | null>(null)
  const [xhsImagePopover, setXhsImagePopover] = useState<XhsImagePopoverPosition | null>(null)
  const [xhsImageResizeSession, setXhsImageResizeSession] = useState<XhsImageResizeSession | null>(null)
  const [wechatThemeCategory, setWechatThemeCategory] = useState<WechatThemeCategory>('简约')
  const [toolRailWidth, setToolRailWidth] = useState(readToolRailWidth)
  const [toolRailOpen, setToolRailOpen] = useState(readToolRailOpen)
  const [openFormattingSection, setOpenFormattingSection] = useState<Record<PreviewPlatform, FormattingSection | null>>({
    wechat: 'layout',
    xhs: 'layout',
    x: 'layout',
  })
  const [wechatCopyState, setWechatCopyState] = useState<WechatCopyState>('idle')
  const [exporting, setExporting] = useState<number | 'all' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [previewingCard, setPreviewingCard] = useState<number | null>(null)
  const [exportSheetActive, setExportSheetActive] = useState(false)
  const [xhsImagePreview, setXhsImagePreview] = useState<{ index: number; url: string } | null>(null)
  const [xhsImageZoom, setXhsImageZoom] = useState(100)
  const [measuredPagination, setMeasuredPagination] = useState<{ key: string; pages: string[] } | null>(null)

  useEffect(() => {
    setXhsTemplateCategory(xhsTemplateCategoryFor(xhsSettings.template))
  }, [xhsSettings.template])

  const sourceLineMap = useMemo(
    () => sourceText ? sourceLinesByBlock(sourceText, sourceLanguage ?? 'markdown') : [],
    [sourceLanguage, sourceText],
  )
  const mappedPreview = useMemo(
    () => activePlatform === 'wechat'
      ? { html: '', blockCount: 0 }
      : mapPreviewBlocks(renderMissingImagePlaceholders(html), sourceLineMap, activePlatform),
    [activePlatform, html, sourceLineMap],
  )
  const wechatSettings = useMemo(() => normalizeWechatThemeSettings(formatting.wechat), [formatting.wechat])
  const mappedWechatPreview = useMemo(
    () => activePlatform === 'wechat'
      ? mapPreviewBlocks(applyWechatTheme(renderMissingImagePlaceholders(html), wechatSettings, formatting), sourceLineMap, 'wechat')
      : { html: '', blockCount: 0 },
    [activePlatform, formatting, html, sourceLineMap, wechatSettings],
  )
  const activeWechatTheme = getWechatTheme(wechatSettings.themeId)
  const activeWechatSlots = getWechatThemeColorSlots(wechatSettings.themeId)
  const visibleWechatThemes = WECHAT_THEMES.filter(
    theme => wechatThemeCategory === '全部' || getWechatThemeCategory(theme.id) === wechatThemeCategory,
  )
  const preparedXhsLayout = useMemo(
    () => activePlatform === 'xhs'
      ? prepareXhsImageLayout(mappedPreview.html, xhsSettings.imageOverrides)
      : { html: '', images: [] as XhsPreparedImage[] },
    [activePlatform, mappedPreview.html, xhsSettings.imageOverrides],
  )
  const xhsPaginationOptions = useMemo(() => ({
    title,
    textScale: XHS_FONT_SIZE_SCALE[formatting.fontSize] * XHS_LINE_HEIGHT_SCALE[formatting.lineHeight],
    showFooter: xhsSettings.showFooter,
  }), [formatting.fontSize, formatting.lineHeight, title, xhsSettings.showFooter])
  const estimatedCardPages = useMemo(
    () => activePlatform === 'xhs'
      ? paginateForXhsCards(preparedXhsLayout.html, xhsPaginationOptions)
      : [],
    [activePlatform, preparedXhsLayout.html, xhsPaginationOptions],
  )
  const paginationKey = useMemo(() => [
    preparedXhsLayout.html,
    title,
    formatting.font,
    formatting.fontSize,
    formatting.lineHeight,
    formatting.accent,
    xhsSettings.template,
    String(xhsSettings.showFooter),
    xhsSettings.footerText,
  ].join('\u0001'), [
    formatting.accent,
    formatting.font,
    formatting.fontSize,
    formatting.lineHeight,
    preparedXhsLayout.html,
    title,
    xhsSettings.footerText,
    xhsSettings.showFooter,
    xhsSettings.template,
  ])
  const cardPages = activePlatform === 'xhs' && measuredPagination?.key === paginationKey
    ? measuredPagination.pages
    : estimatedCardPages
  const characterCount = useMemo(
    () => activePlatform === 'x' ? plainTextLength(mappedPreview.html) : 0,
    [activePlatform, mappedPreview.html],
  )
  const activePreviewBlockCount = activePlatform === 'wechat' ? mappedWechatPreview.blockCount : mappedPreview.blockCount
  const activePreviewHtml = activePlatform === 'wechat'
    ? mappedWechatPreview.html
    : activePlatform === 'xhs'
      ? preparedXhsLayout.html
      : mappedPreview.html
  const workbenchRef = useRef<HTMLElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const xhsLayoutRef = useRef<HTMLDivElement>(null)
  const xhsImagePopoverRef = useRef<HTMLElement>(null)
  const xhsPageNavigatorRef = useRef<HTMLDivElement>(null)
  const xhsPageTriggerRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const mobilePreviewButtonRef = useRef<HTMLButtonElement>(null)
  const mobileDialogRef = useRef<HTMLDivElement>(null)
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null)
  const exportCardRefs = useRef<Array<HTMLElement | null>>([])
  const scrollPositionsRef = useRef<Record<PreviewPlatform, number>>({ wechat: 0, xhs: 0, x: 0 })
  const handledLocateRequestRef = useRef(0)
  const pendingLocateRequestRef = useRef<PreviewLocateRequest | null>(null)
  const locatedTargetTimerRef = useRef<number | null>(null)
  const locatedTargetRef = useRef<HTMLElement | null>(null)
  const selectedTargetTimerRef = useRef<number | null>(null)
  const previewLocateFrameRef = useRef<number | null>(null)
  const previewLocateSettleTimerRef = useRef<number | null>(null)
  const previewLocateResizeObserverRef = useRef<ResizeObserver | null>(null)
  const wechatCopyTimerRef = useRef<number | null>(null)
  const toolRailResizeRef = useRef<{ pointerId: number; rawWidth: number } | null>(null)
  const xhsSettingsRef = useRef(xhsSettings)
  const updateXhsSettingsRef = useRef(updateXhsSettings)
  const xhsResizeFrameRef = useRef<number | null>(null)
  const pendingXhsImageWidthRef = useRef<number | null>(null)
  xhsSettingsRef.current = xhsSettings
  updateXhsSettingsRef.current = updateXhsSettings

  const stopPreviewCentering = () => {
    if (previewLocateFrameRef.current !== null) window.cancelAnimationFrame(previewLocateFrameRef.current)
    previewLocateFrameRef.current = null
    if (previewLocateSettleTimerRef.current !== null) window.clearTimeout(previewLocateSettleTimerRef.current)
    previewLocateSettleTimerRef.current = null
    previewLocateResizeObserverRef.current?.disconnect()
    previewLocateResizeObserverRef.current = null
    previewStageRef.current?.classList.remove('preview-locating')
  }

  const clearLocatedTarget = () => {
    if (locatedTargetTimerRef.current !== null) window.clearTimeout(locatedTargetTimerRef.current)
    locatedTargetTimerRef.current = null
    locatedTargetRef.current?.classList.remove('preview-located-target')
    locatedTargetRef.current?.removeAttribute('data-preview-selected')
    locatedTargetRef.current = null
  }

  const cancelEditorDrivenPreviewLocate = () => {
    pendingLocateRequestRef.current = null
    stopPreviewCentering()
    clearLocatedTarget()
  }

  const centerPreviewTarget = (anchor: HTMLElement) => {
    const viewport = viewportRef.current
    if (!viewport || !viewport.contains(anchor)) return

    const viewportBounds = viewport.getBoundingClientRect()
    const anchorBounds = anchor.getBoundingClientRect()
    const targetTop = viewport.scrollTop
      + anchorBounds.top
      + anchorBounds.height / 2
      - viewportBounds.top
      - viewport.clientHeight / 2
    const maximumScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    const nextScrollTop = Math.min(maximumScrollTop, Math.max(0, targetTop))
    if (Math.abs(viewport.scrollTop - nextScrollTop) < 1) return

    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ top: nextScrollTop, behavior: 'auto' })
    else viewport.scrollTop = nextScrollTop
  }

  const startPreviewCentering = (stage: HTMLElement, anchor: HTMLElement) => {
    stopPreviewCentering()
    stage.classList.add('preview-locating')

    previewLocateFrameRef.current = window.requestAnimationFrame(() => {
      previewLocateFrameRef.current = null
      centerPreviewTarget(anchor)

      if (typeof ResizeObserver !== 'undefined') {
        const layoutRoot = anchor.closest<HTMLElement>('.wechat-document, .x-article, .xhs-card-page') ?? stage
        previewLocateResizeObserverRef.current = new ResizeObserver(() => centerPreviewTarget(anchor))
        previewLocateResizeObserverRef.current.observe(layoutRoot)
      }

      previewLocateSettleTimerRef.current = window.setTimeout(() => {
        centerPreviewTarget(anchor)
        previewLocateResizeObserverRef.current?.disconnect()
        previewLocateResizeObserverRef.current = null
        stage.classList.remove('preview-locating')
        previewLocateSettleTimerRef.current = null
      }, PREVIEW_LOCATE_SETTLE_MS)
    })
  }

  const xhsMeasurementVariables = useMemo(() => ({
    '--article-accent': ARTICLE_ACCENT_COLORS[formatting.accent],
    '--article-font-family': ARTICLE_FONT_FAMILIES[formatting.font],
    '--article-font-size': ARTICLE_FONT_SIZES[formatting.fontSize],
    '--article-line-height': ARTICLE_LINE_HEIGHTS[formatting.lineHeight],
    '--xhs-body-font-size': XHS_FONT_SIZES[formatting.fontSize],
    '--xhs-body-line-height': XHS_LINE_HEIGHTS[formatting.lineHeight],
  }), [formatting.accent, formatting.font, formatting.fontSize, formatting.lineHeight])

  const selectedXhsImage = preparedXhsLayout.images.find(image => image.key === selectedXhsImageKey) ?? null

  const closeXhsImagePopover = useCallback(() => {
    setSelectedXhsImageKey(null)
    setXhsImagePopover(null)
    setXhsImageResizeSession(null)
  }, [])

  const positionXhsImagePopover = (key: string, image: HTMLImageElement, clientX: number, clientY: number) => {
    const layoutBounds = xhsLayoutRef.current?.getBoundingClientRect()
    if (!layoutBounds) return

    const anchorBounds = image.closest<HTMLElement>('.xhs-card-page')?.getBoundingClientRect() ?? image.getBoundingClientRect()
    const minLeft = XHS_IMAGE_POPOVER_GAP
    const minTop = XHS_IMAGE_POPOVER_GAP
    const maxLeft = Math.max(minLeft, layoutBounds.width - XHS_IMAGE_POPOVER_WIDTH - XHS_IMAGE_POPOVER_GAP)
    const maxTop = Math.max(minTop, layoutBounds.height - XHS_IMAGE_POPOVER_HEIGHT - XHS_IMAGE_POPOVER_GAP)
    const anchor = {
      left: anchorBounds.left - layoutBounds.left,
      top: anchorBounds.top - layoutBounds.top,
      right: anchorBounds.right - layoutBounds.left,
      bottom: anchorBounds.bottom - layoutBounds.top,
    }
    const alignedLeft = clientX - layoutBounds.left - XHS_IMAGE_POPOVER_WIDTH / 2
    const alignedTop = clientY - layoutBounds.top - XHS_IMAGE_POPOVER_HEIGHT / 2
    const clampLeft = (value: number) => Math.min(maxLeft, Math.max(minLeft, value))
    const clampTop = (value: number) => Math.min(maxTop, Math.max(minTop, value))
    const candidates = [
      { left: anchor.right + XHS_IMAGE_POPOVER_GAP, top: alignedTop },
      { left: anchor.left - XHS_IMAGE_POPOVER_WIDTH - XHS_IMAGE_POPOVER_GAP, top: alignedTop },
      { left: alignedLeft, top: anchor.bottom + XHS_IMAGE_POPOVER_GAP },
      { left: alignedLeft, top: anchor.top - XHS_IMAGE_POPOVER_HEIGHT - XHS_IMAGE_POPOVER_GAP },
    ].map(candidate => ({ left: clampLeft(candidate.left), top: clampTop(candidate.top) }))
    const overlapArea = (candidate: { left: number; top: number }) => {
      const overlapWidth = Math.max(0, Math.min(candidate.left + XHS_IMAGE_POPOVER_WIDTH, anchor.right) - Math.max(candidate.left, anchor.left))
      const overlapHeight = Math.max(0, Math.min(candidate.top + XHS_IMAGE_POPOVER_HEIGHT, anchor.bottom) - Math.max(candidate.top, anchor.top))
      return overlapWidth * overlapHeight
    }
    const distanceFromClick = (candidate: { left: number; top: number }) => {
      const centerX = candidate.left + XHS_IMAGE_POPOVER_WIDTH / 2
      const centerY = candidate.top + XHS_IMAGE_POPOVER_HEIGHT / 2
      const clickX = clientX - layoutBounds.left
      const clickY = clientY - layoutBounds.top
      return Math.hypot(centerX - clickX, centerY - clickY)
    }
    const bestPosition = candidates.reduce((best, candidate) => {
      const bestOverlap = overlapArea(best)
      const candidateOverlap = overlapArea(candidate)
      if (candidateOverlap !== bestOverlap) return candidateOverlap < bestOverlap ? candidate : best
      return distanceFromClick(candidate) < distanceFromClick(best) ? candidate : best
    })

    setXhsImagePopover({ key, ...bestPosition })
  }

  const updateXhsImageOverride = (key: string, layout: XhsImageLayout, widthPercent: number) => {
    const normalized = normalizeXhsImageOverride({ layout, widthPercent })
    if (!normalized) return
    const nextSettings = {
      ...xhsSettingsRef.current,
      imageOverrides: {
        ...xhsSettingsRef.current.imageOverrides,
        [key]: normalized,
      },
    }
    xhsSettingsRef.current = nextSettings
    updateXhsSettingsRef.current(nextSettings)
  }

  const resetXhsImageOverride = (key: string) => {
    const imageOverrides = { ...xhsSettingsRef.current.imageOverrides }
    delete imageOverrides[key]
    const nextSettings = { ...xhsSettingsRef.current, imageOverrides }
    xhsSettingsRef.current = nextSettings
    updateXhsSettingsRef.current(nextSettings)
  }

  const updateWechatSettings = (next: Partial<typeof wechatSettings>) => {
    onFormattingChange?.({
      ...formatting,
      wechat: normalizeWechatThemeSettings({ ...wechatSettings, ...next }),
    })
  }

  const selectWechatTheme = (themeId: WechatThemeId) => {
    updateWechatSettings({ themeId })
  }

  const updateWechatSlot = (key: string, color: string) => {
    updateWechatSettings({
      slotColorsByTheme: {
        ...wechatSettings.slotColorsByTheme,
        [wechatSettings.themeId]: {
          ...(wechatSettings.slotColorsByTheme[wechatSettings.themeId] ?? {}),
          [key]: color,
        },
      },
    })
  }

  const resetWechatThemeColors = () => {
    const accentByTheme = { ...wechatSettings.accentByTheme }
    const slotColorsByTheme = { ...wechatSettings.slotColorsByTheme }
    delete accentByTheme[wechatSettings.themeId]
    delete slotColorsByTheme[wechatSettings.themeId]
    onFormattingChange?.({
      ...formatting,
      accent: 'blue',
      wechat: normalizeWechatThemeSettings({ ...wechatSettings, accentByTheme, slotColorsByTheme }),
    })
  }

  const copyWechatContent = async () => {
    setWechatCopyState('copying')
    if (wechatCopyTimerRef.current !== null) window.clearTimeout(wechatCopyTimerRef.current)
    try {
      const copyDocument = parseHtml(applyWechatTheme(html, wechatSettings, formatting))
      applyPlatformCompatibilityToDocument(copyDocument, 'wechat')
      await copyRichHtml(copyDocument.body.innerHTML)
      setWechatCopyState('success')
      wechatCopyTimerRef.current = window.setTimeout(() => {
        setWechatCopyState('idle')
        wechatCopyTimerRef.current = null
      }, 2200)
    } catch {
      setWechatCopyState('error')
    }
  }

  const clearSelectedTarget = useCallback(() => {
    if (selectedTargetTimerRef.current !== null) window.clearTimeout(selectedTargetTimerRef.current)
    selectedTargetTimerRef.current = null
    setSelectedTarget(null)
  }, [])

  const persistToolRailOpen = (next: Record<PreviewPlatform, boolean>) => {
    setToolRailOpen(next)
    try {
      window.localStorage.setItem(TOOL_RAIL_OPEN_KEY, JSON.stringify(next))
    } catch {
      // The rail remains usable when localStorage is unavailable.
    }
  }

  const toggleToolRail = (platform: PreviewPlatform) => {
    persistToolRailOpen({ ...toolRailOpen, [platform]: !toolRailOpen[platform] })
  }

  const toggleFormattingSection = (platform: PreviewPlatform, section: FormattingSection) => {
    setOpenFormattingSection(current => ({
      ...current,
      [platform]: current[platform] === section ? null : section,
    }))
  }

  const resizeToolRail = (clientX: number) => {
    const stage = previewStageRef.current
    if (!stage) return
    const rawWidth = stage.getBoundingClientRect().right - clientX
    if (toolRailResizeRef.current) toolRailResizeRef.current.rawWidth = rawWidth
    setToolRailWidth(Math.min(TOOL_RAIL_MAX_WIDTH, Math.max(TOOL_RAIL_MIN_WIDTH, rawWidth)))
  }

  const startToolRailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    toolRailResizeRef.current = { pointerId: event.pointerId, rawWidth: toolRailWidth }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing-tool-rail')
    resizeToolRail(event.clientX)
  }

  const moveToolRailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!toolRailResizeRef.current) return
    resizeToolRail(event.clientX)
  }

  const finishToolRailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = toolRailResizeRef.current
    if (!resizeState) return
    toolRailResizeRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('is-resizing-tool-rail')
    if (resizeState.rawWidth < TOOL_RAIL_COLLAPSE_WIDTH) {
      persistToolRailOpen({ ...toolRailOpen, [activePlatform]: false })
      return
    }
    const persistedWidth = Math.min(TOOL_RAIL_MAX_WIDTH, Math.max(TOOL_RAIL_MIN_WIDTH, resizeState.rawWidth))
    setToolRailWidth(persistedWidth)
    try {
      window.localStorage.setItem(TOOL_RAIL_WIDTH_KEY, String(persistedWidth))
    } catch {
      // The rail remains usable when localStorage is unavailable.
    }
  }

  const adjustToolRailWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      persistToolRailOpen({ ...toolRailOpen, [activePlatform]: false })
      return
    }
    let next = toolRailWidth
    if (event.key === 'ArrowLeft') next += 16
    else if (event.key === 'ArrowRight') next -= 16
    else if (event.key === 'End') next = TOOL_RAIL_MAX_WIDTH
    else return
    event.preventDefault()
    next = Math.min(TOOL_RAIL_MAX_WIDTH, Math.max(TOOL_RAIL_MIN_WIDTH, next))
    setToolRailWidth(next)
    try {
      window.localStorage.setItem(TOOL_RAIL_WIDTH_KEY, String(next))
    } catch {
      // The rail remains usable when localStorage is unavailable.
    }
  }

  const closeMobilePreview = useCallback(() => {
    onPreviewDeviceChange('desktop')
    window.requestAnimationFrame(() => mobilePreviewButtonRef.current?.focus())
  }, [onPreviewDeviceChange])

  useEffect(() => {
    if (activePlatform !== 'xhs') return

    let cancelled = false
    let assetFrame: number | null = null

    const measure = () => {
      if (cancelled) return
      const measurer = createXhsCardPageMeasurer({
        title,
        template: xhsSettings.template,
        showFooter: xhsSettings.showFooter,
        footerText: xhsSettings.footerText,
        variables: xhsMeasurementVariables,
      })
      if (!measurer) return

      try {
        const pages = paginateForXhsCards(preparedXhsLayout.html, xhsPaginationOptions, measurer.fits)
        if (cancelled) return
        setMeasuredPagination(current => current?.key === paginationKey && samePages(current.pages, pages)
          ? current
          : { key: paginationKey, pages })
      } finally {
        measurer.dispose()
      }
    }

    void waitForXhsPaginationAssets(preparedXhsLayout.html).then(() => {
      if (cancelled) return
      assetFrame = window.requestAnimationFrame(measure)
    })

    return () => {
      cancelled = true
      if (assetFrame !== null) window.cancelAnimationFrame(assetFrame)
    }
  }, [
    activePlatform,
    paginationKey,
    preparedXhsLayout.html,
    title,
    xhsMeasurementVariables,
    xhsPaginationOptions,
    xhsSettings.footerText,
    xhsSettings.showFooter,
    xhsSettings.template,
  ])

  useEffect(() => {
    setActiveCard(current => Math.max(0, Math.min(current, cardPages.length - 1)))
    exportCardRefs.current.length = cardPages.length
  }, [cardPages.length])

  useLayoutEffect(() => {
    cancelEditorDrivenPreviewLocate()
    clearSelectedTarget()
  }, [html, activePlatform, previewDevice, clearSelectedTarget])

  useEffect(() => {
    setSelectedXhsImageKey(null)
    setXhsImagePopover(null)
    setXhsImageResizeSession(null)
    setXhsPageJumpOpen(false)
    setExportError(null)
  }, [activePlatform])

  useEffect(() => {
    if (!xhsPageJumpOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || xhsPageNavigatorRef.current?.contains(event.target)) return
      setXhsPageJumpOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setXhsPageJumpOpen(false)
      xhsPageTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [xhsPageJumpOpen])

  useEffect(() => {
    if (selectedXhsImageKey && !preparedXhsLayout.images.some(image => image.key === selectedXhsImageKey)) {
      closeXhsImagePopover()
    }
  }, [closeXhsImagePopover, preparedXhsLayout.images, selectedXhsImageKey])

  useEffect(() => {
    if (!xhsImagePopover) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (xhsImagePopoverRef.current?.contains(event.target)) return
      if (event.target.closest('img[data-xhs-image-key], [data-xhs-resize-handle]')) return
      closeXhsImagePopover()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeXhsImagePopover()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeXhsImagePopover, xhsImagePopover])

  useEffect(() => {
    if (!xhsImageResizeSession) return

    const commitWidth = (widthPercent: number) => {
      updateXhsImageOverride(
        xhsImageResizeSession.key,
        xhsImageResizeSession.layout,
        widthPercent,
      )
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== xhsImageResizeSession.pointerId) return
      const delta = ((event.clientX - xhsImageResizeSession.startX) / xhsImageResizeSession.contentWidth)
        * 100
        * xhsImageResizeSession.direction
      const minimum = xhsImageResizeSession.layout === 'full' ? XHS_IMAGE_FULL_MIN_WIDTH : XHS_IMAGE_SPLIT_MIN_WIDTH
      const maximum = xhsImageResizeSession.layout === 'full' ? 100 : XHS_IMAGE_SPLIT_MAX_WIDTH
      pendingXhsImageWidthRef.current = Math.min(maximum, Math.max(minimum, xhsImageResizeSession.startWidth + delta))
      if (xhsResizeFrameRef.current !== null) return
      xhsResizeFrameRef.current = window.requestAnimationFrame(() => {
        xhsResizeFrameRef.current = null
        if (pendingXhsImageWidthRef.current !== null) commitWidth(pendingXhsImageWidthRef.current)
      })
    }
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== xhsImageResizeSession.pointerId) return
      if (xhsResizeFrameRef.current !== null) window.cancelAnimationFrame(xhsResizeFrameRef.current)
      xhsResizeFrameRef.current = null
      if (pendingXhsImageWidthRef.current !== null) commitWidth(pendingXhsImageWidthRef.current)
      pendingXhsImageWidthRef.current = null
      setXhsImageResizeSession(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [xhsImageResizeSession])

  useLayoutEffect(() => {
    if (!locateRequest || locateRequest.requestId === handledLocateRequestRef.current) return
    if (locateRequest.blockIndex < 0 || locateRequest.blockIndex >= activePreviewBlockCount) return

    handledLocateRequestRef.current = locateRequest.requestId
    cancelEditorDrivenPreviewLocate()
    pendingLocateRequestRef.current = locateRequest
    clearSelectedTarget()
    if (activePlatform === 'xhs') {
      const targetPage = cardPages.findIndex(page => page.includes(`data-source-block="${locateRequest.blockIndex}"`))
      if (targetPage >= 0) setActiveCard(targetPage)
    }
  }, [activePlatform, activePreviewBlockCount, cardPages, locateRequest])

  useEffect(() => () => {
    if (selectedTargetTimerRef.current !== null) window.clearTimeout(selectedTargetTimerRef.current)
    selectedTargetTimerRef.current = null
    clearLocatedTarget()
    stopPreviewCentering()
    if (wechatCopyTimerRef.current !== null) window.clearTimeout(wechatCopyTimerRef.current)
    if (xhsImagePreview) URL.revokeObjectURL(xhsImagePreview.url)
  }, [xhsImagePreview])

  useEffect(() => {
    if (!xhsImagePreview) return
    const handlePreviewKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setXhsImagePreview(null)
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setXhsImageZoom(current => Math.min(XHS_PREVIEW_MAX_ZOOM, current + XHS_PREVIEW_ZOOM_STEP))
      } else if (event.key === '-') {
        event.preventDefault()
        setXhsImageZoom(current => Math.max(XHS_PREVIEW_MIN_ZOOM, current - XHS_PREVIEW_ZOOM_STEP))
      } else if (event.key === '0') {
        event.preventDefault()
        setXhsImageZoom(100)
      }
    }
    document.addEventListener('keydown', handlePreviewKeyDown)
    return () => document.removeEventListener('keydown', handlePreviewKeyDown)
  }, [xhsImagePreview])

  useEffect(() => {
    if (selectedTarget?.kind === 'body' && selectedTarget.blockIndex >= activePreviewBlockCount) {
      clearSelectedTarget()
    }
  }, [activePreviewBlockCount, clearSelectedTarget, selectedTarget])

  useLayoutEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = scrollPositionsRef.current[activePlatform]
  }, [activePlatform])

  useLayoutEffect(() => {
    const stage = previewStageRef.current
    stage?.querySelectorAll('[data-preview-selected="true"]').forEach(element => element.removeAttribute('data-preview-selected'))
    const pendingRequest = pendingLocateRequestRef.current
    if (pendingRequest && selectedTarget) return
    const effectiveTarget: PreviewEditTarget | null = pendingRequest
      ? {
          kind: 'body',
          blockIndex: pendingRequest.blockIndex,
          ...(pendingRequest.line === undefined ? {} : { line: pendingRequest.line }),
        }
      : selectedTarget
    if (!stage || !effectiveTarget) return

    const selector = effectiveTarget.kind === 'body'
      ? effectiveTarget.line === undefined
        ? `[data-source-block="${effectiveTarget.blockIndex}"]`
        : `[data-source-block="${effectiveTarget.blockIndex}"][data-source-line="${effectiveTarget.line}"]`
      : `[data-edit-target="${effectiveTarget.kind}"]`
    const anchor = stage.querySelector<HTMLElement>(selector)
      ?? (effectiveTarget.kind === 'body' && effectiveTarget.line !== undefined
        ? stage.querySelector<HTMLElement>(`[data-source-block="${effectiveTarget.blockIndex}"]`)
        : null)
    if (!anchor) return

    if (pendingRequest && effectiveTarget.kind === 'body' && pendingRequest.blockIndex === effectiveTarget.blockIndex) {
      clearLocatedTarget()
    }
    anchor.setAttribute('data-preview-selected', 'true')

    if (pendingRequest && effectiveTarget.kind === 'body' && pendingRequest.blockIndex === effectiveTarget.blockIndex) {
      pendingLocateRequestRef.current = null
      locatedTargetRef.current = anchor
      anchor.classList.add('preview-located-target')
      startPreviewCentering(stage, anchor)
      locatedTargetTimerRef.current = window.setTimeout(() => {
        anchor.classList.remove('preview-located-target')
        anchor.removeAttribute('data-preview-selected')
        if (locatedTargetRef.current === anchor) locatedTargetRef.current = null
        locatedTargetTimerRef.current = null
      }, PREVIEW_TARGET_FLASH_MS)
    }
  }, [activeCard, activePlatform, activePreviewHtml, locateRequest, selectedTarget, xhsSettings])

  useEffect(() => {
    if (previewDevice !== 'mobile') return
    window.requestAnimationFrame(() => mobileCloseButtonRef.current?.focus())
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMobilePreview()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [closeMobilePreview, previewDevice])

  const rememberScroll = (event: UIEvent<HTMLDivElement>) => {
    scrollPositionsRef.current[activePlatform] = event.currentTarget.scrollTop
    if (activePlatform === 'xhs' && xhsImagePopover) closeXhsImagePopover()
  }

  const selectTarget = (target: PreviewEditTarget) => {
    cancelEditorDrivenPreviewLocate()
    clearSelectedTarget()
    setSelectedTarget(target)
    selectedTargetTimerRef.current = window.setTimeout(() => {
      selectedTargetTimerRef.current = null
      setSelectedTarget(null)
    }, PREVIEW_TARGET_FLASH_MS)
    onEditTarget?.(target)
  }

  const selectBodyBlock = (target: EventTarget | null, container: HTMLElement) => {
    if (!(target instanceof Element)) return
    if (target.closest('[data-missing-image-action]')) return
    const block = target.closest<HTMLElement>('[data-source-line], [data-source-block]')
    if (!block || !container.contains(block)) return
    const blockIndex = Number(block.dataset.sourceBlock)
    const line = Number(block.dataset.sourceLine)
    if (Number.isInteger(blockIndex)) {
      selectTarget({ kind: 'body', blockIndex, ...(Number.isInteger(line) && line > 0 ? { line } : {}) })
    }
  }

  const selectXhsImage = (target: EventTarget | null, point?: { clientX: number; clientY: number }): boolean => {
    if (activePlatform !== 'xhs' || !(target instanceof Element)) return false
    const image = target.closest<HTMLImageElement>('img[data-xhs-image-key]')
    const key = image?.dataset.xhsImageKey
    if (!key) return false
    const pageIndex = Number(image.closest<HTMLElement>('[data-xhs-page]')?.dataset.xhsPage)
    if (Number.isInteger(pageIndex)) setActiveCard(pageIndex)
    cancelEditorDrivenPreviewLocate()
    clearSelectedTarget()
    setSelectedXhsImageKey(key)
    const imageBounds = image.getBoundingClientRect()
    positionXhsImagePopover(
      key,
      image,
      point?.clientX ?? imageBounds.right,
      point?.clientY ?? imageBounds.top + imageBounds.height / 2,
    )
    return true
  }

  const startXhsImageResize = (event: ReactPointerEvent<HTMLElement>) => {
    const handle = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-xhs-resize-handle][data-xhs-image-key]')
      : null
    if (!handle) return
    const image = preparedXhsLayout.images.find(candidate => candidate.key === handle.dataset.xhsImageKey)
    if (!image) return
    event.preventDefault()
    event.stopPropagation()
    pendingXhsImageWidthRef.current = null
    setXhsImageResizeSession({
      pointerId: event.pointerId,
      key: image.key,
      startX: event.clientX,
      startWidth: image.widthPercent,
      direction: handle.dataset.xhsResizeHandle?.includes('w') ? -1 : 1,
      layout: image.layout,
      contentWidth: Math.max(1, event.currentTarget.getBoundingClientRect().width),
    })
  }

  const handleBodyClick = (event: ReactMouseEvent<HTMLElement>) => {
    const actionButton = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-missing-image-action][data-missing-id][data-missing-asset]')
      : null
    if (actionButton) {
      event.preventDefault()
      const action = actionButton.dataset.missingImageAction
      const id = actionButton.dataset.missingId
      const reference = actionButton.dataset.missingAsset
      if (id && reference && (action === 'relink' || action === 'replace' || action === 'delete')) {
        onMissingImageAction?.({ id, reference }, action)
      }
      return
    }
    if (event.target instanceof Element && event.target.closest('[data-xhs-resize-handle]')) return
    if (selectXhsImage(event.target, { clientX: event.clientX, clientY: event.clientY })) {
      event.preventDefault()
      return
    }
    if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
    selectBodyBlock(event.target, event.currentTarget)
  }

  const handleBodyKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('[data-missing-image-action]')) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (selectXhsImage(event.target)) return
    selectBodyBlock(event.target, event.currentTarget)
  }

  const selectStandaloneTargetWithKeyboard = (event: ReactKeyboardEvent<HTMLElement>, kind: 'title') => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectTarget({ kind })
  }

  const changeActiveCard = (index: number) => {
    setActiveCard(Math.max(0, Math.min(cardPages.length - 1, index)))
    closeXhsImagePopover()
    clearSelectedTarget()
  }

  const applyXhsTemplate = (template: XhsCardTemplate) => {
    updateXhsSettings({
      ...xhsSettings,
      template,
    })
  }

  const changeSelectedXhsImageLayout = (layout: XhsImageLayout) => {
    if (!selectedXhsImage) return
    const widthPercent = layout === selectedXhsImage.layout
      ? selectedXhsImage.widthPercent
      : layout === 'full' ? 100 : 45
    updateXhsImageOverride(selectedXhsImage.key, layout, widthPercent)
  }

  const changeSelectedXhsImageWidth = (widthPercent: number) => {
    if (!selectedXhsImage) return
    updateXhsImageOverride(selectedXhsImage.key, selectedXhsImage.layout, widthPercent)
  }

  const prepareExportSheet = async () => {
    setExportSheetActive(true)
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
  }

  const releaseExportSheet = () => {
    exportCardRefs.current = []
    setExportSheetActive(false)
  }

  const downloadCard = async (index: number) => {
    setExporting(index)
    setExportError(null)
    try {
      await prepareExportSheet()
      const card = exportCardRefs.current[index]
      if (!card) throw new Error('卡片导出视图准备失败，请重试。')
      const page = String(index + 1).padStart(2, '0')
      downloadBlob(await captureXhsCard(card), `${safeDownloadName(title)}-${page}.png`)
    } catch (error) {
      setExportError((error as Error).message)
    } finally {
      releaseExportSheet()
      setExporting(null)
    }
  }

  const downloadAllCards = async () => {
    setExporting('all')
    setExportError(null)
    try {
      await prepareExportSheet()
      if (exportCardRefs.current.length !== cardPages.length || exportCardRefs.current.some(card => !card)) {
        throw new Error('卡片导出视图准备失败，请重试。')
      }
      const archive = new JSZip()
      const baseName = safeDownloadName(title)
      for (let index = 0; index < exportCardRefs.current.length; index += 1) {
        const card = exportCardRefs.current[index]
        if (!card) continue
        const page = String(index + 1).padStart(2, '0')
        archive.file(`${baseName}-${page}.png`, await captureXhsCard(card))
      }
      const blob = await archive.generateAsync({ type: 'blob' })
      downloadBlob(blob, `${baseName}-小红书卡片.zip`)
    } catch (error) {
      setExportError((error as Error).message)
    } finally {
      releaseExportSheet()
      setExporting(null)
    }
  }

  const openCardPreview = async (index: number) => {
    setPreviewingCard(index)
    setExportError(null)
    try {
      await prepareExportSheet()
      const card = exportCardRefs.current[index]
      if (!card) throw new Error('卡片预览视图准备失败，请重试。')
      const url = URL.createObjectURL(await captureXhsCard(card))
      setXhsImagePreview(current => {
        if (current) URL.revokeObjectURL(current.url)
        return { index, url }
      })
      setXhsImageZoom(100)
    } catch (error) {
      setExportError((error as Error).message)
    } finally {
      releaseExportSheet()
      setPreviewingCard(null)
    }
  }

  const closeCardPreview = () => setXhsImagePreview(null)

  const previewVariables = {
    ...xhsMeasurementVariables,
    '--preview-tool-rail-width': `${toolRailWidth}px`,
  } as CSSProperties

  const spreadStart = activeCard - (activeCard % 2)
  const xhsPageRanges = createXhsPageRanges(cardPages.length)
  const activeXhsPageRange = xhsPageRanges.find(range => activeCard >= range.start && activeCard <= range.end)
    ?? xhsPageRanges[0]
  const visibleXhsPageNumbers = activeXhsPageRange
    ? Array.from({ length: activeXhsPageRange.end - activeXhsPageRange.start + 1 }, (_, offset) => activeXhsPageRange.start + offset)
    : []
  const xhsPageLabel = xhsPreviewMode === 'spread'
    ? `${formatXhsPageNumber(spreadStart + 1, cardPages.length)}–${formatXhsPageNumber(Math.min(spreadStart + 2, cardPages.length), cardPages.length)} / ${formatXhsPageNumber(cardPages.length, cardPages.length)}`
    : `${formatXhsPageNumber(activeCard + 1, cardPages.length)} / ${formatXhsPageNumber(cardPages.length, cardPages.length)}`
  const xhsPageProgress = cardPages.length ? ((activeCard + 1) / cardPages.length) * 100 : 0

  const changeXhsPreviewMode = (mode: XhsPreviewMode) => {
    setXhsPreviewMode(mode)
    setXhsPageJumpOpen(false)
    closeXhsImagePopover()
    clearSelectedTarget()
  }

  const renderXhsPageNavigator = () => cardPages.length ? (
    <div ref={xhsPageNavigatorRef} className="xhs-page-navigator" aria-label="小红书卡片定位">
      <button
        ref={xhsPageTriggerRef}
        type="button"
        className="xhs-page-jump-trigger"
        aria-expanded={xhsPageJumpOpen}
        aria-controls="xhs-page-jump-panel"
        onClick={() => setXhsPageJumpOpen(open => !open)}
      >
        <span>{activeXhsPageRange?.label}</span>
        <strong>{xhsPageLabel}</strong>
        <ChevronDown size={14} aria-hidden="true" />
        <i className="xhs-page-progress" aria-hidden="true"><i style={{ width: `${xhsPageProgress}%` }} /></i>
      </button>
      {xhsPageJumpOpen && (
        <div id="xhs-page-jump-panel" className="xhs-page-jump-panel" role="group" aria-label="选择卡片页码">
          <div className="xhs-page-jump-heading"><strong>跳转到卡片</strong><small>{cardPages.length} 张</small></div>
          {xhsPageRanges.length > 1 && (
            <div className="xhs-page-range-options" role="group" aria-label="选择卡片范围">
              {xhsPageRanges.map(range => (
                <button
                  type="button"
                  className={activeXhsPageRange?.start === range.start ? 'active' : ''}
                  aria-pressed={activeXhsPageRange?.start === range.start}
                  key={range.start}
                  onClick={() => changeActiveCard(range.start)}
                >{range.label}</button>
              ))}
            </div>
          )}
          <div className="xhs-page-number-options" role="group" aria-label="选择具体卡片">
            {visibleXhsPageNumbers.map(index => (
              <button
                type="button"
                className={activeCard === index ? 'active' : ''}
                aria-label={`查看第 ${index + 1} 张卡片`}
                aria-current={activeCard === index ? 'page' : undefined}
                key={index}
                onClick={() => {
                  changeActiveCard(index)
                  setXhsPageJumpOpen(false)
                }}
              >{formatXhsPageNumber(index + 1, cardPages.length)}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : null

  const renderXhsCard = (pageHtml: string, index: number, options: { interactive?: boolean; exportRef?: boolean } = {}) => {
    const interactiveHtml = options.interactive
      ? decorateInteractiveXhsImage(pageHtml, selectedXhsImageKey)
      : pageHtml
    const card = <section
      key={options.exportRef ? index : undefined}
      className={`xhs-card-page template-${xhsSettings.template}${index === 0 ? ' is-cover' : ''}`}
      aria-label={options.interactive ? `第 ${index + 1} 张，共 ${cardPages.length} 张` : undefined}
      data-xhs-page={options.interactive ? index : undefined}
      ref={options.exportRef ? element => { exportCardRefs.current[index] = element } : undefined}
    >
      {xhsSettings.showPageNumber && <span className="xhs-card-index">{String(index + 1).padStart(2, '0')}</span>}
      {index === 0 && <h1
        data-edit-target={options.interactive ? 'title' : undefined}
        role={options.interactive ? 'button' : undefined}
        tabIndex={options.interactive ? 0 : undefined}
        onClick={options.interactive ? () => selectTarget({ kind: 'title' }) : undefined}
        onKeyDown={options.interactive ? event => selectStandaloneTargetWithKeyboard(event, 'title') : undefined}
      >{title || '未命名文章'}</h1>}
      <div
        className="xhs-card-content"
        onClick={options.interactive ? handleBodyClick : undefined}
        onKeyDown={options.interactive ? handleBodyKeyDown : undefined}
        onPointerDown={options.interactive ? startXhsImageResize : undefined}
        dangerouslySetInnerHTML={{ __html: interactiveHtml }}
      />
      {xhsSettings.showFooter && <footer><span>{xhsSettings.footerText || ' '}</span><span>{index + 1} / {cardPages.length}</span></footer>}
    </section>
    return options.exportRef
      ? card
      : <div className="xhs-card-frame" key={index}>{card}</div>
  }

  const renderXhsCardWithActions = (pageHtml: string, index: number, variant: 'focused' | 'spread' | 'overview') => (
    <figure className={`xhs-card-item ${variant}${variant === 'overview' ? ' xhs-overview-item' : ''}`} key={index}>
      {renderXhsCard(pageHtml, index, { interactive: true })}
      <figcaption>
        <span>图片 {String(index + 1).padStart(2, '0')}</span>
        <span className="xhs-card-footer-actions">
          <button type="button" onClick={() => void openCardPreview(index)} disabled={previewingCard !== null} aria-label={`放大查看第 ${index + 1} 张卡片`}>
            {previewingCard === index ? <LoaderCircle className="spin" size={14} /> : <Maximize2 size={14} />}
            <span>放大查看</span>
          </button>
          <button type="button" onClick={() => void downloadCard(index)} disabled={exporting !== null} aria-label={`下载第 ${index + 1} 张卡片`}>
            {exporting === index ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
            <span>下载当前页</span>
          </button>
        </span>
      </figcaption>
    </figure>
  )

  const profileName = previewAccount?.username || previewAccount?.name || '创作者账号'
  const profileHandle = previewAccount?.username
    ? `@${previewAccount.username.replace(/^@/, '').replace(/\s+/g, '')}`
    : '@creator'
  const profileAvatar = previewAccount?.icon
    ? <img src={previewAccount.icon} alt="" />
    : activePlatform === 'xhs'
      ? <img src={xhsLogo} alt="" />
      : <UserRound size={17} aria-hidden="true" />

  const handleMobileDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(mobileDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ) || [])
    if (!controls.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activeToolRailPanelId: Record<PreviewPlatform, string> = {
    wechat: 'wechat-theme-panel',
    xhs: 'xhs-tool-panel',
    x: 'x-formatting-panel',
  }
  const activeToolRailLabel: Record<PreviewPlatform, string> = {
    wechat: '公众号排版',
    xhs: '小红书设置',
    x: 'X 长文排版',
  }
  const activeToolRailOpen = toolRailOpen[activePlatform]
  const activeToolRailName = `${activePlatform === 'x' ? ' ' : ''}${activeToolRailLabel[activePlatform]}`

  return (
    <section
      ref={workbenchRef}
      className={`preview-workbench platform-${activePlatform} theme-${formatting.theme}`}
      aria-label="平台内容预览"
      style={previewVariables}
    >
      <header className="preview-contextbar">
        <span className={`preview-sync-status ${isUpdating ? 'updating' : ''}`} aria-live="polite"><i />{isUpdating ? '正在同步最新编辑…' : activePlatform === 'wechat' ? '正文实时映射' : activePlatform === 'xhs' ? `${cardPages.length} 张卡片 · 自动分页` : `Premium Article · ${characterCount} 字`}</span>
        <div className="preview-context-actions">
          {activePlatform === 'wechat' && (
            <button
              type="button"
              className={`preview-tool-toggle wechat-copy-button ${wechatCopyState}`}
              disabled={wechatCopyState === 'copying'}
              aria-label={wechatCopyState === 'success'
                ? '公众号格式已复制'
                : wechatCopyState === 'error'
                  ? '复制失败，点击重试'
                  : '复制公众号格式'}
              onClick={() => void copyWechatContent()}
            >
              {wechatCopyState === 'copying'
                ? <LoaderCircle className="spin" size={14} />
                : wechatCopyState === 'success'
                  ? <Check size={14} />
                  : <Copy size={14} />}
              {wechatCopyState === 'copying' ? '复制中' : wechatCopyState === 'success' ? '已复制' : wechatCopyState === 'error' ? '重试复制' : '复制公众号格式'}
            </button>
          )}
          {activePlatform === 'xhs' && (
            <div className="xhs-view-modes xhs-context-view-modes" role="group" aria-label="切换小红书预览方式">
              <button type="button" className={xhsPreviewMode === 'single' ? 'active' : ''} aria-pressed={xhsPreviewMode === 'single'} aria-label="单页预览" onClick={() => changeXhsPreviewMode('single')}><Square size={15} /><span>单页</span></button>
              <button type="button" className={xhsPreviewMode === 'spread' ? 'active' : ''} aria-pressed={xhsPreviewMode === 'spread'} aria-label="双页预览" onClick={() => changeXhsPreviewMode('spread')}><Columns2 size={15} /><span>双页</span></button>
              <button type="button" className={xhsPreviewMode === 'all' ? 'active' : ''} aria-pressed={xhsPreviewMode === 'all'} aria-label="整体预览" onClick={() => changeXhsPreviewMode('all')}><LayoutGrid size={15} /><span>整体</span></button>
            </div>
          )}
          <button
            type="button"
            className={`preview-tool-toggle preview-settings-toggle${activeToolRailOpen ? ' active' : ''}`}
            aria-label={`${activeToolRailOpen ? '收起' : '展开'}${activeToolRailName}侧栏`}
            aria-controls={activeToolRailPanelId[activePlatform]}
            aria-expanded={activeToolRailOpen}
            title={`${activeToolRailOpen ? '收起' : '展开'}${activeToolRailName}侧栏`}
            onClick={() => toggleToolRail(activePlatform)}
          >
            {activeToolRailOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            <span>设置</span>
          </button>
          <div className="device-preview-switcher" role="group" aria-label="切换预览设备">
            <button type="button" className={previewDevice === 'desktop' ? 'active' : ''} aria-pressed={previewDevice === 'desktop'} onClick={() => onPreviewDeviceChange('desktop')}><Monitor size={14} />电脑预览</button>
            <button ref={mobilePreviewButtonRef} type="button" className={previewDevice === 'mobile' ? 'active' : ''} aria-pressed={previewDevice === 'mobile'} onClick={() => onPreviewDeviceChange('mobile')}><Smartphone size={14} />手机预览</button>
          </div>
        </div>
      </header>

      <div ref={previewStageRef} className="preview-platform-stage" aria-hidden={previewDevice === 'mobile' || undefined} inert={previewDevice === 'mobile' || undefined}>
        {activePlatform === 'wechat' && (
          <article className="single-platform-preview wechat-preview">
            <div className={`wechat-layout ${toolRailOpen.wechat ? 'tool-rail-open' : ''}`}>
              <div ref={viewportRef} className="platform-preview-viewport wechat-viewport" onScroll={rememberScroll}>
                <div className="wechat-document">
                  <h1
                    data-edit-target="title"
                    role="button"
                    tabIndex={0}
                    onClick={() => selectTarget({ kind: 'title' })}
                    onKeyDown={event => selectStandaloneTargetWithKeyboard(event, 'title')}
                  >{title || '未命名文章'}</h1>
                  <p className="wechat-meta">Dispatch Preview　·　公众号草稿</p>
                  <div className="wechat-content" onClick={handleBodyClick} onKeyDown={handleBodyKeyDown} dangerouslySetInnerHTML={{ __html: mappedWechatPreview.html }} />
                </div>
              </div>
              {toolRailOpen.wechat && (
                <div
                  className="preview-tool-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整公众号主题侧栏宽度"
                  aria-orientation="vertical"
                  aria-valuemin={TOOL_RAIL_MIN_WIDTH}
                  aria-valuemax={TOOL_RAIL_MAX_WIDTH}
                  aria-valuenow={toolRailWidth}
                  title="向左右拖动调整宽度；缩到最窄后松开可收起"
                  onPointerDown={startToolRailResize}
                  onPointerMove={moveToolRailResize}
                  onPointerUp={finishToolRailResize}
                  onPointerCancel={finishToolRailResize}
                  onKeyDown={adjustToolRailWithKeyboard}
                ><span /></div>
              )}
              <aside id="wechat-theme-panel" className="wechat-theme-rail preview-tool-rail" aria-label="公众号排版设置" hidden={!toolRailOpen.wechat}>
                <header className="wechat-theme-heading preview-tool-rail-heading">
                  <span><strong>公众号主题</strong><small>{WECHAT_THEMES.length} 套排版 · 点击后应用</small></span>
                </header>
                <FormattingAccordion
                  idPrefix="wechat-settings"
                  label="公众号设置模块"
                  openSection={openFormattingSection.wechat}
                  onSectionToggle={section => toggleFormattingSection('wechat', section)}
                  formatting={formatting}
                  onFormattingChange={onFormattingChange}
                  layoutContent={(
                    <section className="wechat-theme-layout" aria-label="公众号主题排版">
                      <div className="wechat-theme-categories" role="tablist" aria-label="筛选公众号主题">
                        {WECHAT_THEME_CATEGORIES.map(category => (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={wechatThemeCategory === category}
                            className={wechatThemeCategory === category ? 'active' : ''}
                            key={category}
                            onClick={() => setWechatThemeCategory(category)}
                          >{category}</button>
                        ))}
                      </div>
                      <div className="wechat-theme-grid">
                        {visibleWechatThemes.map(theme => (
                          <button
                            type="button"
                            className={`wechat-theme-card ${wechatSettings.themeId === theme.id ? 'selected' : ''}`}
                            aria-pressed={wechatSettings.themeId === theme.id}
                            key={theme.id}
                            onClick={() => selectWechatTheme(theme.id)}
                            style={{
                              '--theme-primary': theme.primary,
                              '--theme-surface': theme.surface,
                            } as CSSProperties}
                          >
                            <span className={`wechat-theme-mock mock-${theme.mock}`}><i /><i /><i /></span>
                            <span><strong>{theme.name}</strong><small>{theme.tag}</small></span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  colorContent={(
                    <section className="wechat-theme-settings" aria-label={`${activeWechatTheme.name} 配色`}>
                      <div className="wechat-theme-setting-title"><span><strong>{activeWechatTheme.name}</strong><small>{activeWechatTheme.description}</small></span><button type="button" onClick={resetWechatThemeColors}>重置配色</button></div>
                      {activeWechatSlots.map(slot => (
                        <label key={slot.key}><span>{slot.label}</span><input type="color" value={wechatSettings.slotColorsByTheme[wechatSettings.themeId]?.[slot.key] ?? slot.base} onChange={event => updateWechatSlot(slot.key, event.target.value)} /></label>
                      ))}
                    </section>
                  )}
                />
              </aside>
            </div>
          </article>
        )}

        {activePlatform === 'xhs' && (
          <article className="single-platform-preview xhs-preview">
            <div ref={xhsLayoutRef} className={`xhs-layout ${toolRailOpen.xhs ? 'tool-rail-open' : ''}`}>
              <div ref={viewportRef} className={`platform-preview-viewport xhs-viewport mode-${xhsPreviewMode}`} onScroll={rememberScroll}>
                {xhsPreviewMode === 'single' && (
                  <>
                    <div className="xhs-stage">
                      <button type="button" className="card-nav previous" onClick={() => changeActiveCard(activeCard - 1)} disabled={activeCard === 0} aria-label="上一张卡片"><ChevronLeft size={20} /></button>
                      {renderXhsCardWithActions(cardPages[activeCard], activeCard, 'focused')}
                      <button type="button" className="card-nav next" onClick={() => changeActiveCard(activeCard + 1)} disabled={activeCard === cardPages.length - 1} aria-label="下一张卡片"><ChevronRight size={20} /></button>
                    </div>
                    {renderXhsPageNavigator()}
                  </>
                )}

                {xhsPreviewMode === 'spread' && (
                  <>
                    <div className="xhs-spread-stage">
                      <button type="button" className="card-nav previous" onClick={() => changeActiveCard(spreadStart - 2)} disabled={spreadStart === 0} aria-label="上一组卡片"><ChevronLeft size={20} /></button>
                      <div className="xhs-card-spread">
                        {cardPages.slice(spreadStart, spreadStart + 2).map((page, offset) => renderXhsCardWithActions(page, spreadStart + offset, 'spread'))}
                      </div>
                      <button type="button" className="card-nav next" onClick={() => changeActiveCard(spreadStart + 2)} disabled={spreadStart + 2 >= cardPages.length} aria-label="下一组卡片"><ChevronRight size={20} /></button>
                    </div>
                    {renderXhsPageNavigator()}
                  </>
                )}

                {xhsPreviewMode === 'all' && (
                  <div className="xhs-overview" aria-label="全部小红书卡片预览">
                    {cardPages.map((page, index) => renderXhsCardWithActions(page, index, 'overview'))}
                  </div>
                )}
              </div>

              {selectedXhsImage && xhsImagePopover?.key === selectedXhsImage.key && (
                <section
                  ref={xhsImagePopoverRef}
                  className="xhs-image-popover"
                  role="dialog"
                  aria-label={`调整图片：${selectedXhsImage.alt}`}
                  style={{ left: xhsImagePopover.left, top: xhsImagePopover.top }}
                >
                  <header>
                    <span><strong>图片调整</strong><small title={selectedXhsImage.alt}>{selectedXhsImage.alt}</small></span>
                    <button type="button" aria-label="关闭图片调整" onClick={closeXhsImagePopover}><CloseIcon size={15} /></button>
                  </header>
                  <div className="xhs-image-controls">
                    <div className="xhs-image-layout-options" role="radiogroup" aria-label="选择图片布局">
                      {([['full', '通栏'], ['image-left', '左图右文'], ['image-right', '左文右图']] as const).map(([layout, label]) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selectedXhsImage.layout === layout}
                          className={selectedXhsImage.layout === layout ? 'selected' : ''}
                          disabled={layout !== 'full' && !selectedXhsImage.canPair}
                          title={layout !== 'full' && !selectedXhsImage.canPair ? '图片后需要有可配对的正文段落' : undefined}
                          key={layout}
                          onClick={() => changeSelectedXhsImageLayout(layout)}
                        >{label}</button>
                      ))}
                    </div>
                    <label className="xhs-image-width-control">
                      <span><strong>图片宽度</strong><output>{Math.round(selectedXhsImage.widthPercent)}%</output></span>
                      <input
                        type="range"
                        min={selectedXhsImage.layout === 'full' ? XHS_IMAGE_FULL_MIN_WIDTH : XHS_IMAGE_SPLIT_MIN_WIDTH}
                        max={selectedXhsImage.layout === 'full' ? 100 : XHS_IMAGE_SPLIT_MAX_WIDTH}
                        value={selectedXhsImage.widthPercent}
                        aria-label="调整选中图片宽度"
                        onChange={event => changeSelectedXhsImageWidth(Number(event.target.value))}
                      />
                    </label>
                    <button type="button" className="xhs-image-reset" onClick={() => resetXhsImageOverride(selectedXhsImage.key)}>恢复默认</button>
                  </div>
                </section>
              )}

              {toolRailOpen.xhs && (
                <div
                  className="preview-tool-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整小红书工具侧栏宽度"
                  aria-orientation="vertical"
                  aria-valuemin={TOOL_RAIL_MIN_WIDTH}
                  aria-valuemax={TOOL_RAIL_MAX_WIDTH}
                  aria-valuenow={toolRailWidth}
                  title="向左右拖动调整宽度；缩到最窄后松开可收起"
                  onPointerDown={startToolRailResize}
                  onPointerMove={moveToolRailResize}
                  onPointerUp={finishToolRailResize}
                  onPointerCancel={finishToolRailResize}
                  onKeyDown={adjustToolRailWithKeyboard}
                ><span /></div>
              )}
              <aside id="xhs-tool-panel" className="xhs-tool-rail preview-tool-rail" aria-label="小红书预览工具" hidden={!toolRailOpen.xhs}>
                <header className="preview-tool-rail-heading xhs-tool-rail-heading">
                  <span><strong>小红书工具</strong><small>预览、排版与图片导出</small></span>
                </header>
                <FormattingAccordion
                  idPrefix="xhs-settings"
                  label="小红书设置模块"
                  openSection={openFormattingSection.xhs}
                  onSectionToggle={section => toggleFormattingSection('xhs', section)}
                  formatting={formatting}
                  onFormattingChange={onFormattingChange}
                  layoutContent={(
                    <section className="xhs-template-tools" aria-label="小红书视觉模板">
                      <div className="xhs-tool-heading"><strong>视觉模板</strong><small>{XHS_TEMPLATE_OPTIONS.length} 套 · 三页预览</small></div>
                      <div className="xhs-template-category-nav" role="tablist" aria-label="选择模板分类">
                        {XHS_TEMPLATE_CATEGORIES.map(category => (
                          <button
                            id={`xhs-template-category-${category.id}`}
                            type="button"
                            role="tab"
                            aria-selected={xhsTemplateCategory === category.id}
                            aria-controls="xhs-template-category-panel"
                            className={xhsTemplateCategory === category.id ? 'selected' : ''}
                            key={category.id}
                            onClick={() => setXhsTemplateCategory(category.id)}
                          >{category.label}</button>
                        ))}
                      </div>
                      <p className="xhs-template-category-description" aria-live="polite">{activeXhsTemplateCategory.detail}</p>
                      <div
                        id="xhs-template-category-panel"
                        role="tabpanel"
                        aria-labelledby={`xhs-template-category-${activeXhsTemplateCategory.id}`}
                      >
                        <div className="xhs-template-gallery" role="radiogroup" aria-label={`选择${activeXhsTemplateCategory.label}模板`}>
                          {activeXhsTemplateCategory.templates.map((option, optionIndex) => (
                            <section
                              className={`xhs-template-showcase${xhsSettings.template === option.value ? ' selected' : ''}`}
                              aria-labelledby={`xhs-template-${option.value}`}
                              key={option.value}
                            >
                              <header>
                                <span><strong id={`xhs-template-${option.value}`}>{option.label}</strong><small>{option.detail}</small></span>
                                <b>{String(optionIndex + 1).padStart(2, '0')}</b>
                              </header>
                              <div className="xhs-template-options">
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={xhsSettings.template === option.value}
                                  aria-label={`${option.label}：${option.detail}`}
                                  title={`选择${option.label}`}
                                  className={`xhs-template-option template-${option.value}${xhsSettings.template === option.value ? ' selected' : ''}`}
                                  onClick={() => applyXhsTemplate(option.value)}
                                >
                                  <span className="xhs-template-triptych" aria-hidden="true">
                                    {(['cover', 'article', 'image'] as const).map(variant => (
                                      <span className="xhs-template-mock" data-template={option.value} data-variant={variant} key={variant}><i /><i /><i /><i /><i /></span>
                                    ))}
                                  </span>
                                </button>
                              </div>
                            </section>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}
                />

                <details className="xhs-tool-section xhs-settings-disclosure xhs-metadata-tools xhs-output-tools" aria-label="小红书输出信息">
                  <summary><span><strong>输出信息</strong><small>页码 · 署名</small></span><ChevronDown size={15} aria-hidden="true" /></summary>
                  <div className="xhs-decoration-options">
                    <label><input type="checkbox" checked={xhsSettings.showPageNumber} onChange={event => updateXhsSettings({ ...xhsSettings, showPageNumber: event.target.checked })} /> 显示右上页码</label>
                    <label><input type="checkbox" checked={xhsSettings.showFooter} onChange={event => updateXhsSettings({ ...xhsSettings, showFooter: event.target.checked })} /> 显示底部信息</label>
                  </div>
                  <label className="xhs-footer-input">左下角文字<input value={xhsSettings.footerText} disabled={!xhsSettings.showFooter} maxLength={24} onChange={event => updateXhsSettings({ ...xhsSettings, footerText: event.target.value })} /></label>
                </details>

                <section className="xhs-tool-section xhs-download-tools preview-tool-rail-footer">
                  <div className="xhs-tool-heading"><strong>下载图片</strong><small>PNG / ZIP</small></div>
                  <button type="button" className="xhs-rail-action primary" onClick={() => void downloadAllCards()} disabled={exporting !== null}>{exporting === 'all' ? <LoaderCircle className="spin" size={15} /> : <Layers3 size={15} />}<span>下载全部图片</span></button>
                  {exportError && <div className="xhs-export-error" role="alert">{exportError}</div>}
                </section>
              </aside>
            </div>
          </article>
        )}

        {activePlatform === 'x' && (
          <article className="single-platform-preview x-preview">
            <div className={`x-layout ${toolRailOpen.x ? 'tool-rail-open' : ''}`}>
              <div ref={viewportRef} className="platform-preview-viewport x-viewport" onScroll={rememberScroll}>
                <div className="x-native-editor">
                  <div className="x-article">
                    <h1
                      data-edit-target="title"
                      role="button"
                      tabIndex={0}
                      onClick={() => selectTarget({ kind: 'title' })}
                      onKeyDown={event => selectStandaloneTargetWithKeyboard(event, 'title')}
                    >{title || '未命名文章'}</h1>
                    <div className="x-article-author"><span className="x-article-avatar">{profileAvatar}</span><span><strong>{profileName}</strong><small>{profileHandle}</small></span></div>
                    <div className="x-article-content" onClick={handleBodyClick} onKeyDown={handleBodyKeyDown} dangerouslySetInnerHTML={{ __html: mappedPreview.html }} />
                  </div>
                </div>
              </div>
              {toolRailOpen.x && (
                <div
                  className="preview-tool-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-label="调整 X 长文排版侧栏宽度"
                  aria-orientation="vertical"
                  aria-valuemin={TOOL_RAIL_MIN_WIDTH}
                  aria-valuemax={TOOL_RAIL_MAX_WIDTH}
                  aria-valuenow={toolRailWidth}
                  title="向左右拖动调整宽度；缩到最窄后松开可收起"
                  onPointerDown={startToolRailResize}
                  onPointerMove={moveToolRailResize}
                  onPointerUp={finishToolRailResize}
                  onPointerCancel={finishToolRailResize}
                  onKeyDown={adjustToolRailWithKeyboard}
                ><span /></div>
              )}
              <aside id="x-formatting-panel" className="x-formatting-rail preview-tool-rail" aria-label="X 长文排版设置" hidden={!toolRailOpen.x}>
                <header className="preview-tool-rail-heading">
                  <span><strong>X 长文排版</strong><small>设置只在选中后生效</small></span>
                </header>
                <FormattingAccordion
                  idPrefix="x-settings"
                  label="X 长文设置模块"
                  openSection={openFormattingSection.x}
                  onSectionToggle={section => toggleFormattingSection('x', section)}
                  formatting={formatting}
                  onFormattingChange={onFormattingChange}
                  layoutContent={(
                    <section className="x-formatting-section x-layout-controls">
                      <strong>版式</strong>
                      <div className="x-formatting-options three" role="radiogroup" aria-label="选择文章版式">
                        {([['clean', '简洁'], ['editorial', '刊物'], ['wechat', '强调']] as const).map(([value, label]) => <button type="button" role="radio" aria-checked={formatting.theme === value} className={formatting.theme === value ? 'selected' : ''} key={value} onClick={() => onFormattingChange?.({ ...formatting, theme: value })}>{label}</button>)}
                      </div>
                    </section>
                  )}
                />
              </aside>
            </div>
          </article>
        )}
      </div>

      {previewDevice === 'mobile' && (
        <div className="mobile-preview-overlay" role="dialog" aria-modal="true" aria-label={`${activePlatform === 'wechat' ? '微信公众号' : activePlatform === 'xhs' ? '小红书' : 'X 长文'}手机效果预览`}>
          <button type="button" className="mobile-preview-backdrop" aria-label="关闭手机预览" onClick={closeMobilePreview} />
          <div ref={mobileDialogRef} className="mobile-preview-dialog" onKeyDown={handleMobileDialogKeyDown}>
            <div className="mobile-preview-caption"><span>iPhone Pro Max · 效果预览</span><button ref={mobileCloseButtonRef} type="button" onClick={closeMobilePreview} aria-label="关闭手机预览"><CloseIcon size={18} /></button></div>
            <div className={`phone-device platform-${activePlatform}`}>
              <div className="phone-screen">
                <div className="phone-statusbar"><strong>9:41</strong><span><Signal size={13} /><Wifi size={13} /><BatteryFull size={15} /></span></div>

                {activePlatform === 'wechat' && (
                  <div className="mobile-wechat-preview">
                    <header><button type="button" onClick={closeMobilePreview} aria-label="返回工作台"><ChevronLeft size={21} /></button><strong>公众号文章</strong><span /></header>
                    <div className="mobile-article-scroll">
                      <h1>{title || '未命名文章'}</h1>
                      <p className="mobile-wechat-meta">{profileName} · 公众号草稿</p>
                      <div className="mobile-wechat-content" dangerouslySetInnerHTML={{ __html: mappedWechatPreview.html }} />
                    </div>
                  </div>
                )}

                {activePlatform === 'xhs' && (
                  <div className="mobile-xhs-preview">
                    <header className="mobile-xhs-header">
                      <button type="button" onClick={closeMobilePreview} aria-label="返回工作台"><ChevronLeft size={22} /></button>
                      <span className="mobile-profile-avatar">{profileAvatar}</span>
                      <strong>{profileName}</strong>
                      <button type="button" className="mobile-follow-button">关注</button>
                      <span className="mobile-share-icon"><Share2 size={19} /></span>
                    </header>
                    <div className="mobile-xhs-card-viewport">
                      <span className="mobile-xhs-counter">{activeCard + 1}/{cardPages.length}</span>
                      <div className="mobile-xhs-card-stage">
                        <button type="button" className="mobile-card-nav previous" onClick={() => changeActiveCard(activeCard - 1)} disabled={activeCard === 0} aria-label="上一张图片"><ChevronLeft size={20} /></button>
                        {renderXhsCard(cardPages[activeCard], activeCard)}
                        <button type="button" className="mobile-card-nav next" onClick={() => changeActiveCard(activeCard + 1)} disabled={activeCard === cardPages.length - 1} aria-label="下一张图片"><ChevronRight size={20} /></button>
                      </div>
                    </div>
                    <footer className="mobile-xhs-actions"><span>说点什么…</span><Heart size={20} /><small>点赞</small><Bookmark size={20} /><small>收藏</small><MessageCircle size={20} /><small>评论</small></footer>
                  </div>
                )}

                {activePlatform === 'x' && (
                  <div className="mobile-x-preview">
                    <header className="mobile-x-header"><button type="button" onClick={closeMobilePreview} aria-label="返回工作台"><ChevronLeft size={22} /></button><img src={xLogo} alt="" /><strong>Article</strong><span><Share2 size={18} /><MoreHorizontal size={18} /></span></header>
                    <div className="mobile-x-scroll">
                      <h1>{title || '未命名文章'}</h1>
                      <div className="mobile-x-author"><span>{profileAvatar}</span><strong>{profileName}</strong><small>{profileHandle}</small></div>
                      <div className="mobile-x-content" dangerouslySetInnerHTML={{ __html: mappedPreview.html }} />
                    </div>
                  </div>
                )}

                <div className="phone-home-indicator" aria-hidden="true"><span /></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {xhsImagePreview && (
        <div className="xhs-image-preview-layer" role="dialog" aria-modal="true" aria-label={`小红书第 ${xhsImagePreview.index + 1} 张图片放大预览`}>
          <button type="button" className="xhs-image-preview-backdrop" aria-label="关闭图片预览" onClick={closeCardPreview} />
          <section className="xhs-image-preview-window">
            <header>
              <span><strong>图片 {String(xhsImagePreview.index + 1).padStart(2, '0')}</strong><small>{xhsImagePreview.index + 1} / {cardPages.length}</small></span>
              <div className="xhs-image-zoom-controls" role="group" aria-label="调整图片缩放">
                <button type="button" aria-label="缩小图片" disabled={xhsImageZoom === XHS_PREVIEW_MIN_ZOOM} onClick={() => setXhsImageZoom(current => Math.max(XHS_PREVIEW_MIN_ZOOM, current - XHS_PREVIEW_ZOOM_STEP))}><Minus size={16} /></button>
                <input type="range" min={XHS_PREVIEW_MIN_ZOOM} max={XHS_PREVIEW_MAX_ZOOM} step={XHS_PREVIEW_ZOOM_STEP} value={xhsImageZoom} aria-label="图片缩放比例" onChange={event => setXhsImageZoom(Number(event.target.value))} />
                <button type="button" aria-label="放大图片" disabled={xhsImageZoom === XHS_PREVIEW_MAX_ZOOM} onClick={() => setXhsImageZoom(current => Math.min(XHS_PREVIEW_MAX_ZOOM, current + XHS_PREVIEW_ZOOM_STEP))}><Plus size={16} /></button>
                <button type="button" className="xhs-image-zoom-value" aria-label="恢复图片到 100%" onClick={() => setXhsImageZoom(100)}>{xhsImageZoom}%</button>
              </div>
              <button type="button" className="xhs-image-preview-close" aria-label="关闭图片预览" onClick={closeCardPreview}><CloseIcon size={18} /></button>
            </header>
            <div className="xhs-image-preview-viewport">
              <img
                src={xhsImagePreview.url}
                alt={`小红书第 ${xhsImagePreview.index + 1} 张导出图片`}
                style={{ '--xhs-image-preview-scale': xhsImageZoom / 100 } as CSSProperties}
              />
            </div>
          </section>
        </div>
      )}

      {activePlatform === 'xhs' && exportSheetActive && (
        <div className="xhs-export-sheet" aria-hidden="true">
          {cardPages.map((page, index) => <div className="xhs-export-page" key={index}>{renderXhsCard(page, index, { exportRef: true })}</div>)}
        </div>
      )}
    </section>
  )
}
