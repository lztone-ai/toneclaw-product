import { expect, it } from 'vitest'
import { MockTemuAdapter, type TemuAttributeTemplate } from '../src/index.ts'

function fixedNow(): () => number {
  let tick = 1_000_000
  return () => (tick += 60_000)
}

it('walks the full TAC 3.4 lifecycle: pending → active → expired → disconnected', async () => {
  const adapter = new MockTemuAdapter({ now: fixedNow(), credentialTtlMs: null })
  const start = await adapter.createAuthorization({ businessAccountId: 'ba-1', connectionId: 'conn-1', userId: 'user-1' })
  expect(start.authorizationUrl).toContain('mock.temu.example')
  expect(await adapter.verifyConnection('conn-1')).toMatchObject({
    connectionStatus: 'pending', credentialStatus: 'pending', storeStatus: 'connecting',
  })

  const result = await adapter.handleAuthorizationCallback({
    connectionId: 'conn-1', state: start.state, approved: true, rawPayloadRef: null,
  })
  expect(result.credentialSecretRef).toBe('mock-safe-storage://credentials/conn-1')
  expect(result.externalStoreIds).toHaveLength(1)
  expect(await adapter.verifyConnection('conn-1')).toMatchObject({
    connectionStatus: 'active', credentialStatus: 'active', storeStatus: 'connected',
  })

  adapter.forceExpire('conn-1')
  expect(await adapter.verifyConnection('conn-1')).toMatchObject({
    connectionStatus: 'expired', credentialStatus: 'expired', storeStatus: 'expired',
  })
  await adapter.disconnect('conn-1')
  expect(await adapter.verifyConnection('conn-1')).toMatchObject({
    connectionStatus: 'disconnected', credentialStatus: 'revoked', storeStatus: 'disconnected',
  })
})

it('expires credentials by TTL and probes the mock capability surface', async () => {
  let now = 1_000_000
  const adapter = new MockTemuAdapter({ now: () => now, credentialTtlMs: 120_000, listingReviewMs: 0 })
  await adapter.createAuthorization({ businessAccountId: 'ba-1', connectionId: 'conn-2', userId: 'user-1' })
  await adapter.handleAuthorizationCallback({
    connectionId: 'conn-2', state: 'mock-state-conn-2', approved: true, rawPayloadRef: null,
  })
  now += 121_000
  expect((await adapter.verifyConnection('conn-2')).connectionStatus).toBe('expired')

  const capabilities = await adapter.fetchStoreCapabilities('conn-2', 'mock-store-conn-2')
  expect(capabilities).toHaveLength(8)
  expect(capabilities.find(capability => capability.capabilityKey === 'listing.create'))
    .toMatchObject({ status: 'available', mode: 'api' })
  expect(capabilities.find(capability => capability.capabilityKey === 'listing.status.read'))
    .toMatchObject({ status: 'available', mode: 'api' })
  expect(capabilities.find(capability => capability.capabilityKey === 'settlement.read'))
    .toMatchObject({ status: 'unavailable', mode: 'manual' })
  expect(capabilities.find(capability => capability.capabilityKey === 'store.read'))
    .toMatchObject({ status: 'available', mode: 'api' })

  const submitted = await adapter.createListing('mock-store-conn-2', {
    listingDraftId: 'ld-1', title: 'x', description: 'x', platformCategoryId: '1000502',
    attributes: {}, priceMinor: 100, currency: 'USD', stockQty: 1,
    imageUrls: ['https://cdn.example.com/main.jpg'],
  })
  expect(submitted.submitted).toBe(true)
  expect(submitted.externalListingId).toMatch(/^3\d{9}$/)
  expect(submitted.rawStatus).toBe('已提交')
  await expect(adapter.fetchListingStatus('mock-store-conn-2', submitted.externalListingId ?? 'MOCK-LISTING-LD-1'))
    .resolves.toMatchObject({ coreStatus: 'live', rawStatus: '在售' })

  const store = await adapter.fetchStore('conn-2', 'mock-store-conn-2')
  expect(store.businessMode).toBe('semi_managed')
  expect(store.status).toBe('expired')
})

