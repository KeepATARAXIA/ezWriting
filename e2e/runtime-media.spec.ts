import { expect, test } from '@playwright/test'

const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7'

test('preserves original GIF bytes across short references, clipboard, undo, and reload', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => {
        Object.assign(window, { __copiedHtml: await (await items[0].getType('text/html')).text() })
      },
    } })
  })
  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'runtime.md', mimeType: 'text/markdown',
    buffer: Buffer.from(`# 原件验证\n\n![原始动画](${gif})\n\n这段正文必须保留。`),
  })
  const image = page.locator('.wechat-content img[data-ez-gif-source]')
  await expect(image).toHaveAttribute('data-ez-gif-source', /^blob:/)
  const reference = await image.getAttribute('data-ez-gif-source')
  await page.locator('.wechat-copy-button').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedHtml: string }).__copiedHtml)).toContain(gif)
  await page.locator('.source-image-widget button.delete').click()
  await expect(page.locator('.wechat-content img[data-ez-gif-source]')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(image).toHaveAttribute('data-ez-gif-source', reference!)
  await expect(page.locator('.history-sync-state').first()).toHaveText('已保存')
  await page.reload()
  await expect(image).toHaveAttribute('data-ez-gif-source', /^blob:/)
  await page.locator('.wechat-copy-button').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedHtml: string }).__copiedHtml)).toContain(gif)
  await expect(page.locator('.wechat-content')).toContainText('这段正文必须保留。')
})

test('mounts only nearby overview pages and preserves all long-article paragraphs', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('/')
  const paragraphs = Array.from({ length: 60 }, (_, index) => `段落-${String(index).padStart(3, '0')}：${'图文内容需要准确分页，顺序与文字必须保留。'.repeat(6)}`)
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'overview.md', mimeType: 'text/markdown', buffer: Buffer.from(`# 分页验证\n\n${paragraphs.join('\n\n')}`),
  })
  await page.getByRole('tab', { name: '小红书', exact: true }).click()
  await page.getByRole('button', { name: '整体预览', exact: true }).click()
  await expect(page.locator('.preview-sync-status')).toContainText('自动分页', { timeout: 45_000 })
  const slots = page.locator('.xhs-overview-slot')
  const total = await slots.count()
  expect(total).toBeGreaterThan(8)
  await expect.poll(() => page.locator('.xhs-overview .xhs-card-page').count()).toBeLessThan(total)
  await page.screenshot({ path: testInfo.outputPath('overview-top.png'), animations: 'disabled' })
  const text: string[] = []
  for (let index = 0; index < total; index++) {
    const slot = slots.nth(index)
    await slot.scrollIntoViewIfNeeded()
    await expect(slot.locator('.xhs-card-content')).toBeAttached()
    text.push(await slot.locator('.xhs-card-content').innerText())
  }
  expect((text.join('').match(/段落-\d{3}/g) ?? [])).toEqual(paragraphs.map((_, index) => `段落-${String(index).padStart(3, '0')}`))
  await expect.poll(() => page.locator('.xhs-overview .xhs-card-page').count()).toBeLessThan(total)
  await page.screenshot({ path: testInfo.outputPath('overview-bottom.png'), animations: 'disabled' })
})
