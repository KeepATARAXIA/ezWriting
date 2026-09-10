import { expect, test, type Page } from '@playwright/test'

const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n'
const stream = (value: unknown) => frame({ type: 'delta', text: JSON.stringify(value) }) + frame({ type: 'done' })
const source = '# 原稿标题\n\n## 小标题\n\n这句话非常非常好。\n\n保留后文和[参考资料](https://example.com/guide)。'
async function setup(page: Page, content = source, extension = 'md') {
  await page.addInitScript(() => localStorage.setItem('dispatch.ai-settings.v1', JSON.stringify({ provider: 'gemini', profiles: { gemini: { model: 'mock-model', apiKey: 'mock-key' } } })))
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'article.' + extension, mimeType: extension === 'html' ? 'text/html' : 'text/markdown', buffer: Buffer.from(content) })
  await expect(page.locator('.cm-content')).toBeVisible()
  await page.getByRole('button', { name: 'AI 工具', exact: true }).click()
  await expect(page.getByRole('button', { name: '全文', exact: true })).toHaveAttribute('aria-pressed', 'true')
}
async function send(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: '对话要求' }).fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('discusses the draft, revises it over multiple turns, previews changes and applies one undoable edit', async ({ page }, info) => {
  const requests: any[] = []
  await page.route('**/api/ai/generate', route => {
    const payload = JSON.parse(route.request().postDataJSON().prompt); requests.push(payload)
    const revision = requests.length === 1 ? null : { title: '修改后的标题', body: (payload.previousRevision ?? payload.document).body.replace('非常非常好', '很好').replace(requests.length === 3 ? '很好' : '不会出现', '写得好') }
    return route.fulfill({ contentType: 'text/event-stream', body: stream({ reply: revision ? '已优化重复表达，保留原有段落和链接。' : '建议精简重复的“非常”。', revision }) })
  })
  await setup(page)
  const before = await page.locator('.cm-content').textContent()
  await page.screenshot({ path: info.outputPath('ai-workspace-empty.png') })
  expect(requests).toHaveLength(0)
  await send(page, '先给修改建议')
  await expect(page.locator('.ai-chat-reply')).toHaveCount(1)
  await expect(page.locator('.ai-revision-card')).toHaveCount(0)
  await send(page, '按建议润色全文')
  await expect(page.locator('.ai-revision-card')).toHaveCount(1)
  expect(await page.locator('.cm-content').textContent()).toBe(before)
  await send(page, '继续改得更自然')
  await expect(page.locator('.ai-revision-card')).toHaveCount(2)
  expect(requests[2].previousRevision.body).toContain('这句话很好。')
  expect(requests[2].history).toHaveLength(2)
  await page.locator('.ai-revision-card').last().click()
  const preview = page.getByRole('dialog', { name: '全文修改预览' })
  await expect(preview.locator('.ai-document-reading')).toContainText('这句话写得好。')
  await expect(preview.getByRole('link', { name: '参考资料' })).toHaveAttribute('href', 'https://example.com/guide')
  await preview.getByRole('button', { name: '查看改动' }).click()
  await expect(preview.locator('del').filter({ hasText: '非常非常' })).toHaveText('非常非常')
  await preview.getByRole('button', { name: '阅读修改稿' }).click()
  await page.screenshot({ path: info.outputPath('ai-full-document-preview.png') })
  await preview.getByRole('button', { name: '应用全文修改' }).click()
  await expect(preview.getByRole('button', { name: '已应用', exact: true })).toBeDisabled()
  await preview.getByRole('button', { name: '返回对话' }).click()
  await expect(page.locator('.wechat-content')).toContainText('这句话写得好。')
  await expect(page.locator('.topbar-document-title')).toHaveText('修改后的标题')
  await page.locator('.source-toolbar').getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.wechat-content')).toContainText('这句话非常非常好。')
  await expect(page.locator('.topbar-document-title')).toHaveText('原稿标题')
  expect(await page.locator('.cm-content').textContent()).toBe(before)
  await page.screenshot({ path: info.outputPath('ai-workspace-conversation.png') })
})

