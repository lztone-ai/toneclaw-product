/** Repository ports: pure interfaces, implemented by infrastructure packages (product-storage). */
import type {
  AuditEvent,
  Category,
  DataSource,
  SourcingImportBatch,
  SourcingItem,
  SourcingItemMedia,
  SourcingItemQualification,
  SelectionDecision,
  SourceRecord,
  Supplier,
} from './objects.ts'

export interface SourcingItemRepository {
  insert(item: SourcingItem): Promise<void>
  findById(workspaceId: string, id: string): Promise<SourcingItem | undefined>
  update(item: SourcingItem): Promise<void>
}

export interface DataSourceRepository {
  insert(dataSource: DataSource): Promise<void>
  updateStatus(workspaceId: string, id: string, status: DataSource['status']): Promise<void>
}

export interface SupplierRepository {
  insert(supplier: Supplier): Promise<void>
  findByNormalizedName(workspaceId: string, nameNormalized: string): Promise<Supplier | undefined>
}

export interface CategoryRepository {
  ensureUncategorized(category: Category): Promise<void>
}

export interface SourcingImportBatchRepository {
  insert(batch: SourcingImportBatch): Promise<void>
  findById(workspaceId: string, id: string): Promise<SourcingImportBatch | undefined>
  findByIdempotency(
    workspaceId: string,
    createdBy: string,
    fingerprint: string,
  ): Promise<SourcingImportBatch | undefined>
  list(workspaceId: string, limit?: number): Promise<SourcingImportBatch[]>
}

export interface SourceRecordRepository {
  insert(record: SourceRecord): Promise<void>
  checksumExists(workspaceId: string, checksum: string): Promise<boolean>
}

export interface SourcingMediaRepository {
  insertMany(media: SourcingItemMedia[]): Promise<void>
}

export interface SourcingQualificationRepository {
  insertMany(qualifications: SourcingItemQualification[]): Promise<void>
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
