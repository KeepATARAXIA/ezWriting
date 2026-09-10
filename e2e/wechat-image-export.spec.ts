import { expect, test } from '@playwright/test'

test('copies baked image pixels for every frame, preserves originals and reports GIF and CORS limitations', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => {
        sessionStorage.setItem('frame-clipboard', await (await items[0].getType('text/html')).text())
      },
    } })
  })
  await page.goto('/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600; canvas.height = 360
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#1648ff'; ctx.fillRect(0, 0, 600, 360)
    return canvas.toDataURL()
  })
  await page.getByRole('button', { name: '使用公众号长文模板开始' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(`\n\n![测试图片](${png})\n\n图片说明\n`)
  const original = page.locator('.wechat-content img').last()
  await expect(original).toBeVisible()
  const originalSrc = await original.getAttribute('src')
  await page.locator('.preview-settings-toggle').click()
  const panel = page.locator('#wechat-theme-panel')
  await panel.getByRole('tab', { name: '样式', exact: true }).click()
  for (const label of ['圆角', '圆角白边', '投影', '相框', '无边框', '跟随主题']) {
    await panel.getByRole('button', { name: label, exact: true }).click()
    await page.evaluate(() => sessionStorage.removeItem('frame-clipboard'))
    await page.locator('.wechat-copy-button').click()
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('frame-clipboard'))).toBeTruthy()
    const result = await page.evaluate(async () => {
      const html = sessionStorage.getItem('frame-clipboard')!
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const node = doc.querySelector<HTMLImageElement>('img[alt="测试图片"]')!
      const img = new Image(); img.src = node.src; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let blue = 0; let white = 0; let translucent = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 2] > 240 && pixels[i] < 30 && pixels[i + 3] > 250) blue++
        if (pixels[i] > 250 && pixels[i + 1] > 250 && pixels[i + 2] > 250 && pixels[i + 3] > 250) white++
        if (pixels[i + 3] > 2 && pixels[i + 3] < 240) translucent++
      }
      return { baked: node.dataset.ezImageFrame, border: node.style.borderWidth, radius: node.style.borderRadius,
        width: img.naturalWidth, corner: pixels[3], blue, white, translucent, html }
    })
    expect(result.blue).toBeGreaterThan(150000)
    if (label !== '无边框') {
      expect(result.baked).toBe('baked')
      expect(result.border).toBe('0px')
      expect(result.radius).toBe('0px')
      if (label !== '跟随主题') expect(result.corner).toBe(0)
      if (label === '圆角白边' || label === '相框') expect(result.white).toBeGreaterThan(1000)
      if (label === '投影' || label === '圆角白边') expect(result.translucent).toBeGreaterThan(1000)
    } else expect(result.baked).toBeUndefined()
    expect(result.html).toContain('图片说明')
    await expect(original).toHaveAttribute('src', originalSrc!)
    if (label === '圆角白边') {
      await page.evaluate(html => {
        const overlay = document.createElement('div'); overlay.id = 'baked-check'
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;overflow:auto;padding:30px'
        overlay.innerHTML = html
        overlay.querySelectorAll('img').forEach(img => { img.removeAttribute('style'); img.style.maxWidth = '640px' })
        document.body.append(overlay)
      }, result.html)
      await page.locator('#baked-check img').last().screenshot({ path: info.outputPath('baked-without-css.png') })
      await page.locator('#baked-check').evaluate(node => node.remove())
    }
  }
  await panel.getByRole('button', { name: '圆角', exact: true }).click()
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n\n![动图](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\n')
  await expect(page.locator('.wechat-content img[alt="动图"]')).toHaveCount(1)
  await page.locator('.wechat-copy-button').click()
  await expect(page.locator('.platform-previews .notification-warning, .notification-warning[role="status"]').filter({ hasText: '1 张动图或暂不支持合成的图片已保留原图' })).toBeVisible()
  await page.route('https://example.com/blocked.png', route => route.abort())
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n\n![远程](https://example.com/blocked.png)\n')
  await expect(page.locator('.wechat-content img[alt="远程"]')).toHaveCount(1)
  await page.evaluate(() => sessionStorage.removeItem('frame-clipboard'))
  await page.locator('.wechat-copy-button').click()
  await expect(page.locator('.notification-warning[role="status"]').filter({ hasText: '图片边框合成失败，未复制' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('frame-clipboard'))).toBeNull()
})
