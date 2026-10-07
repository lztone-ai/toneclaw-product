/** Order/procurement repositories (S4). One context module per business subdomain —
 * infrastructure stays out of core-domain and the ProductStorage God class stays thin. */
import type { DatabaseSync } from 'node:sqlite'
import type {
  Fulfillment,
  Order,
  OrderItem,
  PaymentSession,
  ProcurementOrder,
} from '@toneclaw/core-domain'
import type { CommerceRepositories } from '@toneclaw/core-domain'

interface OrderRow {
  id: string
  business_account_id: string
  store_id: string
  platform: Order['platform']
  external_order_id: string
  order_number: string
  status: Order['status']
  raw_status: string
  currency: string
  subtotal_minor: number
  shipping_minor: number
  discount_minor: number | null
  tax_minor: number | null
  total_minor: number
  placed_at: string
  last_synced_at: string
}

interface OrderItemRow {
  id: string
  business_account_id: string
  order_id: string
  product_id: string | null
  product_variant_id: string | null
  platform_listing_id: string | null
  external_item_id: string
  sku: string
  title: string
  quantity: number
  unit_price_minor: number
  currency: string
}

interface FulfillmentRow {
  id: string
  business_account_id: string
  order_id: string
  store_id: string
  platform: Fulfillment['platform']
  external_fulfillment_id: string | null
  fulfillment_type: Fulfillment['fulfillmentType']
  status: Fulfillment['status']
  raw_status: string
  carrier: string | null
  tracking_number: string | null
  shipped_at: string | null
  delivered_at: string | null
  exception_reason: string | null
}

interface ProcurementOrderRow {
  id: string
  business_account_id: string
  store_id: string
  marketplace_order_id: string
  fulfillment_id: string
  sourcing_item_id: string
  supplier_id: string
  provider_id: string
  status: ProcurementOrder['status']
  quantity: number
  unit_cost_minor: number
  shipping_fee_minor: number
  service_fee_minor: number
  total_payable_minor: number
  currency: string
  quote_confirmed_at: string | null
  payment_due_at: string | null
  provider_promised_ship_at: string | null
  shipped_at: string | null
  tracking_number: string | null
  carrier: string | null
  created_at: string
  updated_at: string
}

interface PaymentSessionRow {
  id: string
  business_account_id: string
  procurement_order_id: string
  provider_id: string
  provider_payment_id: string | null
  amount_minor: number
  currency: string
  status: PaymentSession['status']
  payment_url: string | null
  payment_reference_no: string
  expires_at: string | null
  redirect_at: string | null
  callback_received_at: string | null
  confirmed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    storeId: row.store_id,
    platform: row.platform,
    externalOrderId: row.external_order_id,
    orderNumber: row.order_number,
    status: row.status,
    rawStatus: row.raw_status,
    currency: row.currency,
    subtotalMinor: row.subtotal_minor,
    shippingMinor: row.shipping_minor,
    discountMinor: row.discount_minor,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor,
    placedAt: row.placed_at,
    lastSyncedAt: row.last_synced_at,
  }
}

function mapOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    orderId: row.order_id,
    productId: row.product_id,
    productVariantId: row.product_variant_id,
    platformListingId: row.platform_listing_id,
    externalItemId: row.external_item_id,
    sku: row.sku,
    title: row.title,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    currency: row.currency,
  }
}

function mapFulfillment(row: FulfillmentRow): Fulfillment {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    orderId: row.order_id,
    storeId: row.store_id,
    platform: row.platform,
    externalFulfillmentId: row.external_fulfillment_id,
    fulfillmentType: row.fulfillment_type,
    status: row.status,
    rawStatus: row.raw_status,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    shippedAt: row.shipped_at,
    deliveredAt: row.delivered_at,
    exceptionReason: row.exception_reason,
  }
}

