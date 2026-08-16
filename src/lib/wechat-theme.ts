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

function applyHeadingDecoration(element: HTMLElement, level: number, styles: Record<string, string>, index: number): void {
  const open = styles[`h${level}WrapOpen`] ?? ''
  const close = styles[`h${level}WrapClose`] ?? ''
  if (open || close) element.innerHTML = `${open}${element.innerHTML}${close}`
  if (level === 2 && styles.h2Index) {
    const marker = element.ownerDocument.createElement('span')
    marker.setAttribute('aria-hidden', 'true')
    marker.style.cssText = styles.h2Index
    marker.textContent = String(index + 1).padStart(2, '0')
    element.prepend(marker)
  }
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
      applyHeadingDecoration(heading, level, styles, index)
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
  container.querySelectorAll<HTMLElement>('li').forEach(element => applyStyle(element, styles.li))
  container.querySelectorAll<HTMLElement>('a').forEach(element => applyStyle(element, styles.a))
  container.querySelectorAll<HTMLElement>('strong, b').forEach(element => applyStyle(element, styles.strong))
  container.querySelectorAll<HTMLElement>('em, i').forEach(element => applyStyle(element, styles.em))
  container.querySelectorAll<HTMLElement>('s, del').forEach(element => applyStyle(element, styles.s))
  container.querySelectorAll<HTMLElement>('mark').forEach(element => applyStyle(element, styles.mark))
  container.querySelectorAll<HTMLElement>('hr').forEach(element => applyStyle(element, styles.hr))

  container.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    applyStyle(image, styles.img)
    const alt = image.alt.trim()
    if (!alt || image.nextElementSibling?.hasAttribute('data-wechat-caption')) return
    const caption = document.createElement('span')
    caption.dataset.wechatCaption = 'true'
    caption.textContent = alt
    applyStyle(caption, styles.caption)
    image.after(caption)
  })

  container.querySelectorAll<HTMLTableElement>('table').forEach(table => applyStyle(table, styles.table))
  container.querySelectorAll<HTMLElement>('th').forEach(cell => applyStyle(cell, styles.th))
  container.querySelectorAll<HTMLElement>('td').forEach(cell => applyStyle(cell, styles.td))
  container.querySelectorAll<HTMLElement>('code').forEach(code => {
    applyStyle(code, code.closest('pre') ? styles.preCode : styles.code)
  })
  container.querySelectorAll<HTMLElement>('pre').forEach(pre => {
    applyStyle(pre, styles.pre)
    const code = pre.querySelector<HTMLElement>(':scope > code')
    if (code) applyStyle(code, `${styles.preBody ?? ''}${styles.preCode ?? ''}`)
  })

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
