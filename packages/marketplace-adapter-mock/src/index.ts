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
  type AdapterFinding,
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
  /** Review window in ms before a submitted listing goes live; null freezes platform_review. Default 60s. */
  listingReviewMs?: number | null
}

export class MockTemuAdapter implements MarketplaceAdapter {
  readonly platform = 'temu' as const
  private readonly connections = new Map<string, MockConnection>()
  private readonly now: () => number
  private readonly ttl: number | null
  private readonly listingReviewMs: number | null
  private readonly submittedListings = new Map<string, number>()
  private sellerSeq = 0
  private listingSeq = 0

  /** TAC §5.2: minimal category set with Temu-style numeric ids and a real parent path. */
  private readonly categories: PlatformCategory[] = [
    { platformCategoryId: '10001', parentPlatformCategoryId: null, name: 'Home & Kitchen' },
    { platformCategoryId: '10005', parentPlatformCategoryId: '10001', name: 'Kitchen Appliances' },
    { platformCategoryId: '1000502', parentPlatformCategoryId: '10005', name: 'Blenders' },
    { platformCategoryId: '10010', parentPlatformCategoryId: '10001', name: 'Storage & Organization' },
    { platformCategoryId: '1001001', parentPlatformCategoryId: '10010', name: 'Storage Boxes' },
  ]

  /** TAC §5.2: per-category required attributes with value schemas shaped like Temu's attribute API. */
  private readonly attributeSchemas: Record<string, PlatformAttribute[]> = {
    '1000502': [
      { platformCategoryId: '1000502', attributeKey: 'material', name: 'Material', required: true, valueSchema: { type: 'string', enum: ['Cotton', 'Linen', 'Polyester', 'Stainless Steel'] } },
      { platformCategoryId: '1000502', attributeKey: 'capacity_ml', name: 'Capacity', required: true, valueSchema: { type: 'number', minimum: 100, maximum: 5000, unit: 'ml' } },
      { platformCategoryId: '1000502', attributeKey: 'power_w', name: 'Power', required: false, valueSchema: { type: 'number', minimum: 100, maximum: 3000, unit: 'W' } },
    ],
    '1001001': [
      { platformCategoryId: '1001001', attributeKey: 'material', name: 'Material', required: true, valueSchema: { type: 'string', enum: ['Fabric', 'Plastic', 'Non-woven Fabric'] } },
      { platformCategoryId: '1001001', attributeKey: 'capacity_l', name: 'Capacity', required: false, valueSchema: { type: 'number', minimum: 5, maximum: 200, unit: 'L' } },
    ],
  }

  constructor(options: MockAdapterOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttl = options.credentialTtlMs === undefined ? 3_600_000 : options.credentialTtlMs
    this.listingReviewMs = options.listingReviewMs === undefined ? 60_000 : options.listingReviewMs
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
    return this.categories
  }

  async fetchAttributes(_storeId: string, platformCategoryId: string): Promise<PlatformAttribute[]> {
    return this.attributeSchemas[platformCategoryId] ?? [
      { platformCategoryId, attributeKey: 'material', name: 'Material', required: true, valueSchema: { type: 'string', enum: ['Cotton', 'Linen', 'Plastic'] } },
    ]
  }

  /** TAC §5.3: category mapping / required attributes / image specs / price anomaly checks. */
  async validateProductFit(_storeId: string, product: ProductFitInput): Promise<ProductFitResult> {
    const findings: AdapterFinding[] = []
    if (!this.categories.some(category => category.platformCategoryId === product.coreCategoryId)) {
      findings.push({
        code: 'mock.fit.category_unknown', severity: 'error',
        message: `platform category ${product.coreCategoryId} is not in the Temu category tree`,
        fieldPath: 'coreCategoryId',
      })
    }
    for (const attribute of await this.fetchAttributes(_storeId, product.coreCategoryId)) {
      const value = product.attributes[attribute.attributeKey]
      if (value === undefined || value === '') {
        if (attribute.required) {
          findings.push({
            code: 'mock.fit.attribute_missing', severity: 'error',
            message: `required attribute ${attribute.attributeKey} is missing`,
            fieldPath: `attributes.${attribute.attributeKey}`,
          })
        }
        continue
      }
      const schema = attribute.valueSchema as { enum?: string[] } | null
      if (schema?.enum !== undefined && !schema.enum.includes(value)) {
        findings.push({
          code: 'mock.fit.attribute_invalid', severity: 'error',
          message: `attribute ${attribute.attributeKey} must be one of: ${schema.enum.join(', ')}`,
          fieldPath: `attributes.${attribute.attributeKey}`,
        })
      }
    }
    if (product.imageUrls.length === 0) {
      findings.push({
        code: 'mock.fit.image_missing', severity: 'error',
        message: 'at least one main image is required',
        fieldPath: 'imageUrls',
      })
    } else if (product.imageUrls.length > 10) {
      findings.push({
        code: 'mock.fit.image_too_many', severity: 'warning',
        message: 'at most 10 images are allowed per listing',
        fieldPath: 'imageUrls',
      })
    }
    if (product.priceMinor <= 0 || product.priceMinor > 5_000_00) {
      findings.push({
        code: 'mock.fit.price_anomaly', severity: 'warning',
        message: 'price is outside the ordinary range and needs review',
        fieldPath: 'priceMinor',
      })
    }
    return {
      result: findings.some(finding => finding.severity === 'error') ? 'not_fit'
        : findings.some(finding => finding.severity === 'warning') ? 'needs_info' : 'fit',
      findings: findings.length === 0
        ? [{ code: 'mock.fit.passed', severity: 'info', message: 'mock fit checks passed', fieldPath: null }]
        : findings,
    }
  }

  /** TAC §6.1: numeric Temu-style goods id; raw status uses the platform vocabulary (TAC §7). */
  async createListing(_storeId: string, _listingDraft: ListingSubmitPayload): Promise<ListingSubmitResult> {
    const externalListingId = `3${String(++this.listingSeq).padStart(9, '0')}`
    this.submittedListings.set(externalListingId, this.now())
    return { externalListingId, submitted: true, rawStatus: '已提交' }
  }

  /** TAC §7: 平台审核中 → 在售 progression; null listingReviewMs freezes review. */
  async fetchListingStatus(_storeId: string, externalListingId: string): Promise<ListingStatusResult> {
    const submittedAt = this.submittedListings.get(externalListingId)
    if (submittedAt === undefined) throw new Error(`mock listing not found: ${externalListingId}`)
    if (this.listingReviewMs === null || this.now() - submittedAt < this.listingReviewMs) {
      return { externalListingId, coreStatus: 'platform_review', rawStatus: '平台审核中' }
    }
    return { externalListingId, coreStatus: 'live', rawStatus: '在售' }
  }

  /** Test hook: fast-forwards a submitted listing out of platform review. */
  passListingReview(externalListingId: string): void {
    const submittedAt = this.submittedListings.get(externalListingId)
    if (submittedAt === undefined) throw new Error(`mock listing not found: ${externalListingId}`)
    this.submittedListings.set(externalListingId, this.now() - (this.listingReviewMs ?? 0))
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
