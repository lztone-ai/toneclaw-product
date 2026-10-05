import { describe, expect, it } from 'vitest'
import type { SourcingItem } from '../src/objects.ts'
import { applyFilterRules, type FilterCandidate } from '../src/rules.ts'

function item(overrides: Partial<SourcingItem>): FilterCandidate {
  const base: SourcingItem = {
    id: 'i', businessAccountId: 'ws', supplierId: 's', dataSourceId: 'd',
    sourceRecordId: 'r', externalSourceId: null, title: 't', descriptionRaw: null,
    categoryLabels: ['厨房'], currency: 'CNY',
    purchasePriceMinor: 5000, suggestedRetailPriceMinor: null, moq: null,
    leadTimeDays: null, stockStatus: 'available', supplyStatus: 'active',
    riskStatus: 'unknown', status: 'candidate', imageUrls: [],
    skuAttributesJson: null, complianceJson: null,
    createdAt: '', updatedAt: '',
  }
  const merged = { ...base, ...overrides }
  return { item: merged, suggestedRetailPriceMinor: merged.suggestedRetailPriceMinor }
}

describe('applyFilterRules', () => {
  it('passes items within all configured bands', () => {
    const outcome = applyFilterRules([item({
      categoryLabels: ['厨房'], purchasePriceMinor: 5000, moq: 1,
      leadTimeDays: 7, suggestedRetailPriceMinor: 19900,
    })], { categoryLabel: '厨房', priceMinMinor: 3000, priceMaxMinor: 10000, maxMoq: 5, maxLeadTimeDays: 15, minMarginPct: 50 })
    expect(outcome.passed).toHaveLength(1)
    expect(outcome.rejected).toHaveLength(0)
  })

  it('rejects with precise reasons per violated rule', () => {
    const outcome = applyFilterRules([
      item({ categoryLabels: ['3C'], purchasePriceMinor: 5000, suggestedRetailPriceMinor: 19900 }),
      item({ purchasePriceMinor: 20000, suggestedRetailPriceMinor: 19900 }),
      item({ moq: 50, suggestedRetailPriceMinor: 19900 }),
      item({ leadTimeDays: 30, suggestedRetailPriceMinor: 19900 }),
      item({ suggestedRetailPriceMinor: 5200 }),
      item({ suggestedRetailPriceMinor: null }),
    ], { categoryLabel: '厨房', priceMaxMinor: 10000, maxMoq: 5, maxLeadTimeDays: 15, minMarginPct: 50 })
    expect(outcome.passed).toHaveLength(0)
    expect(outcome.rejected.map(r => r.reason)).toEqual([
      'category_mismatch', 'price_above_band', 'moq_exceeds', 'lead_time_exceeds', 'margin_below_threshold', 'no_retail_price',
    ])
  })
})
