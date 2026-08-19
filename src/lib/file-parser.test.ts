import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { FileParseError, parseContentFile, pickPrimaryContentFile } from './file-parser'

function fileAtPath(content: BlobPart[], name: string, path: string, type: string): File {
  const file = new File(content, name, { type })
  Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path })
  return file
}

describe('parseContentFile', () => {
  it('parses Markdown front matter and removes the title heading from the body', async () => {
    const file = new File([
      '---\ntitle: 发布测试\nsummary: 一段摘要\ntags: [AI, 工作流]\n---\n# 发布测试\n\n正文 **加粗**。',
    ], 'article.md', { type: 'text/markdown' })

    const article = await parseContentFile(file)

    expect(article.title).toBe('发布测试')
    expect(article.summary).toBe('一段摘要')
    expect(article.tags).toEqual(['AI', '工作流'])
    expect(article.html).toContain('<strong>加粗</strong>')
    expect(article.html).not.toContain('<h1>发布测试</h1>')
  })

  it('sanitizes unsafe HTML while preserving article content', async () => {
    const file = new File([
      '<html><head><title>安全测试</title></head><body><article><h1>安全测试</h1><p>正文</p><script>alert(1)</script><img src="x" onerror="alert(2)"></article></body></html>',
    ], 'article.html', { type: 'text/html' })

    const article = await parseContentFile(file)

    expect(article.title).toBe('安全测试')
    expect(article.html).toContain('<p>正文</p>')
    expect(article.html).not.toContain('<script')
    expect(article.html).not.toContain('onerror')
  })

  it('resolves images from a ZIP content package into local data URIs', async () => {
    const zip = new JSZip()
    zip.file('article.md', '# ZIP 测试\n\n![封面](assets/cover.png)')
    zip.file('assets/cover.png', new Uint8Array([137, 80, 78, 71]))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const file = new File([bytes.buffer as ArrayBuffer], 'package.zip', { type: 'application/zip' })

    const article = await parseContentFile(file)

    expect(article.title).toBe('ZIP 测试')
    expect(article.sourceKind).toBe('zip')
    expect(article.html).toContain('data:image/png;base64,')
    expect(article.warnings).toEqual([])
  })

  it('ignores a front-matter cover from a ZIP content package', async () => {
    const zip = new JSZip()
    zip.file('article.md', '---\ntitle: 封面测试\ncover: assets/cover.png\n---\n\n正文')
    zip.file('assets/cover.png', new Uint8Array([137, 80, 78, 71]))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const file = new File([bytes.buffer as ArrayBuffer], 'package.zip', { type: 'application/zip' })

    const article = await parseContentFile(file)

    expect(article).not.toHaveProperty('cover')
    expect(article.warnings).toEqual([])
    expect(article.missingAssets).toEqual([])
  })

  it('reports local Markdown images that were not selected', async () => {
    const file = new File(['# 缺图测试\n\n![流程图](assets/flow.png)'], 'article.md', { type: 'text/markdown' })

    const article = await parseContentFile(file)

    expect(article.missingAssets).toEqual(['assets/flow.png'])
    expect(article.warnings).toContain('未找到图片：assets/flow.png')
    expect(article.html).toContain('data-missing-asset="assets/flow.png"')
    expect(article.html).toContain('data-missing-id="missing-image-0"')
  })

  it('does not request a local front-matter cover that was not selected', async () => {
    const file = new File(['---\ntitle: 缺封面测试\ncover: assets/cover.png\n---\n\n正文'], 'article.md', { type: 'text/markdown' })

    const article = await parseContentFile(file)

    expect(article).not.toHaveProperty('cover')
    expect(article.missingAssets).toEqual([])
    expect(article.warnings).toEqual([])
  })

  it('resolves standard Markdown images from a selected article folder', async () => {
    const articleFile = fileAtPath(
      ['# 文件夹测试\n\n![流程图](assets/flow.png)'],
      'article.md',
      'project/article.md',
      'text/markdown',
    )
    const imageFile = fileAtPath(
      [new Uint8Array([137, 80, 78, 71])],
      'flow.png',
      'project/assets/flow.png',
      'image/png',
    )

    const article = await parseContentFile(articleFile, [imageFile])

    expect(article.html).toContain('data:image/png;base64,')
    expect(article.missingAssets).toEqual([])
  })

  it('resolves Obsidian image embeds and supplemental images by file name', async () => {
    const articleFile = new File(['# Obsidian 测试\n\n![[附件/结构图.png]]'], 'note.md', { type: 'text/markdown' })
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], '结构图.png', { type: 'image/png' })

    const article = await parseContentFile(articleFile, [imageFile])

    expect(article.html).toContain('alt="结构图"')
    expect(article.html).toContain('data:image/png;base64,')
    expect(article.missingAssets).toEqual([])
  })

  it('imports Obsidian callouts as semantic article blocks', async () => {
    const file = new File([
      '# 同步教程\n\n> [!warning] 先备份，再接入同步\n> 第一次配置时，先选一台设备作为主设备。',
    ], 'article.md', { type: 'text/markdown' })

    const article = await parseContentFile(file)

    expect(article.title).toBe('同步教程')
    expect(article.html).toContain('data-callout="warning"')
    expect(article.html).toContain('data-callout-title="先备份，再接入同步"')
    expect(article.html).not.toContain('[!warning]')
  })

  it('prefers article.md when a selected folder contains multiple documents', () => {
    const readme = fileAtPath(['说明'], 'README.md', 'project/README.md', 'text/markdown')
    const article = fileAtPath(['正文'], 'article.md', 'project/article.md', 'text/markdown')

    expect(pickPrimaryContentFile([readme, article])).toBe(article)
  })

  it('rejects unsupported file formats', async () => {
    const file = new File(['content'], 'article.docx')
    await expect(parseContentFile(file)).rejects.toBeInstanceOf(FileParseError)
  })
})
