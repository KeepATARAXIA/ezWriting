import { editTitle } from './workbench-helpers'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE_DIRECTORY = path.resolve('src/test-fixtures/reliability')

interface BridgeTestWindow extends Window {
  __bridgeTest: {
    calls: number
    handlers: Array<(task: { accounts?: unknown }) => void>
  }
  $syncer: {
    getAccounts: (callback: (accounts: unknown[]) => void) => void
    addTask: (task: { eventID?: string }, handler: (task: { eventID?: string; accounts?: unknown }) => void) => () => void
  }
}

async function importFixture(page: Page, name: string): Promise<void> {
  const fileInput = page.locator('input[type="file"][accept*=".md"]')
  await fileInput.setInputFiles(path.join(FIXTURE_DIRECTORY, name))
  await expect(page.locator('.cm-content')).toBeVisible()
}

async function waitForLocalSave(page: Page): Promise<void> {
  await expect(page.getByLabel('本地保存状态')).toHaveText('已保存', { timeout: 10_000 })
}

async function openHistory(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: '打开历史记录', exact: true })
  if (await trigger.isVisible()) await trigger.click()
}

async function openLocalDataActions(page: Page): Promise<void> {
  await openHistory(page)
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  await expect(page.locator('.workbench-settings')).toBeVisible()
}

test('switches between Markdown source and presentation editing without losing syntax', async ({ page }) => {
  const linkedImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#dce5ff"/></svg>').toString('base64')
  const linkedImageDestination = 'https://seed.bytedance.com/en/blog/linked-image'
  const markdown = [
    '# Markdown 显示切换',
    '',
    '## 正文小标题',
    '',
    '**重点内容**和[参考链接](https://example.test/guide)',
    '',
    '<mark>HTML 标签高亮内容</mark>',
    '',
    'https://ai.google.dev/gemini-api/docs/omni。',
    '',
    `[![Seedance 参考图](data:image/svg+xml;base64,${linkedImage})](${linkedImageDestination})`,
    '',
    '点击这一段，让其他行显示排版效果。',
  ].join('\n')

  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'markdown-presentation.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(markdown),
  })
  await expect(page.locator('.topbar-document-title')).toHaveText('Markdown 显示切换')
  await expect(page.getByRole('button', { name: '显示 Markdown 语法' })).toHaveAttribute('aria-pressed', 'true')

  await page.locator('.cm-line').filter({ hasText: '点击这一段' }).click()
  await expect(page.locator('.source-editor')).toHaveClass(/markdown-presentation/)
  await expect(page.locator('.cm-md-heading-text.cm-md-heading-2')).toContainText('正文小标题')
  await expect(page.locator('.cm-md-strong')).toContainText('重点内容')
  await expect(page.locator('.cm-md-highlight')).toContainText('HTML 标签高亮内容')
  await expect(page.locator('.source-editor .cm-content')).not.toContainText('<mark>')
  await expect(page.locator('.source-editor .cm-content')).not.toContainText('https://example.test/guide')

  await page.evaluate(() => {
    const target = window as Window & { __openedLinks?: string[] }
    target.__openedLinks = []
    window.open = ((url?: string | URL) => {
      target.__openedLinks?.push(String(url))
      return null
    }) as typeof window.open
  })
  await page.locator('.cm-editor-direct-link').filter({ hasText: 'https://ai.google.dev/gemini-api/docs/omni' }).click({ modifiers: ['Control'] })
  await expect.poll(() => page.evaluate(
    () => (window as Window & { __openedLinks?: string[] }).__openedLinks,
  )).toEqual(['https://ai.google.dev/gemini-api/docs/omni'])

  const linkedImageCard = page.getByLabel('图片：Seedance 参考图')
  await linkedImageCard.click()
  const linkedImageLink = linkedImageCard.getByRole('link', { name: '链接 · seed.bytedance.com' })
  await expect(linkedImageLink).toBeVisible()
  await expect(linkedImageLink).toHaveAttribute('href', linkedImageDestination)
  await linkedImageCard.locator('img').click({ modifiers: ['Control'] })
  await expect.poll(() => page.evaluate(
    () => (window as Window & { __openedLinks?: string[] }).__openedLinks,
  )).toEqual([
    'https://ai.google.dev/gemini-api/docs/omni',
    linkedImageDestination,
  ])

  await page.locator('.cm-line').filter({ hasText: '重点内容' }).click()
  await expect(page.locator('.source-editor .cm-activeLine')).toContainText('**重点内容**')
  await page.getByRole('button', { name: '显示 Markdown 语法' }).click()
  await expect(page.locator('.source-editor .cm-content')).toContainText('## 正文小标题')
  await expect(page.locator('.source-editor .cm-content')).toContainText('<mark>HTML 标签高亮内容</mark>')
  await expect(page.locator('.source-editor .cm-content')).toContainText('https://example.test/guide')
})

