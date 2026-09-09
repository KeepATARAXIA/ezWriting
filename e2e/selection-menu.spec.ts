import { expect, test } from '@playwright/test'

test('waits for mouse release, follows both selection directions and keeps every tool inside', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'selection.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 选区测试\n\n第一段用于开始选择文字。\n\n第二段用于结束选择文字。\n\n第三段用于继续扩大选区。'),
  })
  const lines = page.locator('.cm-line').filter({ hasText: /第[一二三]段/ })
  await expect(lines).toHaveCount(3)
  await page.evaluate(() => document.fonts.ready)
  await lines.nth(0).click()
  const first = (await lines.nth(0).boundingBox())!
  const last = (await lines.nth(2).boundingBox())!
  const menu = page.getByRole('toolbar', { name: '选中文字快捷排版' })
  for (const reverse of [false, true]) {
    await page.keyboard.press('ArrowRight')
    const start = reverse ? last : first
    const end = reverse ? first : last
    await page.mouse.move(start.x + 8, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + 170, end.y + end.height / 2, { steps: 12 })
    await page.waitForTimeout(100)
    await expect(menu).toBeHidden()
    const selected = await page.evaluate(() => window.getSelection()?.toString())
    expect(selected).toContain('第二段用于结束选择文字。')
    await page.mouse.up()
    await expect(menu).toBeVisible()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected)
    await expect.poll(() => page.locator('.cm-content').evaluate(content => {
      const line = content.querySelector('.cm-line')!.getBoundingClientRect()
      const highlights = [...document.querySelectorAll('.cm-selectionBackground')]
      return highlights.length > 0 && highlights.every(node => {
        const box = node.getBoundingClientRect()
        return box.left >= line.left - 1 && box.right <= line.right + 1
      })
    })).toBe(true)
    const bounds = (await menu.boundingBox())!
    expect(bounds.y + bounds.height).toBeLessThan(end.y + 2)
    expect(bounds.y + bounds.height).toBeGreaterThan(end.y - 25)
    for (const button of await menu.getByRole('button').all()) {
      const box = (await button.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(bounds.x + 8)
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width - 8)
    }
    expect(await menu.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
  await page.keyboard.press('ArrowRight')
  await expect(menu).toBeHidden()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: '加粗', exact: true }).click()
  await expect(page.locator('.cm-md-strong').first()).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => {
    const box = (await menu.boundingBox())!
    return box.x >= 9 && box.x + box.width <= 381
  }).toBe(true)
  await menu.evaluate(node => { node.scrollLeft = node.scrollWidth })
  await expect(menu.getByRole('button', { name: '清除格式', exact: true })).toBeInViewport()
})

test('keeps wrapped and multiline highlights inside the text area in both syntax modes', async ({ page }, info) => {
  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'wrapped-selection.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 高亮边界\n\n' + '正文跨行选择需要保持在阅读区域内。'.repeat(12) + '\n\n第二段正文。\n\n第三段正文。'),
  })
  const content = page.locator('.cm-content')
  await expect(content).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const syntax of [false, true]) {
      const toggle = page.getByRole('button', { name: syntax ? '显示 Markdown 语法' : '隐藏 Markdown 语法', exact: true })
      if (await toggle.isVisible()) await toggle.click()
      await expect(page.getByRole('button', { name: syntax ? '隐藏 Markdown 语法' : '显示 Markdown 语法', exact: true })).toBeVisible()
      await content.press('Control+Home')
      await content.press('Control+a')
      await expect.poll(() => content.evaluate(node => {
        const bounds = node.querySelector('.cm-line')!.getBoundingClientRect()
        const highlights = [...document.querySelectorAll('.cm-selectionBackground')]
        return highlights.length > 1 && highlights.every(highlight => {
          const box = highlight.getBoundingClientRect()
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
        })
      })).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: info.outputPath(`selection-${width}-${syntax ? 'source' : 'rendered'}.png`) })
    }
  }
})
