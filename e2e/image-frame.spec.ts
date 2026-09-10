import { expect, test } from '@playwright/test'

test('previews and persists image frames with responsive controls and original proportions', async ({ page }, info) => {
  await page.route('https://example.com/frame.svg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400"><rect width="720" height="400" fill="#e4ebf7"/><circle cx="550" cy="100" r="45" fill="#7998d0"/><path d="M0 400 220 110 410 330 530 210 720 400" fill="#a4b9dd"/></svg>',
  }))
  await page.setViewportSize({ width: 1674, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n\n![边框示例](https://example.com/frame.svg)\n')
  const image = page.locator('.wechat-content img').last()
  await expect(image).toHaveAttribute('src', 'https://example.com/frame.svg')
  await page.locator('.preview-settings-toggle').click()
  const panel = page.locator('#wechat-theme-panel')
  await panel.getByRole('tab', { name: '样式', exact: true }).click()
  await panel.getByRole('button', { name: '圆角白边', exact: true }).click()
  await expect(image).toHaveCSS('border-top-width', '6px')
  await expect(image).toHaveCSS('border-radius', '16px')
  await expect(page.locator('.wechat-copy-button')).toBeEnabled()
  await panel.getByRole('button', { name: '跟随主题', exact: true }).click()
  await expect(panel.getByRole('button', { name: '跟随主题', exact: true })).toHaveAttribute('aria-pressed', 'true')
  for (const label of ['无边框', '圆角', '投影', '相框', '圆角白边']) {
    await panel.getByRole('button', { name: label, exact: true }).click()
    await expect(panel.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await page.reload()
  await expect(image).toHaveCSS('border-top-width', '6px')
  await page.locator('.preview-settings-toggle').click()
  await panel.getByRole('tab', { name: '样式', exact: true }).click()
  await image.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('image-frame-desktop.png') })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('navigation', { name: '手机工作区' }).getByRole('button', { name: '预览', exact: true }).click()
    await panel.getByRole('button', { name: '相框', exact: true }).scrollIntoViewIfNeeded()
    await expect(panel.getByRole('button', { name: '相框', exact: true })).toBeInViewport()
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`image-frame-${width}.png`) })
  }
})
