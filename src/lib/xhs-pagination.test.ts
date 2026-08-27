import { describe, expect, it } from 'vitest'
import { paginateForXhsCards } from './xhs-pagination'

function parsePage(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function pngDataUri(width: number, height: number): string {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes[16] = (width >>> 24) & 0xff
  bytes[17] = (width >>> 16) & 0xff
  bytes[18] = (width >>> 8) & 0xff
  bytes[19] = width & 0xff
  bytes[20] = (height >>> 24) & 0xff
  bytes[21] = (height >>> 16) & 0xff
  bytes[22] = (height >>> 8) & 0xff
  bytes[23] = height & 0xff
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('paginateForXhsCards', () => {
  it('fills the first card with list content instead of leaving most of it blank', () => {
    const itemA = '核心功能包含深度筛选、自动分类与细节信息，可以帮助读者更快找到真正值得阅读的内容。'.repeat(3)
    const itemB = '实际使用时效果不错，但完整跑完一轮会比较慢，需要根据文章长度控制处理范围。'.repeat(3)
    const html = `<p data-source-block="0">给大家分享一个非常好用的提示词，它可以从大量内容里筛选出真正有价值的信息。</p><ol data-source-block="1"><li>${itemA}</li><li>${itemB}</li></ol><p data-source-block="2">提示词放在下方，需要时可以直接复制测试。</p>`

    const pages = paginateForXhsCards(html, { title: 'X 检索提示词' })

    expect(pages.length).toBeLessThanOrEqual(2)
    expect(parsePage(pages[0]).querySelector('li')).not.toBeNull()
  })

  it('splits long ordered lists while keeping numbering continuous', () => {
    const items = Array.from({ length: 5 }, (_, index) => `<li>第 ${index + 1} 项：${'这是一段需要保留编号的列表内容。'.repeat(12)}</li>`).join('')
    const pages = paginateForXhsCards(`<ol data-source-block="4">${items}</ol>`, { title: '长列表' })
    const documents = pages.map(parsePage)
    const renderedItems = documents.flatMap(document => Array.from(document.querySelectorAll('li')).map(item => item.textContent))
    const starts = documents.flatMap(document => Array.from(document.querySelectorAll('ol')).map(list => Number(list.getAttribute('start') || 1)))

    expect(pages.length).toBeGreaterThan(1)
    expect(renderedItems).toHaveLength(5)
    expect(starts[0]).toBe(1)
    expect(starts.some(start => start > 1)).toBe(true)
  })

  it('keeps a heading with the content that follows it', () => {
    const lead = Array.from({ length: 8 }, (_, index) => `这是用于填充前页的第 ${index + 1} 句话，内容需要保持自然分页。`).join('')
    const pages = paginateForXhsCards(`<p data-source-block="0">${lead}</p><h2 data-source-block="1">关键结论</h2><p data-source-block="2">标题后的解释应该和标题出现在同一张卡片中。</p>`, { title: '分页测试' })

    for (const page of pages) {
      expect(parsePage(page).body.lastElementChild?.tagName).not.toBe('H2')
    }
  })

  it('preserves source block mapping after splitting a long paragraph', () => {
    const paragraph = Array.from({ length: 14 }, (_, index) => `第 ${index + 1} 句话用于验证长段落拆分后仍可定位到原文。`).join('')
    const pages = paginateForXhsCards(`<p data-source-block="7" tabindex="0">${paragraph}</p>`, { title: '长段落' })
    const fragments = pages.flatMap(page => Array.from(parsePage(page).querySelectorAll('p')))

    expect(fragments.length).toBeGreaterThan(1)
    expect(fragments.every(fragment => fragment.getAttribute('data-source-block') === '7')).toBe(true)
  })

  it('uses embedded image dimensions to pack wide screenshots without treating them as square images', () => {
    const wideImage = pngDataUri(2400, 720)
    const squareImage = pngDataUri(1200, 1200)
    const wideHtml = Array.from({ length: 8 }, (_, index) => `<p data-source-block="${index}"><img src="${wideImage}" alt="宽图 ${index + 1}"></p>`).join('')
    const squareHtml = Array.from({ length: 8 }, (_, index) => `<p data-source-block="${index}"><img src="${squareImage}" alt="方图 ${index + 1}"></p>`).join('')

    const widePages = paginateForXhsCards(wideHtml, { title: '宽屏截图教程' })
    const squarePages = paginateForXhsCards(squareHtml, { title: '方图教程' })
    const renderedWideImages = widePages.reduce((total, page) => total + parsePage(page).querySelectorAll('img').length, 0)

    expect(widePages).toHaveLength(3)
    expect(squarePages).toHaveLength(4)
    expect(renderedWideImages).toBe(8)
  })

  it('preserves an image and inline formatting when they share a paragraph', () => {
    const image = pngDataUri(2400, 720)
    const html = `<p data-source-block="3"><u>图片前的说明文字</u><img src="${image}" alt="模型发布时间轴"></p><h2 data-source-block="4">后续标题</h2>`

    const pages = paginateForXhsCards(html, { title: '图文混排' })
    const rendered = parsePage(pages.join(''))

    expect(rendered.querySelectorAll('img')).toHaveLength(1)
    expect(rendered.querySelector('img')?.getAttribute('alt')).toBe('模型发布时间轴')
    expect(rendered.querySelector('u')?.textContent).toBe('图片前的说明文字')
    expect(rendered.body.textContent).toContain('后续标题')
  })

  it('preserves common Markdown inline semantics across card pagination', () => {
    const filler = '这段文字用于触发分页，同时验证行内语义不会在拆分过程中丢失。'.repeat(30)
    const html = `<p data-source-block="0"><strong>粗体</strong>、<em>斜体</em>、<del>删除线</del>、<mark>高亮</mark>、<code>代码</code>与<a href="https://example.com">链接</a>。${filler}</p>`

    const pages = paginateForXhsCards(html, { title: 'Markdown 兼容性' })
    const rendered = parsePage(pages.join(''))

    expect(pages.length).toBeGreaterThan(1)
    expect(rendered.querySelector('strong')?.textContent).toBe('粗体')
    expect(rendered.querySelector('em')?.textContent).toBe('斜体')
    expect(rendered.querySelector('del')?.textContent).toBe('删除线')
    expect(rendered.querySelector('mark')?.textContent).toBe('高亮')
    expect(rendered.querySelector('code')?.textContent).toBe('代码')
    expect(rendered.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })

  it('fills text-only cards using the rendered heading and list metrics', () => {
    const sections = Array.from({ length: 6 }, (_, sectionIndex) => {
      const items = Array.from({ length: 3 }, (_, itemIndex) => (
        `<li data-source-block="${sectionIndex * 3 + itemIndex}">第 ${itemIndex + 1} 条判断用于说明当前阶段的实际做法、限制条件与后续维护要求，避免只留下没有上下文的简短结论。</li>`
      )).join('')
      return `<h2 data-source-block="${sectionIndex + 20}">阶段 ${sectionIndex + 1} 的关键判断</h2><ul>${items}</ul>`
    }).join('')

    const pages = paginateForXhsCards(sections, { title: 'LLM Timeline：阶段 6 验收上线与生产稳定化' })
    const renderedItems = pages.reduce((total, page) => total + parsePage(page).querySelectorAll('li').length, 0)

    expect(pages).toHaveLength(3)
    expect(renderedItems).toBe(18)
    expect(pages.every(page => parsePage(page).body.lastElementChild?.tagName !== 'H2')).toBe(true)
  })

  it('compacts a realistic timeline article without reserving list spacing for every item', () => {
    const sections = [
      ['阶段事实', [
        '项目已从功能建设进入验收上线与生产稳定化阶段，核心形态是原生前端单屏工作台和静态数据快照。',
        '最近七天公开池约有两千条记录，旧同步方式会反复扫描全池，现已改为最新记录优先处理。',
        '时间轴曾连续暴露右侧留白和未来刻度问题，最终通过统一时间边界和独立初始化解决。',
        '用户浏览器曾因扩展注入节点与内置预览显示不一致，现已恢复单屏布局并完成验收。',
      ]],
      ['值得沉淀的长期判断', [
        '在严格资源预算下，定时同步的首要目标不是单轮吞吐最大化，而是让最新数据稳定进入系统。',
        '时间轴的日期、过滤、坐标和交互必须建立在同一数据域上，视觉留白不能反向污染事实坐标。',
        '真实浏览器环境仍是最终验收来源，内置浏览器不能替代扩展注入和缓存状态检查。',
      ]],
      ['已验证方法', [
        '资源受限环境下的最新优先与空闲补扫方法已经通过生产条件验证。',
        '复杂时间轴的状态与几何不变量已整理为可复用的检查清单。',
        '真实浏览器验收与静态网站发布门禁已形成稳定步骤。',
      ]],
      ['候选方法', [
        '内容聚合系统可以继续观察来源分布、重复率与噪声变化，但暂不扩展为长期项目。',
        '工作树范围规则仍需更多独立任务验证，确认可复用后再沉淀方法。',
      ]],
      ['踩坑与预防', [
        '不要在最新页变化时恢复单轮全池扫描，应固定分页上限并持久化旧页进度。',
        '不要延长时间域制造右侧留白，只扩展画布而不生成未来刻度或节点。',
        '不要让初始位置与真实浏览位置混用，应始终采用独立的真实值。',
        '不要只根据数据库记录判断定时任务健康，还需检查终止任务和调用状态。',
        '不要使用来源不明的绕路差异修复，应先确认资源地址和线上文件一致。',
      ]],
      ['未沉淀内容及理由', [
        '模型军备、评分阈值和页面路由仍属于当前产品约束，不具备跨项目稳定性。',
        '自动化方案还未经过足够次数验证，只保留在项目下一步中继续观察。',
        '媒体栏目和采集来源频繁变化，没有形成可复用的长期方法。',
        '单次视觉调整只服务当前页面，不进入长期知识库。',
      ]],
      ['Wiki 写入记录', [
        '新增资源受限环境的最新优先与空闲补扫正式方法页。',
        '更新三个主题索引、知识库总索引与操作日志。',
        '本次依据项目工作记录整理并保留完整时间戳。',
      ]],
    ]
    const html = sections.map(([heading, items], sectionIndex) => (
      `<h2 data-source-block="${sectionIndex}">${heading}</h2><ul>${(items as string[]).map((item, itemIndex) => `<li data-source-block="${sectionIndex * 10 + itemIndex}">${item}${sectionIndex < 3 ? '并记录完整上下文。' : ''}</li>`).join('')}</ul>`
    )).join('')

    const pages = paginateForXhsCards(html, { title: 'LLM Timeline：阶段6验收上线与生产稳定化' })
    const renderedItems = pages.reduce((total, page) => total + parsePage(page).querySelectorAll('li').length, 0)
    expect(pages).toHaveLength(3)
    expect(renderedItems).toBe(24)
    expect(pages.every(page => parsePage(page).body.lastElementChild?.tagName !== 'H2')).toBe(true)
  })

  it('does not reserve a full list margin for every single-item Markdown list', () => {
    const sections = Array.from({ length: 7 }, (_, sectionIndex) => {
      const itemCount = sectionIndex === 0 || sectionIndex >= 4 ? 4 : 3
      const items = Array.from({ length: itemCount }, (_, itemIndex) => (
        `<ul data-source-block="${sectionIndex * 10 + itemIndex}"><li>第 ${itemIndex + 1} 条内容用于说明当前阶段的实际做法、限制条件与后续维护要求，避免只留下没有上下文的简短结论。</li></ul>`
      )).join('')
      return `<h2 data-source-block="${sectionIndex + 80}">阶段 ${sectionIndex + 1} 的关键判断</h2>${items}`
    }).join('')

    const pages = paginateForXhsCards(sections, { title: 'LLM Timeline：阶段6验收上线与生产稳定化' })
    const renderedItems = pages.reduce((total, page) => total + parsePage(page).querySelectorAll('li').length, 0)

    expect(pages).toHaveLength(4)
    expect(renderedItems).toBe(25)
    expect(pages.every(page => parsePage(page).body.lastElementChild?.tagName !== 'H2')).toBe(true)
  })

  it('counts visible source blank lines when deciding the next XHS card', () => {
    const body = Array.from({ length: 6 }, (_, index) => (
      `<p>第 ${index + 1} 段内容：${'这是一段用于校准卡片高度的正文。'.repeat(5)}</p>`
    )).join('')
    const spacers = Array.from({ length: 8 }, () => (
      '<div data-source-spacer="true" style="height: 1.72em; min-height: 1.72em; display: block" aria-hidden="true"></div>'
    )).join('')

    const compactPages = paginateForXhsCards(body, { title: '空行同步' })
    const spacedPages = paginateForXhsCards(`${body.slice(0, body.indexOf('</p>') + 4)}${spacers}${body.slice(body.indexOf('</p>') + 4)}`, { title: '空行同步' })

    expect(spacedPages.length).toBeGreaterThan(compactPages.length)
    expect(spacedPages.join('').match(/data-source-spacer/g)).toHaveLength(8)
  })

  it('reserves more card space when Xiaohongshu typography is enlarged', () => {
    const html = Array.from({ length: 12 }, (_, index) => (
      `<p data-source-block="${index}">第 ${index + 1} 段内容：${'排版调整需要同步影响预览与图片分页。'.repeat(4)}</p>`
    )).join('')

    const compactPages = paginateForXhsCards(html, { title: '排版密度', textScale: 0.82 })
    const enlargedPages = paginateForXhsCards(html, { title: '排版密度', textScale: 1.21 })

    expect(enlargedPages.length).toBeGreaterThan(compactPages.length)
    expect(enlargedPages.join('')).toContain('第 12 段内容')
  })

  it('splits tall Markdown tables by rows and repeats the table header', () => {
    const rows = Array.from({ length: 18 }, (_, index) => (
      `<tr><td>命令 ${index + 1}</td><td>${'需要换行的用途说明'.repeat(4)}</td><td>${'本工作流中的使用方式'.repeat(3)}</td></tr>`
    )).join('')
    const html = `<table data-source-block="12"><thead><tr><th>命令</th><th>用途</th><th>怎么用</th></tr></thead><tbody>${rows}</tbody></table>`

    const pages = paginateForXhsCards(html, { title: '表格分页' })
    const documents = pages.map(parsePage)
    const tables = documents.flatMap(document => Array.from(document.querySelectorAll('table')))
    const renderedRows = tables.reduce((total, table) => total + table.querySelectorAll('tbody tr').length, 0)

    expect(pages.length).toBeGreaterThan(1)
    expect(renderedRows).toBe(18)
    expect(tables.every(table => table.querySelectorAll('thead tr').length === 1)).toBe(true)
    expect(tables.every(table => table.querySelectorAll('tbody tr').length <= 6)).toBe(true)
  })

  it('splits long fenced-code output by lines instead of clipping one protected block', () => {
    const lines = Array.from({ length: 48 }, (_, index) => `line-${String(index + 1).padStart(2, '0')} --value example`)
    const pages = paginateForXhsCards(`<pre data-source-block="9"><code class="language-bash">${lines.join('\n')}</code></pre>`, { title: '代码分页' })
    const renderedLines = pages
      .flatMap(page => Array.from(parsePage(page).querySelectorAll('pre')).flatMap(pre => (pre.textContent || '').split('\n')))
      .filter(Boolean)

    expect(pages.length).toBeGreaterThan(1)
    expect(renderedLines).toEqual(lines)
    expect(pages.every(page => Array.from(parsePage(page).querySelectorAll('pre')).every(pre => (pre.textContent || '').split('\n').length <= 12))).toBe(true)
  })

  it('splits a long blockquote into safe fragments without losing its paragraphs', () => {
    const paragraphs = Array.from({ length: 14 }, (_, index) => (
      `<p>第 ${index + 1} 条镜头说明：${'画面中的文字和布局需要保持清晰。'.repeat(3)}</p>`
    )).join('')
    const pages = paginateForXhsCards(`<blockquote data-source-block="4">${paragraphs}</blockquote>`, { title: '引用分页' })
    const renderedText = pages.map(page => parsePage(page).body.textContent || '').join('')

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.flatMap(page => Array.from(parsePage(page).querySelectorAll('blockquote'))).length).toBeGreaterThan(1)
    for (let index = 1; index <= 14; index += 1) expect(renderedText).toContain(`第 ${index} 条镜头说明`)
  })

  it('uses rendered page measurements to backfill protected table fragments', () => {
    const rows = Array.from({ length: 18 }, (_, index) => (
      `<tr><td>命令 ${index + 1}</td><td>${'真实渲染后只占较少高度'.repeat(3)}</td><td>使用说明</td></tr>`
    )).join('')
    const html = `<table><thead><tr><th>命令</th><th>用途</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`
    const estimatedPages = paginateForXhsCards(html, { title: '表格密度' })
    const measuredPages = paginateForXhsCards(html, { title: '表格密度' }, pageHtml => {
      const document = parsePage(pageHtml)
      const bodyRows = document.querySelectorAll('tbody tr').length
      const tables = document.querySelectorAll('table').length
      return bodyRows * 38 + tables * 34 <= 560
    })
    const renderedRows = measuredPages.reduce(
      (total, page) => total + parsePage(page).querySelectorAll('tbody tr').length,
      0,
    )

    expect(measuredPages.length).toBeLessThan(estimatedPages.length)
    expect(renderedRows).toBe(18)
    expect(measuredPages.some(page => parsePage(page).querySelectorAll('table').length > 1)).toBe(true)
  })

  it('keeps the estimator as a deterministic fallback when no page measurer is supplied', () => {
    const html = Array.from({ length: 10 }, (_, index) => (
      `<p>第 ${index + 1} 段：${'回退分页必须保持稳定。'.repeat(6)}</p>`
    )).join('')

    expect(paginateForXhsCards(html, { title: '回退验证' }))
      .toEqual(paginateForXhsCards(html, { title: '回退验证' }))
  })
})
