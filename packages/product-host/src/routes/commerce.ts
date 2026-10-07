/** S4 commerce command routes. Writes delegate to core-domain state machines only. */
import {
  completeProcurementRefund,
  confirmPayment,
  confirmQuote,
  createPaymentSession,
  createProcurementOrder,
  deliverProcurement,
  importOrder,
  prepareProviderShipment,
  redirectPaymentSession,
  requestProcurementRefund,
  shipProcurement,
  type CommerceDeps,
} from '@toneclaw/core-domain'

export interface CommerceRouteContext {
  workspaceId: string
  actorId: string
  connectedStoreId: (value: unknown) => Promise<string>
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`)
  return value
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${name} must be an integer`)
  return value
}

function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : requireString(value, name)
}

function orderItems(value: unknown): Parameters<typeof importOrder>[1]['items'] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('order items are required')
  return value.map(item => {
    const record = item as Record<string, unknown>
    const productId = optionalString(record['productId'], 'item.productId')
    const productVariantId = optionalString(record['productVariantId'], 'item.productVariantId')
    const platformListingId = optionalString(record['platformListingId'], 'item.platformListingId')
    return {
      externalItemId: requireString(record['externalItemId'], 'item.externalItemId'),
      sku: requireString(record['sku'], 'item.sku'),
      title: requireString(record['title'], 'item.title'),
      quantity: requireInteger(record['quantity'], 'item.quantity'),
      unitPriceMinor: requireInteger(record['unitPriceMinor'], 'item.unitPriceMinor'),
      ...(productId === undefined ? {} : { productId }),
      ...(productVariantId === undefined ? {} : { productVariantId }),
      ...(platformListingId === undefined ? {} : { platformListingId }),
    }
  })
}

function isCommerceCommand(pathname: string): boolean {
  return pathname.startsWith('/commerce/orders/')
    || pathname.startsWith('/commerce/procurements/')
    || pathname.startsWith('/commerce/payments/')
}

