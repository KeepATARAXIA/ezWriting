import { describe, expect, it } from 'vitest'
import { safeDownloadName } from './xhs-export'

describe('safeDownloadName', () => {
  it('creates a filesystem-safe card filename without losing the article identity', () => {
    expect(safeDownloadName('  我的文章：第一版 / 卡片？  ')).toBe('我的文章-第一版-卡片')
    expect(safeDownloadName('   ')).toBe('小红书卡片')
  })
})
