import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BillingStore } from '../src/store.ts'
import { LocalBillingAuthority } from '../src/authority.ts'
import { buildUsageSnapshot, writeUsageSnapshot } from '../src/snapshot.ts'

const dirs: string[] = []
const stores: BillingStore[] = []
const tempBase = resolve(import.meta.dirname, '../../../tmp')
afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.close() } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('builds a snapshot with plan, subscription, and quota state', () => {
  const dir = mkdtempSync(join(tempBase, 'billing-snapshot-'))
  dirs.push(dir)
  const store = new BillingStore(join(dir, 'billing.sqlite'))
  stores.push(store)
  const authority = new LocalBillingAuthority(store)
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 120, reservedOutputTokens: 80, idempotencyKey: 's1',
  })
  const committed = authority.commit(reservation.reservationId, {
    inputTokens: 90, outputTokens: 40, estimated: false, costEstimateMinor: 12,
  })
  const snapshot = buildUsageSnapshot(authority, 'ws')
  expect(snapshot.plan.tokenLimit).toBe(50_000)
  expect(snapshot.subscription.status).toBe('Active')
  expect(snapshot.quota.usedInputTokens).toBe(90)
  expect(snapshot.quota.usedOutputTokens).toBe(40)
  expect(snapshot.quota.status).toBe('Active')
  expect(snapshot.usageRecords).toMatchObject([{
    id: committed.id, status: 'Succeeded', inputTokens: 90, outputTokens: 40,
    costEstimateMinor: 12,
  }])
})

it('writes the snapshot atomically as valid JSON', () => {
  const dir = mkdtempSync(join(tempBase, 'billing-snapshot-'))
  dirs.push(dir)
  const store = new BillingStore(join(dir, 'billing.sqlite'))
  stores.push(store)
  const authority = new LocalBillingAuthority(store)
  const dataDir = join(dir, 'data')
  const target = writeUsageSnapshot(dataDir, authority, 'ws')
  expect(target).toBe(join(dataDir, 'usage.json'))
  const parsed = JSON.parse(readFileSync(target, 'utf8')) as {
    workspaceId: string
    quota: { tokenLimit: number }
    usageRecords: { status: string }[]
  }
  expect(parsed.workspaceId).toBe('ws')
  expect(parsed.quota.tokenLimit).toBe(50_000)
  expect(parsed.usageRecords).toHaveLength(0)
})
