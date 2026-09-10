import { expect, test, type Page } from '@playwright/test'

const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n'
const answer = (reply = '让灵感落到纸上。') => frame({ type: 'delta', text: JSON.stringify({ reply, revision: null }) }) + frame({ type: 'done' })
async function openAi(page: Page) {
  await page.getByRole('button', { name: 'AI 工具', exact: true }).click()
  await page.getByRole('button', { name: '模型配置', exact: true }).click()
}
async function chat(page: Page) { await page.getByRole('button', { name: '对话', exact: true }).click() }
async function send(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: '对话要求', exact: true }).fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('separates settings and presets from conversation and preserves writing choices', async ({ page }, info) => {
  const requests: { prompt: string }[] = []
  await page.route('**/api/ai/generate', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'text/event-stream', body: answer() })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'AI 工具', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'AI 工具' })
  await expect(page.getByLabel('API Key', { exact: true })).toBeHidden()
  await expect(page.getByRole('combobox', { name: '润色方案', exact: true })).toBeHidden()
  await expect(page.getByRole('textbox', { name: '对话要求' })).toBeVisible()
  await page.getByRole('button', { name: '打开模型设置' }).click()
  await page.getByLabel('模型', { exact: true }).selectOption('deepseek')
  await page.getByLabel('API Key', { exact: true }).fill('mock-key')
  await page.getByRole('button', { name: '润色方案', exact: true }).click()
  await expect(page.getByLabel('API Key', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: '添加自定义方案' }).click()
  await page.locator('.ai-preset-manager .ai-preset-row').nth(3).getByText('编辑方案', { exact: true }).click()
  await page.getByLabel('方案 4 名称', { exact: true }).fill('公众号口语化')
  await page.getByLabel('方案 4 提示词', { exact: true }).fill('用短句与读者交流，不强行升华。')
  await page.getByRole('combobox', { name: '润色方案', exact: true }).selectOption('3')
  await page.getByRole('button', { name: '更口语', exact: true }).click()
  await page.getByRole('button', { name: '更有网感', exact: true }).click()
  await page.getByRole('button', { name: '更有网感', exact: true }).click()
  await chat(page)
  await send(page, '给我的写作工具写一句介绍')
  await expect(page.locator('.ai-chat-reply')).toHaveText('让灵感落到纸上。')
  const input = JSON.parse(requests[0].prompt)
  expect(input.plan).toEqual({ name: '公众号口语化', instruction: '用短句与读者交流，不强行升华。', strength: 20 })
  expect(input.refinements).toHaveLength(1)
  expect(input.document).toBeNull()
  expect(requests[0].prompt).not.toContain('mock-key')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const button = page.getByRole('button', { name: '发送', exact: true })
    const before = await button.boundingBox()
    await page.locator('.ai-chat-messages').evaluate(node => { node.scrollTop = 0 })
    const after = await button.boundingBox(), box = await sidebar.boundingBox()
    expect(after!.y).toBeCloseTo(before!.y, 0)
    expect(after!.y + after!.height).toBeLessThanOrEqual(box!.y + box!.height)
    expect(await sidebar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('ai-chat-' + width + '.png') })
  }
})

test('isolates keys, restores providers after refresh and clears stored keys', async ({ page }) => {
  const requests: { headers: Record<string, string>; body: Record<string, unknown> }[] = []
  await page.route('**/api/ai/generate', route => {
    requests.push({ headers: route.request().headers(), body: route.request().postDataJSON() })
    return route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'delta', text: '连接成功' }) + frame({ type: 'done' }) })
  })
  await page.goto('/'); await openAi(page)
  const key = page.getByLabel('API Key', { exact: true })
  await expect(page.getByRole('button', { name: '测试连接' })).toBeDisabled()
  await key.fill('gemini-test-key')
  await expect(key).toHaveAttribute('type', 'password')
  await page.getByLabel('模型', { exact: true }).selectOption('deepseek')
  await expect(key).toHaveValue('')
  await key.fill('deepseek-test-key')
  await page.getByLabel('模型名称', { exact: true }).fill('my-enabled-model')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.locator('.ai-config-module [role="status"]')).toContainText('DeepSeek · my-enabled-model 连接成功')
  expect(requests[0].headers['x-ai-key']).toBe('deepseek-test-key')
  expect(requests[0].body).toEqual({ provider: 'deepseek', model: 'my-enabled-model', action: 'test' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'AI 工具', exact: true })).toBeFocused()
  await openAi(page)
  await expect(key).toHaveValue('deepseek-test-key')
  await page.getByLabel('模型', { exact: true }).selectOption('glm')
  await key.fill('glm-test-key')
  await page.reload(); await openAi(page)
  for (const provider of ['gemini', 'deepseek', 'glm']) {
    await page.getByLabel('模型', { exact: true }).selectOption(provider)
    await expect(key).toHaveValue(provider + '-test-key')
  }
  await page.getByRole('button', { name: '清除所有 Key' }).click()
  await page.reload(); await openAi(page)
  for (const provider of ['gemini', 'deepseek', 'glm']) {
    await page.getByLabel('模型', { exact: true }).selectOption(provider)
    await expect(key).toHaveValue('')
  }
  expect(requests).toHaveLength(1)
})

