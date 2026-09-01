import {
  buildStyles,
  categoryOrder,
  COLOR_SLOTS,
  themeCategories,
  themes,
  type MdWechatColorSlot,
  type MdWechatTheme,
} from '../vendor/md-wechat/themes.js'
import {
  ARTICLE_ACCENT_COLORS,
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_SIZES,
  ARTICLE_LINE_HEIGHTS,
  type ArticleFormatting,
} from '../domain/formatting'

export const WECHAT_THEME_IDS = [
  'literary',
  'swiss-index',
  'night-film',
  'white-cube',
  'pixel-quest',
  'velocity-report',
  'mobai',
  'klein',
  'xuanzhi',
  'morandi-green',
  'midnight-gold',
  'cream-orange',
  'mint-soda',
  'brick-industry',
  'mori-journal',
  'fleet-street',
  'blueprint',
  'peach-soda',
  'mono-editorial',
  'lemon-sea',
  'wisteria',
  'hk-neon',
  'nordic',
  'latte',
  'cyan-scape',
  'candy-pop',
] as const

export type WechatThemeId = typeof WECHAT_THEME_IDS[number]
export type WechatThemeFont = 'theme' | 'sans' | 'serif' | 'rounded'
export type WechatThemeCategory = '全部' | '简约' | '书卷' | '杂志' | '商务' | '科技' | '活力'

export interface WechatThemeSettings {
  themeId: WechatThemeId
  accentByTheme: Partial<Record<WechatThemeId, string>>
  slotColorsByTheme: Partial<Record<WechatThemeId, Record<string, string>>>
  fontFamily: WechatThemeFont
  fontSize: number
}

export const DEFAULT_WECHAT_THEME_SETTINGS: WechatThemeSettings = {
  themeId: 'literary',
  accentByTheme: {},
  slotColorsByTheme: {},
  fontFamily: 'theme',
  fontSize: 16,
}

const THEME_ID_SET = new Set<string>(WECHAT_THEME_IDS)
const FONT_SET = new Set<WechatThemeFont>(['theme', 'sans', 'serif', 'rounded'])
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const DEFAULT_PRE_STYLE = 'box-sizing:border-box;max-width:100%;margin:1.4em 8px;padding:0;border:1px solid #e1e5e9;border-radius:6px;background-color:#f5f7f9;overflow:hidden;white-space:normal;'
const DEFAULT_PRE_BODY_STYLE = 'display:block;box-sizing:border-box;max-width:100%;margin:0;padding:0.9em 1em;background-color:transparent;overflow-x:hidden;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;'
const DEFAULT_PRE_CODE_STYLE = "font-family:Menlo,Consolas,'Courier New',monospace;font-size:0.84em;line-height:1.65;color:#26313a;border:0;border-radius:0;"

export const WECHAT_THEMES = themes.filter(
  (theme): theme is MdWechatTheme & { id: WechatThemeId } => THEME_ID_SET.has(theme.id),
)

export const WECHAT_THEME_CATEGORIES = [
  ...categoryOrder.filter(
    (category): category is Exclude<WechatThemeCategory, '全部'> => category !== '收藏' && category !== '全部',
  ),
  '全部',
] satisfies WechatThemeCategory[]

export function getWechatTheme(themeId: string): MdWechatTheme & { id: WechatThemeId } {
  return WECHAT_THEMES.find(theme => theme.id === themeId) ?? WECHAT_THEMES[0]
}

export function getWechatThemeCategory(themeId: WechatThemeId): WechatThemeCategory {
  const category = themeCategories[themeId]
  return WECHAT_THEME_CATEGORIES.includes(category as WechatThemeCategory)
    ? category as WechatThemeCategory
    : '全部'
}

export function getWechatThemeColorSlots(themeId: WechatThemeId): MdWechatColorSlot[] {
  return COLOR_SLOTS[themeId] ?? []
}

