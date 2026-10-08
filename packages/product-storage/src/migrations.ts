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

const LISTING_GENERATION = `
      CREATE TABLE IF NOT EXISTS platform_fit_assessments (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        result TEXT NOT NULL,
        category_mapping_id TEXT,
        compliance_status TEXT NOT NULL,
        media_status TEXT NOT NULL,
        price_status TEXT NOT NULL,
        risk_score REAL,
        findings_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        assessed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assessments_product
        ON platform_fit_assessments(business_account_id, product_id, assessed_at);
      CREATE TABLE IF NOT EXISTS content_drafts (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        language TEXT NOT NULL,
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        generated_by TEXT NOT NULL,
        model TEXT,
        usage_record_id TEXT,
        status TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_draft_version
        ON content_drafts(business_account_id, product_id, content_type, version);
      CREATE TABLE IF NOT EXISTS listing_drafts (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_fit_assessment_id TEXT NOT NULL,
        title_content_draft_id TEXT,
        description_content_draft_id TEXT,
        bullets_content_draft_id TEXT,
        keywords_content_draft_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        bullets_json TEXT NOT NULL DEFAULT '[]',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        platform_category_id TEXT NOT NULL,
        attributes_json TEXT NOT NULL DEFAULT '[]',
        price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        stock_qty INTEGER NOT NULL,
        media_variant_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        validation_result_json TEXT,
        approved_by TEXT,
        approved_at TEXT,
        last_synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_listing_drafts_account
        ON listing_drafts(business_account_id, status, created_at);
      CREATE TABLE IF NOT EXISTS listing_draft_content_links (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        listing_draft_id TEXT NOT NULL,
        content_draft_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        is_selected INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_content_link
        ON listing_draft_content_links(listing_draft_id, content_type, content_draft_id);
      CREATE INDEX IF NOT EXISTS idx_listing_content_selected
        ON listing_draft_content_links(listing_draft_id, content_type, is_selected);
      CREATE TABLE IF NOT EXISTS manual_listing_packages (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        listing_draft_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        file_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_manual_packages_account
        ON manual_listing_packages(business_account_id, created_at);
`

const LISTING_GOVERNANCE = `
      CREATE TABLE IF NOT EXISTS listing_draft_variants (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        listing_draft_id TEXT NOT NULL,
        product_variant_id TEXT NOT NULL,
        platform_variant_key TEXT NOT NULL,
        external_variant_id TEXT,
        attributes_json TEXT NOT NULL DEFAULT '[]',
        price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        stock_qty INTEGER NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_listing_variants_draft
        ON listing_draft_variants(business_account_id, listing_draft_id);
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        storage_ref TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        checksum TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        rights_status TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_assets_owner
        ON media_assets(business_account_id, owner_type, owner_id);
      CREATE TABLE IF NOT EXISTS media_variants (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        media_asset_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        purpose TEXT NOT NULL,
        spec_key TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        storage_ref TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_variants_asset
        ON media_variants(business_account_id, media_asset_id, platform);
      CREATE TABLE IF NOT EXISTS platform_category_mappings (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        category_id TEXT NOT NULL,
        external_category_id TEXT NOT NULL,
        external_path TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_category_mappings_unique
        ON platform_category_mappings(business_account_id, platform, category_id);
      CREATE TABLE IF NOT EXISTS platform_attribute_mappings (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        attribute_key TEXT NOT NULL,
        attribute_name TEXT NOT NULL,
        external_attribute_key TEXT NOT NULL,
        external_attribute_name TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 0,
        value_mapping_json TEXT,
        status TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attribute_mappings_unique
        ON platform_attribute_mappings(business_account_id, platform, attribute_key);
      CREATE TABLE IF NOT EXISTS approval_tasks (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approval_tasks_target
        ON approval_tasks(business_account_id, target_type, target_id, status);
      CREATE INDEX IF NOT EXISTS idx_approval_tasks_pending
        ON approval_tasks(business_account_id, status, created_at);
`

const PUBLISHING_CENTER = `
      CREATE TABLE IF NOT EXISTS publish_jobs (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        listing_draft_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempt_count INTEGER NOT NULL DEFAULT 3,
        external_job_ref TEXT,
        error_catalog_id TEXT,
        manual_package_id TEXT,
        next_action TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_publish_jobs_account
        ON publish_jobs(business_account_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_publish_jobs_draft
        ON publish_jobs(business_account_id, listing_draft_id);
      CREATE TABLE IF NOT EXISTS platform_listings (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        listing_draft_id TEXT,
        origin TEXT NOT NULL,
        store_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        external_listing_id TEXT NOT NULL,
        url TEXT,
        core_status TEXT NOT NULL,
        raw_status TEXT NOT NULL,
        price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        stock_qty INTEGER NOT NULL,
        last_synced_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_listings_external
        ON platform_listings(business_account_id, store_id, external_listing_id);
      CREATE INDEX IF NOT EXISTS idx_platform_listings_account
        ON platform_listings(business_account_id, core_status);
      CREATE TABLE IF NOT EXISTS listing_revisions (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        platform_listing_id TEXT,
        listing_draft_id TEXT NOT NULL,
        publish_job_id TEXT,
        revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_listing_revisions_draft
        ON listing_revisions(business_account_id, listing_draft_id, revision);
      CREATE INDEX IF NOT EXISTS idx_listing_revisions_listing
        ON listing_revisions(business_account_id, platform_listing_id, revision);
`

