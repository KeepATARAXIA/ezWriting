import { useRef, type ComponentProps } from 'react'
import { SourceEditor } from './source-editor'
import { editorTitlePrefix, splitEditorDocument } from '../lib/article-editor-document'

type Props = Omit<ComponentProps<typeof SourceEditor>, 'onChange'> & {
  title: string
  onChange: (body: string, title: string) => void
}

// Keep title/body in one undo history without changing the storage or publishing contract.
export function ArticleEditor({ title, value, onChange, focusRequest, onActiveBlockChange, ...props }: Props) {
  const lastEdit = useRef<{ title: string; prefix: string } | null>(null)
  const prefix = lastEdit.current?.title === title ? lastEdit.current.prefix : editorTitlePrefix(title)
  const split = splitEditorDocument(prefix + value)
  return <SourceEditor {...props} titleInDocument value={prefix + value}
    focusRequest={focusRequest ? { ...focusRequest, line: focusRequest.line === 0 ? 1 : focusRequest.line + split.lineOffset } : null}
    onChange={text => {
      const next = splitEditorDocument(text)
      lastEdit.current = next
      onChange(next.body, next.title)
    }}
    onActiveBlockChange={location => onActiveBlockChange?.(location && location.blockIndex >= split.blockOffset
      ? { blockIndex: location.blockIndex - split.blockOffset, line: Math.max(1, location.line - split.lineOffset) }
      : null)} />
}
