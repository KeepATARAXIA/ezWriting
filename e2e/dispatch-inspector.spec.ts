import { expect, test } from '@playwright/test'

test('offers a compact platform picker with named actions and a separate local download', async ({ page }, info) => {
  await page.addInitScript(() => {
    const accounts = [
      { type: 'wechat', uid: '1', displayName: '微信公众号', title: '我的公众号' },
      { type: 'xiaohongshu', uid: '2', displayName: '小红书', title: '我的小红书' },
      { type: 'bilibili', uid: '3', displayName: '哔哩哔哩', title: '创作账号' },
      { type: 'douyin', uid: '4', displayName: '抖音图文', title: '图文账号' },
      { type: 'twitter', uid: '5', displayName: 'X (Twitter)', title: '@writer' },
      { type: 'zip-download', displayName: 'Markdown 压缩包', title: '本地下载' },
    ]
    Object.assign(window, { $syncer: { getAccounts: (callback: (value: unknown) => void) => callback(accounts), addTask: () => undefined } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  await page.getByRole('button', { name: '模板素材库', exact: true }).click()
  await page.getByRole('button', { name: /^打开发布面板/ }).click()
  const drawer = page.getByRole('dialog', { name: '同步平台草稿 · Beta' })
  const primary = drawer.locator('.publish-button')
  await expect(drawer.locator('.bridge-status')).toContainText('已连接 5 个平台')
  await expect(primary).toHaveText('请至少选择 1 个平台')
  await expect(primary).toBeDisabled()
  await drawer.getByRole('button', { name: '全选', exact: true }).click()
  await expect(drawer.locator('.drawer-platform-heading')).toContainText('已选 5 / 5')
  await expect(primary).toHaveText('同步到 5 个平台')
  await expect(drawer.locator('.dispatch-downloads .platform-row')).toHaveAttribute('aria-pressed', 'false')
  await drawer.getByRole('button', { name: '清空', exact: true }).click()
  await drawer.locator('.platform-list .platform-row').filter({ hasText: '微信公众号' }).click()
  await drawer.locator('.platform-list .platform-row').filter({ hasText: '小红书' }).click()
  await expect(primary).toHaveText('同步到微信、小红书')
  await expect(primary).toBeEnabled()
  expect((await drawer.boundingBox())!.width).toBe(360)
  expect((await drawer.locator('.platform-row').first().boundingBox())!.height).toBeLessThanOrEqual(50)
  await page.screenshot({ path: info.outputPath('dispatch-inspector-desktop.png') })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 744 })
    expect(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    expect(await primary.evaluate(node => {
      const rect = node.getBoundingClientRect()
      return rect.bottom <= innerHeight && node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('dispatch-inspector-mobile.png') })
  await drawer.getByRole('button', { name: '清空', exact: true }).click()
  await drawer.locator('.dispatch-downloads .platform-row').click()
  await expect(primary).toHaveText('下载 1 项到本地')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^打开发布面板/ })).toBeFocused()
  await expect(page.locator('.template-library-sidebar')).toBeVisible()
})
