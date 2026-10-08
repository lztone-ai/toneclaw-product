import { randomUUID } from 'node:crypto'
import { BillingStore } from './store.ts'
import type {
  FeatureDecision,
  PlanDefinition,
  Quota,
  QuotaDecision,
  QuotaReconcileInput,
  QuotaReconcileResult,
  QuotaReservation,
  QuotaReserveInput,
  QuotaUsage,
  Subscription,
  SubscriptionDecision,
  SubscriptionStatus,
  AuditEvent,
  AuditActorType,
  UsageRecord,
  UsageScene,
  UsageStatus,
} from './types.ts'

/** Phase 1 default plan: monthly basic allowance for a single-seller workspace. */
export const DEFAULT_PLAN: PlanDefinition = {
  id: 'plan-basic-monthly',
  code: 'basic-monthly',
  name: '基础套餐',
  periodType: 'monthly',
  tokenLimit: 50_000,
  requestLimit: 500,
  softThresholdPct: 80,
  overagePolicy: 'block_ai_generation',
  allowedScenes: ['sourcing_analysis', 'image_generation', 'listing_generation', 'report'],
  features: ['ai.generation', 'listing.generation', 'export.data', 'store.temu'],
}

export interface AuthorityOptions {
  now?: () => Date
  plan?: PlanDefinition
  userId?: string
  deviceId?: string
  actorType?: AuditActorType
  actorId?: string
}

interface QuotaRow {
  id: string
  workspace_id: string
  subscription_id: string
  period_type: string
  period_start: string
  period_end: string
  token_limit: number
  used_input_tokens: number
  used_output_tokens: number
  request_limit: number
  used_requests: number
  status: Quota['status']
  updated_at: string
}

interface UsageRow {
  id: string
  workspace_id: string
  user_id: string
  device_id: string
  idempotency_key: string
  scene: UsageScene
  model: string
  status: UsageStatus
  reserved_input_tokens: number
  reserved_output_tokens: number
  input_tokens: number | null
  output_tokens: number | null
  cost_estimate_minor: number | null
  estimated: number
  failure: string | null
  related_object_type: string | null
  related_object_id: string | null
  created_at: string
  completed_at: string | null
  audit_ref: string | null
}

function rowToQuota(row: QuotaRow): Quota {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    subscriptionId: row.subscription_id,
    periodType: row.period_type as Quota['periodType'],
    periodStart: row.period_start,
    periodEnd: row.period_end,
    tokenLimit: row.token_limit,
    usedInputTokens: row.used_input_tokens,
    usedOutputTokens: row.used_output_tokens,
    requestLimit: row.request_limit,
    usedRequests: row.used_requests,
    status: row.status,
    updatedAt: row.updated_at,
  }
}

function rowToUsage(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    deviceId: row.device_id,
    idempotencyKey: row.idempotency_key,
    scene: row.scene,
    model: row.model,
    status: row.status,
    reservedInputTokens: row.reserved_input_tokens,
    reservedOutputTokens: row.reserved_output_tokens,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costEstimateMinor: row.cost_estimate_minor,
    estimated: row.estimated === 1,
    failure: row.failure,
    relatedObjectType: row.related_object_type,
    relatedObjectId: row.related_object_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    auditRef: row.audit_ref,
  }
}

function monthWindow(now: Date): { periodStart: string; periodEnd: string } {
  const periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const periodEnd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
  return { periodStart, periodEnd }
}

/**
 * Local Subscription / Quota authority (PHASE1_TECH_DESIGN 4.12.1 seams, SQLite-backed).
 * Reservation accounting: reserve charges the reserved maximum upfront; commit settles the
 * actual usage delta; release refunds the full reservation.
 */
export class LocalBillingAuthority {
  private readonly now: () => Date
  private readonly plan: PlanDefinition
  private readonly userId: string
  private readonly deviceId: string
  private readonly actorType: AuditActorType
  private readonly actorId: string

  constructor(private readonly store: BillingStore, options: AuthorityOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.plan = options.plan ?? DEFAULT_PLAN
    this.userId = options.userId ?? 'user-local'
    this.deviceId = options.deviceId ?? 'device-local'
    this.actorType = options.actorType ?? 'system'
    this.actorId = options.actorId ?? 'billing-local'
  }

  currentSubscription(workspaceId: string): SubscriptionDecision {
    const subscription = this.ensureSubscription(workspaceId)
    return { status: subscription.status, planId: subscription.planId, validTo: subscription.validTo }
  }

  planDefinition(): PlanDefinition {
    return this.plan
  }

  validateFeature(workspaceId: string, featureKey: string): FeatureDecision {
    const subscription = this.ensureSubscription(workspaceId)
    const active = subscription.status === 'Active' || subscription.status === 'Trial'
    return { featureKey, allowed: active && this.plan.features.includes(featureKey) }
  }

