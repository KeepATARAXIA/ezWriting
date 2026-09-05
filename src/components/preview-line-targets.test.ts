import { describe, expect, it } from 'vitest'
import { paragraphBreakTargets } from './preview-line-targets'

describe('paragraph break targets', () => {
  it('preserves nested formatting across explicit breaks without duplicating IDs', () => {
    const doc = new DOMParser().parseFromString('<p><strong id="emphasis">第一行<br>第二行 <em>强调</em></strong><br><a href="https://example.com">第三行</a></p>', 'text/html')
    const paragraph = doc.querySelector('p')!
    const targets = paragraphBreakTargets(paragraph, 3)!
    expect(targets.map(target => target.textContent)).toEqual(['第一行', '第二行 强调', '第三行'])
    expect(targets[0].querySelector('strong')?.textContent).toBe('第一行')
    expect(targets[1].querySelector('strong em')?.textContent).toBe('强调')
    expect(targets[2].querySelector('a')?.href).toBe('https://example.com/')
    expect(paragraph.querySelectorAll('#emphasis')).toHaveLength(1)
    expect(paragraph.querySelectorAll('br')).toHaveLength(2)
  })

  it.each([
    ['<p>自动折行内容</p>', 1],
    ['<p>内容<br>下一行</p>', 1],
    ['<pre>代码<br>下一行</pre>', 2],
  ])('leaves automatic wraps, unmatched HTML breaks and code unchanged: %s', (html, count) => {
    const element = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild as HTMLElement
    const before = element.outerHTML
    expect(paragraphBreakTargets(element, count)).toBeNull()
    expect(element.outerHTML).toBe(before)
  })
})
