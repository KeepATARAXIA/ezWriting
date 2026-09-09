import { expect, type Page } from '@playwright/test'

export async function editTitle(page: Page, title: string) {
  const content = page.locator('.cm-content')
  await expect(content).toBeVisible()
  const showSyntax = page.getByRole('button', { name: '显示 Markdown 语法', exact: true })
  const restorePresentation = await showSyntax.count() > 0
  if (restorePresentation) await showSyntax.click()
  await content.click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.insertText(`# ${title}`)
  await page.locator('.topbar-document-title').click()
  await expect(page.locator('.topbar-document-title')).toHaveText(title)
  if (restorePresentation) await page.getByRole('button', { name: '隐藏 Markdown 语法', exact: true }).click()
}
