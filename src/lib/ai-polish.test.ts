import { describe, expect, it } from 'vitest'
import { completedPolishOptions, nearbyPolishContext, parsePolishOptions, polishPrompt, readPolishInput, textDifferences, type AiSelection } from './ai-polish'

const selection: AiSelection = { id: 'test', original: '原文', contextBefore: '上文', contextAfter: '下文', language: 'markdown', apply: () => undefined }
describe('AI polishing', () => {
  it('round-trips selected custom instructions and strengths, omitting local state', () => {
    const plans = [{ name: '我的去 AI 味', instruction: '保留短句与作者语气。', strength: 20, enabled: true, apiKey: 'never-send' }]
    const prompt = polishPrompt(selection, plans)
    expect(readPolishInput(prompt).plans).toEqual([{ name: '我的去 AI 味', instruction: '保留短句与作者语气。', strength: 20 }])
    expect(prompt).not.toMatch(/enabled|never-send/)
    expect(parsePolishOptions('{"options":["自然表达"]}', selection.original, 1)).toEqual(['自然表达'])
    expect(() => parsePolishOptions('{"options":["自然表达"]}', selection.original, 2)).toThrow('2 个方案')
  })
  it('rejects invalid plans and oversized combined requests before sending', () => {
    const plan = { name: '名称', instruction: '提示词', strength: 10 }
    for (const plans of [[], Array(7).fill(plan), [{ ...plan, strength: -1 }], [{ ...plan, strength: 101 }], [{ ...plan, strength: 1.5 }], [{ ...plan, name: '' }], [{ ...plan, instruction: '字'.repeat(601) }]]) {
      expect(() => readPolishInput(JSON.stringify({ ...selection, plans }))).toThrow()
    }
    expect(() => polishPrompt({ ...selection, original: '\\'.repeat(2000) }, Array(6).fill({ ...plan, instruction: '\\'.repeat(600) }))).toThrow('总长度')
  })
  it('counts only complete JSON strings across streamed escapes and Unicode', () => {
    const text = JSON.stringify({ options: ['甲"乙\\丙\n😀', '],"options": [', '丙'] })
    for (let i = 0; i < text.length; i++) expect(completedPolishOptions(text.slice(0, i))).toBeLessThanOrEqual(3)
    expect(completedPolishOptions('{"options":["甲", "未完')).toBe(1)
    expect(completedPolishOptions('{"options":["甲\\"')).toBe(0)
    expect(completedPolishOptions('{"options":["\\u4e')).toBe(0)
    expect(completedPolishOptions('{"options":["\\u4e00"')).toBe(1)
    expect(completedPolishOptions(text)).toBe(3)
    expect(completedPolishOptions('```json\n' + text)).toBe(3)
    expect(completedPolishOptions('{"extra":"options", "options":["甲"]}')).toBe(0)
  })
  it('takes only two nearby paragraphs per side, including partial selected lines', () => {
    const document = '不该发送的远处上文\n\n上一段\n\n同段前文【选句】同段后文\n\n下一段\n\n不该发送的远处下文'
    const from = document.indexOf('【'), to = document.indexOf('】') + 1
    expect(nearbyPolishContext(document, from, to)).toEqual({ contextBefore: '上一段\n同段前文', contextAfter: '同段后文\n下一段' })
    const long = '前'.repeat(5_000) + '【选句】' + '后'.repeat(5_000)
    const context = nearbyPolishContext(long, 5_000, 5_004)
    expect(context.contextBefore.length).toBe(600); expect(context.contextAfter.length).toBe(600)
  })
  it('limits each output to the selected passage, rejecting whole-document expansion', () => {
    expect(() => parsePolishOptions(JSON.stringify({ options: ['新'.repeat(41), '乙', '丙'] }), '一句话')).toThrow('长度限制')
    expect(() => readPolishInput(JSON.stringify({ ...selection, contextBefore: '文'.repeat(601) }))).toThrow()
  })
  it('includes bounded context but keeps editor bookkeeping out of requests', () => {
    const prompt = polishPrompt({ ...selection, original: '\\'.repeat(2_000), contextBefore: '\\'.repeat(10_000), contextAfter: '\\'.repeat(10_000) })
    expect(prompt.length).toBeLessThanOrEqual(8_000)
    expect(JSON.parse(prompt).original).toHaveLength(2_000)
    expect(JSON.parse(prompt).contextBefore.length).toBeLessThanOrEqual(600)
    expect(prompt).not.toContain('apply'); expect(prompt).not.toContain('"id"')
    expect(() => polishPrompt({ ...selection, original: '文'.repeat(2_001) })).toThrow('2,000')
  })
  it('accepts exactly three complete options and rejects unsafe changes to markup and links', () => {
    expect(parsePolishOptions('```json\n{"options":["甲","乙","丙"]}\n```', '原')).toEqual(['甲', '乙', '丙'])
    for (const options of [[], ['甲', '乙'], ['甲', '', '丙'], ['甲', 2, '丙'], ['<script>alert(1)</script>', '乙', '丙'], ['[甲](https://new.example)', '乙', '丙']]) {
      expect(() => parsePolishOptions(JSON.stringify({ options }), '原')).toThrow()
    }
    const original = '<strong>原</strong> https://example.com'
    expect(parsePolishOptions(JSON.stringify({ options: ['甲', '乙', '丙'].map(text => original.replace('原', text)) }), original)).toHaveLength(3)
    expect(() => parsePolishOptions('{"options":["partial', '原')).toThrow('完整')
  })
  it.each([
    ['这句话非常非常好。', '这句话很好。'], ['你好😀！\n第二段', '你好🌱！\n新的第二段'], ['', '新增'], ['删掉', ''], ['相同', '相同'],
    ['甲'.repeat(2_000), '乙'.repeat(4_000)],
  ])('reconstructs both originals and replacements without losing Unicode or whitespace', (original, replacement) => {
    const parts = textDifferences(original, replacement)
    expect(parts.filter(part => part.kind !== 'added').map(part => part.text).join('')).toBe(original)
    expect(parts.filter(part => part.kind !== 'removed').map(part => part.text).join('')).toBe(replacement)
  })
})
