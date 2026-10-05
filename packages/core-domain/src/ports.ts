/** Repository ports: pure interfaces, implemented by infrastructure packages (product-storage). */
import type { AuditEvent, SelectionDecision, SourcingItem } from './objects.ts'

export interface SourcingItemRepository {
  findById(workspaceId: string, id: string): Promise<SourcingItem | undefined>
  update(item: SourcingItem): Promise<void>
}

export interface SelectionDecisionRepository {
  findActiveByItemId(workspaceId: string, sourcingItemId: string): Promise<SelectionDecision | undefined>
  insert(decision: SelectionDecision): Promise<void>
  supersede(id: string, at: string): Promise<void>
  setResultProductId(id: string, resultProductId: string, at: string): Promise<void>
}

export interface ProductRepository {
  insert(product: {
    id: string
    businessAccountId: string
    title: string
    coreCategoryId: string
    currency: string
    riskStatus: SourcingItem['riskStatus']
    sourcingItemId: string
    createdFromSelectionId: string
  }, variant: { id: string; sku: string; attributesJson: string; purchasePriceMinor: number; currency: string }): Promise<void>
}

/** Audit sink port: the storage layer persists events; the domain only appends. */
export interface AuditSink {
  append(event: AuditEvent): void
}

export interface IdGenerator {
  next(): string
}

export interface Clock {
  now(): Date
}
