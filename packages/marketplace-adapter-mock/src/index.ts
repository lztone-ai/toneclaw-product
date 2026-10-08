/** Mock Temu adapter: simulated authorization, capability probing, and TAC §3.4 health
 * transitions driven through core-domain rules — the same pure functions production wiring uses. */
import {
  type AuthorizationEvent,
  P0_CAPABILITY_KEYS,
  applyAuthorizationEvent,
  type AuthorizationSnapshot,
  type PlatformConnectionStatus,
  type PlatformCredentialStatus,
  type Store,
  type StoreCapability,
  type StoreStatus,
} from '@toneclaw/core-domain'
import {
  AdapterUnsupportedError,
  type AuthorizationCallbackPayload,
  type AuthorizationResult,
  type AuthorizationStart,
  type AuthorizationStartRequest,
  type ConnectionHealth,
  type ListingStatusResult,
  type ListingSubmitPayload,
  type ListingSubmitResult,
  type ManualImportResult,
  type MarketplaceAdapter,
  type PlatformAttribute,
  type PlatformCategory,
  type ProductFitInput,
  type ProductFitResult,
  type TimeRange,
} from '@toneclaw/marketplace-adapter-core'

interface MockConnection {
  connectionStatus: PlatformConnectionStatus
  credentialStatus: PlatformCredentialStatus
  storeStatus: StoreStatus
  storeId: string
  scopes: string[]
  expiresAt: number | null
}

export interface MockAdapterOptions {
  now?: () => number
  /** Credential TTL in ms; null disables expiry. Default 1h demonstrates token_expired. */
  credentialTtlMs?: number | null
}

export class MockTemuAdapter implements MarketplaceAdapter {
  readonly platform = 'temu' as const
  private readonly connections = new Map<string, MockConnection>()
  private readonly now: () => number
  private readonly ttl: number | null
  private sellerSeq = 0

  constructor(options: MockAdapterOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttl = options.credentialTtlMs === undefined ? 3_600_000 : options.credentialTtlMs
  }

  async createAuthorization(request: AuthorizationStartRequest): Promise<AuthorizationStart> {
    this.connections.set(request.connectionId, {
      connectionStatus: 'pending', credentialStatus: 'pending', storeStatus: 'connecting',
      // Stable external store id per seller account: reconnecting the same account is the same store.
      storeId: `mock-store-${request.businessAccountId}`, scopes: [...P0_CAPABILITY_KEYS], expiresAt: null,
    })
    return {
      connectionId: request.connectionId,
      state: `mock-state-${request.connectionId}`,
      authorizationUrl: `https://mock.temu.example/oauth/authorize?state=${request.connectionId}`,
    }
  }

  async handleAuthorizationCallback(payload: AuthorizationCallbackPayload): Promise<AuthorizationResult> {
    const connection = this.requireConnection(payload.connectionId)
    if (!payload.approved) {
      this.transition(connection, 'authorize_failed')
      throw new Error('mock authorization rejected by platform')
    }
    this.transition(connection, 'authorize_succeeded')
    connection.expiresAt = this.ttl === null ? null : this.now() + this.ttl
    return {
      connectionId: payload.connectionId,
      platform: this.platform,
      externalSellerAccountId: `mock-seller-${++this.sellerSeq}`,
      externalStoreIds: [connection.storeId],
      credentialType: 'oauth',
      credentialSecretRef: `mock-safe-storage://credentials/${payload.connectionId}`,
      scopes: connection.scopes,
      expiresAt: connection.expiresAt === null ? null : new Date(connection.expiresAt).toISOString(),
    }
  }

  async verifyConnection(platformConnectionId: string): Promise<ConnectionHealth> {
    const connection = this.requireConnection(platformConnectionId)
    if (connection.connectionStatus === 'active' && connection.expiresAt !== null && this.now() >= connection.expiresAt) {
      this.transition(connection, 'token_expired')
    }
    return {
      connectionStatus: connection.connectionStatus,
      credentialStatus: connection.credentialStatus,
      storeStatus: connection.storeStatus,
      verifiedAt: new Date(this.now()).toISOString(),
    }
  }

  async disconnect(platformConnectionId: string): Promise<void> {
    const connection = this.requireConnection(platformConnectionId)
    this.transition(connection, 'user_disconnected')
  }

  /** Test hook: forces token_expired without waiting for TTL. */
  forceExpire(platformConnectionId: string): void {
    const connection = this.requireConnection(platformConnectionId)
    this.transition(connection, 'token_expired')
  }

