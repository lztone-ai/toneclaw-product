import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProductStorage } from '@toneclaw/product-storage'
import { PlatformConnectionService } from '../src/platform/connection-service.ts'

const dirs: string[] = []
const storages: ProductStorage[] = []
const tempBase = resolve(import.meta.dirname, '../../../tmp')

afterEach(() => {
  for (const storage of storages.splice(0)) {
    try { storage.close() } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

let seq = 0
function makeService() {
  mkdirSync(tempBase, { recursive: true })
  const dir = mkdtempSync(join(tempBase, 'platform-connection-'))
  dirs.push(dir)
  const storage = new ProductStorage(join(dir, 'product.sqlite'))
  storages.push(storage)
  const ids = { next: () => `id-${++seq}` }
  const service = new PlatformConnectionService(storage, ids, {
    businessAccountId: 'ba-1',
    actorId: 'operator',
  }, storage.audit)
  return { storage, service }
}

it('runs the mock authorization loop end to end against storage (Slice A smoke)', async () => {
  const { storage, service } = makeService()
  const start = await service.start()
  const callback = await service.authorizeCallback({
    connectionId: start.connectionId, state: start.state, approved: true,
  })
  expect(callback.connectionStatus).toBe('active')
  expect(callback.storeStatus).toBe('connected')

  const stores = service.listStores()
  expect(stores.connections[0]?.status).toBe('active')
  expect(stores.stores).toHaveLength(1)
  expect(stores.stores[0]?.businessMode).toBe('semi_managed')
  expect(stores.stores[0]?.capabilities).toHaveLength(8)
  expect(stores.stores[0]?.capabilities.find(capability => capability.capabilityKey === 'listing.create'))
    .toMatchObject({ status: 'available', mode: 'api' })
  expect(stores.stores[0]?.capabilities.find(capability => capability.capabilityKey === 'listing.status.read'))
    .toMatchObject({ status: 'available', mode: 'api' })

  await service.expire(start.connectionId)
  const health = await service.verify(start.connectionId)
  expect(health.connectionStatus).toBe('expired')
  expect((await service.listStores()).stores[0]?.status).toBe('expired')

  const disconnected = await service.disconnect(start.connectionId)
  expect(disconnected.connectionStatus).toBe('disconnected')
  expect(disconnected.credentialStatus).toBe('revoked')

  const actions = storage.auditEvents('ba-1').map(event => event.action)
  expect(actions).toContain('platform.connection.start')
  expect(actions).toContain('platform.connection.authorized')
  expect(actions).toContain('platform.connection.verify')
  expect(actions).toContain('platform.connection.disconnect')

  const credentialRows = storage.prepare(
    `SELECT secret_ref, status FROM platform_credentials`,
  ).all() as unknown as { secret_ref: string; status: string }[]
  expect(credentialRows[0]?.secret_ref).toContain('safe-storage://')
  expect(credentialRows[0]?.status).toBe('revoked')
})

it('enforces CM 4.6 single-active connection and allows reconnect after disconnect', async () => {
  const { service } = makeService()
  const first = await service.start()
  await service.authorizeCallback({ connectionId: first.connectionId, state: first.state, approved: true })

  const second = await service.start()
  await expect(service.authorizeCallback({
    connectionId: second.connectionId, state: second.state, approved: true,
  })).rejects.toMatchObject({ message: 'connection_already_active' })

  await service.disconnect(first.connectionId)
  const reconnected = await service.authorizeCallback({
    connectionId: second.connectionId, state: second.state, approved: true,
  })
  expect(reconnected.connectionStatus).toBe('active')
  expect(service.listStores().stores).toHaveLength(1)
})
