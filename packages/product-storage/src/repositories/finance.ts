/** Finance estimate repositories (S5). Amounts stay in integer minor units. */
import type { DatabaseSync } from 'node:sqlite'
import type { FinanceRepositories } from '@toneclaw/core-domain'
import type {
  CostLedgerEntry,
  DailyReport,
  FinanceSettings,
  ProfitSummary,
} from '@toneclaw/core-domain'

interface SettingsRow {
  workspace_id: string
  base_currency: string
  platform_fee_bps: number
  exchange_rates_json: string
  updated_at: string
}

interface CostEntryRow {
  id: string
  workspace_id: string
  related_type: CostLedgerEntry['relatedType']
  related_id: string
  cost_type: CostLedgerEntry['costType']
  direction: CostLedgerEntry['direction']
  amount_minor: number
  currency: string
  base_amount_minor: number
  base_currency: string
  exchange_rate_snapshot: number
  occurred_at: string
  source_type: CostLedgerEntry['sourceType']
  source_key: string
  notes: string | null
}

interface ProfitSummaryRow {
  id: string
  workspace_id: string
  scope_type: ProfitSummary['scopeType']
  scope_id: string
  revenue_minor: number
  cost_minor: number
  gross_profit_minor: number
  net_profit_minor: number
  currency: string
  period_start: string
  period_end: string
}

interface DailyReportRow {
  id: string
  workspace_id: string
  report_date: string
  generated_at: string
  order_count: number
  revenue_minor: number
  cost_minor: number
  net_profit_minor: number
  currency: string
  blockers_json: string
}

function mapSettings(row: SettingsRow): FinanceSettings {
  return {
    workspaceId: row.workspace_id,
    baseCurrency: row.base_currency,
    platformFeeBps: row.platform_fee_bps,
    exchangeRates: JSON.parse(row.exchange_rates_json) as Record<string, number>,
    updatedAt: row.updated_at,
  }
}

function mapCostEntry(row: CostEntryRow): CostLedgerEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    relatedType: row.related_type,
    relatedId: row.related_id,
    costType: row.cost_type,
    direction: row.direction,
    amountMinor: row.amount_minor,
    currency: row.currency,
    baseAmountMinor: row.base_amount_minor,
    baseCurrency: row.base_currency,
    exchangeRateSnapshot: row.exchange_rate_snapshot,
    occurredAt: row.occurred_at,
    sourceType: row.source_type,
    sourceKey: row.source_key,
    notes: row.notes,
  }
}

function mapProfitSummary(row: ProfitSummaryRow): ProfitSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    revenueMinor: row.revenue_minor,
    costMinor: row.cost_minor,
    grossProfitMinor: row.gross_profit_minor,
    netProfitMinor: row.net_profit_minor,
    currency: row.currency,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  }
}

function mapDailyReport(row: DailyReportRow): DailyReport {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    reportDate: row.report_date,
    generatedAt: row.generated_at,
    orderCount: row.order_count,
    revenueMinor: row.revenue_minor,
    costMinor: row.cost_minor,
    netProfitMinor: row.net_profit_minor,
    currency: row.currency,
    blockers: JSON.parse(row.blockers_json) as string[],
  }
}

