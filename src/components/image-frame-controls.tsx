import { Check } from 'lucide-react'
import { type CSSProperties } from 'react'
import { IMAGE_FRAME_OPTIONS, imageFrameStyle, type ImageFrame } from '../domain/image-frame'
import './image-frame-controls.css'

export function ImageFrameControls({ value, onChange }: { value: ImageFrame; onChange: (value: ImageFrame) => void }) {
  return (
    <section className="image-frame-controls" aria-label="图片边框设置">
      <strong>图片边框</strong>
      <div className="image-frame-options" role="group" aria-label="选择图片边框">
        {IMAGE_FRAME_OPTIONS.map(option => (
          <button type="button" key={option.value} aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}>
            <span className="image-frame-sample" aria-hidden="true">
              <span style={imageFrameStyle(option.value) as CSSProperties}>
                <svg viewBox="0 0 80 44" fill="none"><path fill="#e4ebf7" d="M0 0h80v44H0z" /><circle cx="60" cy="12" r="5" fill="#7998d0" /><path d="m0 44 25-29 20 20 12-12 23 21" fill="#a4b9dd" /></svg>
              </span>
            </span>
            <span className="image-frame-label">{option.label}{value === option.value && <Check size={12} aria-hidden="true" />}</span>
          </button>
        ))}
      </div>
      <p>统一调整正文图片，保留原图比例。</p>
    </section>
  )
}
