import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProductStorage } from '../src/product-storage.ts'
import {
  confirmPayment,
  confirmQuote,
  createPaymentSession,
  createProcurementOrder,
  importOrder,
  prepareProviderShipment,
  shipProcurement,
} from '@toneclaw/core-domain'

const dirs: string[] = []
const storages: ProductStorage[] = []
const tempBase = resolve(import.meta.dirname, '../../../tmp')

afterEach(() => {
  for (const storage of storages.splice(0)) {
    try { storage.close() } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStorage(): ProductStorage {
  mkdirSync(tempBase, { recursive: true })
  const dir = mkdtempSync(join(tempBase, 'commerce-'))
  dirs.push(dir)
  const storage = new ProductStorage(join(dir, 'product.sqlite'))
  storages.push(storage)
  return storage
}

function seedStore(storage: ProductStorage): void {
  storage.prepare(`
    INSERT INTO business_workspaces (
      id, business_account_id, name, is_default, created_at, updated_at
    ) VALUES ('ws-1', 'ws', 'Default', 1, '2026-10-08T00:00:00Z', '2026-10-08T00:00:00Z')
  `).run()
  storage.prepare(`
    INSERT INTO stores (
      id, business_account_id, platform_connection_id, platform,
      external_seller_account_id, external_store_id, name, region, business_mode,
      currency, timezone, status, connected_at, last_synced_at
    ) VALUES ('store-1', 'ws', 'conn-1', 'temu', 'seller-1', 'shop-1', 'Temu Store',
      'US', 'semi_managed', 'USD', 'America/New_York', 'connected',
      '2026-10-08T00:00:00Z', NULL)
  `).run()
}

function depsFor(storage: ProductStorage) {
  let sequence = 0
  return {
    ids: { next: () => `id-${++sequence}` },
    clock: { now: () => new Date('2026-10-08T10:00:00Z') },
    audit: storage.audit,
    stores: storage.stores,
    ...storage.commerce,
  }
}

it('runs the S4 commerce lifecycle through SQLite and persists it across reopen', async () => {
  const path = join(makeStorage().path)
  const first = storages[0]!
  seedStore(first)
  const deps = depsFor(first)

  const firstOrder = await importOrder(deps, {
    workspaceId: 'ws', actorId: 'seller-1', storeId: 'store-1',
    externalOrderId: 'TEMU-1', orderNumber: 'N-1', rawStatus: 'Created',
    subtotalMinor: 10000, shippingMinor: 500, placedAt: '2026-10-08T09:00:00Z',
    items: [{
      externalItemId: 'item-1', sku: 'SKU-1', title: 'Portable Blender',
      quantity: 1, unitPriceMinor: 10000,
    }],
  })
  await expect(importOrder(deps, {
    workspaceId: 'ws', actorId: 'seller-1', storeId: 'store-1',
    externalOrderId: 'TEMU-1', orderNumber: 'N-1-duplicate', rawStatus: 'Created',
    subtotalMinor: 10000, placedAt: '2026-10-08T09:00:00Z',
    items: [{ externalItemId: 'item-1', sku: 'SKU-1', title: 'Portable Blender', quantity: 1, unitPriceMinor: 10000 }],
  })).resolves.toMatchObject({ id: firstOrder.id })

  const procurement = await createProcurementOrder(deps, {
    workspaceId: 'ws', actorId: 'seller-1', orderId: firstOrder.id,
    sourcingItemId: 'item-1', supplierId: 'supplier-1', providerId: 'provider-1',
    quantity: 1, unitCostMinor: 6700, shippingFeeMinor: 300, serviceFeeMinor: 200,
  })
  await confirmQuote(deps, { workspaceId: 'ws', actorId: 'seller-1', procurementOrderId: procurement.id })
  const session = await createPaymentSession(deps, {
    workspaceId: 'ws', actorId: 'seller-1', procurementOrderId: procurement.id,
    paymentUrl: 'https://provider.example/pay', expiresAt: '2026-10-09T10:00:00Z',
  })
  await first.commerce.paymentSessions.update({ ...session, status: 'redirected', redirectAt: '2026-10-08T10:01:00Z' })
  const paid = await confirmPayment(deps, {
    workspaceId: 'ws', actorId: 'seller-1', paymentSessionId: session.id,
    providerPaymentId: 'pay-1',
  })
  await prepareProviderShipment(deps, {
    workspaceId: 'ws', actorId: 'provider-operator', procurementOrderId: procurement.id,
  })
  const shipped = await shipProcurement(deps, {
    workspaceId: 'ws', actorId: 'provider-operator', procurementOrderId: procurement.id,
    carrier: 'UPS', trackingNumber: '1Z-123', inTransit: true,
  })

  expect(paid.procurement.status).toBe('payment_confirmed')
  expect(shipped.procurement.status).toBe('in_transit')
  expect(shipped.fulfillment.status).toBe('in_transit')
  expect(shipped.procurement.trackingNumber).toBe('1Z-123')
  expect((await first.commerce.orders.findByExternalId('ws', 'temu', 'TEMU-1'))?.status).toBe('shipped')
  expect((await first.commerce.paymentSessions.findById('ws', session.id))?.status).toBe('paid_confirmed')
  expect(first.auditEvents('ws').map(event => event.action)).toContain('procurement.shipped')

  first.close()
  const second = new ProductStorage(path)
  storages.push(second)
  expect((await second.commerce.orders.findById('ws', firstOrder.id))?.status).toBe('shipped')
  expect((await second.commerce.procurementOrders.findById('ws', procurement.id))?.status).toBe('in_transit')
  expect(await second.commerce.orderItems.listByOrder('ws', firstOrder.id)).toHaveLength(1)
  expect(await second.commerce.fulfillments.listByOrder('ws', firstOrder.id)).toHaveLength(1)
})

it('blocks provider preparing while the latest payment is unpaid', async () => {
  const storage = makeStorage()
  seedStore(storage)
  const deps = depsFor(storage)
  const order = await importOrder(deps, {
    workspaceId: 'ws', actorId: 'seller-1', storeId: 'store-1',
    externalOrderId: 'TEMU-2', orderNumber: 'N-2', rawStatus: 'Created',
    subtotalMinor: 5000, placedAt: '2026-10-08T09:00:00Z',
    items: [{ externalItemId: 'item-2', sku: 'SKU-2', title: 'Desk Lamp', quantity: 1, unitPriceMinor: 5000 }],
  })
  const procurement = await createProcurementOrder(deps, {
    workspaceId: 'ws', actorId: 'seller-1', orderId: order.id,
    sourcingItemId: 'item-2', supplierId: 'supplier-1', providerId: 'provider-1',
    quantity: 1, unitCostMinor: 3000,
  })
  await confirmQuote(deps, { workspaceId: 'ws', actorId: 'seller-1', procurementOrderId: procurement.id })
  const session = await createPaymentSession(deps, { workspaceId: 'ws', actorId: 'seller-1', procurementOrderId: procurement.id })
  await storage.commerce.paymentSessions.update({ ...session, status: 'redirected' })

  await expect(prepareProviderShipment(deps, {
    workspaceId: 'ws', actorId: 'provider-operator', procurementOrderId: procurement.id,
  })).rejects.toThrow('provider preparing requires payment_confirmed')
  expect((await storage.commerce.procurementOrders.findById('ws', procurement.id))?.status).toBe('awaiting_payment')
})
