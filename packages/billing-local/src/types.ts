/** Billing and quota domain types per PHASE1_TECH_DESIGN 4.9 / 4.12. */

export type SubscriptionStatus = 'Trial' | 'Active' | 'PastDue' | 'Expired' | 'Canceled'
export type QuotaStatus = 'Active' | 'SoftLimit' | 'Exhausted' | 'Expired'
export type UsageStatus = 'Reserved' | 'Succeeded' | 'Failed' | 'Expired'
export type UsageScene = 'sourcing_analysis' | 'image_generation' | 'listing_generation' | 'report'
export type PeriodType = 'monthly'

export interface PlanDefinition {
  id: string
  code: string
  name: string
  periodType: PeriodType
  tokenLimit: number
  requestLimit: number
  softThresholdPct: number
  overagePolicy: 'block_ai_generation'
  allowedScenes: UsageScene[]
  features: string[]
}

export interface Subscription {
  id: string
  workspaceId: string
  planId: string
  status: SubscriptionStatus
  validFrom: string
  validTo: string | null
  lastValidatedAt: string
  updatedAt: string
}

export interface Quota {
  id: string
  workspaceId: string
  subscriptionId: string
  periodType: PeriodType
  periodStart: string
  periodEnd: string
  tokenLimit: number
  usedInputTokens: number
  usedOutputTokens: number
  requestLimit: number
  usedRequests: number
  status: QuotaStatus
  updatedAt: string
}

export interface UsageRecord {
  id: string
  workspaceId: string
  userId: string
  deviceId: string
  idempotencyKey: string
  scene: UsageScene
  model: string
  status: UsageStatus
  reservedInputTokens: number
  reservedOutputTokens: number
  inputTokens: number | null
  outputTokens: number | null
  costEstimateMinor: number | null
  estimated: boolean
  failure: string | null
  relatedObjectType: string | null
  relatedObjectId: string | null
  createdAt: string
  completedAt: string | null
  auditRef: string | null
}

export interface QuotaPrecheckInput {
  workspaceId: string
  scene: UsageScene
  model: string
  reservedInputTokens: number
  reservedOutputTokens: number
}

export type QuotaDecision =
  | { outcome: 'Allowed'; quotaId: string; remainingTokens: number; softLimit: boolean }
  | { outcome: 'Blocked'; reason: QuotaBlockReason; detail: string }

export type QuotaBlockReason =
  | 'Subscription.Inactive'
  | 'Scene.NotAllowed'
  | 'Quota.Exhausted'

export interface QuotaReserveInput extends QuotaPrecheckInput {
  idempotencyKey: string
  relatedObjectType?: string
  relatedObjectId?: string
}

export interface QuotaReservation {
  reservationId: string
  idempotencyKey: string
  deduplicated: boolean
}

export interface QuotaUsage {
  inputTokens: number
  outputTokens: number
  estimated: boolean
  costEstimateMinor?: number
  auditRef?: string
}

export interface QuotaReconcileInput {
  staleBefore: string
}

export interface QuotaReconcileResult {
  expiredReservations: number
}

export interface SubscriptionDecision {
  status: SubscriptionStatus
  planId: string
  validTo: string | null
}

export interface FeatureDecision {
  featureKey: string
  allowed: boolean
}

export type AuditActorType = 'system' | 'user' | 'ai'

/** Audit trail per PHASE1_TECH_DESIGN 4.10 (workspace-scoped for the local authority). */
export interface AuditEvent {
  id: string
  workspaceId: string
  actorType: AuditActorType
  actorId: string
  action: string
  objectType: string
  objectId: string
  before: string | null
  after: string | null
  reason: string | null
  source: string
  occurredAt: string
  traceId: string | null
}
