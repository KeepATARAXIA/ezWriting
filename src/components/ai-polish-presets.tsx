import { Plus, Trash2 } from 'lucide-react'
import { DEFAULT_POLISH_PRESETS, POLISH_PRESET_LIMIT, type PolishPreset } from '../lib/ai-polish'
import './ai-polish-presets.css'

export function AiPolishPresets({ locked, presets, onChange: update }: { locked: boolean; presets: PolishPreset[]; onChange: (presets: PolishPreset[]) => void }) {
  function change(index: number, patch: Partial<PolishPreset>) {
    update(presets.map((preset, i) => i === index ? { ...preset, ...patch } : preset))
  }
  return <section className="ai-preset-settings ai-preset-manager" id="ai-preset-manager" aria-label="管理方案">
    <fieldset disabled={locked}>
      <p className="ai-preset-hint">编辑名称和提示词，或新增自己的方案。</p>
      {presets.map((preset, index) => <div className="ai-preset-row" key={index}>
        <div className="ai-preset-name">{preset.name || '未命名方案'}</div>
        <details className="ai-preset-edit"><summary>编辑方案</summary>
          <label>方案名称<input aria-label={`方案 ${index + 1} 名称`} maxLength={24} value={preset.name} onChange={event => change(index, { name: event.target.value })} /></label>
          <label>提示词<textarea aria-label={`方案 ${index + 1} 提示词`} rows={4} maxLength={600} value={preset.instruction} onChange={event => change(index, { instruction: event.target.value })} /></label>
          <div className="ai-preset-edit-footer"><span>{preset.instruction.length}/600 · 保留事实、原意和链接</span>
            {index < 3 ? <button type="button" className="ai-text-button" onClick={() => change(index, { ...DEFAULT_POLISH_PRESETS[index] })}>恢复默认</button>
              : <button type="button" className="ai-text-button" onClick={() => update(presets.filter((_, i) => i !== index))}><Trash2 size={13} />删除方案</button>}
          </div>
        </details>
      </div>)}
      <div className="ai-preset-footer"><button type="button" className="ai-text-button" disabled={presets.length >= POLISH_PRESET_LIMIT} onClick={() => update([...presets, { name: '自定义方案', instruction: '保留作者语气，删去模板化套话，让表达自然、直接。', strength: 20, enabled: true }])}><Plus size={14} />添加自定义方案</button><span>本机自动保存 · 最多 6 个</span></div>
    </fieldset>
  </section>
}
