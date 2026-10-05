/** Cordis plugin entry: run the local billing authority inside the dsh host and
 * publish UI-facing usage snapshots to the product data directory. */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BillingStore } from '@toneclaw/billing-local'
import { LocalBillingAuthority } from '@toneclaw/billing-local'
import { writeUsageSnapshot } from '@toneclaw/billing-local'
import { normalizeBillingHostConfig, type BillingHostConfig } from './config.ts'

export const name = 'billing-host'
export const inject: string[] = []

/** Register the billing authority on a dsh plugin context. */
export function apply(ctx: BillingHostContext, config: unknown): () => void {
  const normalized = normalizeBillingHostConfig(config)
  return startBillingHost(ctx, normalized)
}

export interface BillingHostContext {
  logger?: {
    info?: (message: unknown, ...values: unknown[]) => void
    error?: (message: unknown, ...values: unknown[]) => void
  }
  on?: (event: string, listener: (...args: unknown[]) => void) => void
}

function startBillingHost(ctx: BillingHostContext, config: BillingHostConfig): () => void {
  mkdirSync(dirname(config.dbPath), { recursive: true })
  mkdirSync(config.dataDir, { recursive: true })
  const store = new BillingStore(config.dbPath)
  const authority = new LocalBillingAuthority(store)
  const snapshotPath = writeUsageSnapshot(config.dataDir, authority, config.workspaceId)
  ctx.logger?.info?.(`[billing-host] authority ready; snapshot ${snapshotPath}`)
  let closed = false
  return () => {
    if (closed) return
    closed = true
    try { store.close() } catch { /* already closed */ }
  }
}

/** Build the snapshot path helper used by tests and tooling. */
export function usageSnapshotPath(dataDir: string): string {
  return join(dataDir, 'usage.json')
}
