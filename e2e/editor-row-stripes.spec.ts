import { expect, test, type Page } from '@playwright/test'

async function expectAlternatingSourceLines(page: Page) {
  await expect.poll(() => page.locator('.cm-line').filter({ hasText: '自动折行检查' }).first().evaluate(line => {
    const range = document.createRange()
    range.selectNodeContents(line)
    const centers = [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => (rect.top + rect.bottom) / 2)
    const rows = [...new Set(centers)]
    const stripes = [...document.querySelectorAll('.source-row-stripe')].map(node => node.getBoundingClientRect())
    const shaded = rows.map(y => stripes.some(rect => rect.top <= y && rect.bottom > y))
    const following = line.nextElementSibling!
    const nextBox = following.getBoundingClientRect()
    const nextY = (nextBox.top + nextBox.bottom) / 2
    const nextShaded = stripes.some(rect => rect.top <= nextY && rect.bottom > nextY)
    return shaded.length >= 3 && shaded.every(value => value === shaded[0]) && nextShaded !== shaded[0]
  })).toBe(true)
}

test('alternates source lines while keeping wrapped text together, with a persistent settings switch', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const paragraph = '自动折行检查：同一行内容被宽度压成多行时保持整块底色，手动回车后才交替。'.repeat(12)
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'stripes.md', mimeType: 'text/markdown', buffer: Buffer.from(`# 隔行底色\n\n${paragraph}\n第二行\n第三行\n\n![图片](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\n\n结尾`) })
  await expect(page.locator('.source-row-stripe').first()).toBeAttached()
  const editor = await page.locator('.cm-editor').elementHandle()
  const text = await page.locator('.cm-content').textContent()
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  const preview = await page.locator('.wechat-document').innerHTML()
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expectAlternatingSourceLines(page)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: info.outputPath('editor-striped-rows.png') })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const toggle = page.getByRole('switch', { name: '正文隔行底色' })
  await expect(toggle).toBeChecked()
  await page.screenshot({ path: info.outputPath('editor-stripe-settings.png') })
  await toggle.uncheck()
  await expect(page.locator('.source-row-stripes')).toHaveCount(0)
  await toggle.check()
  await expectAlternatingSourceLines(page)
  await toggle.uncheck()
  await page.keyboard.press('Escape')
  expect(await editor!.evaluate(node => node.isConnected)).toBe(true)
  expect(await page.locator('.cm-content').textContent()).toBe(text)
  expect(await page.locator('.wechat-document').innerHTML()).toBe(preview)
  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('自动折行检查')
  await expect(page.locator('.source-row-stripes')).toHaveCount(0)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await page.keyboard.press('Escape')
  await page.reload()
  await expectAlternatingSourceLines(page)
  expect(errors).toEqual([])
})

test('keeps stripe colors stable while scrolling a virtualized document and leaves media clear', async ({ page }) => {
  await page.goto('/')
  const body = Array.from({ length: 80 }, (_, index) => `段落${index}：${'连续滚动时底色跟随文字，新增显示行仍然交替。'.repeat(10)}`).join('\n')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'long-stripes.md', mimeType: 'text/markdown', buffer: Buffer.from(`# 滚动检查\n\n${body}\n\n![图片](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\n\n结尾`) })
  await expect(page.locator('.source-row-stripe').first()).toBeAttached()
  const scroller = page.locator('.source-editor .cm-scroller')
  const colors = () => scroller.evaluate(scroll => {
    const bounds = scroll.getBoundingClientRect()
    const stripes = [...scroll.querySelectorAll('.source-row-stripe')].map(node => node.getBoundingClientRect())
    const result: Record<string, boolean> = {}
    for (const line of scroll.querySelectorAll('.cm-line')) {
      if (!line.textContent?.startsWith('段落')) continue
      const range = document.createRange()
      range.selectNodeContents(line)
      ;[...range.getClientRects()].filter(rect => rect.width > 0).forEach((rect, index) => {
        const y = (rect.top + rect.bottom) / 2
        if (y > bounds.top && y < bounds.bottom) result[`${line.textContent!.split('：')[0]}-${index}`] = stripes.some(stripe => stripe.top <= y && stripe.bottom > y)
      })
    }
    return result
  })
  for (const position of [0, 1600, 4000, 10000]) {
    await scroller.evaluate((node, top) => { node.scrollTop = top }, position)
    await expect.poll(async () => Object.keys(await colors()).length).toBeGreaterThan(5)
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const before = await colors()
    await scroller.evaluate(node => { node.scrollTop += 100 })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await expect.poll(async () => {
      const after = await colors()
      const shared = Object.keys(before).filter(key => key in after)
      return shared.length > 2 && shared.every(key => before[key] === after[key])
    }).toBe(true)
  }
  await page.locator('.cm-content').press('Control+End')
  await expect(page.locator('.source-image-widget')).toBeVisible()
  expect(await page.locator('.source-image-widget').evaluate(media => {
    const box = media.getBoundingClientRect()
    return [...document.querySelectorAll('.source-row-stripe')].every(node => {
      const stripe = node.getBoundingClientRect()
      return stripe.bottom <= box.top || stripe.top >= box.bottom
    })
  })).toBe(true)
  expect(await page.locator('.cm-line').count()).toBeLessThan(80)
})
