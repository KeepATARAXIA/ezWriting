import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { PlatformPreviews } from './platform-previews'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'

it('preserves media nodes and decoded posters through controls, text edits and inserted blocks', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const media = '<p><img src="sample.gif" alt="GIF" /></p><video src="sample.mp4"></video>'
  const render = async (text: string, title = 'Title') => act(async () => {
    root.render(<PlatformPreviews activePlatform="wechat" title={title} html={text}
      formatting={DEFAULT_ARTICLE_FORMATTING} previewDevice="desktop" onPreviewDeviceChange={vi.fn()} />)
  })
  try {
    await render(`<p>First</p>${media}`)
    const images = [...container.querySelectorAll<HTMLImageElement>('.wechat-content img')]
    expect(images).toHaveLength(2)
    // Simulate completed asynchronous thumbnail decoding.
    images.forEach((image, index) => image.src = `blob:decoded-${index}`)
    await render(`<p>First</p>${media}`, 'Changed title')
    expect([...container.querySelectorAll('.wechat-content img')]).toEqual(images)
    await act(async () => container.querySelector<HTMLButtonElement>('.preview-settings-toggle')!.click())
    expect([...container.querySelectorAll('.wechat-content img')]).toEqual(images)
    await render(`<p>Inserted</p><p>First edited</p>${media}`)
    expect([...container.querySelectorAll('.wechat-content img')]).toEqual(images)
    expect(images.map(image => image.getAttribute('src'))).toEqual(['blob:decoded-0', 'blob:decoded-1'])
    expect(container.querySelector('.wechat-content')?.textContent).toContain('First edited')
    await render(`<p>First edited</p><img src="inserted.png" />${media}`)
    expect(container.querySelector('.wechat-content img[alt="GIF"]')).toBe(images[0])
    expect(container.querySelector('.wechat-content .ez-static-video')).toBe(images[1])
    await render(`<p>First edited</p>${media}`)
    expect([...container.querySelectorAll('.wechat-content img')]).toEqual(images)
    await render('<p>All media removed</p>')
    expect(container.querySelectorAll('.wechat-content img')).toHaveLength(0)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
