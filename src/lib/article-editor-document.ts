import type { ArticleDraft } from '../domain/article'
import { renderArticleSource, resolveArticleSource } from './article-source'

export function splitEditorDocument(text: string) {
  const heading = /^(?:\uFEFF)? {0,3}#(?:[ \t]+([^\n]*)|(?=\n|$))(?:\n\n?|$)/.exec(text)
    ?? /^(?:\uFEFF)?([^\n]+)\n {0,3}=+[ \t]*(?:\n\n?|$)/.exec(text)
  if (!heading) return { title: '', body: text, prefix: '', lineOffset: 0, blockOffset: 0 }
  const document = new DOMParser().parseFromString(renderArticleSource(heading[0], 'markdown'), 'text/html')
  const title = document.body.textContent?.trim() || ''
  return { title, body: text.slice(heading[0].length), prefix: heading[0],
    lineOffset: heading[0].split('\n').length - 1, blockOffset: 1 }
}

export function editorTitlePrefix(title: string): string {
  // Metadata titles are plain text. Escape Markdown punctuation on first insertion.
  return `# ${title.replace(/[\\`*_{}\[\]()<>#+.!|~=-]/g, '\\$&')}\n\n`
}

export function normalizeArticleEditorTitle(article: ArticleDraft): ArticleDraft {
  const source = resolveArticleSource(article)
  const split = splitEditorDocument(source.text)
  if (!split.blockOffset || (article.title && split.title !== article.title)) return article
  const document = new DOMParser().parseFromString(article.html, 'text/html')
  const heading = document.body.querySelector('h1')
  if (heading?.textContent?.trim() !== split.title) return article
  heading.remove()
  return { ...article, title: article.title || split.title, html: document.body.innerHTML,
    markdown: split.body, sourceText: split.body, sourceLanguage: 'markdown' }
}
