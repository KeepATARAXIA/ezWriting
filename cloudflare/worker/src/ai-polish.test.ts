// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { handleAi } from './ai'
import { DEFAULT_POLISH_PRESETS, POLISH_INSTRUCTION, readPolishPlans } from '../../../src/lib/ai-polish'

afterEach(() => vi.unstubAllGlobals())
it('preserves custom prompts and strengths in selected order', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"结果"},"finish_reason":"stop"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetch)
  const plans = [{ name: '自定义去 AI 味', instruction: '保留作者短句。', strength: 20 }]
  const prompt = JSON.stringify({ original: '选'.repeat(200), contextBefore: '', contextAfter: '', language: 'markdown', plans })
  const response = await handleAi(new Request('https://example.com/api/ai/generate', { method: 'POST',
    headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', 'X-AI-Key': 'test-key' },
    body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4-flash', action: 'polish', prompt }),
  }))
  expect(await response.text()).toContain('"type":"done"')
  const outgoing = JSON.parse(fetch.mock.calls[0][1].body)
  expect(JSON.parse(outgoing.messages[1].content).plans).toEqual(plans)
  expect(outgoing.max_tokens).toBe(856)
})
it('forwards polishing as data with a separate instruction and enough output for three variants', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"三方案"},"finish_reason":"stop"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetch)
  const prompt = JSON.stringify({ original: '选段', contextBefore: '上文', contextAfter: '下文', language: 'markdown' })
  const request = (text: string) => new Request('https://example.com/api/ai/generate', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', 'X-AI-Key': 'test-key' }, body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4-flash', action: 'polish', prompt: text }) })
  expect(await (await handleAi(request(prompt))).text()).toContain('"type":"done"')
  const outgoing = JSON.parse(fetch.mock.calls[0][1].body)
  expect(outgoing).toMatchObject({ max_tokens: 768, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } })
  expect(outgoing.messages[0]).toEqual({ role: 'system', content: POLISH_INSTRUCTION })
  expect(JSON.parse(outgoing.messages[1].content)).toEqual({ ...JSON.parse(prompt), maxOptionCharacters: 40, plans: readPolishPlans(DEFAULT_POLISH_PRESETS) })
  expect((await handleAi(request('字'.repeat(8_001)))).status).toBe(400)
  const oversized = await handleAi(request(JSON.stringify({ ...JSON.parse(prompt), contextAfter: '文'.repeat(601) })))
  expect(oversized.status).toBe(400)
  expect(fetch).toHaveBeenCalledOnce()
})
