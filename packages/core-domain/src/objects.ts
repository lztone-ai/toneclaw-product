/** Core domain objects per CORE_MODEL 5.1-5.7 / 7.1-7.2 (P0 field set, pure types only). */

export type DataSourceType = 'manual' | 'excel' | 'csv' | 'json'
export type DataSourceStatus = 'active' | 'disabled' | 'error'

export interface DataSource {
  id: string
  businessAccountId: string
  type: DataSourceType
  name: string
  configRef: string | null
  status: DataSourceStatus
  lastSyncedAt: string | null
}

export type SupplierStatus = 'draft' | 'active' | 'paused' | 'blocked' | 'archived'

export interface Supplier {
  id: string
  businessAccountId: string
  name: string
  nameNormalized: string
  supplierUrl: string | null
  code: string | null
  country: string
  contactName: string | null
  contactChannel: string | null
  defaultCurrency: string
  status: SupplierStatus
  rating: number | null
  notes: string | null
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
  sourceRecordId: string
  externalSourceId: string | null
  title: string
  descriptionRaw: string | null
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

export type SourcingImportFormat = 'csv'
export type SourcingImportBatchStatus =
  | 'validating'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'canceled'

export interface SourcingImportRowError {
  rowIndex: number | null
  errorCodes: string[]
  reason: string
  rawCsvLine: string | null
}

export interface SourcingImportBatch {
  id: string
  businessAccountId: string
  format: SourcingImportFormat
  fileName: string
  fileRef: string
  fingerprint: string
  sourceBatchId: string | null
  totalRows: number
  validRows: number
  failedRows: number
  warningRows: number
  status: SourcingImportBatchStatus
  errors: SourcingImportRowError[]
  createdAt: string
  createdBy: string
}

export interface SourceRecord {
  id: string
  businessAccountId: string
  dataSourceId: string
  sourcingItemId: string
  externalId: string | null
  rawPayloadRef: string
  checksum: string
  importedAt: string
}

export type SourcingMediaType = 'image' | 'video' | 'document'
export type SourcingMediaPurpose = 'main' | 'detail' | 'scene' | 'certificate' | 'other'
export type SourcingMediaRightsStatus = 'unknown' | 'owned' | 'licensed' | 'restricted'
export type SourcingMediaStatus = 'imported' | 'processing' | 'ready' | 'failed' | 'blocked' | 'archived'

export interface SourcingItemMedia {
  id: string
  sourcingItemId: string
  mediaType: SourcingMediaType
  purpose: SourcingMediaPurpose
  storageRef: string
  sourceUrl: string | null
  checksum: string
  rightsStatus: SourcingMediaRightsStatus
  status: SourcingMediaStatus
}

export type SourcingQualificationStatus =
  | 'unknown'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'expired'

export interface SourcingItemQualification {
  id: string
  sourcingItemId: string
  qualificationType: string
  fileRef: string
  status: SourcingQualificationStatus
  issuedBy: string | null
  issuedAt: string | null
  expiresAt: string | null
}

export type CategoryStatus = 'active' | 'inactive'

export interface Category {
  id: string
  parentId: string | null
  name: string
  path: string
  level: number
  status: CategoryStatus
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
