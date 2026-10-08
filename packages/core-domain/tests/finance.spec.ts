import { describe, expect, it } from 'vitest'
import { rebuildFinance, updateFinanceSettings, type FinanceDeps } from '../src/finance/service.ts'
import type {
  CostLedgerEntry,
  DailyReport,
  FinanceSettings,
  ProfitSummary,
} from '../src/finance/objects.ts'
import type { Order, PaymentSession, ProcurementOrder } from '../src/commerce/objects.ts'

function makeFinanceDeps() {
  const settings = new Map<string, FinanceSettings>()
  const costs = new Map<string, CostLedgerEntry>()
  const summaries = new Map<string, ProfitSummary>()
  const reports = new Map<string, DailyReport>()
  const orders: Order[] = [{
    id: 'order-1', businessAccountId: 'ws', storeId: 'store-1', platform: 'temu',
    externalOrderId: 'EXT-1', orderNumber: 'N-1', status: 'delivered',
    rawStatus: 'Delivered', currency: 'USD', subtotalMinor: 10_000,
    shippingMinor: 500, discountMinor: null, taxMinor: null, totalMinor: 10_500,
    placedAt: '2026-10-08T09:00:00Z', lastSyncedAt: '2026-10-08T10:00:00Z',
  }]
  const procurements: ProcurementOrder[] = [{
    id: 'proc-1', businessAccountId: 'ws', storeId: 'store-1',
    marketplaceOrderId: 'EXT-1', fulfillmentId: 'ful-1', sourcingItemId: 'source-1',
    supplierId: 'supplier-1', providerId: 'provider-1', status: 'refunded',
    quantity: 1, unitCostMinor: 6_700, shippingFeeMinor: 300, serviceFeeMinor: 200,
    totalPayableMinor: 7_200, currency: 'USD', quoteConfirmedAt: '2026-10-08T11:00:00Z',
    paymentDueAt: null, providerPromisedShipAt: null, shippedAt: '2026-10-08T12:00:00Z',
    trackingNumber: '1Z', carrier: 'UPS', createdAt: '2026-10-08T10:30:00Z',
    updatedAt: '2026-10-08T14:00:00Z',
  }]
  const payments: PaymentSession[] = [{
    id: 'pay-1', businessAccountId: 'ws', procurementOrderId: 'proc-1',
    providerId: 'provider-1', providerPaymentId: 'pay-ext-1', amountMinor: 7_200,
    currency: 'USD', status: 'refunded', paymentUrl: null,
    paymentReferenceNo: 'REF-1', expiresAt: null, redirectAt: '2026-10-08T11:10:00Z',
    callbackReceivedAt: '2026-10-08T11:20:00Z', confirmedAt: '2026-10-08T11:20:00Z',
    failureReason: null, createdAt: '2026-10-08T11:05:00Z',
    updatedAt: '2026-10-08T14:00:00Z',
  }]
  const audits: string[] = []
  let sequence = 0
  const deps: FinanceDeps = {
    ids: { next: () => `id-${++sequence}` },
    clock: { now: () => new Date('2026-10-08T15:00:00Z') },
    audit: { append: event => { audits.push(event.action) } },
    settings: {
      find: async workspaceId => settings.get(workspaceId),
      upsert: async value => { settings.set(value.workspaceId, value) },
    },
    costEntries: {
      upsert: async entry => { costs.set(entry.sourceKey, entry) },
      list: async workspaceId => [...costs.values()].filter(entry => entry.workspaceId === workspaceId),
      deleteCalculated: async workspaceId => {
        for (const [key, entry] of costs) {
          if (entry.workspaceId === workspaceId && entry.sourceType === 'calculated') costs.delete(key)
        }
      },
    },
    profitSummaries: {
      upsert: async value => { summaries.set(value.id, value) },
      findCurrent: async workspaceId =>
        [...summaries.values()].filter(value => value.workspaceId === workspaceId).at(-1),
    },
    dailyReports: {
      upsert: async value => { reports.set(value.reportDate, value) },
      list: async workspaceId =>
        [...reports.values()]
          .filter(value => value.workspaceId === workspaceId)
          .sort((left, right) => right.reportDate.localeCompare(left.reportDate)),
    },
    orders: { list: async () => orders } as unknown as FinanceDeps['orders'],
    orderItems: { listByOrder: async () => [] } as unknown as FinanceDeps['orderItems'],
    procurements: { list: async () => procurements } as unknown as FinanceDeps['procurements'],
    payments: {
      listByProcurementOrder: async (_workspaceId: string, procurementOrderId: string) =>
        payments.filter(payment => payment.procurementOrderId === procurementOrderId),
    } as unknown as FinanceDeps['payments'],
  }
  return { deps, orders, procurements, payments, settings, costs, summaries, reports, audits }
}

