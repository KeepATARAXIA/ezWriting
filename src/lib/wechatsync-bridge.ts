import type { ArticleDraft, PlatformAccount, PublishResult } from '../domain/article'

interface RawAccount {
  type: string
  title?: string
  displayName?: string
  icon?: string
  avatar?: string
  uid?: string
  home?: string
  status?: string
  msg?: string
  error?: string
  editResp?: { draftLink?: string } | null
}

interface WechatsyncApi {
  getAccounts(callback: (result: unknown, response?: unknown) => void): void
  addTask(
    task: unknown,
    statusHandler: (task: { accounts?: RawAccount[] }) => void,
    callback?: (result: unknown, response?: unknown) => void,
  ): void
}

declare global {
  interface Window {
    $syncer?: WechatsyncApi
    $poster?: WechatsyncApi
  }
}

const BRIDGE_TIMEOUT = 8_000
const PUBLISH_TIMEOUT = 10 * 60_000
const WECHAT_200040_ISSUE_URL = 'https://github.com/wechatsync/Wechatsync/issues/217'

interface BridgeMessage {
  method?: string
  eventID?: number
  callReturn?: boolean
  result?: unknown
  task?: { accounts?: RawAccount[] }
}

class WindowMessageBridge implements WechatsyncApi {
  private readonly callbacks = new Map<number, (result: unknown) => void>()
  private statusHandler?: (task: { accounts?: RawAccount[] }) => void

  constructor() {
    window.addEventListener('message', event => {
      if (event.source && event.source !== window) return

      let message: BridgeMessage
      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }

      if (message.method === 'taskUpdate' && message.task) {
        this.statusHandler?.(message.task)
        return
      }

      if (!message.callReturn || typeof message.eventID !== 'number') return
      const callback = this.callbacks.get(message.eventID)
      if (!callback) return
      this.callbacks.delete(message.eventID)
      callback(message.result)
    })
  }

  requestAccounts(timeout = BRIDGE_TIMEOUT): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const eventID = Date.now() + Math.floor(Math.random() * 100_000)
      const timer = window.setTimeout(() => {
        this.callbacks.delete(eventID)
        reject(new Error('Wechatsync message bridge timeout'))
      }, timeout)

      this.callbacks.set(eventID, result => {
        window.clearTimeout(timer)
        resolve(result)
      })
      window.postMessage(JSON.stringify({ method: 'getAccounts', eventID }), '*')
    })
  }

  getAccounts(callback: (result: unknown, response?: unknown) => void): void {
    void this.requestAccounts().then(callback).catch(() => undefined)
  }

  addTask(
    task: unknown,
    statusHandler: (task: { accounts?: RawAccount[] }) => void,
    callback?: (result: unknown, response?: unknown) => void,
  ): void {
    this.statusHandler = statusHandler
    window.postMessage(JSON.stringify({
      method: 'addTask',
      eventID: Date.now() + Math.floor(Math.random() * 100_000),
      task,
    }), '*')
    callback?.(undefined)
  }
}

let messageBridge: WindowMessageBridge | undefined
let messageBridgeConfirmed = false

function injectedApi(): WechatsyncApi | undefined {
  return window.$syncer || window.$poster
}

function directApi(): WindowMessageBridge {
  messageBridge ??= new WindowMessageBridge()
  return messageBridge
}

function api(): WechatsyncApi | undefined {
  return injectedApi() || (messageBridgeConfirmed ? directApi() : undefined)
}

function callbackValue(first: unknown, second?: unknown): unknown {
  return second ?? first
}

function safeDraftUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function publishErrorDetails(platform: string, error?: string): Pick<PublishResult, 'error' | 'helpUrl' | 'helpLabel'> {
  if (platform === 'weixin' && error?.includes('200040')) {
    return {
      error: 'Wechatsync 2.0.9 已知兼容问题（错误码 200040），重新登录无法解决。',
      helpUrl: WECHAT_200040_ISSUE_URL,
      helpLabel: '查看上游 Issue #217',
    }
  }
  return { error }
}

export async function waitForBridge(timeout = 2_500): Promise<boolean> {
  if (injectedApi()) return true

  try {
    await directApi().requestAccounts(timeout)
    messageBridgeConfirmed = true
    return true
  } catch {
    return Boolean(injectedApi())
  }
}

export function isBridgeAvailable(): boolean {
  return Boolean(api())
}

export async function getPlatformAccounts(): Promise<PlatformAccount[]> {
  const bridge = api()
  if (!bridge) throw new Error('未检测到 Wechatsync 扩展桥接。')

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('读取平台登录状态超时，请刷新后重试。')), BRIDGE_TIMEOUT)
    bridge.getAccounts((first, second) => {
      window.clearTimeout(timer)
      const value = callbackValue(first, second)
      if (!Array.isArray(value)) {
        reject(new Error('扩展返回了无法识别的平台数据。'))
        return
      }
      resolve((value as RawAccount[]).map(account => ({
        id: account.type,
        name: account.displayName || account.title || account.type,
        username: account.title,
        icon: account.icon || account.avatar,
        homepage: account.home,
        raw: account,
      })))
    })
  })
}

export async function publishDraft(
  article: ArticleDraft,
  accounts: PlatformAccount[],
  onProgress: (results: PublishResult[]) => void,
): Promise<PublishResult[]> {
  const bridge = api()
  if (!bridge) throw new Error('发布桥接已断开，请刷新平台状态。')
  if (accounts.length === 0) throw new Error('请至少选择一个发布平台。')

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (results: PublishResult[]) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(results)
    }
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('发布任务超过 10 分钟未完成，请到各平台草稿箱确认结果。'))
    }, PUBLISH_TIMEOUT)

    const initial = accounts.map(account => ({
      platform: account.id,
      name: account.name,
      status: 'pending' as const,
      delivery: account.id === 'zip-download' ? 'download' as const : 'draft' as const,
      message: '等待扩展处理',
    }))
    onProgress(initial)

    bridge.addTask({
      post: {
        title: article.title,
        desc: article.summary || '',
        content: article.html,
        markdown: article.markdown,
        thumb: article.cover,
      },
      accounts: accounts.map(account => account.raw),
    }, task => {
      if (!task.accounts?.length) return
      const results = task.accounts.map(account => {
        const status = (['pending', 'uploading', 'done', 'failed'].includes(account.status || '')
          ? account.status
          : 'uploading') as PublishResult['status']
        const isDownload = account.type === 'zip-download'
        return {
          platform: account.type,
          name: account.displayName || account.title || account.type,
          status,
          delivery: isDownload ? 'download' as const : 'draft' as const,
          message: isDownload && status === 'done'
            ? '扩展已请求浏览器下载，请在下载记录中确认文件是否落盘。'
            : account.msg,
          ...publishErrorDetails(account.type, account.error),
          draftUrl: safeDraftUrl(account.editResp?.draftLink),
          requiresManualVerification: isDownload && status === 'done',
        }
      })
      onProgress(results)
      if (results.every(result => result.status === 'done' || result.status === 'failed')) finish(results)
    })
  })
}
