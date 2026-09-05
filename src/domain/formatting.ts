import type { WechatThemeSettings } from '../lib/wechat-theme'

export type ArticleTheme = 'clean' | 'editorial' | 'wechat'
export type ArticleFont = 'sans' | 'serif'
export type ArticleFontSize = 'small' | 'medium' | 'large'
export type ArticleLineHeight = 'compact' | 'comfortable' | 'airy'
export type ArticleAccent = 'blue' | 'green' | 'orange' | 'purple'

export interface ArticleFormatting {
  sourceStyle?: 'preserve' | 'theme'
  theme: ArticleTheme
  font: ArticleFont
  fontSize: ArticleFontSize
  lineHeight: ArticleLineHeight
  accent: ArticleAccent
  wechat: WechatThemeSettings
}

export const DEFAULT_ARTICLE_FORMATTING: ArticleFormatting = {
  sourceStyle: 'theme',
  theme: 'clean',
  font: 'serif',
  fontSize: 'medium',
  lineHeight: 'comfortable',
  accent: 'blue',
  wechat: {
    themeId: 'literary',
    accentByTheme: {},
    slotColorsByTheme: {},
    fontFamily: 'theme',
    fontSize: 16,
  },
}

export const ARTICLE_ACCENT_COLORS: Record<ArticleAccent, string> = {
  blue: '#1648ff',
  green: '#07a35a',
  orange: '#f06a2a',
  purple: '#7657ff',
}

export const ARTICLE_FONT_FAMILIES: Record<ArticleFont, string> = {
  sans: '"MiSans", "HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif',
  serif: '"Noto Serif SC", "Songti SC", "STSong", serif',
}

export const ARTICLE_FONT_SIZES: Record<ArticleFontSize, string> = {
  small: '15px',
  medium: '17px',
  large: '19px',
}

export const ARTICLE_LINE_HEIGHTS: Record<ArticleLineHeight, string> = {
  compact: '1.65',
  comfortable: '1.9',
  airy: '2.15',
}
