import { memo } from 'react'
import type { WechatThemeId } from '../lib/wechat-theme'
import './wechat-theme-preview.css'

const PREVIEW_IMAGES = import.meta.glob<string>('../assets/wechat-themes/*.jpg', { eager: true, query: '?url', import: 'default' })

export const WechatThemePreview = memo(function WechatThemePreview({ themeId }: { themeId: WechatThemeId }) {
  return <div className="wechat-theme-specimen" data-preview-theme={themeId} aria-hidden="true">
    <img data-preview-part="image" src={PREVIEW_IMAGES[`../assets/wechat-themes/${themeId}.jpg`]} alt="" width={600} height={400} loading="lazy" decoding="async" />
  </div>
})
