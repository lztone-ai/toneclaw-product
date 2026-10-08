/** Cordis plugin entry: run the local billing authority inside the dsh host and
 * publish UI-facing usage snapshots to the product data directory. */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BillingStore, LocalBillingAuthority, writeUsageSnapshot, writeExportBundle } from '@toneclaw/billing-local'
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
  /** Product tools (S2+) consume the local authority through this service slot. */
  billingAuthority?: unknown
}

function startBillingHost(ctx: BillingHostContext, config: BillingHostConfig): () => void {
  mkdirSync(dirname(config.dbPath), { recursive: true })
  mkdirSync(config.dataDir, { recursive: true })
  const store = new BillingStore(config.dbPath)
  const authority = new LocalBillingAuthority(store)
  const snapshotPath = writeUsageSnapshot(config.dataDir, authority, config.workspaceId)
  // Rolling local backup: the export bundle is the no-cloud-backup fallback (S1 导出兜底).
  const backupPath = writeExportBundle(authority, config.workspaceId, join(config.dataDir, 'export-latest.json'))
  const snapshotTimer = setInterval(() => {
    try {
      writeUsageSnapshot(config.dataDir, authority, config.workspaceId)
    } catch (error) {
      ctx.logger?.error?.('[billing-host] usage snapshot refresh failed', error)
    }
  }, 5_000)
  snapshotTimer.unref?.()
  ;(ctx as { billingAuthority?: unknown }).billingAuthority = authority
  ctx.logger?.info?.(`[billing-host] authority ready; snapshot ${snapshotPath}`)
  let closed = false
  void backupPath
  return () => {
    if (closed) return
    closed = true
    clearInterval(snapshotTimer)
    try { store.close() } catch { /* already closed */ }
  }
}

/** Build the snapshot path helper used by tests and tooling. */
export function usageSnapshotPath(dataDir: string): string {
  return join(dataDir, 'usage.json')
}
