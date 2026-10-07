import { describe, expect, it } from 'vitest'
import {
  P0_CAPABILITY_KEYS,
  applyAuthorizationEvent,
  isP0CapabilityKey,
  p0StoreLimit,
  platformConnectionConflict,
  type AuthorizationSnapshot,
} from '../src/platform/rules.ts'

describe('TAC 3.4 authorization state mapping', () => {
  const base: AuthorizationSnapshot = { connection: 'pending', credential: 'pending', store: 'connecting' }

  it('maps every TAC 3.4 trigger to the frozen target states', () => {
    expect(applyAuthorizationEvent('authorize_started', base)).toEqual({
      connection: 'pending', credential: 'pending', store: 'connecting',
    })
    expect(applyAuthorizationEvent('authorize_succeeded', base)).toEqual({
      connection: 'active', credential: 'active', store: 'connected',
    })
    expect(applyAuthorizationEvent('authorize_failed', base)).toEqual({
      connection: 'invalid', credential: 'invalid', store: 'error',
    })
    expect(applyAuthorizationEvent('token_expired', {
      connection: 'active', credential: 'active', store: 'connected',
    })).toEqual({ connection: 'expired', credential: 'expired', store: 'expired' })
    expect(applyAuthorizationEvent('seller_revoked', {
      connection: 'active', credential: 'active', store: 'connected',
    })).toEqual({ connection: 'revoked', credential: 'revoked', store: 'disconnected' })
    expect(applyAuthorizationEvent('user_disconnected', {
      connection: 'active', credential: 'active', store: 'connected',
    })).toEqual({ connection: 'disconnected', credential: 'revoked', store: 'disconnected' })
  })

  it('keeps terminal credential states unchanged on platform errors', () => {
    expect(applyAuthorizationEvent('platform_error', {
      connection: 'active', credential: 'expired', store: 'connected',
    })).toEqual({ connection: 'error', credential: 'expired', store: 'error' })
    expect(applyAuthorizationEvent('platform_error', {
      connection: 'active', credential: 'active', store: 'connected',
    })).toEqual({ connection: 'error', credential: 'invalid', store: 'error' })
  })
})

describe('CM 4.6 single-active-connection constraint', () => {
  it('rejects a second active connection', () => {
    expect(platformConnectionConflict({ id: 'conn-1' }, { id: 'conn-2', status: 'active' }))
      .toBe('connection_already_active')
  })

  it('allows pending, same-id and first connections', () => {
    expect(platformConnectionConflict({ id: 'conn-1' }, { id: 'conn-2', status: 'pending' })).toBeNull()
    expect(platformConnectionConflict({ id: 'conn-1' }, { id: 'conn-1', status: 'active' })).toBeNull()
    expect(platformConnectionConflict(undefined, { id: 'conn-1', status: 'active' })).toBeNull()
  })
})

describe('CM 4.5 P0 single-store activation limit', () => {
  it('blocks the second store but allows the first', () => {
    expect(p0StoreLimit(0)).toBeNull()
    expect(p0StoreLimit(1)).toBe('p0_single_store_limit')
  })
})

describe('TAC 4 capability keys', () => {
  it('exposes exactly the eight P0 keys and guards lookups', () => {
    expect(P0_CAPABILITY_KEYS).toHaveLength(8)
    expect(isP0CapabilityKey('listing.create')).toBe(true)
    expect(isP0CapabilityKey('listing.delete')).toBe(false)
  })
})
