import katex from 'katex'
import type { MarkedExtension } from 'marked'

export interface MathSource {
  raw: string
  text: string
  display: boolean
}

// Dollar delimiters follow the usual no-leading/trailing-space inline convention.
// Code, escapes and link destinations are handled by the Markdown lexer first.
export function readMathSource(source: string, block = false): MathSource | undefined {
  if (!source.startsWith('$')) return
  const display = source.startsWith('$$')
  if (block && !display) return
  const delimiter = display ? '$$' : '$'
  const start = delimiter.length
  if (!display && /[\s$]/.test(source[start] ?? ' ')) return
  for (let end = start; end < source.length; end += 1) {
    if (source[end] === '\\') { end += 1; continue }
    if (!display && /[\r\n]/.test(source[end])) return
    if (!source.startsWith(delimiter, end)) continue
    if (!display && (/[\s，。；！？]/.test(source[end - 1]) || /[\d$]/.test(source[end + 1] ?? ''))) return
    if (display && block && !/^[ \t]*(?:\r?\n|$)/.test(source.slice(end + 2))) return
    const text = source.slice(start, end).trim()
    if (!text) return
    return { raw: source.slice(0, end + delimiter.length), text, display }
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function mathSourceMarkdown(element: HTMLElement): string | undefined {
  const source = element.getAttribute('data-ez-math')
  if (source === null) return
  return element.dataset.ezMathDisplay === 'true' ? `$$\n${source}\n$$` : `$${source}$`
}

export function mathPlaceholder(math: MathSource): string {
  const tag = math.display ? 'div' : 'span'
  return `<${tag} data-ez-math="${escapeHtml(math.text)}" data-ez-math-display="${math.display}"></${tag}>`
}

export const mathExtension: MarkedExtension = {
  extensions: [
    {
      name: 'ezMathBlock', level: 'block',
      start: source => source.match(/(?:^|\n)(?=\$\$)/)?.index,
      tokenizer(source) {
        const math = readMathSource(source, true)
        if (math) return { type: 'ezMathBlock', ...math }
      },
      renderer: token => mathPlaceholder(token as unknown as MathSource) + '\n',
    },
    {
      name: 'ezMathInline', level: 'inline',
      start: source => source.indexOf('$'),
      tokenizer(source) {
        const math = readMathSource(source)
        if (math) return { type: 'ezMathInline', ...math }
      },
      renderer: token => {
        // Inline display syntax must remain valid inside a paragraph.
        return mathPlaceholder(token as unknown as MathSource).replace(/^<div /, '<span ').replace(/<\/div>$/, '</span>')
      },
    },
  ],
}

// Never trust imported KaTeX markup or its styles. Rebuild only from plain TeX
// after the regular HTML sanitizer, with network/HTML commands disabled.
export function hydrateMath(document: Document): void {
  document.body.querySelectorAll<HTMLElement>('[data-ez-math]').forEach(element => {
    if (!element.isConnected || element.parentElement?.closest('[data-ez-math]')) return
    const source = element.getAttribute('data-ez-math') ?? ''
    const display = element.dataset.ezMathDisplay === 'true'
    const wrapper = document.createElement(display && element.tagName === 'DIV' ? 'div' : 'span')
    wrapper.dataset.ezMath = source
    wrapper.dataset.ezMathDisplay = String(display)
    wrapper.className = display ? 'ez-math ez-math-display' : 'ez-math'
    wrapper.setAttribute('role', 'math')
    wrapper.setAttribute('aria-label', source)
    wrapper.style.cssText = display
      ? 'display:block;max-width:100%;overflow-x:auto;overflow-y:hidden;text-align:center;margin:1em 0;padding:0.15em 0;'
      : 'display:inline-block;max-width:100%;vertical-align:middle;'
    try {
      if (source.length > 10000) throw new Error('公式超过 10000 字符')
      wrapper.innerHTML = katex.renderToString(source, {
        displayMode: display, output: 'html', throwOnError: true,
        trust: false, strict: false, maxExpand: 1000, maxSize: 20,
      })
    } catch (error) {
      if (!(error instanceof katex.ParseError) && !(error instanceof Error && error.message === '公式超过 10000 字符')) throw error
      wrapper.dataset.ezMathError = 'true'
      wrapper.textContent = `${display ? '$$' : '$'}${source}${display ? '$$' : '$'}`
      const hint = document.createElement('small')
      hint.textContent = '（公式有误，请检查语法）'
      wrapper.append(hint)
      wrapper.title = error.message
    }
    element.replaceWith(wrapper)
  })
}
