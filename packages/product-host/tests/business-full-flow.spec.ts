import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProductImportHost } from '../src/index.ts'
import type { ProductHostConfig } from '../src/config.ts'

let root = ''
let config: ProductHostConfig
let host: ProductImportHost | null = null
let snapshot: any = null

afterEach(() => {
  host?.close()
  host = null
  snapshot = null
  if (root !== '') {
    rmSync(root, { recursive: true, force: true })
    root = ''
  }
})

async function start(): Promise<void> {
  root = mkdtempSync(join(tmpdir(), 'toneclaw-business-flow-'))
  config = {
    dbPath: join(root, 'product.sqlite'),
    dataDir: join(root, 'data'),
    importDir: join(root, 'import'),
    workspaceId: 'workspace-1',
    createdBy: 'toneclaw-operation',
    supplierCountry: 'CN',
    stabilityDelayMs: 0,
    pollIntervalMs: 100,
  }
  host = new ProductImportHost({}, config)
  host.startCommandServer()
  const csv = readFileSync(join(__dirname, '../../sourcing-provider/fixtures/valid-minimal.csv'))
  writeFileSync(join(config.importDir, 'catalog.csv'), csv)
  await host.scanNow()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    snapshot = JSON.parse(await readSnapshot())
    if (snapshot.commands !== undefined) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('command endpoint was not published')
}

async function readSnapshot(): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(join(config.dataDir, 'sourcing.json'), 'utf8')
}

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  if (snapshot === null || snapshot.commands === undefined) throw new Error('commands are not ready')
  const response = await fetch(`${snapshot.commands.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${snapshot.commands.token}`,
      Origin: 'dsh-app://product-ui',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, body: payload }
}

