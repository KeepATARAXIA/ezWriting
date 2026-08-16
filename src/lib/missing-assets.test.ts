import { describe, expect, it } from 'vitest'
import { deleteMissingImage, extractMissingImageTargets, renderMissingImagePlaceholders, replaceMissingImage } from './missing-assets'

const missingHtml = '<p>前文</p><p><img src="assets/flow.png" alt="流程图" data-missing-id="missing-image-0" data-missing-asset="assets/flow.png"></p>'

describe('missing image helpers', () => {
  it('renders actionable placeholders without keeping the broken image', () => {
    const preview = renderMissingImagePlaceholders(missingHtml)

    expect(preview).not.toContain('<img')
    expect(preview).toContain('class="missing-image-card"')
    expect(preview).toContain('重新链接')
    expect(preview).toContain('替换图片')
    expect(preview).toContain('删除')
  })

  it('replaces the exact missing node and clears its missing metadata', () => {
    const [target] = extractMissingImageTargets(missingHtml)
    const next = replaceMissingImage(missingHtml, target, 'data:image/png;base64,AAAA', 'replacement.png')

    expect(next).toContain('data:image/png;base64,AAAA')
    expect(next).toContain('alt="replacement.png"')
    expect(extractMissingImageTargets(next)).toEqual([])
  })

  it('deletes the exact missing node and its empty paragraph wrapper', () => {
    const [target] = extractMissingImageTargets(missingHtml)
    const next = deleteMissingImage(missingHtml, target)

    expect(next).toBe('<p>前文</p>')
    expect(extractMissingImageTargets(next)).toEqual([])
  })
})
