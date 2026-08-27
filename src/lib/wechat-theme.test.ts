import { describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { applyArticleFormatting } from './article-formatting'
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
    const source = '<h2>主题标题</h2><p>正文 <strong>重点</strong>、<em>斜体</em> 与 <a href="https://example.com">链接</a></p><blockquote><p>引用</p></blockquote><pre><code>const ok = true</code></pre>'
    const outputs = WECHAT_THEMES.map(theme => applyWechatTheme(source, { themeId: theme.id }))

    expect(new Set(outputs).size).toBe(26)
    outputs.forEach((output, index) => {
      const document = new DOMParser().parseFromString(output, 'text/html')
      expect(document.body.firstElementChild?.getAttribute('data-wechat-theme')).toBe(WECHAT_THEMES[index].id)
      expect(document.querySelector('h2')?.getAttribute('style')).toBeTruthy()
      expect(document.querySelector<HTMLElement>('p strong')?.style.fontWeight, WECHAT_THEMES[index].id).toBe('800')
      expect(document.querySelector<HTMLElement>('em')?.style.fontStyle, WECHAT_THEMES[index].id).toBe('italic')
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

  it('keeps image alt text without rendering it as a visible caption', () => {
    const output = applyWechatTheme('<p><img src="image.png" alt="image"></p>', { themeId: 'literary' })
    const document = new DOMParser().parseFromString(output, 'text/html')

    expect(document.querySelector('img')?.getAttribute('alt')).toBe('image')
    expect(document.querySelector('[data-wechat-caption]')).toBeNull()
    expect(document.querySelector('[data-wechat-theme]')?.textContent).not.toContain('image')
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

  it('keeps semantic inline formatting from overriding the foreground of decorated headings', () => {
    const output = applyWechatTheme(
      '<h2><strong>代码越来越便宜</strong>，<a href="https://example.com">开始变贵了</a></h2>',
      { themeId: 'cyan-scape' },
      { ...DEFAULT_ARTICLE_FORMATTING, accent: 'green' },
    )
    const document = new DOMParser().parseFromString(output, 'text/html')
    const headingBand = document.querySelector<HTMLElement>('h2 > span')

    expect(headingBand?.style.backgroundImage).toContain('linear-gradient')
    expect(headingBand?.style.color).toBe('rgb(255, 255, 255)')
    expect(headingBand?.style.display).toBe('block')
    expect(headingBand?.style.width).toBe('100%')
    expect(headingBand?.style.boxSizing).toBe('border-box')
    expect(document.querySelector<HTMLElement>('h2 strong')?.style.color).toBe('inherit')
    expect(document.querySelector<HTMLElement>('h2 a')?.style.color).toBe('inherit')
  })

  it('turns boxed heading decorations into single responsive blocks without flattening inline highlighters', () => {
    const boxedThemes = ['cream-orange', 'mori-journal', 'peach-soda', 'wisteria', 'hk-neon', 'cyan-scape'] as const

    boxedThemes.forEach(themeId => {
      const document = new DOMParser().parseFromString(
        applyWechatTheme('<h2><strong>这是一个需要在窄版中稳定换行的长标题</strong></h2>', { themeId }),
        'text/html',
      )
      const wrapper = document.querySelector<HTMLElement>('h2 strong')?.closest<HTMLElement>('span')

      expect(wrapper?.style.display, themeId).toBe('block')
      expect(wrapper?.style.width, themeId).toBe('100%')
      expect(wrapper?.style.maxWidth, themeId).toBe('100%')
      expect(wrapper?.style.boxSizing, themeId).toBe('border-box')
    })

    const highlighted = new DOMParser().parseFromString(
      applyWechatTheme('<h2><strong>荧光笔标题保持行内效果</strong></h2>', { themeId: 'lemon-sea' }),
      'text/html',
    )
    const highlighter = highlighted.querySelector<HTMLElement>('h2 strong')?.closest<HTMLElement>('span')
    expect(highlighter?.style.display).toBe('')
    expect(highlighter?.style.width).toBe('')
    expect(highlighter?.style.boxDecorationBreak).toBe('clone')
  })

  it('adds narrow-layout safety to tables, code blocks, images, and task lists in every theme', () => {
    const source = applyArticleFormatting(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>已完成任务</p></div></li></ul><pre><code class="language-ts">const veryLongToken = "abcdefghijklmnopqrstuvwxyz0123456789"</code></pre><table><thead><tr><th>很长的字段名称</th></tr></thead><tbody><tr><td>abcdefghijklmnopqrstuvwxyz0123456789</td></tr></tbody></table><img src="image.png" alt="示例图"><hr data-source-block="4">',
      DEFAULT_ARTICLE_FORMATTING,
    )

    WECHAT_THEMES.forEach(theme => {
      const output = applyWechatTheme(source, { themeId: theme.id })
      const document = new DOMParser().parseFromString(output, 'text/html')
      const task = document.querySelector<HTMLElement>('li[data-type="taskItem"]')
      const pre = document.querySelector<HTMLElement>('pre')
      const blockCode = pre?.querySelector<HTMLElement>('code')
      const table = document.querySelector<HTMLTableElement>('table')
      const cell = document.querySelector<HTMLElement>('th, td')
      const image = document.querySelector<HTMLImageElement>('img')
      const separator = document.querySelector<HTMLElement>('[data-source-block="4"]')

      expect(task?.style.display, theme.id).toBe('grid')
      expect(task?.style.gridTemplateColumns, theme.id).toMatch(/minmax\(0,\s*1fr\)/)
      expect(pre?.style.maxWidth, theme.id).toBe('100%')
      expect(pre?.style.overflow, theme.id).toBe('hidden')
      expect(blockCode?.style.display, theme.id).toBe('block')
      expect(blockCode?.style.whiteSpace, theme.id).toBe('pre-wrap')
      expect(blockCode?.style.overflowWrap, theme.id).toBe('anywhere')
      expect(table?.style.maxWidth, theme.id).toBe('100%')
      expect(table?.style.minWidth, theme.id).toBe('0px')
      expect(table?.style.tableLayout, theme.id).toBe('fixed')
      expect(cell?.style.overflowWrap, theme.id).toBe('anywhere')
      expect(image?.style.height, theme.id).toBe('auto')
      expect(separator, theme.id).not.toBeNull()
    })
  })

  it('renders theme code labels and decorative separators without losing source mapping', () => {
    const output = applyWechatTheme(
      '<pre data-source-block="0"><code>const ok = true</code></pre><hr data-source-block="1">',
      { themeId: 'cyan-scape' },
    )
    const document = new DOMParser().parseFromString(output, 'text/html')

    expect(document.querySelector('[data-wechat-code-label]')).toBeNull()
    expect(document.querySelector('[data-wechat-separator][data-source-block="1"]')).not.toBeNull()

    const labeled = new DOMParser().parseFromString(
      applyWechatTheme('<pre><code>const ok = true</code></pre>', { themeId: 'blueprint' }),
      'text/html',
    )
    expect(labeled.querySelector('[data-wechat-code-label]')?.textContent).toBe('DRAWING')
  })
})