  precheck(input: { workspaceId: string; scene: UsageScene; reservedInputTokens: number; reservedOutputTokens: number }): QuotaDecision {
    const subscription = this.ensureSubscription(input.workspaceId)
    if (subscription.status !== 'Active' && subscription.status !== 'Trial') {
      return { outcome: 'Blocked', reason: 'Subscription.Inactive', detail: `subscription status ${subscription.status}` }
    }
    if (!this.plan.allowedScenes.includes(input.scene)) {
      return { outcome: 'Blocked', reason: 'Scene.NotAllowed', detail: `scene ${input.scene} not in plan` }
    }
    const quota = this.ensureCurrentQuota(input.workspaceId, subscription)
    const reserved = input.reservedInputTokens + input.reservedOutputTokens
    const remaining = quota.tokenLimit - quota.usedInputTokens - quota.usedOutputTokens
    if (quota.status === 'Exhausted' || reserved > remaining) {
      return { outcome: 'Blocked', reason: 'Quota.Exhausted', detail: `remaining ${remaining}, requested ${reserved}` }
    }
    const softFloor = quota.tokenLimit * (1 - this.plan.softThresholdPct / 100)
    return { outcome: 'Allowed', quotaId: quota.id, remainingTokens: remaining, softLimit: remaining <= softFloor }
  }

