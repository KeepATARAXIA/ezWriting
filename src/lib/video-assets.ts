export const SUPPORTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const
export const VIDEO_FILE_ACCEPT = '.mp4,.webm,video/mp4,video/webm'
export const MAX_LOCAL_VIDEO_BYTES = 50 * 1024 * 1024

const STORAGE_RESERVE_BYTES = 5 * 1024 * 1024

export type SupportedVideoMimeType = typeof SUPPORTED_VIDEO_MIME_TYPES[number]

function mimeTypeFromName(name: string): SupportedVideoMimeType | null {
  if (/\.mp4$/i.test(name)) return 'video/mp4'
  if (/\.webm$/i.test(name)) return 'video/webm'
  return null
}

export function supportedVideoMimeType(file: Pick<File, 'name' | 'type'>): SupportedVideoMimeType | null {
  const declared = file.type.toLocaleLowerCase()
  if ((SUPPORTED_VIDEO_MIME_TYPES as readonly string[]).includes(declared)) {
    return declared as SupportedVideoMimeType
  }
  return mimeTypeFromName(file.name)
}

export function supportedVideoDataMimeType(value: string | null | undefined): SupportedVideoMimeType | null {
  if (!value) return null
  const match = value.slice(0, 80).match(/^data:(video\/(?:mp4|webm));base64,/i)
  return match ? match[1].toLocaleLowerCase() as SupportedVideoMimeType : null
}

export function isSupportedVideoDataUri(value: string | null | undefined): value is string {
  return supportedVideoDataMimeType(value) !== null
}

export function localVideoFileName(name: string): string {
  const normalized = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (normalized || '本地视频').slice(0, 180)
}

export async function validateLocalVideoFile(
  file: File,
  storage: Pick<StorageManager, 'estimate'> | undefined = globalThis.navigator?.storage,
): Promise<SupportedVideoMimeType> {
  const mimeType = supportedVideoMimeType(file)
  if (!mimeType) throw new Error('仅支持 MP4 或 WebM 视频。')
  if (file.size === 0) throw new Error('视频文件为空，请重新选择。')
  if (file.size > MAX_LOCAL_VIDEO_BYTES) throw new Error('单个视频不能超过 50 MiB。')

  if (storage?.estimate) {
    try {
      const estimate = await storage.estimate()
      const quota = estimate.quota
      const usage = estimate.usage ?? 0
      if (typeof quota === 'number' && Number.isFinite(quota) && quota - usage < file.size + STORAGE_RESERVE_BYTES) {
        throw new Error('浏览器本地存储空间不足，请清理旧稿件或选择更小的视频。')
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('本地存储空间不足')) throw error
      // Storage estimates are advisory and may be unavailable in privacy modes.
    }
  }

  return mimeType
}
