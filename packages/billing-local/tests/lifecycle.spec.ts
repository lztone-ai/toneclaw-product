import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BillingStore } from '../src/store.ts'
import { DEFAULT_PLAN, LocalBillingAuthority } from '../src/authority.ts'
import type { PlanDefinition } from '../src/types.ts'

const dirs: string[] = []
const stores: BillingStore[] = []
const tempBase = resolve(import.meta.dirname, '../../../tmp')
afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.close() } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStore(): { store: BillingStore; path: string } {
  mkdirSync(tempBase, { recursive: true })
  const dir = mkdtempSync(join(tempBase, 'billing-'))
  dirs.push(dir)
  const store = new BillingStore(join(dir, 'billing.sqlite'))
  stores.push(store)
  return { store, path: join(dir, 'billing.sqlite') }
}

function planWith(overrides: Partial<PlanDefinition>): PlanDefinition {
  return { ...DEFAULT_PLAN, ...overrides }
}

it('records a succeeded action and settles the actual token delta', () => {
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store)
  const decision = authority.precheck({
    workspaceId: 'ws', scene: 'listing_generation', reservedInputTokens: 300, reservedOutputTokens: 200,
  })
  expect(decision).toMatchObject({ outcome: 'Allowed' })
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'listing_generation', model: 'deepseek-chat',
    reservedInputTokens: 300, reservedOutputTokens: 200,
    idempotencyKey: 'a1', relatedObjectType: 'ListingDraft', relatedObjectId: 'draft-1',
  })
  expect(reservation.deduplicated).toBe(false)
  const committed = authority.commit(reservation.reservationId, {
    inputTokens: 280, outputTokens: 150, estimated: false,
  })
  expect(committed.status).toBe('Succeeded')
  expect(committed.relatedObjectId).toBe('draft-1')
  const quota = authority.currentQuota('ws')
  expect(quota.usedInputTokens).toBe(280)
  expect(quota.usedOutputTokens).toBe(150)
  expect(quota.status).toBe('Active')
})

it('returns the same reservation for a repeated idempotency key without double charging', () => {
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store)
  const input = {
    workspaceId: 'ws', scene: 'report' as const, model: 'deepseek-chat',
    reservedInputTokens: 100, reservedOutputTokens: 100, idempotencyKey: 'dup-1',
  }
  const first = authority.reserve(input)
  const second = authority.reserve(input)
  expect(second.deduplicated).toBe(true)
  expect(second.reservationId).toBe(first.reservationId)
  expect(authority.currentQuota('ws').usedRequests).toBe(1)
  authority.commit(first.reservationId, { inputTokens: 50, outputTokens: 50, estimated: false })
  expect(authority.currentQuota('ws').usedInputTokens).toBe(50)
})

it('releases the reservation when the action fails', () => {
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store)
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'image_generation', model: 'deepseek-chat',
    reservedInputTokens: 100, reservedOutputTokens: 400, idempotencyKey: 'f1',
  })
  const released = authority.release(reservation.reservationId, 'fixture: model timeout')
  expect(released.status).toBe('Failed')
  expect(released.failure).toBe('fixture: model timeout')
  const quota = authority.currentQuota('ws')
  expect(quota.usedInputTokens + quota.usedOutputTokens).toBe(0)
})

it('blocks new generation once the quota is exhausted and keeps no residue', () => {
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store, {
    plan: planWith({ tokenLimit: 500, requestLimit: 10 }),
  })
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'listing_generation', model: 'deepseek-chat',
    reservedInputTokens: 300, reservedOutputTokens: 200, idempotencyKey: 'e1',
  })
  authority.commit(reservation.reservationId, { inputTokens: 300, outputTokens: 200, estimated: false })
  const blocked = authority.precheck({
    workspaceId: 'ws', scene: 'listing_generation', reservedInputTokens: 1, reservedOutputTokens: 1,
  })
  expect(blocked).toMatchObject({ outcome: 'Blocked', reason: 'Quota.Exhausted' })
  expect(() => authority.reserve({
    workspaceId: 'ws', scene: 'listing_generation', model: 'deepseek-chat',
    reservedInputTokens: 1, reservedOutputTokens: 1, idempotencyKey: 'e2',
  })).toThrow('Quota.Exhausted')
  const records = authority.usageRecords('ws').filter(record => record.idempotencyKey === 'e2')
  expect(records).toHaveLength(0)
})

