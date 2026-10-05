import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSourcingCsv, type SourcingImportOptions } from '../src/index.ts'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const options: SourcingImportOptions = {
  workspaceId: 'workspace-1',
  createdBy: 'toneclaw-operation',
  fileName: 'catalog.csv',
  fileRefDirectory: 'processed/batch-1',
  country: 'CN',
  ids: { next: (() => { let value = 0; return () => `id-${String(++value)}` })() },
  clock: { now: () => new Date('2026-10-05T08:00:00.000Z') },
}

describe('sourcing CSV import', () => {
  it('parses the minimal fixture, aggregates suppliers, and maps P0 fields', () => {
    const result = parseSourcingCsv(readFileSync(join(fixtureRoot, 'valid-minimal.csv')), options)
    expect(result.plan.batch.status).toBe('completed')
    expect(result.plan.batch.validRows).toBe(2)
    expect(result.plan.suppliers).toHaveLength(1)
    expect(result.plan.items[0]?.status).toBe('candidate')
    expect(result.plan.items[0]?.stockStatus).toBe('available')
    expect(result.plan.items[1]?.stockStatus).toBe('low')
    expect(result.plan.items[0]?.imageUrls).toHaveLength(2)
    expect(result.plan.media.filter(media => media.sourcingItemId === result.plan.items[0]?.id).map(media => media.purpose))
      .toEqual(['main', 'detail'])
    expect(result.plan.qualifications.map(qualification => qualification.qualificationType))
      .toEqual(['cpsia', 'food_contact'])
    expect(result.plan.sourceRecords[0]?.rawPayloadRef).toBe('processed/id-1/catalog.csv#2')
  })

  it('keeps valid rows and reports row failures with explicit reasons', () => {
    const result = parseSourcingCsv(readFileSync(join(fixtureRoot, 'invalid-rows.csv')), options)
    expect(result.plan.batch.status).toBe('partially_completed')
    expect(result.plan.batch.validRows).toBe(1)
    expect(result.plan.batch.failedRows).toBe(3)
    expect(result.plan.batch.errors.map(error => error.errorCodes[0])).toEqual([
      'INVALID_PRICE',
      'INVALID_SKU_JSON',
      'DUPLICATE_SOURCE_ID',
    ])
  })

  it('accepts multiple SKUs without a SKU_MISSING warning', () => {
    const result = parseSourcingCsv(readFileSync(join(fixtureRoot, 'valid-with-sku.csv')), options)
    expect(result.plan.batch.warningRows).toBe(0)
    expect(JSON.parse(result.plan.items[0]?.skuAttributesJson ?? '[]')).toHaveLength(2)
  })

  it('rejects header mismatch as one whole batch', () => {
    const bytes = new TextEncoder().encode('sourceId,supplierName\nA,Supplier')
    const result = parseSourcingCsv(bytes, options)
    expect(result.plan.batch.status).toBe('failed')
    expect(result.plan.batch.errors[0]?.errorCodes).toEqual(['HEADER_MISMATCH'])
    expect(result.plan.items).toHaveLength(0)
  })
})
