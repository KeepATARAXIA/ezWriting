import { describe, expect, it, vi } from 'vitest'
import { parseContentFile } from './file-parser'

function fileAtPath(content: BlobPart[], name: string, path: string): File {
  const file = new File(content, name, { type: 'image/png' })
  Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path })
  return file
}

describe('large image import reliability', () => {
  it('normalizes a 34-image, roughly 11 MB article folder within 10 seconds', async () => {
    const imageCount = 34
    const imageBytes = 320 * 1024
    const markdown = [
      '# 批量图片性能基线',
      '',
      ...Array.from({ length: imageCount }, (_, index) => `![图片 ${index + 1}](assets/image-${index + 1}.png)`),
    ].join('\n\n')
    const article = new File([markdown], 'article.md', { type: 'text/markdown' })
    Object.defineProperty(article, 'webkitRelativePath', { configurable: true, value: 'project/article.md' })
    const images = Array.from({ length: imageCount }, (_, index) => fileAtPath(
      [new Uint8Array(imageBytes).fill(index)],
      `image-${index + 1}.png`,
      `project/assets/image-${index + 1}.png`,
    ))
    const onDiagnostic = vi.fn()

    const result = await parseContentFile(article, images, { onDiagnostic })
    const diagnostic = onDiagnostic.mock.calls[0][0]

    expect(result.missingAssets).toEqual([])
    expect(result.html.match(/data:image\/png;base64,/g)).toHaveLength(imageCount)
    expect(diagnostic.source.relatedBytes).toBe(imageCount * imageBytes)
    expect(diagnostic.totalMs).toBeLessThan(10_000)
  }, 20_000)
})
