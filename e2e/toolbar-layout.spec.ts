import { editTitle } from './workbench-helpers'
import { expect, test } from '@playwright/test'

test('keeps two toolbar rows and opens formatting without narrowing either document', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('dispatch.preview-tool-rail-open.v2', JSON.stringify({ wechat: true, xhs: true, x: true }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  await expect(page.locator('.cm-content')).toContainText('核心内容')
  await editTitle(page, '让写作回到内容本身')
  await expect(page.locator('.preview-settings-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.topbar .platform-switcher')).toHaveCount(0)
  await expect(page.locator('.editor-view-tabs')).toHaveCount(1)
  await expect(page.locator('.preview-workbench > .preview-contextbar')).toHaveCount(0)
  for (const width of [2560, 1674, 1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    const toolbar = (await page.locator('.workbench-toolbar').boundingBox())!
    expect(toolbar.height).toBe(56)
    expect(toolbar.y).toBe(80)
    expect(await page.locator('.workbench-toolbar').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const before = (await page.locator('.wechat-document').boundingBox())!
    const editorBefore = (await page.locator('.paper-panel').boundingBox())!
    await page.locator('.preview-settings-toggle').click()
    await expect(page.locator('.inspector-tabs').getByRole('tab', { name: '主题', exact: true })).toBeVisible()
    expect((await page.locator('.wechat-document').boundingBox())!.width).toBeCloseTo(before.width, 0)
    expect((await page.locator('.paper-panel').boundingBox())!.width).toBeCloseTo(editorBefore.width, 0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.preview-settings-toggle')).toBeFocused()
    await expect(page.locator('.preview-tool-rail')).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`) })
  }
  await page.setViewportSize({ width: 1674, height: 1000 })
  await page.getByRole('button', { name: '打开历史记录', exact: true }).click()
  expect(await page.locator('.workbench-toolbar').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('toolbar-with-history.png') })
  await page.locator('.preview-settings-toggle').click()
  expect((await page.locator('.preview-tool-rail:not([hidden])').boundingBox())!.width).toBe(310)
  await page.screenshot({ path: testInfo.outputPath('toolbar-formatting-drawer.png'), animations: 'disabled' })
  await page.getByRole('button', { name: /^预览克莱因蓝主题/ }).click()
  await page.getByRole('button', { name: '立即应用', exact: true }).click()
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await page.reload()
  await expect(page.locator('.preview-settings-toggle')).toHaveAttribute('aria-expanded', 'false')
  await page.locator('.preview-settings-toggle').click()
  await expect(page.getByRole('button', { name: /^预览克莱因蓝主题/ })).toHaveAttribute('aria-pressed', 'true')
})

test('keeps preview and output menus reachable on all platforms and mobile widths', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async () => {} } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  for (const platform of ['微信公众号', '小红书', 'X 长文']) {
    await page.getByRole('tab', { name: platform, exact: true }).click()
    await page.getByRole('button', { name: '手机预览', exact: true }).click()
    await expect(page.getByRole('dialog', { name: `${platform}手机效果预览` })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '手机预览', exact: true })).toBeFocused()
    if (platform === '小红书') {
      const download = page.waitForEvent('download')
      await page.getByRole('button', { name: '下载全部图片', exact: true }).click()
      expect((await download).suggestedFilename()).toMatch(/\.zip$/)
    } else {
      await page.getByRole('button', { name: platform === '微信公众号' ? '复制公众号格式' : '复制 X 长文格式', exact: true }).click()
      await expect(page.locator('.notification-panel')).toContainText('已复制')
    }
    await page.keyboard.press('Escape')
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const tabs = page.getByRole('navigation', { name: '手机工作区' })
    await tabs.getByRole('button', { name: '预览', exact: true }).click()
    await page.locator('.preview-settings-toggle').click()
    await expect(page.getByRole('dialog', { name: 'X 长文排版设置' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '手机预览', exact: true }).click()
    await page.keyboard.press('Escape')
    await tabs.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.locator('.cm-content')).toBeVisible()
    await page.getByRole('button', { name: '新建文档', exact: true }).click()
    await expect(page.getByRole('button', { name: '导入文件', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`toolbar-mobile-${width}.png`) })
    await page.getByRole('button', { name: /^打开发布面板/ }).click()
    await expect(page.getByRole('dialog', { name: '安装发布引擎' })).toBeVisible()
    await page.getByRole('button', { name: '继续本地编辑' }).click()
  }
})
