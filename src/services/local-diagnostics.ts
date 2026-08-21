import packageMetadata from '../../package.json'
import type { ImportDiagnostic } from '../lib/file-parser'

export const RELIABILITY_DIAGNOSTICS_STORAGE_KEY = 'ezwriting.reliability-diagnostics.v1'
export const RELIABILITY_REPORT_FORMAT = 'ezwriting-reliability-report'
const MAX_IMPORT_DIAGNOSTICS = 10

interface StoredDiagnostics {
  version: 1
  imports: ImportDiagnostic[]
}

export interface ReliabilityReportOptions {
  bridgeState: string
  draftCount: number
  storagePersistent: boolean | null
  storage?: Storage
  userAgent?: string
  language?: string
  online?: boolean
  generatedAt?: Date
}

export interface ReliabilityReport {
  format: typeof RELIABILITY_REPORT_FORMAT
  version: 1
  generatedAt: string
  application: {
    version: string
    storageMode: 'local-only'
    bridgeState: string
  }
  environment: {
    userAgent: string
    language: string
    online: boolean | null
  }
  localState: {
    draftCount: number
    storagePersistent: boolean | null
  }
  recentImports: ImportDiagnostic[]
  privacy: {
    includesArticleContent: false
    includesFileNames: false
    includesAccountDetails: false
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readStoredDiagnostics(storage: Storage | undefined): StoredDiagnostics {
  if (!storage) return { version: 1, imports: [] }
  try {
    const raw = JSON.parse(storage.getItem(RELIABILITY_DIAGNOSTICS_STORAGE_KEY) || '') as Partial<StoredDiagnostics>
    return raw.version === 1 && Array.isArray(raw.imports)
      ? { version: 1, imports: raw.imports.slice(-MAX_IMPORT_DIAGNOSTICS) as ImportDiagnostic[] }
      : { version: 1, imports: [] }
  } catch {
    return { version: 1, imports: [] }
  }
}

export function recordImportDiagnostic(diagnostic: ImportDiagnostic, storage = defaultStorage()): void {
  if (!storage) return
  try {
    const stored = readStoredDiagnostics(storage)
    stored.imports = [...stored.imports, diagnostic].slice(-MAX_IMPORT_DIAGNOSTICS)
    storage.setItem(RELIABILITY_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Imports continue normally if private mode or a storage quota blocks diagnostics.
  }
}

export function createReliabilityReport(options: ReliabilityReportOptions): ReliabilityReport {
  const storage = options.storage ?? defaultStorage()
  const browserNavigator = typeof navigator === 'undefined' ? undefined : navigator
  return {
    format: RELIABILITY_REPORT_FORMAT,
    version: 1,
    generatedAt: (options.generatedAt || new Date()).toISOString(),
    application: {
      version: packageMetadata.version,
      storageMode: 'local-only',
      bridgeState: options.bridgeState,
    },
    environment: {
      userAgent: options.userAgent ?? browserNavigator?.userAgent ?? 'unknown',
      language: options.language ?? browserNavigator?.language ?? 'unknown',
      online: options.online ?? browserNavigator?.onLine ?? null,
    },
    localState: {
      draftCount: Math.max(0, Math.floor(options.draftCount)),
      storagePersistent: options.storagePersistent,
    },
    recentImports: readStoredDiagnostics(storage).imports,
    privacy: {
      includesArticleContent: false,
      includesFileNames: false,
      includesAccountDetails: false,
    },
  }
}

export function serializeReliabilityReport(report: ReliabilityReport): Blob {
  return new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
}

export function reliabilityReportFileName(now = new Date()): string {
  return `ezwriting-diagnostics-${now.toISOString().replaceAll(/[:.]/g, '-')}.json`
}
