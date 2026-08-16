import { describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import {
  applyWechatTheme,
  getWechatTheme,
  normalizeWechatThemeSettings,
  WECHAT_THEME_CATEGORIES,
  WECHAT_THEME_IDS,
  WECHAT_THEMES,
} from './wechat-theme'

describe('wechat theme layer', () => {
  it('exposes the 26 attributed md-wechat themes with stable unique ids', () => {
    expect(WECHAT_THEMES).toHaveLength(26)
    expect(WECHAT_THEMES.map(theme => theme.id)).toEqual([...WECHAT_THEME_IDS])
    expect(new Set(WECHAT_THEMES.map(theme => theme.name)).size).toBe(26)
    expect(WECHAT_THEME_CATEGORIES).toEqual(['简约', '书卷', '杂志', '商务', '科技', '活力', '全部'])
  })

  it('renders every theme as self-contained inline HTML without undefined style fragments', () => {
    const source = '<h2>主题标题</h2><p>正文 <strong>重点</strong> 与 <a href="https://example.com">链接</a></p><blockquote><p>引用</p></blockquote><pre><code>const ok = true</code></pre>'
    const outputs = WECHAT_THEMES.map(theme => applyWechatTheme(source, { themeId: theme.id }))

    expect(new Set(outputs).size).toBe(26)
    outputs.forEach((output, index) => {
      const document = new DOMParser().parseFromString(output, 'text/html')
      expect(document.body.firstElementChild?.getAttribute('data-wechat-theme')).toBe(WECHAT_THEMES[index].id)
      expect(document.querySelector('h2')?.getAttribute('style')).toBeTruthy()
      expect(output).not.toMatch(/undefined|null/)
    })
  })

  it('stores accent and auxiliary colors independently for each theme and rejects invalid values', () => {
    const normalized = normalizeWechatThemeSettings({
      themeId: 'candy-pop',
      accentByTheme: {
        'candy-pop': '#123456',
        literary: 'javascript:alert(1)',
      },
      slotColorsByTheme: {
        'candy-pop': { blue: '#abcdef', unknown: '#111111' },
      },
      fontFamily: 'rounded',
      fontSize: 99,
    })

    expect(normalized).toMatchObject({
      themeId: 'candy-pop',
      accentByTheme: { 'candy-pop': '#123456' },
      slotColorsByTheme: { 'candy-pop': { blue: '#abcdef' } },
      fontFamily: 'rounded',
      fontSize: 18,
    })
    expect(normalized.accentByTheme.literary).toBeUndefined()

    const output = applyWechatTheme('<h2>自定义主题</h2>', normalized)
    expect(output.toLowerCase()).toContain('#123456')
    expect(output.toLowerCase()).toContain('#abcdef')
    expect(getWechatTheme('missing').id).toBe('literary')
  })

  it('preserves source blocks inside the theme container for editor-preview locating', () => {
    const output = applyWechatTheme('<p data-source-block="0">第一段</p><p data-source-block="1">第二段</p>', { themeId: 'literary' })
    const document = new DOMParser().parseFromString(output, 'text/html')
    expect(document.querySelectorAll('[data-wechat-theme] > [data-source-block]')).toHaveLength(2)
  })

  it('adapts shared article typography, spacing, and accent inside WeChat themes', () => {
    const output = applyWechatTheme(
      '<p>共享排版</p><a href="https://example.com">链接</a>',
      { themeId: 'literary' },
      {
        ...DEFAULT_ARTICLE_FORMATTING,
        font: 'sans',
        fontSize: 'large',
        lineHeight: 'airy',
        accent: 'orange',
      },
    )
    const document = new DOMParser().parseFromString(output, 'text/html')
    const container = document.querySelector<HTMLElement>('[data-wechat-theme]')
    const paragraph = document.querySelector<HTMLElement>('p')

    expect(container?.style.fontSize).toBe('19px')
    expect(paragraph?.style.lineHeight).toBe('2.15')
    expect(container?.style.fontFamily).toContain('Microsoft YaHei')
    expect(document.querySelector<HTMLElement>('a')?.style.color).toBe('rgb(240, 106, 42)')
  })
})