test('keeps the selected source line centered after large images settle and on repeated clicks', async ({ page }) => {
  const largeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900"><rect width="900" height="900" fill="#dce5ff"/></svg>').toString('base64')
  const trailingParagraphs = Array.from({ length: 8 }, (_, index) => `后续段落 ${index + 1}，用于保留足够的预览滚动空间。`).join('\n\n')
  const markdown = [
    '# 预览居中回归',
    '图片前正文。',
    `![第一张大图](data:image/svg+xml;base64,${largeSvg})`,
    `![第二张大图](data:image/svg+xml;base64,${largeSvg})`,
    '目标定位行，应当出现在右侧正中间。',
    trailingParagraphs,
  ].join('\n\n')

  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'preview-center.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(markdown),
  })
  await expect(page.locator('.topbar-document-title')).toHaveText('预览居中回归')

  const sourceLine = page.locator('.cm-line').filter({ hasText: '目标定位行，应当出现在右侧正中间。' }).first()
  const previewViewport = page.locator('.platform-preview-viewport')
  const selectedTarget = page.locator('.wechat-content [data-preview-selected="true"]').first()
  const centerOffset = () => page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.platform-preview-viewport')
    const target = document.querySelector<HTMLElement>('.wechat-content [data-preview-selected="true"]')
    if (!viewport || !target) return Number.POSITIVE_INFINITY
    const viewportBounds = viewport.getBoundingClientRect()
    const targetBounds = target.getBoundingClientRect()
    return Math.abs(
      targetBounds.top + targetBounds.height / 2
      - (viewportBounds.top + viewport.clientHeight / 2),
    )
  })

  await sourceLine.click()
  await expect(selectedTarget).toContainText('目标定位行')
  await expect.poll(centerOffset).toBeLessThan(4)

  await previewViewport.evaluate(element => { element.scrollTop = 0 })
  await sourceLine.click()
  await expect(selectedTarget).toContainText('目标定位行')
  await expect.poll(centerOffset).toBeLessThan(4)
})

