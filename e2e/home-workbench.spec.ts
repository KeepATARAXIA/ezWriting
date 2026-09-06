import { editTitle } from './workbench-helpers'
import { expect, test } from '@playwright/test'

test('keeps a compact homepage across desktop and mobile and imports from the drop zone', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home-connection-note')).toContainText('未检测到发布扩展')
  for (const width of [2560, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 })
    await expect(page.getByRole('button', { name: '开始写稿' })).toBeVisible()
    await expect(page.locator('.drop-actions button')).toHaveCount(1)
    await expect(page.locator('.home-import-drop-target')).toBeVisible()
    await expect(page.getByRole('heading', { name: '最近编辑' })).toBeVisible()
    expect(await page.locator('.empty-import-stage').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    if (width >= 1440) {
      expect((await page.locator('.empty-workbench-content').boundingBox())!.width).toBe(1120)
      expect((await page.locator('.home-import-zone').boundingBox())!.height).toBeLessThanOrEqual(94)
    }
    await page.screenshot({ path: `test-results/home-${width}.png`, fullPage: true })
  }
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.home-import-drop-target').click()
  await (await chooser).setFiles({ name: 'home.md', mimeType: 'text/markdown', buffer: Buffer.from('# 首页导入验证\n\n本地正文。') })
  await expect(page.locator('.topbar-document-title')).toHaveText('首页导入验证')
  await expect(page.locator('.cm-content')).toContainText('本地正文。')
})

test('times out an unresponsive engine, retries, and keeps local creation available', async ({ page }) => {
  await page.addInitScript(() => {
    window.$syncer = { getAccounts: () => {}, addTask: () => {} }
  })
  await page.goto('/')
  await expect(page.locator('.home-connection-note')).toContainText('可先开始本地编辑')
  await expect(page.getByRole('button', { name: '开始写稿' })).toBeEnabled()
  await expect(page.locator('.home-connection-note')).toContainText('超时', { timeout: 12_000 })
  await page.evaluate(() => { window.$syncer!.getAccounts = callback => callback([]) })
  await page.locator('.home-connection-note').getByRole('button', { name: '重新连接' }).click()
  await expect(page.locator('.home-connection-note')).toContainText('暂未连接内容平台')
  await page.getByRole('button', { name: '开始写稿' }).click()
  await editTitle(page, '无需连接也能写稿')
  await expect(page.locator('.topbar-document-title')).toHaveText('无需连接也能写稿')
})

test('allows writing while the engine is still connecting and closing its setup guide', async ({ page }) => {
  await page.addInitScript(() => {
    window.$syncer = { getAccounts: () => {}, addTask: () => {} }
  })
  await page.goto('/')
  await page.getByRole('button', { name: '开始写稿' }).click()
  await editTitle(page, '连接中继续编辑')
  await expect(page.locator('.topbar-document-title')).toHaveText('连接中继续编辑')
  await page.getByRole('button', { name: /通知/ }).click()
  await expect(page.locator('.notification-panel')).toContainText('连接异常', { timeout: 12_000 })
  await page.getByRole('button', { name: '查看连接指引' }).click()
  await page.getByRole('button', { name: '继续本地编辑' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.topbar-document-title')).toHaveText('连接中继续编辑')
})

test('returns home without reloading and continues a recent edit using the keyboard', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  await editTitle(page, '昨天写到一半的文章')
  await page.getByRole('button', { name: 'EZWRITING 首页' }).click()
  await expect(page.getByRole('heading', { name: '最近编辑' })).toBeVisible()
  await page.getByRole('button', { name: '开始写稿' }).click()
  await editTitle(page, '今天刚刚编辑的文章')
  await page.getByRole('button', { name: 'EZWRITING 首页' }).click()
  await expect(page.locator('.home-recent-grid strong')).toHaveText(['今天刚刚编辑的文章', '昨天写到一半的文章'])
  await expect(page.locator('#empty-workbench-title')).toBeFocused()
  await page.screenshot({ path: 'test-results/home-recent-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('.empty-import-stage').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/home-recent-mobile.png' })
  const recent = page.getByRole('button', { name: '继续编辑：昨天写到一半的文章' })
  await recent.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.topbar-document-title')).toHaveText('昨天写到一半的文章')
  await expect(page.locator('.cm-content')).toContainText('核心内容')
  await page.reload()
  await expect(page.locator('.topbar-document-title')).toHaveText('昨天写到一半的文章')
})
