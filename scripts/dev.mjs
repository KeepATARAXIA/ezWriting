import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const children = new Set()
let stopping = false

async function stop(code) {
  if (stopping) return
  stopping = true
  await Promise.all([...children].map(child => new Promise(resolve => {
    if (process.platform === 'win32') {
      // Wrangler also owns workerd processes; close only our own process trees.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', resolve)
      killer.on('exit', resolve)
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already exited. */ }
      resolve()
    }
  })))
  process.exit(code)
}

function run(entry, args, persistent = true) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  children.add(child)
  child.on('error', error => { console.error(error.message); void stop(1) })
  child.on('exit', code => {
    // Keep persistent roots until cleanup so surviving descendants are stopped.
    if (!persistent) children.delete(child)
    if (persistent && !stopping) {
      console.error('开发服务已退出，正在关闭配套服务。')
      void stop(code || 1)
    }
  })
  return child
}

process.on('SIGINT', () => void stop(0))
process.on('SIGTERM', () => void stop(0))

try {
  await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', () => reject(new Error('8787 端口已被占用。请先关闭已有 Worker，再运行 npm run dev。')))
    probe.listen(8787, '127.0.0.1', () => probe.close(resolve))
  })

  if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
    console.log('首次启动：生成 Worker 所需的静态资源。')
    const build = run('node_modules/vite/bin/vite.js', ['build'], false)
    const code = await new Promise(resolve => build.on('exit', resolve))
    if (code !== 0) throw new Error('静态资源构建失败，未启动开发服务。')
  }

  run('node_modules/wrangler/bin/wrangler.js', ['dev', '--config', 'cloudflare/worker/wrangler.jsonc', '--ip', '127.0.0.1', '--port', '8787'])
  const deadline = Date.now() + 60_000
  let ready = false
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(1000) })
      const health = await response.json()
      if (response.ok && health.status === 'ok' && health.storage === 'local-only') { ready = true; break }
    } catch { /* Worker is still starting. */ }
    await delay(250)
  }
  if (!ready) throw new Error('Worker 启动超时，请检查上方错误。')
  console.log('Worker 已就绪，启动前端。按 Ctrl+C 同时关闭两个服务。')
  run('node_modules/vite/bin/vite.js', ['--strictPort', ...process.argv.slice(2)])
} catch (error) {
  console.error(error.message)
  await stop(1)
}
