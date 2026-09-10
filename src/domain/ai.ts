export const AI_PROVIDERS = {
  gemini: { name: 'Gemini', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/api-keys' },
  deepseek: { name: 'DeepSeek', model: 'deepseek-v4-flash', keyUrl: 'https://platform.deepseek.com/api_keys' },
  glm: { name: '智谱 GLM', model: 'glm-5.3', keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys' },
  codex: { name: 'Codex', model: '', keyUrl: '' },
} as const

export type AiProvider = keyof typeof AI_PROVIDERS
export type AiAction = 'test' | 'generate' | 'polish' | 'chat'
export interface AiProfile { model: string; apiKey: string }
export interface AiSession { provider: AiProvider; profiles: Record<AiProvider, AiProfile> }
export const AI_PROMPT_LIMIT = 8_000
export const AI_TIMEOUT_MS = 120_000

// Default configuration; browser persistence is handled separately from drafts and backups.
export function createAiSession(): AiSession {
  return {
    provider: 'gemini',
    profiles: {
      gemini: { model: AI_PROVIDERS.gemini.model, apiKey: '' },
      deepseek: { model: AI_PROVIDERS.deepseek.model, apiKey: '' },
      glm: { model: AI_PROVIDERS.glm.model, apiKey: '' },
      codex: { model: '', apiKey: '' },
    },
  }
}

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && Object.hasOwn(AI_PROVIDERS, value)
}

export const AI_ERRORS = {
  image_timeout: '图片生成等待超过 10 分钟，本次请求已停止。请检查 Codex 服务或网络后重试。',
  image_connection_timeout: '本机 Codex 初始化或启动生图请求超时，请检查连接程序与网络后重试。',
  image_unavailable: '当前 Codex 连接不支持内置生图，请检查本机 Codex 版本与账号权限。',
  image_empty: 'Codex 未返回完整图片，请重新生成；文字回复不会作为图片使用。',
  codex_missing: '未找到 Codex CLI，请检查本机安装或 EZWRITING_CODEX_BIN 路径。',
  codex_unavailable: '无法连接本机 Codex。Windows 请在项目目录运行 npm.cmd run codex:bridge（macOS / Linux 使用 npm run codex:bridge），保持终端运行后重试，并允许浏览器访问本地网络。',
  codex_pairing: '连接码无效或已过期，请粘贴当前连接程序窗口中的连接码。',
  codex_login: '请先在本机运行 codex login，通过 ChatGPT 登录。此连接只使用订阅，不使用 API Key 计费。',
  codex_busy: '本机 Codex 正在处理另一条请求，请完成或停止后重试。',
  invalid_request: '请检查提供商、模型名称和输入内容。',
  invalid_key: 'API Key 无效或已过期，请检查后重试。',
  forbidden: '当前 Key 没有访问权限，请检查模型授权及所在地区。',
  model_unavailable: '模型不存在或当前账号不可用，请核对模型名称。',
  quota: '额度不足或请求过于频繁，请到提供商控制台检查后重试。',
  upstream: '模型服务暂时不可用，请稍后重试。',
  timeout: '请求超时，请稍后重试或缩短输入。',
  interrupted: '连接中断，已收到的内容可能不完整，请重试。',
  empty: '模型没有返回文字，请检查模型是否支持文本生成。',
  truncated: '输出达到长度上限，当前内容不完整，请缩短输入后重试。',
  filtered: '模型未能完成本次内容请求，请调整输入后重试。',
  protocol: '模型返回了无法识别的数据，请检查模型是否支持流式对话。',
  too_large: '内容超过本次生成的大小限制，请缩短后重试。',
  origin: '请求来源不匹配，请从当前网站重新打开 AI 工具。',
  unavailable: 'AI 接口暂不可用。本地开发需启动 Worker，线上需部署包含 AI 接口的版本。',
  network: '无法连接 AI 服务，请检查网络后重试。',
} as const
export type AiErrorCode = keyof typeof AI_ERRORS
export class AiError extends Error {
  constructor(public readonly code: AiErrorCode) { super(AI_ERRORS[code]); this.name = 'AiError' }
}
export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && Object.hasOwn(AI_ERRORS, value)
}

export type AiStreamEvent = { type: 'delta'; text: string } | { type: 'done' } | { type: 'error'; code: AiErrorCode }