function mapProcurementOrder(row: ProcurementOrderRow): ProcurementOrder {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    storeId: row.store_id,
    marketplaceOrderId: row.marketplace_order_id,
    fulfillmentId: row.fulfillment_id,
    sourcingItemId: row.sourcing_item_id,
    supplierId: row.supplier_id,
    providerId: row.provider_id,
    status: row.status,
    quantity: row.quantity,
    unitCostMinor: row.unit_cost_minor,
    shippingFeeMinor: row.shipping_fee_minor,
    serviceFeeMinor: row.service_fee_minor,
    totalPayableMinor: row.total_payable_minor,
    currency: row.currency,
    quoteConfirmedAt: row.quote_confirmed_at,
    paymentDueAt: row.payment_due_at,
    providerPromisedShipAt: row.provider_promised_ship_at,
    shippedAt: row.shipped_at,
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapPaymentSession(row: PaymentSessionRow): PaymentSession {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    procurementOrderId: row.procurement_order_id,
    providerId: row.provider_id,
    providerPaymentId: row.provider_payment_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
    paymentUrl: row.payment_url,
    paymentReferenceNo: row.payment_reference_no,
    expiresAt: row.expires_at,
    redirectAt: row.redirect_at,
    callbackReceivedAt: row.callback_received_at,
    confirmedAt: row.confirmed_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createCommerceRepositories(db: DatabaseSync): CommerceRepositories {
  return {
    orders: {
      insert: async order => {
        db.prepare(`
          INSERT INTO orders (
            id, business_account_id, store_id, platform, external_order_id,
            order_number, status, raw_status, currency, subtotal_minor,
            shipping_minor, discount_minor, tax_minor, total_minor, placed_at,
            last_synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          order.id, order.businessAccountId, order.storeId, order.platform,
          order.externalOrderId, order.orderNumber, order.status, order.rawStatus,
          order.currency, order.subtotalMinor, order.shippingMinor,
          order.discountMinor, order.taxMinor, order.totalMinor, order.placedAt,
          order.lastSyncedAt,
        )
      },
      findById: async (businessAccountId, id) => {
        const row = db.prepare(`
          SELECT * FROM orders WHERE id = ? AND business_account_id = ? LIMIT 1
        `).get(id, businessAccountId) as unknown as OrderRow | undefined
        return row === undefined ? undefined : mapOrder(row)
      },
      findByExternalId: async (businessAccountId, platform, externalOrderId) => {
        const row = db.prepare(`
          SELECT * FROM orders
          WHERE business_account_id = ? AND platform = ? AND external_order_id = ?
          LIMIT 1
        `).get(businessAccountId, platform, externalOrderId) as unknown as OrderRow | undefined
        return row === undefined ? undefined : mapOrder(row)
      },
      list: async businessAccountId => {
        const rows = db.prepare(`
          SELECT * FROM orders WHERE business_account_id = ?
          ORDER BY placed_at DESC, id DESC
        `).all(businessAccountId) as unknown as OrderRow[]
        return rows.map(mapOrder)
      },
      update: async order => {
        db.prepare(`
          UPDATE orders SET
            store_id = ?, platform = ?, external_order_id = ?, order_number = ?,
            status = ?, raw_status = ?, currency = ?, subtotal_minor = ?,
            shipping_minor = ?, discount_minor = ?, tax_minor = ?, total_minor = ?,
            placed_at = ?, last_synced_at = ?
          WHERE id = ? AND business_account_id = ?
        `).run(
          order.storeId, order.platform, order.externalOrderId, order.orderNumber,
          order.status, order.rawStatus, order.currency, order.subtotalMinor,
          order.shippingMinor, order.discountMinor, order.taxMinor, order.totalMinor,
          order.placedAt, order.lastSyncedAt, order.id, order.businessAccountId,
        )
      },
    },
    orderItems: {
      insertMany: async items => {
        if (items.length === 0) return
        db.exec('BEGIN IMMEDIATE')
        try {
          const statement = db.prepare(`
            INSERT INTO order_items (
              id, business_account_id, order_id, product_id, product_variant_id,
              platform_listing_id, external_item_id, sku, title, quantity,
              unit_price_minor, currency
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const item of items) {
            statement.run(
              item.id, item.businessAccountId, item.orderId, item.productId,
              item.productVariantId, item.platformListingId, item.externalItemId,
              item.sku, item.title, item.quantity, item.unitPriceMinor, item.currency,
            )
          }
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      listByOrder: async (businessAccountId, orderId) => {
        const rows = db.prepare(`
          SELECT * FROM order_items
          WHERE business_account_id = ? AND order_id = ?
          ORDER BY id
        `).all(businessAccountId, orderId) as unknown as OrderItemRow[]
        return rows.map(mapOrderItem)
      },
    },
    fulfillments: {
      insert: async fulfillment => {
        db.prepare(`
          INSERT INTO fulfillments (
            id, business_account_id, order_id, store_id, platform,
            external_fulfillment_id, fulfillment_type, status, raw_status,
            carrier, tracking_number, shipped_at, delivered_at, exception_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fulfillment.id, fulfillment.businessAccountId, fulfillment.orderId,
          fulfillment.storeId, fulfillment.platform, fulfillment.externalFulfillmentId,
          fulfillment.fulfillmentType, fulfillment.status, fulfillment.rawStatus,
          fulfillment.carrier, fulfillment.trackingNumber, fulfillment.shippedAt,
          fulfillment.deliveredAt, fulfillment.exceptionReason,
        )
      },
      findById: async (businessAccountId, id) => {
        const row = db.prepare(`
          SELECT * FROM fulfillments WHERE id = ? AND business_account_id = ? LIMIT 1
        `).get(id, businessAccountId) as unknown as FulfillmentRow | undefined
        return row === undefined ? undefined : mapFulfillment(row)
      },
      list: async businessAccountId => {
        const rows = db.prepare(`
          SELECT * FROM fulfillments WHERE business_account_id = ? ORDER BY id
        `).all(businessAccountId) as unknown as FulfillmentRow[]
        return rows.map(mapFulfillment)
      },
      listByOrder: async (businessAccountId, orderId) => {
        const rows = db.prepare(`
          SELECT * FROM fulfillments
          WHERE business_account_id = ? AND order_id = ?
          ORDER BY id
        `).all(businessAccountId, orderId) as unknown as FulfillmentRow[]
        return rows.map(mapFulfillment)
      },
      update: async fulfillment => {
        db.prepare(`
          UPDATE fulfillments SET
            order_id = ?, store_id = ?, platform = ?, external_fulfillment_id = ?,
            fulfillment_type = ?, status = ?, raw_status = ?, carrier = ?,
            tracking_number = ?, shipped_at = ?, delivered_at = ?, exception_reason = ?
          WHERE id = ? AND business_account_id = ?
        `).run(
          fulfillment.orderId, fulfillment.storeId, fulfillment.platform,
          fulfillment.externalFulfillmentId, fulfillment.fulfillmentType,
          fulfillment.status, fulfillment.rawStatus, fulfillment.carrier,
          fulfillment.trackingNumber, fulfillment.shippedAt, fulfillment.deliveredAt,
          fulfillment.exceptionReason, fulfillment.id, fulfillment.businessAccountId,
        )
      },
    },
    procurementOrders: {
      insert: async order => {
        db.prepare(`
          INSERT INTO procurement_orders (
            id, business_account_id, store_id, marketplace_order_id, fulfillment_id,
            sourcing_item_id, supplier_id, provider_id, status, quantity,
            unit_cost_minor, shipping_fee_minor, service_fee_minor,
            total_payable_minor, currency, quote_confirmed_at, payment_due_at,
            provider_promised_ship_at, shipped_at, tracking_number, carrier,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          order.id, order.businessAccountId, order.storeId, order.marketplaceOrderId,
          order.fulfillmentId, order.sourcingItemId, order.supplierId, order.providerId,
          order.status, order.quantity, order.unitCostMinor, order.shippingFeeMinor,
          order.serviceFeeMinor, order.totalPayableMinor, order.currency,
          order.quoteConfirmedAt, order.paymentDueAt, order.providerPromisedShipAt,
          order.shippedAt, order.trackingNumber, order.carrier, order.createdAt,
          order.updatedAt,
        )
      },
      findById: async (businessAccountId, id) => {
        const row = db.prepare(`
          SELECT * FROM procurement_orders
          WHERE id = ? AND business_account_id = ? LIMIT 1
        `).get(id, businessAccountId) as unknown as ProcurementOrderRow | undefined
        return row === undefined ? undefined : mapProcurementOrder(row)
      },
      list: async businessAccountId => {
        const rows = db.prepare(`
          SELECT * FROM procurement_orders WHERE business_account_id = ?
          ORDER BY created_at DESC, id DESC
        `).all(businessAccountId) as unknown as ProcurementOrderRow[]
        return rows.map(mapProcurementOrder)
      },
      update: async order => {
        db.prepare(`
          UPDATE procurement_orders SET
            store_id = ?, marketplace_order_id = ?, fulfillment_id = ?,
            sourcing_item_id = ?, supplier_id = ?, provider_id = ?, status = ?,
            quantity = ?, unit_cost_minor = ?, shipping_fee_minor = ?,
            service_fee_minor = ?, total_payable_minor = ?, currency = ?,
            quote_confirmed_at = ?, payment_due_at = ?,
            provider_promised_ship_at = ?, shipped_at = ?, tracking_number = ?,
            carrier = ?, updated_at = ?
          WHERE id = ? AND business_account_id = ?
        `).run(
          order.storeId, order.marketplaceOrderId, order.fulfillmentId,
          order.sourcingItemId, order.supplierId, order.providerId, order.status,
          order.quantity, order.unitCostMinor, order.shippingFeeMinor,
          order.serviceFeeMinor, order.totalPayableMinor, order.currency,
          order.quoteConfirmedAt, order.paymentDueAt, order.providerPromisedShipAt,
          order.shippedAt, order.trackingNumber, order.carrier, order.updatedAt,
          order.id, order.businessAccountId,
        )
      },
    },
    paymentSessions: {
      insert: async session => {
        db.prepare(`
          INSERT INTO payment_sessions (
            id, business_account_id, procurement_order_id, provider_id,
            provider_payment_id, amount_minor, currency, status, payment_url,
            payment_reference_no, expires_at, redirect_at, callback_received_at,
            confirmed_at, failure_reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          session.id, session.businessAccountId, session.procurementOrderId,
          session.providerId, session.providerPaymentId, session.amountMinor,
          session.currency, session.status, session.paymentUrl,
          session.paymentReferenceNo, session.expiresAt, session.redirectAt,
          session.callbackReceivedAt, session.confirmedAt, session.failureReason,
          session.createdAt, session.updatedAt,
        )
      },
      findById: async (businessAccountId, id) => {
        const row = db.prepare(`
          SELECT * FROM payment_sessions
          WHERE id = ? AND business_account_id = ? LIMIT 1
        `).get(id, businessAccountId) as unknown as PaymentSessionRow | undefined
        return row === undefined ? undefined : mapPaymentSession(row)
      },
      listByProcurementOrder: async (businessAccountId, procurementOrderId) => {
        const rows = db.prepare(`
          SELECT * FROM payment_sessions
          WHERE business_account_id = ? AND procurement_order_id = ?
          ORDER BY created_at ASC, id ASC
        `).all(businessAccountId, procurementOrderId) as unknown as PaymentSessionRow[]
        return rows.map(mapPaymentSession)
      },
      update: async session => {
        db.prepare(`
          UPDATE payment_sessions SET
            procurement_order_id = ?, provider_id = ?, provider_payment_id = ?,
            amount_minor = ?, currency = ?, status = ?, payment_url = ?,
            payment_reference_no = ?, expires_at = ?, redirect_at = ?,
            callback_received_at = ?, confirmed_at = ?, failure_reason = ?,
            updated_at = ?
          WHERE id = ? AND business_account_id = ?
        `).run(
          session.procurementOrderId, session.providerId, session.providerPaymentId,
          session.amountMinor, session.currency, session.status, session.paymentUrl,
          session.paymentReferenceNo, session.expiresAt, session.redirectAt,
          session.callbackReceivedAt, session.confirmedAt, session.failureReason,
          session.updatedAt, session.id, session.businessAccountId,
        )
      },
    },
  }
}