test('rejects a stale full-document result and sends the current editor text on retry', async ({ page }) => {
  const requests: any[] = []
  await page.route('**/api/ai/generate', route => {
    const payload = JSON.parse(route.request().postDataJSON().prompt); requests.push(payload)
    return route.fulfill({ contentType: 'text/event-stream', body: stream({ reply: '修改完成。', revision: { title: payload.document.title, body: payload.document.body.replace('非常非常好', '很好') } }) })
  })
  await setup(page); await send(page, '润色全文')
  await expect(page.locator('.ai-revision-card')).toHaveCount(1)
  await page.locator('.cm-line').filter({ hasText: '这句话非常非常好。' }).click()
  await page.keyboard.press('End'); await page.keyboard.type('new edit')
  await page.locator('.ai-revision-card').click()
  await page.getByRole('button', { name: '应用全文修改' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('已发生变化')
  await page.getByRole('button', { name: '返回对话' }).click()
  await expect(page.locator('.cm-content')).toContainText('new edit')
  await send(page, '基于当前文章重新润色')
  await expect(page.locator('.ai-revision-card')).toHaveCount(2)
  expect(requests[1].document.body).toContain('new edit')
  expect(requests[1].previousRevision).toBeNull()
})

test('keeps embedded images local and retains them through preview, apply, undo and refresh', async ({ page }) => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  let request: any
  await page.route('**/api/ai/generate', route => {
    request = JSON.parse(route.request().postDataJSON().prompt)
    return route.fulfill({ contentType: 'text/event-stream', body: stream({ reply: '已精简正文。', revision: { title: request.document.title, body: request.document.body.replace('非常非常好', '很好') } }) })
  })
  await setup(page, source + '\n\n![配图](' + image + ')')
  await send(page, '润色全文')
  await expect(page.locator('.ai-revision-card')).toHaveCount(1)
  expect(JSON.stringify(request)).not.toContain('base64')
  expect(request.document.body).toContain('dispatch-editor-image://')
  await page.locator('.ai-revision-card').click()
  await expect(page.locator('.ai-document-reading img')).toHaveCount(1)
  await page.getByRole('button', { name: '应用全文修改' }).click()
  await page.getByRole('button', { name: '返回对话' }).click()
  await expect(page.locator('.wechat-content')).toContainText('这句话很好。')
  await expect(page.locator('.wechat-content img')).toHaveCount(1)
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存')
  await page.reload()
  await expect(page.locator('.wechat-content')).toContainText('这句话很好。')
  await expect(page.locator('.wechat-content img')).toHaveCount(1)
})

test('keeps HTML structure and reads a long result without nested content scrolling on desktop and phone', async ({ page }, info) => {
  const body = '<h1>HTML 原稿</h1><h2>小标题</h2>' + '<p>这句话非常非常好，保留完整段落。</p>'.repeat(36)
  await page.route('**/api/ai/generate', route => {
    const { document } = JSON.parse(route.request().postDataJSON().prompt)
    return route.fulfill({ contentType: 'text/event-stream', body: stream({ reply: '已精简全文。', revision: { title: document.title, body: document.body.replaceAll('非常非常好', '很好') } }) })
  })
  await setup(page, body, 'html'); await send(page, '润色全文')
  await expect(page.locator('.ai-revision-card')).toHaveCount(1)
  await page.locator('.ai-revision-card').click()
  await expect(page.locator('.ai-document-reading p')).toHaveCount(36)
  const dialog = page.getByRole('dialog', { name: '全文修改预览' })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    expect(await page.locator('.ai-document-reading').evaluate(node => getComputedStyle(node).overflowY)).toBe('visible')
    await page.locator('.ai-document-preview-scroll').evaluate(node => { node.scrollTop = node.scrollHeight })
    await expect(page.locator('.ai-document-reading p').last()).toBeInViewport()
    await expect(page.getByRole('button', { name: '应用全文修改' })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('ai-document-long-' + width + '.png') })
  }
  await page.getByRole('button', { name: '应用全文修改' }).click()
  await page.getByRole('button', { name: '返回对话' }).click()
  await expect(page.locator('.wechat-content')).toContainText('这句话很好')
  await expect(page.getByRole('complementary', { name: 'AI 工具' })).toBeVisible()
})

test('blocks altered links and oversized input without modifying the draft', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/generate', route => {
    calls++
    const { document } = JSON.parse(route.request().postDataJSON().prompt)
    return route.fulfill({ contentType: 'text/event-stream', body: stream({ reply: '完成。', revision: { title: document.title, body: document.body.replace('example.com/guide', 'evil.example/guide') } }) })
  })
  await setup(page); await send(page, '润色全文')
  await expect(page.getByRole('alert')).toContainText('已阻止应用')
  await expect(page.locator('.ai-revision-card')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭 AI 工具' }).click()
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'large.md', mimeType: 'text/markdown', buffer: Buffer.from('# 长文\n\n' + '内容。\n\n'.repeat(5000)) })
  await expect(page.locator('.topbar-document-title')).toHaveText('长文')
  await page.getByRole('button', { name: 'AI 工具', exact: true }).click()
  await send(page, '润色全文')
  await expect(page.getByRole('alert')).toContainText('24,000')
  expect(calls).toBe(1)
})
