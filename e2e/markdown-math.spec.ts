import { expect, test } from '@playwright/test'

test.use({ headless: true })

const markdown = String.raw`# 公式排版验收

行内公式 $E=mc^2$ 与普通文字。

$$\mathbf{总交付耗时} = \mathbf{前置准备} + \mathbf{生成等待} + \mathbf{事实核验} + \mathbf{人工微调}$$

$$
\frac{a_1+b^2}{\sqrt{x}} = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}
$$

代码保持原样：` + '`$x$`' + '\n\n最后一段。'

test('renders, edits, reloads and copies all formulas as standalone PNG images', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: {
      write: async (items: ClipboardItem[]) => {
        const html = await (await items[0].getType('text/html')).text()
        sessionStorage.setItem('math-clipboard', html)
      },
    }, configurable: true })
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'math.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
  await expect(page.locator('.wechat-content .katex')).toHaveCount(3)
  await expect(page.locator('.cm-math-widget')).toHaveCount(3)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: info.outputPath('math-preview.png') })
  await page.locator('.cm-math-widget').first().click()
  await expect(page.locator('.cm-math-widget')).toHaveCount(3)
  await expect(page.locator('.cm-content')).not.toContainText('$E=mc^2$')
  await page.locator('.cm-math-widget').nth(1).click()
  await expect(page.locator('.cm-math-widget')).toHaveCount(3)
  await expect(page.locator('.cm-content')).not.toContainText('\\mathbf')
  await page.keyboard.press('Control+a')
  await expect(page.locator('.cm-math-widget')).toHaveCount(3)
  await page.locator('.cm-math-widget').first().click()
  await page.getByRole('button', { name: '显示 Markdown 语法', exact: true }).click()
  await expect(page.locator('.cm-math-widget')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('$E=mc^2$')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.insertText('2')
  await expect(page.locator('.wechat-content [data-ez-math]').first()).toHaveAttribute('data-ez-math', '2E=mc^2')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.wechat-content [data-ez-math]').first()).toHaveAttribute('data-ez-math', 'E=mc^2')
  await expect(page.locator('.cm-content')).toContainText('\\frac')
  await page.getByRole('button', { name: '隐藏 Markdown 语法', exact: true }).click()
  await expect(page.locator('.cm-math-widget')).toHaveCount(3)
  await expect(page.locator('.cm-content')).not.toContainText('$E=mc^2$')
  await page.getByRole('button', { name: '复制公众号格式', exact: true }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('math-clipboard'))).toBeTruthy()
  const copied = await page.evaluate(async () => {
    const html = sessionStorage.getItem('math-clipboard')!
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const images = [...doc.images]
    const sizes = await Promise.all(images.map(async node => {
      const image = new Image()
      image.src = node.src
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 20) ink++
      return { width: image.naturalWidth, height: image.naturalHeight, ink }
    }))
    return { sources: images.map(node => node.src.slice(0, 22)), sizes, hasKatex: !!doc.querySelector('.katex'), html }
  })
  expect(copied.sources).toEqual(Array(3).fill('data:image/png;base64,'))
  expect(copied.hasKatex).toBe(false)
  for (const size of copied.sizes) { expect(size.width).toBeGreaterThan(30); expect(size.height).toBeGreaterThan(15); expect(size.ink).toBeGreaterThan(50) }
  await page.evaluate(html => {
    const preview = document.createElement('section')
    preview.id = 'portable-math-check'
    preview.style.cssText = 'position:fixed;inset:20px;z-index:999999;background:white;padding:30px;overflow:auto;'
    preview.innerHTML = html
    document.body.append(preview)
  }, copied.html)
  await page.locator('#portable-math-check').screenshot({ path: info.outputPath('math-export.png') })
  await page.locator('#portable-math-check').evaluate(node => node.remove())
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await page.reload()
  await expect(page.locator('.wechat-content .katex')).toHaveCount(3)
  await page.getByRole('button', { name: '手机预览', exact: true }).click()
  await expect(page.locator('.mobile-wechat-content .katex')).toHaveCount(3)
  await expect.poll(() => page.locator('.mobile-wechat-content .ez-math-display').first().evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath('math-mobile.png') })
  expect(errors).toEqual([])
})

test('exports formula cards and sends PNG images through the publishing bridge', async ({ page }, info) => {
  await page.addInitScript(() => {
    const account = { type: 'weixin', uid: 'math-test', displayName: '微信公众号', title: '测试账号' }
    Object.assign(window, { $syncer: {
      getAccounts: (callback: (value: unknown) => void) => callback([account]),
      addTask: (task: unknown, callback: (value: unknown) => void) => {
        sessionStorage.setItem('math-published', JSON.stringify(task))
        callback({ accounts: [{ ...account, status: 'done' }] })
      },
    } })
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'math.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
  await page.getByRole('tab', { name: '小红书', exact: true }).click()
  await expect(page.locator('.xhs-card-content .katex').first()).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载当前图片', exact: true }).click()
  const file = await download
  await file.saveAs(info.outputPath('math-card.png'))
  expect(await file.failure()).toBeNull()
  await page.getByRole('tab', { name: '微信公众号', exact: true }).click()
  await page.getByRole('button', { name: /打开发布面板/ }).click()
  await page.locator('.platform-row').first().click()
  await page.locator('.publish-button').click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('math-published'))).toBeTruthy()
  const payload = await page.evaluate(() => {
    const task = JSON.parse(sessionStorage.getItem('math-published')!)
    const document = new DOMParser().parseFromString(task.post.content, 'text/html')
    return { images: [...document.images].filter(image => image.src.startsWith('data:image/png')).length,
      hasKatex: !!document.querySelector('.katex'), markdown: task.post.markdown }
  })
  expect(payload.images).toBe(3)
  expect(payload.hasKatex).toBe(false)
  expect(payload.markdown).not.toContain('\\mathbf')
  expect(payload.markdown).toContain('![公式](<data:image/png;base64,')
  expect(payload.markdown).toContain('`$x$`')
  expect(errors).toEqual([])
})
