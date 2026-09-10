import { expect, test, type Page } from '@playwright/test'

async function layout(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const node = element as HTMLElement
    const scale = node.getBoundingClientRect().width / node.offsetWidth
    const range = document.createRange()
    range.selectNodeContents(node)
    const box = node.getBoundingClientRect()
    return {
      width: node.offsetWidth, height: node.offsetHeight,
      rows: [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => [
        Math.round((rect.left - box.left) / scale), Math.round((rect.top - box.top) / scale), Math.round(rect.width / scale),
      ]),
    }
  })
}

test('fixes editor and phone line breaks while leaving desktop preview responsive', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({
    name: 'fixed-width.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 固定画布的标题也应该保持换行稳定\n\n' + '宽度验证：拖动只改变可见区域，文章换行与缩进保持稳定。'.repeat(5) + '\n\n> 引用保持缩进\n\n- 列表保持缩进\n\n结尾'),
  })
  await expect(page.locator('.wechat-content')).toContainText('宽度验证')
  await page.evaluate(() => document.fonts.ready)
  const editorLine = '.cm-content .cm-line:nth-child(3)'
  const beforeEditor = await layout(page, editorLine)
  expect(beforeEditor.width).toBe(640)
  const desktopBefore = await layout(page, '.wechat-content p:first-of-type')
  const html = await page.locator('.wechat-content').innerHTML()
  const splitter = page.locator('.pane-resizer')
  const initial = (await splitter.boundingBox())!
  await page.mouse.move(initial.x + initial.width / 2, initial.y + 80)
  await page.mouse.down()
  await page.mouse.move(initial.x + 220, initial.y + 80, { steps: 8 })
  await page.mouse.up()
  expect((await splitter.boundingBox())!.x).toBeGreaterThan(initial.x + 50)
  await expect.poll(() => layout(page, editorLine)).toEqual(beforeEditor)
  await expect.poll(() => layout(page, '.wechat-content p:first-of-type')).not.toEqual(desktopBefore)
  await page.getByRole('button', { name: '手机预览', exact: true }).click()
  const phoneBody = '.mobile-wechat-content p:first-of-type'
  await expect(page.locator(phoneBody).first()).toBeVisible()
  const phoneBefore = await layout(page, phoneBody)
  const titleBefore = await layout(page, '.mobile-article-scroll > h1')
  expect(await page.locator('.phone-screen').evaluate(node => node.clientWidth)).toBe(390)
  expect(await page.locator('.mobile-wechat-content').evaluate(node => (node as HTMLElement).offsetWidth)).toBe(350)
  const phoneType = await page.locator(phoneBody).first().evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).lineHeight])
  expect(phoneType).toEqual(await page.locator('.wechat-content p:first-of-type').first().evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).lineHeight]))
  const phoneDrag = (await splitter.boundingBox())!
  await page.mouse.move(phoneDrag.x + phoneDrag.width / 2, phoneDrag.y + 80)
  await page.mouse.down()
  await page.mouse.move(phoneDrag.x - 180, phoneDrag.y + 80, { steps: 8 })
  await page.mouse.up()
  expect((await splitter.boundingBox())!.x).toBeLessThan(phoneDrag.x - 50)
  await expect.poll(() => layout(page, phoneBody)).toEqual(phoneBefore)
  await expect.poll(() => layout(page, editorLine)).toEqual(beforeEditor)
  for (const size of [{ width: 1440, height: 1000 }, { width: 1000, height: 650 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size)
    await expect.poll(() => layout(page, phoneBody)).toEqual(phoneBefore)
    await expect.poll(() => layout(page, '.mobile-article-scroll > h1')).toEqual(titleBefore)
    await expect.poll(() => layout(page, editorLine)).toEqual(beforeEditor)
    expect(await page.locator('.phone-device').evaluate(node => {
      const phone = node.getBoundingClientRect()
      const viewport = node.closest('.wechat-phone-viewport')!.getBoundingClientRect()
      return phone.left >= viewport.left && phone.right <= viewport.right && phone.top >= viewport.top && phone.bottom <= viewport.bottom
    })).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('wechat-fixed-desktop.png') })
  await page.keyboard.press('Escape')
  expect(await page.locator('.wechat-content').innerHTML()).toBe(html)
  await page.setViewportSize({ width: 390, height: 900 })
  await expect.poll(() => page.locator('.cm-scroller').evaluate(node => {
    node.scrollLeft = node.scrollWidth
    return node.scrollLeft
  })).toBeGreaterThan(0)
  await page.getByRole('navigation', { name: '手机工作区' }).getByRole('button', { name: '预览', exact: true }).click()
  await page.getByRole('button', { name: '手机预览', exact: true }).click()
  await expect.poll(() => layout(page, phoneBody)).toEqual(phoneBefore)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('wechat-fixed-mobile.png') })
  await page.locator('.mobile-article-scroll').evaluate(node => { node.scrollTop = node.scrollHeight })
  await expect.poll(() => page.locator('.mobile-article-scroll').evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '手机预览', exact: true })).toBeFocused()
})
