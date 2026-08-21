import type { ArticleDraft, PlatformAccount, PublishResult, PublishStatus } from '../domain/article'

interface RawAccount extends Record<string, unknown> {
  type: string
  title?: unknown
  displayName?: unknown
  icon?: unknown
  avatar?: unknown
  uid?: unknown
  home?: unknown
  status?: unknown
  msg?: unknown
  error?: unknown
  editResp?: unknown
}

interface BridgeTaskUpdate {
  accounts?: unknown
}

interface WechatsyncApi {
  getAccounts(callback: (result: unknown, response?: unknown) => void): void
  addTask(
    task: unknown,
    statusHandler: (task: BridgeTaskUpdate) => void,
    callback?: (result: unknown, response?: unknown) => void,
  ): unknown
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
const MISSING_TASK_ID_ERROR = '扩展返回的发布状态缺少 eventID，无法确认所属任务。请检查平台草稿箱后重试。'
const TERMINAL_STATUSES = new Set<PublishStatus>(['done', 'failed'])
const PUBLISH_STATUSES = new Set<PublishStatus>(['pending', 'uploading', 'done', 'failed'])

interface BridgeMessage {
  method?: string
  eventID?: number
  callReturn?: boolean
  result?: unknown
  task?: BridgeTaskUpdate
}

interface MessageTaskHandler {
  statusHandler: (task: BridgeTaskUpdate) => void
  expectedAccounts: RawAccount[]
  expectedAccountIds: Set<string>
  terminalAccountIds: Set<string>
}

interface SelectedAccount {
  id: string
  identity: string
  name: string
  raw: RawAccount
  type: string
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function accountType(value: unknown): string | undefined {
  return stringValue(value)?.toLowerCase()
}

function accountUid(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return stringValue(value)
}

function isRawAccount(value: unknown): value is RawAccount {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && accountType((value as { type?: unknown }).type))
}

function validRawAccounts(value: unknown): RawAccount[] {
  return Array.isArray(value) ? value.filter(isRawAccount) : []
}

function rawAccountIdentity(account: RawAccount): string {
  const type = accountType(account.type)!
  const uid = accountUid(account.uid)
  return uid ? `${type}:${uid}` : type
}

function rawAccountName(account: RawAccount): string {
  return stringValue(account.displayName) || stringValue(account.title) || accountType(account.type)!
}

function rawAccountStatus(account: RawAccount): PublishStatus | undefined {
  const status = stringValue(account.status)?.toLowerCase() as PublishStatus | undefined
  return status && PUBLISH_STATUSES.has(status) ? status : undefined
}

function rawDraftUrl(account: RawAccount): string | undefined {
  if (!account.editResp || typeof account.editResp !== 'object' || Array.isArray(account.editResp)) return undefined
  return safeDraftUrl((account.editResp as { draftLink?: unknown }).draftLink)
}

function expectedTaskAccounts(task: unknown): RawAccount[] {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return []
  return validRawAccounts((task as { accounts?: unknown }).accounts)
}

class WindowMessageBridge implements WechatsyncApi {
  private readonly callbacks = new Map<number, (result: unknown) => void>()
  private readonly taskHandlers = new Map<number, MessageTaskHandler>()
  private eventSequence = 0

