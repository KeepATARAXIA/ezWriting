import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArticleDraft, PlatformAccount } from '../domain/article'
import { getPlatformAccounts, publishDraft, waitForBridge } from './wechatsync-bridge'

const article: ArticleDraft = {
  id: 'draft-1',
  title: '桥接测试',
  html: '<p>正文</p>',
  markdown: '正文',
  tags: [],
  sourceFile: 'article.md',
  sourceKind: 'markdown',
  importedAt: '2026-08-12T00:00:00.000Z',
  warnings: [],
}

afterEach(() => {
  delete window.$syncer
  delete window.$poster
})

describe('Wechatsync bridge', () => {
  it('maps extension accounts into stable product accounts', async () => {
    window.$syncer = {
      getAccounts(callback) {
        callback([{ type: 'zhihu', displayName: '知乎', title: '测试账号' }])
      },
      addTask() {},
    }

    const accounts = await getPlatformAccounts()

    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ id: 'zhihu', name: '知乎', username: '测试账号' })
  })

  it('resolves when every selected platform reaches a terminal state', async () => {
    const raw = { type: 'zhihu', displayName: '知乎', title: '测试账号' }
    const account: PlatformAccount = { id: 'zhihu', name: '知乎', raw }
    const onProgress = vi.fn()

    window.$syncer = {
      getAccounts() {},
      addTask(_task, statusHandler) {
        statusHandler({ accounts: [{ ...raw, status: 'uploading', msg: '上传图片' }] })
        statusHandler({ accounts: [{ ...raw, status: 'done', editResp: { draftLink: 'https://example.com/draft/1' } }] })
      },
    }

    const results = await publishDraft(article, [account], onProgress)

    expect(results).toEqual([expect.objectContaining({
      platform: 'zhihu',
      status: 'done',
      draftUrl: 'https://example.com/draft/1',
    })])
    expect(onProgress).toHaveBeenCalledTimes(3)
  })

  it('falls back to the extension window message protocol', async () => {
    const raw = { type: 'juejin', displayName: '掘金', title: '消息桥账号' }
    const extensionSimulator = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      const message = JSON.parse(event.data)

      if (message.method === 'getAccounts') {
        window.postMessage(JSON.stringify({
          callReturn: true,
          eventID: message.eventID,
          result: [raw],
        }), '*')
      }

      if (message.method === 'addTask') {
        window.postMessage(JSON.stringify({
          method: 'taskUpdate',
          task: {
            accounts: [{
              ...raw,
              status: 'done',
              editResp: { draftLink: 'https://example.com/draft/message-bridge' },
            }],
          },
        }), '*')
      }
    }
    window.addEventListener('message', extensionSimulator)

    try {
      expect(await waitForBridge(500)).toBe(true)
      const accounts = await getPlatformAccounts()
      const results = await publishDraft(article, accounts, vi.fn())

      expect(accounts[0]).toMatchObject({ id: 'juejin', name: '掘金' })
      expect(results[0]).toMatchObject({
        platform: 'juejin',
        status: 'done',
        draftUrl: 'https://example.com/draft/message-bridge',
      })
    } finally {
      window.removeEventListener('message', extensionSimulator)
    }
  })

  it('classifies known WeChat failures and unverified downloads', async () => {
    const accounts: PlatformAccount[] = [
      { id: 'weixin', name: '微信公众号', raw: { type: 'weixin', title: '微信公众号' } },
      { id: 'zip-download', name: 'Markdown 压缩包', raw: { type: 'zip-download', title: '本地下载' } },
    ]

    window.$syncer = {
      getAccounts() {},
      addTask(_task, statusHandler) {
        statusHandler({ accounts: [
          { type: 'weixin', title: '微信公众号', status: 'failed', error: '同步失败 (错误码: 200040)' },
          { type: 'zip-download', title: 'Markdown 压缩包', status: 'done' },
        ] })
      },
    }

    const results = await publishDraft(article, accounts, vi.fn())

    expect(results[0]).toMatchObject({
      platform: 'weixin',
      delivery: 'draft',
      status: 'failed',
      error: expect.stringContaining('已知兼容问题'),
      helpUrl: 'https://github.com/wechatsync/Wechatsync/issues/217',
    })
    expect(results[1]).toMatchObject({
      platform: 'zip-download',
      delivery: 'download',
      status: 'done',
      requiresManualVerification: true,
      message: expect.stringContaining('确认文件是否落盘'),
    })
  })

  it('drops unsafe draft links returned by the extension', async () => {
    const raw = { type: 'zhihu', displayName: '知乎', title: '测试账号' }
    const account: PlatformAccount = { id: 'zhihu', name: '知乎', raw }

    window.$syncer = {
      getAccounts() {},
      addTask(_task, statusHandler) {
        statusHandler({ accounts: [{
          ...raw,
          status: 'done',
          editResp: { draftLink: 'javascript:alert(1)' },
        }] })
      },
    }

    const results = await publishDraft(article, [account], vi.fn())

    expect(results[0].draftUrl).toBeUndefined()
  })
})
