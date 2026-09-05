import { describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { applyArticleFormatting } from './article-formatting'
import { applyWechatTheme } from './wechat-theme'
import { applyPlatformCompatibility } from './platform-compatibility'
import { createPersistedDraft } from '../domain/saved-draft'
import { LOCAL_BACKUP_FORMAT, parseLocalBackup } from '../services/local-backup'

describe('source style policy', () => {
  const source = '<p><strong><span style="color:#00aa55;font-size:22px">原文强调</span></strong></p><img src="https://example.com/a.png" style="border:2px solid #00aa55" alt="配图">'
  it('keeps explicit source styles through WeChat formatting without exposing internal markers', () => {
    const formatting = { ...DEFAULT_ARTICLE_FORMATTING, wechat: { ...DEFAULT_ARTICLE_FORMATTING.wechat, themeId: 'klein' as const } }
    const html = applyPlatformCompatibility(applyWechatTheme(applyArticleFormatting(source, formatting), formatting.wechat, formatting), 'wechat')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('strong span')?.getAttribute('style')).toContain('22px')
    expect(document.querySelector<HTMLElement>('strong span')?.style.color).toBe('rgb(0, 170, 85)')
    expect(document.querySelector('img')?.style.borderColor).toBe('rgb(0, 170, 85)')
    expect(html).not.toContain('data-ez-source-decoration')
  })
  it('removes nested colors and image borders in unified mode and uses the selected theme palette', () => {
    const formatting = { ...DEFAULT_ARTICLE_FORMATTING, sourceStyle: 'theme' as const, accent: 'green' as const, wechat: { ...DEFAULT_ARTICLE_FORMATTING.wechat, themeId: 'klein' as const } }
    const html = applyPlatformCompatibility(applyWechatTheme(applyArticleFormatting(source, formatting), formatting.wechat, formatting), 'wechat')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector<HTMLElement>('strong span')?.style.color).toBe('')
    expect(document.querySelector('img')?.style.borderColor).not.toBe('rgb(0, 170, 85)')
    expect(document.querySelector<HTMLElement>('strong')?.style.color).not.toBe('rgb(7, 163, 90)')
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
    expect(source).toContain('#00aa55')
  })
  it('retains the style policy through backup import and defaults older backups to preserve', async () => {
    const draft = createPersistedDraft({ id: 'style-policy', title: '样式备份', html: source, sourceKind: 'html', sourceFile: 'source.html', importedAt: new Date().toISOString(), tags: [], warnings: [] }, { ...DEFAULT_ARTICLE_FORMATTING, sourceStyle: 'theme' })
    const parse = () => parseLocalBackup(new File([JSON.stringify({ format: LOCAL_BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), activeDraftId: draft.id, drafts: [draft] })], 'backup.json', { type: 'application/json' }))
    expect((await parse()).drafts[0].formatting.sourceStyle).toBe('theme')
    delete draft.formatting.sourceStyle
    expect((await parse()).drafts[0].formatting.sourceStyle).toBe('preserve')
  })
})
