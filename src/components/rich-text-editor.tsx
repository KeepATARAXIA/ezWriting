import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { EditorContent, Extension, mergeAttributes, Node as TiptapNode, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type ReactNodeViewProps } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import {
  AlertTriangle,
  Bold,
  Bug,
  Check,
  CircleCheck,
  CircleHelp,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Lightbulb,
  Minus,
  PaintBucket,
  Pilcrow,
  Quote,
  Redo2,
  Search,
  SlidersHorizontal,
  SquareCode,
  Strikethrough,
  TableProperties,
  Trash2,
  Underline,
  Undo2,
  Unlink,
  RemoveFormatting,
  X,
} from 'lucide-react'
import type { MissingImageAction, MissingImageTarget } from '../domain/article'
import {
  ARTICLE_ACCENT_COLORS,
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_SIZES,
  ARTICLE_LINE_HEIGHTS,
  type ArticleAccent,
  type ArticleFont,
  type ArticleFontSize,
  type ArticleFormatting,
  type ArticleLineHeight,
  type ArticleTheme,
} from '../domain/formatting'
import {
  MARKDOWN_CALLOUT_DEFINITIONS,
  normalizeMarkdownCalloutType,
  renderMarkdownToSafeHtml,
  type MarkdownCalloutType,
} from '../lib/markdown-compatibility'

export interface EditorFocusRequest {
  blockIndex: number
  requestId: number
}

interface RichTextEditorProps {
  content: string
  formatting: ArticleFormatting
  focusRequest?: EditorFocusRequest | null
  onChange: (html: string) => void
  onActiveBlockChange?: (blockIndex: number | null) => void
  onFormattingChange: (formatting: ArticleFormatting) => void
  onMissingImageAction?: (target: MissingImageTarget, action: MissingImageAction) => void
}

interface ManagedImageOptions extends ImageOptions {
  onMissingImageAction?: (target: MissingImageTarget, action: MissingImageAction) => void
}

interface TextMatch {
  from: number
  to: number
  marks: readonly unknown[]
}

const THEME_OPTIONS: Array<{ value: ArticleTheme; label: string; detail: string }> = [
  { value: 'clean', label: '清晰', detail: '适合通用分发' },
  { value: 'editorial', label: '刊物', detail: '更强的长文气质' },
  { value: 'wechat', label: '微信绿', detail: '公众号常用强调' },
]

const FONT_OPTIONS: Array<{ value: ArticleFont; label: string }> = [
  { value: 'serif', label: '衬线' },
  { value: 'sans', label: '无衬线' },
]

const SIZE_OPTIONS: Array<{ value: ArticleFontSize; label: string }> = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '推荐' },
  { value: 'large', label: '大' },
]

const LINE_HEIGHT_OPTIONS: Array<{ value: ArticleLineHeight; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '舒适' },
  { value: 'airy', label: '舒展' },
]

const ACCENT_OPTIONS: Array<{ value: ArticleAccent; label: string }> = [
  { value: 'blue', label: '钴蓝' },
  { value: 'green', label: '翡翠绿' },
  { value: 'orange', label: '暖橙' },
  { value: 'purple', label: '亮紫' },
]

const CALLOUT_TOOL_TYPES: MarkdownCalloutType[] = [
  'note',
  'summary',
  'info',
  'tip',
  'success',
  'question',
  'warning',
  'danger',
  'example',
  'quote',
]

function CalloutIcon({ type, size = 16 }: { type: MarkdownCalloutType; size?: number }) {
  if (type === 'warning' || type === 'failure' || type === 'danger') return <AlertTriangle size={size} />
  if (type === 'success') return <CircleCheck size={size} />
  if (type === 'question') return <CircleHelp size={size} />
  if (type === 'tip') return <Lightbulb size={size} />
  if (type === 'bug') return <Bug size={size} />
  if (type === 'quote') return <Quote size={size} />
  return <Info size={size} />
}

