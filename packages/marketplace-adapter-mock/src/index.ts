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

/** Temu attribute template verified against goods.create / attrs.get (TAC §15). */
export interface TemuAttributeTemplate {
  pid: number
  templatePid: number | null
  inputType: 'enum' | 'number' | 'text'
  vidOptions: { vid: number; name: string }[] | null
  unit: string | null
  /** Real templates chain dependent attributes: collected only when a parent vid matches. */
  dependsOn?: { attributeKey: string; vid: number }[]
}

/** goods.create shape probe: what a real semi-managed submit must carry (TAC §15). */
export interface MockGoodsCreateRequest {
  productName: string
  cat1Id: number
  cat2Id: number
  cat3Id: number
  cat4Id: number
  cat5Id: number
  cat6Id: number
  cat7Id: number
  cat8Id: number
  cat9Id: number
  cat10Id: number
  carouselImageUrls: string[]
  productPropertyReqs: {
    pid: number
    templatePid: number | null
    vid: number | null
    propName: string
    propValue: string
    valueUnit: string | null
    numberInputValue: number | null
  }[]
  productWarehouseRouteReq: { warehouseId: number; shipType: number }
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
      { platformCategoryId: '1000502', attributeKey: 'material', name: 'Material', required: true, valueSchema: { pid: 1001, templatePid: 1000, inputType: 'enum', vidOptions: [{ vid: 101, name: 'Cotton' }, { vid: 102, name: 'Linen' }, { vid: 103, name: 'Polyester' }, { vid: 104, name: 'Stainless Steel' }], unit: null } },
      { platformCategoryId: '1000502', attributeKey: 'capacity_ml', name: 'Capacity', required: true, valueSchema: { pid: 1002, templatePid: 1000, inputType: 'number', vidOptions: null, unit: 'ml' } },
      { platformCategoryId: '1000502', attributeKey: 'power_w', name: 'Power', required: false, valueSchema: { pid: 1003, templatePid: 1000, inputType: 'number', vidOptions: null, unit: 'W' } },
      { platformCategoryId: '1000502', attributeKey: 'power_source', name: 'Power Supply', required: true, valueSchema: { pid: 1004, templatePid: 1000, inputType: 'enum', vidOptions: [{ vid: 401, name: 'Corded Electric' }, { vid: 402, name: 'USB Rechargeable' }, { vid: 403, name: 'Battery' }], unit: null } },
      { platformCategoryId: '1000502', attributeKey: 'battery_capacity_mah', name: 'Battery Capacity', required: true, valueSchema: { pid: 1005, templatePid: 1000, inputType: 'number', vidOptions: null, unit: 'mAh', dependsOn: [{ attributeKey: 'power_source', vid: 402 }, { attributeKey: 'power_source', vid: 403 }] } },
    ],
    '1001001': [
      { platformCategoryId: '1001001', attributeKey: 'material', name: 'Material', required: true, valueSchema: { pid: 2001, templatePid: 2000, inputType: 'enum', vidOptions: [{ vid: 201, name: 'Fabric' }, { vid: 202, name: 'Plastic' }, { vid: 203, name: 'Non-woven Fabric' }, { vid: 204, name: 'Wood' }], unit: null } },
      { platformCategoryId: '1001001', attributeKey: 'wood_species', name: 'Wood Species', required: true, valueSchema: { pid: 2002, templatePid: 2000, inputType: 'enum', vidOptions: [{ vid: 2101, name: 'Oak' }, { vid: 2102, name: 'Pine' }, { vid: 2103, name: 'Walnut' }], unit: null, dependsOn: [{ attributeKey: 'material', vid: 204 }] } },
      { platformCategoryId: '1001001', attributeKey: 'capacity_l', name: 'Capacity', required: false, valueSchema: { pid: 2003, templatePid: 2000, inputType: 'number', vidOptions: null, unit: 'L' } },
    ],
  }
  private readonly lastGoodsCreateRequests = new Map<string, MockGoodsCreateRequest>()

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
    const templates = await this.fetchAttributes(_storeId, product.coreCategoryId)
    const templateByKey = new Map(templates.map(attribute => [attribute.attributeKey, attribute.valueSchema as TemuAttributeTemplate]))
    for (const attribute of templates) {
      const template = attribute.valueSchema as TemuAttributeTemplate
      const dependsOnSatisfied = template.dependsOn === undefined || template.dependsOn.some(dependency => {
        const parentTemplate = templateByKey.get(dependency.attributeKey)
        const parentValue = product.attributes[dependency.attributeKey]
        return parentTemplate?.vidOptions?.some(option => option.name === parentValue && option.vid === dependency.vid) === true
      })
      const value = product.attributes[attribute.attributeKey]
      if (value === undefined || value === '') {
        if (attribute.required && dependsOnSatisfied) {
          findings.push({
            code: 'mock.fit.attribute_missing', severity: 'error',
            message: `required attribute ${attribute.attributeKey} is missing`,
            fieldPath: `attributes.${attribute.attributeKey}`,
          })
        }
        continue
      }
      if (template.inputType === 'enum' && template.vidOptions?.some(option => option.name === value) !== true) {
        findings.push({
          code: 'mock.fit.attribute_invalid', severity: 'error',
          message: `attribute ${attribute.attributeKey} must be one of: ${(template.vidOptions ?? []).map(option => option.name).join(', ')}`,
          fieldPath: `attributes.${attribute.attributeKey}`,
        })
      } else if (template.inputType === 'number' && Number.isNaN(Number(value))) {
        findings.push({
          code: 'mock.fit.attribute_invalid', severity: 'error',
          message: `attribute ${attribute.attributeKey} must be a number`,
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

  /** TAC §6.1: translate to the verified goods.create shape, then submit (TAC §15). */
  async createListing(storeId: string, listingDraft: ListingSubmitPayload): Promise<ListingSubmitResult> {
    const request = await this.buildGoodsCreateRequest(storeId, listingDraft)
    const externalListingId = `3${String(++this.listingSeq).padStart(9, '0')}`
    this.lastGoodsCreateRequests.set(storeId, request)
    this.submittedListings.set(externalListingId, this.now())
    return { externalListingId, submitted: true, rawStatus: '已提交' }
  }

  /** goods.create shape probe: what the real adapter must send for semi-managed (TAC §15). */
  lastGoodsCreateRequest(storeId: string): MockGoodsCreateRequest | undefined {
    return this.lastGoodsCreateRequests.get(storeId)
  }

  private async buildGoodsCreateRequest(storeId: string, payload: ListingSubmitPayload): Promise<MockGoodsCreateRequest> {
    const chain: PlatformCategory[] = []
    let cursor: PlatformCategory | undefined = this.categories.find(category => category.platformCategoryId === payload.platformCategoryId)
    if (cursor === undefined) throw new Error(`platform category ${payload.platformCategoryId} is not in the Temu category tree`)
    while (cursor !== undefined) {
      chain.unshift(cursor)
      const parentId: string | null = cursor.parentPlatformCategoryId
      cursor = parentId === null ? undefined : this.categories.find(category => category.platformCategoryId === parentId)
    }
    const catIds = Array.from({ length: 10 }, (_, index) => {
      const node = chain[index]
      return node === undefined ? 0 : Number(node.platformCategoryId)
    })
    if (payload.imageUrls.length === 0) throw new Error('at least one carousel image is required')
    if (payload.imageUrls.length > 10) throw new Error('at most 10 carousel images are allowed')
    const templates = await this.fetchAttributes(storeId, payload.platformCategoryId)
    const templateByKey = new Map(templates.map(attribute => [attribute.attributeKey, attribute.valueSchema as TemuAttributeTemplate]))
    const productPropertyReqs: MockGoodsCreateRequest['productPropertyReqs'] = []
    for (const [key, rawValue] of Object.entries(payload.attributes)) {
      const attribute = templates.find(candidate => candidate.attributeKey === key)
      if (attribute === undefined) throw new Error(`attribute ${key} is not in the category template`)
      const template = templateByKey.get(key)!
      const dependsOnSatisfied = template.dependsOn === undefined || template.dependsOn.some(dependency => {
        const parentTemplate = templateByKey.get(dependency.attributeKey)
        const parentValue = payload.attributes[dependency.attributeKey]
        return parentTemplate?.vidOptions?.some(option => option.name === parentValue && option.vid === dependency.vid) === true
      })
      if (!dependsOnSatisfied) continue
      if (template.inputType === 'enum') {
        const option = template.vidOptions?.find(candidate => candidate.name === rawValue)
        if (option === undefined) throw new Error(`attribute ${key} must be one of: ${(template.vidOptions ?? []).map(candidate => candidate.name).join(', ')}`)
        productPropertyReqs.push({ pid: template.pid, templatePid: template.templatePid, vid: option.vid, propName: attribute.name, propValue: rawValue, valueUnit: null, numberInputValue: null })
      } else if (template.inputType === 'number') {
        const numeric = Number(rawValue)
        if (Number.isNaN(numeric)) throw new Error(`attribute ${key} must be a number`)
        productPropertyReqs.push({ pid: template.pid, templatePid: template.templatePid, vid: null, propName: attribute.name, propValue: rawValue, valueUnit: template.unit, numberInputValue: numeric })
      } else {
        productPropertyReqs.push({ pid: template.pid, templatePid: template.templatePid, vid: null, propName: attribute.name, propValue: rawValue, valueUnit: null, numberInputValue: null })
      }
    }
    return {
      productName: payload.title,
      cat1Id: catIds[0]!,
      cat2Id: catIds[1]!,
      cat3Id: catIds[2]!,
      cat4Id: catIds[3]!,
      cat5Id: catIds[4]!,
      cat6Id: catIds[5]!,
      cat7Id: catIds[6]!,
      cat8Id: catIds[7]!,
      cat9Id: catIds[8]!,
      cat10Id: catIds[9]!,
      carouselImageUrls: [...payload.imageUrls],
      productPropertyReqs,
      // Semi-managed goods.create requires a warehouse routing decision (TAC §15).
      productWarehouseRouteReq: { warehouseId: 1, shipType: 1 },
    }
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
