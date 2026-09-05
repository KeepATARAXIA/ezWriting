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
  const figure = page.locator('.source-image-widget.block')
  await page.mouse.move(10, 10)
  await expect(figure).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(figure.locator('.source-image-actions')).toHaveCSS('opacity', '0')
  const geometry = await figure.evaluate(node => {
    const box = node.getBoundingClientRect()
    const line = node.closest('.cm-line')!
    const parent = line.getBoundingClientRect()
    const style = getComputedStyle(line)
    return { left: box.left - parent.left - parseFloat(style.paddingLeft), right: parent.right - parseFloat(style.paddingRight) - box.right,
      footer: node.querySelector('figcaption')!.getBoundingClientRect().height }
  })
  expect(Math.abs(geometry.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.right)).toBeLessThanOrEqual(1)
  expect(geometry.footer).toBeLessThanOrEqual(32)
  await figure.hover()
  await expect(figure.locator('.source-image-actions')).toHaveCSS('opacity', '1')
  const actions = (await figure.locator('.source-image-actions').boundingBox())!
  const bounds = (await figure.boundingBox())!
  expect(actions.y - bounds.y).toBeLessThanOrEqual(10)
  expect(bounds.x + bounds.width - actions.x - actions.width).toBeLessThanOrEqual(10)
  await page.getByRole('button', { name: '播放 GIF', exact: true }).click()
  await expect(editorImage).toHaveAttribute('data-ez-gif-preview', 'playing')
  await expect(editorImage).toHaveAttribute('src', (await previewImage.getAttribute('data-ez-gif-source'))!)
  expect(await editorImage.getAttribute('src')).not.toBe(still)
  await expect(previewImage).toHaveAttribute('src', still!)
  await page.getByRole('button', { name: '文档素材', exact: true }).click()
  // Hiding the editor stops media playback and retains the decoded poster.
  await expect(editorImage).toHaveAttribute('data-ez-gif-preview', 'static')
  await expect(page.locator('.resource-thumbnail img')).toHaveAttribute('src', still!)
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await expect(editorImage).toHaveAttribute('data-ez-gif-preview', 'static')

  // Repeated view replacement should reuse the same poster rather than allocate
  // another decoder/Object URL for each editor/resource/platform transition.
  for (let cycle = 0; cycle < 20; cycle++) {
    await page.getByRole('button', { name: '文档素材', exact: true }).click()
    await expect(page.locator('.resource-thumbnail img')).toHaveAttribute('src', still!)
    await page.getByRole('button', { name: '正文', exact: true }).click()
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
