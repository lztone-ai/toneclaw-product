/** SQLite implementation of the core-domain repository ports (node:sqlite). */
import { DatabaseSync } from 'node:sqlite'
import type { AuditSink } from '@toneclaw/core-domain'
import type {
  AuditEvent,
  Category,
  CategoryRepository,
  DataSource,
  DataSourceRepository,
  Product,
  ProductRepository,
  SelectionDecision,
  SelectionDecisionRepository,
  SourcingImportBatch,
  SourcingImportBatchRepository,
  SourcingItem,
  SourcingItemRepository,
  SourcingItemMedia,
  SourcingMediaRepository,
  SourcingItemQualification,
  SourcingQualificationRepository,
  SourceRecord,
  SourceRecordRepository,
  Supplier,
  SupplierRepository,
} from '@toneclaw/core-domain'

interface SourcingItemRow {
  id: string
  business_account_id: string
  supplier_id: string
  data_source_id: string
  source_record_id: string
  external_source_id: string | null
  title: string
  description_raw: string | null
  category_labels_json: string
  currency: string
  purchase_price_minor: number
  suggested_retail_price_minor: number | null
  moq: number | null
  lead_time_days: number | null
  stock_status: SourcingItem['stockStatus']
  supply_status: SourcingItem['supplyStatus']
  risk_status: SourcingItem['riskStatus']
  status: SourcingItem['status']
  image_urls_json: string
  sku_attributes_json: string | null
  compliance_json: string | null
  created_at: string
  updated_at: string
}

interface DecisionRow {
  id: string
  business_account_id: string
  sourcing_item_id: string
  decision: SelectionDecision['decision']
  reason: string
  scores_json: string | null
  decided_by: SelectionDecision['decidedBy']
  decided_at: string
  status: SelectionDecision['status']
  result_product_id: string | null
}

interface AuditRow {
  id: string
  workspace_id: string
  actor_type: AuditEvent['actorType']
  actor_id: string
  action: string
  object_type: string
  object_id: string
  before: string | null
  after: string | null
  reason: string | null
  source: string
  occurred_at: string
  trace_id: string | null
}

interface DataSourceRow {
  id: string
  business_account_id: string
  type: DataSource['type']
  name: string
  config_ref: string | null
  status: DataSource['status']
  last_synced_at: string | null
}

interface SupplierRow {
  id: string
  business_account_id: string
  name: string
  name_normalized: string
  supplier_url: string | null
  code: string | null
  country: string
  contact_name: string | null
  contact_channel: string | null
  default_currency: string
  status: Supplier['status']
  rating: number | null
  notes: string | null
}

interface ImportBatchRow {
  id: string
  business_account_id: string
  store_id: null
  format: SourcingImportBatch['format']
  file_name: string
  file_ref: string
  fingerprint: string
  source_batch_id: string | null
  total_rows: number
  valid_rows: number
  failed_rows: number
  warning_rows: number
  status: SourcingImportBatch['status']
  errors_json: string
  created_at: string
  created_by: string
}

interface SourceRecordRow {
  id: string
  business_account_id: string
  data_source_id: string
  sourcing_item_id: string
  external_id: string | null
  raw_payload_ref: string
  checksum: string
  imported_at: string
}

interface SourcingMediaRow {
  id: string
  sourcing_item_id: string
  media_type: SourcingItemMedia['mediaType']
  purpose: SourcingItemMedia['purpose']
  storage_ref: string
  source_url: string | null
  checksum: string
  rights_status: SourcingItemMedia['rightsStatus']
  status: SourcingItemMedia['status']
}

interface SourcingQualificationRow {
  id: string
  sourcing_item_id: string
  qualification_type: string
  file_ref: string
  status: SourcingItemQualification['status']
  issued_by: string | null
  issued_at: string | null
  expires_at: string | null
}

