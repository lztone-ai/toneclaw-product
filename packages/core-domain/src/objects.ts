/** Core domain objects per CORE_MODEL 5.1-5.7 / 7.1-7.2 (P0 field set, pure types only). */

export type DataSourceType = 'manual' | 'excel' | 'csv' | 'json'
export type DataSourceStatus = 'active' | 'disabled'

export interface DataSource {
  id: string
  businessAccountId: string
  type: DataSourceType
  name: string
  status: DataSourceStatus
  lastSyncedAt: string | null
}

export type SupplierStatus = 'draft' | 'active' | 'paused' | 'blocked' | 'archived'

export interface Supplier {
  id: string
  businessAccountId: string
  name: string
  code: string | null
  country: string
  defaultCurrency: string
  status: SupplierStatus
}

export type StockStatus = 'available' | 'low' | 'out_of_stock' | 'unknown'
export type SupplyStatus = 'active' | 'paused' | 'discontinued'
export type RiskStatus = 'unknown' | 'low' | 'medium' | 'high'
export type SourcingItemStatus =
  | 'imported'
  | 'normalizing'
  | 'candidate'
  | 'invalid'
  | 'selected'
  | 'rejected'
  | 'archived'

export interface SourcingItem {
  id: string
  businessAccountId: string
  supplierId: string
  dataSourceId: string
  externalSourceId: string | null
  title: string
  categoryLabels: string[]
  currency: string
  purchasePriceMinor: number
  suggestedRetailPriceMinor: number | null
  moq: number | null
  leadTimeDays: number | null
  stockStatus: StockStatus
  supplyStatus: SupplyStatus
  riskStatus: RiskStatus
  status: SourcingItemStatus
  imageUrls: string[]
  skuAttributesJson: string | null
  complianceJson: string | null
  createdAt: string
  updatedAt: string
}

export type SelectionDecisionValue = 'approved' | 'rejected' | 'observing'
export type SelectionDecisionStatus = 'active' | 'superseded' | 'canceled'
export type DecidedBy = 'user' | 'ai' | 'system'

export interface SelectionDecision {
  id: string
  businessAccountId: string
  sourcingItemId: string
  decision: SelectionDecisionValue
  reason: string
  scoresJson: string | null
  decidedBy: DecidedBy
  decidedAt: string
  status: SelectionDecisionStatus
  resultProductId: string | null
}

export type ProductStatus = 'draft' | 'active' | 'paused' | 'archived'

export interface Product {
  id: string
  businessAccountId: string
  sourcingItemId: string | null
  createdFromSelectionId: string | null
  title: string
  coreCategoryId: string
  currency: string
  riskStatus: RiskStatus
  status: ProductStatus
  createdAt: string
  updatedAt: string
}

export interface ProductVariant {
  id: string
  productId: string
  sku: string
  attributesJson: string
  purchasePriceMinor: number
  currency: string
}

/** Audit trail port type (PHASE1_TECH_DESIGN 4.10, workspace-scoped). */
export type AuditActorType = 'system' | 'user' | 'ai'

export interface AuditEvent {
  id: string
  workspaceId: string
  actorType: AuditActorType
  actorId: string
  action: string
  objectType: string
  objectId: string
  before: string | null
  after: string | null
  reason: string | null
  source: string
  occurredAt: string
  traceId: string | null
}
