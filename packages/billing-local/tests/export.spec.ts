import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BillingStore } from '../src/store.ts'
import { LocalBillingAuthority } from '../src/authority.ts'
import { writeExportBundle } from '../src/export.ts'

const dirs: string[] = []
const stores: BillingStore[] = []
const tempBase = resolve(import.meta.dirname, '../../../tmp')
afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.close() } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('exports subscription, quotas, usage, and audit as a portable JSON bundle', () => {
  const dir = mkdtempSync(join(tempBase, 'billing-export-'))
  dirs.push(dir)
  const store = new BillingStore(join(dir, 'billing.sqlite'))
  stores.push(store)
  const authority = new LocalBillingAuthority(store)
  const reservation = authority.reserve({
    workspaceId: 'ws', scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 100, reservedOutputTokens: 50, idempotencyKey: 'x1',
  })
  authority.commit(reservation.reservationId, { inputTokens: 90, outputTokens: 40, estimated: false })
  const outPath = join(dir, 'exports', 'bundle.json')
  expect(writeExportBundle(authority, 'ws', outPath)).toBe(outPath)
  const bundle = JSON.parse(readFileSync(outPath, 'utf8')) as {
    schemaVersion: number
    subscription: { status: string }
    quotas: unknown[]
    usageRecords: { status: string }[]
    auditEvents: { action: string }[]
  }
  expect(bundle.schemaVersion).toBe(1)
  expect(bundle.subscription.status).toBe('Active')
  expect(bundle.quotas).toHaveLength(1)
  expect(bundle.usageRecords[0]?.status).toBe('Succeeded')
  const actions = bundle.auditEvents.map(event => event.action)
  expect(actions).toContain('usage.reserve')
  expect(actions).toContain('usage.commit')
})
