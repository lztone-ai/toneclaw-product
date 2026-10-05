import { describe, expect, it } from 'vitest'
import type { SelectionDecision, SourcingItem } from '../src/objects.ts'
import type { SelectionDeps } from '../src/selection.ts'
import { createProductFromSelection, decide, reopenSelection, UNCATEGORIZED_CORE_CATEGORY_ID } from '../src/selection.ts'

function makeDeps() {
  const items = new Map<string, SourcingItem>()
  const decisions = new Map<string, SelectionDecision>()
  const products: { product: Record<string, string>; variant: Record<string, string | number> }[] = []
  const audits: { action: string; after: string | null }[] = []
  let seq = 0
  const deps: SelectionDeps = {
    ids: { next: () => `id-${String(++seq).padStart(3, '0')}` },
    clock: { now: () => new Date('2026-03-15T10:00:00Z') },
    audit: { append: event => audits.push({ action: event.action, after: event.after }) },
    items: {
      insert: async item => { items.set(item.id, item) },
      findById: async (_workspaceId, id) => items.get(id),
      update: async item => { items.set(item.id, item) },
    },
    decisions: {
      findActiveByItemId: async (_workspaceId, itemId) =>
        [...decisions.values()].find(d => d.sourcingItemId === itemId && d.status === 'active'),
      insert: async decision => { decisions.set(decision.id, decision) },
      supersede: async (id, at) => {
        const decision = decisions.get(id)
        if (decision !== undefined) { decision.status = 'superseded'; decision.decidedAt = at }
      },
      setResultProductId: async (id, resultProductId, at) => {
        const decision = decisions.get(id)
        if (decision !== undefined) { decision.resultProductId = resultProductId; decision.decidedAt = at }
      },
    },
    products: {
      insert: async (product, variant) => { products.push({ product, variant }) },
    },
  }
  return { deps, items, decisions, products, audits }
}

function seedCandidate(items: Map<string, SourcingItem>, id = 'item-1'): SourcingItem {
  const item: SourcingItem = {
    id,
    businessAccountId: 'ws',
    supplierId: 'supplier-1',
    dataSourceId: 'ds-1',
    sourceRecordId: 'source-record-1',
    externalSourceId: 'SRC-9001',
    title: '便携榨汁杯',
    descriptionRaw: null,
    categoryLabels: ['厨房', '小家电'],
    currency: 'CNY',
    purchasePriceMinor: 6700,
    suggestedRetailPriceMinor: 19900,
    moq: 1,
    leadTimeDays: 7,
    stockStatus: 'available',
    supplyStatus: 'active',
    riskStatus: 'low',
    status: 'candidate',
    imageUrls: ['https://example.com/a.jpg'],
    skuAttributesJson: '{"color":"white"}',
    complianceJson: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  }
  items.set(id, item)
  return item
}

describe('decide', () => {
  it('approves a candidate: item becomes selected with an active decision and audit', async () => {
    const { deps, items, audits } = makeDeps()
    seedCandidate(items)
    const result = await decide(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'approved',
      reason: '毛利 66%，MOQ=1', decidedBy: 'user', actorId: 'seller-1',
    })
    expect(result.item.status).toBe('selected')
    expect(result.decision.status).toBe('active')
    expect(result.supersededDecisionId).toBeNull()
    expect(audits.some(a => a.action === 'selection.approved')).toBe(true)
  })

  it('rejects empty reasons and ai approvals', async () => {
    const { deps, items } = makeDeps()
    seedCandidate(items)
    await expect(decide(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'approved',
      reason: '  ', decidedBy: 'user', actorId: 'seller-1',
    })).rejects.toThrow('reason is required')
    await expect(decide(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'approved',
      reason: 'r', decidedBy: 'ai', actorId: 'ai-1',
    })).rejects.toThrow('cannot approve')
  })

  it('observing keeps the item a candidate and still records the decision', async () => {
    const { deps, items } = makeDeps()
    seedCandidate(items)
    const result = await decide(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'observing',
      reason: '等 Q3 价格', decidedBy: 'user', actorId: 'seller-1',
    })
    expect(result.item.status).toBe('candidate')
    expect(result.decision.decision).toBe('observing')
  })

  it('supersedes the previous active decision on a new decision', async () => {
    const { deps, items, decisions } = makeDeps()
    seedCandidate(items)
    const first = await decide(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'observing',
      reason: '观察期', decidedBy: 'user', actorId: 'seller-1',
    })
    const second = await decide(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'approved',
      reason: '转正式候选', decidedBy: 'user', actorId: 'seller-1',
    })
    expect(second.supersededDecisionId).toBe(first.decision.id)
    expect(decisions.get(first.decision.id)?.status).toBe('superseded')
    expect(items.get('item-1')?.status).toBe('selected')
  })

  it('rejects decisions on non-candidate items', async () => {
    const { deps, items } = makeDeps()
    const item = seedCandidate(items)
    items.set(item.id, { ...item, status: 'selected' })
    await expect(decide(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'approved',
      reason: 'r', decidedBy: 'user', actorId: 'seller-1',
    })).rejects.toThrow('require status candidate')
  })
})

describe('createProductFromSelection', () => {
  async function approvedSetup() {
    const ctx = makeDeps()
    seedCandidate(ctx.items)
    await decide(ctx.deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'approved',
      reason: '毛利达标', decidedBy: 'user', actorId: 'seller-1',
    })
    return ctx
  }

  it('creates a draft product with inherited risk, cost-basis variant, and linkage', async () => {
    const { deps, products, decisions, audits } = await approvedSetup()
    const created = await createProductFromSelection(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', actorId: 'seller-1',
    })
    expect(created.title).toBe('便携榨汁杯')
    expect(created.riskStatus).toBe('low')
    expect(created.purchasePriceMinor).toBe(6700)
    expect(created.sku).toBe('TC-SRC-9001')
    expect(products).toHaveLength(1)
    const inserted = products[0]!
    expect(inserted.product.coreCategoryId).toBe(UNCATEGORIZED_CORE_CATEGORY_ID)
    expect(inserted.product.sourcingItemId).toBe('item-1')
    expect(inserted.variant.purchasePriceMinor).toBe(6700)
    const active = [...decisions.values()].find(d => d.status === 'active')
    expect(active?.resultProductId).toBe(created.productId)
    const creation = audits.find(a => a.action === 'product.create_from_selection')
    expect(creation?.after).toContain('"costBasis"')
  })

  it('refuses to create twice from the same selection', async () => {
    const { deps } = await approvedSetup()
    await createProductFromSelection(deps, { workspaceId: 'ws', sourcingItemId: 'item-1', actorId: 'seller-1' })
    await expect(createProductFromSelection(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', actorId: 'seller-1',
    })).rejects.toThrow('already created')
  })

  it('blocks reopen after product creation but allows it before', async () => {
    const { deps, items } = await approvedSetup()
    await createProductFromSelection(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', actorId: 'seller-1',
    })
    await expect(reopenSelection(deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', actorId: 'seller-1', reason: 'x',
    })).rejects.toThrow('cannot reopen')
    const fresh = makeDeps()
    seedCandidate(fresh.items)
    await decide(fresh.deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', decision: 'approved',
      reason: 'r', decidedBy: 'user', actorId: 'seller-1',
    })
    const reopened = await reopenSelection(fresh.deps, {
      workspaceId: 'ws', sourcingItemId: 'item-1', actorId: 'seller-1', reason: '重新评估',
    })
    expect(reopened.status).toBe('candidate')
    expect(items.get('item-1')).toBeDefined()
  })
})
