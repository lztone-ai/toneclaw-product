/** Commerce operations per CORE_MODEL 10.1-10.3 and 07 §4-§6. Payment is a hard gate:
 * preparing/shipping may never proceed without PaymentSession.status = paid_confirmed. */
import type { StoreRepository } from '../platform/ports.ts'
import type { AuditSink, Clock, IdGenerator } from '../ports.ts'
import type { AuditActorType } from '../objects.ts'
import type {
  Fulfillment,
  Order,
  OrderItem,
  PaymentSession,
  ProcurementOrder,
} from './objects.ts'
import type { CommerceRepositories } from './ports.ts'

export interface CommerceDeps extends CommerceRepositories {
  ids: IdGenerator
  clock: Clock
  audit: AuditSink
  stores: StoreRepository
}

export interface ImportedOrderItem {
  externalItemId: string
  productId?: string
  productVariantId?: string
  platformListingId?: string
  sku: string
  title: string
  quantity: number
  unitPriceMinor: number
}

export interface ImportOrderInput {
  workspaceId: string
  actorId: string
  storeId: string
  externalOrderId: string
  orderNumber: string
  rawStatus: string
  subtotalMinor: number
  shippingMinor?: number
  discountMinor?: number
  taxMinor?: number
  totalMinor?: number
  placedAt: string
  items: ImportedOrderItem[]
}

function auditEvent(
  deps: CommerceDeps,
  workspaceId: string,
  action: string,
  objectType: string,
  objectId: string,
  after: unknown,
  actorId: string,
): void {
  const actorType: AuditActorType = actorId === 'commerce-domain' ? 'system' : 'user'
  deps.audit.append({
    id: deps.ids.next(), workspaceId, actorType, actorId, action, objectType, objectId,
    before: null, after: JSON.stringify(after), reason: null, source: 'core-domain',
    occurredAt: deps.clock.now().toISOString(), traceId: null,
  })
}

export async function importOrder(deps: CommerceDeps, input: ImportOrderInput): Promise<Order> {
  if (input.items.length === 0) throw new Error('order must contain at least one item')
  const store = await deps.stores.findById(input.workspaceId, input.storeId)
  if (store === undefined || store.platform !== 'temu' || store.status !== 'connected') {
    throw new Error('order import requires a connected Temu store')
  }
  const existing = await deps.orders.findByExternalId(input.workspaceId, 'temu', input.externalOrderId)
  if (existing !== undefined) return existing
  if (input.items.some(item => item.quantity <= 0 || item.unitPriceMinor < 0)) {
    throw new Error('order item quantity and price must be valid')
  }
  const subtotal = input.subtotalMinor
  const shipping = input.shippingMinor ?? 0
  const total = input.totalMinor ?? subtotal + shipping + (input.taxMinor ?? 0) - (input.discountMinor ?? 0)
  const now = deps.clock.now().toISOString()
  const order: Order = {
    id: deps.ids.next(), businessAccountId: input.workspaceId, storeId: store.id,
    platform: 'temu', externalOrderId: input.externalOrderId, orderNumber: input.orderNumber,
    status: 'created', rawStatus: input.rawStatus, currency: store.currency,
    subtotalMinor: subtotal, shippingMinor: shipping,
    discountMinor: input.discountMinor ?? null, taxMinor: input.taxMinor ?? null,
    totalMinor: total, placedAt: input.placedAt, lastSyncedAt: now,
  }
  await deps.orders.insert(order)
  await deps.orderItems.insertMany(input.items.map(item => ({
    id: deps.ids.next(), businessAccountId: input.workspaceId, orderId: order.id,
    productId: item.productId ?? null, productVariantId: item.productVariantId ?? null,
    platformListingId: item.platformListingId ?? null, externalItemId: item.externalItemId,
    sku: item.sku, title: item.title, quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor, currency: order.currency,
  })))
  const fulfillment: Fulfillment = {
    id: deps.ids.next(), businessAccountId: input.workspaceId, orderId: order.id,
    storeId: order.storeId, platform: order.platform, externalFulfillmentId: null,
    fulfillmentType: 'seller_shipping', status: 'pending', rawStatus: input.rawStatus,
    carrier: null, trackingNumber: null, shippedAt: null, deliveredAt: null,
    exceptionReason: null,
  }
  await deps.fulfillments.insert(fulfillment)
  auditEvent(deps, input.workspaceId, 'order.imported', 'Order', order.id, {
    externalOrderId: order.externalOrderId, itemCount: input.items.length,
  }, input.actorId)
  return order
}

export interface CreateProcurementInput {
  workspaceId: string
  actorId: string
  orderId: string
  sourcingItemId: string
  supplierId: string
  providerId: string
  quantity: number
  unitCostMinor: number
  shippingFeeMinor?: number
  serviceFeeMinor?: number
}

