import { expect, test } from '@playwright/test'

const SAMPLE_WEBM = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAKFEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggJv7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMUSJiEBxgAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYi+osIW4IWmLZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgkLCBoLqBWpqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMXNz2mPAi2PFiL6iwhbghaYtZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDEgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuMjgwMDAwMDAwAB9DtnVAvueBAKOvgQAAgIJJg0IACfAFlgA4JBwY9gAAMGAAAHk7/+El///+2g///3oc/S6P71LiwACjlYEAKACGAECSHABZAAADIAAAWfmG4KOVgQBQAIYAQJKcAFgAAAMgAABZ+Ybgo5WBAHgAhgBAkhwAWQAAAyAAAFn5huCjlYEAoACGAECSnABWoAADIAAAWfmG4KOVgQDIAIYAQJIcAFkAAAMgAABZ+Ybgo5WBAPAAhgBAkpwAWAAAAyAAAFn5huAcU7trkbuPs4EAt4r3gQHxggGr8IED'

test('uploads, previews, saves, and restores a local video with static right-side previews', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始写稿' }).click()

  await page.locator('input[accept=".mp4,.webm,video/mp4,video/webm"]').setInputFiles({
    name: '产品演示.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(SAMPLE_WEBM, 'base64'),
  })

  const editorVideo = page.locator('.source-video-widget video')
  const wechatVideo = page.locator('.wechat-content .ez-static-video')
  await expect(editorVideo).toHaveCount(0)
  await page.getByRole('button', { name: '播放视频：产品演示.webm', exact: true }).click()
  await expect(editorVideo).toBeVisible()
  await expect(wechatVideo).toBeVisible()
  await expect(wechatVideo).not.toHaveAttribute('controls', '')
  await expect(wechatVideo).toHaveAttribute('data-ez-video-preview', 'static')
  await expect(page.locator('.wechat-content video')).toHaveCount(0)
  await expect(page.locator('.source-video-widget')).toContainText('产品演示.webm')
  await expect.poll(() => editorVideo.evaluate(video => {
    const media = video as HTMLVideoElement
    return media.duration > 0 && media.videoHeight === 90 && media.videoWidth === 160
  })).toBe(true)
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')

  await page.reload()
  await expect(page.locator('.source-video-widget .media-play-toggle')).toBeVisible()
  await expect(page.locator('.source-video-widget video')).toHaveCount(0)
  await expect(page.locator('.wechat-content .ez-static-video')).toBeVisible()
  await expect(page.locator('.wechat-content .ez-static-video')).toHaveAttribute('src', /^blob:/)

  await page.getByRole('tab', { name: '小红书' }).click()
  await expect(page.locator('.xhs-card-page [data-ez-video-placeholder]').first()).toContainText('发布时请在小红书原生上传')
  await expect(page.locator('.xhs-card-page video')).toHaveCount(0)

  await page.getByRole('tab', { name: 'X 长文' }).click()
  await expect(page.locator('.x-article-content .ez-static-video')).toBeVisible()
  await expect(page.locator('.x-article-content video')).toHaveCount(0)
  await page.getByRole('button', { name: '播放视频：产品演示.webm', exact: true }).click()
  await expect(page.locator('.source-video-widget video')).toBeVisible()
  await page.getByRole('tab', { name: /^资源/ }).click()
  await expect(page.locator('.source-video-widget video')).toHaveCount(1)
  await expect(page.locator('.resource-sidebar video')).toHaveCount(0)
})

test('keeps the workbench responsive while saving and restoring a 10 MiB local video', async ({ context, page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/')
  await page.getByRole('button', { name: '开始写稿' }).click()
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  const cdp = await context.newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  const baselineHeapBytes = await page.evaluate(() => (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory?.usedJSHeapSize ?? 0)
  await page.evaluate(() => {
    ;(window as unknown as { __ezLongTasks: Array<{ start: number; duration: number }> }).__ezLongTasks = []
    new PerformanceObserver(list => {
      ;(window as unknown as { __ezLongTasks: Array<{ start: number; duration: number }> }).__ezLongTasks.push(
        ...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })),
      )
    }).observe({ type: 'longtask' })
  })
  const uploadStartedAt = await page.evaluate(() => performance.now())
  const bytes = Buffer.alloc(10 * 1024 * 1024)
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0)
  await page.locator('input[accept=".mp4,.webm,video/mp4,video/webm"]').setInputFiles({
    name: '十兆性能回归.webm',
    mimeType: 'video/webm',
    buffer: bytes,
  })

  await expect(page.locator('.source-video-widget')).toBeVisible({ timeout: 20_000 })
  const widgetReadyAt = await page.evaluate(() => performance.now())
  expect(widgetReadyAt - uploadStartedAt).toBeLessThan(2_000)
  await expect(page.getByLabel('本地保存状态')).toHaveText('待保存', { timeout: 10_000 })
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存', { timeout: 30_000 })
  await expect(page.locator('.app-shell')).toBeVisible()
  const appLongTasks = await page.evaluate(() => {
    return (window as unknown as { __ezLongTasks: Array<{ start: number; duration: number }> }).__ezLongTasks
  }).then(tasks => tasks.filter(task => task.start >= widgetReadyAt))
  expect(Math.max(0, ...appLongTasks.map(task => task.duration))).toBeLessThan(500)
  await cdp.send('HeapProfiler.collectGarbage')
  const savedHeapBytes = await page.evaluate(() => (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory?.usedJSHeapSize ?? 0)
  expect(savedHeapBytes - baselineHeapBytes).toBeLessThan(20 * 1024 * 1024)
  expect(pageErrors).toEqual([])

  await page.reload()
  await expect(page.locator('.source-video-widget')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.app-shell')).toBeVisible()
  expect(pageErrors).toEqual([])
})
