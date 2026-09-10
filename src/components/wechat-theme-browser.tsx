import { useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { getWechatThemeCategory, WECHAT_THEME_CATEGORIES, WECHAT_THEMES, type WechatThemeCategory, type WechatThemeId } from '../lib/wechat-theme'
import { WechatThemePreview } from './wechat-theme-preview'

const RECENT_KEY = 'dispatch.wechat-recent-themes.v1'
const RECOMMENDED: WechatThemeId[] = ['white-cube', 'mobai', 'klein', 'literary']

function readRecentThemes(): WechatThemeId[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is WechatThemeId => WECHAT_THEMES.some(theme => theme.id === id)))].slice(0, 6) : []
  } catch { return [] }
}

export function WechatThemeBrowser({ search, selected, onSelect }: {
  search: string
  selected: WechatThemeId
  onSelect: (id: WechatThemeId) => void
}) {
  const [category, setCategory] = useState<WechatThemeCategory>('全部')
  const [showAll, setShowAll] = useState(false)
  const [recent, setRecent] = useState(readRecentThemes)
  const scroll = useRef<HTMLDivElement>(null)
  const categories = useRef<HTMLDivElement>(null)
  const query = search.trim().toLocaleLowerCase()
  const isRecommended = !query && category === '全部' && !showAll
  const visible = isRecommended
    ? RECOMMENDED.map(id => WECHAT_THEMES.find(theme => theme.id === id)!)
    : WECHAT_THEMES.filter(theme => (category === '全部' || getWechatThemeCategory(theme.id) === category)
      && `${theme.name} ${theme.tag} ${getWechatThemeCategory(theme.id)}`.toLocaleLowerCase().includes(query))
  const saveRecent = (ids: WechatThemeId[]) => {
    setRecent(ids)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)) } catch { /* Keep the current session usable when storage is unavailable. */ }
  }
  const select = (id: WechatThemeId) => {
    onSelect(id)
    saveRecent([id, ...recent.filter(value => value !== id)].slice(0, 6))
  }
  const card = (theme: typeof WECHAT_THEMES[number]) => (
    <article className={`wechat-theme-card${selected === theme.id ? ' selected' : ''}`} key={theme.id}>
      <button type="button" className="wechat-theme-select-target" aria-label={`应用${theme.name}主题：${theme.description}`}
        aria-pressed={selected === theme.id} title={`${theme.name} · ${theme.description}`} onClick={() => select(theme.id)} />
      <WechatThemePreview themeId={theme.id} />
      <footer className="wechat-theme-card-copy">
        <strong>{theme.name}</strong>
        <span className="wechat-theme-tags"><small>{getWechatThemeCategory(theme.id)}</small><small>{theme.tag}</small></span>
      </footer>
      {selected === theme.id && <span className="wechat-theme-check"><Check size={14} aria-hidden="true" /></span>}
    </article>
  )
  return <section className="wechat-theme-layout" aria-label="公众号主题排版">
    <div className="wechat-category-row">
      <div ref={categories} className="wechat-theme-categories" role="tablist" aria-label="筛选公众号主题">
        {(['全部', ...WECHAT_THEME_CATEGORIES.filter(value => value !== '全部')] as WechatThemeCategory[]).map(value => <button
          type="button" role="tab" key={value} aria-selected={category === value} onClick={() => {
            setCategory(value)
            setShowAll(true)
            if (scroll.current) scroll.current.scrollTop = 0
          }}>{value}</button>)}
      </div>
      <button type="button" className="wechat-category-next" aria-label="向右查看主题分类" onClick={() => categories.current?.scrollBy({ left: 140, behavior: 'smooth' })}><ChevronRight size={16} /></button>
    </div>
    <div ref={scroll} className="wechat-theme-results">
      <section aria-label={isRecommended ? '推荐模板' : '主题筛选结果'}>
        <header className="wechat-gallery-heading"><strong>{isRecommended ? '推荐模板' : query ? `搜索结果 · ${visible.length}` : `${category}主题 · ${visible.length}`}</strong>
          {isRecommended && <button type="button" onClick={() => { setShowAll(true); if (scroll.current) scroll.current.scrollTop = 0 }}>查看全部<ChevronRight size={13} /></button>}
          {!isRecommended && !query && category === '全部' && <button type="button" onClick={() => { setShowAll(false); if (scroll.current) scroll.current.scrollTop = 0 }}>返回推荐</button>}
        </header>
        <div className="wechat-theme-grid">{visible.map(card)}</div>
        {visible.length === 0 && <p className="wechat-theme-empty" role="status">没有找到匹配的主题，试试其他名称或分类。</p>}
      </section>
      {isRecommended && <section className="wechat-recent-themes" aria-label="最近使用">
        <header className="wechat-gallery-heading"><strong>最近使用</strong>{recent.length > 0 && <button type="button" onClick={() => saveRecent([])}>清空记录</button>}</header>
        {recent.length > 0 ? <div className="wechat-theme-grid">{recent.map(id => card(WECHAT_THEMES.find(theme => theme.id === id)!))}</div>
          : <p className="wechat-theme-empty">选用的主题会显示在这里</p>}
      </section>}
    </div>
  </section>
}
