import { useEffect, useMemo, useRef, useState } from 'react'
import { isGifSource, mediaPlaceholder, mountGifPreview, observeStaticPreviewMedia } from '../lib/media-preview'

export function ResourceImage({ src, alt, video = false, onError }: { src: string; alt: string; video?: boolean; onError?: () => void }) {
  const image = useRef<HTMLImageElement>(null)
  const frame = useRef<HTMLSpanElement>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const previewSource = useMemo(() => video || isGifSource(src) ? mediaPlaceholder(src) : src, [src, video])
  useEffect(() => {
    if (video && frame.current) return observeStaticPreviewMedia(frame.current)
    if (image.current && isGifSource(src)) return mountGifPreview(image.current, src)
  }, [src, video])
  return <span ref={frame} className="resource-image-frame">
    {failedSource === src ? <span className="resource-missing-thumbnail">图片加载失败</span> : <img ref={image} src={previewSource} data-ez-video-source={video ? src : undefined} alt={alt} loading="lazy" decoding="async" onError={() => { setFailedSource(src); onError?.() }} />}
    {video && <span className="resource-type-badge">视频</span>}
  </span>
}
