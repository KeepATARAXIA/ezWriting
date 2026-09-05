export type WorkspaceMode = 'editor' | 'split' | 'preview'
export function readDefaultWorkspaceMode(): WorkspaceMode {
  try {
    const value = window.localStorage.getItem('dispatch.default-workspace.v1')
    return value === 'editor' || value === 'preview' ? value : 'split'
  } catch { return 'split' }
}
export function readShowSyntax(): boolean {
  try { return window.localStorage.getItem('dispatch.show-syntax.v1') === 'true' } catch { return false }
}
export function readEditorRowStripes(): boolean {
  try { return window.localStorage.getItem('dispatch.editor-row-stripes.v1') !== 'false' } catch { return true }
}
export function saveWorkbenchPreference(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* Preferences still apply to this session. */ }
}