function CalloutNodeView({ node, updateAttributes }: ReactNodeViewProps) {
  const type = normalizeMarkdownCalloutType(String(node.attrs.type || 'note'))
  const definition = MARKDOWN_CALLOUT_DEFINITIONS[type]
  const title = String(node.attrs.title || definition.label)
  const style = {
    '--callout-accent': definition.accent,
    '--callout-background': definition.background,
  } as CSSProperties

  return (
    <NodeViewWrapper
      as="aside"
      className="editor-callout"
      data-callout={type}
      data-callout-fold={node.attrs.fold || undefined}
      style={style}
    >
      <div className="editor-callout-heading" contentEditable={false}>
        <span className="editor-callout-icon" aria-hidden="true"><CalloutIcon type={type} /></span>
        <input
          value={title}
          aria-label={`${definition.label}标题`}
          onChange={event => updateAttributes({ title: event.target.value })}
          onKeyDown={event => event.stopPropagation()}
        />
        <small>{type}</small>
      </div>
      <NodeViewContent className="editor-callout-content" />
    </NodeViewWrapper>
  )
}

const MarkdownCallout = TiptapNode.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: element => normalizeMarkdownCalloutType(element.getAttribute('data-callout') || 'note'),
      },
      title: {
        default: '',
        parseHTML: element => element.getAttribute('data-callout-title')
          || element.querySelector('[data-callout-title]')?.textContent
          || '',
      },
      fold: {
        default: null,
        parseHTML: element => element.getAttribute('data-callout-fold'),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'aside[data-callout]', contentElement: '[data-callout-content]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = normalizeMarkdownCalloutType(String(node.attrs.type || 'note'))
    const title = String(node.attrs.title || MARKDOWN_CALLOUT_DEFINITIONS[type].label)
    return [
      'aside',
      mergeAttributes(HTMLAttributes, {
        'data-callout': type,
        'data-callout-title': title,
        'data-callout-fold': node.attrs.fold || null,
      }),
      ['div', { 'data-callout-title': '' }, title],
      ['div', { 'data-callout-content': '' }, 0],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView)
  },
})

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(?:#{1,6}\s|>\s*(?:\[![a-z0-9-]+\])?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|```|\|.+\|\s*$)|\[\[[^\]]+\]\]|==[^=\n]+==/im.test(text)
}

function insertMarkdownPaste(view: EditorView, event: ClipboardEvent): boolean {
  const text = event.clipboardData?.getData('text/plain') || ''
  if (!text.trim() || !looksLikeMarkdown(text)) return false

  const clipboardHtml = event.clipboardData?.getData('text/html') || ''
  const hasObsidianSyntax = />\s*\[![a-z0-9-]+\]|\[\[[^\]]+\]\]|==[^=\n]+==/i.test(text)
  if (clipboardHtml && !hasObsidianSyntax) return false

  event.preventDefault()
  const container = document.createElement('div')
  container.innerHTML = renderMarkdownToSafeHtml(text)
  const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container, { preserveWhitespace: true })
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
  return true
}

function convertCalloutShortcut(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false

  const { state } = view
  const { $from } = state.selection
  if (!state.selection.empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false

  let replaceFrom = $from.before()
  let replaceNode = $from.parent
  let shortcutText = replaceNode.textContent
  const parentDepth = $from.depth - 1
  const parentNode = parentDepth > 0 ? $from.node(parentDepth) : null

  if (parentNode?.type.name === 'blockquote' && parentNode.childCount === 1) {
    replaceFrom = $from.before(parentDepth)
    replaceNode = parentNode
  } else {
    shortcutText = shortcutText.replace(/^>\s*/, '')
  }

  const match = shortcutText.match(/^\[!([a-z0-9-]+)\]([+-])?\s*(.*)$/i)
  if (!match) return false

  const type = normalizeMarkdownCalloutType(match[1])
  const title = match[3].trim() || MARKDOWN_CALLOUT_DEFINITIONS[type].label
  const fold = match[2] ? (match[2] === '-' ? 'collapsed' : 'expanded') : null
  const calloutType = state.schema.nodes.callout
  const paragraphType = state.schema.nodes.paragraph
  if (!calloutType || !paragraphType) return false

  const callout = calloutType.create({ type, title, fold }, paragraphType.create())
  let transaction = state.tr.replaceWith(replaceFrom, replaceFrom + replaceNode.nodeSize, callout)
  transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(replaceFrom + 2), 1))
  view.dispatch(transaction.scrollIntoView())
  return true
}

const previewLocatePluginKey = new PluginKey<DecorationSet>('previewLocate')

