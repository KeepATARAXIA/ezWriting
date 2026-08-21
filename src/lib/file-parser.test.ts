import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import {
  FileParseError,
  parseContentFile,
  pickPrimaryContentFile,
  selectImageResourceFiles,
  validateImageResourceFiles,
} from './file-parser'

type TestStreamCallback = ((chunk: Uint8Array) => void) | (() => void) | ((error: Error) => void)

interface TestZipStream {
  on(event: 'data' | 'end' | 'error', callback: TestStreamCallback): TestZipStream
  pause(): TestZipStream
  resume(): TestZipStream
}

interface TestStreamableZipEntry {
  internalStream(type: 'uint8array'): TestZipStream
}

function fileAtPath(content: BlobPart[], name: string, path: string, type: string): File {
  const file = new File(content, name, { type })
  Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path })
  return file
}

function replaceAscii(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const fromBytes = new TextEncoder().encode(from)
  const toBytes = new TextEncoder().encode(to)
  if (fromBytes.length !== toBytes.length) throw new Error('Replacement length must match.')

  const result = bytes.slice()
  for (let offset = 0; offset <= result.length - fromBytes.length; offset += 1) {
    if (!fromBytes.every((value, index) => result[offset + index] === value)) continue
    result.set(toBytes, offset)
    offset += fromBytes.length - 1
  }
  return result
}

function forgeCentralUncompressedSize(bytes: Uint8Array, entryName: string, size: number): Uint8Array {
  const result = bytes.slice()
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
  const encodedName = new TextEncoder().encode(entryName)

  for (let offset = 0; offset + 46 <= result.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    const nameBytes = view.getUint16(offset + 28, true)
    if (nameBytes !== encodedName.length) continue
    const matches = encodedName.every((value, index) => result[offset + 46 + index] === value)
    if (!matches) continue
    view.setUint32(offset + 24, size, true)
    return result
  }

  throw new Error(`Central directory entry not found: ${entryName}`)
}

describe('parseContentFile', () => {
  it('reports stage timings without recording the source filename or content', async () => {
    const onDiagnostic = vi.fn()
    const file = new File(['# 私密标题\n\n私密正文'], 'private-draft.md', { type: 'text/markdown' })

    await parseContentFile(file, [], { operation: 'replace', onDiagnostic })

    expect(onDiagnostic).toHaveBeenCalledOnce()
    const diagnostic = onDiagnostic.mock.calls[0][0]
    expect(diagnostic).toMatchObject({
      version: 1,
      outcome: 'success',
      operation: 'replace',
      source: { kind: 'markdown', bytes: file.size },
      warningCount: 0,
      missingAssetCount: 0,
    })
    expect(diagnostic.totalMs).toBeGreaterThanOrEqual(0)
    expect(diagnostic.stageMs).toEqual(expect.objectContaining({
      validate: expect.any(Number),
      read: expect.any(Number),
      assets: expect.any(Number),
      render: expect.any(Number),
    }))
    expect(JSON.stringify(diagnostic)).not.toContain('private-draft.md')
    expect(JSON.stringify(diagnostic)).not.toContain('私密正文')
  })

  it('reports validation failures with a stable error code', async () => {
    const onDiagnostic = vi.fn()
    const file = new File(['unsupported'], 'private.txt', { type: 'text/plain' })

    await expect(parseContentFile(file, [], { onDiagnostic })).rejects.toThrow(FileParseError)

    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'error',
      errorCode: 'invalid-input',
      source: expect.objectContaining({ kind: 'unsupported' }),
    }))
  })

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
      '<html><head><title>安全测试</title></head><body><article><h1>安全测试</h1><p>正文</p><script>alert(1)</script><img src="https://example.test/image.png" onerror="alert(2)" data-missing-id="forged" data-missing-asset="secrets.png"><video autoplay poster="https://example.test/poster.png" src="https://example.test/video.mp4"></video><table background="https://example.test/tracker.png"><tr><td>表格</td></tr></table></article></body></html>',
    ], 'article.html', { type: 'text/html' })

    const article = await parseContentFile(file)

    expect(article.title).toBe('安全测试')
    expect(article.html).toContain('<p>正文</p>')
    expect(article.html).not.toContain('<script')
    expect(article.html).not.toContain('onerror')
    expect(article.html).not.toContain('data-missing-id')
    expect(article.html).not.toContain('data-missing-asset')
    expect(article.html).not.toContain('<video')
    expect(article.html).not.toContain('background=')
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

  it('rejects ZIP entries whose paths collide after normalization', async () => {
    const zip = new JSZip()
    zip.file('article.md', '# 重复路径测试')
    zip.file('assets/cover.png', new Uint8Array([1]))
    zip.file('assets//cover.png', new Uint8Array([2]))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const file = new File([bytes.buffer as ArrayBuffer], 'duplicate-paths.zip', { type: 'application/zip' })

    await expect(parseContentFile(file)).rejects.toThrow('ZIP 包含重复的文件路径：assets/cover.png')
  })

  it('rejects duplicate central-directory entries even when JSZip would fold their names', async () => {
    const zip = new JSZip()
    zip.file('article.md', '# 重复目录项测试')
    zip.file('assets/a.png', new Uint8Array([1]))
    zip.file('assets/b.png', new Uint8Array([2]))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const duplicatedBytes = replaceAscii(bytes, 'assets/b.png', 'assets/a.png')
    const file = new File([duplicatedBytes.buffer as ArrayBuffer], 'duplicate-entries.zip', { type: 'application/zip' })

    await expect(parseContentFile(file)).rejects.toThrow('ZIP 包含重复的文件路径：assets/a.png')
  })

  it('stops a forged-size ZIP entry while streaming instead of fully expanding it', async () => {
    const zip = new JSZip()
    zip.file('article.md', new Uint8Array(9 * 1024 * 1024).fill(65))
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    const forgedBytes = forgeCentralUncompressedSize(bytes, 'article.md', 1)
    const file = new File([forgedBytes.buffer as ArrayBuffer], 'forged-size.zip', { type: 'application/zip' })
    const onDiagnostic = vi.fn()
    const originalLoadAsync = JSZip.loadAsync.bind(JSZip)
    let streamedBytes = 0
    const loadSpy = vi.spyOn(JSZip, 'loadAsync').mockImplementation(async (data, options) => {
      const loaded = await originalLoadAsync(data, options)
      const entry = loaded.file('article.md')
      if (!entry) return loaded

      const streamableEntry = entry as unknown as TestStreamableZipEntry
      const originalInternalStream = streamableEntry.internalStream.bind(streamableEntry)
      streamableEntry.internalStream = () => {
        const source = originalInternalStream('uint8array')
        const proxy = {
          on(event: 'data' | 'end' | 'error', callback: TestStreamCallback) {
            if (event === 'data') {
              source.on('data', (chunk: Uint8Array) => {
                streamedBytes += chunk.byteLength
                ;(callback as (chunk: Uint8Array) => void)(chunk)
              })
            } else if (event === 'end') {
              source.on('end', callback as () => void)
            } else {
              source.on('error', callback as (error: Error) => void)
            }
            return proxy
          },
          pause() {
            source.pause()
            return proxy
          },
          resume() {
            source.resume()
            return proxy
          },
        } as TestZipStream
        return proxy
      }
      return loaded
    })

    try {
      await expect(parseContentFile(file, [], { onDiagnostic })).rejects.toThrow('文件 article.md 超过 8 MB。')
      expect(streamedBytes).toBeGreaterThan(8 * 1024 * 1024)
      expect(streamedBytes).toBeLessThanOrEqual(8 * 1024 * 1024 + 64 * 1024)
      expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'error',
        errorCode: 'invalid-input',
      }))
    } finally {
      loadSpy.mockRestore()
    }
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

  it('rejects a zero-byte article instead of creating a silent blank draft', async () => {
    const file = new File([], 'empty.md', { type: 'text/markdown' })
    await expect(parseContentFile(file)).rejects.toThrow('文章文件为空')
  })
})

