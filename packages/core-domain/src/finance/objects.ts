/** Finance objects per CORE_MODEL 11.1-11.2 and 08 S5. Profit figures are estimates;
 * platform fee and exchange rate come from operator/seller configuration, not real settlement. */

export type CostEntryType =
  | 'purchase'
  | 'shipping'
  | 'platform_fee'
  | 'commission'
  | 'ai_usage'
  | 'adjustment'

export type CostEntryDirection = 'inflow' | 'outflow'
export type CostEntrySourceType = 'manual' | 'imported' | 'calculated' | 'platform'

export interface CostLedgerEntry {
  id: string
  workspaceId: string
  relatedType: 'order' | 'fulfillment' | 'procurement_order' | 'listing_draft' | 'sourcing_item'
  relatedId: string
  costType: CostEntryType
  direction: CostEntryDirection
  amountMinor: number
  currency: string
  baseAmountMinor: number
  baseCurrency: string
  exchangeRateSnapshot: number
  occurredAt: string
  sourceType: CostEntrySourceType
  sourceKey: string
  notes: string | null
}

export interface FinanceSettings {
  workspaceId: string
  baseCurrency: string
  /** Basis points charged by the marketplace; 500 = 5%. */
  platformFeeBps: number
  /** Estimated model cost in minor units per one million tokens. Values stay configurable. */
  aiInputCostMinorPerMillionTokens: number
  aiOutputCostMinorPerMillionTokens: number
  /** Rates are normalized as `currency -> rate to baseCurrency`. */
  exchangeRates: Record<string, number>
  updatedAt: string
}

export interface ProfitSummary {
  id: string
  workspaceId: string
  scopeType: 'period'
  scopeId: string
  revenueMinor: number
  costMinor: number
  aiCostMinor: number
  grossProfitMinor: number
  netProfitMinor: number
  currency: string
  periodStart: string
  periodEnd: string
}

export interface DailyReport {
  id: string
  workspaceId: string
  reportDate: string
  generatedAt: string
  orderCount: number
  revenueMinor: number
  costMinor: number
  netProfitMinor: number
  currency: string
  blockers: string[]
}

export interface SourcePerformance {
  sourcingItemId: string
  orderCount: number
  revenueMinor: number
  costMinor: number
  netProfitMinor: number
  currency: string
}
