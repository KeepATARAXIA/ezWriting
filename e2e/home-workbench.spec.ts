import { expect, test } from '@playwright/test'

test('keeps homepage actions readable across desktop and mobile and imports from the main action', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home-connection-note')).toContainText('未检测到发布扩展')
  for (const width of [2560, 1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1440 })
    await expect(page.getByRole('button', { name: '开始写稿' })).toBeVisible()
    await expect(page.getByRole('button', { name: '导入稿件', exact: true })).toBeVisible()
    expect(await page.locator('.empty-import-stage').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/home-${width}.png`, fullPage: true })
  }
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入稿件', exact: true }).click()
  await (await chooser).setFiles({ name: 'home.md', mimeType: 'text/markdown', buffer: Buffer.from('# 首页导入验证\n\n本地正文。') })
  await expect(page.getByLabel('文章标题')).toHaveValue('首页导入验证')
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
  await page.getByLabel('文章标题').fill('无需连接也能写稿')
  await expect(page.getByLabel('文章标题')).toHaveValue('无需连接也能写稿')
})

test('allows writing while the engine is still connecting and closing its setup guide', async ({ page }) => {
  await page.addInitScript(() => {
    window.$syncer = { getAccounts: () => {}, addTask: () => {} }
  })
  await page.goto('/')
  await page.getByRole('button', { name: '开始写稿' }).click()
  await page.getByLabel('文章标题').fill('连接中继续编辑')
  await expect(page.getByLabel('文章标题')).toHaveValue('连接中继续编辑')
  await expect(page.locator('.extension-chip')).toContainText('连接异常', { timeout: 12_000 })
  await page.getByRole('button', { name: '打开发布引擎安装指引' }).click()
  await page.getByRole('button', { name: '继续本地编辑' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('文章标题')).toHaveValue('连接中继续编辑')
})