test('keeps the preview position fixed when a preview target locates the source editor', async ({ page }) => {
  const targetText = '目标段落 12，点击后只定位左侧编辑器。'
  const firstSourceText = '目标段落 4，用于撑开右侧预览滚动空间。'
  const secondSourceText = '目标段落 15，用于撑开右侧预览滚动空间。'
  const secondPreviewText = '目标段落 7，用于撑开右侧预览滚动空间。'
  const markdown = [
    '# 预览位置稳定性回归',
    ...Array.from(
      { length: 24 },
      (_, index) => `目标段落 ${index + 1}，${index === 11 ? '点击后只定位左侧编辑器。' : '用于撑开右侧预览滚动空间。'}`,
    ),
  ].join('\n\n')

  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'preview-position.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(markdown),
  })
  await expect(page.locator('.topbar-document-title')).toHaveText('预览位置稳定性回归')

  const previewViewport = page.locator('.platform-preview-viewport')
  const previewTarget = page.locator('.wechat-content [data-source-line]').filter({ hasText: targetText }).first()
  const firstSourceLine = page.locator('.cm-line').filter({ hasText: firstSourceText }).first()
  const secondSourceLine = page.locator('.cm-line').filter({ hasText: secondSourceText }).first()
  const secondPreviewTarget = page.locator('.wechat-content [data-source-line]').filter({ hasText: secondPreviewText }).first()
  const previewCenterOffset = (text: string) => page.evaluate(targetTextValue => {
    const viewport = document.querySelector<HTMLElement>('.platform-preview-viewport')
    const target = Array.from(document.querySelectorAll<HTMLElement>('.wechat-content [data-source-line]'))
      .find(element => element.textContent?.includes(targetTextValue))
    if (!viewport || !target) return Number.POSITIVE_INFINITY
    const viewportBounds = viewport.getBoundingClientRect()
    const targetBounds = target.getBoundingClientRect()
    // Near the top or bottom, centering is limited by the scroll range.
    const desired = viewport.scrollTop + targetBounds.top + targetBounds.height / 2 - (viewportBounds.top + viewport.clientHeight / 2)
    const reachable = Math.max(0, Math.min(desired, viewport.scrollHeight - viewport.clientHeight))
    return Math.abs(viewport.scrollTop - reachable)
  }, text)
  const sourceCenterOffset = () => page.locator('.source-editor .cm-activeLine').evaluate(element => {
    const scroller = element.closest<HTMLElement>('.cm-scroller')!
    const scrollerBounds = scroller.getBoundingClientRect()
    const lineBounds = element.getBoundingClientRect()
    return Math.abs(
      lineBounds.top + lineBounds.height / 2
      - (scrollerBounds.top + scroller.clientHeight / 2),
    )
  })
  await expect(previewTarget).toBeVisible()
  await page.waitForTimeout(800)
  await firstSourceLine.click()
  await expect(page.locator('.wechat-content [data-preview-selected="true"]')).toContainText(firstSourceText)
  await expect.poll(() => previewCenterOffset(firstSourceText)).toBeLessThan(4)

  const initialScrollTop = await previewTarget.evaluate(element => {
    const viewport = element.closest<HTMLElement>('.platform-preview-viewport')!
    const viewportBounds = viewport.getBoundingClientRect()
    const targetBounds = element.getBoundingClientRect()
    viewport.scrollTop += targetBounds.top - viewportBounds.top - viewport.clientHeight * 0.3
    return viewport.scrollTop
  })

  await previewTarget.click()
  const activeSourceLine = page.locator('.source-editor .cm-activeLine')
  await expect(activeSourceLine).toContainText(targetText)
  await expect(page.locator('.cm-located-source-line')).toHaveCount(0)
  await expect.poll(sourceCenterOffset).toBeLessThan(32)

  const settledScrollTop = await previewViewport.evaluate(element => element.scrollTop)
  expect(Math.abs(settledScrollTop - initialScrollTop)).toBeLessThan(2)
  await page.waitForTimeout(1200)
  expect(Math.abs(await previewViewport.evaluate(element => element.scrollTop) - settledScrollTop)).toBeLessThan(2)
  await expect(page.locator('.wechat-content [data-preview-selected="true"]')).toHaveCount(0, { timeout: 1000 })

  await secondSourceLine.click()
  await expect.poll(() => previewCenterOffset(secondSourceText)).toBeLessThan(4)

  await secondPreviewTarget.click()
  await expect(activeSourceLine).toContainText(secondPreviewText)
  await expect.poll(sourceCenterOffset).toBeLessThan(32)
  const secondSettledScrollTop = await previewViewport.evaluate(element => element.scrollTop)
  await page.waitForTimeout(1200)
  expect(Math.abs(await previewViewport.evaluate(element => element.scrollTop) - secondSettledScrollTop)).toBeLessThan(2)
  await expect(page.locator('.wechat-content [data-preview-selected="true"]')).toHaveCount(0, { timeout: 1000 })
})

