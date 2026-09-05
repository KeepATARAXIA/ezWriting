import { expect, it } from 'vitest'
import { editorTitlePrefix, normalizeArticleEditorTitle, splitEditorDocument } from './article-editor-document'
import type { ArticleDraft } from '../domain/article'

it('splits only a leading title and retains exact body text and source offsets', () => {
  expect(splitEditorDocument('# **文章**标题\n\n正文\n\n# 正文标题')).toMatchObject({ title: '文章标题', body: '正文\n\n# 正文标题', lineOffset: 2, blockOffset: 1 })
  expect(splitEditorDocument('文章标题\n===\n\n正文')).toMatchObject({ title: '文章标题', body: '正文', lineOffset: 3 })
  expect(splitEditorDocument('# \n\n')).toMatchObject({ title: '', body: '', lineOffset: 2 })
  expect(splitEditorDocument('正文\n\n# 后续标题')).toMatchObject({ title: '', body: '正文\n\n# 后续标题', blockOffset: 0 })
})

it('round trips metadata punctuation without interpreting it as title formatting', () => {
  const title = '标题 * [链接](url) & <文字> # 1.0'
  expect(splitEditorDocument(editorTitlePrefix(title) + '正文')).toMatchObject({ title, body: '正文' })
})

it('removes a duplicated imported title while preserving body styles and distinct headings', () => {
  const article: ArticleDraft = { id: 'test', title: '导入标题', html: '<h1>导入标题</h1><p style="color:red">正文</p><h1>另一标题</h1>', sourceText: '# 导入标题\n\n正文\n\n# 另一标题', sourceLanguage: 'markdown', warnings: [], tags: [], sourceFile: 'test.md', sourceKind: 'markdown', importedAt: '' }
  const normalized = normalizeArticleEditorTitle(article)
  expect(normalized.title).toBe('导入标题')
  expect(normalized.sourceText).toBe('正文\n\n# 另一标题')
  expect(normalized.html).toBe('<p style="color:red">正文</p><h1>另一标题</h1>')
  expect(normalizeArticleEditorTitle(normalized)).toBe(normalized)
  expect(normalizeArticleEditorTitle({ ...article, title: '独立标题' }).sourceText).toBe(article.sourceText)
})