test('sends only explicit context, supports follow-ups, renders safely and keeps the draft unchanged', async ({ page }) => {
  const requests: { prompt: string }[] = []
  await page.route('**/api/ai/generate', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'text/event-stream', body: answer('建议精简。<script>window.__unsafe=true</script>') })
  })
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'private.md', mimeType: 'text/markdown', buffer: Buffer.from('# 私有稿件\n\n这段正文不能自动发给模型。') })
  await expect(page.locator('.wechat-content')).toContainText('这段正文不能自动发给模型')
  const original = await page.locator('.cm-content').textContent()
  await openAi(page); await page.getByLabel('API Key', { exact: true }).fill('mock-key'); await chat(page)
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: '全文', exact: true }).click()
  await send(page, '给一个创作工具写一句介绍')
  await expect(page.locator('.ai-chat-reply')).toContainText('<script>')
  expect(JSON.parse(requests[0].prompt).document).toBeNull()
  expect(requests[0].prompt).not.toContain('私有稿件')
  expect(await page.evaluate(() => '__unsafe' in window)).toBe(false)
  await send(page, '再简短一些')
  await expect(page.locator('.ai-chat-reply')).toHaveCount(2)
  expect(JSON.parse(requests[1].prompt).history[0].instruction).toBe('给一个创作工具写一句介绍')
  await page.getByRole('button', { name: '不附带全文', exact: true }).click()
  await send(page, '先读文章给建议')
  await expect(page.locator('.ai-chat-reply')).toHaveCount(3)
  expect(JSON.parse(requests[2].prompt).document.body).toContain('这段正文')
  await page.getByRole('button', { name: '全文', exact: true }).click()
  await send(page, '另聊一件事')
  await expect(page.locator('.ai-chat-reply')).toHaveCount(4)
  expect(requests[3].prompt).not.toContain('先读文章给建议')
  expect(requests[3].prompt).not.toContain('私有稿件')
  expect(await page.locator('.cm-content').textContent()).toBe(original)
})

test('shows failures and preserves partial replies without allowing partial application', async ({ page }) => {
  let calls = 0
  await page.route('**/api/ai/generate', route => ++calls === 1
    ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid_key' } }) })
    : route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'delta', text: '{"reply":"收到一半的文字' }) + frame({ type: 'error', code: 'truncated' }) }))
  await page.goto('/'); await openAi(page)
  await page.getByLabel('API Key', { exact: true }).fill('mock-key')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByRole('alert')).toContainText('API Key 无效或已过期')
  await chat(page); await send(page, '写一句话')
  await expect(page.getByRole('alert')).toContainText('输出达到长度上限')
  await expect(page.locator('.ai-chat-reply')).toHaveText('收到一半的文字')
  await expect(page.locator('.ai-revision-card')).toHaveCount(0)
})

test('streams replies, prevents duplicates, stops requests and cancels on close', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch
    const state = { calls: 0, aborted: 0 }
    Object.assign(window, { __aiTest: state })
    window.fetch = async (input, init) => {
      if (input !== '/api/ai/generate') return original(input, init)
      state.calls++
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"{\\"reply\\":\\"逐步出现的文字"}\n\n'))
        init?.signal?.addEventListener('abort', () => { state.aborted++; controller.error(new DOMException('Aborted', 'AbortError')) })
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
  })
  await page.goto('/'); await openAi(page)
  await page.getByLabel('API Key', { exact: true }).fill('mock-key'); await chat(page)
  await send(page, '写一句话')
  await expect(page.locator('.ai-chat-reply')).toHaveText('逐步出现的文字')
  await expect(page.getByRole('textbox', { name: '对话要求' })).toBeDisabled()
  await page.getByRole('button', { name: '模型配置', exact: true }).click()
  await expect(page.getByLabel('模型', { exact: true })).toBeDisabled()
  await chat(page)
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(page.locator('.ai-chat-turn [role="status"]')).toContainText('已停止请求')
  await send(page, '重新写')
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => (window as unknown as { __aiTest: unknown }).__aiTest)).toEqual({ calls: 2, aborted: 2 })
  await openAi(page); await chat(page)
  await expect(page.locator('.ai-chat-turn')).toHaveCount(0)
})

test('reports blocked persistence while allowing the current page to use the key', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'dispatch.ai-settings.v1') throw new DOMException('Blocked', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.goto('/'); await openAi(page)
  await page.getByLabel('API Key', { exact: true }).fill('mock-unsaved-key')
  await expect(page.getByRole('alert')).toContainText('浏览器未能保存本次配置')
  await expect(page.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled()
  await page.reload(); await openAi(page)
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('')
})
