import { describe, expect, it } from 'vitest'
import {
  applyPlatformCompatibility,
  applyPlatformMarkdownCompatibility,
} from './platform-compatibility'

describe('platform compatibility formatting', () => {
  it('turns mark into an inline span that survives WeChat sanitizers', () => {
    const html = applyPlatformCompatibility(
      '<p>普通文字 <mark style="background-color:#ffdf66">重点内容</mark></p>',
      'wechat',
    )
    const document = new DOMParser().parseFromString(html, 'text/html')
    const highlight = document.querySelector<HTMLElement>('[data-ez-format="highlight"]')

    expect(document.querySelector('mark')).toBeNull()
    expect(highlight?.tagName).toBe('SPAN')
    expect(highlight?.style.backgroundColor).toBe('rgb(255, 223, 102)')
    expect(highlight?.style.boxDecorationBreak).toBe('clone')
  })

  it('keeps a visual highlight with a bold fallback for Xiaohongshu cards', () => {
    const html = applyPlatformCompatibility('<p><mark>重点内容</mark></p>', 'xhs')
    const document = new DOMParser().parseFromString(html, 'text/html')
    const highlight = document.querySelector<HTMLElement>('[data-ez-format="highlight"]')

    expect(highlight?.style.backgroundColor).toBe('rgb(255, 241, 168)')
    expect(highlight?.style.fontWeight).toBe('750')
  })

  it('degrades background highlight to bold underline for X articles', () => {
    const html = applyPlatformCompatibility('<p><mark>重点内容</mark></p>', 'x')
    const document = new DOMParser().parseFromString(html, 'text/html')
    const highlight = document.querySelector<HTMLElement>('[data-ez-format="highlight"]')

    expect(highlight?.style.backgroundColor).toBe('')
    expect(highlight?.style.fontWeight).toBe('700')
    expect(highlight?.style.textDecorationLine).toBe('underline')
  })

  it('removes nonstandard == markers from every published Markdown variant', () => {
    expect(applyPlatformMarkdownCompatibility('正文 ==重点==', 'wechat')).toContain('<span style=')
    expect(applyPlatformMarkdownCompatibility('正文 ==重点==', 'xhs')).toBe('正文 **重点**')
    expect(applyPlatformMarkdownCompatibility('正文 ==重点==', 'x')).toBe('正文 **重点**')
    expect(applyPlatformMarkdownCompatibility(undefined, 'generic')).toBeUndefined()
  })

  it('does not rewrite highlight-like text inside inline or fenced code', () => {
    const markdown = ['正文 ==重点==', '', '`a == b`', '', '```ts', 'const a = value == other', '```'].join('\n')

    expect(applyPlatformMarkdownCompatibility(markdown, 'xhs')).toBe(
      ['正文 **重点**', '', '`a == b`', '', '```ts', 'const a = value == other', '```'].join('\n'),
    )
  })

  it('repairs malformed strong spacing before publishing Markdown', () => {
    expect(applyPlatformMarkdownCompatibility('**问题选择： **判断哪个问题值得解决', 'generic')).toBe(
      '**问题选择：** 判断哪个问题值得解决',
    )
  })
})