export function normalizeWechatThemeSettings(value?: Partial<WechatThemeSettings> | null): WechatThemeSettings {
  const themeId = value?.themeId && THEME_ID_SET.has(value.themeId)
    ? value.themeId as WechatThemeId
    : DEFAULT_WECHAT_THEME_SETTINGS.themeId
  const fontFamily = value?.fontFamily && FONT_SET.has(value.fontFamily)
    ? value.fontFamily
    : DEFAULT_WECHAT_THEME_SETTINGS.fontFamily
  const fontSize = Math.min(18, Math.max(14, Math.round(Number(value?.fontSize) || 16)))
  const accentByTheme = Object.fromEntries(
    Object.entries(value?.accentByTheme ?? {}).filter(
      ([id, color]) => THEME_ID_SET.has(id) && typeof color === 'string' && HEX_COLOR.test(color),
    ).map(([id, color]) => [id, color!.toLowerCase()]),
  ) as Partial<Record<WechatThemeId, string>>
  const slotColorsByTheme = Object.fromEntries(
    Object.entries(value?.slotColorsByTheme ?? {}).filter(([id]) => THEME_ID_SET.has(id)).map(([id, colors]) => {
      const allowedSlots = new Set(getWechatThemeColorSlots(id as WechatThemeId).map(slot => slot.key))
      const normalized = Object.fromEntries(
        Object.entries(colors ?? {}).filter(
          ([key, color]) => allowedSlots.has(key) && typeof color === 'string' && HEX_COLOR.test(color),
        ).map(([key, color]) => [key, color.toLowerCase()]),
      )
      return [id, normalized]
    }),
  ) as Partial<Record<WechatThemeId, Record<string, string>>>

  return { themeId, accentByTheme, slotColorsByTheme, fontFamily, fontSize }
}

function applyStyle(element: HTMLElement, cssText?: string): void {
  if (!cssText) return
  element.style.cssText = cssText
}

interface RgbaColor {
  red: number
  green: number
  blue: number
  alpha: number
}

function parseCssColor(value: string): RgbaColor | null {
  const color = value.trim().toLowerCase()
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const expanded = hex[1].length === 3 ? Array.from(hex[1], digit => digit + digit).join('') : hex[1]
    const numeric = Number.parseInt(expanded, 16)
    return { red: numeric >> 16, green: (numeric >> 8) & 255, blue: numeric & 255, alpha: 1 }
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/)
  if (!rgb) return null
  return {
    red: Math.min(255, Number(rgb[1])),
    green: Math.min(255, Number(rgb[2])),
    blue: Math.min(255, Number(rgb[3])),
    alpha: rgb[4] === undefined ? 1 : Math.min(1, Number(rgb[4])),
  }
}

function blendColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
  if (alpha === 0) return { red: 255, green: 255, blue: 255, alpha: 1 }
  return {
    red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
    green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
    blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
    alpha,
  }
}

function effectiveAncestorColor(element: HTMLElement, property: 'color' | 'backgroundColor'): RgbaColor | null {
  let current: HTMLElement | null = element
  while (current) {
    const parsed = parseCssColor(current.style[property])
    if (parsed && parsed.alpha > 0) return parsed
    current = current.parentElement
  }
  return property === 'backgroundColor' ? { red: 255, green: 255, blue: 255, alpha: 1 } : null
}

function relativeLuminance(color: RgbaColor): number {
  const channels = [color.red, color.green, color.blue].map(channel => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrastRatio(first: RgbaColor, second: RgbaColor): number {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second))
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (light + 0.05) / (dark + 0.05)
}

function ensureReadableHighlight(element: HTMLElement): void {
  const ancestorBackground = effectiveAncestorColor(element.parentElement ?? element, 'backgroundColor')
    ?? { red: 255, green: 255, blue: 255, alpha: 1 }
  const rawBackground = parseCssColor(element.style.backgroundColor) ?? ancestorBackground
  const background = rawBackground.alpha < 1 ? blendColor(rawBackground, ancestorBackground) : rawBackground
  const foreground = effectiveAncestorColor(element, 'color')
  if (foreground && contrastRatio(foreground, background) >= 4.5) return

  const darkInk = { red: 17, green: 24, blue: 32, alpha: 1 }
  const lightInk = { red: 255, green: 252, blue: 244, alpha: 1 }
  element.style.color = contrastRatio(darkInk, background) >= contrastRatio(lightInk, background)
    ? '#111820'
    : '#fffcf4'
}

