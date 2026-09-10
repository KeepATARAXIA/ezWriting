import { expect, test, type Page } from '@playwright/test'

const code = 'mock-local-connection'
const status = { plan: 'plus', models: [{ id: 'mock-codex-model', name: 'Codex test model', isDefault: true }],
  limits: [{ name: 'Codex', windows: [{ usedPercent: 23, minutes: 300, resetsAt: 1788800000 }] }] }
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
async function openCodex(page: Page) {
  await page.getByRole('button', { name: 'AI 工具', exact: true }).click()
  await page.getByRole('button', { name: '模型配置', exact: true }).click()
  await page.getByLabel('模型', { exact: true }).selectOption('codex')
  await page.getByRole('button', { name: '连接本机 Codex', exact: true }).click()
}
async function pair(page: Page, token = code) {
  await page.getByLabel('本机连接码').fill(token)
  await page.getByRole('button', { name: '连接本机 Codex', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新连接与额度' })).toBeEnabled({ timeout: 30_000 })
}
async function mockStatus(page: Page) {
  await page.route('**/api/codex/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(status) }))
}

test('pairs locally, reads models and quota, restores the tab and disconnects without persisting credentials', async ({ page }, info) => {
  await mockStatus(page)
  await page.goto('/'); await openCodex(page)
  await expect(page.getByLabel('API Key', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled()
  await pair(page)
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('mock-codex-model')
  await expect(page.getByRole('region', { name: 'Codex 本地连接' })).toContainText('77%')
  expect(await page.evaluate(() => localStorage.getItem('dispatch.codex-connection.v1'))).toBe(code)
  await page.reload()
  await page.getByRole('button', { name: 'AI 工具', exact: true }).click()
  await page.getByRole('button', { name: '模型配置', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新连接与额度' })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('codex-connected.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  const sidebar = page.getByRole('complementary', { name: 'AI 工具' })
  expect(await sidebar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '忘记此设备', exact: true }).click()
  await expect(page.getByLabel('本机连接码')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('dispatch.codex-connection.v1'))).toBeNull()
})

test('sends only explicit writing input to localhost without a vendor key or Worker call', async ({ page }) => {
  await mockStatus(page)
  const requests: { body: Record<string, unknown>; headers: Record<string, string> }[] = []
  await page.route('**/api/ai/generate', () => { throw new Error('Codex must not call Worker') })
  await page.route('**/api/codex/generate', route => {
    requests.push({ body: route.request().postDataJSON(), headers: route.request().headers() })
    return route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'delta', text: JSON.stringify({ reply: '写下灵感。', revision: null }) }) + frame({ type: 'done' }) })
  })
  await page.goto('/'); await openCodex(page); await pair(page)
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await page.getByRole('textbox', { name: '对话要求', exact: true }).fill('写一句介绍')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.ai-chat-reply')).toContainText('写下灵感。')
  expect(requests).toHaveLength(1)
  expect(requests[0].headers['x-codex-token']).toBe(code)
  expect(requests[0].headers['x-ai-key']).toBeUndefined()
  expect(JSON.parse(requests[0].body.prompt as string).instruction).toBe('写一句介绍')
  expect(JSON.stringify(requests[0].body)).not.toContain(code)
})

test('explains missing connector and subscription login errors', async ({ page }) => {
  let calls = 0
  await page.route('**/api/codex/status', route => ++calls === 1 ? route.abort('connectionrefused')
    : route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'codex_login' } }) }))
  await page.goto('/'); await openCodex(page)
  await page.getByLabel('本机连接码').fill(code)
  await page.getByRole('button', { name: '连接本机 Codex', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('npm run codex:bridge')
  await page.getByRole('button', { name: '连接本机 Codex', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('codex login')
  await expect(page.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled()
})

test('uses Codex for three variants, keeps context local until requested, applies and undoes', async ({ page }) => {
  const original = '这句话非常非常好。'
  const options = ['这句话很好。', '这句话写得真好。', '这句话说得好。']
  const requests: Record<string, unknown>[] = []
  await mockStatus(page)
  await page.route('**/api/codex/generate', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'delta', text: JSON.stringify({ options }) }) + frame({ type: 'done' }) })
  })
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'codex-test.md', mimeType: 'text/markdown', buffer: Buffer.from(`# 测试稿\n\n${original}\n\n保留后文。`) })
  await expect(page.locator('.wechat-content')).toContainText(original)
  await openCodex(page); await pair(page)
  await page.getByRole('button', { name: '关闭 AI 工具' }).click()
  await page.locator('.cm-line').filter({ hasText: original }).click()
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
  await page.getByRole('toolbar', { name: '选中文字快捷排版' }).getByRole('button', { name: 'AI 优化选中文字' }).click()
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: '生成 3 个润色方案' }).click()
  await expect(page.locator('.ai-option-card')).toHaveCount(3)
  expect(requests[0].provider).toBe('codex')
  expect(JSON.parse(requests[0].prompt as string).original).toBe(original)
  await page.getByRole('button', { name: '应用「精简表达」' }).click()
  await expect(page.getByRole('dialog', { name: 'AI 选段润色' })).toBeVisible()
  await page.getByRole('button', { name: '返回编辑器', exact: true }).click()
  await expect(page.locator('.wechat-content')).toContainText(options[0])
  await expect(page.locator('.wechat-content')).toContainText('保留后文')
  await page.locator('.source-toolbar').getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.wechat-content')).toContainText(original)
})

test('real subscription smoke: writing and three variants', async ({ page }, info) => {
  test.skip(!process.env.EZWRITING_CODEX_SMOKE_TOKEN, 'Explicit local subscription smoke only')
  test.setTimeout(180_000)
  const original = '我们希望帮助创作者更加轻松地整理自己的灵感。'
  await page.goto('/')
  await page.locator('input[accept*=".md"]').setInputFiles({ name: 'codex-smoke.md', mimeType: 'text/markdown', buffer: Buffer.from(`# 连接验收\n\n${original}`) })
  await expect(page.locator('.wechat-content')).toContainText(original)
  await openCodex(page); await pair(page, process.env.EZWRITING_CODEX_SMOKE_TOKEN)
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await page.getByRole('textbox', { name: '对话要求', exact: true }).fill('用一句简短中文介绍一个写作工具，不超过二十字。')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.ai-chat-reply')).toBeVisible({ timeout: 125_000 })
  await expect(page.locator('.wechat-content')).toContainText(original)
  await page.screenshot({ path: info.outputPath('codex-real-writing.png') })
  await page.getByRole('button', { name: '关闭 AI 工具' }).click()
  await page.locator('.cm-line').filter({ hasText: original }).click()
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
  await page.getByRole('toolbar', { name: '选中文字快捷排版' }).getByRole('button', { name: 'AI 优化选中文字' }).click()
  await page.getByRole('button', { name: '生成 3 个润色方案' }).click()
  await expect(page.locator('.ai-option-card')).toHaveCount(3, { timeout: 125_000 })
  await page.screenshot({ path: info.outputPath('codex-real-polish.png') })
  await page.getByRole('button', { name: '应用「精简表达」' }).click()
  await expect(page.getByRole('dialog', { name: 'AI 选段润色' })).toBeVisible()
  await page.getByRole('button', { name: '返回编辑器', exact: true }).click()
  await expect(page.locator('.wechat-content')).not.toContainText(original)
  await page.locator('.source-toolbar').getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.wechat-content')).toContainText(original)
})
