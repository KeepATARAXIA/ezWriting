import { StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

function titleRegion(state: EditorState): DecorationSet {
  const first = state.doc.line(1)
  const isHeading = /^\uFEFF? {0,3}#(?:[ \t]|$)/.test(first.text)
    || (state.doc.lines > 1 && /^ {0,3}=+[ \t]*$/.test(state.doc.line(2).text))
  if (!isHeading) return Decoration.none
  return Decoration.set([Decoration.line({ attributes: {
    class: 'cm-article-title',
    'aria-label': '文章标题',
    'data-title-empty': /^\s*#\s*$/.test(first.text) ? 'true' : 'false',
  } }).range(first.from)])
}

// Decorate the existing title, preserving shared undo and source coordinates.
export const articleTitleRegion = StateField.define<DecorationSet>({
  create: titleRegion,
  update: (current, transaction) => transaction.docChanged ? titleRegion(transaction.state) : current,
  provide: field => EditorView.decorations.from(field),
})
