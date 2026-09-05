export interface XhsPaginationOptions {
  title?: string
  textScale?: number
  showFooter?: boolean
}

export type XhsPageFits = (pageHtml: string, pageIndex: number) => boolean

type ListTag = 'OL' | 'UL'

interface ListChunk {
  groupId: number
  item: Element
  order: number
  tag: ListTag
  template: Element
}

interface CardChunk {
  element: Element
  estimatedHeight: number
  isHeading: boolean
  hasProtectedContent: boolean
  list?: ListChunk
}

const CARD_WIDTH = 540
const CARD_HORIZONTAL_PADDING = CARD_WIDTH * 0.0778 * 2
const CARD_CONTENT_WIDTH = CARD_WIDTH - CARD_HORIZONTAL_PADDING
const CARD_CONTENT_HEIGHT = 580
const TEXT_CARD_CONTENT_HEIGHT = 600
const FOOTER_RECLAIM_HEIGHT = 22
const IMAGE_MAX_HEIGHT = CARD_CONTENT_WIDTH * 0.4259
const IMAGE_VERTICAL_MARGIN = 38
const LIST_GROUP_VERTICAL_MARGIN = 33
const ADJACENT_LIST_GROUP_VERTICAL_MARGIN = 19
const TITLE_UNITS_PER_LINE = 15
const PARAGRAPH_UNITS_PER_LINE = 34
const LIST_UNITS_PER_LINE = 32
const HEADING_UNITS_PER_LINE = 27
const CALLOUT_UNITS_PER_LINE = 30
const BODY_LINE_HEIGHT = 22
const SOURCE_SPACER_HEIGHT = 26
const HEADING_LINE_HEIGHT = 21
const MIN_FIRST_PAGE_BODY_HEIGHT = 170
const MAX_TEXT_FRAGMENT_HEIGHT = 165
const MAX_TABLE_FRAGMENT_HEIGHT = 250
const MAX_CONTAINER_FRAGMENT_HEIGHT = 145
const PRE_LINES_PER_FRAGMENT = 10

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function visualTextLength(text: string): number {
  let length = 0
  for (const character of Array.from(text)) {
    if (/\s/.test(character)) length += 0.35
    else if (character.charCodeAt(0) <= 0x7f) length += 0.58
    else length += 1
  }
  return length
}

function textLineCount(text: string, unitsPerLine: number): number {
  const explicitLines = text.split(/\r?\n/)
  return Math.max(1, explicitLines.reduce((total, line) => total + Math.max(1, Math.ceil(visualTextLength(line) / unitsPerLine)), 0))
}

interface ImageDimensions {
  width: number
  height: number
}

function byteAt(binary: string, offset: number): number {
  return binary.charCodeAt(offset) & 0xff
}

function readBigEndian32(binary: string, offset: number): number {
  return (byteAt(binary, offset) * 0x1000000)
    + (byteAt(binary, offset + 1) << 16)
    + (byteAt(binary, offset + 2) << 8)
    + byteAt(binary, offset + 3)
}

function decodeImagePrefix(source: string, maxBytes = 65536): string | null {
  const match = source.match(/^data:image\/[^;,]+;base64,([a-z0-9+/=]+)/i)
  if (!match) return null
  const encodedLength = Math.ceil(maxBytes / 3) * 4
  try {
    return atob(match[1].slice(0, encodedLength))
  } catch {
    return null
  }
}

function readDataImageDimensions(source: string): ImageDimensions | null {
  const binary = decodeImagePrefix(source)
  if (!binary) return null

  if (binary.length >= 24
    && byteAt(binary, 0) === 0x89
    && binary.slice(1, 4) === 'PNG') {
    const width = readBigEndian32(binary, 16)
    const height = readBigEndian32(binary, 20)
    return width > 0 && height > 0 ? { width, height } : null
  }

  if (binary.length >= 10 && (binary.startsWith('GIF87a') || binary.startsWith('GIF89a'))) {
    const width = byteAt(binary, 6) + (byteAt(binary, 7) << 8)
    const height = byteAt(binary, 8) + (byteAt(binary, 9) << 8)
    return width > 0 && height > 0 ? { width, height } : null
  }

  if (binary.length >= 10 && byteAt(binary, 0) === 0xff && byteAt(binary, 1) === 0xd8) {
    let offset = 2
    while (offset + 8 < binary.length) {
      if (byteAt(binary, offset) !== 0xff) {
        offset += 1
        continue
      }
      const marker = byteAt(binary, offset + 1)
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2
        continue
      }
      const segmentLength = (byteAt(binary, offset + 2) << 8) + byteAt(binary, offset + 3)
      if (segmentLength < 2) break
      if ((marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)) {
        const height = (byteAt(binary, offset + 5) << 8) + byteAt(binary, offset + 6)
        const width = (byteAt(binary, offset + 7) << 8) + byteAt(binary, offset + 8)
        return width > 0 && height > 0 ? { width, height } : null
      }
      offset += segmentLength + 2
    }
  }

  return null
}

