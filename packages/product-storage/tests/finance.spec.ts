import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProductStorage } from '../src/product-storage.ts'
import type { CostLedgerEntry } from '@toneclaw/core-domain'

const dirs: string[] = []
const storages: ProductStorage[] = []
const tempBase = resolve(import.meta.dirname, '../../../tmp')

afterEach(() => {
  for (const storage of storages.splice(0)) storage.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStorage(): ProductStorage {
  mkdirSync(tempBase, { recursive: true })
  const dir = mkdtempSync(join(tempBase, 'finance-'))
  dirs.push(dir)
  const storage = new ProductStorage(join(dir, 'product.sqlite'))
  storages.push(storage)
  return storage
}

it('persists S5 settings, calculated costs, summaries, and daily reports', async () => {
  const path = makeStorage().path
  const first = storages[0]!
  await first.finance.settings.upsert({
    workspaceId: 'ws', baseCurrency: 'CNY', platformFeeBps: 800,
    aiInputCostMinorPerMillionTokens: 1_000,
    aiOutputCostMinorPerMillionTokens: 2_000,
    exchangeRates: { CNY: 1, USD: 7.2 }, updatedAt: '2026-10-08T00:00:00Z',
  })
  const entry: CostLedgerEntry = {
    id: 'cost-1', workspaceId: 'ws', relatedType: 'order', relatedId: 'order-1',
    costType: 'platform_fee', direction: 'outflow', amountMinor: 800,
    currency: 'USD', baseAmountMinor: 5_760, baseCurrency: 'CNY',
    exchangeRateSnapshot: 7.2, occurredAt: '2026-10-08T09:00:00Z',
    sourceType: 'calculated', sourceKey: 'platform_fee:order-1', notes: null,
  }
  await first.finance.costEntries.upsert(entry)
  await first.finance.profitSummaries.upsert({
    id: 'summary-1', workspaceId: 'ws', scopeType: 'period', scopeId: 'all',
    revenueMinor: 75_600, costMinor: 55_500, aiCostMinor: 1_200,
    grossProfitMinor: 20_100,
    netProfitMinor: 77_340, currency: 'CNY',
    periodStart: '2026-10-08T09:00:00Z', periodEnd: '2026-10-08T09:00:00Z',
  })
  await first.finance.dailyReports.upsert({
    id: 'daily-1', workspaceId: 'ws', reportDate: '2026-10-08',
    generatedAt: '2026-10-08T15:00:00Z', orderCount: 1, revenueMinor: 75_600,
    costMinor: 55_500, netProfitMinor: 20_100, currency: 'CNY', blockers: [],
  })
  const second = new ProductStorage(path)
  storages.push(second)
  expect(second.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 })
  await expect(second.finance.settings.find('ws')).resolves.toMatchObject({
    baseCurrency: 'CNY', platformFeeBps: 800,
    aiInputCostMinorPerMillionTokens: 1_000,
    aiOutputCostMinorPerMillionTokens: 2_000,
    exchangeRates: { CNY: 1, USD: 7.2 },
  })
  expect(await second.finance.costEntries.list('ws')).toMatchObject([entry])
  await expect(second.finance.profitSummaries.findCurrent('ws')).resolves.toMatchObject({
    revenueMinor: 75_600, aiCostMinor: 1_200, netProfitMinor: 77_340,
  })
  expect(await second.finance.dailyReports.list('ws')).toMatchObject([{
    reportDate: '2026-10-08', revenueMinor: 75_600,
  }])
})
