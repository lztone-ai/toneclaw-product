/** S5 estimate engine: derive configured profit summaries and daily reports from S4 objects.
 * This is explicitly not platform settlement reconciliation; all calculated rows are traceable. */
import type { AuditSink, Clock, IdGenerator } from '../ports.ts'
import type { Order, OrderItem, ProcurementOrder, PaymentSession } from '../commerce/objects.ts'
import type { CommerceRepositories } from '../commerce/ports.ts'
import type { AuditActorType } from '../objects.ts'
import type {
  CostLedgerEntry,
  DailyReport,
  FinanceSettings,
  ProfitSummary,
  SourcePerformance,
} from './objects.ts'
import type { FinanceRepositories } from './ports.ts'

export interface FinanceDeps extends FinanceRepositories {
  ids: IdGenerator
  clock: Clock
  audit: AuditSink
  orders: CommerceRepositories['orders']
  orderItems: CommerceRepositories['orderItems']
  procurements: CommerceRepositories['procurementOrders']
  payments: CommerceRepositories['paymentSessions']
}

export interface UpdateFinanceSettingsInput {
  workspaceId: string
  actorId: string
  baseCurrency: string
  platformFeeBps: number
  aiInputCostMinorPerMillionTokens: number
  aiOutputCostMinorPerMillionTokens: number
  exchangeRates: Record<string, number>
}

export interface FinanceAiUsage {
  id: string
  inputTokens: number
  outputTokens: number
  /** Provider/billing-local estimate in base-currency minor units; token rates are used when null. */
  costEstimateMinor?: number | null
  occurredAt: string
  relatedType: CostLedgerEntry['relatedType']
  relatedId: string
}

export interface RebuildFinanceInput {
  workspaceId: string
  actorId: string
  aiUsage?: FinanceAiUsage[]
}

export interface FinanceRebuildResult {
  settings: FinanceSettings
  summary: ProfitSummary
  reports: DailyReport[]
  sourcePerformance: SourcePerformance[]
  aiCostMinor: number
}

function auditEvent(
  deps: FinanceDeps,
  workspaceId: string,
  action: string,
  objectId: string,
  after: unknown,
  actorId: string,
): void {
  const actorType: AuditActorType = actorId === 'finance-domain' ? 'system' : 'user'
  deps.audit.append({
    id: deps.ids.next(), workspaceId, actorType, actorId, action,
    objectType: 'FinanceSettings', objectId, before: null,
    after: JSON.stringify(after), reason: null, source: 'core-domain',
    occurredAt: deps.clock.now().toISOString(), traceId: null,
  })
}

function normalizeCurrency(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error('currency must be a three-letter code')
  return normalized
}

function normalizeRates(input: Record<string, number>): Record<string, number> {
  const rates: Record<string, number> = {}
  for (const [currency, rate] of Object.entries(input)) {
    const key = normalizeCurrency(currency)
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`exchange rate for ${key} must be a positive number`)
    }
    rates[key] = rate
  }
  return rates
}

/** Settings default to the P0 connected-store currency; rates remain explicit and editable. */
export async function ensureFinanceSettings(
  deps: FinanceDeps,
  workspaceId: string,
): Promise<FinanceSettings> {
  const existing = await deps.settings.find(workspaceId)
  if (existing !== undefined) return existing
  const settings: FinanceSettings = {
    workspaceId,
    baseCurrency: 'USD',
    platformFeeBps: 500,
    aiInputCostMinorPerMillionTokens: 0,
    aiOutputCostMinorPerMillionTokens: 0,
    exchangeRates: { USD: 1 },
    updatedAt: deps.clock.now().toISOString(),
  }
  await deps.settings.upsert(settings)
  auditEvent(deps, workspaceId, 'finance.settings.created', workspaceId, {
    baseCurrency: settings.baseCurrency,
    platformFeeBps: settings.platformFeeBps,
    exchangeRates: settings.exchangeRates,
  }, 'finance-domain')
  return settings
}