export interface SourcingImportWritePlan {
  batch: SourcingImportBatch
  dataSource: DataSource
  suppliers: Supplier[]
  items: SourcingItem[]
  sourceRecords: SourceRecord[]
  media: SourcingItemMedia[]
  qualifications: SourcingItemQualification[]
}

export interface SourcingItemView {
  item: SourcingItem
  decision: SelectionDecision | null
  scoresJson: string | null
  productCreated: boolean
}

export interface ProductView {
  product: Product
  purchasePriceMinor: number | null
}

function mapItem(row: SourcingItemRow): SourcingItem {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    supplierId: row.supplier_id,
    dataSourceId: row.data_source_id,
    sourceRecordId: row.source_record_id,
    externalSourceId: row.external_source_id,
    title: row.title,
    descriptionRaw: row.description_raw,
    categoryLabels: JSON.parse(row.category_labels_json) as string[],
    currency: row.currency,
    purchasePriceMinor: row.purchase_price_minor,
    suggestedRetailPriceMinor: row.suggested_retail_price_minor,
    moq: row.moq,
    leadTimeDays: row.lead_time_days,
    stockStatus: row.stock_status,
    supplyStatus: row.supply_status,
    riskStatus: row.risk_status,
    status: row.status,
    imageUrls: JSON.parse(row.image_urls_json) as string[],
    skuAttributesJson: row.sku_attributes_json,
    complianceJson: row.compliance_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDecision(row: DecisionRow): SelectionDecision {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    sourcingItemId: row.sourcing_item_id,
    decision: row.decision,
    reason: row.reason,
    scoresJson: row.scores_json,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    status: row.status,
    resultProductId: row.result_product_id,
  }
}

function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    before: row.before,
    after: row.after,
    reason: row.reason,
    source: row.source,
    occurredAt: row.occurred_at,
    traceId: row.trace_id,
  }
}

function mapDataSource(row: DataSourceRow): DataSource {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    type: row.type,
    name: row.name,
    configRef: row.config_ref,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
  }
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    name: row.name,
    nameNormalized: row.name_normalized,
    supplierUrl: row.supplier_url,
    code: row.code,
    country: row.country,
    contactName: row.contact_name,
    contactChannel: row.contact_channel,
    defaultCurrency: row.default_currency,
    status: row.status,
    rating: row.rating,
    notes: row.notes,
  }
}

function mapImportBatch(row: ImportBatchRow): SourcingImportBatch {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    storeId: row.store_id,
    format: row.format,
    fileName: row.file_name,
    fileRef: row.file_ref,
    fingerprint: row.fingerprint,
    sourceBatchId: row.source_batch_id,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    failedRows: row.failed_rows,
    warningRows: row.warning_rows,
    status: row.status,
    errors: JSON.parse(row.errors_json) as SourcingImportBatch['errors'],
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

function mapSourceRecord(row: SourceRecordRow): SourceRecord {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    dataSourceId: row.data_source_id,
    sourcingItemId: row.sourcing_item_id,
    externalId: row.external_id,
    rawPayloadRef: row.raw_payload_ref,
    checksum: row.checksum,
    importedAt: row.imported_at,
  }
}

