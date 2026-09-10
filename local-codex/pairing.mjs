import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Kept outside the repository and independent of ChatGPT login credentials.
export function readPairingToken(directory = join(homedir(), '.ezwriting')) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'codex-pairing')
  try {
    writeFileSync(path, randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const token = readFileSync(path, 'utf8').trim()
  if (!/^[a-f0-9]{48}$/.test(token)) throw new Error('本机配对文件无效，请检查 ~/.ezwriting/codex-pairing。')
  return token
}