function applyHeadingDecoration(
  element: HTMLElement,
  level: number,
  styles: Record<string, string>,
  index: number,
): HTMLElement | null {
  const open = styles[`h${level}WrapOpen`] ?? ''
  const close = styles[`h${level}WrapClose`] ?? ''
  let contentWrapper: HTMLElement | null = null
  if (open || close) {
    element.innerHTML = `${open}<!--ez-heading-content-start-->${element.innerHTML}<!--ez-heading-content-end-->${close}`
    const walker = element.ownerDocument.createTreeWalker(element, 128)
    let startMarker: Comment | null = null
    let endMarker: Comment | null = null
    let node = walker.nextNode()
    while (node) {
      if (node instanceof Comment && node.data === 'ez-heading-content-start') startMarker = node
      if (node instanceof Comment && node.data === 'ez-heading-content-end') endMarker = node
      node = walker.nextNode()
    }
    if (startMarker?.parentElement && startMarker.parentElement === endMarker?.parentElement && startMarker.parentElement !== element) {
      contentWrapper = startMarker.parentElement
    }
    startMarker?.remove()
    endMarker?.remove()
  }
  if (level === 2 && styles.h2Index) {
    const marker = element.ownerDocument.createElement('span')
    marker.setAttribute('aria-hidden', 'true')
    marker.style.cssText = styles.h2Index
    marker.textContent = String(index + 1).padStart(2, '0')
    element.prepend(marker)
  }
  return contentWrapper
}

function hasVisibleBackground(element: HTMLElement): boolean {
  const backgroundColor = element.style.backgroundColor.replace(/\s/g, '').toLowerCase()
  const hasBackgroundColor = Boolean(backgroundColor)
    && backgroundColor !== 'transparent'
    && backgroundColor !== 'rgba(0,0,0,0)'
  const hasBackgroundImage = Boolean(element.style.backgroundImage && element.style.backgroundImage !== 'none')
  return hasBackgroundColor || hasBackgroundImage
}

function hasCompleteBorder(element: HTMLElement): boolean {
  return ['Top', 'Right', 'Bottom', 'Left'].every(side => {
    const style = element.style[`border${side}Style` as keyof CSSStyleDeclaration]
    return typeof style === 'string' && style !== '' && style !== 'none'
  })
}

function isBoxedHeadingDecoration(element: HTMLElement): boolean {
  const verticalPadding = Number.parseFloat(element.style.paddingTop || '0')
    + Number.parseFloat(element.style.paddingBottom || '0')
  return verticalPadding > 0 && (hasVisibleBackground(element) || hasCompleteBorder(element))
}

function applyHeadingLayoutSafety(element: HTMLElement, level: number, contentWrapper: HTMLElement | null): void {
  element.style.boxSizing = 'border-box'
  element.style.maxWidth = '100%'
  element.style.minWidth = '0'
  element.style.overflowWrap = 'anywhere'

  const boxedContent = level === 2 && contentWrapper && isBoxedHeadingDecoration(contentWrapper)
    ? contentWrapper
    : null
  if (boxedContent) {
    boxedContent.style.display = 'block'
    boxedContent.style.boxSizing = 'border-box'
    boxedContent.style.width = '100%'
    boxedContent.style.maxWidth = '100%'
    boxedContent.style.overflowWrap = 'anywhere'
  }

  element.querySelectorAll<HTMLElement>('span').forEach(span => {
    if (span === boxedContent || !hasVisibleBackground(span)) return
    span.style.maxWidth = '100%'
    span.style.overflowWrap = 'anywhere'
    span.style.boxDecorationBreak = 'clone'
    span.style.setProperty('-webkit-box-decoration-break', 'clone')
  })
}

function preserveHeadingForeground(element: HTMLElement): void {
  element.querySelectorAll<HTMLElement>('strong, b, em, i, s, del, a').forEach(inline => {
    inline.style.color = 'inherit'
    if (inline.matches('a')) {
      inline.style.borderBottomColor = 'currentcolor'
      inline.style.textDecorationColor = 'currentcolor'
    }
  })
}

function renderThemeSeparator(element: HTMLElement, html: string | undefined): void {
  if (!html) {
    element.dataset.wechatSeparator = 'true'
    return
  }

  const template = element.ownerDocument.createElement('template')
  template.innerHTML = html.trim()
  const replacement = template.content.firstElementChild as HTMLElement | null
  if (!replacement) {
    element.dataset.wechatSeparator = 'true'
    return
  }

  Array.from(element.attributes).forEach(attribute => {
    if (attribute.name !== 'style') replacement.setAttribute(attribute.name, attribute.value)
  })
  replacement.dataset.wechatSeparator = 'true'
  element.replaceWith(replacement)
}

