import { describe, expect, it } from 'vitest'
import type { ArticleDraft } from '../domain/article'
import {
  annotateLocalImagesAsMissing,
  htmlToReadableMarkdown,
  replaceArticleSourceImage,
  resolveArticleSource,
  sourceBlockIndexAtOffset,
  sourceLineForBlock,
  sourceLinesByBlock,
  updateArticleFromSource,
} from './article-source'

function article(overrides: Partial<ArticleDraft> = {}): ArticleDraft {
  return {
    id: 'draft-1',
    title: '源码稿件',
    html: '<p>正文</p>',
    markdown: '正文',
    sourceText: '正文',
    sourceLanguage: 'markdown',
    tags: [],
    sourceFile: 'article.md',
    sourceKind: 'markdown',
    importedAt: '2026-08-13T00:00:00.000Z',
    warnings: [],
    ...overrides,
  }
}

describe('article source', () => {
  it('keeps Markdown as the canonical source and derives safe HTML', () => {
    const next = updateArticleFromSource(article(), '> [!warning] 先备份\n> 再接入同步')
    expect(resolveArticleSource(next)).toEqual({
      text: '> [!warning] 先备份\n> 再接入同步',
      language: 'markdown',
    })
    expect(next.html).toContain('data-callout="warning"')
  })

  it('turns legacy HTML into readable Markdown while preserving embedded images underneath', () => {
    const dataUri = 'data:image/png;base64,AQIDBA=='
    const source = resolveArticleSource(article({
      sourceKind: 'html',
      markdown: undefined,
      sourceLanguage: 'html',
      sourceText: `<h2>开始前先看</h2><p>正文 <strong>重点</strong></p><img src="${dataUri}" alt="流程图">`,
    }))

    expect(source.language).toBe('markdown')
    expect(source.text).toBe(`## 开始前先看\n\n正文 **重点**\n\n![流程图](${dataUri})`)
    expect(source.text).not.toContain('<h2>')
  })

  it('keeps callouts, lists, and tables readable when converting HTML drafts', () => {
    const markdown = htmlToReadableMarkdown(`
      <aside data-callout="warning" data-callout-title="先备份">
        <div data-callout-title>先备份</div>
        <div data-callout-content><p>再接入同步</p></div>
      </aside>
      <ul><li>第一项</li><li>第二项</li></ul>
      <table><tr><th>平台</th><th>状态</th></tr><tr><td>公众号</td><td>待校对</td></tr></table>
    `)

    expect(markdown).toContain('> [!warning] 先备份\n> 再接入同步')
    expect(markdown).toContain('- 第一项\n- 第二项')
    expect(markdown).toContain('| 平台 | 状态 |\n| --- | --- |')
  })

  it('keeps visible spacer blocks as editable Markdown blank lines', () => {
    const markdown = htmlToReadableMarkdown(
      '<p>第一段</p><div data-source-spacer="true"></div><div data-source-spacer="true"></div><h2>第二段</h2>',
    )

    expect(markdown).toBe('第一段\n\n\n\n## 第二段')
  })

  it('maps rendered blocks back to Markdown lines and cursor offsets', () => {
    const source = '# 标题\n\n第一段\n\n> [!warning] 注意\n> 内容'
    expect(sourceLineForBlock(source, 'markdown', 0)).toBe(1)
    expect(sourceLineForBlock(source, 'markdown', 1)).toBe(3)
    expect(sourceLineForBlock(source, 'markdown', 2)).toBe(5)
    expect(sourceBlockIndexAtOffset(source, 'markdown', source.indexOf('内容'))).toBe(2)
    expect(sourceLinesByBlock('- 第一项\n- 第二项\n- 第三项', 'markdown')).toEqual([[1, 2, 3]])
  })

  it('maps appended footnote blocks back to their Markdown definitions', () => {
    const source = '正文脚注[^a]。\n\n[^a]: 第一行\n    第二行'

    expect(sourceLinesByBlock(source, 'markdown')).toEqual([[1], [3, 4]])
    expect(sourceLineForBlock(source, 'markdown', 1)).toBe(3)
  })

  it('marks unresolved local image references and repairs the Markdown source', () => {
    const missing = annotateLocalImagesAsMissing('<p>正文</p><img src="assets/flow.png" alt="流程图">')
    expect(missing.references).toEqual(['assets/flow.png'])
    expect(missing.html).toContain('data-missing-asset="assets/flow.png"')

    const repaired = replaceArticleSourceImage(article({
      html: missing.html,
      markdown: '![流程图](assets/flow.png)',
      sourceText: '![流程图](assets/flow.png)',
    }), 'assets/flow.png', 'data:image/png;base64,AQID', '新流程图')
    expect(repaired.sourceText).toBe('![新流程图](data:image/png;base64,AQID)')
    expect(repaired.html).toContain('data:image/png;base64,AQID')
  })
})
