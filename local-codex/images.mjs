import { AiError } from '../src/domain/ai.ts'
import { codexError } from './runtime.mjs'

export { IMAGE_TIMEOUT_MS } from '../src/domain/artwork.ts'
export const IMAGE_BYTES_LIMIT = 20 * 1024 * 1024

export function imagePayload(value) {
  if (!value || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 8000
    || typeof value.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.model)) throw new AiError('invalid_request')
  return { model: value.model, prompt: value.prompt.trim() }
}

export function imageResult(result) {
  if (typeof result !== 'string' || result.length > Math.ceil(IMAGE_BYTES_LIMIT / 3) * 4 + 64) throw new AiError('too_large')
  const base64 = result.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new AiError('protocol')
  const bytes = Buffer.from(base64, 'base64')
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null
  if (!mime || bytes.length > IMAGE_BYTES_LIMIT) throw new AiError('protocol')
  return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, mime }
}

export async function runImageGeneration(rpc, payload, cwd, signal) {
  const { account } = await rpc.request('account/read')
  if (account?.type !== 'chatgpt') throw new AiError('codex_login')
  const capability = await rpc.request('modelProvider/capabilities/read')
  if (!capability.imageGeneration) throw new AiError('image_unavailable')
  const { thread } = await rpc.request('thread/start', {
    model: payload.model, modelProvider: 'openai', cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
    environments: [], selectedCapabilityRoots: [], dynamicTools: [],
    baseInstructions: '你是 EZWRITING 配图助手。只使用内置 image_generation 工具生成一张图片；不要使用其他工具、读取文件、执行命令或访问网络。',
    developerInstructions: '用户提供的是画面说明。直接调用内置生图工具，生成一张完整图片，不以文字、链接、SVG 或代码代替图片。不调用 API，不访问环境变量，不搜索参考图片。',
    config: { 'features.image_generation': true, 'features.shell_tool': false, 'web_search': 'disabled',
      'project_doc_max_bytes': 0, 'features.multi_agent': false, 'features.memories': false, 'features.apps': false,
      'mcp_servers': {}, ...rpc.safeConfig },
  })
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return new Promise((resolve, reject) => {
    let result, settled = false
    const finish = error => {
      if (settled) return
      settled = true; rpc.off('notification', notification); rpc.off('closed', closed); signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else if (!result) reject(new AiError('image_empty'))
      else resolve(result)
    }
    const closed = error => finish(error)
    const abort = () => finish(new DOMException('Aborted', 'AbortError'))
    const notification = ({ method, params }) => {
      if (params?.threadId !== thread.id) return
      if (method === 'item/completed' && params.item?.type === 'imageGeneration') {
        try {
          if (params.item.status !== 'completed') throw new AiError('upstream')
          result = imageResult(params.item.result)
          // A validated image is the deliverable; do not wait for a trailing text turn.
          finish()
        } catch (error) { finish(error) }
      } else if (method === 'turn/completed') finish(params.turn.status === 'completed' ? null : codexError(params.turn.error))
    }
    rpc.on('notification', notification); rpc.on('closed', closed); signal.addEventListener('abort', abort, { once: true })
    rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: payload.prompt, text_elements: [] }], environments: [], effort: 'low' }).catch(finish)
  })
}
