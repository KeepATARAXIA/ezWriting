export const IMAGE_FRAME_OPTIONS = [
  { value: 'theme', label: '跟随主题' },
  { value: 'none', label: '无边框' },
  { value: 'rounded', label: '圆角' },
  { value: 'white', label: '圆角白边' },
  { value: 'shadow', label: '投影' },
  { value: 'outline', label: '相框' },
] as const

export type ImageFrame = typeof IMAGE_FRAME_OPTIONS[number]['value']

export function normalizeImageFrame(value: unknown): ImageFrame {
  return IMAGE_FRAME_OPTIONS.find(option => option.value === value)?.value ?? 'theme'
}

// Use the same inline styles for the picker, article preview, and exported HTML.
export function imageFrameStyle(frame: ImageFrame): Partial<CSSStyleDeclaration> {
  if (frame === 'theme') return {}
  const base = { border: '0', borderRadius: '0', padding: '0', boxShadow: 'none', outline: 'none', backgroundColor: 'transparent' }
  switch (frame) {
    case 'rounded': return { ...base, borderRadius: '12px' }
    case 'white': return { ...base, border: '6px solid #ffffff', borderRadius: '16px', boxShadow: '0 0 0 1px #e3e7ed, 0 3px 10px rgba(24, 39, 60, 0.08)' }
    case 'shadow': return { ...base, borderRadius: '12px', boxShadow: '0 3px 14px rgba(24, 39, 60, 0.20)' }
    case 'outline': return { ...base, border: '1px solid #ccd3dd', borderRadius: '8px', padding: '5px', backgroundColor: '#ffffff' }
    default: return base
  }
}