describe('validateImageResourceFiles', () => {
  function sizedImage(name: string, size: number): File {
    const file = new File([], name, { type: 'image/png' })
    Object.defineProperty(file, 'size', { configurable: true, value: size })
    return file
  }

  it('accepts the supported image resource formats', () => {
    const files = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].map(extension => (
      new File(['image'], `asset.${extension}`)
    ))

    expect(validateImageResourceFiles(files)).toBe(files)
  })

  it('rejects unsupported resource formats', () => {
    const files = [new File(['not an image'], 'notes.txt', { type: 'text/plain' })]

    expect(() => validateImageResourceFiles(files)).toThrow('图片资源仅支持')
  })

  it('enforces image count, per-file size, and total size limits', () => {
    const tooMany = Array.from({ length: 121 }, (_, index) => sizedImage(`${index}.png`, 1))
    const tooLarge = [sizedImage('large.png', 8 * 1024 * 1024 + 1)]
    const tooLargeInTotal = Array.from({ length: 4 }, (_, index) => sizedImage(`${index}.png`, 8 * 1024 * 1024))

    expect(() => validateImageResourceFiles(tooMany)).toThrow('图片文件数量不能超过 120 个')
    expect(() => validateImageResourceFiles(tooLarge)).toThrow('存在超过 8 MB 的单张图片')
    expect(() => validateImageResourceFiles(tooLargeInTotal)).toThrow('图片总大小不能超过 30 MB')
  })
})

describe('selectImageResourceFiles', () => {
  function sizedImage(name: string, size: number): File {
    const file = new File([], name, { type: 'image/png' })
    Object.defineProperty(file, 'size', { configurable: true, value: size })
    return file
  }

  it('ignores unrelated folder entries and keeps supported images', () => {
    const image = new File(['image'], 'flow.png', { type: 'image/png' })
    const files = [
      new File(['# article'], 'article.md', { type: 'text/markdown' }),
      new File(['metadata'], '.DS_Store', { type: 'application/octet-stream' }),
      image,
    ]

    expect(selectImageResourceFiles(files)).toEqual([image])
  })

  it('reports a clear error when the selection contains no supported images', () => {
    const files = [
      new File(['# article'], 'article.md', { type: 'text/markdown' }),
      new File(['metadata'], '.DS_Store', { type: 'application/octet-stream' }),
    ]

    expect(() => selectImageResourceFiles(files)).toThrow('没有找到支持的图片文件')
  })

  it('still enforces image limits after unrelated files are ignored', () => {
    const unrelated = new File(['# article'], 'article.md', { type: 'text/markdown' })
    const tooMany = [unrelated, ...Array.from({ length: 121 }, (_, index) => sizedImage(`${index}.png`, 1))]
    const tooLarge = [unrelated, sizedImage('large.png', 8 * 1024 * 1024 + 1)]
    const tooLargeInTotal = [unrelated, ...Array.from({ length: 4 }, (_, index) => sizedImage(`${index}.png`, 8 * 1024 * 1024))]

    expect(() => selectImageResourceFiles(tooMany)).toThrow('图片文件数量不能超过 120 个')
    expect(() => selectImageResourceFiles(tooLarge)).toThrow('存在超过 8 MB 的单张图片')
    expect(() => selectImageResourceFiles(tooLargeInTotal)).toThrow('图片总大小不能超过 30 MB')
  })
})
