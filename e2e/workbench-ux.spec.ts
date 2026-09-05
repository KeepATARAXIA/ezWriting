import { expect, test, type Locator, type Page } from '@playwright/test'

async function openArticle(page: Page, body = '保持清晰可读的正文，同时让编辑、预览和恢复操作始终可用。\n\n第二段正文。') {
  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'workbench-ux.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# 工作台体验回归\n\n${body}`),
  })
  await expect(page.locator('.topbar-document-title')).toHaveText('工作台体验回归')
}

async function expectUncovered(button: Locator) {
  await expect(button).toBeVisible()
  expect(await button.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })).toBe(true)
}

test('preserves undo and redo when switching the editor to resources and back', async ({ page }) => {
  await openArticle(page, Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 段正文，用来检查切换资源后长文编辑位置仍然保留。`).join('\n\n'))
  const editor = page.locator('.cm-content')
  await editor.click()
  await editor.press('Control+End')
  await editor.press('End')
  await page.keyboard.insertText('保留撤销记录')
  const scroller = page.locator('.source-editor .cm-scroller')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(1000)
  const scrollTop = await scroller.evaluate(element => element.scrollTop)
  for (let count = 0; count < 2; count += 1) {
    await page.locator('[aria-controls="article-resource-view"]').click()
    await expect(page.locator('#article-edit-view')).toBeHidden()
    await page.getByRole('button', { name: '正文', exact: true }).click()
    await expect.poll(async () => Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollTop)).toBeLessThan(2)
  }
  const undo = page.getByRole('button', { name: '撤销', exact: true })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(editor).not.toContainText('保留撤销记录')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(editor).toContainText('保留撤销记录')
})

test('keeps last-draft recovery visible after the mobile history drawer closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openArticle(page)
  await page.getByRole('button', { name: '打开历史记录', exact: true }).click()
  await page.locator('.history-draft-menu-button').first().click()
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
  await expect(page.locator('.history-sidebar-slot')).not.toHaveClass(/overlay-open/)
  const undo = page.locator('.history-undo-notice').getByRole('button', { name: '撤销', exact: true })
  await expectUncovered(undo)
  // The old recovery control expired after seven seconds, even while hidden.
  await page.waitForTimeout(8_000)
  await expectUncovered(undo)
  await undo.click()
  await page.getByRole('button', { name: '打开历史记录', exact: true }).click()
  await page.locator('.history-draft-open').first().click()
  await expect(page.locator('.topbar-document-title')).toHaveText('工作台体验回归')
})

for (const width of [1440, 1366, 1025]) {
  test(`protects readable preview and editor widths at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await openArticle(page)
    const separator = page.getByRole('separator', { name: '调整编辑区和预览区宽度', exact: true })
    const viewport = page.locator('.platform-preview-viewport')
    for (const platform of ['微信公众号', '小红书', 'X 长文']) {
      await page.getByRole('tab', { name: platform, exact: true }).click()
      const toggle = page.locator('.preview-settings-toggle')
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
      await separator.press('End')
      await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(439)
      expect((await page.locator('.paper-panel').boundingBox())!.width).toBeGreaterThanOrEqual(280)
      expect(await page.locator('.source-editor-statusbar').evaluate(element => {
        const rects = Array.from(element.children).map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0)
        return rects.every((rect, index) => rects.slice(index + 1).every(other =>
          rect.right <= other.left || other.right <= rect.left || rect.bottom <= other.top || other.bottom <= rect.top))
      })).toBe(true)
      if (width > 1100) {
        await page.locator('.preview-tool-resizer').press('End')
        await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(439)
        await expect.poll(async () => {
          const actual = (await page.locator('.preview-tool-rail:not([hidden])').boundingBox())!.width
          return Math.abs(Number(await page.locator('.preview-tool-resizer').getAttribute('aria-valuenow')) - actual)
        }).toBeLessThan(1)
      } else {
        // Settings overlay smaller laptop previews instead of squeezing the article.
        await expect(page.locator('.preview-tool-resizer')).toBeVisible()
        await expect(page.locator('.preview-tool-rail:not([hidden])')).toHaveCSS('position', 'absolute')
      }
      const bar = (await separator.boundingBox())!
      await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
      await page.mouse.down()
      await page.mouse.move(width - 12, bar.y + bar.height / 2, { steps: 5 })
      await page.mouse.up()
      await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(439)
      await expect.poll(async () => {
        const actual = await page.locator('.paper-panel').evaluate(element => element.getBoundingClientRect().width / element.parentElement!.getBoundingClientRect().width * 100)
        return Math.abs(Number(await separator.getAttribute('aria-valuenow')) - actual)
      }).toBeLessThan(1)
      await separator.press('Home')
      expect((await page.locator('.paper-panel').boundingBox())!.width).toBeGreaterThanOrEqual(280)
      await toggle.click()
      await separator.press('End')
      await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(440)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('tab', { name: '微信公众号', exact: true }).click()
    await page.locator('.preview-settings-toggle').click()
    await page.screenshot({ path: testInfo.outputPath(`workbench-${width}.png`) })
  })
}

for (const width of [390, 320]) {
  test(`keeps history and preview copy controls separately reachable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await openArticle(page)
    await page.getByRole('navigation', { name: '手机工作区' }).getByRole('button', { name: '预览', exact: true }).click()
    const history = page.getByRole('button', { name: '打开历史记录', exact: true })
    const copy = page.locator('.wechat-copy-button')
    await expectUncovered(history)
    await expectUncovered(copy)
    await history.click()
    await page.keyboard.press('Escape')
    await expect(history).toBeFocused()
    await expectUncovered(copy)
    await page.locator('.preview-settings-toggle').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`workbench-mobile-${width}.png`), animations: 'disabled' })
  })
}