describe('S5 finance estimates', () => {
  it('creates default settings, calculates traceable costs, and attributes source performance', async () => {
    const context = makeFinanceDeps()
    const first = await rebuildFinance(context.deps, { workspaceId: 'ws', actorId: 'finance-domain' })
    expect(first.settings).toMatchObject({ baseCurrency: 'USD', platformFeeBps: 500 })
    expect(first.summary).toMatchObject({
      revenueMinor: 10_500,
      costMinor: 7_700,
      grossProfitMinor: 2_800,
      netProfitMinor: 10_000,
    })
    expect(first.sourcePerformance).toMatchObject([{
      sourcingItemId: 'source-1',
      orderCount: 1,
      revenueMinor: 10_500,
      costMinor: 0,
      netProfitMinor: 10_500,
    }])
    expect(context.costs.get('platform_fee:order-1')).toMatchObject({
      costType: 'platform_fee', amountMinor: 500, sourceType: 'calculated',
    })
    expect(context.costs.get('refund:proc-1')).toMatchObject({
      costType: 'adjustment', direction: 'inflow', amountMinor: 7_200,
    })
    expect(context.reports.get('2026-10-08')?.revenueMinor).toBe(10_500)
    expect(context.audits).toContain('finance.rebuilt')
  })

  it('updates configured rates, preserves manual costs, and rebuilds idempotently', async () => {
    const context = makeFinanceDeps()
    await rebuildFinance(context.deps, { workspaceId: 'ws', actorId: 'finance-domain' })
    context.costs.set('manual:adjustment', {
      id: 'manual-1', workspaceId: 'ws', relatedType: 'order', relatedId: 'order-1',
      costType: 'adjustment', direction: 'outflow', amountMinor: 100,
      currency: 'USD', baseAmountMinor: 100, baseCurrency: 'USD',
      exchangeRateSnapshot: 1, occurredAt: '2026-10-08T12:00:00Z',
      sourceType: 'manual', sourceKey: 'manual:adjustment', notes: 'manual test cost',
    })
    const settings = await updateFinanceSettings(context.deps, {
      workspaceId: 'ws', actorId: 'seller-1', baseCurrency: 'cny',
      platformFeeBps: 800,
      aiInputCostMinorPerMillionTokens: 0,
      aiOutputCostMinorPerMillionTokens: 0,
      exchangeRates: { cny: 1, usd: 7.2 },
    })
    expect(settings).toMatchObject({ baseCurrency: 'CNY', platformFeeBps: 800 })
    const second = await rebuildFinance(context.deps, { workspaceId: 'ws', actorId: 'finance-domain' })
    expect(second.summary).toMatchObject({
      currency: 'CNY', revenueMinor: 75_600, costMinor: 57_600,
      grossProfitMinor: 18_000, netProfitMinor: 69_840,
    })
    expect([...context.costs.keys()]).toContain('manual:adjustment')
    expect(context.costs.size).toBe(6)
  })

  it('calculates AI cost from UsageRecord and attributes it to the source', async () => {
    const context = makeFinanceDeps()
    const result = await rebuildFinance(context.deps, {
      workspaceId: 'ws', actorId: 'finance-domain',
      aiUsage: [{
        id: 'usage-1', inputTokens: 123, outputTokens: 45,
        costEstimateMinor: 213, occurredAt: '2026-10-08T09:00:00Z',
        relatedType: 'sourcing_item', relatedId: 'source-1',
      }],
    })
    expect(result.summary).toMatchObject({
      aiCostMinor: 213, costMinor: 7_913, grossProfitMinor: 2_587,
    })
    expect(result.sourcePerformance).toMatchObject([{
      sourcingItemId: 'source-1', costMinor: 213, netProfitMinor: 10_287,
    }])
    expect(context.costs.get('ai_usage:usage-1')).toMatchObject({
      costType: 'ai_usage', amountMinor: 213, relatedType: 'sourcing_item',
    })
  })
})
