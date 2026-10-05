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
  decision: 'approved' | 'rejected' | 'observing' | null
  decisionReason: string | null
  productCreated: boolean
}

export interface SourcingCommandEndpoint {
  baseUrl: string
  token: string
}

export interface SourcingSnapshot {
  schemaVersion: 1
  generatedAt: string
  workspaceId: string
  summary: { totalItems: number; candidateItems: number; batches: number; failedBatches: number }
  commands?: SourcingCommandEndpoint
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
  products: {
    id: string
    title: string
    status: string
    riskStatus: string
    currency: string
    purchasePriceMinor: number | null
    sourcingItemId: string | null
    createdFromSelectionId: string | null
    createdAt: string
  }[]
}

export function writeSourcingSnapshot(
  dataDir: string,
  storage: ProductStorage,
  workspaceId: string,
  commandEndpoint?: SourcingCommandEndpoint,
): Promise<string> {
  const views = storage.listSourcingItemViews(workspaceId)
  const allItems = views.map(view => view.item)
  const visibleViews = views.slice(0, 500)
  return storage.importBatches.list(workspaceId, 50).then((batches) => {
    const products = storage.listProductViews(workspaceId)
    const snapshot: SourcingSnapshot = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceId,
      summary: {
        totalItems: allItems.length,
        candidateItems: visibleViews.filter(view => view.item.status === 'candidate').length,
        batches: batches.length,
        failedBatches: batches.filter(batch => batch.status === 'failed').length,
      },
      ...(commandEndpoint === undefined ? {} : { commands: commandEndpoint }),
      items: visibleViews.map(view => ({
        id: view.item.id,
        externalSourceId: view.item.externalSourceId,
        title: view.item.title,
        status: view.item.status,
        currency: view.item.currency,
        purchasePriceMinor: view.item.purchasePriceMinor,
        suggestedRetailPriceMinor: view.item.suggestedRetailPriceMinor,
        moq: view.item.moq,
        leadTimeDays: view.item.leadTimeDays,
        stockStatus: view.item.stockStatus,
        riskStatus: view.item.riskStatus,
        categoryLabels: view.item.categoryLabels,
        imageUrls: view.item.imageUrls,
        updatedAt: view.item.updatedAt,
        decision: view.decision?.decision ?? null,
        decisionReason: view.decision?.reason ?? null,
        productCreated: view.productCreated,
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
      products: products.map(({ product, purchasePriceMinor }) => ({
        id: product.id,
        title: product.title,
        status: product.status,
        riskStatus: product.riskStatus,
        currency: product.currency,
        purchasePriceMinor,
        sourcingItemId: product.sourcingItemId,
        createdFromSelectionId: product.createdFromSelectionId,
        createdAt: product.createdAt,
      })),
    }
    const path = join(dataDir, 'sourcing.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    return path
  })
}
