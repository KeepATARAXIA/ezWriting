import { expect, test } from '@playwright/test'

test('keeps editor, archive, YAML, and backup code off the homepage path', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '开始创作' })).toBeVisible()

  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => {
    const timing = entry as PerformanceResourceTiming
    return { name: timing.name, encodedBodySize: timing.encodedBodySize }
  }))
  const initialTransferBytes = resources.reduce((total, resource) => total + resource.encodedBodySize, 0)
  const optionalBundles = resources.filter(resource => /(?:source-editor|jszip\.min|local-backup|browser-).*\.js/i.test(resource.name))

  expect(optionalBundles).toEqual([])
  expect(initialTransferBytes).toBeLessThan(350 * 1024)
})

test('keeps long Xiaohongshu pagination responsive under 4x CPU slowdown', async ({ context, page }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const markdown = [
    '# 小红书长文性能回归',
    ...Array.from({ length: 191 }, (_, index) => (
      `第 ${index + 1} 段正文用于验证长文切换平台时仍能先响应界面，再在空闲阶段完成卡片分页。每段保留稳定长度。`
    )),
  ].join('\n\n')

  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'xhs-performance.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(markdown),
  })
  await expect(page.getByLabel('文章标题')).toHaveValue('小红书长文性能回归')
  await page.evaluate(() => {
    const metrics = window as unknown as {
      __ezXhsClickAt?: number
      __ezXhsLongTasks: Array<{ start: number; duration: number }>
    }
    metrics.__ezXhsLongTasks = []
    new PerformanceObserver(list => {
      metrics.__ezXhsLongTasks.push(...list.getEntries().map(entry => ({
        start: entry.startTime,
        duration: entry.duration,
      })))
    }).observe({ type: 'longtask' })
  })

  await page.evaluate(() => {
    ;(window as unknown as { __ezXhsClickAt?: number }).__ezXhsClickAt = performance.now()
  })
  await page.getByRole('tab', { name: '小红书' }).click()
  await expect(page.locator('.preview-sync-status')).toContainText('张卡片', { timeout: 10_000 })
  const metrics = await page.evaluate(() => {
    const values = window as unknown as {
      __ezXhsClickAt?: number
      __ezXhsLongTasks: Array<{ start: number; duration: number }>
    }
    const clickAt = values.__ezXhsClickAt ?? Number.POSITIVE_INFINITY
    return {
      settledMs: performance.now() - clickAt,
      longTasks: values.__ezXhsLongTasks.filter(task => task.start >= clickAt),
    }
  })
  expect(metrics.settledMs).toBeLessThan(4_000)
  expect(Math.max(0, ...metrics.longTasks.map(task => task.duration))).toBeLessThan(500)
  await expect(page.locator('.xhs-card-page').first()).toBeVisible()
})
