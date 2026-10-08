/** Repository ports for the finance subdomain; SQLite lives in product-storage. */
import type {
  CostLedgerEntry,
  DailyReport,
  FinanceSettings,
  ProfitSummary,
} from './objects.ts'

export interface FinanceSettingsRepository {
  find(workspaceId: string): Promise<FinanceSettings | undefined>
  upsert(settings: FinanceSettings): Promise<void>
}

export interface CostLedgerEntryRepository {
  upsert(entry: CostLedgerEntry): Promise<void>
  list(workspaceId: string): Promise<CostLedgerEntry[]>
  deleteCalculated(workspaceId: string): Promise<void>
}

export interface ProfitSummaryRepository {
  upsert(summary: ProfitSummary): Promise<void>
  findCurrent(workspaceId: string): Promise<ProfitSummary | undefined>
}

export interface DailyReportRepository {
  upsert(report: DailyReport): Promise<void>
  list(workspaceId: string, limit?: number): Promise<DailyReport[]>
}

export interface FinanceRepositories {
  settings: FinanceSettingsRepository
  costEntries: CostLedgerEntryRepository
  profitSummaries: ProfitSummaryRepository
  dailyReports: DailyReportRepository
}
