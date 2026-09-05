import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Opt-in local benchmark: use the same fixture directory for before/after runs.
// Fixtures are excluded from the repository and the measurements are attachments.
const fixtureDirectory = process.env.EZ_MEDIA_FIXTURES
test.skip(!fixtureDirectory, 'Set EZ_MEDIA_FIXTURES to a directory containing large.gif and large.png')

for (const scenario of ['text', 'image', 'gif', 'video', 'mixed']) {
  test(`media profile: ${scenario}`, async ({ page, context }, testInfo) => {
    test.setTimeout(180_000)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.goto('/')
    const markdown = '# 媒体性能基线\n\n' + Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 段：${'性能测试正文。'.repeat(20)}`).join('\n\n')
    await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
      name: `${scenario}.md`, mimeType: 'text/markdown', buffer: Buffer.from(markdown),
    })
    await expect(page.getByLabel('文章标题')).toHaveValue('媒体性能基线')
    if (['image', 'gif', 'mixed'].includes(scenario)) {
      const type = scenario === 'image' ? 'png' : 'gif'
      await page.locator('.source-toolbar input[accept="image/*"]').setInputFiles({
        name: `large.${type}`, mimeType: `image/${type}`, buffer: readFileSync(`${fixtureDirectory}/large.${type}`),
      })
      await expect(page.locator('.source-image-widget img').first()).toBeVisible({ timeout: 30_000 })
    }
    if (['video', 'mixed'].includes(scenario)) {
      // Valid small WebM padded to 20 MiB: measures storage, not 1080p decode cost.
      const sample = readFileSync('e2e/video-upload.spec.ts', 'utf8').match(/const SAMPLE_WEBM = '([^']+)'/)![1]
      const bytes = Buffer.alloc(20 * 1024 * 1024)
      Buffer.from(sample, 'base64').copy(bytes)
      await page.locator('input[accept=".mp4,.webm,video/mp4,video/webm"]').setInputFiles({
        name: '二十兆测试.webm', mimeType: 'video/webm', buffer: bytes,
      })
    }
    const expectedAssets = Number(['image', 'gif', 'mixed'].includes(scenario)) + Number(['video', 'mixed'].includes(scenario))
    // Wait for the media transaction, not the previous draft's transient saved label.
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('dispatch-workbench-local')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const database = open.result
        const transaction = database.transaction('assets', 'readonly')
        const request = transaction.objectStore('assets').count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        transaction.oncomplete = () => database.close()
      }
    })), { timeout: 45_000 }).toBe(expectedAssets)
    await expect(page.locator('.history-sync-state', { hasText: '已保存' }).first()).toHaveText('已保存', { timeout: 45_000 })
    await page.evaluate(() => {
      const report = { tasks: [] as number[], events: [] as number[], reads: 0, assetWrites: 0, titleWrites: 0 }
      Object.assign(window, { __mediaReport: report })
      new PerformanceObserver(list => report.tasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' })
      new PerformanceObserver(list => report.events.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit)
      const read = Blob.prototype.arrayBuffer
      Blob.prototype.arrayBuffer = function () { report.reads++; return read.call(this) }
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
        if (this.name === 'assets') report.assetWrites++
        if (this.name === 'drafts' && args[0]?.article?.title === '媒体性能基线 · 修改标题') report.titleWrites++
        return put.apply(this, args)
      }
    })
    await cdp.send('HeapProfiler.collectGarbage')
    const before = await cdp.send('Runtime.getHeapUsage')
    const start = Date.now()
    await page.getByLabel('文章标题').fill('媒体性能基线 · 修改标题')
    await page.waitForFunction(() => (window as unknown as { __mediaReport: { titleWrites: number } }).__mediaReport.titleWrites > 0)
    await expect(page.locator('.history-sync-state', { hasText: '已保存' }).first()).toHaveText('已保存', { timeout: 45_000 })
    const savedMs = Date.now() - start
    await cdp.send('HeapProfiler.collectGarbage')
    const after = await cdp.send('Runtime.getHeapUsage')
    const report = await page.evaluate(() => ({
      ...(window as unknown as { __mediaReport: object }).__mediaReport,
      videos: document.querySelectorAll('video').length,
      animatedImages: document.querySelectorAll('img[src^="data:image/gif"]').length,
    }))
    const output = testInfo.outputPath('media-profile.json')
    writeFileSync(output, JSON.stringify({ scenario, cpuRate: 4, savedMs, before, after, ...report }, null, 2))
    await testInfo.attach('media-profile.json', { path: output, contentType: 'application/json' })
    if (process.env.EZ_MEDIA_OPTIMIZED) expect(report).toMatchObject({ reads: 0, assetWrites: 0, videos: 0, animatedImages: 0 })
    // Body-edit samples are separate from the A-stage title-save baseline.
    await page.evaluate(() => {
      const parse = DOMParser.prototype.parseFromString
      const body = { parseLengths: [] as number[], frames: [] as number[] }
      Object.assign(window, { __bodyReport: body })
      DOMParser.prototype.parseFromString = function (...args: Parameters<typeof parse>) {
        body.parseLengths.push(String(args[0]).length)
        return parse.apply(this, args)
      }
      document.querySelector('.cm-content')!.addEventListener('input', () => {
        const start = performance.now()
        requestAnimationFrame(() => body.frames.push(performance.now() - start))
      })
    })
    const bodySamples = []
    for (let round = 0; round < 6; round++) {
      await page.locator('.cm-content').focus()
      await page.locator('.cm-content').press('Control+End')
      await page.evaluate(() => {
        const state = window as unknown as { __mediaReport: { tasks: number[]; reads: number; assetWrites: number }, __bodyReport: { parseLengths: number[]; frames: number[] } }
        state.__mediaReport.tasks.length = 0
        state.__mediaReport.reads = state.__mediaReport.assetWrites = 0
        state.__bodyReport.parseLengths.length = state.__bodyReport.frames.length = 0
      })
      await page.keyboard.type(` B${round}`)
      await expect(page.locator('.wechat-content')).toContainText(`B${round}`)
      // Observe through the autosave debounce, keeping each round's window equal.
      await page.waitForTimeout(1600)
      const sample = await page.evaluate(() => {
        const state = window as unknown as { __mediaReport: { tasks: number[]; reads: number; assetWrites: number }, __bodyReport: { parseLengths: number[]; frames: number[] } }
        return { ...state.__mediaReport, ...state.__bodyReport }
      })
      if (round > 0) bodySamples.push(sample)
      if (process.env.EZ_MEDIA_RUNTIME) {
        expect(Math.max(0, ...sample.parseLengths)).toBeLessThan(50000)
        expect(sample).toMatchObject({ reads: 0, assetWrites: 0 })
      }
    }
    const bodyOutput = testInfo.outputPath('body-profile.json')
    writeFileSync(bodyOutput, JSON.stringify({ scenario, cpuRate: 4, warmup: 1, repetitions: 5, samples: bodySamples }, null, 2))
    await testInfo.attach('body-profile.json', { path: bodyOutput, contentType: 'application/json' })

  })
}
