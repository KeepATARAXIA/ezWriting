// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newLibraryItem, type LibraryItem } from '../domain/template-library'
import { TemplateLibraryRepository } from './template-library-repository'

describe('TemplateLibraryRepository', () => {
  let name: string
  let repository: TemplateLibraryRepository
  const text = (title: string): LibraryItem => ({ ...newLibraryItem({ kind: 'text', content: '**常用结尾**\n\n欢迎交流。', language: 'markdown' }), title, category: '结尾' })
  beforeEach(() => {
    name = `library-test-${crypto.randomUUID()}`
    repository = new TemplateLibraryRepository(name)
  })
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  })

  it('persists text and image originals across repository instances', async () => {
    const blob = new Blob(['GIF89a'], { type: 'image/gif' })
    await repository.save([text('文字模板'), { ...newLibraryItem({ kind: 'image', blob }), title: '表情包', category: '表情包' }])
    const restored = await new TemplateLibraryRepository(name).list()
    expect(restored).toHaveLength(2)
    expect(restored.find(item => item.kind === 'text')).toMatchObject({ content: '**常用结尾**\n\n欢迎交流。', revision: 1, category: '结尾' })
    const image = restored.find(item => item.kind === 'image')!
    if (image.kind !== 'image') throw new Error('missing image')
    expect(image.blob.type).toBe('image/gif')
    expect(await image.blob.text()).toBe('GIF89a')
  })

  it('updates categories and content without creating a duplicate', async () => {
    await repository.save([text('旧名')])
    const [item] = await repository.list()
    await repository.save([{ ...item, title: '新名', category: '  开头  ' }])
    expect(await repository.list()).toMatchObject([{ title: '新名', category: '开头', revision: 2 }])
  })

  it('rejects stale updates and deletions without overwriting a newer edit', async () => {
    await repository.save([text('共享稿')])
    const [stale] = await repository.list()
    await new TemplateLibraryRepository(name).save([{ ...stale, title: '较新版本' }])
    await expect(repository.save([{ ...stale, title: '过期版本' }])).rejects.toThrow('其他窗口')
    await expect(repository.remove(stale)).rejects.toThrow('其他窗口')
    expect((await repository.list())[0].title).toBe('较新版本')
  })

  it('does not resurrect a deleted item from a stale form', async () => {
    await repository.save([text('删除测试')])
    const [item] = await repository.list()
    await repository.remove(item)
    await expect(repository.save([{ ...item, title: '过期表单' }])).rejects.toThrow('其他窗口')
    expect(await repository.list()).toEqual([])
  })

  it('rolls back the complete batch on conflicts and rejects invalid content', async () => {
    await repository.save([text('原模板')])
    const [stale] = await repository.list()
    await repository.save([{ ...stale, title: '新版' }])
    await expect(repository.save([text('不应写入'), stale])).rejects.toThrow('其他窗口')
    expect(await repository.list()).toHaveLength(1)
    await expect(repository.save([{ ...text('空模板'), kind: 'text', content: ' ', language: 'markdown' }])).rejects.toThrow('不能为空')
    await expect(repository.save([{ ...text('临时媒体'), kind: 'text', content: '![本机图片](blob:https://example.test/image)', language: 'markdown' }])).rejects.toThrow('临时媒体')
  })
})
