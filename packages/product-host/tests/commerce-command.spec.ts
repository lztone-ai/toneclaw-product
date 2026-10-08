import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProductImportHost } from '../src/index.ts'
import type { ProductHostConfig } from '../src/config.ts'

let root = ''
let config: ProductHostConfig
let host: ProductImportHost | null = null
let snapshot: any = null
const allowAllBillingAuthority = {
  validateFeature: () => ({ featureKey: 'test-allow', allowed: true }),
}

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
  root = mkdtempSync(join(tmpdir(), 'toneclaw-commerce-host-'))
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
  host = new ProductImportHost({}, config, allowAllBillingAuthority)
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

it('runs order, procurement, payment, shipment, delivery, and refund commands', async () => {
  await start()
  const itemId = snapshot.items[0].id
  const connection = await post('/platform/connections/start', {})
  expect(connection.status).toBe(200)
  const authorized = await post('/platform/connections/callback', {
    connectionId: connection.body.connectionId,
    state: connection.body.state,
    approved: true,
  })
  expect(authorized.body.storeStatus).toBe('connected')

  const imported = await post('/commerce/orders/import', {
    externalOrderId: 'TEMU-E2E-1',
    orderNumber: 'N-E2E-1',
    rawStatus: 'Created',
    subtotalMinor: 10000,
    shippingMinor: 500,
    placedAt: '2026-10-08T09:00:00Z',
    items: [{
      externalItemId: 'EXT-ITEM-1',
      sku: 'SKU-1',
      title: 'Portable Blender',
      quantity: 1,
      unitPriceMinor: 10000,
    }],
  })
  expect(imported.status).toBe(200)
  const orderId = imported.body.orderId

  const procurement = await post('/commerce/procurements/create', {
    orderId,
    sourcingItemId: itemId,
    supplierId: 'supplier-1',
    providerId: 'provider-001',
    quantity: 1,
    unitCostMinor: 6700,
    shippingFeeMinor: 300,
    serviceFeeMinor: 200,
  })
  expect(procurement.status).toBe(200)
  expect(procurement.body.totalPayableMinor).toBe(7200)
  const procurementOrderId = procurement.body.procurementOrderId

  await post('/commerce/procurements/quote/confirm', { procurementOrderId })
  const blocked = await post('/commerce/procurements/provider-preparing', { procurementOrderId })
  expect(blocked.status).toBe(400)

  const session = await post('/commerce/payments/create', { procurementOrderId })
  expect(session.status).toBe(200)
  await post('/commerce/payments/redirect', { paymentId: session.body.paymentId })
  const paid = await post('/commerce/payments/confirm', {
    paymentId: session.body.paymentId,
    providerPaymentId: 'pay-e2e-1',
  })
  expect(paid.body.procurementStatus).toBe('payment_confirmed')
  await post('/commerce/procurements/provider-preparing', { procurementOrderId })
  const shipped = await post('/commerce/procurements/ship', {
    procurementOrderId,
    carrier: 'UPS',
    trackingNumber: '1Z-E2E-1',
    inTransit: true,
  })
  expect(shipped.body.procurementStatus).toBe('in_transit')
  await post('/commerce/procurements/deliver', { procurementOrderId })
  await post('/commerce/procurements/refund/request', {
    procurementOrderId,
    reason: 'damaged on delivery',
  })
  const refunded = await post('/commerce/procurements/refund/complete', { procurementOrderId })
  expect(refunded.body.procurementStatus).toBe('refunded')

  snapshot = JSON.parse(await readSnapshot())
  expect(snapshot.commerce.orders[0].status).toBe('delivered')
  expect(snapshot.commerce.procurementOrders[0].status).toBe('refunded')
  expect(snapshot.commerce.payments[0].status).toBe('refunded')
  expect(snapshot.commerce.fulfillments[0].status).toBe('delivered')
  expect(snapshot.commerce.orderItems).toHaveLength(1)
  expect(snapshot.finance.summary).toMatchObject({
    revenueMinor: 10_500,
    costMinor: 7_700,
    grossProfitMinor: 2_800,
    netProfitMinor: 10_000,
  })
  expect(snapshot.finance.sourcePerformance).toMatchObject([{
    sourcingItemId: itemId,
    orderCount: 1,
    revenueMinor: 10_500,
    costMinor: 0,
  }])
  expect(snapshot.finance.dailyReports.some((report: { revenueMinor: number }) => report.revenueMinor === 10_500)).toBe(true)
  const configured = await post('/finance/settings', {
    baseCurrency: 'USD', platformFeeBps: 800,
    aiInputCostMinorPerMillionTokens: 0, aiOutputCostMinorPerMillionTokens: 0,
    exchangeRates: { USD: 1 },
  })
  expect(configured.status).toBe(200)
  snapshot = JSON.parse(await readSnapshot())
  expect(snapshot.finance.settings.platformFeeBps).toBe(800)
  expect(snapshot.finance.summary).toMatchObject({
    revenueMinor: 10_500, costMinor: 8_000, netProfitMinor: 9_700,
  })
  const audit = await host!.productApi().auditEvents(config.workspaceId)
  expect(audit.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining([
    'order.imported',
    'payment.confirmed',
    'procurement.shipped',
    'procurement.delivered',
    'procurement.refunded',
  ]))
})