it('serves Temu-shaped attribute templates, dependencies, and the review lifecycle (TAC §5/§7/§15)', async () => {
  let now = 1_000_000
  const adapter = new MockTemuAdapter({ now: () => now, credentialTtlMs: null, listingReviewMs: 120_000 })

  const categories = await adapter.fetchCategories('store-1')
  expect(categories.map(category => category.platformCategoryId))
    .toEqual(['10001', '10005', '1000502', '10010', '1001001'])
  expect(categories.find(category => category.platformCategoryId === '1000502'))
    .toMatchObject({ parentPlatformCategoryId: '10005', name: 'Blenders' })

  const attributes = await adapter.fetchAttributes('store-1', '1000502')
  const material = attributes.find(attribute => attribute.attributeKey === 'material')
  expect(material).toMatchObject({ required: true })
  expect(material!.valueSchema).toMatchObject({ pid: 1001, templatePid: 1000, inputType: 'enum' })
  expect((material!.valueSchema as TemuAttributeTemplate).vidOptions)
    .toContainEqual({ vid: 102, name: 'Linen' })
  const batteryCapacity = attributes.find(attribute => attribute.attributeKey === 'battery_capacity_mah')
  expect(batteryCapacity).toMatchObject({ required: true })
  expect((batteryCapacity!.valueSchema as TemuAttributeTemplate).dependsOn)
    .toEqual(expect.arrayContaining([{ attributeKey: 'power_source', vid: 402 }]))

  const submitted = await adapter.createListing('store-1', {
    listingDraftId: 'ld-2', title: 'Mock Blender', description: 'x', platformCategoryId: '1000502',
    attributes: { material: 'Linen', capacity_ml: '1500', power_source: 'USB Rechargeable', battery_capacity_mah: '2000' },
    priceMinor: 8990, currency: 'USD',
    stockQty: 10, imageUrls: ['https://cdn.example.com/main.jpg'],
  })
  const externalListingId = submitted.externalListingId
  expect(externalListingId).toMatch(/^3\d{9}$/)

  const goodsCreate = adapter.lastGoodsCreateRequest('store-1')
  expect(goodsCreate).toMatchObject({
    productName: 'Mock Blender',
    cat1Id: 10001, cat2Id: 10005, cat3Id: 1000502, cat4Id: 0, cat10Id: 0,
    productWarehouseRouteReq: { warehouseId: 1, shipType: 1 },
  })
  expect(goodsCreate!.carouselImageUrls).toEqual(['https://cdn.example.com/main.jpg'])
  expect(goodsCreate!.productPropertyReqs.find(property => property.pid === 1001))
    .toMatchObject({ vid: 102, propValue: 'Linen' })
  expect(goodsCreate!.productPropertyReqs.find(property => property.pid === 1005))
    .toMatchObject({ numberInputValue: 2000, valueUnit: 'mAh' })

  await expect(adapter.fetchListingStatus('store-1', externalListingId ?? 'missing'))
    .resolves.toMatchObject({ coreStatus: 'platform_review', rawStatus: '平台审核中' })

  now += 121_000
  await expect(adapter.fetchListingStatus('store-1', externalListingId ?? 'missing'))
    .resolves.toMatchObject({ coreStatus: 'live', rawStatus: '在售' })

  const fit = await adapter.validateProductFit('store-1', {
    productId: 'p-1', title: 'x', coreCategoryId: '1000502',
    attributes: { material: 'Linen', capacity_ml: '1500', power_source: 'USB Rechargeable', battery_capacity_mah: '2000' },
    priceMinor: 8990, currency: 'USD',
    imageUrls: ['https://cdn.example.com/main.jpg'],
  })
  expect(fit.result).toBe('fit')
  const missingBattery = await adapter.validateProductFit('store-1', {
    productId: 'p-2', title: 'x', coreCategoryId: '1000502',
    attributes: { material: 'Linen', capacity_ml: '1500', power_source: 'USB Rechargeable' },
    priceMinor: 8990, currency: 'USD',
    imageUrls: ['https://cdn.example.com/main.jpg'],
  })
  expect(missingBattery.result).toBe('not_fit')
  expect(missingBattery.findings.map(finding => finding.fieldPath))
    .toContain('attributes.battery_capacity_mah')
  const notFit = await adapter.validateProductFit('store-1', {
    productId: 'p-3', title: 'x', coreCategoryId: '99999',
    attributes: {}, priceMinor: 8990, currency: 'USD', imageUrls: [],
  })
  expect(notFit.result).toBe('not_fit')
  expect(notFit.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
    'mock.fit.category_unknown', 'mock.fit.attribute_missing', 'mock.fit.image_missing',
  ]))
})