  async fetchStore(platformConnectionId: string, storeId: string): Promise<Store> {
    const connection = this.requireConnection(platformConnectionId)
    return {
      id: storeId,
      businessAccountId: 'mock',
      platformConnectionId,
      platform: this.platform,
      externalSellerAccountId: 'mock-seller',
      externalStoreId: storeId,
      name: 'Mock Temu 半托管店',
      region: 'US',
      businessMode: 'semi_managed',
      currency: 'USD',
      timezone: 'America/New_York',
      status: connection.storeStatus,
      connectedAt: new Date(this.now()).toISOString(),
      lastSyncedAt: null,
    }
  }

  /** Mock capability: listing create/status read are API-backed so the desktop chain can auto-publish. */
  async fetchStoreCapabilities(platformConnectionId: string, storeId: string): Promise<StoreCapability[]> {
    this.requireConnection(platformConnectionId)
    const checkedAt = new Date(this.now()).toISOString()
    const degraded: Record<string, { status: StoreCapability['status']; mode: StoreCapability['mode']; notes: string | null }> = {
      'listing.create': { status: 'available', mode: 'api', notes: 'Mock 自动上架' },
      'listing.status.read': { status: 'available', mode: 'api', notes: 'Mock 平台状态回读' },
      'settlement.read': { status: 'unavailable', mode: 'manual', notes: 'TAC §4：可延后' },
    }
    return P0_CAPABILITY_KEYS.map(capabilityKey => {
      const fallback = degraded[capabilityKey] ?? { status: 'available' as const, mode: 'api' as const, notes: null }
      return { id: `mock-cap-${storeId}-${capabilityKey}`, storeId, capabilityKey, checkedAt, ...fallback }
    })
  }

  async fetchCategories(_storeId: string): Promise<PlatformCategory[]> {
    return [
      { platformCategoryId: 'mock-cat-root', parentPlatformCategoryId: null, name: 'Home & Kitchen' },
      { platformCategoryId: 'mock-cat-blender', parentPlatformCategoryId: 'mock-cat-root', name: 'Blenders' },
    ]
  }

  async fetchAttributes(_storeId: string, platformCategoryId: string): Promise<PlatformAttribute[]> {
    return [
      { platformCategoryId, attributeKey: 'material', name: 'Material', required: true, valueSchema: null },
      { platformCategoryId, attributeKey: 'capacity_ml', name: 'Capacity', required: false, valueSchema: null },
    ]
  }

  async validateProductFit(_storeId: string, _product: ProductFitInput): Promise<ProductFitResult> {
    return {
      result: 'fit',
      findings: [{ code: 'mock.fit.passed', severity: 'info', message: 'mock fit passed', fieldPath: null }],
    }
  }

  async createListing(_storeId: string, listingDraft: ListingSubmitPayload): Promise<ListingSubmitResult> {
    return {
      externalListingId: `MOCK-LISTING-${listingDraft.listingDraftId.slice(-8).toUpperCase()}`,
      submitted: true,
      rawStatus: 'submitted',
    }
  }

  async fetchListingStatus(_storeId: string, externalListingId: string): Promise<ListingStatusResult> {
    return { externalListingId, coreStatus: 'live', rawStatus: 'live' }
  }

  async importListingResult(_storeId: string, _importedListingPayload: unknown): Promise<ManualImportResult> {
    throw new AdapterUnsupportedError('listing.status.read')
  }

  async fetchOrders(_storeId: string, _timeRange: TimeRange): Promise<unknown[]> {
    throw new AdapterUnsupportedError('order.read')
  }

  async fetchFulfillments(_storeId: string, _externalOrderId: string): Promise<unknown[]> {
    throw new AdapterUnsupportedError('fulfillment.read')
  }

  async fetchSettlements(_storeId: string, _timeRange: TimeRange): Promise<unknown[]> {
    throw new AdapterUnsupportedError('settlement.read')
  }

  private transition(connection: MockConnection, event: AuthorizationEvent): void {
    const target = applyAuthorizationEvent(event, snapshotOf(connection))
    connection.connectionStatus = target.connection
    connection.credentialStatus = target.credential
    connection.storeStatus = target.store
  }

  private requireConnection(connectionId: string): MockConnection {
    const connection = this.connections.get(connectionId)
    if (connection === undefined) throw new Error(`mock connection not found: ${connectionId}`)
    return connection
  }
}

function snapshotOf(connection: MockConnection): AuthorizationSnapshot {
  return {
    connection: connection.connectionStatus,
    credential: connection.credentialStatus,
    store: connection.storeStatus,
  }
}
