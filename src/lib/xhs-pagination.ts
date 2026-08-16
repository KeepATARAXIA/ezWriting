export interface XhsPaginationOptions {
  title?: string
  hasCover?: boolean
  textScale?: number
}

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
const CARD_CONTENT_HEIGHT = 610
const TEXT_CARD_CONTENT_HEIGHT = 628
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

function renderedImageHeight(image: Element): number {
  const dimensions = imageDimensions(image)
  if (!dimensions) return IMAGE_MAX_HEIGHT
  const scale = Math.min(1, CARD_CONTENT_WIDTH / dimensions.width)
  return Math.min(IMAGE_MAX_HEIGHT, dimensions.height * scale)
}

function imagesHeight(element: Element): number {
  const images = [
    ...(element.matches('img') ? [element] : []),
    ...Array.from(element.querySelectorAll('img')),
  ]
  return images.reduce((total, image) => total + renderedImageHeight(image) + IMAGE_VERTICAL_MARGIN, 0)
}

function estimateElementHeight(element: Element, listItem = false, textScale = 1): number {
  if (element.hasAttribute('data-source-spacer')) return SOURCE_SPACER_HEIGHT * textScale
  const text = element.textContent?.trim() || ''
  const embeddedImagesHeight = imagesHeight(element)

  if (element.tagName === 'IMG') return embeddedImagesHeight
  if (element.tagName === 'TABLE') return Math.max(80, element.querySelectorAll('tr').length * 34 + 20) * textScale + embeddedImagesHeight
  if (element.tagName === 'PRE') return (textLineCount(text, 34) * 21 + 34) * textScale + embeddedImagesHeight
  if (/^H[1-6]$/.test(element.tagName)) return (textLineCount(text, HEADING_UNITS_PER_LINE) * HEADING_LINE_HEIGHT + 35) * textScale + embeddedImagesHeight
  if (element.tagName === 'BLOCKQUOTE') return (textLineCount(text, CALLOUT_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 56) * textScale + embeddedImagesHeight
  if (element.tagName === 'ASIDE' && element.hasAttribute('data-callout')) return (textLineCount(text, CALLOUT_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 58) * textScale + embeddedImagesHeight
  if (listItem || element.tagName === 'LI') return textLineCount(text, LIST_UNITS_PER_LINE) * BODY_LINE_HEIGHT * textScale + embeddedImagesHeight
  if (element.tagName === 'P') return (text ? textLineCount(text, PARAGRAPH_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 14 : 14) * textScale + embeddedImagesHeight
  return (textLineCount(text, PARAGRAPH_UNITS_PER_LINE) * BODY_LINE_HEIGHT + 14) * textScale + embeddedImagesHeight
}

function containsProtectedContent(element: Element): boolean {
  return element.matches('img, table, pre') || Boolean(element.querySelector('img, table, pre'))
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
  if (element.tagName !== 'P' || estimateElementHeight(element, false, textScale) <= MAX_TEXT_FRAGMENT_HEIGHT) {
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

function createChunks(html: string, textScale: number): { chunks: CardChunk[]; document: Document } {
  const document = parseHtml(html)
  const blocks = Array.from(document.body.children)
  const chunks: CardChunk[] = []

  blocks.forEach((block, blockIndex) => {
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
      return
    }

    splitLongParagraph(block, textScale).forEach(fragment => {
      chunks.push({
        element: fragment,
        estimatedHeight: estimateElementHeight(fragment, false, textScale),
        isHeading: /^H[1-6]$/.test(fragment.tagName),
        hasProtectedContent: containsProtectedContent(fragment),
      })
    })
  })

  return { chunks, document }
}

function firstPageBodyHeight({ title = '', hasCover = false }: XhsPaginationOptions, contentHeight = CARD_CONTENT_HEIGHT): number {
  const titleHeight = Math.max(54, textLineCount(title || '未命名文章', TITLE_UNITS_PER_LINE) * 36 + 17)
  const coverHeight = hasCover ? 200 : 0
  return Math.max(MIN_FIRST_PAGE_BODY_HEIGHT, contentHeight - titleHeight - coverHeight)
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
  return index === 0 ? firstPageBodyHeight(options) : CARD_CONTENT_HEIGHT
}

function isTextOnlyPage(page: CardChunk[], index: number, options: XhsPaginationOptions): boolean {
  return !(index === 0 && options.hasCover) && page.every(chunk => !chunk.hasProtectedContent)
}

function textPageBudget(index: number, options: XhsPaginationOptions): number {
  return index === 0 ? firstPageBodyHeight(options, TEXT_CARD_CONTENT_HEIGHT) : TEXT_CARD_CONTENT_HEIGHT
}

function paginateChunks(chunks: CardChunk[], options: XhsPaginationOptions): CardChunk[][] {
  const pages: CardChunk[][] = []
  let current: CardChunk[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const budget = standardPageBudget(pages.length, options)
    const linkedChunks = chunk.isHeading && chunks[index + 1] ? [chunk, chunks[index + 1]] : [chunk]
    const wouldOverflowLinkedContent = current.length > 0 && pageHeight([...current, ...linkedChunks]) > budget
    const wouldOverflowChunk = current.length > 0 && pageHeight([...current, chunk]) > budget
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

function leadingContentUnitLength(page: CardChunk[]): number {
  if (!page[0]?.isHeading) return 1
  let length = 1
  while (length < page.length && page[length - 1].isHeading) length += 1
  return length
}

function compactTextPages(pages: CardChunk[][], options: XhsPaginationOptions): void {
  let pageIndex = 0
  while (pageIndex < pages.length - 1) {
    const current = pages[pageIndex]
    const next = pages[pageIndex + 1]
    if (!isTextOnlyPage(current, pageIndex, options)
      || !isTextOnlyPage(next, pageIndex + 1, options)) {
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

export function paginateForXhsCards(html: string, options: XhsPaginationOptions = {}): string[] {
  const textScale = Number.isFinite(options.textScale) ? Math.min(1.35, Math.max(0.75, options.textScale!)) : 1
  const { chunks, document } = createChunks(html, textScale)
  if (!chunks.length) return ['<p>暂无正文内容</p>']

  const pages = paginateChunks(chunks, options)
  compactTextPages(pages, options)
  return pages.map(page => renderPage(page, document))
}
