import { lazy, Suspense, useState, type RefObject } from 'react'
import { Download, FileDown, FilePlus2, FileUp, FolderOpen, HardDrive, LoaderCircle } from 'lucide-react'
import type { AiSession } from '../domain/ai'
import { readAiSettings, saveAiSettings } from '../lib/ai-settings'
import type { AiSelection } from '../lib/ai-polish'
import type { LibraryContent, LibraryItem } from '../domain/template-library'
import { WorkbenchDialog } from './workbench-dialog'
import { AiPolishDialog } from './ai-polish-dialog'
import type { WorkbenchPanel } from './workbench-navigation'
import type { WorkspaceMode } from '../lib/workbench-preferences'

const TemplateLibrary = lazy(() => import('./template-library').then(module => ({ default: module.TemplateLibrary })))
const AiSidebar = lazy(() => import('./ai-sidebar').then(module => ({ default: module.AiSidebar })))

interface Props {
  panel: WorkbenchPanel
  onClose: () => void
  onBlank: () => void
  onFile: () => void
  onDirectory: () => void
  locked: boolean
  syncScroll: boolean
  onSyncScroll: (value: boolean) => void
  showSyntax: boolean
  onShowSyntax: (value: boolean) => void
  editorRowStripes: boolean
  onEditorRowStripes: (value: boolean) => void
  defaultWorkspace: WorkspaceMode
  onDefaultWorkspace: (value: WorkspaceMode) => void
  onResetLayout: () => void
  draftCount: number
  storagePersistent: boolean | null
  hasRepository: boolean
  backupStatus: 'idle' | 'exporting' | 'importing'
  backupProgress: string | null
  onCancelBackup: () => void
  onExportBackup: () => void
  onImportBackup: () => void
  onExportDiagnostics: () => void
  librarySelection?: Extract<LibraryContent, { kind: 'text' }> | null
  libraryDismissGuardRef: RefObject<() => boolean>
  canInsertLibraryItem?: boolean
  onInsertLibraryItem: (item: LibraryItem) => void
  aiSelection?: AiSelection | null
  onConfigureAi: () => void
}

export function WorkbenchPanels(props: Props) {
  const [aiSession, setAiSession] = useState(readAiSettings)
  const [aiStorageError, setAiStorageError] = useState(false)
  function changeAiSession(session: AiSession) {
    setAiSession(session)
    setAiStorageError(!saveAiSettings(session))
  }
  const { panel } = props
  if (!panel) return null
  if (panel === 'polish') return props.aiSelection ? <AiPolishDialog key={props.aiSelection.id} session={aiSession} onChange={changeAiSession} storageError={aiStorageError} locked={props.locked} selection={props.aiSelection} onClose={props.onClose} onConfigure={props.onConfigureAi} /> : null
  if (panel === 'ai') return <Suspense fallback={<aside className="ai-sidebar" aria-label="AI 工具"><p role="status">正在打开 AI 工具…</p></aside>}><AiSidebar session={aiSession} onChange={changeAiSession} storageError={aiStorageError} locked={props.locked} onClose={props.onClose} /></Suspense>
  if (panel === 'library') return <Suspense fallback={<aside className="template-library-sidebar" aria-label="模板素材库"><p role="status">正在打开素材库…</p><button type="button" onClick={props.onClose}>关闭模板素材库</button></aside>}><TemplateLibrary dismissGuardRef={props.libraryDismissGuardRef} onClose={props.onClose} selection={props.librarySelection} canInsert={Boolean(props.canInsertLibraryItem) && !props.locked} onInsert={props.onInsertLibraryItem} /></Suspense>
  const backupLocked = props.locked || props.backupStatus !== 'idle' || !props.hasRepository
  const title = { new: '新建文档', settings: '设置', library: '模板素材库', ai: 'AI 工具' }[panel]
  return <WorkbenchDialog key={panel} title={title} onClose={props.onClose}>
    {panel === 'new' && <>
      <p className="dialog-intro">从空白开始，或导入已有内容继续编辑。</p>
      <div className="new-document-options">
        <button type="button" aria-label="空白文档" disabled={props.locked} onClick={props.onBlank}><FilePlus2 size={25} /><strong>空白文档</strong><span>写下标题，开始创作</span></button>
        <button type="button" aria-label="导入文件" disabled={props.locked} onClick={props.onFile}><FileUp size={25} /><strong>导入文件</strong><span>Markdown、HTML、ZIP</span></button>
      </div>
      <button type="button" className="directory-link new-directory" disabled={props.locked} onClick={props.onDirectory}><FolderOpen size={16} />导入文章文件夹</button>
      <p className="dialog-footnote">导入会创建独立稿件，当前稿件自动保存。</p>
    </>}
    {panel === 'settings' && <div className="workbench-settings">
      <section><h3>编辑习惯</h3>
        <label className="setting-row"><span><strong>正文隔行底色</strong><small>按手动回车交替底色，自动折行保持整块</small></span><input type="checkbox" role="switch" aria-label="正文隔行底色" checked={props.editorRowStripes} onChange={event => props.onEditorRowStripes(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>左右同步定位</strong><small>滚动或点击任一侧，另一侧同步到对应内容</small></span><input type="checkbox" role="switch" aria-label="左右同步定位" checked={props.syncScroll} onChange={event => props.onSyncScroll(event.target.checked)} /></label>
        <label className="setting-row"><span><strong>显示 Markdown 语法</strong><small>应用于当前和之后打开的文档</small></span><input type="checkbox" role="switch" aria-label="显示 Markdown 语法" checked={props.showSyntax} onChange={event => props.onShowSyntax(event.target.checked)} /></label>
      </section>
      <section><h3>工作区</h3>
        <label className="setting-row"><span><strong>默认显示方式</strong><small>在下次打开或新建稿件时使用</small></span><select aria-label="默认显示方式" value={props.defaultWorkspace} onChange={event => props.onDefaultWorkspace(event.target.value as WorkspaceMode)}><option value="editor">编辑</option><option value="split">双栏</option><option value="preview">预览</option></select></label>
        <button type="button" className="settings-text-button" onClick={props.onResetLayout}>恢复默认分栏比例</button>
      </section>
      <section><h3>本地数据</h3>
        <p className="settings-storage"><HardDrive size={19} /><span>{props.draftCount} 篇稿件 · 当前浏览器<br /><small>{!props.hasRepository ? '本地存储暂不可用' : props.storagePersistent ? '已启用持久化存储' : '清理网站数据前，请先导出备份'}</small></span></p>
        <div className="history-backup-actions">
          <button type="button" disabled={backupLocked} onClick={props.onExportBackup}>{props.backupStatus === 'exporting' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}导出备份</button>
          <button type="button" disabled={backupLocked} onClick={props.onImportBackup}><FileUp size={16} />导入备份</button>
          <button type="button" disabled={props.locked} onClick={props.onExportDiagnostics}><FileDown size={16} />导出诊断报告</button>
        </div>
        {props.backupProgress && <p role="status">{props.backupProgress}<button type="button" onClick={props.onCancelBackup}>取消备份操作</button></p>}
      </section>
    </div>}
  </WorkbenchDialog>
}