export async function handleCommerceCommand(
  pathname: string,
  input: Record<string, unknown>,
  deps: CommerceDeps,
  context: CommerceRouteContext,
  send: (status: number, body: unknown) => void,
  refresh: () => Promise<void>,
): Promise<boolean> {
  if (!isCommerceCommand(pathname)) return false
  if (pathname === '/commerce/orders/import') {
    const storeId = await context.connectedStoreId(input['storeId'])
    const order = await importOrder(deps, {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      storeId,
      externalOrderId: requireString(input['externalOrderId'], 'externalOrderId'),
      orderNumber: requireString(input['orderNumber'], 'orderNumber'),
      rawStatus: requireString(input['rawStatus'], 'rawStatus'),
      subtotalMinor: requireInteger(input['subtotalMinor'], 'subtotalMinor'),
      ...(input['shippingMinor'] === undefined ? {} : { shippingMinor: requireInteger(input['shippingMinor'], 'shippingMinor') }),
      ...(input['discountMinor'] === undefined ? {} : { discountMinor: requireInteger(input['discountMinor'], 'discountMinor') }),
      ...(input['taxMinor'] === undefined ? {} : { taxMinor: requireInteger(input['taxMinor'], 'taxMinor') }),
      ...(input['totalMinor'] === undefined ? {} : { totalMinor: requireInteger(input['totalMinor'], 'totalMinor') }),
      placedAt: requireString(input['placedAt'], 'placedAt'),
      items: orderItems(input['items']),
    })
    await refresh()
    send(200, { orderId: order.id, status: order.status })
    return true
  }
  if (pathname === '/commerce/procurements/create') {
    const order = await createProcurementOrder(deps, {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      orderId: requireString(input['orderId'], 'orderId'),
      sourcingItemId: requireString(input['sourcingItemId'], 'sourcingItemId'),
      supplierId: requireString(input['supplierId'], 'supplierId'),
      providerId: requireString(input['providerId'], 'providerId'),
      quantity: requireInteger(input['quantity'], 'quantity'),
      unitCostMinor: requireInteger(input['unitCostMinor'], 'unitCostMinor'),
      ...(input['shippingFeeMinor'] === undefined ? {} : { shippingFeeMinor: requireInteger(input['shippingFeeMinor'], 'shippingFeeMinor') }),
      ...(input['serviceFeeMinor'] === undefined ? {} : { serviceFeeMinor: requireInteger(input['serviceFeeMinor'], 'serviceFeeMinor') }),
    })
    await refresh()
    send(200, { procurementOrderId: order.id, status: order.status, totalPayableMinor: order.totalPayableMinor })
    return true
  }
  if (pathname === '/commerce/procurements/quote/confirm') {
    const order = await confirmQuote(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      procurementOrderId: requireString(input['procurementOrderId'], 'procurementOrderId'),
    })
    await refresh()
    send(200, { procurementOrderId: order.id, status: order.status })
    return true
  }
  if (pathname === '/commerce/payments/create') {
    const paymentUrl = optionalString(input['paymentUrl'], 'paymentUrl')
    const expiresAt = optionalString(input['expiresAt'], 'expiresAt')
    const session = await createPaymentSession(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      procurementOrderId: requireString(input['procurementOrderId'], 'procurementOrderId'),
      ...(paymentUrl === undefined ? {} : { paymentUrl }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    })
    await refresh()
    send(200, { paymentId: session.id, status: session.status, amountMinor: session.amountMinor })
    return true
  }
  if (pathname === '/commerce/payments/redirect') {
    const session = await redirectPaymentSession(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      paymentSessionId: requireString(input['paymentId'], 'paymentId'),
    })
    await refresh()
    send(200, { paymentId: session.id, status: session.status })
    return true
  }
  if (pathname === '/commerce/payments/confirm') {
    const providerPaymentId = optionalString(input['providerPaymentId'], 'providerPaymentId')
    const result = await confirmPayment(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      paymentSessionId: requireString(input['paymentId'], 'paymentId'),
      ...(providerPaymentId === undefined ? {} : { providerPaymentId }),
    })
    await refresh()
    send(200, {
      paymentId: result.session.id, paymentStatus: result.session.status,
      procurementOrderId: result.procurement.id, procurementStatus: result.procurement.status,
    })
    return true
  }
  if (pathname === '/commerce/procurements/provider-preparing') {
    const order = await prepareProviderShipment(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      procurementOrderId: requireString(input['procurementOrderId'], 'procurementOrderId'),
    })
    await refresh()
    send(200, { procurementOrderId: order.id, status: order.status })
    return true
  }
  if (pathname === '/commerce/procurements/ship') {
    const shippedAt = optionalString(input['shippedAt'], 'shippedAt')
    const result = await shipProcurement(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      procurementOrderId: requireString(input['procurementOrderId'], 'procurementOrderId'),
      carrier: requireString(input['carrier'], 'carrier'),
      trackingNumber: requireString(input['trackingNumber'], 'trackingNumber'),
      ...(shippedAt === undefined ? {} : { shippedAt }),
      ...(input['inTransit'] === undefined ? {} : { inTransit: input['inTransit'] === true }),
    })
    await refresh()
    send(200, {
      procurementOrderId: result.procurement.id, procurementStatus: result.procurement.status,
      fulfillmentId: result.fulfillment.id, fulfillmentStatus: result.fulfillment.status,
    })
    return true
  }
  if (pathname === '/commerce/procurements/deliver') {
    const deliveredAt = optionalString(input['deliveredAt'], 'deliveredAt')
    const result = await deliverProcurement(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      procurementOrderId: requireString(input['procurementOrderId'], 'procurementOrderId'),
      ...(deliveredAt === undefined ? {} : { deliveredAt }),
    })
    await refresh()
    send(200, {
      procurementOrderId: result.procurement.id, procurementStatus: result.procurement.status,
      fulfillmentStatus: result.fulfillment.status,
    })
    return true
  }
  if (pathname === '/commerce/procurements/refund/request') {
    const result = await requestProcurementRefund(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      procurementOrderId: requireString(input['procurementOrderId'], 'procurementOrderId'),
      reason: requireString(input['reason'], 'reason'),
    })
    await refresh()
    send(200, { procurementStatus: result.procurement.status, paymentStatus: result.session.status })
    return true
  }
  if (pathname === '/commerce/procurements/refund/complete') {
    const result = await completeProcurementRefund(deps, {
      workspaceId: context.workspaceId, actorId: context.actorId,
      procurementOrderId: requireString(input['procurementOrderId'], 'procurementOrderId'),
    })
    await refresh()
    send(200, { procurementStatus: result.procurement.status, paymentStatus: result.session.status })
    return true
  }
  send(404, { error: 'commerce command not found' })
  return true
}