test('keeps a deeply scrolled WeChat target visually fixed on its first click', async ({ page }) => {
  const paragraphCount = 236
  const markdown = [
    '# 公众号深度滚动回归',
    ...Array.from(
      { length: paragraphCount },
      (_, index) => `深度滚动段落 ${index + 1}，${'这段内容用于模拟公众号长正文在不同宽度与主题下产生的真实换行。'.repeat(index % 5 + 1)}点击右侧后只允许左侧编辑器定位。`,
    ),
  ].join('\n\n')

  await page.goto('/')
  const renderStartedAt = Date.now()
  await page.locator('input[type="file"][accept*=".md"]').first().setInputFiles({
    name: 'wechat-deep-scroll.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(markdown),
  })
  await expect(page.locator('.topbar-document-title')).toHaveText('公众号深度滚动回归')

  await page.locator('.preview-settings-toggle').click()
  await page.getByRole('tab', { name: '活力' }).click()
  await page.locator('.wechat-theme-card').filter({ hasText: '薄荷气泡' }).click()
  await expect(page.locator('[data-wechat-theme="mint-soda"]')).toBeVisible()

  const previewViewport = page.locator('.platform-preview-viewport')
  const previewBlocks = page.locator('.wechat-content [data-wechat-theme] > [data-source-block]')
  await expect(previewBlocks).toHaveCount(paragraphCount)
  const initialRenderMs = Date.now() - renderStartedAt
  expect(initialRenderMs).toBeLessThan(10_000)
  await waitForLocalSave(page)
  await page.waitForTimeout(1_000)

  const viewportBounds = await previewViewport.boundingBox()
  expect(viewportBounds).not.toBeNull()
  await page.mouse.move(
    viewportBounds!.x + viewportBounds!.width / 2,
    viewportBounds!.y + viewportBounds!.height / 2,
  )
  for (let index = 0; index < 10; index += 1) {
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(500)

  const targetBeforeClick = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.platform-preview-viewport')
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>('.wechat-content [data-wechat-theme] > [data-source-block]'),
    )
    if (!viewport) return null
    const viewportRect = viewport.getBoundingClientRect()
    const viewportCenter = viewportRect.top + viewport.clientHeight / 2
    const visibleBlocks = blocks
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.top >= viewportRect.top && rect.bottom <= viewportRect.bottom)
      .sort((first, second) => (
        Math.abs(first.rect.top + first.rect.height / 2 - viewportCenter)
        - Math.abs(second.rect.top + second.rect.height / 2 - viewportCenter)
      ))
    const target = visibleBlocks[0]
    if (!target) return null
    return {
      block: target.element.dataset.sourceBlock!,
      line: target.element.dataset.sourceLine!,
      text: target.element.textContent?.trim() ?? '',
      clickX: target.rect.left + Math.min(target.rect.width / 2, 120),
      clickY: target.rect.top + target.rect.height / 2,
      viewportOffset: target.rect.top - viewportRect.top,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
    }
  })
  expect(targetBeforeClick).not.toBeNull()
  expect(targetBeforeClick!.scrollTop).toBeGreaterThan(4_000)

  await page.mouse.click(targetBeforeClick!.clickX, targetBeforeClick!.clickY)
  await expect(page.locator('.source-editor .cm-activeLine')).toContainText(targetBeforeClick!.text)
  await expect(page.locator(
    `.wechat-content [data-source-block="${targetBeforeClick!.block}"][data-preview-selected="true"]`,
  )).toHaveCount(1)
  await page.waitForTimeout(1_200)

  const targetAfterClick = await page.evaluate(({ block, line }) => {
    const viewport = document.querySelector<HTMLElement>('.platform-preview-viewport')
    const target = document.querySelector<HTMLElement>(
      `.wechat-content [data-source-block="${block}"][data-source-line="${line}"]`,
    )
    if (!viewport || !target) return null
    const viewportRect = viewport.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    return {
      viewportOffset: targetRect.top - viewportRect.top,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      isVisible: targetRect.bottom > viewportRect.top && targetRect.top < viewportRect.bottom,
    }
  }, { block: targetBeforeClick!.block, line: targetBeforeClick!.line })
  expect(targetAfterClick).not.toBeNull()
  expect(targetAfterClick!.isVisible).toBe(true)
  expect(Math.abs(targetAfterClick!.viewportOffset - targetBeforeClick!.viewportOffset)).toBeLessThan(4)
  expect(Math.abs(targetAfterClick!.scrollTop - targetBeforeClick!.scrollTop)).toBeLessThan(2)
  expect(Math.abs(targetAfterClick!.scrollHeight - targetBeforeClick!.scrollHeight)).toBeLessThan(4)
})

