import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { basicSetup } from 'codemirror'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { Annotation, Compartment, EditorState, Facet, Prec, StateField, Transaction } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  placeholder,
  type DecorationSet,
} from '@codemirror/view'
import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table2,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import type { ArticleSourceLanguage } from '../domain/article'
import { sourceBlockIndexAtOffset } from '../lib/article-source'

export interface SourceEditorFocusRequest {
  line: number
  requestId: number
}

export interface SourceEditorActiveLocation {
  blockIndex: number
  line: number
}

interface SourceEditorProps {
  value: string
  language: ArticleSourceLanguage
  focusRequest?: SourceEditorFocusRequest | null
  readOnly?: boolean
  onChange: (value: string) => void
  onActiveBlockChange?: (location: SourceEditorActiveLocation | null) => void
}

interface ToolButtonProps {
  label: string
  children: ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  preserveSelection?: boolean
  shortcut?: string
}

function ToolButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  preserveSelection = false,
  shortcut,
}: ToolButtonProps) {
  const handleMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (preserveSelection) event.preventDefault()
  }
  return (
    <button
      type="button"
      className={`source-tool${active ? ' active' : ''}`}
      aria-label={label}
      aria-pressed={active || undefined}
      title={shortcut ? `${label} · ${shortcut}` : label}
      disabled={disabled}
      onMouseDown={handleMouseDown}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

const MARKDOWN_IMAGE_SOURCE = /!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'))?\s*\)/g
const MARKDOWN_LINK_SOURCE = /(?<!!)\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^"'\n]*["'])?\s*\)/g
const EMBEDDED_IMAGE_TOKEN = /dispatch-editor-image:\/\/[a-z0-9-]+/gi
const EMBEDDED_IMAGE_PREFIX = 'dispatch-editor-image://image-'
const controlledValueUpdate = Annotation.define<boolean>()
const externalFocusUpdate = Annotation.define<boolean>()
const SOURCE_CHANGE_DEBOUNCE_MS = 240
const IMAGE_SOURCE_CHANGE_DEBOUNCE_MS = 320
const sourceLanguageFacet = Facet.define<ArticleSourceLanguage, ArticleSourceLanguage>({
  combine: values => values[0] ?? 'markdown',
})

function markdownLinkDecorations(state: EditorState): DecorationSet {
  if (state.facet(sourceLanguageFacet) === 'html') return Decoration.none
  const ranges = Array.from(state.doc.toString().matchAll(MARKDOWN_LINK_SOURCE)).flatMap(match => {
    if (!safeExternalUrl(match[2] || match[3] || '')) return []
    return [Decoration.mark({
      class: 'cm-editor-direct-link',
      attributes: { title: 'Ctrl / Command + 点击打开链接' },
    }).range(match.index, match.index + match[0].length)]
  })
  return Decoration.set(ranges, true)
}

const markdownLinkField = StateField.define<DecorationSet>({
  create: markdownLinkDecorations,
  update: (decorations, transaction) => transaction.docChanged
    || transaction.startState.facet(sourceLanguageFacet) !== transaction.state.facet(sourceLanguageFacet)
    ? markdownLinkDecorations(transaction.state)
    : decorations.map(transaction.changes),
  provide: field => EditorView.decorations.from(field),
})

interface EmbeddedImageContext {
  sources: Map<string, string>
}

const embeddedImageFacet = Facet.define<EmbeddedImageContext, EmbeddedImageContext>({
  combine: values => values[0] ?? { sources: new Map() },
})

function addEmbeddedImage(sources: Map<string, string>, source: string): string {
  for (const [token, value] of sources) {
    if (value === source) return token
  }
  let index = sources.size
  let token = `${EMBEDDED_IMAGE_PREFIX}${index}`
  while (sources.has(token)) {
    index += 1
    token = `${EMBEDDED_IMAGE_PREFIX}${index}`
  }
  sources.set(token, source)
  return token
}

function compactEmbeddedImages(text: string, previous: Map<string, string>): { text: string; sources: Map<string, string> } {
  const workingSources = new Map(previous)
  const usedTokens = new Set<string>()
  const previousTokens = new Map(Array.from(previous, ([token, source]) => [source, token]))
  const compacted = text.replace(MARKDOWN_IMAGE_SOURCE, (syntax, _alt: string, angleSource: string, plainSource: string) => {
    const source = angleSource || plainSource || ''
    if (!/^data:image\//i.test(source)) return syntax
    const token = previousTokens.get(source) ?? addEmbeddedImage(workingSources, source)
    workingSources.set(token, source)
    usedTokens.add(token)
    return syntax.replace(source, token)
  })
  const nextSources = new Map(Array.from(workingSources).filter(([token]) => usedTokens.has(token)))
  const sources = nextSources.size === previous.size
    && Array.from(nextSources).every(([token, source]) => previous.get(token) === source)
    ? previous
    : nextSources
  return { text: compacted, sources }
}

function expandEmbeddedImages(text: string, sources: Map<string, string>): string {
  return text.replace(EMBEDDED_IMAGE_TOKEN, token => sources.get(token) ?? token)
}

function minimalTextChange(current: string, next: string): { from: number; to: number; insert: string } | null {
  if (current === next) return null
  let from = 0
  const sharedLength = Math.min(current.length, next.length)
  while (from < sharedLength && current.charCodeAt(from) === next.charCodeAt(from)) from += 1

  let currentTo = current.length
  let nextTo = next.length
  while (
    currentTo > from
    && nextTo > from
    && current.charCodeAt(currentTo - 1) === next.charCodeAt(nextTo - 1)
  ) {
    currentTo -= 1
    nextTo -= 1
  }

  return { from, to: currentTo, insert: next.slice(from, nextTo) }
}

function imageLabel(alt: string, source: string): string {
  if (alt.trim()) return alt.trim()
  if (/^(?:data:image\/|dispatch-editor-image:\/\/)/i.test(source)) return '本地图片'
  const fileName = source.replace(/[?#].*$/, '').replaceAll('\\', '/').split('/').pop()
  try {
    return fileName ? decodeURIComponent(fileName) : '图片'
  } catch {
    return fileName || '图片'
  }
}

function decodeMarkdownImageCaption(value: string): string {
  return value.replace(/\\([\\"'])/g, '$1')
}

function markdownImageSyntax(alt: string, source: string, caption: string): string {
  const safeAlt = alt.replaceAll(']', '\\]')
  const formattedSource = /[\s)]/.test(source) ? `<${source}>` : source
  const normalizedCaption = caption.trim()
  const title = normalizedCaption
    ? ` "${normalizedCaption.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
    : ''
  return `![${safeAlt}](${formattedSource}${title})`
}

function canPreviewImage(source: string): boolean {
  return /^(?:data:image\/|blob:|https?:\/\/)/i.test(source)
}

class MarkdownImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly previewSource: string,
    readonly alt: string,
    readonly caption: string,
    readonly syntax: string,
    readonly block: boolean,
    readonly imageSources: Map<string, string>,
  ) {
    super()
  }

  eq(other: MarkdownImageWidget): boolean {
    return this.source === other.source
      && this.previewSource === other.previewSource
      && this.alt === other.alt
      && this.caption === other.caption
      && this.syntax === other.syntax
      && this.block === other.block
      && this.imageSources === other.imageSources
  }

  toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement('figure')
    figure.className = `source-image-widget ${this.block ? 'block' : 'inline'}`
    figure.setAttribute('aria-label', `图片：${imageLabel(this.alt, this.source)}`)
    figure.tabIndex = 0

    const media = document.createElement('div')
    media.className = 'source-image-media'
    if (canPreviewImage(this.previewSource)) {
      const image = document.createElement('img')
      image.src = this.previewSource
      image.alt = this.alt
      image.loading = 'lazy'
      image.decoding = 'async'
      image.fetchPriority = 'low'
      image.addEventListener('load', () => view.requestMeasure(), { once: true })
      image.addEventListener('error', () => {
        figure.classList.add('missing')
        media.replaceChildren(Object.assign(document.createElement('span'), { textContent: '图片无法显示' }))
        view.requestMeasure()
      }, { once: true })
      media.append(image)
    } else {
      figure.classList.add('missing')
      media.append(Object.assign(document.createElement('span'), { textContent: '图片待补齐' }))
    }

    const footer = document.createElement('figcaption')
    const accessibleLabel = imageLabel(this.alt, this.source)
    const actions = document.createElement('span')
    actions.className = 'source-image-actions'
    const replaceButton = document.createElement('button')
    replaceButton.type = 'button'
    replaceButton.textContent = '替换'
    replaceButton.setAttribute('aria-label', `替换图片 ${accessibleLabel}`)
    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.textContent = '删除'
    deleteButton.className = 'delete'
    deleteButton.setAttribute('aria-label', `删除图片 ${accessibleLabel}`)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.hidden = true

    const addCaptionButton = document.createElement('button')
    addCaptionButton.type = 'button'
    addCaptionButton.textContent = '添加说明'
    addCaptionButton.className = 'source-image-caption-add'
    addCaptionButton.setAttribute('aria-label', '添加图片说明')

    const currentRange = () => {
      let position: number
      try {
        position = view.posAtDOM(figure)
      } catch {
        return null
      }
      const direct = view.state.doc.sliceString(position, Math.min(view.state.doc.length, position + this.syntax.length))
      if (direct === this.syntax) return { from: position, to: position + this.syntax.length }
      const searchFrom = Math.max(0, position - this.syntax.length)
      const searchTo = Math.min(view.state.doc.length, position + this.syntax.length * 2)
      const nearby = view.state.doc.sliceString(searchFrom, searchTo)
      const relative = nearby.indexOf(this.syntax)
      return relative >= 0
        ? { from: searchFrom + relative, to: searchFrom + relative + this.syntax.length }
        : null
    }

    replaceButton.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      if (view.state.readOnly) return
      input.click()
    })
    deleteButton.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      if (view.state.readOnly) return
      const range = currentRange()
      if (!range) return
      view.dispatch({ changes: { from: range.from, to: range.to, insert: '' }, selection: { anchor: range.from } })
      view.focus()
    })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file || view.state.readOnly) return
      void readFileAsDataUrl(file).then(source => {
        const range = currentRange()
        if (!range) return
        const alt = file.name.replace(/\.[^.]+$/, '') || this.alt || '图片'
        const token = addEmbeddedImage(this.imageSources, source)
        view.dispatch({
          changes: { from: range.from, to: range.to, insert: markdownImageSyntax(alt, token, this.caption) },
          selection: { anchor: range.from },
        })
        view.focus()
      })
    })
    const showCaptionInput = (focus = true) => {
      if (footer.querySelector('.source-image-caption-input')) return
      const captionInput = document.createElement('input')
      captionInput.type = 'text'
      captionInput.className = 'source-image-caption-input'
      captionInput.placeholder = '图片说明（可选）'
      captionInput.setAttribute('aria-label', '图片说明')
      captionInput.value = this.caption
      let cancelled = false
      const commit = () => {
        if (cancelled || view.state.readOnly) return
        const range = currentRange()
        if (!range) return
        const nextCaption = captionInput.value.trim()
        if (nextCaption === this.caption) return
        view.dispatch({
          changes: { from: range.from, to: range.to, insert: markdownImageSyntax(this.alt, this.source, nextCaption) },
          selection: { anchor: range.from },
        })
      }
      captionInput.addEventListener('click', event => event.stopPropagation())
      captionInput.addEventListener('keydown', event => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelled = true
          if (this.caption) captionInput.value = this.caption
          else captionInput.remove()
          view.focus()
        }
      })
      captionInput.addEventListener('blur', commit)
      footer.append(captionInput)
      addCaptionButton.remove()
      if (focus) captionInput.focus()
    }
    addCaptionButton.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      if (!view.state.readOnly) showCaptionInput()
    })
    figure.addEventListener('click', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return
      view.dom.querySelectorAll('.source-image-widget.selected').forEach(widget => widget.classList.remove('selected'))
      figure.classList.add('selected')
      const range = currentRange()
      if (range) view.dispatch({ selection: { anchor: range.to } })
      view.focus()
    })

    actions.append(replaceButton, deleteButton)
    footer.append(actions, input)
    if (this.caption) showCaptionInput(false)
    else footer.append(addCaptionButton)
    figure.append(media, footer)
    return figure
  }

  ignoreEvent(): boolean {
    return true
  }
}

function imagePreviewDecorations(state: EditorState): DecorationSet {
  const ranges = []
  const text = state.doc.toString()
  const imageSources = state.facet(embeddedImageFacet).sources
  for (const match of text.matchAll(MARKDOWN_IMAGE_SOURCE)) {
    if (match.index === undefined) continue
    const syntaxFrom = match.index
    const syntaxTo = syntaxFrom + match[0].length
    const line = state.doc.lineAt(syntaxFrom)
    const block = state.doc.sliceString(line.from, line.to).trim() === match[0]
    const source = match[2] || match[3] || ''
    const caption = decodeMarkdownImageCaption(match[4] ?? match[5] ?? '')
    ranges.push(Decoration.replace({
      widget: new MarkdownImageWidget(source, imageSources.get(source) ?? source, match[1], caption, match[0], block, imageSources),
    }).range(syntaxFrom, syntaxTo))
  }
  return Decoration.set(ranges, true)
}

const imagePreviewField = StateField.define<DecorationSet>({
  create: imagePreviewDecorations,
  update: (decorations, transaction) => {
    if (transaction.startState.facet(embeddedImageFacet) !== transaction.state.facet(embeddedImageFacet)) {
      return imagePreviewDecorations(transaction.state)
    }
    if (!transaction.docChanged) return decorations
    return imageSyntaxChanged(decorations, transaction)
      ? imagePreviewDecorations(transaction.state)
      : decorations.map(transaction.changes)
  },
  provide: field => EditorView.decorations.from(field),
})

function imageSyntaxChanged(decorations: DecorationSet, transaction: Transaction): boolean {
  let changed = false
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    decorations.between(Math.max(0, fromA - 1), Math.min(transaction.startState.doc.length, toA + 1), () => {
      changed = true
    })
    if (changed) return
    const removed = transaction.startState.doc.sliceString(Math.max(0, fromA - 1), Math.min(transaction.startState.doc.length, toA + 1))
    if (/[!\[\]()]/.test(`${removed}${inserted.toString()}`)) changed = true
  })
  return changed
}

interface SelectionMenuState {
  from: number
  to: number
  left: number
  top: number
  placement: 'above' | 'below'
}

function clearMarkdownFormatting(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(?:[-+*]|\d+\.)\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|~~|==|`)([^\n]+?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1$2')
}

function clearHtmlFormatting(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function markdownLinkAtOffset(text: string, offset: number): string | null {
  for (const match of text.matchAll(MARKDOWN_LINK_SOURCE)) {
    const from = match.index
    const to = from + match[0].length
    if (offset < from || offset > to) continue
    return safeExternalUrl(match[2] || match[3] || '')
  }
  return null
}

export function SourceEditor({ value, language, focusRequest, readOnly = false, onChange, onActiveBlockChange }: SourceEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const languageCompartmentRef = useRef(new Compartment())
  const imageSourceCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())
  const embeddedImagesRef = useRef(new Map<string, string>())
  const languageRef = useRef(language)
  const onChangeRef = useRef(onChange)
  const onActiveBlockChangeRef = useRef(onActiveBlockChange)
  const readOnlyRef = useRef(readOnly)
  const lastFocusRequestRef = useRef(0)
  const changeTimerRef = useRef<number | null>(null)
  const compositionEndTimerRef = useRef<number | null>(null)
  const compositionActiveRef = useRef(false)
  const activeBlockTimerRef = useRef<number | null>(null)
  const pendingLocalEchoesRef = useRef<string[]>([])
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null)
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false })

  languageRef.current = language
  onChangeRef.current = onChange
  onActiveBlockChangeRef.current = onActiveBlockChange
  readOnlyRef.current = readOnly

  const reportActiveBlock = (view: EditorView) => {
    const head = view.state.selection.main.head
    const blockIndex = sourceBlockIndexAtOffset(view.state.doc.toString(), languageRef.current, head)
    onActiveBlockChangeRef.current?.(blockIndex === null
      ? null
      : { blockIndex, line: view.state.doc.lineAt(head).number })
  }

  const scheduleActiveBlock = (view: EditorView, immediate = false) => {
    if (activeBlockTimerRef.current !== null) window.clearTimeout(activeBlockTimerRef.current)
    if (immediate) {
      activeBlockTimerRef.current = null
      reportActiveBlock(view)
      return
    }
    activeBlockTimerRef.current = window.setTimeout(() => {
      activeBlockTimerRef.current = null
      reportActiveBlock(view)
    }, 60)
  }

  const updateEditorUi = (view: EditorView) => {
    const nextHistoryAvailability = {
      canUndo: undoDepth(view.state) > 0,
      canRedo: redoDepth(view.state) > 0,
    }
    setHistoryAvailability(current => current.canUndo === nextHistoryAvailability.canUndo
      && current.canRedo === nextHistoryAvailability.canRedo
      ? current
      : nextHistoryAvailability)

    const { from, to, empty } = view.state.selection.main
    const selectedText = empty ? '' : view.state.sliceDoc(from, to)
    if (empty || !selectedText.trim() || /dispatch-editor-image:\/\//i.test(selectedText)) {
      setSelectionMenu(null)
      return
    }

    const editorRect = view.dom.getBoundingClientRect()
    const selectionCoords = view.coordsAtPos(to)
    const rawLeft = selectionCoords?.left ?? editorRect.left + editorRect.width / 2
    const selectionTop = selectionCoords?.top ?? editorRect.top + 44
    const selectionBottom = selectionCoords?.bottom ?? selectionTop + 20
    const placement = selectionTop > 76 ? 'above' : 'below'
    const left = Math.min(Math.max(rawLeft, 180), Math.max(180, window.innerWidth - 180))
    const top = placement === 'above' ? selectionTop - 10 : selectionBottom + 10
    setSelectionMenu(current => current
      && current.from === from
      && current.to === to
      && current.left === left
      && current.top === top
      && current.placement === placement
      ? current
      : { from, to, left, top, placement })
  }

  const emitSourceChange = (view: EditorView) => {
    if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current)
    changeTimerRef.current = null
    if (compositionActiveRef.current || view.compositionStarted) return
    const compactedText = view.state.doc.toString()
    const pendingEchoes = pendingLocalEchoesRef.current
    if (pendingEchoes.at(-1) !== compactedText) pendingEchoes.push(compactedText)
    if (pendingEchoes.length > 20) pendingEchoes.splice(0, pendingEchoes.length - 20)
    onChangeRef.current(expandEmbeddedImages(compactedText, embeddedImagesRef.current))
  }

  const scheduleSourceChange = (view: EditorView) => {
    if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current)
    const debounceMs = embeddedImagesRef.current.size > 0
      ? IMAGE_SOURCE_CHANGE_DEBOUNCE_MS
      : SOURCE_CHANGE_DEBOUNCE_MS
    changeTimerRef.current = window.setTimeout(() => emitSourceChange(view), debounceMs)
  }

  const captureOuterScroll = (view: EditorView) => {
    const elements: Array<{ element: HTMLElement; left: number; top: number }> = []
    let parent = view.dom.parentElement
    while (parent) {
      if (parent !== view.scrollDOM && (parent.scrollTop !== 0 || parent.scrollLeft !== 0)) {
        elements.push({ element: parent, left: parent.scrollLeft, top: parent.scrollTop })
      }
      parent = parent.parentElement
    }
    return {
      elements,
      windowLeft: window.scrollX,
      windowTop: window.scrollY,
    }
  }

  const restoreOuterScroll = (snapshot: ReturnType<typeof captureOuterScroll>) => {
    snapshot.elements.forEach(({ element, left, top }) => {
      if (element.scrollLeft !== left) element.scrollLeft = left
      if (element.scrollTop !== top) element.scrollTop = top
    })
    if ((window.scrollX !== snapshot.windowLeft || window.scrollY !== snapshot.windowTop) && typeof window.scrollTo === 'function') {
      window.scrollTo(snapshot.windowLeft, snapshot.windowTop)
    }
  }

  const runStableHistoryCommand = (command: typeof undo) => {
    if (readOnlyRef.current) return false
    const view = viewRef.current
    if (!view) return false
    const snapshot = captureOuterScroll(view)
    const handled = command(view)
    if (!handled) return false

    restoreOuterScroll(snapshot)
    window.requestAnimationFrame(() => {
      restoreOuterScroll(snapshot)
      window.requestAnimationFrame(() => restoreOuterScroll(snapshot))
    })
    return true
  }

  const focusEditorWithoutPageScroll = (view: EditorView) => {
    view.contentDOM.focus({ preventScroll: true })
  }

  const insertText = (text: string, selectFrom = text.length, selectTo = selectFrom) => {
    if (readOnlyRef.current) return
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + selectFrom, head: from + selectTo },
      scrollIntoView: true,
    })
    view.focus()
  }

  const undoChange = () => {
    const view = viewRef.current
    if (view && runStableHistoryCommand(undo)) focusEditorWithoutPageScroll(view)
  }

  const redoChange = () => {
    const view = viewRef.current
    if (view && runStableHistoryCommand(redo)) focusEditorWithoutPageScroll(view)
  }

  const wrapSelection = (markdownBefore: string, markdownAfter: string, placeholderText: string, htmlTag: string) => {
    if (readOnlyRef.current) return
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const selected = view.state.sliceDoc(from, to) || placeholderText
    const before = languageRef.current === 'markdown' ? markdownBefore : `<${htmlTag}>`
    const after = languageRef.current === 'markdown' ? markdownAfter : `</${htmlTag}>`

    if (selected.startsWith(before) && selected.endsWith(after) && selected.length > before.length + after.length) {
      const unwrapped = selected.slice(before.length, -after.length)
      view.dispatch({
        changes: { from, to, insert: unwrapped },
        selection: { anchor: from, head: from + unwrapped.length },
        scrollIntoView: true,
      })
      view.focus()
      return
    }

    const beforeSelection = view.state.sliceDoc(Math.max(0, from - before.length), from)
    const afterSelection = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + after.length))
    const italicInsideBold = markdownBefore === '*'
      && view.state.sliceDoc(Math.max(0, from - 2), from) === '**'
      && view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2)) === '**'
    if (!italicInsideBold && beforeSelection === before && afterSelection === after) {
      view.dispatch({
        changes: [
          { from: from - before.length, to: from },
          { from: to, to: to + after.length },
        ],
        selection: { anchor: from - before.length, head: to - before.length },
        scrollIntoView: true,
      })
      view.focus()
      return
    }

    const insert = `${before}${selected}${after}`
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
      scrollIntoView: true,
    })
    view.focus()
  }

  const selectionHasWrapper = (markdownBefore: string, markdownAfter: string, htmlTag: string) => {
    const view = viewRef.current
    if (!view || view.state.selection.main.empty) return false
    const { from, to } = view.state.selection.main
    const before = languageRef.current === 'markdown' ? markdownBefore : `<${htmlTag}>`
    const after = languageRef.current === 'markdown' ? markdownAfter : `</${htmlTag}>`
    const selected = view.state.sliceDoc(from, to)
    if (selected.startsWith(before) && selected.endsWith(after)) return true
    return view.state.sliceDoc(Math.max(0, from - before.length), from) === before
      && view.state.sliceDoc(to, Math.min(view.state.doc.length, to + after.length)) === after
  }

  const transformSelectedLines = (transform: (line: string, index: number, allLines: string[]) => string) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const end = to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to
    const firstLine = view.state.doc.lineAt(from).number
    const lastLine = view.state.doc.lineAt(Math.max(from, end)).number
    const lines: string[] = []
    for (let number = firstLine; number <= lastLine; number += 1) {
      lines.push(view.state.doc.line(number).text)
    }
    const changes = lines.map((line, index) => {
      const sourceLine = view.state.doc.line(firstLine + index)
      return { from: sourceLine.from, to: sourceLine.to, insert: transform(line, index, lines) }
    })
    view.dispatch({ changes, scrollIntoView: true })
    view.focus()
  }

  const prefixSelectedLines = (prefix: (index: number) => string) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const end = to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to
    const firstLine = view.state.doc.lineAt(from).number
    const lastLine = view.state.doc.lineAt(Math.max(from, end)).number
    const changes = []
    for (let number = firstLine; number <= lastLine; number += 1) {
      changes.push({ from: view.state.doc.line(number).from, insert: prefix(number - firstLine) })
    }
    view.dispatch({ changes, scrollIntoView: true })
    view.focus()
  }

  const insertHeading = (level: 2 | 3) => {
    if (readOnlyRef.current) return
    if (languageRef.current === 'html') {
      wrapSelection('', '', '小标题', `h${level}`)
      return
    }
    const prefix = `${'#'.repeat(level)} `
    transformSelectedLines(line => {
      const text = line.replace(/^#{1,6}\s+/, '')
      return line.startsWith(prefix) ? text : `${prefix}${text}`
    })
  }

  const setParagraph = () => {
    if (readOnlyRef.current) return
    if (languageRef.current === 'html') return
    transformSelectedLines(line => line.replace(/^#{1,6}\s+/, ''))
  }

  const insertQuote = () => {
    if (readOnlyRef.current) return
    if (languageRef.current === 'html') wrapSelection('', '', '引用内容', 'blockquote')
    else transformSelectedLines((line, _index, lines) => {
      const allQuoted = lines.filter(Boolean).every(current => /^>\s?/.test(current))
      return allQuoted ? line.replace(/^>\s?/, '') : `> ${line}`
    })
  }

  const insertList = (ordered: boolean) => {
    if (readOnlyRef.current) return
    if (languageRef.current === 'html') {
      insertText(ordered ? '<ol>\n  <li>列表项</li>\n</ol>' : '<ul>\n  <li>列表项</li>\n</ul>')
      return
    }
    prefixSelectedLines(index => ordered ? `${index + 1}. ` : '- ')
  }

  const insertCodeBlock = () => {
    if (readOnlyRef.current) return
    if (languageRef.current === 'html') insertText('<pre><code>代码</code></pre>', 11, 13)
    else insertText('```text\n代码\n```', 8, 10)
  }

  const insertLink = () => {
    if (readOnlyRef.current) return
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const selected = view.state.sliceDoc(from, to) || '链接文字'
    const before = languageRef.current === 'html' ? '<a href="' : '['
    const middle = languageRef.current === 'html' ? '">' : ']('
    const after = languageRef.current === 'html' ? '</a>' : ')'
    const insert = `${before}https://${middle}${selected}${after}`
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + before.length, head: from + before.length + 'https://'.length },
      scrollIntoView: true,
    })
    view.focus()
  }

  const clearSelectedFormatting = () => {
    if (readOnlyRef.current) return
    const view = viewRef.current
    if (!view || view.state.selection.main.empty) return
    const { from, to } = view.state.selection.main
    const selected = view.state.sliceDoc(from, to)
    const cleared = languageRef.current === 'markdown'
      ? clearMarkdownFormatting(selected)
      : clearHtmlFormatting(selected)
    view.dispatch({
      changes: { from, to, insert: cleared },
      selection: { anchor: from, head: from + cleared.length },
      scrollIntoView: true,
    })
    view.focus()
  }

  const insertTable = () => {
    if (readOnlyRef.current) return
    if (languageRef.current === 'html') insertText('<table>\n  <thead><tr><th>列 1</th><th>列 2</th></tr></thead>\n  <tbody><tr><td>内容</td><td>内容</td></tr></tbody>\n</table>')
    else insertText('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |')
  }

  const insertWarning = () => {
    if (readOnlyRef.current) return
    if (languageRef.current === 'html') insertText('<blockquote><strong>警告标题</strong><p>在这里填写内容</p></blockquote>')
    else insertText('> [!warning] 警告标题\n> 在这里填写内容', 13, 17)
  }

  const insertImageFile = async (file: File) => {
    if (readOnlyRef.current) return
    const source = await readFileAsDataUrl(file)
    const alt = file.name.replace(/\.[^.]+$/, '') || '图片'
    const token = addEmbeddedImage(embeddedImagesRef.current, source)
    if (languageRef.current === 'html') insertText(`<img src="${token}" alt="${alt}">`)
    else insertText(`![${alt}](${token})`)
  }

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void insertImageFile(file)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const languageCompartment = languageCompartmentRef.current
    const imageSourceCompartment = imageSourceCompartmentRef.current
    const readOnlyCompartment = readOnlyCompartmentRef.current
    const compacted = compactEmbeddedImages(value, embeddedImagesRef.current)
    embeddedImagesRef.current = compacted.sources
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: compacted.text,
        extensions: [
          basicSetup,
          imageSourceCompartment.of(embeddedImageFacet.of({ sources: compacted.sources })),
          imagePreviewField,
          markdownLinkField,
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          EditorView.atomicRanges.of(view => view.state.field(imagePreviewField)),
          languageCompartment.of([
            sourceLanguageFacet.of(language),
            language === 'markdown' ? markdown() : html(),
          ]),
          Prec.high(EditorView.domEventHandlers({
            keydown: event => {
              if (readOnlyRef.current) return false
              const hasCommandModifier = event.ctrlKey || event.metaKey
              if (!hasCommandModifier || event.altKey) return false
              const key = event.key.toLocaleLowerCase()
              if (key === 'z') {
                event.preventDefault()
                runStableHistoryCommand(event.shiftKey ? redo : undo)
                return true
              }
              if (key === 'y' && !event.shiftKey) {
                event.preventDefault()
                runStableHistoryCommand(redo)
                return true
              }
              return false
            },
          })),
          Prec.high(keymap.of([
            { key: 'Mod-b', run: () => { wrapSelection('**', '**', '加粗文字', 'strong'); return true }, preventDefault: true },
            { key: 'Mod-i', run: () => { wrapSelection('*', '*', '斜体文字', 'em'); return true }, preventDefault: true },
            { key: 'Mod-k', run: () => { insertLink(); return true }, preventDefault: true },
            { key: 'Mod-e', run: () => { wrapSelection('`', '`', '代码', 'code'); return true }, preventDefault: true },
            { key: 'Mod-Shift-h', run: () => { wrapSelection('==', '==', '高亮文字', 'mark'); return true }, preventDefault: true },
            { key: 'Mod-Shift-s', run: () => { wrapSelection('~~', '~~', '删除文字', 'del'); return true }, preventDefault: true },
            { key: 'Mod-Alt-2', run: () => { insertHeading(2); return true }, preventDefault: true },
            { key: 'Mod-Alt-3', run: () => { insertHeading(3); return true }, preventDefault: true },
            { key: 'Mod-Shift-7', run: () => { insertList(true); return true }, preventDefault: true },
            { key: 'Mod-Shift-8', run: () => { insertList(false); return true }, preventDefault: true },
          ])),
          EditorView.lineWrapping,
          placeholder('从这里开始，用 Markdown 书写你的文章…'),
          EditorState.allowMultipleSelections.of(false),
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown 文本编辑器',
            spellcheck: 'true',
          }),
          EditorView.domEventHandlers({
            compositionstart: () => {
              compositionActiveRef.current = true
              if (compositionEndTimerRef.current !== null) window.clearTimeout(compositionEndTimerRef.current)
              compositionEndTimerRef.current = null
              if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current)
              changeTimerRef.current = null
              return false
            },
            compositionupdate: () => {
              compositionActiveRef.current = true
              if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current)
              changeTimerRef.current = null
              return false
            },
            compositionend: (_event, currentView) => {
              compositionActiveRef.current = false
              if (compositionEndTimerRef.current !== null) window.clearTimeout(compositionEndTimerRef.current)
              compositionEndTimerRef.current = window.setTimeout(() => {
                compositionEndTimerRef.current = null
                if (viewRef.current === currentView) scheduleSourceChange(currentView)
              }, 0)
              return false
            },
            blur: (_event, currentView) => {
              if (changeTimerRef.current !== null) emitSourceChange(currentView)
              return false
            },
            click: (event, currentView) => {
              if (languageRef.current === 'markdown' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
                const position = currentView.posAtCoords({ x: event.clientX, y: event.clientY })
                  ?? currentView.state.selection.main.head
                const link = markdownLinkAtOffset(currentView.state.doc.toString(), position)
                if (link) {
                  event.preventDefault()
                  window.open(link, '_blank', 'noopener,noreferrer')
                  return true
                }
              }
              scheduleActiveBlock(currentView)
              return false
            },
            paste: event => {
              if (readOnlyRef.current) return false
              const image = Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith('image/'))
              if (!image) return false
              event.preventDefault()
              void insertImageFile(image)
              return true
            },
            dragover: event => {
              if (!event.dataTransfer?.types.includes('Files')) return false
              event.preventDefault()
              return true
            },
            drop: event => {
              if (readOnlyRef.current) return false
              const image = Array.from(event.dataTransfer?.files || []).find(file => file.type.startsWith('image/'))
              if (!image) return false
              event.preventDefault()
              void insertImageFile(image)
              return true
            },
          }),
          EditorView.updateListener.of(update => {
            const isControlledValueUpdate = update.transactions.some(
              transaction => transaction.annotation(controlledValueUpdate) === true,
            )
            const isExternalFocusUpdate = update.transactions.some(
              transaction => transaction.annotation(externalFocusUpdate) === true,
            )
            if (isExternalFocusUpdate && activeBlockTimerRef.current !== null) {
              window.clearTimeout(activeBlockTimerRef.current)
              activeBlockTimerRef.current = null
            }
            if (update.docChanged && !isControlledValueUpdate) {
              if (compositionActiveRef.current || update.view.compositionStarted) {
                if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current)
                changeTimerRef.current = null
              } else {
                scheduleSourceChange(update.view)
              }
            }
            if ((update.docChanged || update.selectionSet) && !isExternalFocusUpdate) scheduleActiveBlock(update.view)
            if (update.docChanged || update.selectionSet || update.geometryChanged) updateEditorUi(update.view)
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '15px', backgroundColor: '#fff' },
            '.cm-scroller': { fontFamily: '"MiSans", "HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif', lineHeight: '1.9' },
            '.cm-gutters': { backgroundColor: 'transparent', borderRight: '0', color: '#c2c8ce' },
            '.cm-lineNumbers': {
              fontFamily: '"MiSans", "HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif',
              fontSize: '11px',
              fontVariantNumeric: 'tabular-nums',
            },
            '.cm-foldGutter': { display: 'none' },
            '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#aab1b8' },
            '.cm-activeLine': { backgroundColor: 'rgba(35,45,55,0.012)' },
            '.cm-cursor': { borderLeftColor: '#1648ff', borderLeftWidth: '2px' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
    })
    viewRef.current = view
    updateEditorUi(view)
    return () => {
      if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current)
      if (compositionEndTimerRef.current !== null) window.clearTimeout(compositionEndTimerRef.current)
      compositionActiveRef.current = false
      if (activeBlockTimerRef.current !== null) window.clearTimeout(activeBlockTimerRef.current)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (compositionActiveRef.current || view.compositionStarted) return
    const previousSources = embeddedImagesRef.current
    const compacted = compactEmbeddedImages(value, previousSources)
    const current = view.state.doc.toString()
    const pendingEchoes = pendingLocalEchoesRef.current
    let echoIndex = -1
    for (let index = pendingEchoes.length - 1; index >= 0; index -= 1) {
      if (pendingEchoes[index] === compacted.text) {
        echoIndex = index
        break
      }
    }
    if (echoIndex >= 0) {
      pendingEchoes.splice(0, echoIndex + 1)
      if (current !== compacted.text) return
    }

    embeddedImagesRef.current = compacted.sources
    const sourcesChanged = compacted.sources !== previousSources
    if (current === compacted.text && !sourcesChanged) return
    const effects = sourcesChanged
      ? imageSourceCompartmentRef.current.reconfigure(embeddedImageFacet.of({ sources: compacted.sources }))
      : undefined
    const scrollTop = view.scrollDOM.scrollTop
    const scrollLeft = view.scrollDOM.scrollLeft
    const changes = minimalTextChange(current, compacted.text)
    view.dispatch({
      ...(changes ? { changes } : {}),
      effects,
      annotations: [controlledValueUpdate.of(true), Transaction.addToHistory.of(false)],
    })
    view.scrollDOM.scrollTop = scrollTop
    view.scrollDOM.scrollLeft = scrollLeft
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    })
    if (readOnly) setSelectionMenu(null)
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    languageRef.current = language
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure([
        sourceLanguageFacet.of(language),
        language === 'markdown' ? markdown() : html(),
      ]),
    })
  }, [language])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !focusRequest || focusRequest.requestId === lastFocusRequestRef.current) return
    lastFocusRequestRef.current = focusRequest.requestId
    const lineNumber = Math.min(Math.max(1, focusRequest.line), view.state.doc.lines)
    const position = view.state.doc.line(lineNumber).to
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'center', yMargin: 32 }),
      annotations: externalFocusUpdate.of(true),
    })
    view.focus()
  }, [focusRequest])

  return (
    <>
      <div className="source-editor">
        <div className="source-toolbar" role="toolbar" aria-label="Markdown 文本工具">
          <div className="source-tool-group">
            <ToolButton label="撤销" shortcut="Ctrl+Z" disabled={!historyAvailability.canUndo} onClick={undoChange}><Undo2 size={17} /></ToolButton>
            <ToolButton label="重做" shortcut="Ctrl+Y / Ctrl+Shift+Z" disabled={!historyAvailability.canRedo} onClick={redoChange}><Redo2 size={17} /></ToolButton>
          </div>
          <div className="source-tool-group">
            <ToolButton label="二级标题" shortcut="Ctrl+Alt+2" onClick={() => insertHeading(2)}><Heading2 size={17} /></ToolButton>
            <ToolButton label="三级标题" shortcut="Ctrl+Alt+3" onClick={() => insertHeading(3)}><Heading3 size={17} /></ToolButton>
          </div>
          <div className="source-tool-group">
            <ToolButton label="加粗" shortcut="Ctrl+B" onClick={() => wrapSelection('**', '**', '加粗文字', 'strong')}><Bold size={17} /></ToolButton>
            <ToolButton label="斜体" shortcut="Ctrl+I" onClick={() => wrapSelection('*', '*', '斜体文字', 'em')}><Italic size={17} /></ToolButton>
            <ToolButton label="删除线" shortcut="Ctrl+Shift+S" onClick={() => wrapSelection('~~', '~~', '删除文字', 'del')}><Strikethrough size={17} /></ToolButton>
            <ToolButton label="行内代码" shortcut="Ctrl+E" onClick={() => wrapSelection('`', '`', '代码', 'code')}><Code2 size={17} /></ToolButton>
            <ToolButton label="高亮" shortcut="Ctrl+Shift+H" onClick={() => wrapSelection('==', '==', '高亮文字', 'mark')}><Highlighter size={17} /></ToolButton>
          </div>
          <div className="source-tool-group">
            <ToolButton label="引用" onClick={insertQuote}><Quote size={17} /></ToolButton>
            <ToolButton label="无序列表" shortcut="Ctrl+Shift+8" onClick={() => insertList(false)}><List size={17} /></ToolButton>
            <ToolButton label="有序列表" shortcut="Ctrl+Shift+7" onClick={() => insertList(true)}><ListOrdered size={17} /></ToolButton>
            <ToolButton label="警告块" onClick={insertWarning}><TriangleAlert size={17} /></ToolButton>
          </div>
          <div className="source-tool-group">
            <ToolButton label="代码块" onClick={insertCodeBlock}><Code2 size={17} /></ToolButton>
            <ToolButton label="链接" shortcut="Ctrl+K" onClick={insertLink}><Link2 size={17} /></ToolButton>
            <ToolButton label="图片" onClick={() => imageInputRef.current?.click()}><ImagePlus size={17} /></ToolButton>
            <ToolButton label="表格" onClick={insertTable}><Table2 size={17} /></ToolButton>
            <ToolButton label="分割线" onClick={() => insertText(languageRef.current === 'markdown' ? '\n\n---\n\n' : '<hr>')}><Minus size={17} /></ToolButton>
          </div>
          <span className="source-language-badge">{language === 'markdown' ? 'Markdown' : 'HTML'}</span>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleImageSelection} />
        </div>
        <div ref={hostRef} className="source-editor-host" />
      </div>

      {selectionMenu && createPortal(
        <div
          className={`source-selection-menu ${selectionMenu.placement}`}
          role="toolbar"
          aria-label="选中文字快捷排版"
          style={{ left: selectionMenu.left, top: selectionMenu.top }}
        >
          <div className="source-selection-group">
            <ToolButton label="正文" preserveSelection onClick={setParagraph}><Pilcrow size={15} /></ToolButton>
            <ToolButton label="二级标题" shortcut="Ctrl+Alt+2" preserveSelection onClick={() => insertHeading(2)}><Heading2 size={15} /></ToolButton>
            <ToolButton label="三级标题" shortcut="Ctrl+Alt+3" preserveSelection onClick={() => insertHeading(3)}><Heading3 size={15} /></ToolButton>
          </div>
          <div className="source-selection-group">
            <ToolButton label="加粗" shortcut="Ctrl+B" preserveSelection active={selectionHasWrapper('**', '**', 'strong')} onClick={() => wrapSelection('**', '**', '加粗文字', 'strong')}><Bold size={15} /></ToolButton>
            <ToolButton label="斜体" shortcut="Ctrl+I" preserveSelection active={selectionHasWrapper('*', '*', 'em')} onClick={() => wrapSelection('*', '*', '斜体文字', 'em')}><Italic size={15} /></ToolButton>
            <ToolButton label="删除线" shortcut="Ctrl+Shift+S" preserveSelection active={selectionHasWrapper('~~', '~~', 'del')} onClick={() => wrapSelection('~~', '~~', '删除文字', 'del')}><Strikethrough size={15} /></ToolButton>
            <ToolButton label="行内代码" shortcut="Ctrl+E" preserveSelection active={selectionHasWrapper('`', '`', 'code')} onClick={() => wrapSelection('`', '`', '代码', 'code')}><Code2 size={15} /></ToolButton>
            <ToolButton label="高亮" shortcut="Ctrl+Shift+H" preserveSelection active={selectionHasWrapper('==', '==', 'mark')} onClick={() => wrapSelection('==', '==', '高亮文字', 'mark')}><Highlighter size={15} /></ToolButton>
          </div>
          <div className="source-selection-group">
            <ToolButton label="引用" preserveSelection onClick={insertQuote}><Quote size={15} /></ToolButton>
            <ToolButton label="链接" shortcut="Ctrl+K" preserveSelection onClick={insertLink}><Link2 size={15} /></ToolButton>
            <ToolButton label="清除格式" preserveSelection onClick={clearSelectedFormatting}><RemoveFormatting size={15} /></ToolButton>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