export async function createProcurementOrder(
  deps: CommerceDeps,
  input: CreateProcurementInput,
): Promise<ProcurementOrder> {
  const order = await deps.orders.findById(input.workspaceId, input.orderId)
  if (order === undefined) throw new Error(`order not found: ${input.orderId}`)
  const items = await deps.orderItems.listByOrder(input.workspaceId, order.id)
  if (items.length === 0) throw new Error('order has no items')
  const fulfillments = await deps.fulfillments.listByOrder(input.workspaceId, order.id)
  const fulfillment = fulfillments.find(item => item.status === 'pending')
  if (fulfillment === undefined) throw new Error('order has no pending fulfillment')
  const quantity = input.quantity
  const unitCost = input.unitCostMinor
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity must be a positive integer')
  if (!Number.isInteger(unitCost) || unitCost < 0) throw new Error('unit cost cannot be negative')
  const shippingFee = input.shippingFeeMinor ?? 0
  const serviceFee = input.serviceFeeMinor ?? 0
  const now = deps.clock.now().toISOString()
  const procurement: ProcurementOrder = {
    id: deps.ids.next(), businessAccountId: input.workspaceId, storeId: order.storeId,
    marketplaceOrderId: order.externalOrderId, fulfillmentId: fulfillment.id,
    sourcingItemId: input.sourcingItemId, supplierId: input.supplierId,
    providerId: input.providerId, status: 'quote_pending', quantity,
    unitCostMinor: unitCost, shippingFeeMinor: shippingFee,
    serviceFeeMinor: serviceFee, totalPayableMinor: quantity * unitCost + shippingFee + serviceFee,
    currency: order.currency, quoteConfirmedAt: null, paymentDueAt: null,
    providerPromisedShipAt: null, shippedAt: null, trackingNumber: null,
    carrier: null, createdAt: now, updatedAt: now,
  }
  await deps.procurementOrders.insert(procurement)
  auditEvent(deps, input.workspaceId, 'procurement.created', 'ProcurementOrder', procurement.id, {
    orderId: order.id, quantity, totalPayableMinor: procurement.totalPayableMinor,
  }, input.actorId)
  return procurement
}

export async function confirmQuote(
  deps: CommerceDeps,
  input: { workspaceId: string; actorId: string; procurementOrderId: string },
): Promise<ProcurementOrder> {
  const procurement = await deps.procurementOrders.findById(input.workspaceId, input.procurementOrderId)
  if (procurement === undefined || procurement.status !== 'quote_pending') {
    throw new Error(`quote confirmation requires quote_pending, got ${procurement?.status ?? 'missing'}`)
  }
  if (procurement.totalPayableMinor <= 0) throw new Error('quote total must be positive')
  const now = deps.clock.now().toISOString()
  const updated: ProcurementOrder = { ...procurement, status: 'quote_confirmed', quoteConfirmedAt: now, updatedAt: now }
  await deps.procurementOrders.update(updated)
  auditEvent(deps, input.workspaceId, 'procurement.quote_confirmed', 'ProcurementOrder', procurement.id, {
    totalPayableMinor: updated.totalPayableMinor,
  }, input.actorId)
  return updated
}

export async function createPaymentSession(
  deps: CommerceDeps,
  input: { workspaceId: string; actorId: string; procurementOrderId: string; paymentUrl?: string; expiresAt?: string },
): Promise<PaymentSession> {
  const procurement = await deps.procurementOrders.findById(input.workspaceId, input.procurementOrderId)
  if (procurement === undefined || procurement.status !== 'quote_confirmed') {
    throw new Error(`payment session requires quote_confirmed, got ${procurement?.status ?? 'missing'}`)
  }
  const now = deps.clock.now().toISOString()
  const sessionId = deps.ids.next()
  const session: PaymentSession = {
    id: sessionId, businessAccountId: input.workspaceId,
    procurementOrderId: procurement.id, providerId: procurement.providerId,
    providerPaymentId: null, amountMinor: procurement.totalPayableMinor,
    currency: procurement.currency, status: 'created', paymentUrl: input.paymentUrl ?? null,
    paymentReferenceNo: `PO-${procurement.id}-${sessionId}`, expiresAt: input.expiresAt ?? null,
    redirectAt: null, callbackReceivedAt: null, confirmedAt: null,
    failureReason: null, createdAt: now, updatedAt: now,
  }
  await deps.paymentSessions.insert(session)
  await deps.procurementOrders.update({ ...procurement, status: 'awaiting_payment', updatedAt: now })
  auditEvent(deps, input.workspaceId, 'payment.session_created', 'PaymentSession', session.id, {
    procurementOrderId: procurement.id, amountMinor: session.amountMinor,
  }, input.actorId)
  return session
}

function latestPayment(payments: PaymentSession[]): PaymentSession {
  return payments.reduce((latest, session) =>
    session.createdAt > latest.createdAt ? session : latest, payments[0]!)
}

