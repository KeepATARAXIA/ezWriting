import { expect, test, type Page } from '@playwright/test'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dispatch.codex-connection.v1', 'mock-pair'))
  await page.route('**/api/codex/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ plan: 'plus', models: [{ id: 'mock-codex', name: 'Codex', isDefault: true }], limits: [] }) }))
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'artwork.md', mimeType: 'text/markdown', buffer: Buffer.from('# 封面测试标题\n\n这是一段需要配图的正文。\n\n后文保持原样。') })
  await expect(page.locator('.cm-content')).toBeVisible()
}
async function selectParagraph(page: Page) {
  await page.locator('.cm-line').filter({ hasText: '这是一段需要配图的正文。' }).click()
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
}
test('generates selected-text artwork with native Image 2, inserts it and undoes once', async ({ page }, info) => {
  let payload: any
  await page.route('**/api/codex/images', route => { payload = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ dataUrl: png, mime: 'image/png' }) }) })
  await setup(page); await selectParagraph(page)
  await page.getByRole('button', { name: '配图', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '配图', exact: true })
  await expect(panel.getByLabel('配图选段')).toHaveValue('这是一段需要配图的正文。')
  await panel.getByRole('button', { name: '生成配图', exact: true }).click()
  await expect(panel.getByRole('img', { name: '配图裁切预览' })).toBeVisible()
  expect(payload.model).toBe('mock-codex'); expect(payload.prompt).toContain('gpt-image-2')
  expect(payload.prompt).toContain('这是一段需要配图的正文。'); expect(payload.prompt).not.toContain('后文保持原样')
  expect(await panel.getByRole('img', { name: '配图裁切预览' }).evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1536, 864])
  await panel.getByRole('button', { name: '插入选段之后' }).click()
  await expect(page.locator('.wechat-content img')).toHaveCount(1)
  await expect(page.locator('.wechat-content')).toContainText('这是一段需要配图的正文。')
  await expect(page.locator('.wechat-content')).toContainText('后文保持原样。')
  await page.screenshot({ path: info.outputPath('illustration.png') })
  await page.locator('.source-toolbar').getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.wechat-content img')).toHaveCount(0)
})

test('saves an independent cover, exact crop dimensions and shared custom styles across reload', async ({ page }, info) => {
  await page.route('**/api/codex/images', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ dataUrl: png }) }))
  await setup(page)
  await page.getByRole('button', { name: '封面', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '封面', exact: true })
  await panel.getByLabel('封面标题', { exact: true }).fill('另一个封面标题')
  await panel.getByText('编辑风格 / 另存模板', { exact: true }).click()
  await panel.getByLabel('风格名称', { exact: true }).fill('我的浅色封面')
  await panel.getByLabel('风格描述', { exact: true }).fill('白色基底，钴蓝色块。')
  await panel.getByRole('button', { name: '另存为新风格' }).click()
  await panel.getByRole('button', { name: '生成封面', exact: true }).click()
  const preview = panel.getByRole('img', { name: '封面裁切预览', exact: true })
  await expect(preview).toBeVisible()
  expect(await preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1880, 800])
  await panel.getByLabel('尺寸', { exact: true }).selectOption('2')
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1152, 1536])
  await panel.getByRole('button', { name: '保存为稿件封面' }).click()
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await page.reload(); await page.getByRole('button', { name: '封面', exact: true }).click()
  await expect(preview).toBeVisible()
  await expect(panel.getByLabel('封面标题', { exact: true })).toHaveValue('另一个封面标题')
  expect(await preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1152, 1536])
  await expect(page.locator('.wechat-content img')).toHaveCount(0)
  await expect(panel.getByLabel('视觉风格').locator('option')).toHaveCount(6)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`cover-${width}.png`) })
  }
})

test('rejects insertion after intervening edits, recaptures position and reports quota failures', async ({ page }) => {
  let failed = false
  await page.route('**/api/codex/images', route => route.fulfill({ status: failed ? 502 : 200, contentType: 'application/json', body: JSON.stringify(failed ? { error: { code: 'quota' } } : { dataUrl: png }) }))
  await setup(page); await selectParagraph(page); await page.getByRole('button', { name: '配图', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '配图', exact: true })
  await panel.getByRole('button', { name: '生成配图', exact: true }).click()
  await expect(panel.getByRole('img', { name: '配图裁切预览' })).toBeVisible()
  await page.locator('.cm-line').filter({ hasText: '后文保持原样。' }).click(); await page.keyboard.press('End'); await page.keyboard.type('new edit')
  await panel.getByRole('button', { name: '插入选段之后' }).click()
  await expect(panel.getByRole('alert')).toContainText('稿件已变化')
  await expect(page.locator('.wechat-content img')).toHaveCount(0)
  await selectParagraph(page); await panel.getByRole('button', { name: '使用当前选段' }).click()
  await panel.getByRole('button', { name: '插入选段之后' }).click()
  await expect(page.locator('.wechat-content img')).toHaveCount(1)
  failed = true; await panel.getByRole('button', { name: '重新生成', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByRole('img', { name: '配图裁切预览' })).toBeVisible()
})

test('stops an unfinished native image request without applying a late response', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/codex/images', async route => { await gate; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ dataUrl: png }) }).catch(() => {}) })
  await setup(page); await page.getByRole('button', { name: '封面', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '封面', exact: true })
  await panel.getByRole('button', { name: '生成封面', exact: true }).click()
  await expect(panel.getByRole('progressbar', { name: '封面生成进度' })).toBeVisible()
  await expect(panel.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  await expect(panel.locator('.artwork-elapsed')).toHaveText('0:01')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(panel.getByRole('progressbar')).toBeInViewport()
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
  await panel.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(panel.getByRole('progressbar')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '生成封面', exact: true })).toBeEnabled()
  release()
  await expect(panel.getByRole('img', { name: '封面裁切预览' })).toHaveCount(0)
  await expect(page.locator('.wechat-content img')).toHaveCount(0)
})

test('crops without stretching and moves the crop across the original image', async ({ page }) => {
  await setup(page)
  const sample = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 300
    const context = canvas.getContext('2d')!
    for (const [index, color] of ['#ff0000', '#0000ff', '#00ff00'].entries()) { context.fillStyle = color; context.fillRect(index * 200, 0, 200, 300) }
    return canvas.toDataURL('image/png')
  })
  await page.route('**/api/codex/images', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ dataUrl: sample }) }))
  await page.getByRole('button', { name: '封面', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '封面', exact: true })
  await panel.getByLabel('宽度', { exact: true }).fill('256'); await panel.getByLabel('高度', { exact: true }).fill('256')
  await panel.getByRole('button', { name: '生成封面', exact: true }).click()
  const preview = panel.getByRole('img', { name: '封面裁切预览', exact: true })
  const pixel = () => preview.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    return [...context.getImageData(128, 128, 1, 1).data].slice(0, 3)
  })
  await expect.poll(pixel).toEqual([0, 0, 255])
  await panel.getByLabel('水平构图').focus(); await page.keyboard.press('Home')
  await expect.poll(pixel).toEqual([255, 0, 0])
  await page.keyboard.press('End'); await expect.poll(pixel).toEqual([0, 255, 0])
  const download = page.waitForEvent('download')
  await panel.getByRole('link', { name: '下载 PNG' }).click()
  expect((await download).suggestedFilename()).toBe('封面-256x256.png')
})
