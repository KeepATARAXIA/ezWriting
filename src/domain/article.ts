export type SourceKind = 'blank' | 'markdown' | 'html' | 'zip'
export type ArticleSourceLanguage = 'markdown' | 'html'

export interface ArticleDraft {
  id: string
  title: string
  html: string
  markdown?: string
  sourceText?: string
  sourceLanguage?: ArticleSourceLanguage
  summary?: string
  tags: string[]
  sourceFile: string
  sourceKind: SourceKind
  importedAt: string
  warnings: string[]
  missingAssets?: string[]
}

export type MissingImageAction = 'relink' | 'replace' | 'delete'

export interface MissingImageTarget {
  id: string
  reference: string
}

export interface PlatformAccount {
  id: string
  name: string
  username?: string
  icon?: string
  homepage?: string
  raw: unknown
}

export type PublishStatus = 'pending' | 'uploading' | 'done' | 'failed'

export interface PublishResult {
  platform: string
  name: string
  status: PublishStatus
  delivery: 'draft' | 'download'
  message?: string
  error?: string
  draftUrl?: string
  helpUrl?: string
  helpLabel?: string
  requiresManualVerification?: boolean
}
