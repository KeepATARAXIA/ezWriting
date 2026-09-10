import { AiError, isAiErrorCode } from '../domain/ai'
import { CODEX_URL, getCodexToken } from './codex-client'
import { IMAGE_STYLES, IMAGE_TIMEOUT_MS, validImageSize, type ImageStyle } from '../domain/artwork'

const STYLE_KEY = 'dispatch.image-styles.v1'
export function readImageStyles(): ImageStyle[] {
  try {
    const data = JSON.parse(localStorage.getItem(STYLE_KEY) ?? 'null')
    if (Array.isArray(data) && data.length > 0 && data.length <= 20 && data.every(item => typeof item.id === 'string' && item.id.length <= 60 && typeof item.name === 'string' && item.name.trim() && item.name.length <= 40 && typeof item.prompt === 'string' && item.prompt.trim() && item.prompt.length <= 2000)) return data
  } catch { /* Use bundled styles if local data is unavailable. */ }
  return IMAGE_STYLES.map(item => ({ ...item }))
}
export function saveImageStyles(styles: ImageStyle[]) {
  if (!styles.length || styles.length > 20 || styles.some(item => !item.name.trim() || item.name.length > 40 || !item.prompt.trim() || item.prompt.length > 2000)) throw new Error('请填写风格名称与描述，最多保存 20 个风格。')
  localStorage.setItem(STYLE_KEY, JSON.stringify(styles))
}
export async function generateArtwork(prompt: string, model: string, signal: AbortSignal): Promise<string> {
  const token = getCodexToken()
  if (!token) throw new AiError('codex_pairing')
  const combined = AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS + 10_000)])
  try {
    const response = await fetch(`${CODEX_URL}/images`, { method: 'POST', signal: combined, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Codex-Token': token }, body: JSON.stringify({ prompt, model }) })
    const text = await response.text()
    if (text.length > 28_000_000) throw new AiError('too_large')
    const data = JSON.parse(text)
    if (!response.ok) throw new AiError(isAiErrorCode(data?.error?.code) ? data.error.code : 'upstream')
    if (typeof data.dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.dataUrl)) throw new AiError('protocol')
    return data.dataUrl
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (combined.aborted) throw new AiError('image_timeout')
    if (error instanceof AiError && error.code === 'timeout') throw new Error('图片请求超时。当前连接程序可能仍使用旧版等待限制，请重启本机连接程序后重试。')
    throw error instanceof AiError ? error : new AiError('codex_unavailable')
  }
}
export async function cropArtwork(source: string, width: number, height: number, x: number, y: number): Promise<string> {
  if (!validImageSize(width, height)) throw new Error('尺寸需为 256–4096 像素，且总像素不超过 8 百万。')
  if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) throw new Error('裁切位置无效。')
  const image = new Image(); image.src = source
  await image.decode()
  if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('原图过大，请选择较小尺寸。')
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法处理图片。')
  context.drawImage(image, -(image.naturalWidth * scale - width) * x / 100, -(image.naturalHeight * scale - height) * y / 100, image.naturalWidth * scale, image.naturalHeight * scale)
  const result = canvas.toDataURL('image/png')
  if (result.length > 28_000_000) throw new Error('图片文件过大，请减小输出尺寸。')
  return result
}
