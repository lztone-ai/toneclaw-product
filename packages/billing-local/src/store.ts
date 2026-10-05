import { DatabaseSync } from 'node:sqlite'

/** SQLite persistence for the local billing authority (PHASE1_TECH_DESIGN 4.12: local authoritative store). */
export class BillingStore {
  private readonly db: DatabaseSync

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path)
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        last_validated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quotas (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        period_type TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        token_limit INTEGER NOT NULL,
        used_input_tokens INTEGER NOT NULL,
        used_output_tokens INTEGER NOT NULL,
        request_limit INTEGER NOT NULL,
        used_requests INTEGER NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quotas_workspace ON quotas(workspace_id, period_end);
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        scene TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        reserved_input_tokens INTEGER NOT NULL,
        reserved_output_tokens INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost_estimate_minor INTEGER,
        estimated INTEGER NOT NULL,
        failure TEXT,
        related_object_type TEXT,
        related_object_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        audit_ref TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_idempotency ON usage_records(workspace_id, idempotency_key);
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

  transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = body()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  prepare(sql: string) {
    return this.db.prepare(sql)
  }

  close(): void {
    this.db.close()
  }
}
