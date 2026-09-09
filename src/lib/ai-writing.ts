import { AI_PROMPT_LIMIT } from '../domain/ai'
import { readPolishPlans, type PolishPlan } from './ai-polish'

export const WRITING_TONES = {
  更口语: '用自然的口语和短句，保留专业词汇，避免刻意随意。',
  更精简: '删去重复、套话和空泛修饰，让表达紧凑。',
  更有网感: '表达轻快、有节奏，适合网络阅读；不硬塞热梗，不编造经历。',
} as const
export type WritingTone = keyof typeof WRITING_TONES

export function writingPrompt(input: string, preset: PolishPlan | undefined, tones: WritingTone[]): string {
  if (!input.trim()) throw new Error('请先填写试写内容。')
  const plan = preset ? readPolishPlans([preset])[0] : undefined
  const prompt = !plan && !tones.length ? input : `请完成下面的试写要求，使用所选方案和附加风格。只输出写作结果，不附加工作说明。若输入包含待改写原文，保留事实、原意和链接。强度表示风格改写幅度：0 不做额外风格改写，10–20 只微调措辞，50 可调整句式，80–100 可重组表达；不代表精确修改字数占比。\n${JSON.stringify({ task: input, ...(plan ? { preset: plan } : {}), refinements: tones.map(tone => WRITING_TONES[tone]) })}`
  if (prompt.length > AI_PROMPT_LIMIT) throw new Error('试写内容与方案提示词总长度超过 8,000 字符，请缩短后重试。')
  return prompt
}
