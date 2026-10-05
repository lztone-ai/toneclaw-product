import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalBillingAuthority } from './authority.ts'
import type { PlanDefinition } from './types.ts'

export interface UsageSnapshot {
  generatedAt: string
  workspaceId: string
  plan: PlanDefinition
  subscription: { status: string; planId: string; validTo: string | null }
  quota: {
    periodStart: string
    periodEnd: string
    tokenLimit: number
    usedInputTokens: number
    usedOutputTokens: number
    usedRequests: number
    status: string
  }
}

/** Build a UI-facing usage snapshot from the authority's current state. */
export function buildUsageSnapshot(authority: LocalBillingAuthority, workspaceId: string): UsageSnapshot {
  const subscription = authority.currentSubscription(workspaceId)
  const quota = authority.currentQuota(workspaceId)
  return {
    generatedAt: new Date().toISOString(),
    workspaceId,
    plan: authority.planDefinition(),
    subscription,
    quota: {
      periodStart: quota.periodStart,
      periodEnd: quota.periodEnd,
      tokenLimit: quota.tokenLimit,
      usedInputTokens: quota.usedInputTokens,
      usedOutputTokens: quota.usedOutputTokens,
      usedRequests: quota.usedRequests,
      status: quota.status,
    },
  }
}

/** Atomically write the snapshot as JSON into `dataDir/usage.json`. */
export function writeUsageSnapshot(dataDir: string, authority: LocalBillingAuthority, workspaceId: string): string {
  mkdirSync(dataDir, { recursive: true })
  const target = join(dataDir, 'usage.json')
  const staging = join(dataDir, `usage.json.${process.pid}.tmp`)
  writeFileSync(staging, `${JSON.stringify(buildUsageSnapshot(authority, workspaceId), null, 2)}\n`, 'utf8')
  renameSync(staging, target)
  return target
}
