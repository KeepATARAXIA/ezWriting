import { expect, test } from '@playwright/test'

test('single Enter stays visible and independently selectable across platforms and copying', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items: ClipboardItem[]) => {
      Object.assign(window, { __lineCopy: await (await items[0].getType('text/html')).text() })
    } } })
  })
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'enter.md', mimeType: 'text/markdown', buffer: Buffer.from('# 单次回车\n\n第一行') })
  await page.locator('.cm-content').press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('第二行')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('第三行')
  await page.locator('.topbar-document-title').click()
  for (const platform of ['微信公众号', '小红书', 'X 长文']) {
    await page.getByRole('tab', { name: platform, exact: true }).click()
    const scope = page.locator('.platform-preview-viewport')
    const first = scope.locator('[data-source-block="0"][data-source-line="1"]').first()
    const second = scope.locator('[data-source-block="0"][data-source-line="2"]').first()
    await expect(second).toHaveText('第二行')
    expect((await second.boundingBox())!.y).toBeGreaterThan((await first.boundingBox())!.y)
    await second.click()
    await expect(page.locator('.source-focus-line')).toHaveText('第二行')
    await expect(second).toHaveAttribute('data-preview-selected', 'true')
    await expect(first).not.toHaveAttribute('data-preview-selected', 'true')
    if (platform !== '小红书') {
      await page.getByRole('button', { name: platform === '微信公众号' ? '复制公众号格式' : '复制 X 长文格式', exact: true }).click()
      const copy = await page.evaluate(() => {
        const html = (window as unknown as { __lineCopy: string }).__lineCopy
        const doc = new DOMParser().parseFromString(html, 'text/html')
        return { br: doc.querySelectorAll('p br').length, text: doc.body.textContent }
      })
      expect(copy.br).toBe(2)
      expect(copy.text).toContain('第二行')
      await page.keyboard.press('Escape')
    }
  }
  await page.getByRole('tab', { name: '微信公众号', exact: true }).click()
  await page.screenshot({ path: info.outputPath('single-enter.png') })
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await page.reload()
  await expect(page.locator('.wechat-content [data-source-line="2"]')).toHaveText('第二行')
})

test('uses a nonblack opening video frame and centers the idle play control', async ({ page }, info) => {
  await page.goto('/')
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 180
    const context = canvas.getContext('2d')!
    const stream = canvas.captureStream(20)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
    const chunks: Blob[] = []
    const recorded = new Promise<Blob>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data)
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
    })
    const start = performance.now()
    const timer = setInterval(() => {
      context.fillStyle = performance.now() - start < 220 ? '#000' : '#ff7a22'
      context.fillRect(0, 0, 320, 180)
    }, 40)
    recorder.start()
    await new Promise(resolve => setTimeout(resolve, 1100))
    recorder.stop(); clearInterval(timer); stream.getTracks().forEach(track => track.stop())
    return Array.from(new Uint8Array(await (await recorded).arrayBuffer()))
  })
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  await page.locator('.cm-content').press('Control+End')
  await page.locator('input[accept=".mp4,.webm,video/mp4,video/webm"]').setInputFiles({ name: '黑色片头.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) })
  const poster = page.locator('.source-video-media > img')
  await expect(poster).toHaveAttribute('data-ez-poster', 'ready')
  await expect.poll(() => poster.evaluate(image => {
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const context = canvas.getContext('2d')!
    context.drawImage(image as HTMLImageElement, 0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[0]
  })).toBeGreaterThan(200)
  const play = page.getByRole('button', { name: '播放视频：黑色片头.webm', exact: true })
  await expect(play).toHaveCSS('font-size', '0px')
  const button = (await play.boundingBox())!
  const media = (await page.locator('.source-video-media').boundingBox())!
  expect(button.x + button.width / 2).toBeCloseTo(media.x + media.width / 2, 0)
  expect(button.y + button.height / 2).toBeCloseTo(media.y + media.height / 2, 0)
  const url = await poster.getAttribute('src')
  await page.screenshot({ path: info.outputPath('video-poster-play.png') })
  await play.click()
  await expect(page.locator('.source-video-media video')).toBeVisible()
  await page.getByRole('button', { name: '停止播放视频：黑色片头.webm', exact: true }).click()
  await expect(page.locator('.source-video-media video')).toHaveCount(0)
  await expect(poster).toHaveAttribute('src', url!)
  await expect(poster).toBeVisible()
  await expect(page.locator('.wechat-content .ez-static-video')).toHaveAttribute('src', url!)
})
