import { expect, test, type Page } from '@playwright/test'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lR0AAAAASUVORK5CYII=', 'base64')
async function importContent(page: Page, content: string, html = false) {
  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({ name: html ? 'focus.html' : 'focus.md', mimeType: html ? 'text/html' : 'text/markdown', buffer: Buffer.from(content) })
  await expect(page.locator('.cm-editor')).toBeVisible()
}

test('defaults to two panes and keeps resources resizable without replacing the editor', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('dispatch.history-sidebar-expanded.v1', 'true')
    localStorage.setItem('dispatch.preview-tool-rail-open.v1', JSON.stringify({ wechat: true, xhs: true, x: false }))
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await importContent(page, '# 专注写作\n\n一篇文章，完成编辑、排版与平台预览。\n\n![待补图片](missing.png)')
  await expect(page.locator('.history-sidebar')).toHaveClass(/collapsed/)
  await expect(page.locator('.preview-settings-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '17px')
  await page.screenshot({ path: testInfo.outputPath('default-1920.png') })
  await page.getByRole('button', { name: '文档素材', exact: true }).click()
  await expect(page.locator('.paper-panel .resource-panel')).toBeVisible()
  await expect(page.locator('.cm-editor')).toBeHidden()
  expect((await page.locator('.paper-panel').boundingBox())!.width).toBeGreaterThanOrEqual(280)
  await page.screenshot({ path: testInfo.outputPath('resources-1920.png') })
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.locator('.preview-settings-toggle').click()
  await page.reload()
  await expect(page.locator('.preview-settings-toggle')).toHaveAttribute('aria-expanded', 'false')
})

test('follows user scrolling only when enabled and retains click-to-source positioning', async ({ page }) => {
  await importContent(page, '# 长文定位\n\n' + Array.from({ length: 90 }, (_, i) => `第${i + 1}段，这是滚动对照测试。${'长文编辑需要准确定位。'.repeat(4)}`).join('\n\n'))
  const left = page.locator('.cm-scroller')
  const right = page.locator('.platform-preview-viewport')
  await left.hover()
  await page.mouse.wheel(0, 1600)
  await expect.poll(() => right.evaluate(node => node.scrollTop)).toBeGreaterThan(300)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('switch', { name: '同步滚动' }).uncheck()
  await page.keyboard.press('Escape')
  const before = await right.evaluate(node => node.scrollTop)
  await left.hover()
  await page.mouse.wheel(0, 1800)
  await page.waitForTimeout(600)
  expect(await right.evaluate(node => node.scrollTop)).toBeCloseTo(before, 0)
  const paragraph = page.locator('.wechat-content [data-source-block="30"]').first()
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.click()
  await expect(page.locator('.source-editor .cm-content')).toBeFocused()
  await expect(page.locator('.source-focus-line')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('switch', { name: '同步滚动' })).not.toBeChecked()
})

test('retries failed images and replaces them in the original article', async ({ page }) => {
  let ready = false
  await page.route('https://assets.test/image.png', route => ready ? route.fulfill({ contentType: 'image/png', body: png }) : route.abort())
  await importContent(page, '# 素材修复\n\n![外链图](https://assets.test/image.png)')
  await page.getByRole('button', { name: '文档素材', exact: true }).click()
  const resource = page.locator('.article-resource-card')
  await expect(resource).toContainText('图片加载失败')
  ready = true
  await resource.getByRole('button', { name: '重试', exact: true }).click()
  await expect(resource.locator('img')).toBeVisible()
  await expect.poll(() => resource.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
  const chooser = page.waitForEvent('filechooser')
  await resource.getByRole('button', { name: '替换', exact: true }).click()
  await (await chooser).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png })
  await expect(resource).toContainText('replacement.png')
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await expect(page.locator('.wechat-content img')).toHaveAttribute('src', /^blob:/)
})

test('applies panel colors directly in preview, copy and restored drafts without changing the source', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items: ClipboardItem[]) => {
      Object.assign(window, { __focusCopy: await (await items[0].getType('text/html')).text() })
    } } })
  })
  await importContent(page, '<h1>主题覆盖验证</h1><p>普通正文 <strong><span style="color:#00aa55">原文绿色强调</span></strong></p><img src="data:image/png;base64,' + png.toString('base64') + '" style="border:2px solid #00aa55" alt="配图">', true)
  await page.getByRole('button', { name: '显示 Markdown 语法', exact: true }).click()
  const originalSource = await page.locator('.cm-content').textContent()
  await page.locator('.preview-settings-toggle').click()
  await page.getByRole('button', { name: /^预览克莱因蓝主题/ }).click()
  await page.getByRole('button', { name: '立即应用', exact: true }).click()
  await page.locator('.inspector-tabs').getByRole('tab', { name: '样式', exact: true }).click()
  await page.getByRole('radio', { name: 'orange', exact: true }).click()
  await expect(page.locator('.wechat-content strong')).toHaveCSS('color', 'rgb(240, 106, 42)')
  await expect(page.locator('.wechat-content strong span')).not.toHaveCSS('color', 'rgb(0, 170, 85)')
  await expect(page.locator('.wechat-content img')).not.toHaveCSS('border-top-color', 'rgb(0, 170, 85)')
  await page.getByRole('button', { name: '复制公众号格式', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __focusCopy: string }).__focusCopy)).toContain('data-wechat-theme="klein"')
  const copied = await page.evaluate(() => (window as unknown as { __focusCopy: string }).__focusCopy)
  expect(copied).not.toContain('rgb(0, 170, 85)')
  expect(copied).not.toContain('data-ez-source-decoration')
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  // Exercise a legacy saved policy: reopening must still honor the visible controls.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('dispatch-workbench-local')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('drafts', 'readwrite')
      const store = transaction.objectStore('drafts')
      const drafts = store.getAll()
      drafts.onsuccess = () => {
        for (const draft of drafts.result) store.put({ ...draft, formatting: { ...draft.formatting, sourceStyle: 'preserve' } })
      }
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    }
  }))
  await page.reload()
  await page.locator('.preview-settings-toggle').click()
  await expect(page.locator('.wechat-content strong')).toHaveCSS('color', 'rgb(240, 106, 42)')
  await expect(page.locator('.cm-content')).toHaveText(originalSource!)
  await page.screenshot({ path: testInfo.outputPath('theme-policy-1440.png') })
})
