import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDownToLine, BookmarkPlus, FileText, ImagePlus, Info, PanelLeftClose, Pencil, Plus, RotateCcw, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { newLibraryItem, type LibraryContent, type LibraryItem } from '../domain/template-library'
import { TemplateLibraryRepository } from '../services/template-library-repository'
import { prepareLibraryImages } from '../lib/template-library'
import { endLibraryDrag, startLibraryDrag } from '../lib/template-library-drag'
import './template-library.css'

interface Props {
  onClose: () => void
  onInsert: (item: LibraryItem) => void
  canInsert: boolean
  dismissGuardRef: RefObject<() => boolean>
  selection?: Extract<LibraryContent, { kind: 'text' }> | null
}

function LibraryImage({ item }: { item: Extract<LibraryItem, { kind: 'image' }> }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(item.blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [item.blob])
  return url ? <img src={url} alt={item.title} loading="lazy" draggable={false} /> : null
}

export function TemplateLibrary({ onClose, onInsert, canInsert, selection, dismissGuardRef }: Props) {
  const [repository] = useState(() => new TemplateLibraryRepository())
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<'all' | 'image' | 'text'>(selection ? 'text' : 'all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const createMenu = useRef<HTMLDetailsElement>(null)
  const filterMenu = useRef<HTMLDetailsElement>(null)
  const [editing, setEditing] = useState<LibraryItem | null>(() => selection ? {
    ...newLibraryItem(selection), title: selection.content.replace(/\s+/g, ' ').slice(0, 24),
  } : null)
  const [dirty, setDirty] = useState(Boolean(selection))
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadCategory, setUploadCategory] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const formOpen = Boolean(editing || uploadFiles.length)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!selection) return
    setEditing({ ...newLibraryItem(selection), title: selection.content.replace(/\s+/g, ' ').slice(0, 24) })
    setUploadFiles([]); setDirty(true); setFilter('text'); setError(''); setNotice('')
  }, [selection])

  useEffect(() => {
    dismissGuardRef.current = () => !busyRef.current && (!dirty || window.confirm('放弃尚未保存的素材修改？'))
    return () => { dismissGuardRef.current = () => true }
  }, [dirty, dismissGuardRef])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      const menu = [createMenu.current, filterMenu.current].find(menu => menu?.open)
      if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); return }
      onCloseRef.current()
    }
    const closeMenus = (event: PointerEvent) => {
      for (const menu of [createMenu.current, filterMenu.current]) {
        if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false
      }
    }
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', closeMenus)
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', closeMenus); endLibraryDrag() }
  }, [])

  const refresh = async () => {
    setLoading(true)
    try { setItems(await repository.list()); setError('') }
    catch (error) { setError((error as Error).message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    mounted.current = true
    void repository.list().then(next => { if (mounted.current) setItems(next) })
      .catch(error => { if (mounted.current) setError((error as Error).message) })
      .finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false }
  }, [repository])

  const closeForm = () => {
    if (busyRef.current || (dirty && !window.confirm('放弃尚未保存的素材修改？'))) return
    setEditing(null); setUploadFiles([]); setDirty(false); setError('')
  }
  const run = async (action: () => Promise<void>, success: string) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    let written = false
    try {
      await action()
      written = true
      if (!mounted.current) return
      setEditing(null); setUploadFiles([]); setDeleteTarget(null); setDirty(false)
      setItems(await repository.list())
      setNotice(success)
      setQuery(''); setCategory('all')
    } catch (error) {
      if (mounted.current) setError(`${written ? '已保存，但列表刷新失败；请刷新列表。' : ''}${(error as Error).message}`)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const categories = [...new Set(items.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const filtered = items.filter(item => (filter === 'all' || item.kind === filter)
    && (category === 'all' || `category:${item.category}` === category)
    && `${item.title}\n${item.category}\n${item.kind === 'text' ? item.content : ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh-CN') : b.updatedAt.localeCompare(a.updatedAt))

  return <aside className="template-library-sidebar" id="template-library-sidebar" aria-labelledby="template-library-heading">
    <header className="library-sidebar-heading"><h2 id="template-library-heading" aria-label="模板素材库">素材库</h2><span tabIndex={0} className="library-help" aria-label="拖动素材到正文，或点击添加按钮。素材仅保存在当前浏览器，稿件备份不包含素材库。" title="拖动素材到正文，或点击添加按钮。素材仅保存在当前浏览器，稿件备份不包含素材库。"><Info size={15} /></span><button type="button" className="icon-button" aria-label="关闭模板素材库" title="收起模板素材库" onClick={onClose}><PanelLeftClose size={19} /></button></header>
    <div className="template-library" aria-busy={busy || loading}>
      {error && <p className="library-error" role="alert">{error}</p>}
      {notice && <p className="library-notice" role="status">{notice}</p>}
      {formOpen ? <form className="library-form" onSubmit={event => {
        event.preventDefault()
        if (editing) void run(() => repository.save([editing]), '素材已保存')
        else void run(async () => {
          const blobs = await prepareLibraryImages(uploadFiles)
          await repository.save(blobs.map((blob, index) => ({ ...newLibraryItem({ kind: 'image', blob }), title: uploadFiles[index].name.slice(0, 120), category: uploadCategory })))
          setFilter('image')
        }, `已收藏 ${uploadFiles.length} 张图片`)
      }}>
        <div className="library-form-heading"><h3>{editing ? editing.revision ? '编辑素材' : selection ? '收藏选中内容' : '新建文字模板' : `上传 ${uploadFiles.length} 张图片`}</h3><button type="button" disabled={busy} onClick={closeForm}>返回素材库</button></div>
        <fieldset disabled={busy}>
          {editing && <label>素材名称<input autoFocus required maxLength={120} value={editing.title} onChange={event => { setEditing({ ...editing, title: event.target.value }); setDirty(true) }} /></label>}
          <label>分类<input aria-label="素材分类" list="library-categories" maxLength={40} placeholder="输入新分类，或选择已有分类" value={editing ? editing.category : uploadCategory} onChange={event => { if (editing) setEditing({ ...editing, category: event.target.value }); else setUploadCategory(event.target.value); setDirty(true) }} /></label>
          <datalist id="library-categories">{categories.map(name => <option key={name} value={name} />)}</datalist>
          {editing?.kind === 'text' && <>
            <label className="library-language">内容格式<select value={editing.language} onChange={event => { setEditing({ ...editing, language: event.target.value as 'markdown' | 'html' }); setDirty(true) }}><option value="markdown">Markdown</option><option value="html">HTML</option></select></label>
            <label>模板内容<textarea aria-label="模板内容" required maxLength={64_000} rows={10} value={editing.content} placeholder="写下常用语句，或用标题、列表组织一个完整模板…" onChange={event => { setEditing({ ...editing, content: event.target.value }); setDirty(true) }} /></label>
          </>}
          {editing?.kind === 'image' && <div className="library-image-edit"><LibraryImage item={editing} /></div>}
          {uploadFiles.length > 0 && <><ul className="library-upload-files">{uploadFiles.map((file, index) => <li key={index}>{file.name}<span>{(file.size / 1048576).toFixed(2)} MB</span></li>)}</ul><p className="library-hint">支持 PNG、JPG、GIF、WebP、SVG，单张不超过 8 MB；每批最多 30 MB。</p></>}
          <div className="library-form-actions"><button type="button" onClick={closeForm}>取消</button><button className="primary-button" type="submit">{busy ? '正在保存…' : '保存到素材库'}</button></div>
        </fieldset>
      </form> : <>
        <div className="library-toolbar">
          <div className="library-kind-filter" role="group" aria-label="素材类型">{(['all', 'image', 'text'] as const).map(kind => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{({ all: '全部', image: '图片', text: '文字模板' })[kind]}<small>{items.filter(item => kind === 'all' || item.kind === kind).length}</small></button>)}</div>
        </div>
        <label className="library-search"><Search size={16} /><input aria-label="搜索素材" placeholder="搜索素材" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="library-controls">
          <details className="library-create-actions" ref={createMenu}>
            <summary><Plus size={16} />新建素材</summary>
            <div className="library-menu" onClick={() => { if (createMenu.current) createMenu.current.open = false }}>
            <button type="button" disabled={busy || loading} onClick={() => fileInput.current?.click()}><ImagePlus size={16} />上传图片</button>
            <button type="button" disabled={busy || loading} onClick={() => { setEditing(newLibraryItem({ kind: 'text', content: '', language: 'markdown' })); setDirty(false); setError(''); setNotice(''); setFilter('text') }}><FileText size={16} />新建文字模板</button>
            </div>
          </details>
          <details className="library-filter-menu" ref={filterMenu}><summary title="分类与排序"><SlidersHorizontal size={15} />筛选{category !== 'all' && <span className="library-filter-dot" />}</summary><div className="library-menu">
            <label>分类<select aria-label="筛选素材分类" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部分类</option><option value="category:">未分类</option>{categories.map(name => <option key={name} value={`category:${name}`}>{name}</option>)}</select></label>
            <label>排序<select aria-label="素材排序" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">最近更新</option><option value="name">名称顺序</option></select></label>
            <button type="button" disabled={busy || loading} onClick={() => void refresh()}><RotateCcw size={15} />刷新素材库</button>
          </div></details>
        </div>
        {loading ? <p className="library-empty" role="status">正在读取素材…</p> : filtered.length ? <div className="library-grid">
          {filtered.map(item => <article className={`library-card ${item.kind}`} key={item.id}>
            <div className="library-card-preview" draggable={canInsert && !busy} title={canInsert ? '拖到正文中的目标位置' : undefined} onDragStart={event => { if (!canInsert || busy) { event.preventDefault(); return }; startLibraryDrag(item, event.dataTransfer) }} onDragEnd={endLibraryDrag}>{item.kind === 'image' ? <LibraryImage item={item} /> : <p>{item.content}</p>}{item.kind === 'image' && item.blob.type === 'image/gif' && <span className="library-gif-label">GIF</span>}</div>
            <div className="library-card-copy"><strong title={item.title}>{item.title}</strong><small>{item.kind === 'text' ? '文字模板' : item.blob.type === 'image/gif' ? 'GIF 图片' : '图片'} · {item.category || '未分类'}</small></div>
            {deleteTarget?.id === item.id ? <div className="library-delete-confirm"><p>删除这项素材？已插入的稿件不受影响。</p><button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button><button type="button" disabled={busy} onClick={() => void run(() => repository.remove(item), '素材已删除')}>确认删除</button></div> : <div className="library-card-actions">
              <button type="button" disabled={!canInsert || busy} title={canInsert ? '添加到正文光标处，选中内容会被替换' : '先打开一篇稿件，再添加素材'} aria-label={`添加到编辑器：${item.title}`} onMouseDown={event => event.preventDefault()} onClick={() => onInsert(item)}><ArrowDownToLine size={15} /></button>
              <button type="button" disabled={busy} aria-label={`编辑素材：${item.title}`} title="编辑名称、分类与内容" onClick={() => { setEditing(item); setDirty(false); setNotice(''); setError('') }}><Pencil size={15} /></button>
              <button type="button" disabled={busy} aria-label={`删除素材：${item.title}`} title="删除素材" onClick={() => setDeleteTarget(item)}><Trash2 size={15} /></button>
            </div>}
          </article>)}
        </div> : <div className="library-empty"><BookmarkPlus size={30} /><strong>{items.length ? '没有找到匹配的素材' : '把常用内容放在这里'}</strong><p>{items.length ? '试试其他关键词或分类。' : '上传图片，或新建文字模板。也可以在正文中选中文字，再点击「收藏到模板库」。'}</p></div>}
        {!canInsert && items.length > 0 && <p className="library-hint">打开一篇稿件后，可将素材插入正文。</p>}
      </>}
      <input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg" multiple hidden onChange={event => {
        const files = Array.from(event.target.files || [])
        event.target.value = ''
        if (!files.length) return
        setUploadFiles(files); setUploadCategory(category.startsWith('category:') ? category.slice(9) : ''); setDirty(true); setError(''); setNotice('')
      }} />
    </div>
  </aside>
}
