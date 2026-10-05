/** Selection decision lifecycle and product creation invariants (STATE_MACHINES 4.3-4.4 / 5.1). */
import type {
  AuditEvent,
  AuditActorType,
  SourcingItem,
  SelectionDecision,
  SelectionDecisionValue,
  DecidedBy,
} from './objects.ts'
import type {
  IdGenerator,
  Clock,
  AuditSink,
  ProductRepository,
  SourcingItemRepository,
  SelectionDecisionRepository,
} from './ports.ts'

/** Built-in fallback core category (P0; S3 maps candidates onto the real tree). */
export const UNCATEGORIZED_CORE_CATEGORY_ID = 'category-uncategorized'

export interface SelectionDeps {
  ids: IdGenerator
  clock: Clock
  audit: AuditSink
  items: SourcingItemRepository
  decisions: SelectionDecisionRepository
  products: ProductRepository
}

export interface DecideInput {
  workspaceId: string
  sourcingItemId: string
  decision: SelectionDecisionValue
  reason: string
  decidedBy: DecidedBy
  actorId: string
}

export interface DecideResult {
  decision: SelectionDecision
  item: SourcingItem
  supersededDecisionId: string | null
}

function auditEvent(
  deps: SelectionDeps,
  workspaceId: string,
  action: string,
  objectId: string,
  after: unknown,
  actorId: string,
  actorType: AuditActorType,
): AuditEvent {
  return {
    id: deps.ids.next(),
    workspaceId,
    actorType,
    actorId,
    action,
    objectType: 'SelectionDecision',
    objectId,
    before: null,
    after: JSON.stringify(after),
    reason: null,
    source: 'core-domain',
    occurredAt: deps.clock.now().toISOString(),
    traceId: null,
  }
}

/** Record a human/AI selection decision on a candidate item (STATE_MACHINES 4.4). */
export async function decide(deps: SelectionDeps, input: DecideInput): Promise<DecideResult> {
  if (input.reason.trim() === '') throw new Error('selection reason is required')
  if (input.decision === 'approved' && input.decidedBy === 'ai') {
    throw new Error('ai decisions cannot approve; ai provides observing suggestions only')
  }
  const item = await deps.items.findById(input.workspaceId, input.sourcingItemId)
  if (item === undefined) throw new Error(`sourcing item not found: ${input.sourcingItemId}`)
  if (item.status !== 'candidate') {
    throw new Error(`decisions require status candidate, got ${item.status}`)
  }
  const active = await deps.decisions.findActiveByItemId(input.workspaceId, input.sourcingItemId)
  const now = deps.clock.now().toISOString()
  const decision: SelectionDecision = {
    id: deps.ids.next(),
    businessAccountId: input.workspaceId,
    sourcingItemId: input.sourcingItemId,
    decision: input.decision,
    reason: input.reason,
    scoresJson: null,
    decidedBy: input.decidedBy,
    decidedAt: now,
    status: 'active',
    resultProductId: null,
  }
  await deps.decisions.insert(decision)
  if (active !== undefined) await deps.decisions.supersede(active.id, now)
  const nextStatus: SourcingItem['status'] = input.decision === 'approved'
    ? 'selected'
    : input.decision === 'rejected'
      ? 'rejected'
      : 'candidate'
  const updated: SourcingItem = { ...item, status: nextStatus, updatedAt: now }
  await deps.items.update(updated)
  deps.audit.append({
    ...auditEvent(
      deps,
      input.workspaceId,
      `selection.${input.decision}`,
      decision.id,
      {
        decision: input.decision,
        itemStatus: nextStatus,
        sourcingItemId: input.sourcingItemId,
      },
      input.actorId,
      input.decidedBy === 'ai' ? 'ai' : 'user',
    ),
  })
  return { decision, item: updated, supersededDecisionId: active?.id ?? null }
}

/** Guard: reopen selected -> candidate only while no product was created from it. */
export async function reopenSelection(
  deps: SelectionDeps,
  input: { workspaceId: string; sourcingItemId: string; actorId: string; reason: string },
): Promise<SourcingItem> {
  const item = await deps.items.findById(input.workspaceId, input.sourcingItemId)
  if (item === undefined) throw new Error(`sourcing item not found: ${input.sourcingItemId}`)
  if (item.status !== 'selected') throw new Error(`reopen requires status selected, got ${item.status}`)
  const active = await deps.decisions.findActiveByItemId(input.workspaceId, input.sourcingItemId)
  if (active?.resultProductId != null) {
    throw new Error('cannot reopen: a product was created from this selection')
  }
  const now = deps.clock.now().toISOString()
  const updated: SourcingItem = { ...item, status: 'candidate', updatedAt: now }
  await deps.items.update(updated)
  if (active !== undefined) await deps.decisions.supersede(active.id, now)
  deps.audit.append({
    ...auditEvent(deps, input.workspaceId, 'selection.reopen', item.id, { itemStatus: 'candidate' }, input.actorId, 'user'),
  })
  return updated
}

export interface CreateProductInput {
  workspaceId: string
  sourcingItemId: string
  actorId: string
  coreCategoryId?: string
}

export interface CreatedProduct {
  productId: string
  variantId: string
  sku: string
  title: string
  riskStatus: SourcingItem['riskStatus']
  purchasePriceMinor: number
  currency: string
}

/** Create a draft Product (and its cost-basis variant) from an approved selection (CORE_MODEL 7.1-7.2). */
export async function createProductFromSelection(
  deps: SelectionDeps,
  input: CreateProductInput,
): Promise<CreatedProduct> {
  const item = await deps.items.findById(input.workspaceId, input.sourcingItemId)
  if (item === undefined) throw new Error(`sourcing item not found: ${input.sourcingItemId}`)
  if (item.status !== 'selected') throw new Error(`product creation requires status selected, got ${item.status}`)
  const active = await deps.decisions.findActiveByItemId(input.workspaceId, input.sourcingItemId)
  if (active === undefined || active.decision !== 'approved') {
    throw new Error('product creation requires an active approved decision')
  }
  if (active.resultProductId != null) throw new Error('product already created from this selection')
  const now = deps.clock.now().toISOString()
  const productId = deps.ids.next()
  const product = {
    id: productId,
    title: item.title,
    coreCategoryId: input.coreCategoryId ?? UNCATEGORIZED_CORE_CATEGORY_ID,
    currency: item.currency,
    riskStatus: item.riskStatus,
    sourcingItemId: item.id,
    createdFromSelectionId: active.id,
  }
  const sku = `TC-${item.externalSourceId ?? item.id.slice(0, 8)}`
  const variant = {
    id: deps.ids.next(),
    sku,
    attributesJson: item.skuAttributesJson ?? '{}',
    purchasePriceMinor: item.purchasePriceMinor,
    currency: item.currency,
  }
  await deps.products.insert(product, variant)
  await deps.decisions.setResultProductId(active.id, productId, now)
  deps.audit.append({
    ...auditEvent(deps, input.workspaceId, 'product.create_from_selection', productId, {
      sourcingItemId: item.id,
      selectionId: active.id,
      riskStatus: item.riskStatus,
      costBasis: { purchasePriceMinor: variant.purchasePriceMinor, currency: variant.currency, capturedAt: now },
    }, input.actorId, 'user'),
  })
  return {
    productId,
    variantId: variant.id,
    sku,
    title: item.title,
    riskStatus: item.riskStatus,
    purchasePriceMinor: variant.purchasePriceMinor,
    currency: variant.currency,
  }
}
