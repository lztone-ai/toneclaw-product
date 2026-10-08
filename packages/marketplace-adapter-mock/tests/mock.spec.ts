import { expect, it } from 'vitest'
import { MockTemuAdapter } from '../src/index.ts'

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
  const adapter = new MockTemuAdapter({ now: () => now, credentialTtlMs: 120_000 })
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
    listingDraftId: 'ld-1', title: 'x', description: 'x', platformCategoryId: 'mock-cat-blender',
    attributes: {}, priceMinor: 100, currency: 'USD', stockQty: 1, imageUrls: [],
  })
  expect(submitted).toMatchObject({ externalListingId: 'MOCK-LISTING-LD-1', submitted: true, rawStatus: 'submitted' })
  await expect(adapter.fetchListingStatus('mock-store-conn-2', submitted.externalListingId ?? 'MOCK-LISTING-LD-1'))
    .resolves.toMatchObject({ coreStatus: 'live', rawStatus: 'live' })

  const store = await adapter.fetchStore('conn-2', 'mock-store-conn-2')
  expect(store.businessMode).toBe('semi_managed')
  expect(store.status).toBe('expired')
})
