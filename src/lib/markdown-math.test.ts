import { describe, expect, it } from 'vitest'
import { markdownMathRanges, renderMarkdownToSafeHtml, sanitizeContentHtml } from './markdown-compatibility'
import { htmlToReadableMarkdown, previewSourceBlocks } from './article-source'
import { applyArticleFormatting } from './article-formatting'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { applyWechatTheme, WECHAT_THEMES } from './wechat-theme'
import { parseContentFile } from './file-parser'
import JSZip from 'jszip'
import { paginateForXhsCards } from './xhs-pagination'

function parse(source: string) { return new DOMParser().parseFromString(source, 'text/html') }

describe('Markdown math', () => {
  it('imports math from Markdown, saved HTML and ZIP through the same safe renderer', async () => {
    const source = '# 公式\n\n$$\\frac{a}{b}$$'
    const zip = new JSZip().file('article.md', source)
    const files = [
      new File([source], 'math.md', { type: 'text/markdown' }),
      new File([renderMarkdownToSafeHtml(source)], 'math.html', { type: 'text/html' }),
      new File([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))], 'math.zip', { type: 'application/zip' }),
    ]
    for (const file of files) {
      const article = await parseContentFile(file)
      expect(parse(article.html).querySelectorAll('.katex')).toHaveLength(1)
      expect(htmlToReadableMarkdown(article.html)).toContain('\\frac{a}{b}')
    }
  })

  it('renders the screenshot Chinese equation and inline fractions', () => {
    const document = parse(renderMarkdownToSafeHtml(String.raw`行内 $\frac{a_1}{b^2}$。

$$\mathbf{总交付耗时} = \mathbf{前置准备} + \mathbf{生成等待} + \mathbf{事实核验} + \mathbf{人工微调}$$`))
    expect(document.querySelectorAll('.katex')).toHaveLength(2)
    expect(document.querySelector('.ez-math-display')?.textContent).toContain('总交付耗时')
    expect(document.querySelector('.ez-math-display')?.textContent).not.toContain('\\mathbf')
    expect(document.querySelectorAll('.ez-math-display .mathbf')).toHaveLength(5)
    expect(document.querySelector('[data-ez-math-error]')).toBeNull()
  })

  it('keeps code, escaped dollars, money and unclosed delimiters literal', () => {
    const source = ['`$x$`', '', '```tex', '$$x$$', '```', '', String.raw`\$x\$，$5 和 $10，$ unclosed`].join('\n')
    expect(parse(renderMarkdownToSafeHtml(source)).querySelector('[data-ez-math]')).toBeNull()
    expect(markdownMathRanges(source)).toHaveLength(0)
  })

  it('retains multiline matrices, blank lines and TeX content through compatibility rewrites', () => {
    const source = '$$\n\\begin{pmatrix}\na & b \\\\\n\n\nc & d\n\\end{pmatrix}\n$$'
    const document = parse(renderMarkdownToSafeHtml(source))
    expect(document.querySelector('.katex')).not.toBeNull()
    expect(document.querySelector('[data-ez-math-error], [data-source-spacer]')).toBeNull()
    expect(document.querySelector('[data-ez-math]')?.getAttribute('data-ez-math')).toContain('\n\n\n')
  })

  it('keeps raw source and an error hint for malformed or excessive formulas', () => {
    for (const source of ['$\\frac{a}{$', '$' + 'x'.repeat(10001) + '$']) {
      const document = parse(renderMarkdownToSafeHtml(source))
      expect(document.querySelector('[data-ez-math-error]')?.textContent).toContain('公式有误')
      expect(document.querySelector('[data-ez-math-error]')?.textContent).toContain(source)
    }
  })

  it('handles multiline math nested in quotes and lists without interpreting TeX as Markdown', () => {
    const source = '> $$\n> \\text{==保留==}\n> $$\n\n- $x^2$'
    const document = parse(renderMarkdownToSafeHtml(source))
    expect(document.querySelectorAll('.katex')).toHaveLength(2)
    expect(document.querySelector('blockquote .katex')?.textContent).toBe('==保留==')
    expect(markdownMathRanges(source).map(range => range.raw)).toEqual(['$$\n> \\text{==保留==}\n> $$', '$x^2$'])
  })

  it('rebuilds imported wrappers without trusting HTML, CSS, SVG or URL commands', () => {
    const document = parse(sanitizeContentHtml('<span data-ez-math="x^2" style="position:fixed" onclick="alert(1)"><img src="https://example.test/tracker"><svg onload="alert(1)"></svg></span>'))
    expect(document.querySelector('.katex')).not.toBeNull()
    expect(document.querySelector('img, [onclick], [onload], script')).toBeNull()
    expect(document.querySelector<HTMLElement>('.ez-math')?.style.position).toBe('')
    const unsafe = parse(renderMarkdownToSafeHtml(String.raw`$\href{javascript:alert(1)}{x}$ $\includegraphics{https://example.test/tracker}$`))
    expect(unsafe.querySelector('a, img, script')).toBeNull()
  })

  it('preserves fractional positioning after repeated sanitization and every theme', () => {
    const html = renderMarkdownToSafeHtml('$$\\frac{a}{b}$$')
    const again = sanitizeContentHtml(sanitizeContentHtml(html))
    const formatted = applyArticleFormatting(again, { ...DEFAULT_ARTICLE_FORMATTING, sourceStyle: 'theme' })
    for (const theme of WECHAT_THEMES) {
      const document = parse(applyWechatTheme(formatted, { themeId: theme.id }))
      expect(document.querySelectorAll('.katex')).toHaveLength(1)
      expect(document.querySelector('.frac-line')).not.toBeNull()
      expect(document.querySelector<HTMLElement>('.frac-line')?.style.borderBottomWidth).not.toBe('')
    }
  })

  it('round trips HTML to editable Markdown and maps formula blocks to source', () => {
    const source = '正文 $x^2$\n\n$$\n\\frac{a}{b}\n$$\n\n后文'
    expect(htmlToReadableMarkdown(renderMarkdownToSafeHtml(source))).toBe(source)
    expect(previewSourceBlocks(source, 'markdown')).toEqual([
      { blockIndex: 0, lines: [1] }, { blockIndex: 1, lines: [3, 4, 5] }, { blockIndex: 2, lines: [7] },
    ])
    expect(markdownMathRanges(source).map(range => source.slice(range.from, range.to))).toEqual(['$x^2$', '$$\n\\frac{a}{b}\n$$'])
  })

  it('keeps a formula intact when pagination splits nearby text', () => {
    const html = renderMarkdownToSafeHtml('正文。'.repeat(160) + '$\\frac{a+b}{c}$' + '结尾。'.repeat(160))
    const original = parse(html).querySelector('.ez-math')?.innerHTML
    const pages = paginateForXhsCards(html)
    const parsed = parse(pages.join(''))
    expect(parsed.querySelectorAll('.ez-math')).toHaveLength(1)
    expect(parsed.querySelector('.ez-math')?.innerHTML).toBe(original)
  })
})