function applyCodeBlockStyles(
  pre: HTMLElement,
  theme: MdWechatTheme,
  styles: Record<string, string>,
): void {
  applyStyle(pre, styles.pre ?? DEFAULT_PRE_STYLE)
  pre.style.boxSizing = 'border-box'
  pre.style.maxWidth = '100%'
  pre.style.padding = '0'
  pre.style.overflow = 'hidden'
  pre.style.whiteSpace = 'normal'

  const code = pre.querySelector<HTMLElement>(':scope > code')
  if (!code) return

  if (theme.codeChrome === 'label' && styles.preHeader && !pre.querySelector(':scope > [data-wechat-code-header]')) {
    const header = pre.ownerDocument.createElement('span')
    header.dataset.wechatCodeHeader = 'true'
    applyStyle(header, `display:block;${styles.preHeader}`)

    const label = pre.ownerDocument.createElement('span')
    label.dataset.wechatCodeLabel = 'true'
    applyStyle(label, styles.preLabel)
    label.textContent = theme.codeLabel ?? 'CODE'
    header.append(label)
    pre.prepend(header)
  }

  applyStyle(code, `${styles.preBody ?? styles.prePlain ?? DEFAULT_PRE_BODY_STYLE}${styles.preCode ?? DEFAULT_PRE_CODE_STYLE}`)
  code.style.display = 'block'
  code.style.boxSizing = 'border-box'
  code.style.maxWidth = '100%'
  code.style.margin = '0'
  code.style.overflowX = 'hidden'
  code.style.whiteSpace = 'pre-wrap'
  code.style.wordBreak = 'break-word'
  code.style.overflowWrap = 'anywhere'
  if (!code.style.fontFamily) code.style.fontFamily = "Menlo, Consolas, 'Courier New', monospace"
  if (!code.style.fontSize) code.style.fontSize = '0.84em'
  if (!code.style.lineHeight) code.style.lineHeight = '1.65'
}