const PreviewLocate = Extension.create({
  name: 'previewLocate',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: previewLocatePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, current) {
            const target = transaction.getMeta(previewLocatePluginKey) as { from: number; to: number } | null | undefined
            if (target === null) return DecorationSet.empty
            if (target) {
              return DecorationSet.create(transaction.doc, [
                Decoration.node(target.from, target.to, { class: 'editor-located-target' }),
              ])
            }
            return transaction.docChanged ? current.map(transaction.mapping, transaction.doc) : current
          },
        },
        props: {
          decorations: state => previewLocatePluginKey.getState(state),
        },
      }),
    ]
  },
})

function ManagedImageNodeView({ node, extension }: ReactNodeViewProps) {
  const source = typeof node.attrs.src === 'string' ? node.attrs.src : ''
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  const title = typeof node.attrs.title === 'string' ? node.attrs.title : undefined
  const missingId = typeof node.attrs.missingId === 'string' ? node.attrs.missingId : ''
  const missingAsset = typeof node.attrs.missingAsset === 'string' ? node.attrs.missingAsset : ''

  if (!missingId || !missingAsset) {
    return (
      <NodeViewWrapper as="figure" className="editor-image-node">
        <img src={source} alt={alt} title={title} draggable="true" data-drag-handle />
      </NodeViewWrapper>
    )
  }

  const target = { id: missingId, reference: missingAsset }
  const requestAction = (action: MissingImageAction) => {
    ;(extension.options as ManagedImageOptions).onMissingImageAction?.(target, action)
  }

  return (
    <NodeViewWrapper as="figure" className="missing-image-card editor-missing-image-card" data-missing-id={missingId} data-missing-asset={missingAsset} contentEditable={false}>
      <span className="missing-image-card-icon" aria-hidden="true">▧</span>
      <figcaption><strong>{alt || '图片暂时缺失'}</strong><span>{missingAsset}</span></figcaption>
      <div className="missing-image-actions">
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => requestAction('relink')}><Link2 size={14} />重新链接</button>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => requestAction('replace')}><ImagePlus size={14} />替换图片</button>
        <button type="button" className="delete" onMouseDown={event => event.preventDefault()} onClick={() => requestAction('delete')}><Trash2 size={14} />删除</button>
      </div>
    </NodeViewWrapper>
  )
}

const ManagedImage = Image.extend<ManagedImageOptions>({
  addOptions() {
    const parent = this.parent?.()
    return {
      inline: parent?.inline ?? false,
      allowBase64: parent?.allowBase64 ?? false,
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      resize: parent?.resize ?? false,
      onMissingImageAction: undefined,
    }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      missingAsset: {
        default: null,
        parseHTML: element => element.getAttribute('data-missing-asset'),
        renderHTML: attributes => attributes.missingAsset ? { 'data-missing-asset': attributes.missingAsset } : {},
      },
      missingId: {
        default: null,
        parseHTML: element => element.getAttribute('data-missing-id'),
        renderHTML: attributes => attributes.missingId ? { 'data-missing-id': attributes.missingId } : {},
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ManagedImageNodeView)
  },
})

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function findMatches(editor: NonNullable<ReturnType<typeof useEditor>>, query: string): TextMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []

  const matches: TextMatch[] = []
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return
    const haystack = node.text.toLocaleLowerCase()
    let index = haystack.indexOf(normalizedQuery)
    while (index >= 0) {
      matches.push({
        from: position + index,
        to: position + index + normalizedQuery.length,
        marks: node.marks,
      })
      index = haystack.indexOf(normalizedQuery, index + normalizedQuery.length)
    }
  })
  return matches
}

function activeTopLevelBlockIndex(editor: NonNullable<ReturnType<typeof useEditor>>): number | null {
  const { doc, selection } = editor.state
  if (!doc.childCount) return null

  let position = 0
  for (let index = 0; index < doc.childCount; index += 1) {
    position += doc.child(index).nodeSize
    if (selection.from <= position) return index
  }
  return doc.childCount - 1
}

