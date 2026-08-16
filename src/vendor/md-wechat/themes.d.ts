export interface MdWechatColorSlot {
  key: string
  label: string
  base: string
  also?: string[]
  tints?: Record<string, number | 'deep'>
}

export interface MdWechatTheme {
  id: string
  name: string
  tag: string
  description: string
  primary: string
  font?: 'sans' | 'serif' | 'rounded'
  fontLocked?: boolean
  mock: string
  surface: string
  previewFade: string
  codeTheme?: 'light' | 'dark'
  codeChrome?: 'label' | 'plain' | 'window'
  codeLabel?: string
  extractH2Index?: boolean
  styles: (primary: string, fontSize: number, fontFamily: string) => Record<string, string>
}

export const themes: MdWechatTheme[]
export const COLOR_SLOTS: Record<string, MdWechatColorSlot[]>
export const themeCategories: Record<string, string>
export const categoryOrder: string[]
export function buildStyles(theme: MdWechatTheme, options?: {
  accent?: string
  fontSize?: number
  fontFamily?: 'theme' | 'sans' | 'serif' | 'rounded'
  slotColors?: Record<string, string>
  custom?: Record<string, string>
}): Record<string, string>