export function applyWechatTheme(
  html: string,
  rawSettings?: Partial<WechatThemeSettings> | null,
  sharedFormatting?: Pick<ArticleFormatting, 'theme' | 'font' | 'fontSize' | 'lineHeight' | 'accent'>,
): string {
  const settings = normalizeWechatThemeSettings(rawSettings)
  const theme = getWechatTheme(settings.themeId)
  const styles = buildStyles(theme, {
    accent: sharedFormatting ? ARTICLE_ACCENT_COLORS[sharedFormatting.accent] : settings.accentByTheme[theme.id],
    slotColors: settings.slotColorsByTheme[theme.id] ?? {},
    fontFamily: sharedFormatting?.font ?? settings.fontFamily,
    fontSize: sharedFormatting ? Number.parseInt(ARTICLE_FONT_SIZES[sharedFormatting.fontSize], 10) : settings.fontSize,
  })
  const document = new DOMParser().parseFromString(html, 'text/html')
  const container = document.createElement('section')
  container.dataset.wechatTheme = theme.id
  applyStyle(container, styles.container)
  while (document.body.firstChild) container.append(document.body.firstChild)
  document.body.append(container)

  for (let level = 1; level <= 6; level += 1) {
    container.querySelectorAll<HTMLElement>(`h${level}`).forEach((heading, index) => {
      applyStyle(heading, styles[`h${level}`])
      const contentWrapper = applyHeadingDecoration(heading, level, styles, index)
      applyHeadingLayoutSafety(heading, level, contentWrapper)
    })
  }

  container.querySelectorAll<HTMLElement>('p').forEach(paragraph => {
    const contextStyle = paragraph.closest('li')
      ? styles.liP
      : paragraph.closest('blockquote')
        ? styles.bqP
        : styles.p
    applyStyle(paragraph, contextStyle)
  })
  container.querySelectorAll<HTMLElement>('blockquote').forEach((quote, index) => {
    applyStyle(quote, index > 0 && quote.parentElement?.closest('blockquote') ? styles.blockquoteNested : styles.blockquote)
  })
  container.querySelectorAll<HTMLElement>('ul:not([data-type="taskList"])').forEach(element => applyStyle(element, styles.ul))
  container.querySelectorAll<HTMLElement>('ol').forEach(element => applyStyle(element, styles.ol))
  container.querySelectorAll<HTMLElement>('li:not([data-type="taskItem"])').forEach(element => applyStyle(element, styles.li))
  container.querySelectorAll<HTMLElement>('ul[data-type="taskList"]').forEach(list => {
    applyStyle(list, `${styles.ul}padding-left:0;list-style:none;`)
  })
  container.querySelectorAll<HTMLElement>('li[data-type="taskItem"]').forEach(item => {
    applyStyle(item, `${styles.li}display:grid;grid-template-columns:1.4em minmax(0,1fr);align-items:start;gap:0.25em;`)
    const lastParagraph = item.querySelector<HTMLElement>(':scope > div > p:last-child')
    if (lastParagraph) lastParagraph.style.marginBottom = '0'
  })
  container.querySelectorAll<HTMLElement>('a').forEach(element => applyStyle(element, styles.a))
  container.querySelectorAll<HTMLElement>('strong, b').forEach(element => {
    applyStyle(element, styles.strong)
    element.style.fontWeight = element.closest('h1, h2, h3, h4, h5, h6') ? 'inherit' : '800'
  })
  container.querySelectorAll<HTMLElement>('em, i').forEach(element => {
    applyStyle(element, styles.em)
    element.style.fontStyle = 'italic'
  })
  container.querySelectorAll<HTMLElement>('s, del').forEach(element => applyStyle(element, styles.s))
  container.querySelectorAll<HTMLElement>('mark').forEach(element => {
    applyStyle(element, styles.mark)
    ensureReadableHighlight(element)
  })
  container.querySelectorAll<HTMLElement>('hr').forEach(element => {
    applyStyle(element, styles.hr)
    renderThemeSeparator(element, styles.hrHtml)
  })
  container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach(preserveHeadingForeground)

  container.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    applyStyle(image, styles.img)
    image.style.maxWidth = '100%'
    image.style.height = 'auto'
    image.style.boxSizing = 'border-box'
  })

  container.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    applyStyle(table, `${styles.tableWrap ?? ''}${styles.table ?? ''}`)
    table.style.boxSizing = 'border-box'
    table.style.width = '100%'
    table.style.maxWidth = '100%'
    table.style.minWidth = '0'
    table.style.tableLayout = 'fixed'
  })
  container.querySelectorAll<HTMLElement>('th').forEach(cell => {
    applyStyle(cell, styles.th)
    cell.style.wordBreak = 'break-word'
    cell.style.overflowWrap = 'anywhere'
    cell.style.verticalAlign = 'top'
  })
  container.querySelectorAll<HTMLElement>('td').forEach(cell => {
    applyStyle(cell, styles.td)
    cell.style.wordBreak = 'break-word'
    cell.style.overflowWrap = 'anywhere'
    cell.style.verticalAlign = 'top'
  })
  container.querySelectorAll<HTMLElement>('code').forEach(code => {
    if (!code.closest('pre')) applyStyle(code, styles.code)
  })
  container.querySelectorAll<HTMLElement>('pre').forEach(pre => applyCodeBlockStyles(pre, theme, styles))

  if (sharedFormatting) {
    const lineHeight = ARTICLE_LINE_HEIGHTS[sharedFormatting.lineHeight]
    container.dataset.articleLayout = sharedFormatting.theme
    container.querySelectorAll<HTMLElement>('p, li, blockquote, th, td').forEach(element => {
      element.style.lineHeight = lineHeight
    })
    const headingFont = sharedFormatting.theme === 'editorial'
      ? ARTICLE_FONT_FAMILIES.serif
      : ARTICLE_FONT_FAMILIES.sans
    container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach(element => {
      element.style.fontFamily = headingFont
    })
    if (sharedFormatting.theme === 'editorial') {
      container.querySelectorAll<HTMLElement>('blockquote').forEach(element => {
        element.style.backgroundColor = '#f5f1ea'
      })
    }
  }

  return container.outerHTML
}
