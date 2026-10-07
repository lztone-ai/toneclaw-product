/** Commerce operations per CORE_MODEL 10.1-10.3 / 07 §4-§5. */
import type { Platform } from '../platform/objects.ts'

export type OrderStatus =
  | 'created' | 'paid' | 'waiting_fulfillment' | 'partially_shipped' | 'shipped'
  | 'delivered' | 'canceled' | 'closed'

export interface Order {
  id: string
  businessAccountId: string
  storeId: string
  platform: Platform
  externalOrderId: string
  orderNumber: string
  status: OrderStatus
  rawStatus: string
  currency: string
  subtotalMinor: number
  shippingMinor: number
  discountMinor: number | null
  taxMinor: number | null
  totalMinor: number
  placedAt: string
  lastSyncedAt: string
}

export interface OrderItem {
  id: string
  businessAccountId: string
  orderId: string
  productId: string | null
  productVariantId: string | null
  platformListingId: string | null
  externalItemId: string
  sku: string
  title: string
  quantity: number
  unitPriceMinor: number
  currency: string
}

export type FulfillmentStatus =
  | 'pending' | 'stocking' | 'ready_to_ship' | 'shipped' | 'in_transit'
  | 'delivered' | 'exception' | 'canceled'

export interface Fulfillment {
  id: string
  businessAccountId: string
  orderId: string
  storeId: string
  platform: Platform
  externalFulfillmentId: string | null
  fulfillmentType: 'seller_shipping' | 'platform_logistics' | 'unknown'
  status: FulfillmentStatus
  rawStatus: string
  carrier: string | null
  trackingNumber: string | null
  shippedAt: string | null
  deliveredAt: string | null
  exceptionReason: string | null
}

export type ProcurementOrderStatus =
  | 'created' | 'quote_pending' | 'quote_confirmed' | 'awaiting_payment' | 'payment_confirmed'
  | 'provider_preparing' | 'shipped' | 'in_transit' | 'delivered' | 'closed'
  | 'payment_failed' | 'payment_expired' | 'provider_delay' | 'shipment_exception'
  | 'refund_requested' | 'refunded' | 'quote_failed' | 'out_of_stock' | 'canceled'

export interface ProcurementOrder {
  id: string
  businessAccountId: string
  storeId: string
  marketplaceOrderId: string
  fulfillmentId: string
  sourcingItemId: string
  supplierId: string
  providerId: string
  status: ProcurementOrderStatus
  quantity: number
  unitCostMinor: number
  shippingFeeMinor: number
  serviceFeeMinor: number
  totalPayableMinor: number
  currency: string
  quoteConfirmedAt: string | null
  paymentDueAt: string | null
  providerPromisedShipAt: string | null
  shippedAt: string | null
  trackingNumber: string | null
  carrier: string | null
  createdAt: string
  updatedAt: string
}

export type PaymentSessionStatus =
  | 'created' | 'redirected' | 'payment_submitted' | 'paid_confirmed' | 'failed'
  | 'expired' | 'canceled' | 'needs_review' | 'refund_requested' | 'refunded'

export interface PaymentSession {
  id: string
  businessAccountId: string
  procurementOrderId: string
  providerId: string
  providerPaymentId: string | null
  amountMinor: number
  currency: string
  status: PaymentSessionStatus
  paymentUrl: string | null
  paymentReferenceNo: string
  expiresAt: string | null
  redirectAt: string | null
  callbackReceivedAt: string | null
  confirmedAt: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
}
