/** Versioned schema migrations (PRAGMA user_version). S2 baseline = v1; every later stage
 * (S3-S5) adds a numbered migration instead of patching addColumnIfMissing onto the God schema. */
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  apply: (db: DatabaseSync) => void
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some(entry => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function dropColumnIfPresent(db: DatabaseSync, table: string, column: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some(entry => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  }
}

const BASELINE = `
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
`

const PLATFORM_AUTHORIZATION = `
      CREATE TABLE IF NOT EXISTS business_workspaces (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_default
        ON business_workspaces(business_account_id) WHERE is_default = 1;
      CREATE TABLE IF NOT EXISTS external_seller_accounts (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        external_seller_account_id TEXT NOT NULL,
        display_name TEXT,
        region TEXT,
        status TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        last_verified_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_esa_platform_external
        ON external_seller_accounts(business_account_id, platform, external_seller_account_id);
      CREATE TABLE IF NOT EXISTS platform_connections (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        external_seller_account_id TEXT NOT NULL,
        connection_type TEXT NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        connected_by_user_id TEXT NOT NULL,
        connected_at TEXT NOT NULL,
        expires_at TEXT,
        last_verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_connections_account ON platform_connections(business_account_id, status);
      CREATE TABLE IF NOT EXISTS platform_credentials (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        platform_connection_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        secret_ref TEXT NOT NULL,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        expires_at TEXT,
        last_verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_credentials_connection
        ON platform_credentials(platform_connection_id, status);
      CREATE TABLE IF NOT EXISTS stores (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        platform_connection_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        external_seller_account_id TEXT NOT NULL,
        external_store_id TEXT NOT NULL,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        business_mode TEXT NOT NULL,
        currency TEXT NOT NULL,
        timezone TEXT NOT NULL,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL,
        last_synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_stores_account ON stores(business_account_id, status);
      CREATE TABLE IF NOT EXISTS store_capabilities (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_capabilities_store_key
        ON store_capabilities(store_id, capability_key);
`

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline_s2_schema',
    apply: db => {
      db.exec(BASELINE)
      ensureColumn(db, 'sourcing_items', 'source_record_id', "TEXT NOT NULL DEFAULT ''")
      ensureColumn(db, 'sourcing_items', 'description_raw', 'TEXT')
    },
  },
  {
    version: 2,
    name: 'platform_authorization_a0',
    apply: db => {
      db.exec(PLATFORM_AUTHORIZATION)
      // L-E residue disposal (R-2026-10-06): store_id was always null; catalog import is store-independent.
      dropColumnIfPresent(db, 'sourcing_import_batches', 'store_id')
    },
  },
]

export function runMigrations(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (const migration of MIGRATIONS) {
    if (migration.version <= row.user_version) continue
    db.exec('BEGIN')
    try {
      migration.apply(db)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