  constructor() {
    window.addEventListener('message', event => {
      if (event.source && event.source !== window) return

      let parsed: unknown
      try {
        parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      const message = parsed as BridgeMessage

      if (message.method === 'taskUpdate') {
        if (typeof message.eventID !== 'number') {
          this.failUncorrelatedTasks()
          return
        }
        if (!message.task) return
        const eventID = message.eventID
        const handler = this.taskHandlers.get(eventID)
        if (!handler) return
        try {
          handler.statusHandler(message.task)
        } finally {
          this.recordTerminalAccounts(eventID, handler, message.task)
        }
        return
      }

      if (!message.callReturn || typeof message.eventID !== 'number') return
      const callback = this.callbacks.get(message.eventID)
      if (!callback) return
      this.callbacks.delete(message.eventID)
      callback(message.result)
    })
  }

  private nextEventID(): number {
    let eventID: number
    do {
      this.eventSequence += 1
      eventID = Date.now() * 1_000 + this.eventSequence
    } while (this.callbacks.has(eventID) || this.taskHandlers.has(eventID))
    return eventID
  }

  private failUncorrelatedTasks(): void {
    const activeTasks = [...this.taskHandlers.values()]
    this.taskHandlers.clear()
    for (const handler of activeTasks) {
      try {
        handler.statusHandler({
          accounts: handler.expectedAccounts.map(account => ({
            ...account,
            status: 'failed',
            error: MISSING_TASK_ID_ERROR,
          })),
        })
      } catch {
        // Each publish promise owns its own failure reporting and cleanup.
      }
    }
  }

  private recordTerminalAccounts(eventID: number, handler: MessageTaskHandler, task: BridgeTaskUpdate): void {
    for (const account of validRawAccounts(task.accounts)) {
      const identity = rawAccountIdentity(account)
      if (!handler.expectedAccountIds.has(identity)) continue
      const status = rawAccountStatus(account)
      if (status && TERMINAL_STATUSES.has(status)) handler.terminalAccountIds.add(identity)
    }
    if (
      handler.expectedAccountIds.size > 0
      && [...handler.expectedAccountIds].every(identity => handler.terminalAccountIds.has(identity))
    ) {
      this.taskHandlers.delete(eventID)
    }
  }

  requestAccounts(timeout = BRIDGE_TIMEOUT): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const eventID = this.nextEventID()
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
    statusHandler: (task: BridgeTaskUpdate) => void,
    callback?: (result: unknown, response?: unknown) => void,
  ): () => void {
    const eventID = this.nextEventID()
    const expectedAccounts = expectedTaskAccounts(task)
    const handler: MessageTaskHandler = {
      statusHandler,
      expectedAccounts,
      expectedAccountIds: new Set(expectedAccounts.map(rawAccountIdentity)),
      terminalAccountIds: new Set(),
    }
    this.taskHandlers.set(eventID, handler)
    window.postMessage(JSON.stringify({ method: 'addTask', eventID, task }), '*')
    callback?.(undefined)
    return () => {
      if (this.taskHandlers.get(eventID) === handler) this.taskHandlers.delete(eventID)
    }
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

function safeDraftUrl(value?: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
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

function sameResult(left: PublishResult, right: PublishResult): boolean {
  return left.platform === right.platform
    && left.name === right.name
    && left.status === right.status
    && left.delivery === right.delivery
    && left.message === right.message
    && left.error === right.error
    && left.draftUrl === right.draftUrl
    && left.helpUrl === right.helpUrl
    && left.helpLabel === right.helpLabel
    && left.requiresManualVerification === right.requiresManualVerification
}

function canAdvanceStatus(current: PublishStatus, next: PublishStatus): boolean {
  if (TERMINAL_STATUSES.has(current)) return false
  if (current === 'uploading' && next === 'pending') return false
  return true
}

function selectedAccountsForPublish(accounts: PlatformAccount[]): SelectedAccount[] {
  const selected: SelectedAccount[] = []
  const identities = new Set<string>()
  const ids = new Set<string>()

  for (const account of accounts) {
    if (!isRawAccount(account.raw)) throw new Error('发布平台账号数据无效，请刷新平台状态后重试。')
    const identity = rawAccountIdentity(account.raw)
    const id = stringValue(account.id) || identity
    if (identities.has(identity) || ids.has(id)) throw new Error('发布平台账号标识重复，请刷新平台状态后重试。')
    identities.add(identity)
    ids.add(id)
    selected.push({
      id,
      identity,
      name: stringValue(account.name) || rawAccountName(account.raw),
      raw: account.raw,
      type: accountType(account.raw.type)!,
    })
  }

  return selected
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
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(error)
    }
    const timer = window.setTimeout(() => fail(new Error('读取平台登录状态超时，请刷新后重试。')), BRIDGE_TIMEOUT)

    try {
      bridge.getAccounts((first, second) => {
        if (settled) return
        try {
          const value = callbackValue(first, second)
          if (!Array.isArray(value)) {
            fail(new Error('扩展返回了无法识别的平台数据。'))
            return
          }
          const seen = new Set<string>()
          const accounts = validRawAccounts(value).flatMap(account => {
            const id = rawAccountIdentity(account)
            if (seen.has(id)) return []
            seen.add(id)
            return [{
              id,
              name: rawAccountName(account),
              username: stringValue(account.title),
              icon: stringValue(account.icon) || stringValue(account.avatar),
              homepage: stringValue(account.home),
              raw: account,
            }]
          })
          settled = true
          window.clearTimeout(timer)
          resolve(accounts)
        } catch (error) {
          fail(error instanceof Error ? error : new Error('扩展返回了无法识别的平台数据。'))
        }
      })
    } catch (error) {
      fail(error instanceof Error ? error : new Error('读取平台登录状态失败。'))
    }
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
  const selected = selectedAccountsForPublish(accounts)
  const selectedByIdentity = new Map(selected.map(account => [account.identity, account]))
  const selectedByType = new Map<string, SelectedAccount[]>()
  for (const account of selected) {
    selectedByType.set(account.type, [...(selectedByType.get(account.type) || []), account])
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let timer = 0
    let cleanupTask: (() => void) | undefined
    const resultsById = new Map<string, PublishResult>(selected.map(account => [account.id, {
      platform: account.id,
      name: account.name,
      status: 'pending',
      delivery: account.type === 'zip-download' ? 'download' : 'draft',
      message: '等待扩展处理',
    }]))
    const orderedResults = () => selected.map(account => resultsById.get(account.id)!)
    const cleanup = () => {
      if (timer) window.clearTimeout(timer)
      cleanupTask?.()
      cleanupTask = undefined
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(orderedResults())
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    timer = window.setTimeout(() => {
      fail(new Error('发布任务超过 10 分钟未完成，请到各平台草稿箱确认结果。'))
    }, PUBLISH_TIMEOUT)

    try {
      onProgress(orderedResults())
      const cleanupCandidate = bridge.addTask({
        post: {
          title: article.title,
          desc: article.summary || '',
          content: article.html,
          markdown: article.markdown,
        },
        accounts: selected.map(account => account.raw),
      }, task => {
        if (settled) return
        try {
          let changed = false
          for (const rawAccount of validRawAccounts(task.accounts)) {
            const status = rawAccountStatus(rawAccount)
            if (!status) continue
            const identity = rawAccountIdentity(rawAccount)
            const type = accountType(rawAccount.type)!
            const sameTypeAccounts = selectedByType.get(type)
            const account = selectedByIdentity.get(identity)
              || (accountUid(rawAccount.uid) ? undefined : sameTypeAccounts?.length === 1 ? sameTypeAccounts[0] : undefined)
            if (!account) continue
            const current = resultsById.get(account.id)!
            if (!canAdvanceStatus(current.status, status)) continue
            const isDownload = account.type === 'zip-download'
            const error = stringValue(rawAccount.error)
            const next: PublishResult = {
              platform: account.id,
              name: account.name,
              status,
              delivery: isDownload ? 'download' : 'draft',
              message: isDownload && status === 'done'
                ? '扩展已请求浏览器下载，请在下载记录中确认文件是否落盘。'
                : stringValue(rawAccount.msg),
              ...publishErrorDetails(account.type, error),
              draftUrl: rawDraftUrl(rawAccount),
              requiresManualVerification: isDownload && status === 'done',
            }
            if (sameResult(current, next)) continue
            resultsById.set(account.id, next)
            changed = true
          }
          if (!changed) return
          const results = orderedResults()
          onProgress(results)
          if (results.every(result => TERMINAL_STATUSES.has(result.status))) finish()
        } catch (error) {
          fail(error instanceof Error ? error : new Error('发布状态处理失败。'))
        }
      })
      if (typeof cleanupCandidate === 'function') cleanupTask = cleanupCandidate as () => void
      if (settled) cleanup()
    } catch (error) {
      fail(error instanceof Error ? error : new Error('发布任务创建失败。'))
    }
  })
}
