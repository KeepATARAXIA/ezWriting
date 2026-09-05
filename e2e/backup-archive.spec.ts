import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { expect, test, type Page } from '@playwright/test'

const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const SAMPLE_WEBM = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAKFEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggJv7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMUSJiEBxgAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYi+osIW4IWmLZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgkLCBoLqBWpqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMXNz2mPAi2PFiL6iwhbghaYtZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDEgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuMjgwMDAwMDAwAB9DtnVAvueBAKOvgQAAgIJJg0IACfAFlgA4JBwY9gAAMGAAAHk7/+El///+2g///3oc/S6P71LiwACjlYEAKACGAECSHABZAAADIAAAWfmG4KOVgQBQAIYAQJKcAFgAAAMgAABZ+Ybgo5WBAHgAhgBAkhwAWQAAAyAAAFn5huCjlYEAoACGAECSnABWoAADIAAAWfmG4KOVgQDIAIYAQJIcAFkAAAMgAABZ+Ybgo5WBAPAAhgBAkpwAWAAAAyAAAFn5huAcU7trkbuPs4EAt4r3gQHxggGr8IED'

async function openData(page: Page) {
  const history = page.getByRole('button', { name: '打开历史记录', exact: true })
  if (await history.isVisible()) await history.click()
  const data = page.getByRole('button', { name: /本地数据/ })
  if (await data.getAttribute('aria-expanded') !== 'true') await data.click()
}

test('downloads deduplicated media, restores playable video in a separate origin, and rejects damaged media', async ({ page }, info) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.locator('input[accept*=".md"]').first().setInputFiles({
    name: 'backup-media.md', mimeType: 'text/markdown',
    buffer: Buffer.from(`# 媒体备份验收\n\n![配图](data:image/gif;base64,${GIF})\n\n![重复配图](data:image/gif;base64,${GIF})\n\n正文内容。`),
  })
  const video = Buffer.alloc(60 * 1024 * 1024)
  Buffer.from(SAMPLE_WEBM, 'base64').copy(video)
  const videoPath = info.outputPath('备份视频.webm')
  await writeFile(videoPath, video)
  await page.locator('input[accept=".mp4,.webm,video/mp4,video/webm"]').setInputFiles(videoPath)
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await openData(page)
  const started = Date.now()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/\.ezwriting-backup\.zip$/)
  const downloaded = await readFile((await download.path())!)
  const exportMs = Date.now() - started
  const zip = await JSZip.loadAsync(downloaded)
  const manifestText = await zip.file('manifest.json')!.async('string')
  const manifest = JSON.parse(manifestText)
  expect(manifest.assets).toHaveLength(2)
  expect(manifestText).not.toContain('data:image/')
  expect(manifestText).not.toContain('data:video/')
  const videoAsset = manifest.assets.find((asset: { mimeType: string }) => asset.mimeType === 'video/webm')
  expect((await zip.file(videoAsset.path)!.async('nodebuffer')).equals(video)).toBe(true)
  await page.screenshot({ path: info.outputPath('backup-download.png'), fullPage: true })

  await page.goto('http://localhost:4174/')
  const restoredAt = Date.now()
  await page.locator('input[accept*=".ezwriting-backup"]').setInputFiles((await download.path())!)
  await expect(page.getByLabel('文章标题')).toHaveValue('媒体备份验收')
  await expect(page.getByText('已导入 1 篇稿件；相同稿件已使用备份版本。')).toBeVisible()
  const restoreMs = Date.now() - restoredAt
  await expect(page.locator('.wechat-content img:not(.ez-static-video)')).toHaveCount(2)
  await expect(page.locator('.source-video-widget video')).toHaveCount(0)
  await page.getByRole('button', { name: '播放视频：备份视频.webm', exact: true }).click()
  await expect.poll(() => page.locator('.source-video-widget video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBe(160)
  await page.screenshot({ path: info.outputPath('backup-restored.png'), fullPage: true })

  zip.file(videoAsset.path, Buffer.alloc(videoAsset.byteSize, 7), { createFolders: false })
  const damaged = await zip.generateAsync({ type: 'nodebuffer' })
  const damagedPath = info.outputPath('damaged.ezwriting-backup.zip')
  await writeFile(damagedPath, damaged)
  await page.locator('input[accept*=".ezwriting-backup"]').setInputFiles(damagedPath)
  await expect(page.getByText(/备份媒体完整性校验失败/)).toBeVisible()
  await expect(page.getByLabel('文章标题')).toHaveValue('媒体备份验收')
  await page.screenshot({ path: info.outputPath('backup-rejected.png'), fullPage: true })
  expect(errors).toEqual([])
  await writeFile(info.outputPath('backup-metrics.json'), JSON.stringify({ exportMs, restoreMs, archiveBytes: downloaded.length, mediaBytes: video.length + Buffer.from(GIF, 'base64').length, assetCount: manifest.assets.length, fixture: '60 MiB padded 160×90 WebM + repeated 1×1 GIF; capacity and integrity test', errors }, null, 2))
})

test('cancel remains clickable above the history drawer and does not download a partial archive', async ({ page }, info) => {
  await page.goto('/')
  await page.locator('input[accept*=".md"]').first().setInputFiles({ name: 'cancel.md', mimeType: 'text/markdown', buffer: Buffer.from(`# 取消备份验收\n\n![配图](data:image/gif;base64,${GIF})`) })
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  // Keep hashing pending so the user-facing cancellation control can be exercised deterministically.
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    crypto.subtle.digest = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 700))
      return digest(...args)
    }
  })
  await openData(page)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  await page.getByRole('button', { name: '取消备份操作', exact: true }).click()
  await expect(page.getByText('已取消备份导出，原稿件未删除。')).toBeVisible()
  await expect(page.getByRole('button', { name: '导出备份', exact: true })).toBeEnabled()
  expect(downloads).toHaveLength(0)
  await page.screenshot({ path: info.outputPath('backup-cancelled.png'), fullPage: true })
  await page.reload()
  await expect(page.getByLabel('文章标题')).toHaveValue('取消备份验收')
})
