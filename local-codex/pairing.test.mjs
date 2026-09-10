// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readPairingToken } from './pairing.mjs'

const directories = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ezwriting-pairing-test-'))
  directories.push(directory)
  return directory
}
it('keeps the same pairing code on connector restart', () => {
  const directory = fixture()
  const token = readPairingToken(directory)
  expect(token).toMatch(/^[a-f0-9]{48}$/)
  expect(readPairingToken(directory)).toBe(token)
  expect(readPairingToken(fixture())).not.toBe(token)
})
it('reports corrupt pairing without overwriting it', () => {
  const directory = fixture()
  writeFileSync(join(directory, 'codex-pairing'), 'invalid')
  expect(() => readPairingToken(directory)).toThrow('本机配对文件无效')
  expect(readFileSync(join(directory, 'codex-pairing'), 'utf8')).toBe('invalid')
})
