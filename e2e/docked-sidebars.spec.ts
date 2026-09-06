import { expect, test, type Locator } from '@playwright/test'

async function expectSeparate(first: Locator, second: Locator) {
  await expect.poll(async () => {
    const a = (await first.boundingBox())!
    const b = (await second.boundingBox())!
    return a.x + a.width <= b.x + 1 || a.y + a.height <= b.y + 1
  }).toBe(true)
}

test('publishing reserves workspace width, resizes live, and restores the same editor', async ({ page }, info) => {
  await page.setViewportSize({ width: 1674, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  const editor = await page.locator('.cm-editor').elementHandle()
  const workspace = page.locator('.workspace')
  const preview = page.locator('.preview-lane')
  const initial = (await workspace.boundingBox())!.width
  const initialPreview = (await preview.boundingBox())!.width
  const trigger = page.getByRole('button', { name: /^打开发布面板/ })
  await trigger.click()
  const panel = page.locator('.dispatch-drawer')
  const resizer = page.getByRole('separator', { name: '调整发布侧栏宽度' })
  await expectSeparate(workspace, panel)
  await expect(panel).not.toHaveAttribute('aria-modal', 'true')
  expect(initial - (await workspace.boundingBox())!.width).toBeCloseTo(370, 0)
  expect((await preview.boundingBox())!.width).toBeLessThan(initialPreview)
  const before = (await workspace.boundingBox())!.width
  const handle = (await resizer.boundingBox())!
  await page.mouse.move(handle.x + 5, handle.y + 120)
  await page.mouse.down()
  await page.mouse.move(handle.x - 35, handle.y + 120, { steps: 5 })
  expect((await workspace.boundingBox())!.width).toBeLessThan(before - 30)
  await page.mouse.up()
  const width = (await panel.boundingBox())!.width
  await resizer.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(width - 16, 0)
  await trigger.click()
  await expect(panel).toHaveCount(0)
  expect((await workspace.boundingBox())!.width).toBeCloseTo(initial, 0)
  await trigger.click()
  expect((await panel.boundingBox())!.width).toBeCloseTo(width - 16, 0)
  await page.getByRole('button', { name: '模板素材库', exact: true }).click()
  await expectSeparate(page.locator('.template-library-sidebar'), workspace)
  await expectSeparate(workspace, panel)
  await page.screenshot({ path: info.outputPath('publish-docked-desktop.png') })
  for (const width of [1440, 1280, 1200, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expectSeparate(workspace, panel)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('publish-docked-mobile.png') })
  await page.keyboard.press('Escape')
  expect(await editor!.evaluate(node => node.isConnected)).toBe(true)
  await expect(page.locator('.cm-content')).toContainText('核心内容')
})

test('each formatting rail shrinks its preview and stays separate at narrow sizes', async ({ page }, info) => {
  await page.goto('/')
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  for (const [platform, id] of [['微信公众号', 'wechat-theme-panel'], ['小红书', 'xhs-tool-panel'], ['X 长文', 'x-formatting-panel']]) {
    await page.setViewportSize({ width: 1920, height: 1000 })
    await page.getByRole('tab', { name: platform, exact: true }).click()
    const viewport = page.locator('.preview-platform-stage .platform-preview-viewport')
    const initial = (await viewport.boundingBox())!.width
    await page.locator('.preview-settings-toggle').click()
    const panel = page.locator(`#${id}`)
    await expectSeparate(viewport, panel)
    const before = (await viewport.boundingBox())!.width
    expect(initial - before).toBeCloseTo((await panel.boundingBox())!.width + 10, 0)
    await page.locator('.preview-tool-resizer').focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await viewport.boundingBox())!.width).toBeCloseTo(before - 16, 0)
    await page.screenshot({ path: info.outputPath(`${id}-docked.png`) })
    await page.getByRole('button', { name: /^打开发布面板/ }).click()
    await expectSeparate(viewport, panel)
    await expectSeparate(page.locator('.workspace'), page.locator('.dispatch-drawer'))
    await page.keyboard.press('Escape')
    await expect(panel).toBeVisible()
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      if (width < 700) await page.getByRole('navigation', { name: '手机工作区' }).getByRole('button', { name: '预览', exact: true }).click()
      await expectSeparate(viewport, panel)
      expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1920, height: 1000 })
    await expect.poll(async () => (await viewport.boundingBox())!.width).toBeCloseTo(initial, 0)
  }
})