function imageDimensions(image: Element): ImageDimensions | null {
  const width = Number(image.getAttribute('width'))
  const height = Number(image.getAttribute('height'))
  if (width > 0 && height > 0) return { width, height }
  return readDataImageDimensions(image.getAttribute('src') || '')
}

function renderedImageHeight(image: Element, availableWidth = CARD_CONTENT_WIDTH): number {
  const dimensions = imageDimensions(image)
  if (!dimensions) return IMAGE_MAX_HEIGHT
  const scale = Math.min(1, availableWidth / dimensions.width)
  return Math.min(IMAGE_MAX_HEIGHT, dimensions.height * scale)
}

function imagesHeight(element: Element): number {
  const images = [
    ...(element.matches('img') ? [element] : []),
    ...Array.from(element.querySelectorAll('img')),
  ]
  return images.reduce((total, image) => {
    const widthPercent = Number((image as HTMLElement).dataset.xhsImageWidth)
    const availableWidth = Number.isFinite(widthPercent)
      ? CARD_CONTENT_WIDTH * Math.min(100, Math.max(30, widthPercent)) / 100
      : CARD_CONTENT_WIDTH
    return total + renderedImageHeight(image, availableWidth) + IMAGE_VERTICAL_MARGIN
  }, 0)
}

function estimateTableRowHeight(row: Element, textScale: number): number {
  const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'))
  if (!cells.length) return 34 * textScale
  const unitsPerCell = Math.max(7, Math.floor((PARAGRAPH_UNITS_PER_LINE * 0.92) / cells.length))
  const lines = Math.max(...cells.map(cell => textLineCount(cell.textContent?.trim() || '', unitsPerCell)))
  return (lines * 18 + 17) * textScale
}

function estimateTableHeight(table: Element, textScale: number): number {
  const rows = Array.from(table.querySelectorAll('tr'))
  return 20 + rows.reduce((total, row) => total + estimateTableRowHeight(row, textScale), 0)
}

function estimateMediaLayoutHeight(element: Element, textScale: number): number {
  const image = element.querySelector('img')
  const text = element.querySelector('.xhs-media-text')?.textContent?.trim() || ''
  const columnPercent = Math.min(70, Math.max(30, Number((element as HTMLElement).style.getPropertyValue('--xhs-image-column').replace('%', '')) || 45))
  const imageWidth = CARD_CONTENT_WIDTH * columnPercent / 100
  const textWidth = Math.max(120, CARD_CONTENT_WIDTH - imageWidth - 18)
  const textUnits = Math.max(10, Math.floor(PARAGRAPH_UNITS_PER_LINE * textWidth / CARD_CONTENT_WIDTH))
  const imageHeight = image ? renderedImageHeight(image, imageWidth) : 0
  const textHeight = textLineCount(text, textUnits) * BODY_LINE_HEIGHT * textScale + 24
  return Math.max(imageHeight, textHeight) + 22
}

