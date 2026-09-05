import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { renderArticleSource } from '../lib/article-source'
import { PlatformPreviews } from './platform-previews'

describe('single Enter preview targets', () => {
  it.each(['wechat', 'x'] as const)('locates each line independently in %s without adding blank source lines', async activePlatform => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onEditTarget = vi.fn()
    const source = '第一行 **强调内容**\n第二行 [链接](https://example.com)\n第三行'
    try {
      await act(async () => root.render(<PlatformPreviews activePlatform={activePlatform} title="单次回车" html={renderArticleSource(source, 'markdown')} sourceText={source} sourceLanguage="markdown" formatting={DEFAULT_ARTICLE_FORMATTING} previewDevice="desktop" onPreviewDeviceChange={vi.fn()} onEditTarget={onEditTarget} />))
      const second = container.querySelector<HTMLElement>('[data-source-block="0"][data-source-line="2"]')
      expect(second?.textContent).toBe('第二行 链接')
      expect(container.querySelectorAll('p br')).toHaveLength(2)
      await act(async () => second!.click())
      expect(onEditTarget).toHaveBeenLastCalledWith({ kind: 'body', blockIndex: 0, line: 2 })
      expect(second?.getAttribute('data-preview-selected')).toBe('true')
      expect(container.querySelector('p')?.hasAttribute('data-preview-selected')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
