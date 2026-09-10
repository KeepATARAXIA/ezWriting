import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ARTICLE_FORMATTING } from '../domain/formatting'
import { createPersistedDraft } from '../domain/saved-draft'
import { readCoverImage } from '../domain/artwork'
import { LocalDraftRepository, resetLocalDraftDatabase } from './local-draft-repository'
import { createLocalBackup, createLocalBackupArchive, importLocalBackup, parseLocalBackup, serializeLocalBackup } from './local-backup'

const data = 'data:image/png;base64,AQIDBA=='
const cover = { source: data, title: '独立封面', width: 1880, height: 800 }
const repositories: { name: string; repository: LocalDraftRepository }[] = []
function repository() {
  const name = `artwork-${crypto.randomUUID()}`, repository = new LocalDraftRepository({ databaseName: name, runtimeImageReferences: true })
  repositories.push({ name, repository }); return repository
}
function draft() { return createPersistedDraft({ id: crypto.randomUUID(), title: '文章', html: '<p>正文</p>', sourceText: '正文', sourceLanguage: 'markdown', coverImage: cover, tags: [], sourceFile: '文章.md', sourceKind: 'markdown', importedAt: new Date().toISOString(), warnings: [] }, DEFAULT_ARTICLE_FORMATTING) }
afterEach(async () => { for (const entry of repositories.splice(0)) { await entry.repository.close(); await resetLocalDraftDatabase(entry.name) } })
describe('independent cover persistence', () => {
  it('stores cover media separately and retains it across body edits and reloads', async () => {
    const repo = repository(), original = draft()
    await repo.saveDraft(original)
    const stored = await repo.readDraftForBackup(original.id)
    expect(stored?.assets).toHaveLength(1)
    expect(stored?.draft.article.coverImage?.source).toMatch(/^dispatch-asset:\/\//)
    expect(stored?.draft.article.html).toBe('<p>正文</p>')
    const loaded = (await repo.getDraft(original.id))!
    expect(loaded.article.coverImage).toEqual(cover)
    await repo.saveDraft({ ...loaded, article: { ...loaded.article, html: '<p>继续编辑</p>' } })
    expect((await repo.getDraft(original.id))?.article.coverImage).toEqual(cover)
  })
  it.each(['json', 'zip'])('round-trips covers through %s backups', async format => {
    const source = repository(), original = draft(); await source.saveDraft(original)
    const blob = format === 'zip' ? (await createLocalBackupArchive(source)).blob : serializeLocalBackup(await createLocalBackup(source))
    const parsed = await parseLocalBackup(new File([blob], `backup.${format}`))
    const target = repository(); await importLocalBackup(target, parsed)
    expect((await target.getDraft(original.id))?.article.coverImage).toEqual(cover)
  })
  it('drops unsafe or malformed imported cover sources', () => {
    for (const source of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://tracking.example/cover.png']) expect(readCoverImage({ ...cover, source })).toBeUndefined()
    expect(readCoverImage({ ...cover, width: 99999 })).toBeUndefined()
  })
})