export async function updateFinanceSettings(
  deps: FinanceDeps,
  input: UpdateFinanceSettingsInput,
): Promise<FinanceSettings> {
  if (!Number.isInteger(input.platformFeeBps) || input.platformFeeBps < 0 || input.platformFeeBps > 10_000) {
    throw new Error('platformFeeBps must be an integer from 0 to 10000')
  }
  const aiRates = [
    ['aiInputCostMinorPerMillionTokens', input.aiInputCostMinorPerMillionTokens],
    ['aiOutputCostMinorPerMillionTokens', input.aiOutputCostMinorPerMillionTokens],
  ] as const
  for (const [name, value] of aiRates) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`)
    }
  }
  const current = await ensureFinanceSettings(deps, input.workspaceId)
  const rates = normalizeRates(input.exchangeRates)
  const base = normalizeCurrency(input.baseCurrency)
  if (rates[base] !== 1) throw new Error(`exchange rate for base currency ${base} must be 1`)
  const settings: FinanceSettings = {
    workspaceId: input.workspaceId,
    baseCurrency: base,
    platformFeeBps: input.platformFeeBps,
    aiInputCostMinorPerMillionTokens: input.aiInputCostMinorPerMillionTokens,
    aiOutputCostMinorPerMillionTokens: input.aiOutputCostMinorPerMillionTokens,
    exchangeRates: rates,
    updatedAt: deps.clock.now().toISOString(),
  }
  await deps.settings.upsert(settings)
  auditEvent(deps, input.workspaceId, 'finance.settings.updated', settings.workspaceId, {
    before: { baseCurrency: current.baseCurrency, platformFeeBps: current.platformFeeBps, exchangeRates: current.exchangeRates },
    after: { baseCurrency: settings.baseCurrency, platformFeeBps: settings.platformFeeBps, exchangeRates: settings.exchangeRates },
  }, input.actorId)
  return settings
}

function toBase(
  amountMinor: number,
  currency: string,
  settings: FinanceSettings,
): { baseAmountMinor: number; rate: number } {
  const rate = settings.exchangeRates[currency]
  if (rate === undefined) {
    throw new Error(`missing exchange rate for ${currency}; configure finance settings first`)
  }
  return { baseAmountMinor: Math.round(amountMinor * rate), rate }
}

async function upsertCost(
  deps: FinanceDeps,
  workspaceId: string,
  entry: Omit<CostLedgerEntry, 'id' | 'workspaceId'>,
): Promise<void> {
  await deps.costEntries.upsert({ ...entry, id: deps.ids.next(), workspaceId })
}

function dateKey(value: string): string {
  return value.slice(0, 10)
}

function aiCostEstimateMinor(
  usage: FinanceAiUsage,
  settings: FinanceSettings,
): number {
  if (usage.costEstimateMinor !== undefined && usage.costEstimateMinor !== null) {
    if (!Number.isSafeInteger(usage.costEstimateMinor) || usage.costEstimateMinor < 0) {
      throw new Error(`AI usage cost estimate must be a non-negative integer: ${usage.id}`)
    }
    return usage.costEstimateMinor
  }
  const inputMinor = usage.inputTokens * settings.aiInputCostMinorPerMillionTokens / 1_000_000
  const outputMinor = usage.outputTokens * settings.aiOutputCostMinorPerMillionTokens / 1_000_000
  return Math.round(inputMinor + outputMinor)
}

/** Deterministic, idempotent rebuild. Calculated rows are replaced; manual rows survive. */
export async function rebuildFinance(
  deps: FinanceDeps,
  input: RebuildFinanceInput,
): Promise<FinanceRebuildResult> {
  const settings = await ensureFinanceSettings(deps, input.workspaceId)
  const [orders, procurements] = await Promise.all([
    deps.orders.list(input.workspaceId),
    deps.procurements.list(input.workspaceId),
  ])
  await deps.costEntries.deleteCalculated(input.workspaceId)

  const costs: Array<Omit<CostLedgerEntry, 'id' | 'workspaceId'>> = []
  for (const usage of input.aiUsage ?? []) {
    const amountMinor = aiCostEstimateMinor(usage, settings)
    if (amountMinor > 0) {
      costs.push({
        relatedType: usage.relatedType, relatedId: usage.relatedId,
        costType: 'ai_usage', direction: 'outflow', amountMinor,
        currency: settings.baseCurrency, baseAmountMinor: amountMinor,
        baseCurrency: settings.baseCurrency, exchangeRateSnapshot: 1,
        occurredAt: usage.occurredAt, sourceType: 'calculated',
        sourceKey: `ai_usage:${usage.id}`, notes: 'AI token usage cost estimate',
      })
    }
  }
  for (const order of orders) {
    if (order.status === 'canceled') continue
    const feeMinor = Math.round(order.subtotalMinor * settings.platformFeeBps / 10_000)
    if (feeMinor > 0) {
      const base = toBase(feeMinor, order.currency, settings)
      costs.push({
        relatedType: 'order', relatedId: order.id, costType: 'platform_fee',
        direction: 'outflow', amountMinor: feeMinor, currency: order.currency,
        baseAmountMinor: base.baseAmountMinor, baseCurrency: settings.baseCurrency,
        exchangeRateSnapshot: base.rate, occurredAt: order.placedAt,
        sourceType: 'calculated', sourceKey: `platform_fee:${order.id}`,
        notes: `platform fee estimate at ${settings.platformFeeBps} bps`,
      })
    }
  }

  for (const procurement of procurements) {
    const currency = procurement.currency
    const purchaseBase = toBase(procurement.quantity * procurement.unitCostMinor, currency, settings)
    if (purchaseBase.baseAmountMinor > 0) {
      costs.push({
        relatedType: 'procurement_order', relatedId: procurement.id, costType: 'purchase',
        direction: 'outflow', amountMinor: procurement.quantity * procurement.unitCostMinor,
        currency, baseAmountMinor: purchaseBase.baseAmountMinor, baseCurrency: settings.baseCurrency,
        exchangeRateSnapshot: purchaseBase.rate, occurredAt: procurement.createdAt,
        sourceType: 'calculated', sourceKey: `purchase:${procurement.id}`,
        notes: 'procurement cost estimate from quote',
      })
    }
    if (procurement.shippingFeeMinor > 0) {
      const shipping = toBase(procurement.shippingFeeMinor, currency, settings)
      costs.push({
        relatedType: 'procurement_order', relatedId: procurement.id, costType: 'shipping',
        direction: 'outflow', amountMinor: procurement.shippingFeeMinor, currency,
        baseAmountMinor: shipping.baseAmountMinor, baseCurrency: settings.baseCurrency,
        exchangeRateSnapshot: shipping.rate, occurredAt: procurement.createdAt,
        sourceType: 'calculated', sourceKey: `shipping:${procurement.id}`, notes: null,
      })
    }
    if (procurement.serviceFeeMinor > 0) {
      const service = toBase(procurement.serviceFeeMinor, currency, settings)
      costs.push({
        relatedType: 'procurement_order', relatedId: procurement.id, costType: 'commission',
        direction: 'outflow', amountMinor: procurement.serviceFeeMinor, currency,
        baseAmountMinor: service.baseAmountMinor, baseCurrency: settings.baseCurrency,
        exchangeRateSnapshot: service.rate, occurredAt: procurement.createdAt,
        sourceType: 'calculated', sourceKey: `service_fee:${procurement.id}`, notes: null,
      })
    }
    if (procurement.status === 'refunded') {
      const refunds = await deps.payments.listByProcurementOrder(input.workspaceId, procurement.id)
      const refund = refunds.at(-1)
      if (refund !== undefined) {
        const adjustment = toBase(refund.amountMinor, refund.currency, settings)
        costs.push({
          relatedType: 'procurement_order', relatedId: procurement.id, costType: 'adjustment',
          direction: 'inflow', amountMinor: refund.amountMinor, currency: refund.currency,
          baseAmountMinor: adjustment.baseAmountMinor, baseCurrency: settings.baseCurrency,
          exchangeRateSnapshot: adjustment.rate, occurredAt: refund.updatedAt,
          sourceType: 'calculated', sourceKey: `refund:${procurement.id}`,
          notes: 'refunded procurement payment',
        })
      }
    }
  }

  for (const cost of costs) await upsertCost(deps, input.workspaceId, cost)
  const persistedCosts = (await deps.costEntries.list(input.workspaceId))
    .filter(entry => entry.sourceType === 'calculated')

  const revenueMinor = orders
    .filter(order => order.status !== 'canceled')
    .reduce((sum, order) => sum + toBase(order.totalMinor, order.currency, settings).baseAmountMinor, 0)
  const costMinor = persistedCosts
    .filter(entry => entry.direction === 'outflow')
    .reduce((sum, entry) => sum + entry.baseAmountMinor, 0)
  const refundMinor = persistedCosts
    .filter(entry => entry.costType === 'adjustment' && entry.direction === 'inflow')
    .reduce((sum, entry) => sum + entry.baseAmountMinor, 0)
  const aiCostMinor = persistedCosts
    .filter(entry => entry.costType === 'ai_usage' && entry.direction === 'outflow')
    .reduce((sum, entry) => sum + entry.baseAmountMinor, 0)
  const generatedAt = deps.clock.now().toISOString()
  const periodStart = orders.map(order => order.placedAt).sort()[0] ?? generatedAt
  const periodEnd = orders.map(order => order.placedAt).sort().at(-1) ?? generatedAt
  const summary: ProfitSummary = {
    id: `summary-${input.workspaceId}`,
    workspaceId: input.workspaceId,
    scopeType: 'period', scopeId: 'all',
    revenueMinor, costMinor, aiCostMinor,
    grossProfitMinor: revenueMinor - costMinor,
    netProfitMinor: revenueMinor - costMinor + refundMinor,
    currency: settings.baseCurrency, periodStart, periodEnd,
  }
  await deps.profitSummaries.upsert(summary)

  const reportDates = [...new Set([
    ...orders.filter(order => order.status !== 'canceled').map(order => dateKey(order.placedAt)),
    ...persistedCosts.map(cost => dateKey(cost.occurredAt)),
  ])]
    .sort((left, right) => left.localeCompare(right))
  const reports: DailyReport[] = []
  for (const reportDate of reportDates) {
    const dayOrders = orders.filter(order => order.status !== 'canceled' && dateKey(order.placedAt) === reportDate)
    const dayRevenue = dayOrders.reduce((sum, order) => sum + toBase(order.totalMinor, order.currency, settings).baseAmountMinor, 0)
    const dayCost = persistedCosts
      .filter(entry => entry.direction === 'outflow' && dateKey(entry.occurredAt) === reportDate)
      .reduce((sum, entry) => sum + entry.baseAmountMinor, 0)
    const blockers: string[] = []
    if (procurements.some(order => order.status === 'awaiting_payment')) blockers.push('存在待付款采购单')
    if (procurements.some(order => order.status === 'shipment_exception')) blockers.push('存在发货异常')
    const report: DailyReport = {
      id: `daily-${input.workspaceId}-${reportDate}`,
      workspaceId: input.workspaceId, reportDate, generatedAt,
      orderCount: dayOrders.length, revenueMinor: dayRevenue, costMinor: dayCost,
      netProfitMinor: dayRevenue - dayCost, currency: settings.baseCurrency, blockers,
    }
    await deps.dailyReports.upsert(report)
    reports.push(report)
  }

  const sourceMap = new Map<string, SourcePerformance>()
  for (const procurement of procurements) {
    const current = sourceMap.get(procurement.sourcingItemId) ?? {
      sourcingItemId: procurement.sourcingItemId, orderCount: 0, revenueMinor: 0,
      costMinor: 0, netProfitMinor: 0, currency: settings.baseCurrency,
    }
    current.orderCount += 1
    const procurementCost = persistedCosts
      .filter(entry => entry.relatedId === procurement.id)
      .reduce((sum, entry) => sum + (entry.direction === 'outflow' ? entry.baseAmountMinor : -entry.baseAmountMinor), 0)
    const linkedOrder = orders.find(order => order.externalOrderId === procurement.marketplaceOrderId)
    const orderRevenue = linkedOrder === undefined || linkedOrder.status === 'canceled'
      ? 0
      : toBase(linkedOrder.totalMinor, linkedOrder.currency, settings).baseAmountMinor
    current.costMinor += procurementCost
    current.revenueMinor += orderRevenue
    current.netProfitMinor += orderRevenue - procurementCost
    sourceMap.set(procurement.sourcingItemId, current)
  }
  for (const cost of persistedCosts) {
    if (cost.costType !== 'ai_usage' || cost.relatedType !== 'sourcing_item') continue
    const current = sourceMap.get(cost.relatedId) ?? {
      sourcingItemId: cost.relatedId, orderCount: 0, revenueMinor: 0,
      costMinor: 0, netProfitMinor: 0, currency: settings.baseCurrency,
    }
    current.costMinor += cost.baseAmountMinor
    current.netProfitMinor -= cost.baseAmountMinor
    sourceMap.set(cost.relatedId, current)
  }
  auditEvent(deps, input.workspaceId, 'finance.rebuilt', input.workspaceId, {
    orderCount: orders.length, procurementCount: procurements.length,
    costCount: persistedCosts.length, aiCostMinor, reportCount: reports.length,
  }, input.actorId)
  return {
    settings, summary, reports,
    sourcePerformance: [...sourceMap.values()], aiCostMinor,
  }
}

export type FinanceViewData = Awaited<ReturnType<typeof rebuildFinance>>
