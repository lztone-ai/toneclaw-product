/** Rule-based sourcing filters (08 4.2 layer 1: pure local computation, no business state). */
import type { SourcingItem } from './objects.ts'

export interface FilterRules {
  categoryLabel?: string
  priceMinMinor?: number
  priceMaxMinor?: number
  maxMoq?: number
  maxLeadTimeDays?: number
  minMarginPct?: number
}

export interface FilterCandidate {
  item: SourcingItem
  suggestedRetailPriceMinor: number | null
}

export interface FilterOutcome {
  passed: FilterCandidate[]
  rejected: { candidate: FilterCandidate; reason: string }[]
}

export function applyFilterRules(candidates: FilterCandidate[], rules: FilterRules): FilterOutcome {
  const passed: FilterCandidate[] = []
  const rejected: { candidate: FilterCandidate; reason: string }[] = []
  for (const candidate of candidates) {
    const reason = firstRejection(candidate, rules)
    if (reason === null) passed.push(candidate)
    else rejected.push({ candidate, reason })
  }
  return { passed, rejected }
}

function firstRejection(candidate: FilterCandidate, rules: FilterRules): string | null {
  const { item, suggestedRetailPriceMinor } = candidate
  if (rules.categoryLabel !== undefined
    && !item.categoryLabels.some(label => label.toLowerCase() === rules.categoryLabel!.toLowerCase())) {
    return 'category_mismatch'
  }
  if (rules.priceMinMinor !== undefined && item.purchasePriceMinor < rules.priceMinMinor) return 'price_below_band'
  if (rules.priceMaxMinor !== undefined && item.purchasePriceMinor > rules.priceMaxMinor) return 'price_above_band'
  if (rules.maxMoq !== undefined && item.moq !== null && item.moq > rules.maxMoq) return 'moq_exceeds'
  if (rules.maxLeadTimeDays !== undefined && item.leadTimeDays !== null && item.leadTimeDays > rules.maxLeadTimeDays) {
    return 'lead_time_exceeds'
  }
  if (rules.minMarginPct !== undefined) {
    if (suggestedRetailPriceMinor === null || suggestedRetailPriceMinor <= 0) return 'no_retail_price'
    const marginPct = (suggestedRetailPriceMinor - item.purchasePriceMinor) / suggestedRetailPriceMinor * 100
    if (marginPct < rules.minMarginPct) return 'margin_below_threshold'
  }
  return null
}