it('runs the full mock business chain from sourcing to fulfillment and refund', async () => {
  await start()
  const itemId = snapshot.items[0].id
  const itemView = await host!.productApi().getSourcingItemView(itemId)
  const supplierId = itemView.item.supplierId

  // S2: human selection and Product creation with cost-basis traceability.
  await post('/selection/decisions', {
    sourcingItemId: itemId,
    decision: 'approved',
    reason: 'Mock chain: margin and lead time pass',
  })
  const created = await post('/products/from-selection', { sourcingItemId: itemId })
  expect(created.status).toBe(200)
  const productId = String(created.body.productId)
  const variantId = String(created.body.variantId)

  // S3: mock authorization and governed manual listing lifecycle.
  const connection = await post('/platform/connections/start', {})
  expect(connection.status).toBe(200)
  const authorized = await post('/platform/connections/callback', {
    connectionId: connection.body.connectionId,
    state: connection.body.state,
    approved: true,
  })
  expect(authorized.body.storeStatus).toBe('connected')
  snapshot = JSON.parse(await readSnapshot())
  const storeId = String(snapshot.platform.stores[0].id)

  const generated = await post('/listings/generate', { productId, storeId })
  expect(generated.body.status).toBe('draft')
  const listingDraftId = String(generated.body.listingDraftId)
  await post('/listings/edit', {
    listingDraftId,
    title: 'Mock Linen storage box',
    description: 'Governed mock listing description',
    platformCategoryId: 'mock-cat-root',
    attributes: [{ key: 'material', value: 'Linen', valueType: 'string' }],
    priceMinor: 8990,
    stockQty: 80,
  })
  await post('/listings/content/adopt', { listingDraftId })
  const validated = await post('/listings/validate', { listingDraftId })
  expect(validated.body.status).toBe('validated')
  await post('/listings/approval/submit', { listingDraftId })
  await post('/listings/approval/decide', {
    listingDraftId, decision: 'approved', reason: 'Mock approval',
  })
  const packaged = await post('/listings/manual-package/generate', { listingDraftId })
  expect(packaged.status).toBe(200)
  await post('/listings/publish-confirmation/submit', { listingDraftId })
  const publishApproved = await post('/listings/publish-confirmation/decide', {
    listingDraftId, decision: 'approved', reason: 'Mock publish approval',
  })
  const publishJobId = String(publishApproved.body.publishJobId)
  await post('/listings/publish/manual-fallback', {
    publishJobId,
    manualPackageId: packaged.body.packageId,
    reason: 'Mock listing.create unavailable',
  })
  await post('/listings/manual-package/submit', { manualPackageId: packaged.body.packageId })
  const manualResult = await post('/listings/manual-result/import', {
    manualPackageId: packaged.body.packageId,
    externalListingId: 'MOCK-LISTING-FLOW-001',
    coreStatus: 'submitted',
    rawStatus: 'submitted',
  })
  const platformListingId = String(manualResult.body.platformListingId)
  await post('/platform-listings/status', {
    platformListingId,
    coreStatus: 'live',
    rawStatus: 'live',
  })

  // S4: order -> procurement -> hard payment gate -> provider shipment -> delivery -> refund.
  const imported = await post('/commerce/orders/import', {
    externalOrderId: 'TEMU-FLOW-001',
    orderNumber: 'N-FLOW-001',
    rawStatus: 'Created',
    subtotalMinor: 8990,
    shippingMinor: 500,
    placedAt: '2026-10-08T09:00:00Z',
    items: [{
      externalItemId: 'MOCK-ORDER-ITEM-1',
      productId,
      productVariantId: variantId,
      platformListingId,
      sku: 'MOCK-SKU-001',
      title: 'Mock Linen storage box',
      quantity: 1,
      unitPriceMinor: 8990,
    }],
  })
  expect(imported.status).toBe(200)
  const orderId = String(imported.body.orderId)

  const procurement = await post('/commerce/procurements/create', {
    orderId,
    sourcingItemId: itemId,
    supplierId,
    providerId: 'provider-001',
    quantity: 1,
    unitCostMinor: 6700,
    shippingFeeMinor: 300,
    serviceFeeMinor: 200,
  })
  expect(procurement.status).toBe(200)
  expect(procurement.body.totalPayableMinor).toBe(7200)
  const procurementOrderId = String(procurement.body.procurementOrderId)

  await post('/commerce/procurements/quote/confirm', { procurementOrderId })
  const blocked = await post('/commerce/procurements/provider-preparing', { procurementOrderId })
  expect(blocked.status).toBe(400)

  const payment = await post('/commerce/payments/create', { procurementOrderId })
  expect(payment.status).toBe(200)
  const paymentId = String(payment.body.paymentId)
  await post('/commerce/payments/redirect', { paymentId })
  const paid = await post('/commerce/payments/confirm', {
    paymentId,
    providerPaymentId: 'pay-flow-001',
  })
  expect(paid.body.procurementStatus).toBe('payment_confirmed')
  await post('/commerce/procurements/provider-preparing', { procurementOrderId })
  const shipped = await post('/commerce/procurements/ship', {
    procurementOrderId,
    carrier: 'Mock Express',
    trackingNumber: 'MOCK-TRACK-001',
    inTransit: true,
  })
  expect(shipped.body.procurementStatus).toBe('in_transit')
  await post('/commerce/procurements/deliver', { procurementOrderId })
  await post('/commerce/procurements/refund/request', {
    procurementOrderId,
    reason: 'Mock damaged delivery',
  })
  const refunded = await post('/commerce/procurements/refund/complete', { procurementOrderId })
  expect(refunded.body.procurementStatus).toBe('refunded')

  snapshot = JSON.parse(await readSnapshot())
  const orderItems = snapshot.commerce.orderItems.filter((item: any) => item.orderId === orderId)
  expect(orderItems[0]).toMatchObject({ productId, productVariantId: variantId, platformListingId })
  expect(snapshot.products.find((product: any) => product.id === productId)?.sourcingItemId).toBe(itemId)
  expect(snapshot.listings[0]).toMatchObject({ id: listingDraftId, productId, status: 'published_snapshot' })
  expect(snapshot.platformListings[0]).toMatchObject({ id: platformListingId, coreStatus: 'live' })
  expect(snapshot.commerce.orders[0]).toMatchObject({ id: orderId, status: 'delivered' })
  expect(snapshot.commerce.procurementOrders[0]).toMatchObject({
    id: procurementOrderId, sourcingItemId: itemId, supplierId, status: 'refunded',
  })
  expect(snapshot.commerce.payments[0]).toMatchObject({ status: 'refunded' })
  expect(snapshot.commerce.fulfillments[0]).toMatchObject({ status: 'delivered' })

  const packagePath = join(config.dataDir, String(packaged.body.fileRef))
  expect(existsSync(packagePath)).toBe(true)
  const audit = await host!.productApi().auditEvents(config.workspaceId)
  const actions = audit.map((event: { action: string }) => event.action)
  expect(actions).toEqual(expect.arrayContaining([
    'product.create_from_selection',
    'listing.draft_created',
    'listing.manual_result_imported',
    'listing.platform_status_updated',
    'order.imported',
    'procurement.created',
    'payment.confirmed',
    'procurement.shipped',
    'procurement.delivered',
    'procurement.refunded',
  ]))
})
