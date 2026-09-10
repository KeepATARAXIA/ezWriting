import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { AiError } from '../src/domain/ai.ts'

// Resolve the native CLI, so cancellation also terminates the actual app-server.
export function findCodex() {
  if (process.env.EZWRITING_CODEX_BIN) {
    if (!existsSync(process.env.EZWRITING_CODEX_BIN)) throw new AiError('codex_missing')
    return process.env.EZWRITING_CODEX_BIN
  }
  const targets = { win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
    linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
    darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' } }
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const target = targets[process.platform]?.[process.arch]
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const direct = join(directory, executable)
    if (existsSync(direct) && (process.platform === 'win32' || !realpathSync(direct).endsWith('.js'))) return direct
    const roots = [join(directory, 'node_modules', '@openai', 'codex')]
    if (existsSync(direct)) roots.push(dirname(dirname(realpathSync(direct))))
    for (const root of roots) {
      if (!existsSync(join(root, 'package.json')) || !target) continue
      let vendor = join(root, 'vendor')
      try {
        const require = createRequire(join(root, 'package.json'))
        vendor = join(dirname(require.resolve(`@openai/codex-${process.platform === 'darwin' ? 'darwin' : process.platform}-${process.arch}/package.json`)), 'vendor')
      } catch { /* Older CLI packages keep the native binary under vendor. */ }
      for (const folder of ['bin', 'codex']) {
        const binary = join(vendor, target, folder, executable)
        if (existsSync(binary)) return binary
      }
    }
  }
  throw new AiError('codex_missing')
}

export function codexError(error) {
  const info = error?.codexErrorInfo
  const code = typeof info === 'string' ? info : Object.keys(info ?? {})[0]
  if (code === 'usageLimitExceeded' || /quota|usage limit|rate limit|429/i.test(error?.message ?? '')) return new AiError('quota')
  if (/unauthoriz|authentication|401/i.test(error?.message ?? '')) return new AiError('codex_login')
  if (/model.*(not|unavailable|unsupported)/i.test(error?.message ?? '')) return new AiError('model_unavailable')
  return new AiError('upstream')
}

export class CodexRpc extends EventEmitter {
  pending = new Map()
  counter = 0
  closed = false
  constructor(binary, cwd, { images = false } = {}) {
    super()
    this.images = images
    this.child = spawn(binary, ['app-server', '--stdio',
      '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
      '-c', 'features.shell_tool=false', '-c', 'features.multi_agent=false',
      '-c', 'features.memories=false', '-c', 'features.apps=false',
      '-c', 'features.plugins=false', '-c', 'features.hooks=false',
      '-c', 'features.browser_use=false', '-c', 'features.computer_use=false',
      '-c', `features.image_generation=${images}`, '-c', 'features.code_mode_host=false',
      '-c', 'features.shell_snapshot=false', '-c', 'features.goals=false',
      '-c', 'mcp_servers={}', '-c', 'analytics.enabled=false'],
    { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    // Never log protocol payloads or stderr: both can contain article text or auth details.
    this.child.stderr.resume()
    this.child.stdin.on('error', () => this.fail(new AiError('codex_unavailable')))
    this.child.on('error', () => this.fail(new AiError('codex_missing')))
    this.child.on('exit', () => this.fail(new AiError('codex_unavailable')))
    this.child.stdout.setEncoding('utf8')
    let buffer = ''
    this.child.stdout.on('data', chunk => {
      buffer += chunk
      if (buffer.length > (images ? 30 : 2) * 1024 * 1024) { this.fail(new AiError('too_large')); return }
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (!line.trim()) continue
        let message
        try { message = JSON.parse(line) } catch { this.fail(new AiError('protocol')); return }
        if (message.method && message.id != null) {
          // This writing connector never approves tools or exposes interactive requests.
          this.send({ id: message.id, error: { code: -32601, message: 'Tools are disabled in this connector.' } })
        } else if (message.id != null) {
          const pending = this.pending.get(message.id)
          if (!pending) continue
          this.pending.delete(message.id); clearTimeout(pending.timer)
          if (message.error) pending.reject(codexError(message.error))
          else pending.resolve(message.result)
        } else if (message.method) this.emit('notification', message)
      }
    })
  }
  send(message) {
    if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n')
  }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new AiError('codex_unavailable'))
    const id = ++this.counter
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AiError(this.images ? 'image_connection_timeout' : 'timeout')) }, this.images ? 60_000 : 25_000)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ id, method, params })
    })
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'ezwriting', title: 'EZWRITING', version: '0.2.0' }, capabilities: { experimentalApi: true } })
    this.send({ method: 'initialized', params: {} })
    const { config } = await this.request('config/read', { includeLayers: false })
    // Explicit per-server overrides avoid inheriting MCP tables through config merging.
    this.safeConfig = Object.fromEntries(Object.keys(config.mcp_servers ?? {}).map(name => [`mcp_servers.${name}.enabled`, false]))
  }
  fail(error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    this.emit('closed', error)
    this.child.kill()
  }
  close() { this.fail(new AiError('interrupted')) }
}
