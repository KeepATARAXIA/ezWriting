import { XhsOverviewPage } from './xhs-overview-page'
import { expandLocalImageReferences } from '../lib/local-image-registry'
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
import { isGifSource, observeStaticPreviewMedia, prepareStaticPreviewMedia, restorePreviewGifSources } from '../lib/media-preview'
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
  type XhsTemplateFontMode,
} from '../domain/saved-draft'
import {
  getXhsDefaultPaletteId,
  getXhsFontPreset,
  getXhsTemplatePalette,
  getXhsTemplateStyle,
  type XhsTemplatePalette,
} from '../domain/xhs-template'
import { captureXhsCard, downloadBlob, safeDownloadName } from '../lib/xhs-export'
import { paginateForXhsCards, paginateForXhsCardsAsync } from '../lib/xhs-pagination'
import { createXhsCardPageMeasurer, waitForXhsPaginationAssets } from '../lib/xhs-pagination-measurement'
import { renderMissingImagePlaceholders } from '../lib/missing-assets'
import { expandLocalVideoReferences, materializeLocalVideoHtml } from '../lib/local-video-registry'
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

interface XhsImageSelectionBounds {
  key: string
  left: number
  top: number
  width: number
  height: number
}

interface PlatformPreviewsProps {
  syncScroll?: boolean
  onSyncScrollChange?: (enabled: boolean) => void
  activePlatform: PreviewPlatform
  title: string
  html: string
  sourceText?: string
  sourceLanguage?: ArticleSourceLanguage
  formatting: ArticleFormatting
  renderFormatting?: ArticleFormatting
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
  useCase: string
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
      { value: 'memo', label: '灵感备忘', detail: '深色卡片 · 亮黄标注', useCase: '观点随笔、灵感记录' },
      { value: 'quote', label: '轻感明快', detail: '柠檬纸色 · 大号引语', useCase: '金句合集、情绪表达' },
      { value: 'doodle', label: '涂鸦马克', detail: '手写标记 · 蓝色涂鸦', useCase: '创意教程、轻松分享' },
      { value: 'soft', label: '黄昏手稿', detail: '暖粉纸色 · 手稿气质', useCase: '生活感悟、温柔叙事' },
    ],
  },
  {
    id: 'editorial',
    label: '杂志',
    detail: '网格、几何与编辑设计',
    templates: [
      { value: 'retro', label: '线条复古', detail: '细线框架 · 复古图文', useCase: '品牌故事、人物访谈' },
      { value: 'geometry', label: '优雅几何', detail: '留白几何 · 柔色构成', useCase: '审美趋势、设计观察' },
      { value: 'headline', label: '杂志先锋', detail: '荧光标题 · 杂志网格', useCase: '潮流观点、专题策划' },
      { value: 'editorial', label: '文艺清新', detail: '书卷留白 · 图文散文', useCase: '旅行散文、文化生活' },
    ],
  },
  {
    id: 'paper',
    label: '纸感',
    detail: '手帐、纹理与书卷气质',
    templates: [
      { value: 'journal', label: '手帐书写', detail: '胶带照片 · 旅行手帐', useCase: '旅行记录、日常手帐' },
      { value: 'texture', label: '素雅底纹', detail: '淡蓝纸纹 · 典雅宋体', useCase: '读书笔记、人文观察' },
      { value: 'mono', label: '黑白极简', detail: '暖白纸张 · 极简长文', useCase: '深度长文、克制表达' },
      { value: 'dust', label: '札记集尘', detail: '竖排题签 · 旧纸札记', useCase: '历史札记、旧物故事' },
    ],
  },
  {
    id: 'information',
    label: '信息',
    detail: '知识、结构与清晰阅读',
    templates: [
      { value: 'focus', label: '清晰明朗', detail: '建筑留白 · 清晰标题', useCase: '方法教程、经验总结' },
      { value: 'index', label: '理性现代', detail: '红黑秩序 · 学术信息', useCase: '行业分析、研究摘要' },
      { value: 'logic', label: '逻辑结构', detail: '粉色标线 · 逻辑拆解', useCase: '框架拆解、知识清单' },
      { value: 'clean', label: '简约基础', detail: '中性留白 · 基础长文', useCase: '通用长文、稳定阅读' },
    ],
  },
  {
    id: 'composition',
    label: '构成',
    detail: '大图、叙事与色块编排',
    templates: [
      { value: 'hero', label: '大图纯字', detail: '大图封面 · 纯字叠加', useCase: '摄影故事、人物专题' },
      { value: 'narrative', label: '平实叙事', detail: '黑白图文 · 平实叙述', useCase: '纪实记录、产品故事' },
      { value: 'fresh', label: '拼接色块', detail: '荧光拼接 · 信息卡片', useCase: '趋势速读、年轻议题' },
      { value: 'topology', label: '交叉拓扑', detail: '绿橙色块 · 交叉构成', useCase: '创意提案、先锋观点' },
    ],
  },
]

const XHS_TEMPLATE_OPTIONS = XHS_TEMPLATE_CATEGORIES.flatMap(category => category.templates)
function WechatThemeGraphic({
  motif,
  index,
}: {
  motif: string
  index: number
}) {
  return (
    <div className="wechat-theme-graphic" data-motif={motif} aria-hidden="true">
      <span className="wechat-theme-graphic-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="wechat-theme-graphic-mark" data-preview-part="accent" />
      <span className="wechat-theme-graphic-title" data-preview-part="title"><span /><span /></span>
      <span className="wechat-theme-graphic-copy" data-preview-part="body"><span /><span /><span /></span>
      <span className="wechat-theme-graphic-quote" data-preview-part="quote"><span /><span /></span>
    </div>
  )
}

type XhsTemplateVariables = Record<`--xhs-${string}`, string>

const XHS_OVERRIDE_FONT_PRESETS = {
  sans: {
    label: '通用黑体',
    titleFamily: ARTICLE_FONT_FAMILIES.sans,
    bodyFamily: ARTICLE_FONT_FAMILIES.sans,
    titleWeight: 900,
    titleLetterSpacing: '-0.045em',
  },
  serif: {
    label: '通用宋体',
    titleFamily: ARTICLE_FONT_FAMILIES.serif,
    bodyFamily: ARTICLE_FONT_FAMILIES.serif,
    titleWeight: 720,
    titleLetterSpacing: '-0.02em',
  },
} as const