it('marks the quota as SoftLimit past the soft threshold but keeps allowing actions', () => {
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store, {
    plan: planWith({ tokenLimit: 1_000, softThresholdPct: 80 }),
  })
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 500, reservedOutputTokens: 400, idempotencyKey: 's1',
  })
  authority.commit(reservation.reservationId, { inputTokens: 500, outputTokens: 400, estimated: false })
  expect(authority.currentQuota('ws').status).toBe('SoftLimit')
  const decision = authority.precheck({
    workspaceId: 'ws', scene: 'report', reservedInputTokens: 10, reservedOutputTokens: 10,
  })
  expect(decision).toMatchObject({ outcome: 'Allowed', softLimit: true })
})

it('rolls over to a fresh quota window and expires the old one', () => {
  let clock = new Date('2026-03-15T10:00:00Z')
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store, { now: () => clock })
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 600, reservedOutputTokens: 0, idempotencyKey: 'm1',
  })
  authority.commit(reservation.reservationId, { inputTokens: 600, outputTokens: 0, estimated: false })
  clock = new Date('2026-04-02T10:00:00Z')
  const quota = authority.currentQuota('ws')
  expect(quota.periodStart).toBe('2026-04-01')
  expect(quota.usedInputTokens).toBe(0)
  expect(quota.status).toBe('Active')
  const expired = authority.quotas('ws').find(quota => quota.periodStart === '2026-03-01')
  expect(expired?.status).toBe('Expired')
})

it('expires stale reservations during reconciliation and refunds them', () => {
  let clock = new Date('2026-03-10T10:00:00Z')
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store, { now: () => clock })
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'sourcing_analysis', model: 'deepseek-chat',
    reservedInputTokens: 200, reservedOutputTokens: 100, idempotencyKey: 'r1',
  })
  clock = new Date('2026-03-10T10:30:00Z')
  const result = authority.reconcile({ staleBefore: '2026-03-10T10:15:00Z' })
  expect(result.expiredReservations).toBe(1)
  const record = authority.usageRecords('ws').find(item => item.id === reservation.reservationId)
  expect(record?.status).toBe('Expired')
  expect(authority.currentQuota('ws').usedInputTokens + authority.currentQuota('ws').usedOutputTokens).toBe(0)
})

it('blocks when the subscription is not active', () => {
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store)
  authority.currentSubscription('ws')
  store.prepare("UPDATE subscriptions SET status = 'PastDue'").run()
  const decision = authority.precheck({
    workspaceId: 'ws', scene: 'listing_generation', reservedInputTokens: 1, reservedOutputTokens: 1,
  })
  expect(decision).toMatchObject({ outcome: 'Blocked', reason: 'Subscription.Inactive' })
  expect(authority.validateFeature('ws', 'ai.generation')).toEqual({ featureKey: 'ai.generation', allowed: false })
})

it('blocks scenes outside the plan allowance', () => {
  const { store } = makeStore()
  const authority = new LocalBillingAuthority(store, {
    plan: planWith({ allowedScenes: ['report'] }),
  })
  const decision = authority.precheck({
    workspaceId: 'ws', scene: 'image_generation', reservedInputTokens: 1, reservedOutputTokens: 1,
  })
  expect(decision).toMatchObject({ outcome: 'Blocked', reason: 'Scene.NotAllowed' })
})

it('persists state across a store reopen', () => {
  const { store, path } = makeStore()
  const authority = new LocalBillingAuthority(store)
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 120, reservedOutputTokens: 80, idempotencyKey: 'p1',
  })
  authority.commit(reservation.reservationId, { inputTokens: 100, outputTokens: 60, estimated: false })
  store.close()
  const reopened = new BillingStore(path)
  const revived = new LocalBillingAuthority(reopened)
  expect(revived.currentQuota('ws').usedInputTokens).toBe(100)
  const replay = revived.reserve({
    workspaceId: 'ws', scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 120, reservedOutputTokens: 80, idempotencyKey: 'p1',
  })
  expect(replay.reservationId).toBe(reservation.reservationId)
  expect(replay.deduplicated).toBe(true)
  reopened.close()
})