function ToolButton({
  active = false,
  disabled = false,
  label,
  shortcut,
  onClick,
  children,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  shortcut?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`editor-tool ${active ? 'active' : ''}`}
      aria-label={label}
      title={shortcut ? `${label} · ${shortcut}` : label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function RichTextEditor({ content, formatting, focusRequest, onChange, onActiveBlockChange, onFormattingChange, onMissingImageAction }: RichTextEditorProps) {
  const onChangeRef = useRef(onChange)
  const onActiveBlockChangeRef = useRef(onActiveBlockChange)
  const onMissingImageActionRef = useRef(onMissingImageAction)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const locatedTargetTimerRef = useRef<number | null>(null)
  const centerTargetTimerRef = useRef<number | null>(null)
  const [bubbleScrollTarget, setBubbleScrollTarget] = useState<HTMLElement | Window>(() => window)
  const [showSearch, setShowSearch] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const [showCallouts, setShowCallouts] = useState(false)
  const [showFormatting, setShowFormatting] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [linkValue, setLinkValue] = useState('https://')

  onChangeRef.current = onChange
  onActiveBlockChangeRef.current = onActiveBlockChange
  onMissingImageActionRef.current = onMissingImageAction

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      MarkdownCallout,
      ManagedImage.configure({
        allowBase64: true,
        inline: false,
        onMissingImageAction: (target, action) => onMissingImageActionRef.current?.(target, action),
      }),
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: true } }),
      TextStyle,
      Color,
      PreviewLocate,
      Placeholder.configure({ placeholder: '从这里继续写作，或粘贴 Markdown 转换后的正文…' }),
    ],
    content,
    editorProps: {
      attributes: {
        class: 'article-editor',
        'aria-label': '文章正文编辑器',
      },
      handlePaste: insertMarkdownPaste,
      handleKeyDown: (view, event) => {
        if (convertCalloutShortcut(view, event)) return true

        const hasCommandModifier = event.ctrlKey || event.metaKey
        if (!hasCommandModifier || event.altKey || event.shiftKey) return false

        const key = event.key.toLocaleLowerCase()
        if (key === 'k') {
          event.preventDefault()
          const linkMark = view.state.schema.marks.link?.isInSet(view.state.selection.$from.marks())
          setLinkValue(typeof linkMark?.attrs.href === 'string' ? linkMark.attrs.href : 'https://')
          setShowLink(true)
          setShowSearch(false)
          setShowCallouts(false)
          setShowFormatting(false)
          return true
        }

        if (key === 'f') {
          event.preventDefault()
          setShowSearch(true)
          setShowLink(false)
          setShowCallouts(false)
          setShowFormatting(false)
          return true
        }

        return false
      },
    },
    onCreate: ({ editor: currentEditor }) => {
      onActiveBlockChangeRef.current?.(activeTopLevelBlockIndex(currentEditor))
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      onActiveBlockChangeRef.current?.(activeTopLevelBlockIndex(currentEditor))
    },
    onUpdate: ({ editor: currentEditor }) => onChangeRef.current(currentEditor.getHTML()),
  })

  const editorState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => currentEditor && !currentEditor.isDestroyed ? {
      bold: currentEditor.isActive('bold'),
      italic: currentEditor.isActive('italic'),
      underline: currentEditor.isActive('underline'),
      strike: currentEditor.isActive('strike'),
      code: currentEditor.isActive('code'),
      codeBlock: currentEditor.isActive('codeBlock'),
      h1: currentEditor.isActive('heading', { level: 1 }),
      h2: currentEditor.isActive('heading', { level: 2 }),
      h3: currentEditor.isActive('heading', { level: 3 }),
      blockquote: currentEditor.isActive('blockquote'),
      bulletList: currentEditor.isActive('bulletList'),
      orderedList: currentEditor.isActive('orderedList'),
      taskList: currentEditor.isActive('taskList'),
      callout: currentEditor.isActive('callout'),
      link: currentEditor.isActive('link'),
      text: currentEditor.getText(),
      canUndo: currentEditor.can().chain().focus().undo().run(),
      canRedo: currentEditor.can().chain().focus().redo().run(),
    } : null,
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.getHTML() === content) return
    editor.commands.setContent(content, { emitUpdate: false })
  }, [content, editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const scrollTarget = editor.view.dom.closest('.paper-panel')
    if (scrollTarget instanceof HTMLElement) setBubbleScrollTarget(scrollTarget)
  }, [editor])

  useEffect(() => {
    if (showLink) linkInputRef.current?.focus()
  }, [showLink])

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus()
  }, [showSearch])

  useEffect(() => () => {
    if (locatedTargetTimerRef.current !== null) window.clearTimeout(locatedTargetTimerRef.current)
    if (centerTargetTimerRef.current !== null) window.clearTimeout(centerTargetTimerRef.current)
    onActiveBlockChangeRef.current?.(null)
  }, [])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusRequest) return
    const { doc } = editor.state
    if (focusRequest.blockIndex < 0 || focusRequest.blockIndex >= doc.childCount) return

    let position = 0
    for (let index = 0; index < focusRequest.blockIndex; index += 1) {
      position += doc.child(index).nodeSize
    }

    const selectionPosition = Math.min(position + 1, doc.content.size)
    const selection = TextSelection.near(doc.resolve(selectionPosition), 1)
    const targetNode = doc.child(focusRequest.blockIndex)
    editor.view.dispatch(
      editor.state.tr
        .setSelection(selection)
        .setMeta(previewLocatePluginKey, { from: position, to: position + targetNode.nodeSize }),
    )
    editor.view.focus()

    const centerLocatedTarget = () => {
      const decoratedTarget = editor.view.dom.querySelector<HTMLElement>('.editor-located-target')
      const targetElement = decoratedTarget || editor.view.nodeDOM(position)
      if (targetElement instanceof HTMLElement) {
        targetElement.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      }
    }

    centerLocatedTarget()
    if (centerTargetTimerRef.current !== null) window.clearTimeout(centerTargetTimerRef.current)
    centerTargetTimerRef.current = window.setTimeout(() => {
      centerLocatedTarget()
      centerTargetTimerRef.current = null
    }, 0)

    if (locatedTargetTimerRef.current !== null) window.clearTimeout(locatedTargetTimerRef.current)
    locatedTargetTimerRef.current = window.setTimeout(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(previewLocatePluginKey, null))
      locatedTargetTimerRef.current = null
    }, 2000)
  }, [editor, focusRequest])

  const matchCount = useMemo(() => {
    if (!findText.trim()) return 0
    const haystack = (editorState?.text || '').toLocaleLowerCase()
    const needle = findText.trim().toLocaleLowerCase()
    let count = 0
    let position = haystack.indexOf(needle)
    while (position >= 0) {
      count += 1
      position = haystack.indexOf(needle, position + needle.length)
    }
    return count
  }, [editorState?.text, findText])

  if (!editor || editor.isDestroyed) return <div className="article-editor-loading">正在准备编辑器…</div>

  const updateFormatting = <Key extends keyof ArticleFormatting>(key: Key, value: ArticleFormatting[Key]) => {
    if (key === 'theme') {
      const theme = value as ArticleTheme
      onFormattingChange({
        ...formatting,
        theme,
        accent: theme === 'wechat' ? 'green' : formatting.accent,
        font: theme === 'editorial' ? 'serif' : formatting.font,
      })
      return
    }
    onFormattingChange({ ...formatting, [key]: value })
  }

  const findNext = () => {
    const matches = findMatches(editor, findText)
    if (!matches.length) return
    const next = matches.find(match => match.from >= editor.state.selection.to) || matches[0]
    editor.chain().focus().setTextSelection({ from: next.from, to: next.to }).scrollIntoView().run()
  }

  const replaceCurrent = () => {
    const { from, to } = editor.state.selection
    const selectionText = editor.state.doc.textBetween(from, to).toLocaleLowerCase()
    if (selectionText === findText.trim().toLocaleLowerCase()) {
      editor.chain().focus().insertContent(replaceText).run()
      findNext()
      return
    }
    findNext()
  }

  const replaceAll = () => {
    const matches = findMatches(editor, findText)
    if (!matches.length) return
    let transaction = editor.state.tr
    for (const match of [...matches].reverse()) {
      if (replaceText) {
        transaction = transaction.replaceWith(match.from, match.to, editor.state.schema.text(replaceText, match.marks as never))
      } else {
        transaction = transaction.delete(match.from, match.to)
      }
    }
    editor.view.dispatch(transaction)
    editor.commands.focus()
  }

  const applyLink = () => {
    const href = linkValue.trim()
    if (!href || href === 'https://') return
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    setShowLink(false)
  }

  const openLinkPanel = () => {
    setLinkValue(editor.getAttributes('link').href || 'https://')
    setShowLink(true)
    setShowSearch(false)
    setShowCallouts(false)
    setShowFormatting(false)
  }

  const insertCallout = (type: MarkdownCalloutType) => {
    editor.chain().focus().insertContent({
      type: 'callout',
      attrs: { type, title: MARKDOWN_CALLOUT_DEFINITIONS[type].label },
      content: [{ type: 'paragraph' }],
    }).run()
    setShowCallouts(false)
  }

  const editorVariables = {
    '--article-accent': ARTICLE_ACCENT_COLORS[formatting.accent],
    '--article-font-family': ARTICLE_FONT_FAMILIES[formatting.font],
    '--article-font-size': ARTICLE_FONT_SIZES[formatting.fontSize],
    '--article-line-height': ARTICLE_LINE_HEIGHTS[formatting.lineHeight],
  } as CSSProperties

  return (
    <div className={`rich-editor theme-${formatting.theme}`} style={editorVariables}>
      <div className="editor-toolbar" role="toolbar" aria-label="正文排版工具">
        <div className="editor-tool-group">
          <ToolButton label="一级标题" shortcut="Ctrl+Alt+1" active={editorState?.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={17} /></ToolButton>
          <ToolButton label="二级标题" shortcut="Ctrl+Alt+2" active={editorState?.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={17} /></ToolButton>
          <ToolButton label="三级标题" shortcut="Ctrl+Alt+3" active={editorState?.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={17} /></ToolButton>
        </div>
        <div className="editor-tool-group">
          <ToolButton label="加粗" shortcut="Ctrl+B" active={editorState?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></ToolButton>
          <ToolButton label="斜体" shortcut="Ctrl+I" active={editorState?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolButton>
          <ToolButton label="下划线" shortcut="Ctrl+U" active={editorState?.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={16} /></ToolButton>
          <ToolButton label="删除线" active={editorState?.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></ToolButton>
          <ToolButton label="行内代码" active={editorState?.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 size={16} /></ToolButton>
          <label className="editor-color-tool" title="文字颜色">
            <PaintBucket size={15} />
            <input type="color" defaultValue="#1648ff" aria-label="文字颜色" onChange={event => editor.chain().focus().setColor(event.target.value).run()} />
          </label>
          <label className="editor-color-tool" title="文字高亮">
            <Highlighter size={15} />
            <input type="color" defaultValue="#fff3a3" aria-label="文字高亮" onChange={event => editor.chain().focus().setHighlight({ color: event.target.value }).run()} />
          </label>
        </div>
        <div className="editor-tool-group">
          <ToolButton label="重点引用" active={editorState?.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></ToolButton>
          <ToolButton label="无序列表" shortcut="Ctrl+Shift+8" active={editorState?.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolButton>
          <ToolButton label="有序列表" shortcut="Ctrl+Shift+7" active={editorState?.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolButton>
          <ToolButton label="任务列表" shortcut="Ctrl+Shift+9" active={editorState?.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={16} /></ToolButton>
          <ToolButton label="代码块" active={editorState?.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><SquareCode size={16} /></ToolButton>
          <ToolButton label="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={16} /></ToolButton>
          <ToolButton label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableProperties size={16} /></ToolButton>
          <ToolButton label="插入提示块" active={showCallouts || editorState?.callout} onClick={() => {
            setShowCallouts(current => !current)
            setShowLink(false)
            setShowSearch(false)
            setShowFormatting(false)
          }}><AlertTriangle size={16} /></ToolButton>
        </div>
        <div className="editor-tool-group">
          <ToolButton label="插入链接" shortcut="Ctrl+K" active={editorState?.link} onClick={() => showLink ? setShowLink(false) : openLinkPanel()}><Link2 size={16} /></ToolButton>
          <ToolButton label="移除链接" disabled={!editorState?.link} onClick={() => editor.chain().focus().unsetLink().run()}><Unlink size={16} /></ToolButton>
          <ToolButton label="插入本地图片" onClick={() => imageInputRef.current?.click()}><ImagePlus size={16} /></ToolButton>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={event => {
              const file = event.target.files?.[0]
              if (!file) return
              event.target.value = ''
              void readFileAsDataUrl(file).then(source => {
                if (editor.isDestroyed) return
                editor.chain().focus().setImage({ src: source, alt: file.name }).run()
              })
            }}
          />
        </div>
        <div className="editor-tool-group editor-tool-group-end">
          <ToolButton label="查找替换" shortcut="Ctrl+F" active={showSearch} onClick={() => {
            setShowSearch(current => !current)
            setShowLink(false)
            setShowCallouts(false)
            setShowFormatting(false)
          }}><Search size={16} /></ToolButton>
          <ToolButton label="排版设置" active={showFormatting} onClick={() => {
            setShowFormatting(current => !current)
            setShowLink(false)
            setShowSearch(false)
            setShowCallouts(false)
          }}><SlidersHorizontal size={16} /></ToolButton>
          <ToolButton label="撤销" shortcut="Ctrl+Z" disabled={!editorState?.canUndo} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></ToolButton>
          <ToolButton label="重做" shortcut="Ctrl+Shift+Z / Ctrl+Y" disabled={!editorState?.canRedo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></ToolButton>
        </div>
      </div>

      {showCallouts && (
        <div className="callout-picker" role="dialog" aria-label="插入 Markdown 提示块">
          <div>
            <strong>提示块</strong>
            <span>也可以输入 <code>&gt; [!warning] 标题</code> 后按回车</span>
          </div>
          <div className="callout-picker-options">
            {CALLOUT_TOOL_TYPES.map(type => {
              const definition = MARKDOWN_CALLOUT_DEFINITIONS[type]
              return (
                <button
                  type="button"
                  key={type}
                  style={{ '--callout-accent': definition.accent, '--callout-background': definition.background } as CSSProperties}
                  onClick={() => insertCallout(type)}
                >
                  <CalloutIcon type={type} size={15} />
                  <span>{definition.label}</span>
                </button>
              )
            })}
          </div>
          <button type="button" className="panel-close" onClick={() => setShowCallouts(false)} aria-label="关闭提示块选择"><X size={15} /></button>
        </div>
      )}

      <BubbleMenu
        editor={editor}
        pluginKey="selectionFormattingMenu"
        updateDelay={0}
        resizeDelay={30}
        appendTo={document.body}
        shouldShow={({ editor: currentEditor, element, view, state, from, to }) => (
          currentEditor.isEditable
          && state.selection instanceof TextSelection
          && !state.selection.empty
          && Boolean(state.doc.textBetween(from, to).trim())
          && !currentEditor.isActive('codeBlock')
          && (view.hasFocus() || element.contains(document.activeElement))
        )}
        options={{
          strategy: 'fixed',
          placement: 'top',
          offset: 10,
          flip: { fallbackPlacements: ['bottom'] },
          shift: { padding: 10 },
          inline: true,
          scrollTarget: bubbleScrollTarget,
        }}
        className="selection-bubble-menu"
        role="toolbar"
        aria-label="选中文字快捷排版"
      >
        <div className="selection-bubble-group selection-bubble-blocks">
          <ToolButton label="正文" shortcut="Ctrl+Alt+0" active={!editorState?.h1 && !editorState?.h2 && !editorState?.h3} onClick={() => editor.chain().focus().setParagraph().run()}><Pilcrow size={15} /></ToolButton>
          <ToolButton label="一级标题" shortcut="Ctrl+Alt+1" active={editorState?.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></ToolButton>
          <ToolButton label="二级标题" shortcut="Ctrl+Alt+2" active={editorState?.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolButton>
        </div>
        <div className="selection-bubble-group">
          <ToolButton label="加粗" shortcut="Ctrl+B" active={editorState?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolButton>
          <ToolButton label="斜体" shortcut="Ctrl+I" active={editorState?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolButton>
          <ToolButton label="下划线" shortcut="Ctrl+U" active={editorState?.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></ToolButton>
        </div>
        <div className="selection-bubble-group">
          <label className="editor-color-tool" title="文字颜色">
            <PaintBucket size={15} />
            <input type="color" defaultValue="#1648ff" aria-label="选中文字颜色" onChange={event => editor.chain().focus().setColor(event.target.value).run()} />
          </label>
          <label className="editor-color-tool" title="文字高亮">
            <Highlighter size={15} />
            <input type="color" defaultValue="#fff3a3" aria-label="选中文字高亮" onChange={event => editor.chain().focus().setHighlight({ color: event.target.value }).run()} />
          </label>
        </div>
        <div className="selection-bubble-group">
          <ToolButton label="重点引用" active={editorState?.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></ToolButton>
          <ToolButton label="插入链接" shortcut="Ctrl+K" active={editorState?.link} onClick={openLinkPanel}><Link2 size={15} /></ToolButton>
          {editorState?.link && <ToolButton label="移除链接" onClick={() => editor.chain().focus().unsetLink().run()}><Unlink size={15} /></ToolButton>}
          <ToolButton label="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={15} /></ToolButton>
        </div>
      </BubbleMenu>

      {showLink && (
        <div className="editor-inline-panel link-panel" role="dialog" aria-label="插入链接">
          <Link2 size={16} />
          <input ref={linkInputRef} value={linkValue} onChange={event => setLinkValue(event.target.value)} onKeyDown={event => event.key === 'Enter' && applyLink()} aria-label="链接地址" />
          <button type="button" onClick={applyLink}><Check size={15} /> 应用</button>
          <button type="button" className="panel-close" onClick={() => setShowLink(false)} aria-label="关闭链接设置"><X size={15} /></button>
        </div>
      )}

      {showSearch && (
        <div className="editor-inline-panel search-panel" role="search">
          <label>查找<input ref={searchInputRef} value={findText} onChange={event => setFindText(event.target.value)} onKeyDown={event => event.key === 'Enter' && findNext()} /></label>
          <label>替换为<input value={replaceText} onChange={event => setReplaceText(event.target.value)} /></label>
          <span className="match-count">{findText ? `${matchCount} 处` : '输入关键词'}</span>
          <button type="button" onClick={findNext} disabled={!matchCount}>下一处</button>
          <button type="button" onClick={replaceCurrent} disabled={!matchCount}>替换当前</button>
          <button type="button" onClick={replaceAll} disabled={!matchCount}>全部替换</button>
          <button type="button" className="panel-close" onClick={() => setShowSearch(false)} aria-label="关闭查找替换"><X size={15} /></button>
        </div>
      )}

      {showFormatting && (
        <div className="formatting-panel" role="dialog" aria-label="文章排版设置">
          <div className="format-setting format-setting-wide">
            <span>主题</span>
            <div className="format-option-grid">
              {THEME_OPTIONS.map(option => (
                <button type="button" key={option.value} className={formatting.theme === option.value ? 'selected' : ''} onClick={() => updateFormatting('theme', option.value)}>
                  <strong>{option.label}</strong><small>{option.detail}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="format-setting">
            <span>字体</span>
            <div className="segmented-options">
              {FONT_OPTIONS.map(option => <button type="button" key={option.value} className={formatting.font === option.value ? 'selected' : ''} onClick={() => updateFormatting('font', option.value)}>{option.label}</button>)}
            </div>
          </div>
          <div className="format-setting">
            <span>字号</span>
            <div className="segmented-options">
              {SIZE_OPTIONS.map(option => <button type="button" key={option.value} className={formatting.fontSize === option.value ? 'selected' : ''} onClick={() => updateFormatting('fontSize', option.value)}>{option.label}</button>)}
            </div>
          </div>
          <div className="format-setting">
            <span>行距</span>
            <div className="segmented-options">
              {LINE_HEIGHT_OPTIONS.map(option => <button type="button" key={option.value} className={formatting.lineHeight === option.value ? 'selected' : ''} onClick={() => updateFormatting('lineHeight', option.value)}>{option.label}</button>)}
            </div>
          </div>
          <div className="format-setting">
            <span>主题色</span>
            <div className="accent-options">
              {ACCENT_OPTIONS.map(option => (
                <button type="button" key={option.value} className={formatting.accent === option.value ? 'selected' : ''} onClick={() => updateFormatting('accent', option.value)} title={option.label} aria-label={option.label}>
                  <i style={{ background: ARTICLE_ACCENT_COLORS[option.value] }} />
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="panel-close formatting-close" onClick={() => setShowFormatting(false)} aria-label="关闭排版设置"><X size={15} /></button>
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  )
}
