import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProductStorage } from '@toneclaw/product-storage'

export interface SourcingSnapshotItem {
  id: string
  externalSourceId: string | null
  title: string
  status: string
  currency: string
  purchasePriceMinor: number
  suggestedRetailPriceMinor: number | null
  moq: number | null
  leadTimeDays: number | null
  stockStatus: string
  riskStatus: string
  categoryLabels: string[]
  imageUrls: string[]
  updatedAt: string
}

export interface SourcingSnapshot {
  schemaVersion: 1
  generatedAt: string
  workspaceId: string
  summary: { totalItems: number; candidateItems: number; batches: number; failedBatches: number }
  items: SourcingSnapshotItem[]
  batches: {
    id: string
    fileName: string
    status: string
    totalRows: number
    validRows: number
    failedRows: number
    warningRows: number
    createdAt: string
  }[]
}

export function writeSourcingSnapshot(
  dataDir: string,
  storage: ProductStorage,
  workspaceId: string,
): Promise<string> {
  const allItems = storage.listSourcingItems(workspaceId)
  const items = allItems.slice(0, 500)
  return storage.importBatches.list(workspaceId, 50).then((batches) => {
    const snapshot: SourcingSnapshot = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceId,
      summary: {
        totalItems: allItems.length,
        candidateItems: items.filter(item => item.status === 'candidate').length,
        batches: batches.length,
        failedBatches: batches.filter(batch => batch.status === 'failed').length,
      },
      items: items.map(item => ({
        id: item.id,
        externalSourceId: item.externalSourceId,
        title: item.title,
        status: item.status,
        currency: item.currency,
        purchasePriceMinor: item.purchasePriceMinor,
        suggestedRetailPriceMinor: item.suggestedRetailPriceMinor,
        moq: item.moq,
        leadTimeDays: item.leadTimeDays,
        stockStatus: item.stockStatus,
        riskStatus: item.riskStatus,
        categoryLabels: item.categoryLabels,
        imageUrls: item.imageUrls,
        updatedAt: item.updatedAt,
      })),
      batches: batches.map(batch => ({
        id: batch.id,
        fileName: batch.fileName,
        status: batch.status,
        totalRows: batch.totalRows,
        validRows: batch.validRows,
        failedRows: batch.failedRows,
        warningRows: batch.warningRows,
        createdAt: batch.createdAt,
      })),
    }
    const path = join(dataDir, 'sourcing.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    return path
  })
}
