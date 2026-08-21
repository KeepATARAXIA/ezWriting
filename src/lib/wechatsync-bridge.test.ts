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

  it('uses the platform uid for same-platform accounts and filters malformed entries', async () => {
    window.$syncer = {
      getAccounts(callback) {
        callback([
          { type: 'zhihu', uid: 'writer-a', displayName: '知乎 A', title: '账号 A' },
          null,
          { type: '', uid: 'missing-type', displayName: '无效账号' },
          { type: 'zhihu', uid: 'writer-b', displayName: '知乎 B', title: '账号 B' },
        ])
      },
      addTask() {},
    }

    const accounts = await getPlatformAccounts()

    expect(accounts.map(account => account.id)).toEqual(['zhihu:writer-a', 'zhihu:writer-b'])
    expect(accounts.map(account => account.raw)).toEqual([
      expect.objectContaining({ type: 'zhihu', uid: 'writer-a' }),
      expect.objectContaining({ type: 'zhihu', uid: 'writer-b' }),
    ])
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

  it('merges partial updates and ignores malformed, stale, duplicate, and post-settlement updates', async () => {
    const rawA = { type: 'zhihu', uid: 'writer-a', displayName: '知乎 A', title: '账号 A' }
    const rawB = { type: 'zhihu', uid: 'writer-b', displayName: '知乎 B', title: '账号 B' }
    const accounts: PlatformAccount[] = [
      { id: 'zhihu:writer-a', name: '知乎 A', raw: rawA },
      { id: 'zhihu:writer-b', name: '知乎 B', raw: rawB },
    ]
    const onProgress = vi.fn()
    let statusHandler: ((task: { accounts?: Array<Record<string, unknown>> }) => void) | undefined

    window.$syncer = {
      getAccounts() {},
      addTask(_task, nextStatusHandler) {
        statusHandler = nextStatusHandler as typeof statusHandler
      },
    }

    let resolved = false
    const publishing = publishDraft(article, accounts, onProgress).then(results => {
      resolved = true
      return results
    })

    statusHandler?.({ accounts: [{ ...rawA, status: 'uploading', msg: '上传 A' }] })
    statusHandler?.({ accounts: [{ ...rawA, status: 'done' }] })
    await Promise.resolve()
    expect(resolved).toBe(false)

    statusHandler?.({ accounts: [{ ...rawA, status: 'uploading', msg: '迟到状态' }] })
    statusHandler?.({ accounts: [{ ...rawB, status: 'unexpected-status' }] })
    statusHandler?.({ accounts: [null as unknown as Record<string, unknown>] })
    expect(onProgress).toHaveBeenCalledTimes(3)

    statusHandler?.({ accounts: [{ ...rawB, status: 'failed', error: 'B 失败' }] })
    const results = await publishing

    expect(results).toEqual([
      expect.objectContaining({ platform: 'zhihu:writer-a', status: 'done' }),
      expect.objectContaining({ platform: 'zhihu:writer-b', status: 'failed', error: 'B 失败' }),
    ])
    expect(onProgress).toHaveBeenCalledTimes(4)

    statusHandler?.({ accounts: [{ ...rawB, status: 'done' }] })
    expect(onProgress).toHaveBeenCalledTimes(4)
  })

  it('leaves cover selection to the destination platform', async () => {
    const raw = { type: 'weixin', displayName: '微信公众号', title: '测试账号' }
    const account: PlatformAccount = { id: 'weixin', name: '微信公众号', raw }
    let submittedTask: unknown

    window.$syncer = {
      getAccounts() {},
      addTask(task, statusHandler) {
        submittedTask = task
        statusHandler({ accounts: [{ ...raw, status: 'done' }] })
      },
    }

    await publishDraft({ ...article, cover: 'data:image/png;base64,AQID' } as ArticleDraft, [account], vi.fn())

    expect(submittedTask).toEqual(expect.objectContaining({
      post: expect.not.objectContaining({ thumb: expect.anything() }),
    }))
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
          eventID: message.eventID,
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

  it('routes window-message task updates by task id and drops late callbacks', async () => {
    const rawA = { type: 'alpha', uid: 'account-a', displayName: '平台 A' }
    const rawB = { type: 'beta', uid: 'account-b', displayName: '平台 B' }
    const taskMessages: Array<{ eventID: number; task: unknown }> = []
    const extensionSimulator = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      const message = JSON.parse(event.data)

      if (message.method === 'getAccounts') {
        window.postMessage(JSON.stringify({
          callReturn: true,
          eventID: message.eventID,
          result: [rawA, rawB],
        }), '*')
      }

      if (message.method === 'addTask') {
        taskMessages.push({ eventID: message.eventID, task: message.task })
      }
    }
    window.addEventListener('message', extensionSimulator)

    try {
      expect(await waitForBridge(500)).toBe(true)
      const accounts = await getPlatformAccounts()
      const progressA = vi.fn()
      const progressB = vi.fn()
      const publishingA = publishDraft(article, [accounts[0]], progressA)
      const publishingB = publishDraft(article, [accounts[1]], progressB)

      await vi.waitFor(() => expect(taskMessages).toHaveLength(2))
      const [taskA, taskB] = taskMessages

      window.postMessage(JSON.stringify({
        method: 'taskUpdate',
        eventID: taskA.eventID,
        task: { accounts: [{ ...rawA, status: 'done' }] },
      }), '*')
      await expect(publishingA).resolves.toEqual([
        expect.objectContaining({ platform: 'alpha:account-a', status: 'done' }),
      ])
      expect(progressA).toHaveBeenCalledTimes(2)
      expect(progressB).toHaveBeenCalledTimes(1)

      window.postMessage(JSON.stringify({
        method: 'taskUpdate',
        eventID: taskA.eventID,
        task: { accounts: [{ ...rawA, status: 'uploading' }] },
      }), '*')
      await new Promise(resolve => window.setTimeout(resolve, 0))
      expect(progressA).toHaveBeenCalledTimes(2)
      expect(progressB).toHaveBeenCalledTimes(1)

      window.postMessage(JSON.stringify({
        method: 'taskUpdate',
        eventID: taskB.eventID,
        task: { accounts: [{ ...rawB, status: 'done' }] },
      }), '*')
      await expect(publishingB).resolves.toEqual([
        expect.objectContaining({ platform: 'beta:account-b', status: 'done' }),
      ])
      expect(progressB).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener('message', extensionSimulator)
    }
  })

  it('fails active tasks when a legacy task update has no task id', async () => {
    const rawA = { type: 'juejin', uid: 'same-account', displayName: '掘金账号' }
    const rawB = { type: 'zhihu', uid: 'other-account', displayName: '知乎账号' }
    const taskMessages: Array<{ eventID: number; task: unknown }> = []
    const extensionSimulator = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      const message = JSON.parse(event.data)

      if (message.method === 'getAccounts') {
        window.postMessage(JSON.stringify({
          callReturn: true,
          eventID: message.eventID,
          result: [rawA, rawB],
        }), '*')
      }

      if (message.method === 'addTask') {
        taskMessages.push({ eventID: message.eventID, task: message.task })
      }
    }
    window.addEventListener('message', extensionSimulator)

    try {
      expect(await waitForBridge(500)).toBe(true)
      const accounts = await getPlatformAccounts()

      const firstPublish = publishDraft(article, [accounts[0]], vi.fn())
      await vi.waitFor(() => expect(taskMessages).toHaveLength(1))
      window.postMessage(JSON.stringify({
        method: 'taskUpdate',
        eventID: taskMessages[0].eventID,
        task: { accounts: [{ ...rawA, status: 'done' }] },
      }), '*')
      await expect(firstPublish).resolves.toEqual([
        expect.objectContaining({ platform: 'juejin:same-account', status: 'done' }),
      ])

      const secondProgress = vi.fn()
      const secondPublish = publishDraft(article, [accounts[0]], secondProgress)
      await vi.waitFor(() => expect(taskMessages).toHaveLength(2))
      window.postMessage(JSON.stringify({
        method: 'taskUpdate',
        task: { accounts: [{ ...rawA, status: 'done' }] },
      }), '*')
      await expect(secondPublish).resolves.toEqual([
        expect.objectContaining({
          platform: 'juejin:same-account',
          status: 'failed',
          error: expect.stringContaining('eventID'),
        }),
      ])
      expect(secondProgress).toHaveBeenCalledTimes(2)

      window.postMessage(JSON.stringify({
        method: 'taskUpdate',
        eventID: taskMessages[1].eventID,
        task: { accounts: [{ ...rawA, status: 'done' }] },
      }), '*')
      await new Promise(resolve => window.setTimeout(resolve, 0))
      expect(secondProgress).toHaveBeenCalledTimes(2)

      const concurrentA = publishDraft(article, [accounts[0]], vi.fn())
      const concurrentB = publishDraft(article, [accounts[1]], vi.fn())
      await vi.waitFor(() => expect(taskMessages).toHaveLength(4))
      window.postMessage(JSON.stringify({
        method: 'taskUpdate',
        task: { accounts: [{ ...rawA, status: 'done' }] },
      }), '*')

      await expect(Promise.all([concurrentA, concurrentB])).resolves.toEqual([
        [expect.objectContaining({ platform: 'juejin:same-account', status: 'failed' })],
        [expect.objectContaining({ platform: 'zhihu:other-account', status: 'failed' })],
      ])
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
