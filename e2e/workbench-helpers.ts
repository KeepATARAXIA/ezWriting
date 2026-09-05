import { expect, type Page } from '@playwright/test'

export async function editTitle(page: Page, title: string) {
  const content = page.locator('.cm-content')
  await content.click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.insertText(`# ${title}`)
  await page.locator('.topbar-document-title').click()
  await expect(page.locator('.topbar-document-title')).toHaveText(title)
}
