import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DispatchControls, type BridgeState, type WorkState } from './dispatch-controls'
import { getBrowserExtensionGuide } from '../lib/browser-extension-install'
import type { PublishResult } from '../domain/article'

const accounts = [
  { id: 'wechat', name: '微信公众号', username: '账号一', raw: { type: 'wechat' } },
  { id: 'xhs', name: '小红书', username: '账号二', raw: { type: 'xiaohongshu' } },
  { id: 'zip', name: 'Markdown 压缩包', raw: { type: 'zip-download' } },
]

describe('DispatchControls', () => {
  let container: HTMLDivElement
  let root: Root
  const publish = vi.fn()
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    publish.mockClear()
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  function Harness({ bridgeState = 'connected', workState = 'ready', results = [], hasArticle = true, initial = [] }: {
    bridgeState?: BridgeState; workState?: WorkState; results?: PublishResult[]; hasArticle?: boolean; initial?: string[]
  }) {
    const [selectedIds, setSelectedIds] = useState(initial)
    return <DispatchControls accounts={accounts} bridgeError={null} bridgeState={bridgeState} hasArticle={hasArticle}
      installGuide={getBrowserExtensionGuide('Chrome/140')} isOpen results={results} selectedIds={selectedIds} workState={workState}
      onOpenChange={vi.fn()} onPublish={publish} onRefresh={vi.fn()}
      onTogglePlatform={id => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} />
  }
  const button = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === text)!
  const primary = () => container.querySelector<HTMLButtonElement>('.publish-button')!

  it('selects all connected platforms without selecting the download, then clears everything', async () => {
    await act(async () => root.render(<Harness />))
    expect(primary().disabled).toBe(true)
    expect(primary().textContent).toBe('请至少选择 1 个平台')
    await act(async () => button('全选').click())
    expect(container.querySelector('.drawer-platform-heading')?.textContent).toContain('已选 2 / 2')
    expect(primary().textContent).toBe('同步到微信、小红书')
    expect(primary().disabled).toBe(false)
    expect(container.querySelector('.dispatch-downloads .platform-row')?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => primary().click())
    expect(publish).toHaveBeenCalledOnce()
    await act(async () => button('清空').click())
    expect(container.querySelectorAll('.platform-row.selected')).toHaveLength(0)
    expect(primary().disabled).toBe(true)
  })

  it('labels download-only selection as a download and prevents empty article dispatch', async () => {
    await act(async () => root.render(<Harness initial={['zip']} />))
    expect(primary().textContent).toBe('下载 1 项到本地')
    expect(container.querySelector('.drawer-platform-heading')?.textContent).toContain('已选 0 / 2')
    await act(async () => root.render(<Harness initial={['zip']} hasArticle={false} />))
    expect(primary().textContent).toBe('请先填写正文')
    expect(primary().disabled).toBe(true)
  })

  it('explains unavailable rows after a connection failure and blocks all selection actions', async () => {
    await act(async () => root.render(<Harness bridgeState="error" initial={['wechat']} />))
    expect(primary().textContent).toBe('请先连接发布引擎')
    expect(button('全选').disabled).toBe(true)
    expect(button('清空').disabled).toBe(true)
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('.platform-row')).every(node => node.disabled && node.textContent?.includes('未连接'))).toBe(true)
  })

  it('locks controls during sync while retaining individual outcomes and repeat-draft feedback', async () => {
    const results: PublishResult[] = [
      { platform: 'wechat', name: '微信公众号', status: 'done', delivery: 'draft' },
      { platform: 'xhs', name: '小红书', status: 'uploading', delivery: 'draft' },
    ]
    await act(async () => root.render(<Harness initial={['wechat', 'xhs']} workState="publishing" results={results} />))
    expect(primary().disabled).toBe(true)
    expect(primary().textContent).toContain('正在同步草稿')
    expect(container.querySelector('.platform-row-status')?.textContent).toBe('草稿已创建')
    expect(button('全选').disabled).toBe(true)
    await act(async () => root.render(<Harness initial={['wechat', 'xhs']} workState="completed" results={results.slice(0, 1)} />))
    expect(container.querySelector('.dispatch-check-warning')?.textContent).toContain('可能产生重复草稿')
  })
})
