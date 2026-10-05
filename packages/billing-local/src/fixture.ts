/**
 * Fixture AI action lifecycle (S1 completion gate): precheck -> reserve -> commit/release,
 * including exhaustion and idempotent replay. Run via `pnpm --filter @toneclaw/billing-local run fixture`.
 */
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BillingStore } from './store.ts'
import { LocalBillingAuthority } from './authority.ts'

export interface FixtureActionInput {
  scene: 'sourcing_analysis' | 'image_generation' | 'listing_generation' | 'report'
  model: string
  reservedInputTokens: number
  reservedOutputTokens: number
  idempotencyKey: string
  succeed: boolean
  actualInputTokens?: number
  actualOutputTokens?: number
}

export interface FixtureActionResult {
  action: 'Committed' | 'Released' | 'Blocked'
  reason?: string
  reservationId?: string
  quotaUsed: number
  quotaLimit: number
  quotaStatus: string
}

/** One fixture AI action against a fresh in-memory-backed authority instance. */
export function runFixtureAction(
  authority: LocalBillingAuthority,
  input: FixtureActionInput,
): FixtureActionResult {
  const decision = authority.precheck({ ...input, workspaceId: 'workspace-fixture' })
  if (decision.outcome === 'Blocked') {
    const quota = authority.currentQuota('workspace-fixture')
    return {
      action: 'Blocked',
      reason: `${decision.reason}: ${decision.detail}`,
      quotaUsed: quota.usedInputTokens + quota.usedOutputTokens,
      quotaLimit: quota.tokenLimit,
      quotaStatus: quota.status,
    }
  }
  const reservation = authority.reserve({ ...input, workspaceId: 'workspace-fixture', relatedObjectType: 'fixture' })
  if (!input.succeed) {
    authority.release(reservation.reservationId, 'fixture: simulated model failure')
    const quota = authority.currentQuota('workspace-fixture')
    return {
      action: 'Released',
      reservationId: reservation.reservationId,
      quotaUsed: quota.usedInputTokens + quota.usedOutputTokens,
      quotaLimit: quota.tokenLimit,
      quotaStatus: quota.status,
    }
  }
  authority.commit(reservation.reservationId, {
    inputTokens: input.actualInputTokens ?? input.reservedInputTokens,
    outputTokens: input.actualOutputTokens ?? input.reservedOutputTokens,
    estimated: false,
  })
  const quota = authority.currentQuota('workspace-fixture')
  return {
    action: 'Committed',
    reservationId: reservation.reservationId,
    quotaUsed: quota.usedInputTokens + quota.usedOutputTokens,
    quotaLimit: quota.tokenLimit,
    quotaStatus: quota.status,
  }
}

function main(): void {
  const dbPath = join(tmpdir(), `toneclaw-fixture-${Date.now()}.sqlite`)
  const store = new BillingStore(dbPath)
  // Small plan so the exhaustion branch is reachable inside the demo.
  const authority = new LocalBillingAuthority(store, {
    plan: {
      id: 'plan-fixture',
      code: 'fixture',
      name: 'Fixture 套餐',
      periodType: 'monthly',
      tokenLimit: 1_000,
      requestLimit: 10,
      softThresholdPct: 80,
      overagePolicy: 'block_ai_generation',
      allowedScenes: ['sourcing_analysis', 'image_generation', 'listing_generation', 'report'],
      features: ['ai.generation'],
    },
  })
  const steps: FixtureActionResult[] = []
  steps.push(runFixtureAction(authority, {
    scene: 'listing_generation', model: 'deepseek-chat',
    reservedInputTokens: 300, reservedOutputTokens: 200,
    idempotencyKey: 'action-1', succeed: true,
    actualInputTokens: 280, actualOutputTokens: 150,
  }))
  steps.push(runFixtureAction(authority, {
    scene: 'listing_generation', model: 'deepseek-chat',
    reservedInputTokens: 300, reservedOutputTokens: 200,
    idempotencyKey: 'action-1', succeed: true,
  }))
  steps.push(runFixtureAction(authority, {
    scene: 'image_generation', model: 'deepseek-chat',
    reservedInputTokens: 100, reservedOutputTokens: 400,
    idempotencyKey: 'action-2', succeed: false,
  }))
  steps.push(runFixtureAction(authority, {
    scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 200, reservedOutputTokens: 200,
    idempotencyKey: 'action-3', succeed: true,
  }))
  steps.push(runFixtureAction(authority, {
    scene: 'report', model: 'deepseek-chat',
    reservedInputTokens: 300, reservedOutputTokens: 300,
    idempotencyKey: 'action-4', succeed: true,
  }))
  console.log(steps.map((step, index) => `${index + 1}. ${JSON.stringify(step)}`).join('\n'))
  store.close()
  rmSync(dbPath, { force: true })
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fixture.mjs')) main()
