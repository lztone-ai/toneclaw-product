import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProductStorage } from '../src/product-storage.ts'
import { createProductFromSelection, decide } from '@toneclaw/core-domain'

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
  const dir = mkdtempSync(join(tempBase, 'product-storage-'))
  dirs.push(dir)
  const storage = new ProductStorage(join(dir, 'product.sqlite'))
  storages.push(storage)
  return storage
}

function seedItem(storage: ProductStorage): void {
  storage.prepare(`
    INSERT INTO sourcing_items (
      id, business_account_id, supplier_id, data_source_id, external_source_id, title,
      category_labels_json, currency, purchase_price_minor, suggested_retail_price_minor,
      moq, lead_time_days, stock_status, supply_status, risk_status, status,
      image_urls_json, sku_attributes_json, compliance_json, created_at, updated_at
    ) VALUES ('item-1', 'ws', 'supplier-1', 'ds-1', 'SRC-9001', '便携榨汁杯',
      '["厨房"]', 'CNY', 6700, 19900, 1, 7, 'available', 'active', 'low', 'candidate',
      '["https://example.com/a.jpg"]', '{"color":"white"}', NULL,
      '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
  `).run()
}

it('round-trips decisions and item updates through the core-domain ports', async () => {
  const storage = makeStorage()
  seedItem(storage)
  const item = await storage.sourcingItems.findById('ws', 'item-1')
  expect(item?.status).toBe('candidate')
  expect(item?.categoryLabels).toEqual(['厨房'])
  const decision = {
    id: 'd-1', businessAccountId: 'ws', sourcingItemId: 'item-1', decision: 'approved' as const,
    reason: '毛利达标', scoresJson: null, decidedBy: 'user' as const,
    decidedAt: '2026-03-02T00:00:00Z', status: 'active' as const, resultProductId: null,
  }
  await storage.decisions.insert(decision)
  expect((await storage.decisions.findActiveByItemId('ws', 'item-1'))?.id).toBe('d-1')
  await storage.sourcingItems.update({ ...item!, status: 'selected' })
  expect((await storage.sourcingItems.findById('ws', 'item-1'))?.status).toBe('selected')
})

it('runs the real selection lifecycle against storage and persists across reopen', async () => {
  const path = join(mktempDir(), 'product.sqlite')
  const first = new ProductStorage(path)
  storages.push(first)
  first.prepare(`
    INSERT INTO sourcing_items (
      id, business_account_id, supplier_id, data_source_id, external_source_id, title,
      category_labels_json, currency, purchase_price_minor, stock_status, supply_status,
      risk_status, status, image_urls_json, created_at, updated_at
    ) VALUES ('item-9', 'ws', 'supplier-1', 'ds-1', 'SRC-9002', '测试品',
      '[]', 'CNY', 6700, 'available', 'active', 'low', 'candidate', '[]',
      '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
  `).run()
  const deps = {
    ids: { next: (() => { let n = 0; return () => `id-${++n}` })() },
    clock: { now: () => new Date('2026-03-15T10:00:00Z') },
    audit: first.audit,
    items: first.sourcingItems,
    decisions: first.decisions,
    products: first.products,
  }
  await decide(deps, {
    workspaceId: 'ws', sourcingItemId: 'item-9', decision: 'approved',
    reason: 'r', decidedBy: 'user', actorId: 'seller-1',
  })
  await createProductFromSelection(deps, { workspaceId: 'ws', sourcingItemId: 'item-9', actorId: 'seller-1' })
  first.close()

  const second = new ProductStorage(path)
  storages.push(second)
  const active = await second.decisions.findActiveByItemId('ws', 'item-9')
  expect(active?.resultProductId).toBeDefined()
  expect(second.listSourcingItems('ws')[0]?.status).toBe('selected')
  expect(second.auditEvents('ws').some(e => e.action === 'product.create_from_selection')).toBe(true)
})

function mktempDir(): string {
  mkdirSync(tempBase, { recursive: true })
  return mkdtempSync(join(tempBase, 'ps-'))
}