test('imports, autosaves, restores, and exports a privacy-safe diagnostic report', async ({ page }) => {
  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')

  await expect(page.locator('.topbar-document-title')).toHaveText('Reliability Baseline')
  await waitForLocalSave(page)
  await page.reload()
  await expect(page.locator('.topbar-document-title')).toHaveText('Reliability Baseline')

  await openLocalDataActions(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出诊断报告' }).click()
  const download = await downloadPromise
  const reportPath = await download.path()
  expect(reportPath).not.toBeNull()
  const serialized = await readFile(reportPath!, 'utf8')
  const report = JSON.parse(serialized)

  expect(report.format).toBe('ezwriting-reliability-report')
  expect(report.recentImports).toHaveLength(1)
  expect(report.recentImports[0].source.kind).toBe('markdown')
  expect(report.privacy.includesArticleContent).toBe(false)
  expect(serialized).not.toContain('Reliability Baseline')
  expect(serialized).not.toContain('markdown-baseline.md')
})

test('moves a complete local backup to a different browser origin', async ({ page }) => {
  await page.goto('/')
  await importFixture(page, 'obsidian-complex.md')
  await waitForLocalSave(page)

  await openLocalDataActions(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份' }).click()
  const backup = await downloadPromise
  const backupPath = await backup.path()
  expect(backupPath).not.toBeNull()

  await page.goto('http://localhost:4174/')
  await expect(page.getByRole('heading', { name: '写一次，适配并发布到多个平台' })).toBeVisible()
  await page.locator('input[accept*=".ezwriting-backup"]').setInputFiles(backupPath!)

  await expect(page.locator('.topbar-document-title')).toHaveText('Obsidian Compatibility')
  await openHistory(page)
  await expect(page.locator('.history-draft-title', { hasText: 'Obsidian Compatibility' })).toBeVisible()
})

test('exports the Xiaohongshu card master at 1080 by 1440 pixels', async ({ page }) => {
  test.setTimeout(90_000)

  await page.goto('/')
  await importFixture(page, 'pagination-stress.md')
  await page.getByRole('tab', { name: '小红书' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载第 \d+ 张卡片/ }).first().click()
  const image = await downloadPromise
  const imagePath = await image.path()
  expect(imagePath).not.toBeNull()
  const png = await readFile(imagePath!)

  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(1080)
  expect(png.readUInt32BE(20)).toBe(1440)
})

test('blocks publishing for a blank document', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开始写稿' }).click()
  await page.getByRole('button', { name: '空白文档', exact: true }).click()
  await page.getByRole('button', { name: /打开发布面板/ }).click()
  await expect(page.locator('.publish-button')).toBeDisabled()
  await expect(page.locator('[aria-label="发布前检查"]')).toContainText('请先导入稿件')
})

test('sanitizes imported HTML before previews can trigger hidden requests or forged actions', async ({ page }) => {
  const requests: string[] = []
  await page.route('https://network.test/**', async route => {
    requests.push(new URL(route.request().url()).pathname)
    await route.abort()
  })
  await page.goto('/')
  await page.locator('input[type="file"][accept*=".md"]').setInputFiles({
    name: 'unsafe-network.html',
    mimeType: 'text/html',
    buffer: Buffer.from(`
      <article>
        <h1>HTML 净化门禁</h1>
        <img src="https://network.test/allowed.png" data-missing-id="forged" data-missing-asset="victim.png" alt="允许的远程正文图">
        <img srcset="https://network.test/srcset.png 2x" alt="禁止的候选图">
        <video autoplay preload="auto" poster="https://network.test/poster.png" src="https://network.test/video.mp4"><source src="https://network.test/video-source.mp4"></video>
        <audio autoplay src="https://network.test/audio.mp3"><track src="https://network.test/track.vtt"></audio>
        <iframe src="https://network.test/frame.html"></iframe>
        <object data="https://network.test/object.bin"></object>
        <table background="https://network.test/table.png"><tr><td>表格</td></tr></table>
        <input type="image" src="https://network.test/input.png">
        <p style="background: u\\72l('https://network.test/escaped-css.png')">正文</p>
        <button data-missing-image-action="delete" data-missing-id="forged" data-missing-asset="victim.png">伪造删除</button>
      </article>
    `),
  })

  await expect(page.locator('.topbar-document-title')).toHaveText('HTML 净化门禁')
  await expect.poll(() => [...new Set(requests)]).toContain('/allowed.png')
  await page.waitForTimeout(300)
  expect([...new Set(requests)]).toEqual(['/allowed.png'])
  await expect(page.locator('.missing-image-card')).toHaveCount(0)
  await expect(page.locator('[data-missing-image-action]')).toHaveCount(0)
})

test('deduplicates a synchronous publish double-click and waits for every account', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as BridgeTestWindow
    target.__bridgeTest = { calls: 0, handlers: [] }
    const accounts = [
      { type: 'zhihu', uid: 'account-a', title: '知乎账号' },
      { type: 'juejin', uid: 'account-b', title: '掘金账号' },
    ]
    target.$syncer = {
      getAccounts(callback) {
        callback(accounts)
      },
      addTask(task, handler) {
        target.__bridgeTest.calls += 1
        target.__bridgeTest.handlers.push(update => handler({ ...update, eventID: task.eventID }))
        return () => undefined
      },
    }
  })

  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')
  await page.getByRole('button', { name: /打开发布面板/ }).click()
  for (const platform of await page.locator('.platform-row').all()) await platform.click()

  await page.locator('.publish-button').evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await expect.poll(() => page.evaluate(() => (window as unknown as BridgeTestWindow).__bridgeTest.calls)).toBe(1)
  await expect(page.locator('.publish-button')).toBeDisabled()

  await page.evaluate(() => {
    ;(window as unknown as BridgeTestWindow).__bridgeTest.handlers[0]?.({
      accounts: [{ type: 'zhihu', uid: 'account-a', title: '知乎账号', status: 'done' }],
    })
  })
  await expect(page.locator('.publish-button')).toContainText('正在同步草稿')
  await expect(page.locator('.completion-note')).toHaveCount(0)

  await page.evaluate(() => {
    ;(window as unknown as BridgeTestWindow).__bridgeTest.handlers[0]?.({
      accounts: [{ type: 'juejin', uid: 'account-b', title: '掘金账号', status: 'done' }],
    })
  })
  await expect(page.locator('.completion-note')).toContainText('2 个草稿已创建')
  await expect.poll(() => page.evaluate(() => (window as unknown as BridgeTestWindow).__bridgeTest.calls)).toBe(1)
})

