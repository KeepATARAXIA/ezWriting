import {
  ARTICLE_ACCENT_COLORS,
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_SIZES,
  ARTICLE_LINE_HEIGHTS,
  type ArticleFormatting,
} from '../domain/formatting'
import { MARKDOWN_CALLOUT_DEFINITIONS, normalizeMarkdownCalloutType } from './markdown-compatibility'
import { prepareSourceStyles, restoreSourceStyles } from './source-style-policy'

const HEADING_SIZES = {
  H1: '32px',
  H2: '25px',
  H3: '20px',
  H4: '17px',
  H5: '15px',
  H6: '13px',
} as const

const CODE_FONT = '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace'

export function applyArticleFormatting(html: string, formatting: ArticleFormatting): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  prepareSourceStyles(document, formatting.sourceStyle)
  const accent = ARTICLE_ACCENT_COLORS[formatting.accent]
  const bodyFont = ARTICLE_FONT_FAMILIES[formatting.font]
  const headingFont = formatting.theme === 'editorial'
    ? ARTICLE_FONT_FAMILIES.serif
    : ARTICLE_FONT_FAMILIES.sans

  document.body.querySelectorAll<HTMLElement>('p, li').forEach(element => {
    element.style.fontFamily = bodyFont
    element.style.fontSize = ARTICLE_FONT_SIZES[formatting.fontSize]
    element.style.lineHeight = ARTICLE_LINE_HEIGHTS[formatting.lineHeight]
    element.style.margin = '0 0 1.05em'
  })

  document.body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach(element => {
    element.style.fontFamily = headingFont
    element.style.fontSize = HEADING_SIZES[element.tagName as keyof typeof HEADING_SIZES]
    element.style.lineHeight = '1.38'
    element.style.margin = '1.55em 0 0.7em'
    element.style.color = '#111820'
    if (element.tagName === 'H2') {
      element.style.paddingLeft = '12px'
      element.style.borderLeft = `4px solid ${accent}`
    }
  })

  document.body.querySelectorAll<HTMLElement>('blockquote').forEach(element => {
    element.style.margin = '1.4em 0'
    element.style.padding = '0.8em 1em'
    element.style.borderLeft = `3px solid ${accent}`
    element.style.background = formatting.theme === 'editorial' ? '#f5f1ea' : '#f5f7f9'
    element.style.color = '#53606c'
    element.style.fontFamily = bodyFont
    element.style.fontSize = ARTICLE_FONT_SIZES[formatting.fontSize]
    element.style.lineHeight = ARTICLE_LINE_HEIGHTS[formatting.lineHeight]
  })

  document.body.querySelectorAll<HTMLElement>('a').forEach(element => {
    element.style.color = accent
    element.style.textDecoration = 'underline'
    element.style.textUnderlineOffset = '3px'
    element.style.overflowWrap = 'anywhere'
  })

  document.body.querySelectorAll<HTMLElement>('strong, b').forEach(element => {
    element.style.fontWeight = '800'
  })

  document.body.querySelectorAll<HTMLElement>('ul:not([data-type="taskList"]), ol').forEach(list => {
    list.style.margin = '0.9em 0 1.25em'
    list.style.paddingLeft = '1.55em'
  })

  document.body.querySelectorAll<HTMLElement>('pre').forEach(element => {
    element.style.boxSizing = 'border-box'
    element.style.maxWidth = '100%'
    element.style.margin = '1.15em 0'
    element.style.padding = '0.9em 1em'
    element.style.border = '1px solid #25313d'
    element.style.borderRadius = '6px'
    element.style.background = '#111820'
    element.style.color = '#f5f7fa'
    element.style.fontFamily = CODE_FONT
    element.style.fontSize = '13px'
    element.style.fontWeight = '500'
    element.style.lineHeight = '1.65'
    element.style.whiteSpace = 'pre-wrap'
    element.style.wordBreak = 'break-word'
    element.style.overflowWrap = 'anywhere'
    element.style.overflowX = 'hidden'

    const firstChild = element.firstElementChild
    const code = firstChild instanceof HTMLElement && firstChild.tagName === 'CODE' ? firstChild : null
    if (code) {
      code.style.padding = '0'
      code.style.border = '0'
      code.style.color = 'inherit'
      code.style.fontFamily = 'inherit'
      code.style.fontSize = 'inherit'
      code.style.lineHeight = 'inherit'
      code.style.whiteSpace = 'inherit'
      code.style.wordBreak = 'inherit'
      code.style.overflowWrap = 'inherit'
    }
  })

  document.body.querySelectorAll<HTMLElement>('code').forEach(element => {
    if (element.closest('pre')) return
    element.style.padding = '0.12em 0.36em'
    element.style.border = '1px solid #e4e7eb'
    element.style.borderRadius = '4px'
    element.style.background = '#f3f5f7'
    element.style.color = '#c2413a'
    element.style.fontFamily = CODE_FONT
    element.style.fontSize = '0.88em'
    element.style.fontWeight = '600'
    element.style.whiteSpace = 'normal'
    element.style.wordBreak = 'break-word'
    element.style.overflowWrap = 'anywhere'
  })

  document.body.querySelectorAll<HTMLElement>('mark').forEach(element => {
    element.style.padding = '0.08em 0.2em'
    element.style.borderRadius = '3px'
    if (!element.style.backgroundColor) element.style.backgroundColor = '#fff1a8'
    element.style.color = 'inherit'
  })

  document.body.querySelectorAll<HTMLElement>('del, s').forEach(element => {
    element.style.color = '#77818b'
    element.style.textDecorationColor = '#9aa3ab'
    element.style.textDecorationThickness = '1px'
  })

  document.body.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    table.style.width = '100%'
    table.style.maxWidth = '100%'
    table.style.margin = '1.25em 0'
    table.style.border = '1px solid #dce1e6'
    table.style.borderCollapse = 'collapse'
    table.style.tableLayout = 'fixed'
    table.style.fontFamily = bodyFont
    table.style.fontSize = '0.9em'
  })

  document.body.querySelectorAll<HTMLElement>('th, td').forEach(cell => {
    cell.style.padding = '0.55em 0.65em'
    cell.style.border = '1px solid #dce1e6'
    cell.style.verticalAlign = 'top'
    cell.style.wordBreak = 'break-word'
    cell.style.overflowWrap = 'anywhere'
    if (cell.tagName === 'TH') {
      cell.style.background = '#f5f7f9'
      cell.style.color = '#26313a'
      cell.style.fontWeight = '800'
      cell.style.textAlign = 'left'
    }
  })

  document.body.querySelectorAll<HTMLElement>('img').forEach(element => {
    element.style.display = 'block'
    element.style.maxWidth = '100%'
    element.style.height = 'auto'
    element.style.margin = '1.5em auto'
  })

  document.body.querySelectorAll<HTMLElement>('hr').forEach(element => {
    element.style.border = '0'
    element.style.borderTop = `1px solid ${accent}`
    element.style.margin = '2em 0'
    element.style.opacity = '0.45'
  })

  document.body.querySelectorAll<HTMLElement>('ul[data-type="taskList"]').forEach(list => {
    list.style.paddingLeft = '0'
    list.style.listStyle = 'none'
    list.querySelectorAll<HTMLElement>(':scope > li[data-type="taskItem"]').forEach(item => {
      const checked = item.getAttribute('data-checked') === 'true'
      item.style.margin = '0.5em 0'
      item.style.display = 'grid'
      item.style.gridTemplateColumns = '1.4em minmax(0, 1fr)'
      item.style.alignItems = 'start'

      const input = item.querySelector<HTMLInputElement>(':scope > label input[type="checkbox"]')
      const label = item.querySelector<HTMLElement>(':scope > label')
      let marker = item.querySelector<HTMLElement>(':scope > [data-ez-task-marker]')
      if (!marker) {
        marker = document.createElement('span')
        marker.dataset.ezTaskMarker = 'true'
        if (label) label.replaceWith(marker)
        else if (input) input.replaceWith(marker)
        else item.prepend(marker)
      }
      marker.textContent = checked ? '☑' : '☐'
      marker.style.color = checked ? accent : '#87919b'
      marker.style.fontFamily = 'sans-serif'
      marker.style.fontSize = ARTICLE_FONT_SIZES[formatting.fontSize]

      const content = item.querySelector<HTMLElement>(':scope > div')
      if (content && checked) {
        content.style.color = '#77818b'
        content.style.textDecoration = 'line-through'
      }
    })
  })

  document.body.querySelectorAll<HTMLElement>('aside[data-callout]').forEach(callout => {
    const type = normalizeMarkdownCalloutType(callout.dataset.callout || 'note')
    const definition = MARKDOWN_CALLOUT_DEFINITIONS[type]
    callout.style.boxSizing = 'border-box'
    callout.style.maxWidth = '100%'
    callout.style.margin = '1.5em 0'
    callout.style.border = `1px solid ${definition.border}`
    callout.style.borderLeft = `4px solid ${definition.accent}`
    callout.style.borderRadius = '6px'
    callout.style.background = definition.background
    callout.style.color = '#374151'
    callout.style.overflow = 'hidden'

    const heading = callout.querySelector<HTMLElement>(':scope > [data-callout-title]')
    if (heading) {
      heading.style.padding = '0.78em 1em 0.42em'
      heading.style.color = definition.accent
      heading.style.fontFamily = bodyFont
      heading.style.fontSize = ARTICLE_FONT_SIZES[formatting.fontSize]
      heading.style.fontWeight = '800'
      heading.style.lineHeight = '1.5'
      const icon = document.createElement('span')
      icon.textContent = definition.icon
      icon.style.width = '1.2em'
      icon.style.marginRight = '0.45em'
      icon.style.color = definition.accent
      icon.style.display = 'inline-block'
      icon.style.fontFamily = 'Arial, sans-serif'
      icon.style.fontSize = '1em'
      icon.style.fontWeight = '700'
      icon.style.lineHeight = '1.2em'
      icon.style.textAlign = 'center'
      icon.style.verticalAlign = '-0.08em'
      heading.prepend(icon)
    }

    const content = callout.querySelector<HTMLElement>(':scope > [data-callout-content]')
    if (content) {
      content.style.padding = '0.2em 1em 0.9em 2.7em'
      content.style.fontFamily = bodyFont
      content.style.fontSize = ARTICLE_FONT_SIZES[formatting.fontSize]
      content.style.lineHeight = ARTICLE_LINE_HEIGHTS[formatting.lineHeight]
      content.style.overflowWrap = 'anywhere'
      const lastChild = content.lastElementChild as HTMLElement | null
      if (lastChild) lastChild.style.marginBottom = '0'
    }
  })

  document.body.querySelectorAll<HTMLElement>('[data-footnote-item]').forEach((item, index) => {
    item.style.boxSizing = 'border-box'
    item.style.maxWidth = '100%'
    item.style.margin = index === 0 ? '1.8em 0 0' : '0.65em 0 0'
    item.style.padding = index === 0 ? '0.9em 0 0' : '0'
    item.style.borderTop = index === 0 ? '1px solid #dce1e6' : '0'
    item.style.display = 'grid'
    item.style.gridTemplateColumns = '1.6em minmax(0, 1fr)'
    item.style.gap = '0.25em'
    item.style.color = '#64748b'
    item.style.fontFamily = bodyFont
    item.style.fontSize = '0.88em'
    item.style.lineHeight = ARTICLE_LINE_HEIGHTS[formatting.lineHeight]
    item.style.overflowWrap = 'anywhere'

    const number = item.querySelector<HTMLElement>(':scope > [data-footnote-number]')
    if (number) {
      number.style.color = accent
      number.style.fontWeight = '800'
    }
    item.querySelectorAll<HTMLElement>('.ez-footnote-backref').forEach(backlink => {
      backlink.style.marginLeft = '0.2em'
      backlink.style.fontSize = '0.85em'
      backlink.style.textDecoration = 'none'
    })
  })

  if (formatting.sourceStyle === 'preserve') restoreSourceStyles(document, true)
  return document.body.innerHTML
}