it('runs platform authorization migrations and round-trips A0 objects (11b A0)', async () => {
  const storage = makeStorage()
  const at = '2026-10-07T12:00:00Z'
  await storage.workspaces.insert({
    id: 'ws-1', businessAccountId: 'ba-1', name: 'Default Workspace',
    isDefault: true, createdAt: at, updatedAt: at,
  })
  expect((await storage.workspaces.findDefault('ba-1'))?.id).toBe('ws-1')

  await storage.platformConnections.insert({
    id: 'conn-1', businessAccountId: 'ba-1', platform: 'temu',
    externalSellerAccountId: 'seller-1', connectionType: 'oauth',
    displayName: null, status: 'active', scopes: ['store.read'],
    connectedByUserId: 'user-1', connectedAt: at, expiresAt: null, lastVerifiedAt: at,
  })
  expect((await storage.platformConnections.findActiveByBusinessAccount('ba-1'))?.id).toBe('conn-1')

  await storage.platformCredentials.insert({
    id: 'cred-1', businessAccountId: 'ba-1', platformConnectionId: 'conn-1',
    platform: 'temu', credentialType: 'oauth',
    secretRef: 'safe-storage://credentials/cred-1', scopes: ['store.read'],
    status: 'active', expiresAt: null, lastVerifiedAt: at,
  })
  expect((await storage.platformCredentials.findActiveByConnection('conn-1'))?.secretRef)
    .toBe('safe-storage://credentials/cred-1')

  await storage.stores.insert({
    id: 'store-1', businessAccountId: 'ba-1', platformConnectionId: 'conn-1',
    platform: 'temu', externalSellerAccountId: 'seller-1', externalStoreId: 'shop-1',
    name: 'Temu 半托管店', region: 'US', businessMode: 'semi_managed',
    currency: 'USD', timezone: 'America/New_York', status: 'connected',
    connectedAt: at, lastSyncedAt: null,
  })
  expect(await storage.stores.countByBusinessAccount('ba-1')).toBe(1)

  await storage.storeCapabilities.upsert({
    id: 'cap-1', storeId: 'store-1', capabilityKey: 'listing.create',
    status: 'unavailable', mode: 'export_import', checkedAt: at, notes: 'TAC 4 降级',
  })
  await storage.storeCapabilities.upsert({
    id: 'cap-1b', storeId: 'store-1', capabilityKey: 'listing.create',
    status: 'available', mode: 'api', checkedAt: at, notes: null,
  })
  const capabilities = await storage.storeCapabilities.listByStore('store-1')
  expect(capabilities).toHaveLength(1)
  expect(capabilities[0]?.id).toBe('cap-1')
  expect(capabilities[0]?.status).toBe('available')

  await storage.platformConnections.updateStatus('conn-1', 'expired', at)
  await storage.platformCredentials.updateStatus('cred-1', 'expired', at)
  await storage.stores.updateStatus('store-1', 'expired')
  await storage.stores.markSynced('store-1', at)
  expect((await storage.platformConnections.findById('ba-1', 'conn-1'))?.status).toBe('expired')
  expect(await storage.platformCredentials.findActiveByConnection('conn-1')).toBeUndefined()
  expect((await storage.stores.findById('ba-1', 'store-1'))?.status).toBe('expired')
})

it('drops the legacy sourcing_import_batches.store_id residue (L-E, R-2026-10-06)', async () => {
  const storage = makeStorage()
  const columns = (storage.prepare('PRAGMA table_info(sourcing_import_batches)').all() as { name: string }[])
    .map(column => column.name)
  expect(columns).not.toContain('store_id')
  await storage.importBatches.insert({
    id: 'batch-1', businessAccountId: 'ws', format: 'csv', fileName: 'catalog.csv',
    fileRef: 'ref-1', fingerprint: 'fp-1', sourceBatchId: null,
    totalRows: 2, validRows: 2, failedRows: 0, warningRows: 0, status: 'completed',
    errors: [], createdAt: '2026-10-07T12:00:00Z', createdBy: 'operator',
  })
  expect((await storage.importBatches.findById('ws', 'batch-1'))?.id).toBe('batch-1')
})
