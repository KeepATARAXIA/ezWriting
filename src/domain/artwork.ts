export const IMAGE_TIMEOUT_MS = 600_000
export interface CoverImage { source: string; title: string; width: number; height: number }
export interface IllustrationTarget { text: string; insert: (source: string, description: string) => string | undefined }
export interface ArtworkEditor { capture: () => IllustrationTarget }
export interface ImageStyle { id: string; name: string; prompt: string }
export const IMAGE_STYLES: ImageStyle[] = [
  { id: 'flat', name: '浅色扁平色块', prompt: '白色或冷浅灰基底，大面积留白，现代扁平二维几何色块，钴蓝作为高饱和焦点色，构图清晰，有秩序。' },
  { id: 'photo', name: '写实摄影', prompt: '真实摄影质感，自然光，明确主体，克制的背景，可信的材质与细节。' },
  { id: 'editorial', name: '编辑插画', prompt: '现代杂志编辑插画，概念表达清晰，简洁线条与几何图形，有限色板，留白充足。' },
  { id: 'poster', name: '极简字体海报', prompt: '极简海报，严格网格，大字号无衬线排版，文字与几何色块结合，明确的信息层级。' },
  { id: '3d', name: '轻量 3D', prompt: '轻量三维插画，简洁几何形体，柔和材质和漫射光，浅色背景，轻盈的现代构图。' },
]
export const IMAGE_SIZES = [
  { name: '横图 16:9', width: 1536, height: 864 }, { name: '横图 4:3', width: 1536, height: 1152 },
  { name: '竖图 3:4', width: 1152, height: 1536 }, { name: '方图 1:1', width: 1024, height: 1024 },
  { name: '宽封面 2.35:1', width: 1880, height: 800 },
]
export function validImageSize(width: number, height: number) {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 256 && height >= 256 && width <= 4096 && height <= 4096 && width * height <= 8_388_608
}
export function readCoverImage(value: unknown): CoverImage | undefined {
  const item = value as CoverImage | null
  if (!item || typeof item.source !== 'string' || item.source.length > 28_000_000 || typeof item.title !== 'string'
    || !validImageSize(item.width, item.height) || !/^(?:data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*|dispatch-asset:\/\/[a-z0-9-]+)$/.test(item.source)) return undefined
  return { source: item.source, title: item.title.slice(0, 300), width: item.width, height: item.height }
}