test('flushes an immediate edit before delete and restores the latest version', async ({ page }) => {
  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')
  await waitForLocalSave(page)

  await editTitle(page, '删除前最后一版')
  await openHistory(page)
  await page.locator('.history-draft-menu-button').first().click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.locator('.history-undo-notice').getByRole('button', { name: '撤销', exact: true }).click()
  await openHistory(page)
  await page.locator('.history-draft-open').first().click()

  await expect(page.locator('.topbar-document-title')).toHaveText('删除前最后一版')
})

test('rejects a stale write from another tab without overwriting the newer version', async ({ context, page }) => {
  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')
  await waitForLocalSave(page)

  const secondPage = await context.newPage()
  await secondPage.goto('/')
  await expect(secondPage.locator('.topbar-document-title')).toHaveText('Reliability Baseline')

  await editTitle(page, '标签页 A 的新版本')
  await page.waitForTimeout(850)
  await editTitle(secondPage, '标签页 B 的旧快照修改')

  await expect(secondPage.getByText(/另一标签页已更新这篇稿件/)).toBeVisible({ timeout: 5_000 })
  await page.reload()
  await expect(page.locator('.topbar-document-title')).toHaveText('标签页 A 的新版本')
})

test('turns simultaneous backup clicks into one download', async ({ page }) => {
  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')
  await waitForLocalSave(page)

  await openLocalDataActions(page)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await page.getByRole('button', { name: '导出备份' }).evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
    button.click()
  })

  await expect.poll(() => downloads.length).toBe(1)
  await page.waitForTimeout(300)
  expect(downloads).toHaveLength(1)
})
