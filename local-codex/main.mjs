import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexRpc, findCodex } from './runtime.mjs'
import { CODEX_PORT, createBridge } from './server.mjs'

try {
  const binary = findCodex()
  const cwd = mkdtempSync(join(tmpdir(), 'ezwriting-codex-'))
  const token = randomBytes(24).toString('hex')
  const server = createBridge({ token, cwd, createRpc: () => new CodexRpc(binary, cwd) })
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '连接程序已在运行。请使用已有窗口中的连接码。' : '本机连接程序启动失败。')
    process.exitCode = 1
  })
  server.listen(CODEX_PORT, '127.0.0.1', () => {
    console.log(`EZWRITING Codex 本地连接已启动（仅本机 ${CODEX_PORT}）\n连接码：${token}\n在 AI 工具 → Codex 中粘贴连接码。保持此窗口运行；Ctrl+C 关闭。`)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.closeAllConnections(); server.close()
  })
} catch (error) { console.error(error.message); process.exitCode = 1 }
