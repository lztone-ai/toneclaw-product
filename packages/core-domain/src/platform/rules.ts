/** Authorization state rules per TAC §3.4 mapping and CM §4.5/4.6 P0 constraints
 * (pure functions only — "AI 理解，系统裁决"; the host applies, never invents, these). */
import type {
  PlatformConnectionStatus,
  PlatformCredentialStatus,
  StoreStatus,
} from './objects.ts'

export interface AuthorizationSnapshot {
  connection: PlatformConnectionStatus
  credential: PlatformCredentialStatus
  store: StoreStatus
}

/** TAC §3.4 trigger events. */
export type AuthorizationEvent =
  | 'authorize_started'
  | 'authorize_succeeded'
  | 'authorize_failed'
  | 'token_expired'
  | 'seller_revoked'
  | 'platform_error'
  | 'user_disconnected'

interface TargetStates {
  connection: PlatformConnectionStatus
  credential: PlatformCredentialStatus
  store: StoreStatus
}

const TARGET: Record<AuthorizationEvent, TargetStates> = {
  authorize_started: { connection: 'pending', credential: 'pending', store: 'connecting' },
  authorize_succeeded: { connection: 'active', credential: 'active', store: 'connected' },
  authorize_failed: { connection: 'invalid', credential: 'invalid', store: 'error' },
  token_expired: { connection: 'expired', credential: 'expired', store: 'expired' },
  seller_revoked: { connection: 'revoked', credential: 'revoked', store: 'disconnected' },
  // TAC §3.4 allows credential 'invalid' 或 'expired' on platform error. Deterministic rule:
  // active/pending credentials downgrade to 'invalid'; terminal states stay unchanged.
  platform_error: { connection: 'error', credential: 'invalid', store: 'error' },
  // TAC §3.4 allows 'revoked' 或 'expired' on user disconnect. Deterministic rule: a deliberate
  // disconnect revokes the stored credential reference.
  user_disconnected: { connection: 'disconnected', credential: 'revoked', store: 'disconnected' },
}

export function applyAuthorizationEvent(
  event: AuthorizationEvent,
  snapshot: AuthorizationSnapshot,
): AuthorizationSnapshot {
  const target: TargetStates = { ...TARGET[event] }
  if (event === 'platform_error' && snapshot.credential !== 'active' && snapshot.credential !== 'pending') {
    target.credential = snapshot.credential
  }
  return target
}

/** CM §4.6 P0: one BusinessAccount holds at most one active PlatformConnection. */
export function platformConnectionConflict(
  existingActive: { id: string } | undefined,
  incoming: { id: string; status: PlatformConnectionStatus },
): 'connection_already_active' | null {
  if (incoming.status !== 'active') return null
  if (existingActive === undefined) return null
  if (existingActive.id === incoming.id) return null
  return 'connection_already_active'
}

/** CM §4.5 P0: activation is limited to one Store; the data model stays multi-store. */
export function p0StoreLimit(currentCount: number, adding = 1): 'p0_single_store_limit' | null {
  return currentCount + adding > 1 ? 'p0_single_store_limit' : null
}

/** TAC §4 capability keys that must be probed after a connection succeeds. */
export const P0_CAPABILITY_KEYS = [
  'store.read',
  'category.read',
  'attribute.read',
  'listing.create',
  'listing.status.read',
  'order.read',
  'fulfillment.read',
  'settlement.read',
] as const

export type P0CapabilityKey = (typeof P0_CAPABILITY_KEYS)[number]

export function isP0CapabilityKey(key: string): key is P0CapabilityKey {
  return (P0_CAPABILITY_KEYS as readonly string[]).includes(key)
}