  reserve(input: QuotaReserveInput): QuotaReservation {
    const decision = this.precheck(input)
    if (decision.outcome === 'Blocked') throw new Error(`${decision.reason}: ${decision.detail}`)
    const existing = this.findUsageByIdempotencyKey(input.workspaceId, input.idempotencyKey)
    if (existing !== undefined) {
      return { reservationId: existing.id, idempotencyKey: existing.idempotencyKey, deduplicated: true }
    }
    const quota = this.ensureCurrentQuota(input.workspaceId, this.ensureSubscription(input.workspaceId))
    const record: UsageRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userId: this.userId,
      deviceId: this.deviceId,
      idempotencyKey: input.idempotencyKey,
      scene: input.scene,
      model: input.model,
      status: 'Reserved',
      reservedInputTokens: input.reservedInputTokens,
      reservedOutputTokens: input.reservedOutputTokens,
      inputTokens: null,
      outputTokens: null,
      costEstimateMinor: null,
      estimated: false,
      failure: null,
      relatedObjectType: input.relatedObjectType ?? null,
      relatedObjectId: input.relatedObjectId ?? null,
      createdAt: this.now().toISOString(),
      completedAt: null,
      auditRef: null,
    }
    this.store.transaction(() => {
      this.store.prepare(`
        INSERT INTO usage_records (
          id, workspace_id, user_id, device_id, idempotency_key, scene, model, status,
          reserved_input_tokens, reserved_output_tokens, input_tokens, output_tokens,
          cost_estimate_minor, estimated, failure, related_object_type, related_object_id,
          created_at, completed_at, audit_ref
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.workspaceId, record.userId, record.deviceId, record.idempotencyKey,
        record.scene, record.model, record.status, record.reservedInputTokens,
        record.reservedOutputTokens, record.inputTokens, record.outputTokens,
        record.costEstimateMinor, record.estimated ? 1 : 0, record.failure,
        record.relatedObjectType, record.relatedObjectId, record.createdAt,
        record.completedAt, record.auditRef,
      )
      this.applyQuotaDelta(quota.workspaceId, record.reservedInputTokens, record.reservedOutputTokens, 1)
      this.appendAudit({
        workspaceId: record.workspaceId, action: 'usage.reserve', objectType: 'UsageRecord', objectId: record.id,
        after: {
          scene: record.scene,
          model: record.model,
          reserved: record.reservedInputTokens + record.reservedOutputTokens,
        },
      })
    })
    return { reservationId: record.id, idempotencyKey: record.idempotencyKey, deduplicated: false }
  }

  commit(reservationId: string, usage: QuotaUsage): UsageRecord {
    const record = this.getUsage(reservationId)
    if (record.status === 'Succeeded') return record
    if (record.status !== 'Reserved') throw new Error(`cannot commit usage record in status ${record.status}`)
    const settled = this.now().toISOString()
    const cost = usage.costEstimateMinor ?? null
    this.store.transaction(() => {
      this.store.prepare(`
        UPDATE usage_records
        SET status = 'Succeeded', input_tokens = ?, output_tokens = ?, cost_estimate_minor = ?,
            estimated = ?, completed_at = ?, audit_ref = ?
        WHERE id = ?
      `).run(usage.inputTokens, usage.outputTokens, cost, usage.estimated ? 1 : 0, settled, usage.auditRef ?? null, reservationId)
      const deltaInput = usage.inputTokens - record.reservedInputTokens
      const deltaOutput = usage.outputTokens - record.reservedOutputTokens
      this.applyQuotaDelta(record.workspaceId, deltaInput, deltaOutput, 0)
      this.appendAudit({
        workspaceId: record.workspaceId, action: 'usage.commit', objectType: 'UsageRecord', objectId: reservationId,
        before: { status: 'Reserved', reserved: record.reservedInputTokens + record.reservedOutputTokens },
        after: { status: 'Succeeded', actual: usage.inputTokens + usage.outputTokens },
      })
    })
    return this.getUsage(reservationId)
  }

  release(reservationId: string, reason: string, status: 'Failed' | 'Expired' = 'Failed'): UsageRecord {
    const record = this.getUsage(reservationId)
    if (record.status !== 'Reserved') return record
    this.store.transaction(() => {
      this.store.prepare(`
        UPDATE usage_records SET status = ?, failure = ?, completed_at = ? WHERE id = ?
      `).run(status, reason, this.now().toISOString(), reservationId)
      this.applyQuotaDelta(record.workspaceId, -record.reservedInputTokens, -record.reservedOutputTokens, 0)
      this.appendAudit({
        workspaceId: record.workspaceId, action: `usage.${status.toLowerCase()}`, objectType: 'UsageRecord', objectId: reservationId,
        before: { status: 'Reserved', reserved: record.reservedInputTokens + record.reservedOutputTokens },
        after: { status },
        reason,
      })
    })
    return this.getUsage(reservationId)
  }

  reconcile(input: QuotaReconcileInput): QuotaReconcileResult {
    const stale = this.store.prepare(`
      SELECT id FROM usage_records WHERE status = 'Reserved' AND created_at < ?
    `).all(input.staleBefore) as unknown as { id: string }[]
    for (const row of stale) this.release(row.id, 'reconcile: stale reservation', 'Expired')
    return { expiredReservations: stale.length }
  }

  currentQuota(workspaceId: string): Quota {
    return this.ensureCurrentQuota(workspaceId, this.ensureSubscription(workspaceId))
  }

  quotas(workspaceId: string): Quota[] {
    const rows = this.store.prepare(`
      SELECT * FROM quotas WHERE workspace_id = ? ORDER BY period_start
    `).all(workspaceId) as unknown as QuotaRow[]
    return rows.map(rowToQuota)
  }

  usageRecords(workspaceId: string): UsageRecord[] {
    const rows = this.store.prepare(`
      SELECT * FROM usage_records WHERE workspace_id = ? ORDER BY created_at DESC
    `).all(workspaceId) as unknown as UsageRow[]
    return rows.map(rowToUsage)
  }

  auditEvents(workspaceId: string, limit = 100): AuditEvent[] {
    const rows = this.store.prepare(`
      SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?
    `).all(workspaceId, limit) as unknown as AuditEvent[]
    return rows
  }

  /** Append an audit event; participates in any open store transaction. */
  private appendAudit(input: {
    workspaceId: string
    action: string
    objectType: string
    objectId: string
    before?: unknown
    after?: unknown
    reason?: string
  }): void {
    const event: AuditEvent = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      actorType: this.actorType,
      actorId: this.actorId,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
      reason: input.reason ?? null,
      source: 'billing-local',
      occurredAt: this.now().toISOString(),
      traceId: null,
    }
    this.store.prepare(`
      INSERT INTO audit_events (
        id, workspace_id, actor_type, actor_id, action, object_type, object_id,
        before, after, reason, source, occurred_at, trace_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.workspaceId, event.actorType, event.actorId, event.action,
      event.objectType, event.objectId, event.before, event.after, event.reason,
      event.source, event.occurredAt, event.traceId,
    )
  }

  private ensureSubscription(workspaceId: string): Subscription {
    const now = this.now().toISOString()
    const row = this.store.prepare(`
      SELECT * FROM subscriptions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1
    `).get(workspaceId) as unknown as Record<string, string> | undefined
    if (row !== undefined) {
      return {
        id: row.id!,
        workspaceId: row.workspace_id!,
        planId: row.plan_id!,
        status: row.status as SubscriptionStatus,
        validFrom: row.valid_from!,
        validTo: row.valid_to ?? null,
        lastValidatedAt: row.last_validated_at!,
        updatedAt: row.updated_at!,
      }
    }
    const subscription: Subscription = {
      id: randomUUID(),
      workspaceId,
      planId: this.plan.id,
      status: 'Active',
      validFrom: now,
      validTo: null,
      lastValidatedAt: now,
      updatedAt: now,
    }
    this.store.prepare(`
      INSERT INTO subscriptions (id, workspace_id, plan_id, status, valid_from, valid_to, last_validated_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(subscription.id, subscription.workspaceId, subscription.planId, subscription.status,
      subscription.validFrom, subscription.validTo, subscription.lastValidatedAt, subscription.updatedAt)
    this.appendAudit({
      workspaceId, action: 'subscription.create', objectType: 'Subscription', objectId: subscription.id,
      after: { planId: subscription.planId, status: subscription.status },
      reason: 'default local plan provisioning',
    })
    return subscription
  }

  private ensureCurrentQuota(workspaceId: string, subscription: Subscription): Quota {
    const now = this.now()
    const { periodStart, periodEnd } = monthWindow(now)
    const nowIso = now.toISOString()
    const open = this.store.prepare(`
      SELECT * FROM quotas WHERE workspace_id = ? AND period_start = ? AND period_end = ? LIMIT 1
    `).get(workspaceId, periodStart, periodEnd) as unknown as QuotaRow | undefined
    if (open !== undefined) return rowToQuota(open)
    // Expire any quota window that has fully passed.
    this.store.prepare(`
      UPDATE quotas SET status = 'Expired', updated_at = ?
      WHERE workspace_id = ? AND period_end <= ? AND status != 'Expired'
    `).run(nowIso, workspaceId, periodStart)
    this.appendAudit({
      workspaceId, action: 'quota.expire', objectType: 'Quota', objectId: periodStart,
      after: { status: 'Expired' }, reason: 'period elapsed',
    })
    const quota: Quota = {
      id: randomUUID(),
      workspaceId,
      subscriptionId: subscription.id,
      periodType: this.plan.periodType,
      periodStart,
      periodEnd,
      tokenLimit: this.plan.tokenLimit,
      usedInputTokens: 0,
      usedOutputTokens: 0,
      requestLimit: this.plan.requestLimit,
      usedRequests: 0,
      status: 'Active',
      updatedAt: nowIso,
    }
    this.store.prepare(`
      INSERT INTO quotas (
        id, workspace_id, subscription_id, period_type, period_start, period_end,
        token_limit, used_input_tokens, used_output_tokens, request_limit, used_requests, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(quota.id, quota.workspaceId, quota.subscriptionId, quota.periodType, quota.periodStart,
      quota.periodEnd, quota.tokenLimit, quota.usedInputTokens, quota.usedOutputTokens,
      quota.requestLimit, quota.usedRequests, quota.status, quota.updatedAt)
    this.appendAudit({
      workspaceId, action: 'quota.create', objectType: 'Quota', objectId: quota.id,
      after: { periodStart: quota.periodStart, periodEnd: quota.periodEnd, tokenLimit: quota.tokenLimit },
    })
    return quota
  }

  private applyQuotaDelta(workspaceId: string, deltaInput: number, deltaOutput: number, deltaRequests: number): void {
    const { periodStart, periodEnd } = monthWindow(this.now())
    const quota = this.store.prepare(`
      SELECT * FROM quotas WHERE workspace_id = ? AND period_start = ? AND period_end = ? LIMIT 1
    `).get(workspaceId, periodStart, periodEnd) as unknown as QuotaRow | undefined
    if (quota === undefined) throw new Error(`quota window missing for workspace ${workspaceId}`)
    const usedInput = quota.used_input_tokens + deltaInput
    const usedOutput = quota.used_output_tokens + deltaOutput
    const usedRequests = quota.used_requests + deltaRequests
    const remaining = quota.token_limit - usedInput - usedOutput
    const softFloor = quota.token_limit * (1 - this.plan.softThresholdPct / 100)
    const status: Quota['status'] = remaining <= 0 ? 'Exhausted' : remaining <= softFloor ? 'SoftLimit' : 'Active'
    this.store.prepare(`
      UPDATE quotas
      SET used_input_tokens = ?, used_output_tokens = ?, used_requests = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(usedInput, usedOutput, usedRequests, status, this.now().toISOString(), quota.id)
  }

  private getUsage(reservationId: string): UsageRecord {
    const row = this.store.prepare('SELECT * FROM usage_records WHERE id = ?').get(reservationId) as unknown as UsageRow | undefined
    if (row === undefined) throw new Error(`usage record not found: ${reservationId}`)
    return rowToUsage(row)
  }

  private findUsageByIdempotencyKey(workspaceId: string, idempotencyKey: string): UsageRecord | undefined {
    const row = this.store.prepare(`
      SELECT * FROM usage_records WHERE workspace_id = ? AND idempotency_key = ?
    `).get(workspaceId, idempotencyKey) as unknown as UsageRow | undefined
    return row === undefined ? undefined : rowToUsage(row)
  }
}
