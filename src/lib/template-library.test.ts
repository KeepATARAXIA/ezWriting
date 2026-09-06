import { describe, expect, it } from 'vitest'
import { libraryTextForEditor, prepareLibraryImages } from './template-library'

describe('library content insertion', () => {
  it('preserves Markdown and converts it safely when inserting into HTML', () => {
    const item = { kind: 'text' as const, content: '**重点**\n\n- 一\n- 二', language: 'markdown' as const }
    expect(libraryTextForEditor(item, 'markdown')).toBe(item.content)
    expect(libraryTextForEditor(item, 'html')).toContain('<strong>重点</strong>')
    expect(libraryTextForEditor(item, 'html')).toContain('<li>一</li>')
  })
  it('sanitizes HTML and retains formatting when converting to Markdown', () => {
    const item = { kind: 'text' as const, content: '<p><strong>重点</strong></p><script>alert(1)</script><img src="x" onerror="alert(1)">', language: 'html' as const }
    expect(libraryTextForEditor(item, 'html')).not.toMatch(/script|onerror|alert/)
    expect(libraryTextForEditor(item, 'markdown')).toContain('**重点**')
    expect(libraryTextForEditor(item, 'markdown')).not.toContain('alert')
  })
  it('rejects non-image and oversized uploads before decoding', async () => {
    await expect(prepareLibraryImages([new File(['text'], 'notes.txt')])).rejects.toThrow('图片资源仅支持')
    await expect(prepareLibraryImages([new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png')])).rejects.toThrow('8 MB')
  })
})
