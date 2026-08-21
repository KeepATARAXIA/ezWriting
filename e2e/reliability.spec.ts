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
  const fileInput = page.locator('.empty-import-card input[type="file"][accept*=".md"]')
  await fileInput.setInputFiles(path.join(FIXTURE_DIRECTORY, name))
  await expect(page.getByLabel('文章标题')).toBeVisible()
}

async function waitForLocalSave(page: Page): Promise<void> {
  await expect(page.locator('.history-sync-state', { hasText: '已保存' }).first()).toBeVisible({ timeout: 10_000 })
}

test('imports, autosaves, restores, and exports a privacy-safe diagnostic report', async ({ page }) => {
  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')

  await expect(page.getByLabel('文章标题')).toHaveValue('Reliability Baseline')
  await waitForLocalSave(page)
  await page.reload()
  await expect(page.getByLabel('文章标题')).toHaveValue('Reliability Baseline')

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

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份' }).click()
  const backup = await downloadPromise
  const backupPath = await backup.path()
  expect(backupPath).not.toBeNull()

  await page.goto('http://localhost:4174/')
  await expect(page.getByRole('heading', { name: '新建或导入一篇稿件' })).toBeVisible()
  await page.locator('input[accept*=".ezwriting-backup"]').setInputFiles(backupPath!)

  await expect(page.getByLabel('文章标题')).toHaveValue('Obsidian Compatibility')
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
  await page.getByRole('button', { name: '新建文档' }).click()
  await expect(page.getByRole('button', { name: /打开发布面板/ })).toBeDisabled()
})

test('sanitizes imported HTML before previews can trigger hidden requests or forged actions', async ({ page }) => {
  const requests: string[] = []
  await page.route('https://network.test/**', async route => {
    requests.push(new URL(route.request().url()).pathname)
    await route.abort()
  })
  await page.goto('/')
  await page.locator('.empty-import-card input[type="file"][accept*=".md"]').setInputFiles({
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

  await expect(page.getByLabel('文章标题')).toHaveValue('HTML 净化门禁')
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

  await page.getByLabel('文章标题').fill('删除前最后一版')
  await page.locator('.history-draft-menu-button').first().click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.locator('.history-undo-notice button').click()
  await page.locator('.history-draft-open').first().click()

  await expect(page.getByLabel('文章标题')).toHaveValue('删除前最后一版')
})

test('rejects a stale write from another tab without overwriting the newer version', async ({ context, page }) => {
  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')
  await waitForLocalSave(page)

  const secondPage = await context.newPage()
  await secondPage.goto('/')
  await expect(secondPage.getByLabel('文章标题')).toHaveValue('Reliability Baseline')

  await page.getByLabel('文章标题').fill('标签页 A 的新版本')
  await page.waitForTimeout(850)
  await secondPage.getByLabel('文章标题').fill('标签页 B 的旧快照修改')

  await expect(secondPage.getByText(/另一标签页已更新这篇稿件/)).toBeVisible({ timeout: 5_000 })
  await page.reload()
  await expect(page.getByLabel('文章标题')).toHaveValue('标签页 A 的新版本')
})

test('turns simultaneous backup clicks into one download', async ({ page }) => {
  await page.goto('/')
  await importFixture(page, 'markdown-baseline.md')
  await waitForLocalSave(page)

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
