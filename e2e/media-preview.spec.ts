import { expect, test } from '@playwright/test'

// A valid GIF with a wide logical screen exercises intrinsic media sizing.
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
gif.writeUInt16LE(2044, 6)
gif.writeUInt16LE(1014, 8)

test('keeps GIF previews static, plays explicitly, and fits narrow editor columns', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'gif-layout.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 动图预览测试\n\n正文需要完整显示，不能因为媒体的宽度而被截断。'),
  })
  await page.locator('.cm-content').focus()
  await page.locator('.cm-content').press('Control+End')
  await page.locator('.cm-content').press('Enter')
  await page.locator('.cm-content').press('Enter')
  await page.locator('.source-toolbar input[accept="image/*"]').setInputFiles({ name: 'wide.gif', mimeType: 'image/gif', buffer: gif })
  await expect(page.locator('.source-image-widget.block')).toHaveCount(1)
  const editorImage = page.locator('.source-image-widget img').first()
  const previewImage = page.locator('.wechat-content img[data-ez-gif-source]').first()
  await expect(editorImage).toHaveAttribute('src', /^blob:/)
  await expect(previewImage).toHaveAttribute('src', /^blob:/)
  const still = await editorImage.getAttribute('src')
  await expect(previewImage).toHaveAttribute('src', still!)
  await page.getByRole('button', { name: '播放 GIF', exact: true }).click()
  await expect(editorImage).toHaveAttribute('data-ez-gif-preview', 'playing')
  await expect(editorImage).toHaveAttribute('src', (await previewImage.getAttribute('data-ez-gif-source'))!)
  expect(await editorImage.getAttribute('src')).not.toBe(still)
  await expect(previewImage).toHaveAttribute('src', still!)
  await page.getByRole('tab', { name: /^资源/ }).click()
  // The resource sidebar keeps the desktop editor visible and editable.
  await expect(editorImage).toHaveAttribute('data-ez-gif-preview', 'playing')
  await expect(page.locator('.resource-thumbnail img')).toHaveAttribute('src', still!)
  await page.getByRole('button', { name: '关闭素材', exact: true }).click()
  await page.getByRole('button', { name: '暂停 GIF', exact: true }).click()
  await expect(editorImage).toHaveAttribute('data-ez-gif-preview', 'static')

  // Repeated view replacement should reuse the same poster rather than allocate
  // another decoder/Object URL for each editor/resource/platform transition.
  for (let cycle = 0; cycle < 20; cycle++) {
    await page.getByRole('tab', { name: /^资源/ }).click()
    await expect(page.locator('.resource-thumbnail img')).toHaveAttribute('src', still!)
    await page.getByRole('button', { name: '关闭素材', exact: true }).click()
    await page.getByRole('tab', { name: 'X 长文', exact: true }).click()
    await expect(page.locator('.x-article-content img[data-ez-gif-source]')).toHaveAttribute('src', still!)
    await page.getByRole('tab', { name: '微信公众号', exact: true }).click()
    await expect(previewImage).toHaveAttribute('src', still!)
  }

  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: testInfo.outputPath(`gif-${width}.png`), animations: 'disabled' })
    await expect(editorImage).toBeVisible()
    await expect.poll(() => page.locator('.source-editor-host .cm-scroller').evaluate(scroller => ({
      overflow: scroller.scrollWidth - scroller.clientWidth,
      imageOverflow: scroller.querySelector('figure')!.getBoundingClientRect().right - scroller.getBoundingClientRect().right,
    }))).toMatchObject({ overflow: 0 })
    const overflow = await page.locator('.source-editor-host .cm-scroller').evaluate(scroller => (
      scroller.querySelector('figure')!.getBoundingClientRect().right - scroller.getBoundingClientRect().right
    ))
    expect(overflow).toBeLessThanOrEqual(1)
  }
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await page.reload()
  await expect(page.locator('.source-image-widget img').first()).toHaveAttribute('src', /^blob:/)
  await expect(page.getByRole('button', { name: '播放 GIF', exact: true })).toBeVisible()
})