function estimateElementHeight(element: Element, listItem = false, textScale = 1): number {
  if (element.hasAttribute('data-source-spacer')) return SOURCE_SPACER_HEIGHT * textScale
  const text = element.textContent?.trim() || ''
  const embeddedImagesHeight = imagesHeight(element)

  if (element.hasAttribute('data-xhs-media-layout')) return estimateMediaLayoutHeight(element, textScale)
  if (element.tagName === 'IMG') return embeddedImagesHeight
  if (element.tagName === 'TABLE') return estimateTableHeight(element, textScale) + embeddedImagesHeight
  if (element.tagName === 'PRE') return (textLineCount(text, 34) * 21 + 34) * textScale + embeddedImagesHeight
  if (/^H[1-6]$/.test(element.tagName)) return (textLineCount(text, HEADING_UNITS_PER_LINE) * HEADING_LINE_HEIGHT + 35) * textScale + embeddedImagesHeight
  if (element.tagName === 'BLOCKQUOTE') return (textLineCount(text, CALLOUT_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 56) * textScale + embeddedImagesHeight
  if (element.tagName === 'ASIDE' && element.hasAttribute('data-callout')) return (textLineCount(text, CALLOUT_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 58) * textScale + embeddedImagesHeight
  if (listItem || element.tagName === 'LI') return textLineCount(text, LIST_UNITS_PER_LINE) * BODY_LINE_HEIGHT * textScale + embeddedImagesHeight
  if (element.tagName === 'P') return (text ? textLineCount(text, PARAGRAPH_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 14 : 14) * textScale + embeddedImagesHeight
  return (textLineCount(text, PARAGRAPH_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 14) * textScale + embeddedImagesHeight
}

function containsProtectedContent(element: Element): boolean {
  return element.matches('img, table, pre, blockquote, aside[data-callout], [data-xhs-media-layout]')
    || Boolean(element.querySelector('img, table, pre, blockquote, aside[data-callout], [data-xhs-media-layout]'))
}

function textNodes(element: Element): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, 4)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function locateTextOffset(nodes: Text[], offset: number): { node: Text; offset: number } | null {
  let consumed = 0
  for (const node of nodes) {
    const next = consumed + node.data.length
    if (offset <= next) return { node, offset: Math.max(0, offset - consumed) }
    consumed = next
  }
  const last = nodes.at(-1)
  return last ? { node: last, offset: last.data.length } : null
}

function cloneTextSlice(element: Element, start: number, end: number): Element | null {
  const nodes = textNodes(element)
  const from = locateTextOffset(nodes, start)
  const to = locateTextOffset(nodes, end)
  if (!from || !to) return null

  const range = element.ownerDocument.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  const clone = element.cloneNode(false) as Element
  clone.append(range.cloneContents())
  return clone
}

function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const expression = /[^。！？!?；;\n]+(?:[。！？!?；;]+|\n+|$)/g
  let match = expression.exec(text)
  while (match) {
    const start = match.index
    const end = start + match[0].length
    if (end > start) ranges.push({ start, end })
    match = expression.exec(text)
  }
  return ranges.length ? ranges : [{ start: 0, end: text.length }]
}

function splitOversizedRange(text: string, start: number, end: number): Array<{ start: number; end: number }> {
  const maxCharacters = 84
  if (end - start <= maxCharacters) return [{ start, end }]

  const ranges: Array<{ start: number; end: number }> = []
  let cursor = start
  while (end - cursor > maxCharacters) {
    const preferredEnd = cursor + maxCharacters
    const searchStart = cursor + Math.floor(maxCharacters * 0.58)
    let cut = preferredEnd
    for (let index = preferredEnd; index >= searchStart; index -= 1) {
      if (/[，,、：:\s]/.test(text[index] || '')) {
        cut = index + 1
        break
      }
    }
    ranges.push({ start: cursor, end: cut })
    cursor = cut
  }
  if (cursor < end) ranges.push({ start: cursor, end })
  return ranges
}

function splitLongParagraph(element: Element, textScale: number): Element[] {
  if (element.tagName !== 'P'
    || containsProtectedContent(element)
    || estimateElementHeight(element, false, textScale) <= MAX_TEXT_FRAGMENT_HEIGHT) {
    return [element.cloneNode(true) as Element]
  }

  const text = element.textContent || ''
  const ranges = sentenceRanges(text).flatMap(range => splitOversizedRange(text, range.start, range.end))
  const fragments: Element[] = []
  let groupStart = ranges[0]?.start || 0
  let groupEnd = groupStart

  const pushGroup = () => {
    if (groupEnd <= groupStart) return
    const fragment = cloneTextSlice(element, groupStart, groupEnd)
    if (fragment && fragment.textContent?.trim()) fragments.push(fragment)
  }

  for (const range of ranges) {
    const candidate = cloneTextSlice(element, groupStart, range.end)
    if (groupEnd > groupStart && candidate && estimateElementHeight(candidate, false, textScale) > MAX_TEXT_FRAGMENT_HEIGHT) {
      pushGroup()
      groupStart = range.start
    }
    groupEnd = range.end
  }
  pushGroup()

  return fragments.length ? fragments : [element.cloneNode(true) as Element]
}

function splitTable(table: Element, textScale: number): Element[] {
  const body = table.querySelector(':scope > tbody')
  const rows = body ? Array.from(body.querySelectorAll(':scope > tr')) : []
  if (!rows.length || estimateTableHeight(table, textScale) <= MAX_TABLE_FRAGMENT_HEIGHT) {
    return [table.cloneNode(true) as Element]
  }

  const fragments: Element[] = []
  let currentRows: Element[] = []
  let currentHeight = 20 + Array.from(table.querySelectorAll(':scope > thead > tr'))
    .reduce((total, row) => total + estimateTableRowHeight(row, textScale), 0)

  const pushFragment = () => {
    if (!currentRows.length) return
    const fragment = table.cloneNode(false) as Element
    Array.from(table.children).forEach(child => {
      if (child.tagName === 'TBODY' || child.tagName === 'TFOOT') return
      fragment.append(child.cloneNode(true))
    })
    const fragmentBody = body!.cloneNode(false) as Element
    currentRows.forEach(row => fragmentBody.append(row.cloneNode(true)))
    fragment.append(fragmentBody)
    fragments.push(fragment)
    currentRows = []
    currentHeight = 20 + Array.from(table.querySelectorAll(':scope > thead > tr'))
      .reduce((total, row) => total + estimateTableRowHeight(row, textScale), 0)
  }

  rows.forEach(row => {
    const rowHeight = estimateTableRowHeight(row, textScale)
    if (currentRows.length && currentHeight + rowHeight > MAX_TABLE_FRAGMENT_HEIGHT) pushFragment()
    currentRows.push(row)
    currentHeight += rowHeight
  })
  pushFragment()

  const footer = table.querySelector(':scope > tfoot')
  if (footer && fragments.length) fragments.at(-1)?.append(footer.cloneNode(true))
  return fragments
}

function splitPreformatted(pre: Element): Element[] {
  const lines = (pre.textContent || '').split('\n')
  if (lines.length <= PRE_LINES_PER_FRAGMENT) return [pre.cloneNode(true) as Element]
  const code = pre.querySelector(':scope > code')
  const fragments: Element[] = []
  for (let index = 0; index < lines.length; index += PRE_LINES_PER_FRAGMENT) {
    const fragment = pre.cloneNode(false) as Element
    const content = lines.slice(index, index + PRE_LINES_PER_FRAGMENT).join('\n')
    if (code) {
      const fragmentCode = code.cloneNode(false) as Element
      fragmentCode.textContent = content
      fragment.append(fragmentCode)
    } else {
      fragment.textContent = content
    }
    fragments.push(fragment)
  }
  return fragments
}

function splitTextContainer(element: Element, textScale: number, groupId: number): Element[] {
  const children = Array.from(element.children)
  if (!children.length || estimateElementHeight(element, false, textScale) <= MAX_CONTAINER_FRAGMENT_HEIGHT) {
    return [element.cloneNode(true) as Element]
  }

  const childFragments = children.flatMap(child => child.tagName === 'P'
    ? splitLongParagraph(child, textScale)
    : [child.cloneNode(true) as Element])
  const fragments: Element[] = []
  let current: Element[] = []
  let currentHeight = 44

  const pushFragment = () => {
    if (!current.length) return
    const fragment = element.cloneNode(false) as Element
    fragment.setAttribute('data-xhs-fragment-group', `container-${groupId}`)
    current.forEach(child => fragment.append(child))
    fragments.push(fragment)
    current = []
    currentHeight = 44
  }

  childFragments.forEach(child => {
    const childHeight = estimateElementHeight(child, false, textScale)
    if (current.length && currentHeight + childHeight > MAX_CONTAINER_FRAGMENT_HEIGHT) pushFragment()
    current.push(child)
    currentHeight += childHeight
  })
  pushFragment()
  return fragments.length ? fragments : [element.cloneNode(true) as Element]
}

function splitBlock(element: Element, textScale: number, blockIndex: number): Element[] {
  if (element.tagName === 'TABLE') return splitTable(element, textScale)
  if (element.tagName === 'PRE') return splitPreformatted(element)
  if (element.tagName === 'BLOCKQUOTE' || (element.tagName === 'ASIDE' && element.hasAttribute('data-callout'))) {
    return splitTextContainer(element, textScale, blockIndex)
  }
  return splitLongParagraph(element, textScale)
}

function* createChunks(html: string, textScale: number): Generator<void, { chunks: CardChunk[]; document: Document }> {
  const document = parseHtml(html)
  const blocks = Array.from(document.body.children)
  const chunks: CardChunk[] = []

  for (const [blockIndex, block] of blocks.entries()) {
    yield
    if ((block.tagName === 'OL' || block.tagName === 'UL') && block.querySelector(':scope > li')) {
      const tag = block.tagName as ListTag
      const template = block.cloneNode(false) as Element
      const initialOrder = tag === 'OL' ? Number(block.getAttribute('start') || 1) : 1
      const sourceBlock = block.getAttribute('data-source-block')
      Array.from(block.children).filter(child => child.tagName === 'LI').forEach((item, itemIndex) => {
        const itemClone = item.cloneNode(true) as Element
        if (sourceBlock !== null) itemClone.setAttribute('data-source-block', sourceBlock)
        chunks.push({
          element: itemClone,
          estimatedHeight: estimateElementHeight(itemClone, true, textScale),
          isHeading: false,
          hasProtectedContent: containsProtectedContent(itemClone),
          list: { groupId: blockIndex, item: itemClone, order: initialOrder + itemIndex, tag, template },
        })
      })
      continue
    }

    splitBlock(block, textScale, blockIndex).forEach(fragment => {
      chunks.push({
        element: fragment,
        estimatedHeight: estimateElementHeight(fragment, false, textScale),
        isHeading: /^H[1-6]$/.test(fragment.tagName),
        hasProtectedContent: containsProtectedContent(fragment),
      })
    })
  }

  return { chunks, document }
}

function firstPageBodyHeight({ title = '' }: XhsPaginationOptions, contentHeight = CARD_CONTENT_HEIGHT): number {
  const titleHeight = Math.max(54, textLineCount(title || '未命名文章', TITLE_UNITS_PER_LINE) * 36 + 17)
  return Math.max(MIN_FIRST_PAGE_BODY_HEIGHT, contentHeight - titleHeight)
}

function pageHeight(page: CardChunk[]): number {
  let previousListGroup: number | null = null
  let hasPreviousChunk = false
  return page.reduce((total, chunk) => {
    const startsListGroup = chunk.list && chunk.list.groupId !== previousListGroup
    const listMargin = startsListGroup
      ? hasPreviousChunk ? ADJACENT_LIST_GROUP_VERTICAL_MARGIN : LIST_GROUP_VERTICAL_MARGIN
      : 0
    previousListGroup = chunk.list?.groupId ?? null
    hasPreviousChunk = true
    return total + chunk.estimatedHeight + listMargin
  }, 0)
}

function standardPageBudget(index: number, options: XhsPaginationOptions): number {
  const contentHeight = CARD_CONTENT_HEIGHT + (options.showFooter === false ? FOOTER_RECLAIM_HEIGHT : 0)
  return index === 0 ? firstPageBodyHeight(options, contentHeight) : contentHeight
}

function isTextOnlyPage(page: CardChunk[]): boolean {
  return page.every(chunk => !chunk.hasProtectedContent)
}

function textPageBudget(index: number, options: XhsPaginationOptions): number {
  const contentHeight = TEXT_CARD_CONTENT_HEIGHT + (options.showFooter === false ? FOOTER_RECLAIM_HEIGHT : 0)
  return index === 0 ? firstPageBodyHeight(options, contentHeight) : contentHeight
}

function* paginateChunks(
  chunks: CardChunk[],
  options: XhsPaginationOptions,
  document: Document,
  pageFits?: XhsPageFits,
): Generator<void, CardChunk[][]> {
  const pages: CardChunk[][] = []
  let current: CardChunk[] = []

  const fits = (candidate: CardChunk[], pageIndex: number) => pageFits
    ? pageFits(renderPage(candidate, document), pageIndex)
    : pageHeight(candidate) <= standardPageBudget(pageIndex, options)

  for (let index = 0; index < chunks.length; index += 1) {
    yield
    const chunk = chunks[index]
    const linkedChunks = chunk.isHeading && chunks[index + 1] ? [chunk, chunks[index + 1]] : [chunk]
    const wouldOverflowLinkedContent = current.length > 0 && !fits([...current, ...linkedChunks], pages.length)
    const wouldOverflowChunk = current.length > 0 && !fits([...current, chunk], pages.length)
    const currentOnlyContainsHeading = current.length === 1 && current[0].isHeading

    if (wouldOverflowLinkedContent || (wouldOverflowChunk && !currentOnlyContainsHeading)) {
      pages.push(current)
      current = []
    }
    current.push(chunk)
  }

  if (current.length) pages.push(current)
  return pages
}

function* backfillMeasuredPages(
  pages: CardChunk[][],
  document: Document,
  pageFits: XhsPageFits,
): Generator<void> {
  let pageIndex = 0
  while (pageIndex < pages.length - 1) {
    yield
    const current = pages[pageIndex]
    const next = pages[pageIndex + 1]
    const moveCount = leadingContentUnitLength(next)
    const moving = next.slice(0, moveCount)

    if (!pageFits(renderPage([...current, ...moving], document), pageIndex)) {
      pageIndex += 1
      continue
    }

    current.push(...next.splice(0, moveCount))
    if (!next.length) pages.splice(pageIndex + 1, 1)
  }
}

function leadingContentUnitLength(page: CardChunk[]): number {
  if (!page[0]?.isHeading) return 1
  let length = 1
  while (length < page.length && page[length - 1].isHeading) length += 1
  return length
}

function* compactTextPages(pages: CardChunk[][], options: XhsPaginationOptions): Generator<void> {
  let pageIndex = 0
  while (pageIndex < pages.length - 1) {
    yield
    const current = pages[pageIndex]
    const next = pages[pageIndex + 1]
    if (!isTextOnlyPage(current)
      || !isTextOnlyPage(next)) {
      pageIndex += 1
      continue
    }

    const moveCount = leadingContentUnitLength(next)
    const moving = next.slice(0, moveCount)
    if (pageHeight([...current, ...moving]) > textPageBudget(pageIndex, options)) {
      pageIndex += 1
      continue
    }

    current.push(...next.splice(0, moveCount))
    if (!next.length) pages.splice(pageIndex + 1, 1)
  }
}

function renderPage(chunks: CardChunk[], document: Document): string {
  const container = document.createElement('div')
  let index = 0

  while (index < chunks.length) {
    const chunk = chunks[index]
    if (!chunk.list) {
      const fragmentGroup = chunk.element.getAttribute('data-xhs-fragment-group')
      if (fragmentGroup) {
        const merged = chunk.element.cloneNode(false) as Element
        let fragmentIndex = index
        while (fragmentIndex < chunks.length
          && chunks[fragmentIndex].element.getAttribute('data-xhs-fragment-group') === fragmentGroup) {
          Array.from(chunks[fragmentIndex].element.childNodes).forEach(child => merged.append(child.cloneNode(true)))
          fragmentIndex += 1
        }
        merged.removeAttribute('data-xhs-fragment-group')
        container.append(merged)
        index = fragmentIndex
        continue
      }
      container.append(chunk.element.cloneNode(true))
      index += 1
      continue
    }

    const list = chunk.list.template.cloneNode(false) as Element
    if (chunk.list.tag === 'OL') list.setAttribute('start', String(chunk.list.order))
    let listIndex = index
    while (listIndex < chunks.length && chunks[listIndex].list?.groupId === chunk.list.groupId) {
      list.append(chunks[listIndex].list!.item.cloneNode(true))
      listIndex += 1
    }
    container.append(list)
    index = listIndex
  }

  return container.innerHTML
}

function* paginationSteps(
  html: string,
  options: XhsPaginationOptions = {},
  pageFits?: XhsPageFits,
): Generator<void, string[]> {
  const textScale = Number.isFinite(options.textScale) ? Math.min(1.35, Math.max(0.75, options.textScale!)) : 1
  const { chunks, document } = yield* createChunks(html, textScale)
  if (!chunks.length) return ['<p>暂无正文内容</p>']

  const pages = yield* paginateChunks(chunks, options, document, pageFits)
  if (pageFits) yield* backfillMeasuredPages(pages, document, pageFits)
  else yield* compactTextPages(pages, options)
  const rendered: string[] = []
  for (const page of pages) { yield; rendered.push(renderPage(page, document)) }
  return rendered
}

// Both entry points consume exactly the same algorithm, preserving page boundaries.
export function paginateForXhsCards(html: string, options: XhsPaginationOptions = {}, pageFits?: XhsPageFits): string[] {
  const steps = paginationSteps(html, options, pageFits)
  let result = steps.next()
  while (!result.done) result = steps.next()
  return result.value
}

export async function paginateForXhsCardsAsync(
  html: string,
  options: XhsPaginationOptions = {},
  pageFits?: XhsPageFits,
  signal?: AbortSignal,
): Promise<string[]> {
  const steps = paginationSteps(html, options, pageFits)
  let deadline = performance.now() + 8
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('分页已取消', 'AbortError')
      const result = steps.next()
      if (result.done) return result.value
      if (performance.now() >= deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        deadline = performance.now() + 8
      }
    }
  } finally {
    steps.return([])
  }
}
