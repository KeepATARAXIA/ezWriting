import { beforeEach, describe, expect, it } from 'vitest'
import type { ImportDiagnostic } from '../lib/file-parser'
import {
  RELIABILITY_DIAGNOSTICS_STORAGE_KEY,
  createReliabilityReport,
  recordImportDiagnostic,
  reliabilityReportFileName,
  serializeReliabilityReport,
} from './local-diagnostics'

function diagnostic(index: number): ImportDiagnostic {
  return {
    version: 1,
    recordedAt: `2026-08-20T00:00:${String(index).padStart(2, '0')}.000Z`,
    outcome: 'success',
    operation: 'initial',
    source: {
      kind: 'markdown',
      bytes: 100 + index,
      relatedFileCount: 0,
      relatedBytes: 0,
      relatedImageCount: 0,
    },
    totalMs: 12.5,
    stageMs: { read: 1.2, render: 8.4 },
    warningCount: 0,
    missingAssetCount: 0,
  }
}

describe('local reliability diagnostics', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps only the ten most recent import measurements', () => {
    for (let index = 0; index < 12; index += 1) recordImportDiagnostic(diagnostic(index), window.localStorage)

    const stored = JSON.parse(window.localStorage.getItem(RELIABILITY_DIAGNOSTICS_STORAGE_KEY) || '{}')
    expect(stored.imports).toHaveLength(10)
    expect(stored.imports[0].source.bytes).toBe(102)
    expect(stored.imports[9].source.bytes).toBe(111)
  })

  it('creates a support report without article, file, or account data', async () => {
    recordImportDiagnostic(diagnostic(1), window.localStorage)
    const report = createReliabilityReport({
      bridgeState: 'missing',
      draftCount: 3,
      storagePersistent: true,
      storage: window.localStorage,
      userAgent: 'Reliability Browser',
      language: 'zh-CN',
      online: false,
      generatedAt: new Date('2026-08-20T08:00:00.000Z'),
    })
    const serialized = await serializeReliabilityReport(report).text()

    expect(report.recentImports).toHaveLength(1)
    expect(report.privacy).toEqual({
      includesArticleContent: false,
      includesFileNames: false,
      includesAccountDetails: false,
    })
    expect(serialized).not.toContain('sourceFile')
    expect(serialized).not.toContain('title')
    expect(serialized).not.toContain('accounts')
  })

  it('uses a filesystem-safe timestamp in the report name', () => {
    expect(reliabilityReportFileName(new Date('2026-08-20T08:09:10.123Z')))
      .toBe('ezwriting-diagnostics-2026-08-20T08-09-10-123Z.json')
  })
})
