import { act } from 'react'
import { EditorView } from '@codemirror/view'
import { vi } from 'vitest'

export async function createBlankInWorkbench(container: HTMLElement) {
  await act(async () => container.querySelector<HTMLButtonElement>('.new-document-button')!.click())
  await act(async () => container.querySelector<HTMLButtonElement>('.new-document-options button')!.click())
  await act(async () => { await vi.dynamicImportSettled(); await new Promise(resolve => setTimeout(resolve, 30)) })
}

export function editWorkbenchTitle(container: HTMLElement, title: string) {
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!
  view.dispatch({ changes: { from: 0, to: view.state.doc.line(1).to, insert: `# ${title}` } })
  view.contentDOM.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
}