export async function confirmPayment(
  deps: CommerceDeps,
  input: { workspaceId: string; actorId: string; paymentSessionId: string; providerPaymentId?: string },
): Promise<{ session: PaymentSession; procurement: ProcurementOrder }> {
  const session = await deps.paymentSessions.findById(input.workspaceId, input.paymentSessionId)
  if (session === undefined) throw new Error(`payment session not found: ${input.paymentSessionId}`)
  if (session.status !== 'redirected' && session.status !== 'payment_submitted') {
    throw new Error(`payment confirmation requires redirected/payment_submitted, got ${session.status}`)
  }
  const procurement = await deps.procurementOrders.findById(input.workspaceId, session.procurementOrderId)
  if (procurement === undefined || procurement.status !== 'awaiting_payment') {
    throw new Error(`payment confirmation requires awaiting_payment, got ${procurement?.status ?? 'missing'}`)
  }
  const now = deps.clock.now().toISOString()
  const paid: PaymentSession = {
    ...session, status: 'paid_confirmed', providerPaymentId: input.providerPaymentId ?? session.providerPaymentId,
    callbackReceivedAt: now, confirmedAt: now, updatedAt: now,
  }
  await deps.paymentSessions.update(paid)
  const confirmed: ProcurementOrder = { ...procurement, status: 'payment_confirmed', updatedAt: now }
  await deps.procurementOrders.update(confirmed)
  auditEvent(deps, input.workspaceId, 'payment.confirmed', 'PaymentSession', session.id, {
    procurementOrderId: procurement.id,
  }, input.actorId)
  return { session: paid, procurement: confirmed }
}

export async function prepareProviderShipment(
  deps: CommerceDeps,
  input: { workspaceId: string; actorId: string; procurementOrderId: string },
): Promise<ProcurementOrder> {
  const procurement = await deps.procurementOrders.findById(input.workspaceId, input.procurementOrderId)
  if (procurement === undefined || procurement.status !== 'payment_confirmed') {
    throw new Error(`provider preparing requires payment_confirmed, got ${procurement?.status ?? 'missing'}`)
  }
  const payments = await deps.paymentSessions.listByProcurementOrder(input.workspaceId, procurement.id)
  const payment = payments.at(-1)
  if (payment?.status !== 'paid_confirmed') throw new Error('payment gate violation: provider preparing requires paid_confirmed')
  const now = deps.clock.now().toISOString()
  const updated: ProcurementOrder = { ...procurement, status: 'provider_preparing', updatedAt: now }
  await deps.procurementOrders.update(updated)
  auditEvent(deps, input.workspaceId, 'procurement.provider_preparing', 'ProcurementOrder', procurement.id, {}, input.actorId)
  return updated
}

export async function shipProcurement(
  deps: CommerceDeps,
  input: {
    workspaceId: string; actorId: string; procurementOrderId: string;
    carrier: string; trackingNumber: string; shippedAt?: string; inTransit?: boolean
  },
): Promise<{ procurement: ProcurementOrder; fulfillment: Fulfillment }> {
  const procurement = await deps.procurementOrders.findById(input.workspaceId, input.procurementOrderId)
  if (procurement === undefined || procurement.status !== 'provider_preparing') {
    throw new Error(`shipping requires provider_preparing, got ${procurement?.status ?? 'missing'}`)
  }
  const payments = await deps.paymentSessions.listByProcurementOrder(input.workspaceId, procurement.id)
  if (latestPayment(payments).status !== 'paid_confirmed') {
    throw new Error('payment gate violation: shipping requires paid_confirmed')
  }
  const fulfillment = await deps.fulfillments.findById(input.workspaceId, procurement.fulfillmentId)
  if (fulfillment === undefined) throw new Error(`fulfillment not found: ${procurement.fulfillmentId}`)
  const now = deps.clock.now().toISOString()
  const shippedAt = input.shippedAt ?? now
  const nextStatus = input.inTransit ? 'in_transit' : 'shipped'
  const updated: ProcurementOrder = {
    ...procurement, status: nextStatus, carrier: input.carrier,
    trackingNumber: input.trackingNumber, shippedAt, updatedAt: now,
  }
  await deps.procurementOrders.update(updated)
  const updatedFulfillment: Fulfillment = {
    ...fulfillment, status: nextStatus, carrier: input.carrier,
    trackingNumber: input.trackingNumber, shippedAt,
  }
  await deps.fulfillments.update(updatedFulfillment)
  const order = await deps.orders.findById(input.workspaceId, fulfillment.orderId)
  if (order !== undefined) {
    await deps.orders.update({ ...order, status: 'shipped', lastSyncedAt: now })
  }
  auditEvent(deps, input.workspaceId, 'procurement.shipped', 'ProcurementOrder', procurement.id, {
    carrier: input.carrier, trackingNumber: input.trackingNumber,
  }, input.actorId)
  return { procurement: updated, fulfillment: updatedFulfillment }
}
