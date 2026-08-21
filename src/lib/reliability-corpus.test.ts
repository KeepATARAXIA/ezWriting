import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import markdownBaseline from '../test-fixtures/reliability/markdown-baseline.md?raw'
import missingAssets from '../test-fixtures/reliability/missing-assets.md?raw'
import obsidianComplex from '../test-fixtures/reliability/obsidian-complex.md?raw'
import paginationStress from '../test-fixtures/reliability/pagination-stress.md?raw'
import unsafeImport from '../test-fixtures/reliability/unsafe-import.html?raw'
import { parseContentFile } from './file-parser'
import { paginateForXhsCards } from './xhs-pagination'

describe('reliability corpus', () => {
  it('normalizes the baseline Markdown into one canonical article', async () => {
    const article = await parseContentFile(new File([markdownBaseline], 'baseline.md', { type: 'text/markdown' }))

    expect(article.title).toBe('Reliability Baseline')
    expect(article.summary).toContain('repeatable import checks')
    expect(article.tags).toEqual(['reliability', 'local-first'])
    expect(article.html).toContain('<strong>bold text</strong>')
    expect(article.html).not.toContain('<h1>Reliability Baseline</h1>')
  })

  it('preserves Obsidian and GFM structures needed by platform formatting', async () => {
    const article = await parseContentFile(new File([obsidianComplex], 'obsidian.md', { type: 'text/markdown' }))

    expect(article.html).toContain('data-callout="warning"')
    expect(article.html).toContain('data-checked="true"')
    expect(article.html).toContain('<table>')
    expect(article.html).toContain('<pre><code')
  })

  it('keeps every stress marker after deterministic Xiaohongshu pagination', async () => {
    const article = await parseContentFile(new File([paginationStress], 'stress.md', { type: 'text/markdown' }))
    const pages = paginateForXhsCards(article.html, { title: article.title })
    const combined = pages.join(' ')

    expect(pages.length).toBeGreaterThan(1)
    for (const marker of ['Section 01', 'Section 02', 'Section 03', 'Section 04', 'Section 05', 'Section 06', 'Section 07', 'Section 08', 'line-08', 'fifth row']) {
      expect(combined).toContain(marker)
    }
    expect(combined.match(/final-reliability-marker/g)).toHaveLength(1)
  })

  it('turns both missing image syntaxes into actionable placeholders', async () => {
    const article = await parseContentFile(new File([missingAssets], 'missing.md', { type: 'text/markdown' }))

    expect(article.missingAssets).toEqual(['assets/standard-missing.png', 'assets/obsidian-missing.jpg'])
    expect(article.html.match(/data-missing-id=/g)).toHaveLength(2)
  })

  it('removes executable HTML while retaining safe content and missing assets', async () => {
    const article = await parseContentFile(new File([unsafeImport], 'unsafe.html', { type: 'text/html' }))

    expect(article.html).toContain('Safe paragraph')
    expect(article.html).not.toContain('<script')
    expect(article.html).not.toContain('<iframe')
    expect(article.html).not.toContain('onclick')
    expect(article.html).not.toContain('onerror')
    expect(article.missingAssets).toEqual(['assets/local.png'])
  })

  it('reproduces a ZIP package with a local image without committing a binary fixture', async () => {
    const zip = new JSZip()
    zip.file('article.md', `${markdownBaseline}\n\n![Local image](assets/local.png)`)
    zip.file('assets/local.png', new Uint8Array([137, 80, 78, 71]))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const article = await parseContentFile(new File([bytes.buffer as ArrayBuffer], 'fixture.zip', { type: 'application/zip' }))

    expect(article.sourceKind).toBe('zip')
    expect(article.html).toContain('data:image/png;base64,')
    expect(article.missingAssets).toEqual([])
  })
})
