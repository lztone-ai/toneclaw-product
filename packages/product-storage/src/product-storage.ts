/** SQLite implementation of the core-domain repository ports (node:sqlite). */
import { DatabaseSync } from 'node:sqlite'
import type { AuditSink } from '@toneclaw/core-domain'
import type {
  AuditEvent,
  ProductRepository,
  SelectionDecision,
  SelectionDecisionRepository,
  SourcingItem,
  SourcingItemRepository,
} from '@toneclaw/core-domain'

interface SourcingItemRow {
  id: string
  business_account_id: string
  supplier_id: string
  data_source_id: string
  external_source_id: string | null
  title: string
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

function mapItem(row: SourcingItemRow): SourcingItem {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    supplierId: row.supplier_id,
    dataSourceId: row.data_source_id,
    externalSourceId: row.external_source_id,
    title: row.title,
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
        external_source_id TEXT,
        title TEXT NOT NULL,
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
    `)
  }

  get sourcingItems(): SourcingItemRepository {
    return {
      findById: async (workspaceId, id) =>
        this.firstItem(`WHERE id = ? AND business_account_id = ? LIMIT 1`, [id, workspaceId]),
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

  listSourcingItems(workspaceId: string): SourcingItem[] {
    return this.itemRows(`WHERE business_account_id = ? ORDER BY updated_at DESC`, [workspaceId]).map(mapItem)
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
