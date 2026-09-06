import type { LibraryItem } from '../domain/template-library'

export const LIBRARY_DRAG_TYPE = 'application/x-ezwriting-library-item'
let draggedItem: LibraryItem | null = null

export function startLibraryDrag(item: LibraryItem, transfer: DataTransfer): void {
  draggedItem = item
  transfer.effectAllowed = 'copy'
  transfer.setData(LIBRARY_DRAG_TYPE, item.id)
}

export function readLibraryDrag(transfer: DataTransfer): LibraryItem | null {
  return draggedItem?.id === transfer.getData(LIBRARY_DRAG_TYPE) ? draggedItem : null
}

export function endLibraryDrag(): void { draggedItem = null }