export class ProductStorage {
  private readonly db: DatabaseSync

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path)
    this.migrate()
  }

  /** Raw prepared-statement access for tooling and test seeding. */
  prepare(sql: string) {
    return this.db.prepare(sql)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sourcing_items (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        data_source_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL DEFAULT '',
        external_source_id TEXT,
        title TEXT NOT NULL,
        description_raw TEXT,
        category_labels_json TEXT NOT NULL DEFAULT '[]',
        currency TEXT NOT NULL,
        purchase_price_minor INTEGER NOT NULL,
        suggested_retail_price_minor INTEGER,
        moq INTEGER,
        lead_time_days INTEGER,
        stock_status TEXT NOT NULL,
        supply_status TEXT NOT NULL,
        risk_status TEXT NOT NULL,
        status TEXT NOT NULL,
        image_urls_json TEXT NOT NULL DEFAULT '[]',
        sku_attributes_json TEXT,
        compliance_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS selection_decisions (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        sourcing_item_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        scores_json TEXT,
        decided_by TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        status TEXT NOT NULL,
        result_product_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_item ON selection_decisions(sourcing_item_id, status);
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        sourcing_item_id TEXT NOT NULL,
        created_from_selection_id TEXT NOT NULL,
        title TEXT NOT NULL,
        core_category_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        risk_status TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_variants (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        attributes_json TEXT NOT NULL,
        purchase_price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        before TEXT,
        after TEXT,
        reason TEXT,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        trace_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_events(workspace_id, occurred_at);
      CREATE TABLE IF NOT EXISTS data_sources (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        config_ref TEXT,
        status TEXT NOT NULL,
        last_synced_at TEXT
      );
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        name_normalized TEXT NOT NULL,
        supplier_url TEXT,
        code TEXT,
        country TEXT NOT NULL,
        contact_name TEXT,
        contact_channel TEXT,
        default_currency TEXT NOT NULL,
        status TEXT NOT NULL,
        rating INTEGER,
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_workspace_name
        ON suppliers(business_account_id, name_normalized);
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        level INTEGER NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sourcing_import_batches (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        store_id TEXT,
        format TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_ref TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        source_batch_id TEXT,
        total_rows INTEGER NOT NULL,
        valid_rows INTEGER NOT NULL,
        failed_rows INTEGER NOT NULL,
        warning_rows INTEGER NOT NULL,
        status TEXT NOT NULL,
        errors_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_idempotency
        ON sourcing_import_batches(business_account_id, created_by, fingerprint);
      CREATE TABLE IF NOT EXISTS source_records (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        data_source_id TEXT NOT NULL,
        sourcing_item_id TEXT NOT NULL,
        external_id TEXT,
        raw_payload_ref TEXT NOT NULL,
        checksum TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_source_records_checksum
        ON source_records(business_account_id, checksum);
      CREATE INDEX IF NOT EXISTS idx_source_records_item
        ON source_records(sourcing_item_id);
      CREATE TABLE IF NOT EXISTS sourcing_item_media (
        id TEXT PRIMARY KEY,
        sourcing_item_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        purpose TEXT NOT NULL,
        storage_ref TEXT NOT NULL,
        source_url TEXT,
        checksum TEXT NOT NULL,
        rights_status TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sourcing_media_item ON sourcing_item_media(sourcing_item_id);
      CREATE TABLE IF NOT EXISTS sourcing_item_qualifications (
        id TEXT PRIMARY KEY,
        sourcing_item_id TEXT NOT NULL,
        qualification_type TEXT NOT NULL,
        file_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        issued_by TEXT,
        issued_at TEXT,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sourcing_qualifications_item
        ON sourcing_item_qualifications(sourcing_item_id);
    `)
    this.addColumnIfMissing('sourcing_items', 'source_record_id', "TEXT NOT NULL DEFAULT ''")
    this.addColumnIfMissing('sourcing_items', 'description_raw', 'TEXT')
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!columns.some(entry => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  get sourcingItems(): SourcingItemRepository {
    return {
      findById: async (workspaceId, id) =>
        this.firstItem(`WHERE id = ? AND business_account_id = ? LIMIT 1`, [id, workspaceId]),
      insert: async item => {
        this.db.prepare(`
          INSERT INTO sourcing_items (
            id, business_account_id, supplier_id, data_source_id, source_record_id,
            external_source_id, title, description_raw, category_labels_json, currency,
            purchase_price_minor, suggested_retail_price_minor, moq, lead_time_days,
            stock_status, supply_status, risk_status, status, image_urls_json,
            sku_attributes_json, compliance_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          item.id, item.businessAccountId, item.supplierId, item.dataSourceId,
          item.sourceRecordId, item.externalSourceId, item.title, item.descriptionRaw,
          JSON.stringify(item.categoryLabels), item.currency, item.purchasePriceMinor,
          item.suggestedRetailPriceMinor, item.moq, item.leadTimeDays, item.stockStatus,
          item.supplyStatus, item.riskStatus, item.status, JSON.stringify(item.imageUrls),
          item.skuAttributesJson, item.complianceJson, item.createdAt, item.updatedAt,
        )
      },
      update: async item => {
        this.db.prepare(`
          UPDATE sourcing_items SET
            status = ?, stock_status = ?, supply_status = ?, risk_status = ?,
            suggested_retail_price_minor = ?, moq = ?, lead_time_days = ?,
            category_labels_json = ?, image_urls_json = ?, sku_attributes_json = ?,
            compliance_json = ?, updated_at = ?
          WHERE id = ? AND business_account_id = ?
        `).run(
          item.status, item.stockStatus, item.supplyStatus, item.riskStatus,
          item.suggestedRetailPriceMinor, item.moq, item.leadTimeDays,
          JSON.stringify(item.categoryLabels), JSON.stringify(item.imageUrls),
          item.skuAttributesJson, item.complianceJson, item.updatedAt,
          item.id, item.businessAccountId,
        )
      },
    }
  }

  get decisions(): SelectionDecisionRepository {
    return {
      findActiveByItemId: async (_workspaceId, sourcingItemId) => {
        const row = this.db.prepare(`
          SELECT * FROM selection_decisions WHERE sourcing_item_id = ? AND status = 'active' LIMIT 1
        `).get(sourcingItemId) as unknown as DecisionRow | undefined
        return row === undefined ? undefined : mapDecision(row)
      },
      insert: async decision => {
        this.db.prepare(`
          INSERT INTO selection_decisions (
            id, business_account_id, sourcing_item_id, decision, reason, scores_json,
            decided_by, decided_at, status, result_product_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          decision.id, decision.businessAccountId, decision.sourcingItemId, decision.decision,
          decision.reason, decision.scoresJson, decision.decidedBy, decision.decidedAt,
          decision.status, decision.resultProductId,
        )
      },
      supersede: async (id, at) => {
        this.db.prepare(`UPDATE selection_decisions SET status = 'superseded', decided_at = ? WHERE id = ?`).run(at, id)
      },
      setResultProductId: async (id, resultProductId, at) => {
        this.db.prepare(`UPDATE selection_decisions SET result_product_id = ?, decided_at = ? WHERE id = ?`).run(resultProductId, at, id)
      },
    }
  }

  get products(): ProductRepository {
    return {
      insert: async (product, variant) => {
        const now = new Date().toISOString()
        this.db.exec('BEGIN IMMEDIATE')
        try {
          this.db.prepare(`
            INSERT INTO products (
              id, business_account_id, sourcing_item_id, created_from_selection_id,
              title, core_category_id, currency, risk_status, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
          `).run(
            product.id, product.businessAccountId, product.sourcingItemId,
            product.createdFromSelectionId, product.title, product.coreCategoryId,
            product.currency, product.riskStatus, now, now,
          )
          this.db.prepare(`
            INSERT INTO product_variants (id, product_id, sku, attributes_json, purchase_price_minor, currency)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(variant.id, product.id, variant.sku, variant.attributesJson, variant.purchasePriceMinor, variant.currency)
          this.db.exec('COMMIT')
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        }
      },
    }
  }

  get audit(): AuditSink {
    return {
      append: (event: AuditEvent) => {
        this.db.prepare(`
          INSERT INTO audit_events (
            id, workspace_id, actor_type, actor_id, action, object_type, object_id,
            before, after, reason, source, occurred_at, trace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id, event.workspaceId, event.actorType, event.actorId, event.action,
          event.objectType, event.objectId, event.before, event.after, event.reason,
          event.source, event.occurredAt, event.traceId,
        )
      },
    }
  }

  get dataSources(): DataSourceRepository {
    return {
      insert: async dataSource => {
        this.db.prepare(`
          INSERT INTO data_sources (
            id, business_account_id, type, name, config_ref, status, last_synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          dataSource.id, dataSource.businessAccountId, dataSource.type, dataSource.name,
          dataSource.configRef, dataSource.status, dataSource.lastSyncedAt,
        )
      },
      updateStatus: async (workspaceId, id, status) => {
        this.db.prepare(`UPDATE data_sources SET status = ? WHERE id = ? AND business_account_id = ?`)
          .run(status, id, workspaceId)
      },
    }
  }

  get suppliers(): SupplierRepository {
    return {
      insert: async supplier => {
        this.db.prepare(`
          INSERT INTO suppliers (
            id, business_account_id, name, name_normalized, supplier_url, code, country,
            contact_name, contact_channel, default_currency, status, rating, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          supplier.id, supplier.businessAccountId, supplier.name, supplier.nameNormalized,
          supplier.supplierUrl, supplier.code, supplier.country, supplier.contactName,
          supplier.contactChannel, supplier.defaultCurrency, supplier.status,
          supplier.rating, supplier.notes,
        )
      },
      findByNormalizedName: async (workspaceId, nameNormalized) => {
        const row = this.db.prepare(`
          SELECT * FROM suppliers WHERE business_account_id = ? AND name_normalized = ? LIMIT 1
        `).get(workspaceId, nameNormalized) as unknown as SupplierRow | undefined
        return row === undefined ? undefined : mapSupplier(row)
      },
    }
  }

  get categories(): CategoryRepository {
    return {
      ensureUncategorized: async category => {
        this.db.prepare(`
          INSERT OR IGNORE INTO categories (id, parent_id, name, path, level, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(category.id, category.parentId, category.name, category.path, category.level, category.status)
      },
    }
  }

  get importBatches(): SourcingImportBatchRepository {
    return {
      insert: async batch => {
        this.db.prepare(`
          INSERT INTO sourcing_import_batches (
            id, business_account_id, store_id, format, file_name, file_ref, fingerprint,
            source_batch_id, total_rows, valid_rows, failed_rows, warning_rows, status,
            errors_json, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          batch.id, batch.businessAccountId, batch.storeId, batch.format, batch.fileName,
          batch.fileRef, batch.fingerprint, batch.sourceBatchId, batch.totalRows,
          batch.validRows, batch.failedRows, batch.warningRows, batch.status,
          JSON.stringify(batch.errors), batch.createdAt, batch.createdBy,
        )
      },
      findById: async (workspaceId, id) => {
        const row = this.db.prepare(`
          SELECT * FROM sourcing_import_batches WHERE id = ? AND business_account_id = ? LIMIT 1
        `).get(id, workspaceId) as unknown as ImportBatchRow | undefined
        return row === undefined ? undefined : mapImportBatch(row)
      },
      findByIdempotency: async (workspaceId, createdBy, fingerprint) => {
        const row = this.db.prepare(`
          SELECT * FROM sourcing_import_batches
          WHERE business_account_id = ? AND created_by = ? AND fingerprint = ? LIMIT 1
        `).get(workspaceId, createdBy, fingerprint) as unknown as ImportBatchRow | undefined
        return row === undefined ? undefined : mapImportBatch(row)
      },
      list: async (workspaceId, limit = 50) => {
        const rows = this.db.prepare(`
          SELECT * FROM sourcing_import_batches
          WHERE business_account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
        `).all(workspaceId, limit) as unknown as ImportBatchRow[]
        return rows.map(mapImportBatch)
      },
    }
  }

  get sourceRecords(): SourceRecordRepository {
    return {
      insert: async record => {
        this.db.prepare(`
          INSERT INTO source_records (
            id, business_account_id, data_source_id, sourcing_item_id, external_id,
            raw_payload_ref, checksum, imported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.id, record.businessAccountId, record.dataSourceId, record.sourcingItemId,
          record.externalId, record.rawPayloadRef, record.checksum, record.importedAt,
        )
      },
      checksumExists: async (workspaceId, checksum) => {
        const row = this.db.prepare(`
          SELECT 1 FROM source_records WHERE business_account_id = ? AND checksum = ? LIMIT 1
        `).get(workspaceId, checksum)
        return row !== undefined
      },
    }
  }

  get media(): SourcingMediaRepository {
    return {
      insertMany: async media => {
        const statement = this.db.prepare(`
          INSERT INTO sourcing_item_media (
            id, sourcing_item_id, media_type, purpose, storage_ref, source_url,
            checksum, rights_status, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of media) {
          statement.run(
            item.id, item.sourcingItemId, item.mediaType, item.purpose, item.storageRef,
            item.sourceUrl, item.checksum, item.rightsStatus, item.status,
          )
        }
      },
    }
  }

  get qualifications(): SourcingQualificationRepository {
    return {
      insertMany: async qualifications => {
        const statement = this.db.prepare(`
          INSERT INTO sourcing_item_qualifications (
            id, sourcing_item_id, qualification_type, file_ref, status,
            issued_by, issued_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of qualifications) {
          statement.run(
            item.id, item.sourcingItemId, item.qualificationType, item.fileRef, item.status,
            item.issuedBy, item.issuedAt, item.expiresAt,
          )
        }
      },
    }
  }

  /** Atomically persist one successful or partially-successful CSV import. */
  async applyImportBatch(plan: SourcingImportWritePlan): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      await this.dataSources.insert(plan.dataSource)
      for (const supplier of plan.suppliers) await this.suppliers.insert(supplier)
      await this.categories.ensureUncategorized({
        id: 'category-uncategorized',
        parentId: null,
        name: '未分类',
        path: '未分类',
        level: 1,
        status: 'active',
      })
      for (const item of plan.items) await this.sourcingItems.insert(item)
      for (const record of plan.sourceRecords) await this.sourceRecords.insert(record)
      await this.media.insertMany(plan.media)
      await this.qualifications.insertMany(plan.qualifications)
      await this.importBatches.insert(plan.batch)
      this.audit.append({
        id: `audit-${plan.batch.id}`,
        workspaceId: plan.batch.businessAccountId,
        actorType: 'system',
        actorId: 'import-watch-folder',
        action: 'import.batch',
        objectType: 'SourcingImportBatch',
        objectId: plan.batch.id,
        before: null,
        after: JSON.stringify({
          status: plan.batch.status,
          totalRows: plan.batch.totalRows,
          validRows: plan.batch.validRows,
          failedRows: plan.batch.failedRows,
          warningRows: plan.batch.warningRows,
          dataSourceId: plan.dataSource.id,
          supplierIds: plan.suppliers.map(supplier => supplier.id),
        }),
        reason: null,
        source: 'sourcing-provider',
        occurredAt: plan.batch.createdAt,
        traceId: null,
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Persist a whole-batch rejection and mark its data source as errored. */
  async applyRejectedImportBatch(
    plan: Pick<SourcingImportWritePlan, 'batch' | 'dataSource'>,
  ): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      await this.dataSources.insert(plan.dataSource)
      await this.importBatches.insert(plan.batch)
      await this.dataSources.updateStatus(
        plan.dataSource.businessAccountId,
        plan.dataSource.id,
        'error',
      )
      this.audit.append({
        id: `audit-${plan.batch.id}`,
        workspaceId: plan.batch.businessAccountId,
        actorType: 'system',
        actorId: 'import-watch-folder',
        action: 'import.batch',
        objectType: 'SourcingImportBatch',
        objectId: plan.batch.id,
        before: null,
        after: JSON.stringify({ status: plan.batch.status, errors: plan.batch.errors }),
        reason: null,
        source: 'sourcing-provider',
        occurredAt: plan.batch.createdAt,
        traceId: null,
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async existingChecksums(workspaceId: string, checksums: string[]): Promise<Set<string>> {
    const found = new Set<string>()
    const statement = this.db.prepare(`
      SELECT checksum FROM source_records WHERE business_account_id = ? AND checksum = ?
    `)
    for (const checksum of checksums) {
      if (statement.get(workspaceId, checksum) !== undefined) found.add(checksum)
    }
    return found
  }

  listSourcingItems(workspaceId: string): SourcingItem[] {
    return this.itemRows(`WHERE business_account_id = ? ORDER BY updated_at DESC`, [workspaceId]).map(mapItem)
  }

  /** Joined read model for the selection workbench (commands still go through the domain). */
  listSourcingItemViews(workspaceId: string): SourcingItemView[] {
    const items = this.listSourcingItems(workspaceId)
    const decisionRows = this.db.prepare(`
      SELECT * FROM selection_decisions
      WHERE business_account_id = ? AND status = 'active'
      ORDER BY decided_at DESC, id DESC
    `).all(workspaceId) as unknown as DecisionRow[]
    const decisions = new Map<string, SelectionDecision>()
    for (const row of decisionRows) {
      const decision = mapDecision(row)
      if (!decisions.has(decision.sourcingItemId)) decisions.set(decision.sourcingItemId, decision)
    }
    const productRows = this.db.prepare(`
      SELECT DISTINCT sourcing_item_id FROM products WHERE business_account_id = ?
    `).all(workspaceId) as unknown as { sourcing_item_id: string }[]
    const productsByItem = new Set(productRows.map(row => row.sourcing_item_id))
    return items.map(item => ({
      item,
      decision: decisions.get(item.id) ?? null,
      scoresJson: decisions.get(item.id)?.scoresJson ?? null,
      productCreated: productsByItem.has(item.id),
    }))
  }

  listProductViews(workspaceId: string): ProductView[] {
    const productRows = this.db.prepare(`
      SELECT * FROM products WHERE business_account_id = ? ORDER BY created_at DESC, id DESC
    `).all(workspaceId) as unknown as Record<string, unknown>[]
    const variantRows = this.db.prepare(`
      SELECT product_id, purchase_price_minor FROM product_variants ORDER BY id
    `).all() as unknown as { product_id: string; purchase_price_minor: number }[]
    const costs = new Map<string, number>()
    for (const row of variantRows) {
      if (!costs.has(row.product_id)) costs.set(row.product_id, row.purchase_price_minor)
    }
    return productRows.map(row => ({
      product: {
        id: String(row['id']),
        businessAccountId: String(row['business_account_id']),
        sourcingItemId: row['sourcing_item_id'] === null ? null : String(row['sourcing_item_id']),
        createdFromSelectionId: row['created_from_selection_id'] === null ? null : String(row['created_from_selection_id']),
        title: String(row['title']),
        coreCategoryId: String(row['core_category_id']),
        currency: String(row['currency']),
        riskStatus: row['risk_status'] as Product['riskStatus'],
        status: row['status'] as Product['status'],
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
      },
      purchasePriceMinor: costs.get(String(row['id'])) ?? null,
    }))
  }

  auditEvents(workspaceId: string, limit = 100): AuditEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?
    `).all(workspaceId, limit) as unknown as AuditRow[]
    return rows.map(mapAudit)
  }

  close(): void {
    this.db.close()
  }

  private itemRows(where: string, params: string[]): SourcingItemRow[] {
    return this.db.prepare(`SELECT * FROM sourcing_items ${where}`).all(...params) as unknown as SourcingItemRow[]
  }

  private firstItem(where: string, params: string[]): SourcingItem | undefined {
    const rows = this.itemRows(where, params)
    const row = rows[0]
    return row === undefined ? undefined : mapItem(row)
  }
}
