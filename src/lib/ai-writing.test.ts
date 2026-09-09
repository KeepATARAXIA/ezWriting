import { expect, it } from 'vitest'
import { writingPrompt, WRITING_TONES } from './ai-writing'

it('leaves free writing untouched and combines only explicitly selected writing controls', () => {
  expect(writingPrompt('原样请求', undefined, [])).toBe('原样请求')
  const preset = { name: '公众号口语化', instruction: '保留短句。', strength: 20, enabled: false, secret: 'never-send' }
  const prompt = writingPrompt('写一句介绍', preset, ['更口语'])
  const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
  expect(data).toEqual({ task: '写一句介绍', preset: { name: '公众号口语化', instruction: '保留短句。', strength: 20 }, refinements: [WRITING_TONES.更口语] })
  expect(prompt).not.toMatch(/never-send|enabled/)
})

it('bounds the combined request and rejects unfinished presets before calling the model', () => {
  expect(writingPrompt('字'.repeat(8000), undefined, [])).toHaveLength(8000)
  expect(() => writingPrompt('字'.repeat(8000), undefined, ['更精简'])).toThrow('总长度')
  expect(() => writingPrompt('  ', undefined, [])).toThrow('填写')
  expect(() => writingPrompt('写一句', { name: '', instruction: '', strength: 20 }, [])).toThrow()
})