export function createFinanceRepositories(db: DatabaseSync): FinanceRepositories {
  return {
    settings: {
      find: async workspaceId => {
        const row = db.prepare('SELECT * FROM finance_settings WHERE workspace_id = ? LIMIT 1')
          .get(workspaceId) as unknown as SettingsRow | undefined
        return row === undefined ? undefined : mapSettings(row)
      },
      upsert: async settings => {
        db.prepare(`
          INSERT INTO finance_settings (
            workspace_id, base_currency, platform_fee_bps, exchange_rates_json, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            base_currency = excluded.base_currency,
            platform_fee_bps = excluded.platform_fee_bps,
            exchange_rates_json = excluded.exchange_rates_json,
            updated_at = excluded.updated_at
        `).run(
          settings.workspaceId, settings.baseCurrency, settings.platformFeeBps,
          JSON.stringify(settings.exchangeRates), settings.updatedAt,
        )
      },
    },
    costEntries: {
      upsert: async entry => {
        db.prepare(`
          INSERT INTO cost_ledger_entries (
            id, workspace_id, related_type, related_id, cost_type, direction,
            amount_minor, currency, base_amount_minor, base_currency,
            exchange_rate_snapshot, occurred_at, source_type, source_key, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, source_key) DO UPDATE SET
            related_type = excluded.related_type,
            related_id = excluded.related_id,
            cost_type = excluded.cost_type,
            direction = excluded.direction,
            amount_minor = excluded.amount_minor,
            currency = excluded.currency,
            base_amount_minor = excluded.base_amount_minor,
            base_currency = excluded.base_currency,
            exchange_rate_snapshot = excluded.exchange_rate_snapshot,
            occurred_at = excluded.occurred_at,
            source_type = excluded.source_type,
            notes = excluded.notes
        `).run(
          entry.id, entry.workspaceId, entry.relatedType, entry.relatedId,
          entry.costType, entry.direction, entry.amountMinor, entry.currency,
          entry.baseAmountMinor, entry.baseCurrency, entry.exchangeRateSnapshot,
          entry.occurredAt, entry.sourceType, entry.sourceKey, entry.notes,
        )
      },
      list: async workspaceId => {
        const rows = db.prepare(`
          SELECT * FROM cost_ledger_entries WHERE workspace_id = ?
          ORDER BY occurred_at ASC, source_key ASC
        `).all(workspaceId) as unknown as CostEntryRow[]
        return rows.map(mapCostEntry)
      },
      deleteCalculated: async workspaceId => {
        db.prepare("DELETE FROM cost_ledger_entries WHERE workspace_id = ? AND source_type = 'calculated'")
          .run(workspaceId)
      },
    },
    profitSummaries: {
      upsert: async summary => {
        db.prepare(`
          INSERT INTO profit_summaries (
            id, workspace_id, scope_type, scope_id, revenue_minor, cost_minor,
            gross_profit_minor, net_profit_minor, currency, period_start, period_end
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, scope_type, scope_id) DO UPDATE SET
            revenue_minor = excluded.revenue_minor,
            cost_minor = excluded.cost_minor,
            gross_profit_minor = excluded.gross_profit_minor,
            net_profit_minor = excluded.net_profit_minor,
            currency = excluded.currency,
            period_start = excluded.period_start,
            period_end = excluded.period_end
        `).run(
          summary.id, summary.workspaceId, summary.scopeType, summary.scopeId,
          summary.revenueMinor, summary.costMinor, summary.grossProfitMinor,
          summary.netProfitMinor, summary.currency, summary.periodStart, summary.periodEnd,
        )
      },
      findCurrent: async workspaceId => {
        const row = db.prepare(`
          SELECT * FROM profit_summaries WHERE workspace_id = ?
          ORDER BY period_end DESC, period_start DESC LIMIT 1
        `).get(workspaceId) as unknown as ProfitSummaryRow | undefined
        return row === undefined ? undefined : mapProfitSummary(row)
      },
    },
    dailyReports: {
      upsert: async report => {
        db.prepare(`
          INSERT INTO daily_reports (
            id, workspace_id, report_date, generated_at, order_count, revenue_minor,
            cost_minor, net_profit_minor, currency, blockers_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, report_date) DO UPDATE SET
            generated_at = excluded.generated_at,
            order_count = excluded.order_count,
            revenue_minor = excluded.revenue_minor,
            cost_minor = excluded.cost_minor,
            net_profit_minor = excluded.net_profit_minor,
            currency = excluded.currency,
            blockers_json = excluded.blockers_json
        `).run(
          report.id, report.workspaceId, report.reportDate, report.generatedAt,
          report.orderCount, report.revenueMinor, report.costMinor,
          report.netProfitMinor, report.currency, JSON.stringify(report.blockers),
        )
      },
      list: async (workspaceId, limit = 30) => {
        const rows = db.prepare(`
          SELECT * FROM daily_reports WHERE workspace_id = ?
          ORDER BY report_date DESC LIMIT ?
        `).all(workspaceId, limit) as unknown as DailyReportRow[]
        return rows.map(mapDailyReport)
      },
    },
  }
}
