import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchErrorBoundary } from './workbench-error-boundary'

function BrokenPanel(): never {
  throw new Error('preview failed')
}

describe('WorkbenchErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps a panel failure contained and retries after its input changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(
      <WorkbenchErrorBoundary resetKey="broken" fallback={<div role="alert">预览失败</div>}>
        <BrokenPanel />
      </WorkbenchErrorBoundary>,
    ))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('预览失败')

    await act(async () => root.render(
      <WorkbenchErrorBoundary resetKey="fixed" fallback={<div role="alert">预览失败</div>}>
        <div>恢复完成</div>
      </WorkbenchErrorBoundary>,
    ))
    expect(container.textContent).toBe('恢复完成')
    await act(async () => root.unmount())
  })
})