const COMMERCE_OPERATIONS = `
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        external_order_id TEXT NOT NULL,
        order_number TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_status TEXT NOT NULL,
        currency TEXT NOT NULL,
        subtotal_minor INTEGER NOT NULL,
        shipping_minor INTEGER NOT NULL,
        discount_minor INTEGER,
        tax_minor INTEGER,
        total_minor INTEGER NOT NULL,
        placed_at TEXT NOT NULL,
        last_synced_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_external
        ON orders(business_account_id, platform, external_order_id);
      CREATE INDEX IF NOT EXISTS idx_orders_store
        ON orders(business_account_id, store_id, status);
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        product_id TEXT,
        product_variant_id TEXT,
        platform_listing_id TEXT,
        external_item_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        title TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_minor INTEGER NOT NULL,
        currency TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order
        ON order_items(business_account_id, order_id);
      CREATE TABLE IF NOT EXISTS fulfillments (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        external_fulfillment_id TEXT,
        fulfillment_type TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_status TEXT NOT NULL,
        carrier TEXT,
        tracking_number TEXT,
        shipped_at TEXT,
        delivered_at TEXT,
        exception_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fulfillments_order
        ON fulfillments(business_account_id, order_id, status);
      CREATE TABLE IF NOT EXISTS procurement_orders (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        marketplace_order_id TEXT NOT NULL,
        fulfillment_id TEXT NOT NULL,
        sourcing_item_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        status TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost_minor INTEGER NOT NULL,
        shipping_fee_minor INTEGER NOT NULL,
        service_fee_minor INTEGER NOT NULL,
        total_payable_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        quote_confirmed_at TEXT,
        payment_due_at TEXT,
        provider_promised_ship_at TEXT,
        shipped_at TEXT,
        tracking_number TEXT,
        carrier TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_procurement_orders_account
        ON procurement_orders(business_account_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_procurement_orders_order
        ON procurement_orders(business_account_id, marketplace_order_id);
      CREATE TABLE IF NOT EXISTS payment_sessions (
        id TEXT PRIMARY KEY,
        business_account_id TEXT NOT NULL,
        procurement_order_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_payment_id TEXT,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        payment_url TEXT,
        payment_reference_no TEXT NOT NULL,
        expires_at TEXT,
        redirect_at TEXT,
        callback_received_at TEXT,
        confirmed_at TEXT,
        failure_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_sessions_reference
        ON payment_sessions(business_account_id, payment_reference_no);
      CREATE INDEX IF NOT EXISTS idx_payment_sessions_procurement
        ON payment_sessions(business_account_id, procurement_order_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_payment_sessions_status
        ON payment_sessions(business_account_id, status);
`

const FINANCE_ESTIMATES_S5 = `
      CREATE TABLE IF NOT EXISTS finance_settings (
        workspace_id TEXT PRIMARY KEY,
        base_currency TEXT NOT NULL,
        platform_fee_bps INTEGER NOT NULL,
        exchange_rates_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cost_ledger_entries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        related_type TEXT NOT NULL,
        related_id TEXT NOT NULL,
        cost_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        base_amount_minor INTEGER NOT NULL,
        base_currency TEXT NOT NULL,
        exchange_rate_snapshot REAL NOT NULL,
        occurred_at TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_key TEXT NOT NULL,
        notes TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_entries_source_key
        ON cost_ledger_entries(workspace_id, source_key);
      CREATE INDEX IF NOT EXISTS idx_cost_entries_workspace
        ON cost_ledger_entries(workspace_id, occurred_at, source_type);
      CREATE TABLE IF NOT EXISTS profit_summaries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        revenue_minor INTEGER NOT NULL,
        cost_minor INTEGER NOT NULL,
        gross_profit_minor INTEGER NOT NULL,
        net_profit_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profit_summaries_scope
        ON profit_summaries(workspace_id, scope_type, scope_id);
      CREATE TABLE IF NOT EXISTS daily_reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        report_date TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        order_count INTEGER NOT NULL,
        revenue_minor INTEGER NOT NULL,
        cost_minor INTEGER NOT NULL,
        net_profit_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        blockers_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_date
        ON daily_reports(workspace_id, report_date);
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
  {
    version: 3,
    name: 'listing_generation_slice_d',
    apply: db => {
      db.exec(LISTING_GENERATION)
    },
  },
  {
    version: 4,
    name: 'listing_governance_d1',
    apply: db => {
      db.exec(LISTING_GOVERNANCE)
    },
  },
  {
    version: 5,
    name: 'publishing_center_slice_e',
    apply: db => {
      db.exec(PUBLISHING_CENTER)
      ensureColumn(db, 'manual_listing_packages', 'platform', "TEXT NOT NULL DEFAULT 'temu'")
      ensureColumn(db, 'manual_listing_packages', 'format', "TEXT NOT NULL DEFAULT 'json'")
      ensureColumn(db, 'manual_listing_packages', 'storage_ref', "TEXT NOT NULL DEFAULT ''")
      ensureColumn(db, 'manual_listing_packages', 'status', "TEXT NOT NULL DEFAULT 'generated'")
      ensureColumn(db, 'manual_listing_packages', 'submitted_by', 'TEXT')
      ensureColumn(db, 'manual_listing_packages', 'submitted_at', 'TEXT')
      ensureColumn(db, 'manual_listing_packages', 'external_listing_id', 'TEXT')
    },
  },
  {
    version: 6,
    name: 'commerce_operations_s4',
    apply: db => {
      db.exec(COMMERCE_OPERATIONS)
    },
  },
  {
    version: 7,
    name: 'finance_estimates_s5',
    apply: db => {
      db.exec(FINANCE_ESTIMATES_S5)
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