function isDarkHexColor(color: string): boolean {
  const match = color.match(/^#([0-9a-f]{6})$/i)
  if (!match) return false
  const value = Number.parseInt(match[1], 16)
  const channels = [value >> 16, (value >> 8) & 255, value & 255].map(channel => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 0.28
}

function xhsTemplateVariables(
  template: XhsCardTemplate,
  paletteId: string,
  fontMode: XhsTemplateFontMode = 'template',
): XhsTemplateVariables {
  const palette = getXhsTemplatePalette(template, paletteId)
  const templateFont = getXhsFontPreset(template)
  const font = fontMode === 'template' ? templateFont : XHS_OVERRIDE_FONT_PRESETS[fontMode]
  const darkBackground = isDarkHexColor(palette.background)
  return {
    '--xhs-bg': palette.background,
    '--xhs-surface': palette.surface,
    '--xhs-ink': palette.ink,
    '--xhs-heading': palette.heading,
    '--xhs-accent': palette.accent,
    '--xhs-secondary': palette.secondary,
    '--xhs-soft': palette.soft,
    '--xhs-border': palette.border,
    '--xhs-muted': palette.muted,
    '--xhs-inverse': palette.inverse,
    '--xhs-highlight-bg': darkBackground ? palette.accent : palette.soft,
    '--xhs-highlight-ink': darkBackground ? palette.inverse : palette.heading,
    '--xhs-title-font': font.titleFamily,
    '--xhs-body-font': font.bodyFamily,
    '--xhs-title-weight': String(font.titleWeight),
    '--xhs-title-letter-spacing': font.titleLetterSpacing,
  }
}

function XhsPaletteSwatch({ palette }: { palette: XhsTemplatePalette }) {
  return (
    <span className="xhs-palette-swatch" aria-hidden="true">
      <i style={{ background: palette.background }} />
      <i style={{ background: palette.accent }} />
      <i style={{ background: palette.secondary }} />
      <i style={{ background: palette.heading }} />
    </span>
  )
}

function XhsPaletteControls({
  template,
  paletteId,
  onChange,
}: {
  template: XhsCardTemplate
  paletteId: string
  onChange: (paletteId: string) => void
}) {
  const palettes = getXhsTemplateStyle(template).palettes
  const selected = getXhsTemplatePalette(template, paletteId)
  return (
    <div className="xhs-palette-controls">
      <div className="xhs-palette-control-heading"><strong>模板专属色板</strong><small>{selected.label} · 整套换色</small></div>
      <div className="xhs-palette-options" role="radiogroup" aria-label="选择小红书模板色板">
        {palettes.map(option => (
          <button
            type="button"
            role="radio"
            aria-label={`${option.label}色板`}
            aria-checked={paletteId === option.id}
            className={`xhs-palette-option${paletteId === option.id ? ' selected' : ''}`}
            title={option.label}
            key={option.id}
            onClick={() => onChange(option.id)}
          >
            <XhsPaletteSwatch palette={option} />
          </button>
        ))}
      </div>
    </div>
  )
}

function XhsTemplateGraphic({ template, paletteId }: { template: XhsCardTemplate; paletteId: string }) {
  return (
    <div className="xhs-template-graphic" data-template={template} style={xhsTemplateVariables(template, paletteId)} aria-hidden="true">
      <span className="xhs-template-graphic-panel is-cover" data-preview-part="cover">
        <span className="xhs-template-graphic-kicker" />
        <span className="xhs-template-graphic-heading"><span /><span /></span>
        <span className="xhs-template-graphic-seal" />
      </span>
      <span className="xhs-template-graphic-panel is-article" data-preview-part="article">
        <span className="xhs-template-graphic-section" />
        <span className="xhs-template-graphic-lines"><span /><span /><span /></span>
        <span className="xhs-template-graphic-quote"><span /><span /></span>
      </span>
      <span className="xhs-template-graphic-panel is-image" data-preview-part="image">
        <span className="xhs-template-graphic-picture"><span /><span /></span>
        <span className="xhs-template-graphic-caption"><span /><span /></span>
      </span>
    </div>
  )
}

function xhsTemplateCategoryFor(template: XhsCardTemplate): XhsTemplateCategoryId {
  return XHS_TEMPLATE_CATEGORIES.find(category => category.templates.some(option => option.value === template))?.id ?? 'information'
}

const TOOL_RAIL_DEFAULT_WIDTH = 280
const TOOL_RAIL_MIN_WIDTH = 240
const TOOL_RAIL_MAX_WIDTH = 420
const TOOL_RAIL_COLLAPSE_WIDTH = 180
const TOOL_RAIL_WIDTH_KEY = 'dispatch.preview-tool-rail-width.v1'
const TOOL_RAIL_OPEN_KEY = 'dispatch.preview-tool-rail-open.v2'
const XHS_FONT_SIZE_SCALE = { small: 0.9, medium: 1, large: 1.1 } as const
const XHS_LINE_HEIGHT_SCALE = { compact: 0.92, comfortable: 1, airy: 1.1 } as const
const XHS_FONT_SIZES = { small: '13.5px', medium: '15px', large: '16.5px' } as const
const XHS_LINE_HEIGHTS = { compact: '1.58', comfortable: '1.72', airy: '1.9' } as const
const XHS_PREVIEW_MIN_ZOOM = 25
const XHS_PREVIEW_MAX_ZOOM = 300
const XHS_PREVIEW_ZOOM_STEP = 25
const XHS_SYNC_PAGINATION_HTML_LIMIT = 8_000
const XHS_PENDING_PAGE = '<p data-xhs-pagination-pending="true">正在生成卡片预览…</p>'
const XHS_IMAGE_FULL_MIN_WIDTH = 35
const XHS_IMAGE_SPLIT_MIN_WIDTH = 30
const XHS_IMAGE_SPLIT_MAX_WIDTH = 70
const XHS_IMAGE_POPOVER_WIDTH = 300
const XHS_IMAGE_POPOVER_HEIGHT = 205
const XHS_IMAGE_POPOVER_GAP = 12
const XHS_PAGE_RANGE_SIZE = 10

function scheduleIdleWork(callback: () => void, timeout = 300): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = window.setTimeout(callback, 0)
  return () => window.clearTimeout(handle)
}
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
  currentWidth: number
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
    return { wechat: value.wechat === true, xhs: value.xhs === true, x: value.x === true }
  } catch {
    return { wechat: false, xhs: false, x: false }
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

function prepareCopiedVideos(document: Document): void {
  document.body.querySelectorAll<HTMLVideoElement>('video').forEach(video => {
    video.controls = true
    video.autoplay = false
    video.preload = 'metadata'
    video.removeAttribute('autoplay')
    video.removeAttribute('data-ez-video-preview')
    video.setAttribute('controls', '')
  })
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
  applyPlatformCompatibilityToDocument(document, target, { replaceVideos: false })
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
  // Xiaohongshu keeps its existing native-upload notice for video blocks.
  if (target === 'xhs') applyPlatformCompatibilityToDocument(document, 'xhs')
  prepareStaticPreviewMedia(document)
  return { html: document.body.innerHTML, blockCount: blockIndex }
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

function XhsFontControls({
  formatting,
  settings,
  onFormattingChange,
  onFontModeChange,
}: {
  formatting: ArticleFormatting
  settings: XhsCardSettings
  onFormattingChange?: (formatting: ArticleFormatting) => void
  onFontModeChange: (fontMode: XhsTemplateFontMode) => void
}) {
  const templateFont = getXhsFontPreset(settings.template)
  return (
    <div className="article-formatting-controls article-font-controls xhs-font-controls">
      <section className="x-formatting-section">
        <span className="xhs-template-font-intro"><strong>{templateFont.label}</strong><small>{templateFont.detail}</small></span>
        <div className="x-formatting-options three" role="radiogroup" aria-label="选择小红书文章字体">
          {([
            ['template', '跟随模板'],
            ['sans', '黑体'],
            ['serif', '宋体'],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              role="radio"
              aria-checked={settings.fontMode === value}
              className={settings.fontMode === value ? 'selected' : ''}
              key={value}
              onClick={() => onFontModeChange(value)}
            >{label}</button>
          ))}
        </div>
      </section>
      <section className="x-formatting-section">
        <strong>字号</strong>
        <div className="x-formatting-options three" role="radiogroup" aria-label="选择文章字号">
          {([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button type="button" role="radio" aria-checked={formatting.fontSize === value} className={formatting.fontSize === value ? 'selected' : ''} key={value} onClick={() => onFormattingChange?.({ ...formatting, fontSize: value })}>{label}</button>)}
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
  openSections,
  onSectionToggle,
  formatting,
  onFormattingChange,
  layoutContent,
  fontContent,
  colorControls,
  colorContent,
}: {
  idPrefix: string
  label: string
  openSections: readonly FormattingSection[]
  onSectionToggle: (section: FormattingSection) => void
  formatting: ArticleFormatting
  onFormattingChange?: (formatting: ArticleFormatting) => void
  layoutContent: ReactNode
  fontContent?: ReactNode
  colorControls?: ReactNode
  colorContent?: ReactNode
}) {
  const contentBySection: Record<FormattingSection, ReactNode> = {
    layout: layoutContent,
    font: fontContent ?? <FontControls formatting={formatting} onChange={onFormattingChange} />,
    spacing: <SpacingControls formatting={formatting} onChange={onFormattingChange} />,
    color: (
      <>
        {colorControls ?? <AccentControls formatting={formatting} onChange={onFormattingChange} />}
        {colorContent}
      </>
    ),
  }

  return (
    <div className="settings-accordion" aria-label={label}>
      {FORMATTING_SECTION_META.map(section => {
        const expanded = openSections.includes(section.value)
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

export function PlatformPreviews({ activePlatform, title, html, sourceText, sourceLanguage, formatting, renderFormatting, onFormattingChange, xhsSettings: controlledXhsSettings, onXhsSettingsChange, previewAccount, previewDevice, isUpdating = false, onPreviewDeviceChange, locateRequest, onEditTarget, onMissingImageAction, syncScroll = true, onSyncScrollChange }: PlatformPreviewsProps) {
  const previewFormatting = renderFormatting ?? formatting
  const [uncontrolledXhsSettings, setUncontrolledXhsSettings] = useState<XhsCardSettings>(DEFAULT_XHS_CARD_SETTINGS)
  const xhsSettings = controlledXhsSettings ?? uncontrolledXhsSettings
  const updateXhsSettings = onXhsSettingsChange ?? setUncontrolledXhsSettings
  const [xhsTemplateCategory, setXhsTemplateCategory] = useState<XhsTemplateCategoryId>(() => xhsTemplateCategoryFor(xhsSettings.template))
  const activeXhsTemplateCategory = XHS_TEMPLATE_CATEGORIES.find(category => category.id === xhsTemplateCategory) ?? XHS_TEMPLATE_CATEGORIES[3]
  const activeXhsPalette = getXhsTemplatePalette(xhsSettings.template, xhsSettings.paletteId)
  const activeXhsFont = xhsSettings.fontMode === 'template'
    ? getXhsFontPreset(xhsSettings.template)
    : XHS_OVERRIDE_FONT_PRESETS[xhsSettings.fontMode]
  const [selectedTarget, setSelectedTarget] = useState<PreviewEditTarget | null>(null)
  const [activeCard, setActiveCard] = useState(0)
  const [xhsPreviewMode, setXhsPreviewMode] = useState<XhsPreviewMode>('single')
  const [xhsPageJumpOpen, setXhsPageJumpOpen] = useState(false)
  const [selectedXhsImageKey, setSelectedXhsImageKey] = useState<string | null>(null)
  const [xhsImageSelectionBounds, setXhsImageSelectionBounds] = useState<XhsImageSelectionBounds | null>(null)
  const [xhsImagePopover, setXhsImagePopover] = useState<XhsImagePopoverPosition | null>(null)
  const [wechatThemeCategory, setWechatThemeCategory] = useState<WechatThemeCategory>('简约')
  const [toolRailWidth, setToolRailWidth] = useState(readToolRailWidth)
  const [toolRailLayout, setToolRailLayout] = useState<{ max: number; value: number } | null>(null)
  const [toolRailOpen, setToolRailOpen] = useState(readToolRailOpen)
  const [openFormattingSections, setOpenFormattingSections] = useState<Record<PreviewPlatform, FormattingSection[]>>({
    wechat: ['layout'],
    xhs: ['layout'],
    x: ['layout'],
  })
  const [wechatCopyState, setWechatCopyState] = useState<WechatCopyState>('idle')
  const [xCopyState, setXCopyState] = useState<WechatCopyState>('idle')
  useEffect(() => { setXCopyState('idle') }, [html, activePlatform])
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const viewport = window.matchMedia('(max-width: 700px)')
    const sync = () => setToolRailOpen(viewport.matches ? { wechat: false, xhs: false, x: false } : readToolRailOpen())
    sync()
    viewport.addEventListener('change', sync)
    return () => viewport.removeEventListener('change', sync)
  }, [])
  const mediaNotice = useMemo(() => {
    const document = parseHtml(html)
    const missing = document.querySelectorAll('img[data-missing-id], img:not([src]), img[src=""]').length
    const gifs = Array.from(document.querySelectorAll('img')).filter(image => isGifSource(image.getAttribute('src') || '')).length
    const videos = document.querySelectorAll('video').length
    return [missing ? `${missing} 张图片待补齐` : '', gifs && activePlatform === 'xhs' ? `${gifs} 个 GIF 将输出为静态图片` : '', videos ? `${videos} 个视频需在目标平台手动上传` : ''].filter(Boolean).join(' · ')
  }, [html, activePlatform])
  const [exporting, setExporting] = useState<number | 'all' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [previewingCard, setPreviewingCard] = useState<number | null>(null)
  const [exportSnapshot, setExportSnapshot] = useState<{ pages: string[]; title: string; settings: XhsCardSettings; variables: Record<string, string> } | null>(null)
  const exportSheetActive = exportSnapshot !== null
  const [xhsImagePreview, setXhsImagePreview] = useState<{ index: number; url: string } | null>(null)
  const [xhsImageZoom, setXhsImageZoom] = useState(100)
  const [estimatedPagination, setEstimatedPagination] = useState<{ key: object; pages: string[] } | null>(null)
  const [measuredPagination, setMeasuredPagination] = useState<{ key: object; pages: string[] } | null>(null)

  useEffect(() => {
    setXhsTemplateCategory(xhsTemplateCategoryFor(xhsSettings.template))
  }, [xhsSettings.template])

  const sourceLineMap = useMemo(
    () => sourceText ? sourceLinesByBlock(sourceText, sourceLanguage ?? 'markdown') : [],
    [sourceLanguage, sourceText],
  )
  const playableHtml = useMemo(() => materializeLocalVideoHtml(html), [html])
  const mappedPreview = useMemo(
    () => activePlatform === 'wechat'
      ? { html: '', blockCount: 0 }
      : mapPreviewBlocks(renderMissingImagePlaceholders(playableHtml), sourceLineMap, activePlatform),
    [activePlatform, playableHtml, sourceLineMap],
  )
  const wechatSettings = useMemo(() => normalizeWechatThemeSettings(formatting.wechat), [formatting.wechat])
  const previewWechatSettings = useMemo(
    () => normalizeWechatThemeSettings(previewFormatting.wechat),
    [previewFormatting.wechat],
  )
  const mappedWechatPreview = useMemo(
    () => activePlatform === 'wechat'
      ? mapPreviewBlocks(applyWechatTheme(renderMissingImagePlaceholders(playableHtml), previewWechatSettings, previewFormatting), sourceLineMap, 'wechat')
      : { html: '', blockCount: 0 },
    [activePlatform, playableHtml, previewFormatting, previewWechatSettings, sourceLineMap],
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
    textScale: XHS_FONT_SIZE_SCALE[previewFormatting.fontSize] * XHS_LINE_HEIGHT_SCALE[previewFormatting.lineHeight],
    showFooter: xhsSettings.showFooter,
  }), [previewFormatting.fontSize, previewFormatting.lineHeight, title, xhsSettings.showFooter])
  // An identity for the content/geometric revision, never a concatenated copy of HTML.
  const paginationKey = useMemo(() => ({}), [
    previewFormatting.fontSize,
    previewFormatting.lineHeight,
    preparedXhsLayout.html,
    title,
    xhsSettings.footerText,
    xhsSettings.fontMode,
    xhsSettings.showFooter,
    xhsSettings.template,
  ])
  const shouldDeferEstimatedPagination = activePlatform === 'xhs'
    && preparedXhsLayout.html.length > XHS_SYNC_PAGINATION_HTML_LIMIT
  const synchronousEstimatedPages = useMemo(
    () => activePlatform === 'xhs' && !shouldDeferEstimatedPagination
      ? paginateForXhsCards(preparedXhsLayout.html, xhsPaginationOptions)
      : [],
    [activePlatform, preparedXhsLayout.html, shouldDeferEstimatedPagination, xhsPaginationOptions],
  )
  const estimatedCardPages = shouldDeferEstimatedPagination
    ? estimatedPagination?.key === paginationKey ? estimatedPagination.pages : []
    : synchronousEstimatedPages
  const paginationPending = activePlatform === 'xhs' && estimatedCardPages.length === 0
  const paginationSettling = activePlatform === 'xhs' && (paginationPending || measuredPagination?.key !== paginationKey)
  const cardPages = activePlatform === 'xhs' && measuredPagination?.key === paginationKey
    ? measuredPagination.pages
    : estimatedCardPages.length ? estimatedCardPages : [XHS_PENDING_PAGE]
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
  useEffect(() => {
    if (workbenchRef.current) return observeStaticPreviewMedia(workbenchRef.current)
  }, [])
  const previewStageRef = useRef<HTMLDivElement>(null)
  const xhsLayoutRef = useRef<HTMLDivElement>(null)
  const xhsImageSelectionOverlayRef = useRef<HTMLDivElement>(null)
  const selectedXhsImageElementRef = useRef<HTMLImageElement | null>(null)
  const xhsImagePopoverRef = useRef<HTMLElement>(null)
  const xhsImageWidthOutputRef = useRef<HTMLOutputElement>(null)
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
  const xhsImageResizeSessionRef = useRef<XhsImageResizeSession | null>(null)
  const pendingXhsSliderWidthRef = useRef<number | null>(null)
  const xhsSliderCommitTimerRef = useRef<number | null>(null)
  const commitPendingXhsSliderWidthRef = useRef<() => void>(() => undefined)
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
    ...xhsTemplateVariables(xhsSettings.template, xhsSettings.paletteId, xhsSettings.fontMode),
    '--article-accent': activeXhsPalette.accent,
    '--article-font-family': activeXhsFont.bodyFamily,
    '--article-font-size': ARTICLE_FONT_SIZES[previewFormatting.fontSize],
    '--article-line-height': ARTICLE_LINE_HEIGHTS[previewFormatting.lineHeight],
    '--xhs-body-font-size': XHS_FONT_SIZES[previewFormatting.fontSize],
    '--xhs-body-line-height': XHS_LINE_HEIGHTS[previewFormatting.lineHeight],
  }), [activeXhsFont.bodyFamily, activeXhsPalette.accent, previewFormatting.fontSize, previewFormatting.lineHeight, xhsSettings.fontMode, xhsSettings.paletteId, xhsSettings.template])

  const xhsGeometryVariables = useMemo(() => ({
    ...xhsTemplateVariables(xhsSettings.template, getXhsDefaultPaletteId(xhsSettings.template), xhsSettings.fontMode),
    '--article-font-family': activeXhsFont.bodyFamily,
    '--article-font-size': ARTICLE_FONT_SIZES[previewFormatting.fontSize],
    '--article-line-height': ARTICLE_LINE_HEIGHTS[previewFormatting.lineHeight],
    '--xhs-body-font-size': XHS_FONT_SIZES[previewFormatting.fontSize],
    '--xhs-body-line-height': XHS_LINE_HEIGHTS[previewFormatting.lineHeight],
  }), [activeXhsFont.bodyFamily, previewFormatting.fontSize, previewFormatting.lineHeight, xhsSettings.fontMode, xhsSettings.template])

  const selectedXhsImage = preparedXhsLayout.images.find(image => image.key === selectedXhsImageKey) ?? null

  const renderedXhsImage = useCallback((key: string): HTMLImageElement | null => (
    Array.from(xhsLayoutRef.current?.querySelectorAll<HTMLImageElement>('img[data-xhs-image-key]') ?? [])
      .find(image => image.dataset.xhsImageKey === key) ?? null
  ), [])

  const positionXhsImageSelection = useCallback((key: string, image: HTMLImageElement, updateState = true) => {
    const layoutBounds = xhsLayoutRef.current?.getBoundingClientRect()
    if (!layoutBounds) return
    const imageBounds = image.getBoundingClientRect()
    const bounds = {
      key,
      left: imageBounds.left - layoutBounds.left,
      top: imageBounds.top - layoutBounds.top,
      width: imageBounds.width,
      height: imageBounds.height,
    }
    selectedXhsImageElementRef.current = image
    const overlay = xhsImageSelectionOverlayRef.current
    if (overlay) {
      overlay.style.left = `${bounds.left}px`
      overlay.style.top = `${bounds.top}px`
      overlay.style.width = `${bounds.width}px`
      overlay.style.height = `${bounds.height}px`
    }
    if (updateState) {
      setXhsImageSelectionBounds(current => current
        && current.key === bounds.key
        && current.left === bounds.left
        && current.top === bounds.top
        && current.width === bounds.width
        && current.height === bounds.height
        ? current
        : bounds)
    }
  }, [])

  const closeXhsImagePopover = useCallback(() => {
    commitPendingXhsSliderWidthRef.current()
    setSelectedXhsImageKey(null)
    setXhsImageSelectionBounds(null)
    setXhsImagePopover(null)
    selectedXhsImageElementRef.current = null
    xhsImageResizeSessionRef.current = null
    pendingXhsImageWidthRef.current = null
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

  const clampXhsImageWidth = (layout: XhsImageLayout, widthPercent: number) => {
    const minimum = layout === 'full' ? XHS_IMAGE_FULL_MIN_WIDTH : XHS_IMAGE_SPLIT_MIN_WIDTH
    const maximum = layout === 'full' ? 100 : XHS_IMAGE_SPLIT_MAX_WIDTH
    return Math.min(maximum, Math.max(minimum, widthPercent))
  }

  const previewXhsImageWidth = (key: string, layout: XhsImageLayout, widthPercent: number) => {
    const width = clampXhsImageWidth(layout, widthPercent)
    const image = renderedXhsImage(key) ?? selectedXhsImageElementRef.current
    if (!image) return
    if (layout === 'full') image.style.width = `${width}%`
    else image.closest<HTMLElement>('[data-xhs-media-layout]')?.style.setProperty('--xhs-image-column', `${width}%`)
    if (xhsImageWidthOutputRef.current) xhsImageWidthOutputRef.current.textContent = `${Math.round(width)}%`
    positionXhsImageSelection(key, image, false)
  }

  const commitPendingXhsSliderWidth = () => {
    if (xhsSliderCommitTimerRef.current !== null) window.clearTimeout(xhsSliderCommitTimerRef.current)
    xhsSliderCommitTimerRef.current = null
    const width = pendingXhsSliderWidthRef.current
    pendingXhsSliderWidthRef.current = null
    if (width === null || !selectedXhsImage) return
    updateXhsImageOverride(selectedXhsImage.key, selectedXhsImage.layout, width)
  }
  commitPendingXhsSliderWidthRef.current = commitPendingXhsSliderWidth

  const resetXhsImageOverride = (key: string) => {
    pendingXhsSliderWidthRef.current = null
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
      const copyHtml = await expandLocalVideoReferences(
        expandLocalImageReferences(applyWechatTheme(html, previewWechatSettings, previewFormatting)),
      )
      const copyDocument = parseHtml(copyHtml)
      applyPlatformCompatibilityToDocument(copyDocument, 'wechat', { replaceVideos: false })
      prepareCopiedVideos(copyDocument)
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

  const copyXContent = async () => {
    setXCopyState('copying')
    try {
      const copyDocument = parseHtml(expandLocalImageReferences(html))
      applyPlatformCompatibilityToDocument(copyDocument, 'x')
      await copyRichHtml(copyDocument.body.innerHTML)
      setXCopyState('success')
    } catch {
      setXCopyState('error')
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
    if (toolRailOpen[platform]) window.requestAnimationFrame(() => workbenchRef.current?.querySelector<HTMLButtonElement>('.preview-settings-toggle')?.focus())
  }

  const toggleFormattingSection = (platform: PreviewPlatform, section: FormattingSection) => {
    setOpenFormattingSections(current => {
      const platformSections = current[platform]
      return {
        ...current,
        [platform]: platformSections.includes(section)
          ? platformSections.filter(value => value !== section)
          : [...platformSections, section],
      }
    })
  }

  const resizeToolRail = (clientX: number) => {
    const stage = previewStageRef.current
    if (!stage) return
    const rawWidth = stage.getBoundingClientRect().right - clientX
    if (toolRailResizeRef.current) toolRailResizeRef.current.rawWidth = rawWidth
    setToolRailWidth(Math.min(toolRailLayout?.max ?? TOOL_RAIL_MAX_WIDTH, Math.max(TOOL_RAIL_MIN_WIDTH, rawWidth)))
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
    const persistedWidth = Math.min(toolRailLayout?.max ?? TOOL_RAIL_MAX_WIDTH, Math.max(TOOL_RAIL_MIN_WIDTH, resizeState.rawWidth))
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
    let next = toolRailLayout?.value ?? toolRailWidth
    if (event.key === 'ArrowLeft') next += 16
    else if (event.key === 'ArrowRight') next -= 16
    else if (event.key === 'End') next = toolRailLayout?.max ?? TOOL_RAIL_MAX_WIDTH
    else return
    event.preventDefault()
    next = Math.min(toolRailLayout?.max ?? TOOL_RAIL_MAX_WIDTH, Math.max(TOOL_RAIL_MIN_WIDTH, next))
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
    const stage = previewStageRef.current
    const rail = stage?.querySelector<HTMLElement>('.preview-tool-rail')
    if (!stage || !rail || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const width = stage.getBoundingClientRect().width
      const separator = stage.querySelector<HTMLElement>('.preview-tool-resizer')
      if (!width || !separator?.getBoundingClientRect().width) {
        setToolRailLayout(null)
        return
      }
      // Reserve the readable preview and its 10px divider, matching the CSS grid.
      const max = Math.max(TOOL_RAIL_MIN_WIDTH, Math.min(TOOL_RAIL_MAX_WIDTH, Math.floor(width - 450)))
      const value = Math.round(rail.getBoundingClientRect().width)
      setToolRailLayout(current => current?.max === max && current.value === value ? current : { max, value })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    observer.observe(rail)
    measure()
    return () => observer.disconnect()
  }, [activePlatform, toolRailOpen])

  useEffect(() => {
    if (!shouldDeferEstimatedPagination) return
    const controller = new AbortController()
    const cancelScheduledWork = scheduleIdleWork(() => {
      void paginateForXhsCardsAsync(preparedXhsLayout.html, xhsPaginationOptions, undefined, controller.signal)
        .then(pages => {
          if (!controller.signal.aborted) setEstimatedPagination({ key: paginationKey, pages })
        }).catch(error => {
          if (!controller.signal.aborted) setExportError(`分页失败：${(error as Error).message}`)
        })
    })
    return () => { controller.abort(); cancelScheduledWork() }
  }, [paginationKey, preparedXhsLayout.html, shouldDeferEstimatedPagination, xhsPaginationOptions])

  useEffect(() => {
    if (activePlatform !== 'xhs' || paginationPending) return
    const controller = new AbortController()
    let cancelScheduledWork: (() => void) | null = null
    const measure = async () => {
      if (controller.signal.aborted) return
      const measurer = createXhsCardPageMeasurer({
        title,
        template: xhsSettings.template,
        showFooter: xhsSettings.showFooter,
        footerText: xhsSettings.footerText,
        variables: xhsGeometryVariables,
      })
      if (!measurer) {
        setMeasuredPagination({ key: paginationKey, pages: estimatedCardPages })
        return
      }
      try {
        const pages = await paginateForXhsCardsAsync(preparedXhsLayout.html, xhsPaginationOptions, measurer.fits, controller.signal)
        if (!controller.signal.aborted) setMeasuredPagination({ key: paginationKey, pages })
      } catch (error) {
        if (!controller.signal.aborted) setExportError(`分页失败：${(error as Error).message}`)
      } finally { measurer.dispose() }
    }
    void waitForXhsPaginationAssets(preparedXhsLayout.html, controller.signal).then(() => {
      if (!controller.signal.aborted) cancelScheduledWork = scheduleIdleWork(() => { void measure() }, 500)
    })
    return () => { controller.abort(); cancelScheduledWork?.() }
  }, [activePlatform, estimatedCardPages, paginationPending, paginationKey, preparedXhsLayout.html,
    title, xhsGeometryVariables, xhsPaginationOptions, xhsSettings.footerText, xhsSettings.showFooter, xhsSettings.template])

  useEffect(() => {
    setActiveCard(current => Math.max(0, Math.min(current, cardPages.length - 1)))
    exportCardRefs.current.length = exportSnapshot?.pages.length ?? cardPages.length
  }, [cardPages.length, exportSnapshot?.pages.length])

  useLayoutEffect(() => {
    cancelEditorDrivenPreviewLocate()
    clearSelectedTarget()
  }, [html, activePlatform, previewDevice, clearSelectedTarget])

  useEffect(() => {
    setSelectedXhsImageKey(null)
    setXhsImageSelectionBounds(null)
    setXhsImagePopover(null)
    selectedXhsImageElementRef.current = null
    xhsImageResizeSessionRef.current = null
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

  useLayoutEffect(() => {
    if (activePlatform !== 'xhs' || !selectedXhsImageKey) {
      setXhsImageSelectionBounds(null)
      selectedXhsImageElementRef.current = null
      return
    }
    const sync = (updateState = true) => {
      const image = renderedXhsImage(selectedXhsImageKey)
      if (image) positionXhsImageSelection(selectedXhsImageKey, image, updateState)
    }
    sync()
    const frame = window.requestAnimationFrame(() => sync())
    const handleResize = () => sync(xhsImageResizeSessionRef.current === null)
    const viewport = viewportRef.current
    window.addEventListener('resize', handleResize)
    viewport?.addEventListener('scroll', handleResize, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize)
    if (observer) {
      const image = renderedXhsImage(selectedXhsImageKey)
      if (image) observer.observe(image)
      if (xhsLayoutRef.current) observer.observe(xhsLayoutRef.current)
    }
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleResize)
      viewport?.removeEventListener('scroll', handleResize)
      observer?.disconnect()
    }
  }, [activeCard, activePlatform, cardPages, positionXhsImageSelection, renderedXhsImage, selectedXhsImageKey, toolRailWidth, xhsPreviewMode])

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
    const move = (event: PointerEvent) => {
      const session = xhsImageResizeSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      const delta = ((event.clientX - session.startX) / session.contentWidth)
        * 100
        * session.direction
      pendingXhsImageWidthRef.current = clampXhsImageWidth(session.layout, session.startWidth + delta)
      session.currentWidth = pendingXhsImageWidthRef.current
      if (xhsResizeFrameRef.current !== null) return
      xhsResizeFrameRef.current = window.requestAnimationFrame(() => {
        xhsResizeFrameRef.current = null
        if (pendingXhsImageWidthRef.current !== null) {
          previewXhsImageWidth(session.key, session.layout, pendingXhsImageWidthRef.current)
        }
      })
    }
    const finish = (event: PointerEvent) => {
      const session = xhsImageResizeSessionRef.current
      if (!session || event.pointerId !== session.pointerId) return
      if (xhsResizeFrameRef.current !== null) window.cancelAnimationFrame(xhsResizeFrameRef.current)
      xhsResizeFrameRef.current = null
      const width = pendingXhsImageWidthRef.current ?? session.currentWidth
      previewXhsImageWidth(session.key, session.layout, width)
      updateXhsImageOverride(session.key, session.layout, width)
      pendingXhsImageWidthRef.current = null
      xhsImageResizeSessionRef.current = null
      document.body.classList.remove('is-resizing-xhs-image')
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('is-resizing-xhs-image')
    }
  }, [positionXhsImageSelection, renderedXhsImage])

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
    if (xhsResizeFrameRef.current !== null) window.cancelAnimationFrame(xhsResizeFrameRef.current)
    if (xhsSliderCommitTimerRef.current !== null) window.clearTimeout(xhsSliderCommitTimerRef.current)
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
    positionXhsImageSelection(key, image)
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
    pendingXhsSliderWidthRef.current = null
    const renderedImage = renderedXhsImage(image.key) ?? selectedXhsImageElementRef.current
    const sizingContainer = image.layout === 'full'
      ? renderedImage?.closest<HTMLElement>('.xhs-card-content')
      : renderedImage?.closest<HTMLElement>('[data-xhs-media-layout]')
    xhsImageResizeSessionRef.current = {
      pointerId: event.pointerId,
      key: image.key,
      startX: event.clientX,
      startWidth: image.widthPercent,
      direction: handle.dataset.xhsResizeHandle?.includes('w') ? -1 : 1,
      layout: image.layout,
      contentWidth: Math.max(1, sizingContainer?.getBoundingClientRect().width ?? event.currentTarget.getBoundingClientRect().width),
      currentWidth: image.widthPercent,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.body.classList.add('is-resizing-xhs-image')
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
      paletteId: getXhsDefaultPaletteId(template),
    })
  }

  const applyXhsPalette = (paletteId: string) => {
    updateXhsSettings({ ...xhsSettings, paletteId })
  }

  const applyXhsFontMode = (fontMode: XhsTemplateFontMode) => {
    updateXhsSettings({ ...xhsSettings, fontMode })
  }

  const changeSelectedXhsImageLayout = (layout: XhsImageLayout) => {
    if (!selectedXhsImage) return
    commitPendingXhsSliderWidth()
    const widthPercent = layout === selectedXhsImage.layout
      ? selectedXhsImage.widthPercent
      : layout === 'full' ? 100 : 45
    updateXhsImageOverride(selectedXhsImage.key, layout, widthPercent)
  }

  const previewSelectedXhsImageWidth = (widthPercent: number) => {
    if (!selectedXhsImage) return
    const width = clampXhsImageWidth(selectedXhsImage.layout, widthPercent)
    pendingXhsSliderWidthRef.current = width
    previewXhsImageWidth(selectedXhsImage.key, selectedXhsImage.layout, width)
  }

  const scheduleSelectedXhsImageWidthCommit = () => {
    if (xhsSliderCommitTimerRef.current !== null) window.clearTimeout(xhsSliderCommitTimerRef.current)
    xhsSliderCommitTimerRef.current = window.setTimeout(() => {
      xhsSliderCommitTimerRef.current = null
      commitPendingXhsSliderWidth()
    }, 140)
  }

  const prepareExportSheet = async () => {
    if (isUpdating || paginationSettling) throw new Error('正文和分页仍在更新，请稍后再导出。')
    setExportSnapshot({ pages: cardPages, title, settings: xhsSettings, variables: xhsMeasurementVariables })
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
  }

  const releaseExportSheet = () => {
    exportCardRefs.current = []
    setExportSnapshot(null)
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
      const { default: JSZip } = await import('jszip')
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
    const cardSettings = options.exportRef && exportSnapshot ? exportSnapshot.settings : xhsSettings
    const cardTitle = options.exportRef && exportSnapshot ? exportSnapshot.title : title
    const cardCount = options.exportRef && exportSnapshot ? exportSnapshot.pages.length : cardPages.length
    const cardVariables = options.exportRef && exportSnapshot ? exportSnapshot.variables : xhsMeasurementVariables
    const card = <section
      key={options.exportRef ? index : undefined}
      className={`xhs-card-page template-${cardSettings.template}${index === 0 ? ' is-cover' : ''}`}
      data-xhs-palette={cardSettings.paletteId}
      data-xhs-font={cardSettings.fontMode}
      style={cardVariables as CSSProperties}
      aria-label={options.interactive ? `第 ${index + 1} 张，共 ${cardCount} 张` : undefined}
      data-xhs-page={options.interactive ? index : undefined}
      ref={options.exportRef ? element => { exportCardRefs.current[index] = element } : undefined}
    >
      {cardSettings.showPageNumber && <span className="xhs-card-index">{String(index + 1).padStart(2, '0')}</span>}
      {index === 0 && <h1
        data-edit-target={options.interactive ? 'title' : undefined}
        role={options.interactive ? 'button' : undefined}
        tabIndex={options.interactive ? 0 : undefined}
        onClick={options.interactive ? () => selectTarget({ kind: 'title' }) : undefined}
        onKeyDown={options.interactive ? event => selectStandaloneTargetWithKeyboard(event, 'title') : undefined}
      >{cardTitle || '未命名文章'}</h1>}
      <div
        className="xhs-card-content"
        onClick={options.interactive ? handleBodyClick : undefined}
        onKeyDown={options.interactive ? handleBodyKeyDown : undefined}
        dangerouslySetInnerHTML={{ __html: options.exportRef ? restorePreviewGifSources(pageHtml) : pageHtml }}
      />
      {cardSettings.showFooter && <footer><span>{cardSettings.footerText || ' '}</span><span>{index + 1} / {cardCount}</span></footer>}
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
          <button type="button" onClick={() => void openCardPreview(index)} disabled={previewingCard !== null || exporting !== null || paginationSettling || isUpdating} aria-label={`放大查看第 ${index + 1} 张卡片`}>
            {previewingCard === index ? <LoaderCircle className="spin" size={14} /> : <Maximize2 size={14} />}
            <span>放大查看</span>
          </button>
          <button type="button" onClick={() => void downloadCard(index)} disabled={exporting !== null || previewingCard !== null || paginationSettling || isUpdating} aria-label={`下载第 ${index + 1} 张卡片`}>
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
      className={`preview-workbench platform-${activePlatform} theme-${previewFormatting.theme}`}
      aria-label="平台内容预览"
      style={previewVariables}
    >
      <header className="preview-contextbar">
        <span className={`preview-sync-status ${isUpdating || paginationSettling ? 'updating' : ''}`} aria-live="polite"><i />{isUpdating ? '正在同步最新编辑…' : activePlatform === 'wechat' ? '正文实时映射' : activePlatform === 'xhs' ? paginationSettling ? '正在生成卡片预览…' : `${cardPages.length} 张卡片 · 自动分页` : `Premium Article · ${characterCount} 字`}</span>
        <div className="preview-context-actions">
          {onSyncScrollChange && <button type="button" className="preview-tool-toggle" role="switch" aria-checked={syncScroll} aria-label="同步滚动" title="开启后左侧滚动和光标移动会定位预览；点击预览始终可定位原文" onClick={() => onSyncScrollChange(!syncScroll)}>同步滚动 · {syncScroll ? '开' : '关'}</button>}
          {activePlatform === 'wechat' && (
            <button
              type="button"
              className={`preview-tool-toggle wechat-copy-button ${wechatCopyState}`}
              disabled={wechatCopyState === 'copying' || isUpdating}
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
          {activePlatform === 'x' && <button type="button" className="preview-tool-toggle primary-output" disabled={xCopyState === 'copying' || isUpdating} onClick={() => void copyXContent()} aria-label="复制 X 长文格式"><Copy size={14} />{xCopyState === 'copying' ? '复制中' : xCopyState === 'success' ? '已复制' : xCopyState === 'error' ? '重试复制' : '复制长文格式'}</button>}
          {activePlatform === 'xhs' && <button type="button" className="preview-tool-toggle primary-output" onClick={() => void downloadAllCards()} disabled={exporting !== null || previewingCard !== null || paginationSettling || isUpdating}>{exporting === 'all' ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}<span>下载全部图片</span></button>}
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
            <span>排版</span>
          </button>
          <div className="device-preview-switcher" role="group" aria-label="切换预览设备">
            <button type="button" className={previewDevice === 'desktop' ? 'active' : ''} aria-pressed={previewDevice === 'desktop'} onClick={() => onPreviewDeviceChange('desktop')}><Monitor size={14} />电脑预览</button>
            <button ref={mobilePreviewButtonRef} type="button" className={previewDevice === 'mobile' ? 'active' : ''} aria-pressed={previewDevice === 'mobile'} onClick={() => onPreviewDeviceChange('mobile')}><Smartphone size={14} />手机预览</button>
          </div>
        </div>
      </header>

      {activeToolRailOpen && <fieldset className="source-style-policy">
        <legend>原文样式</legend>
        <label><input type="radio" name="source-style-policy" checked={formatting.sourceStyle !== 'theme'} onChange={() => onFormattingChange?.({ ...formatting, sourceStyle: 'preserve' })} />保留原文样式</label>
        <label><input type="radio" name="source-style-policy" checked={formatting.sourceStyle === 'theme'} onChange={() => onFormattingChange?.({ ...formatting, sourceStyle: 'theme' })} />统一应用主题</label>
        <small>{formatting.sourceStyle === 'theme' ? '统一文字与边框等装饰；公众号使用所选主题配色。图片本身不变，原稿可随时恢复。' : '保留原文明确指定的字体、颜色与边框，其余应用排版设置。切换同时影响预览和导出。'}</small>
      </fieldset>}

      {mediaNotice && <div className="output-readiness" role="status" aria-label="输出前提醒">{mediaNotice}</div>}
      {activePlatform === 'xhs' && exportError && <div className="xhs-export-error" role="alert">{exportError}</div>}

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
                  aria-valuemax={toolRailLayout?.max ?? TOOL_RAIL_MAX_WIDTH}
                  aria-valuenow={toolRailLayout?.value ?? toolRailWidth}
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
                  <button type="button" className="settings-close" aria-label="关闭公众号设置" onClick={() => toggleToolRail('wechat')}><CloseIcon size={18} /></button>
                </header>
                <FormattingAccordion
                  idPrefix="wechat-settings"
                  label="公众号设置模块"
                  openSections={openFormattingSections.wechat}
                  onSectionToggle={section => toggleFormattingSection('wechat', section)}
                  formatting={formatting}
                  onFormattingChange={onFormattingChange}
                  layoutContent={(
                    <section className="wechat-theme-layout" aria-label="公众号主题排版">
                      <div className="template-library-summary wechat-template-library-summary">
                        <span className="template-library-index">W</span>
                        <span><strong>图形主题库</strong><small>色彩 · 标题 · 引用 · 节奏</small></span>
                      </div>
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
                        {visibleWechatThemes.map((theme, themeIndex) => (
                          <article
                            className={`wechat-theme-card${wechatSettings.themeId === theme.id ? ' selected' : ''}`}
                            key={theme.id}
                            style={{
                              '--theme-primary': theme.primary,
                              '--theme-surface': theme.surface,
                            } as CSSProperties}
                          >
                            <button
                              type="button"
                              className="wechat-theme-select-target"
                              aria-label={`应用${theme.name}主题：${theme.description}`}
                              aria-pressed={wechatSettings.themeId === theme.id}
                              onClick={() => selectWechatTheme(theme.id)}
                            />
                            <WechatThemeGraphic motif={theme.mock} index={themeIndex} />
                            <footer className="wechat-theme-card-copy">
                              <span className="wechat-theme-card-heading">
                                <span><strong>{theme.name}</strong><small>{theme.tag}</small></span>
                                <b>{getWechatThemeCategory(theme.id)}</b>
                              </span>
                              <span className="wechat-theme-card-status" aria-hidden="true">{wechatSettings.themeId === theme.id ? '✓ 已选' : '应用'}</span>
                            </footer>
                          </article>
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
                    {cardPages.map((page, index) => <XhsOverviewPage key={index} index={index} active={index === activeCard}>
                      {renderXhsCardWithActions(page, index, 'overview')}
                    </XhsOverviewPage>)}
                  </div>
                )}
              </div>

              {selectedXhsImage && xhsImageSelectionBounds?.key === selectedXhsImage.key && (
                <div
                  ref={xhsImageSelectionOverlayRef}
                  className="xhs-image-selection-overlay"
                  data-xhs-image-key={selectedXhsImage.key}
                  aria-label={`已选中图片：${selectedXhsImage.alt}`}
                  style={{
                    left: xhsImageSelectionBounds.left,
                    top: xhsImageSelectionBounds.top,
                    width: xhsImageSelectionBounds.width,
                    height: xhsImageSelectionBounds.height,
                  }}
                  onPointerDown={startXhsImageResize}
                >
                  {(['nw', 'ne', 'sw', 'se'] as const).map(handle => (
                    <button
                      type="button"
                      className={`xhs-image-resize-handle ${handle}`}
                      data-xhs-resize-handle={handle}
                      data-xhs-image-key={selectedXhsImage.key}
                      aria-label={`从${handle.includes('n') ? '上' : '下'}${handle.includes('w') ? '左' : '右'}角调整图片大小`}
                      key={handle}
                    />
                  ))}
                </div>
              )}

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
                      <span><strong>图片宽度</strong><output ref={xhsImageWidthOutputRef}>{Math.round(selectedXhsImage.widthPercent)}%</output></span>
                      <input
                        key={`${selectedXhsImage.key}-${selectedXhsImage.layout}-${selectedXhsImage.widthPercent}`}
                        type="range"
                        min={selectedXhsImage.layout === 'full' ? XHS_IMAGE_FULL_MIN_WIDTH : XHS_IMAGE_SPLIT_MIN_WIDTH}
                        max={selectedXhsImage.layout === 'full' ? 100 : XHS_IMAGE_SPLIT_MAX_WIDTH}
                        defaultValue={selectedXhsImage.widthPercent}
                        aria-label="调整选中图片宽度"
                        onInput={event => previewSelectedXhsImageWidth(Number(event.currentTarget.value))}
                        onPointerUp={commitPendingXhsSliderWidth}
                        onPointerCancel={commitPendingXhsSliderWidth}
                        onBlur={commitPendingXhsSliderWidth}
                        onKeyUp={scheduleSelectedXhsImageWidthCommit}
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
                  aria-valuemax={toolRailLayout?.max ?? TOOL_RAIL_MAX_WIDTH}
                  aria-valuenow={toolRailLayout?.value ?? toolRailWidth}
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
                  <button type="button" className="settings-close" aria-label="关闭小红书设置" onClick={() => toggleToolRail('xhs')}><CloseIcon size={18} /></button>
                </header>
                <FormattingAccordion
                  idPrefix="xhs-settings"
                  label="小红书设置模块"
                  openSections={openFormattingSections.xhs}
                  onSectionToggle={section => toggleFormattingSection('xhs', section)}
                  formatting={formatting}
                  onFormattingChange={onFormattingChange}
                  fontContent={<XhsFontControls formatting={formatting} settings={xhsSettings} onFormattingChange={onFormattingChange} onFontModeChange={applyXhsFontMode} />}
                  colorControls={<XhsPaletteControls template={xhsSettings.template} paletteId={xhsSettings.paletteId} onChange={applyXhsPalette} />}
                  layoutContent={(
                    <section className="xhs-template-tools" aria-label="小红书视觉模板">
                      <div className="template-library-summary xhs-template-library-summary">
                        <span className="template-library-index">R</span>
                        <span><strong>长文页型图谱</strong><small>封面 · 正文 · 图片</small></span>
                        <b>{XHS_TEMPLATE_OPTIONS.length} 套</b>
                      </div>
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
                                  className="xhs-template-select-target"
                                  onClick={() => applyXhsTemplate(option.value)}
                                />
                                <XhsTemplateGraphic
                                  template={option.value}
                                  paletteId={xhsSettings.template === option.value ? xhsSettings.paletteId : getXhsDefaultPaletteId(option.value)}
                                />
                              </div>
                              <footer className="xhs-template-card-meta">
                                <span className="xhs-template-use-case"><b>适合</b>{option.useCase}</span>
                                <span className="xhs-template-card-status" aria-hidden="true">{xhsSettings.template === option.value ? '✓ 已选' : '应用'}</span>
                              </footer>
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
                  aria-valuemax={toolRailLayout?.max ?? TOOL_RAIL_MAX_WIDTH}
                  aria-valuenow={toolRailLayout?.value ?? toolRailWidth}
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
                  <button type="button" className="settings-close" aria-label="关闭 X 设置" onClick={() => toggleToolRail('x')}><CloseIcon size={18} /></button>
                </header>
                <FormattingAccordion
                  idPrefix="x-settings"
                  label="X 长文设置模块"
                  openSections={openFormattingSections.x}
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
          {exportSnapshot.pages.map((page, index) => <div className="xhs-export-page" key={index}>{renderXhsCard(page, index, { exportRef: true })}</div>)}
        </div>
      )}
    </section>
  )
}
