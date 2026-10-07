/** Platform authorization orchestration (Slice A1). Adapter + domain rules + storage ports +
 * audit live here; HTTP adapters in routes/platform.ts stay thin and index.ts stays a
 * composition root — the same context-module standard as product-storage repositories. */
import {
  applyAuthorizationEvent,
  platformConnectionConflict,
  p0StoreLimit,
  type AuditSink,
  type IdGenerator,
  type PlatformConnectionStatus,
  type PlatformCredentialStatus,
  type StoreStatus,
} from '@toneclaw/core-domain'
import type { ProductStorage } from '@toneclaw/product-storage'
import { MockTemuAdapter } from '@toneclaw/marketplace-adapter-mock'

export interface PlatformConnectionServiceConfig {
  businessAccountId: string
  actorId: string
}

export interface AuthorizeCallbackOutcome {
  connectionId: string
  connectionStatus: PlatformConnectionStatus
  storeStatus: StoreStatus
}

export interface ConnectionHealthSnapshot {
  connectionStatus: PlatformConnectionStatus
  credentialStatus: PlatformCredentialStatus
  storeStatus: StoreStatus
  verifiedAt: string
}

export class PlatformConnectionService {
  private readonly adapter: MockTemuAdapter

  constructor(
    private readonly storage: ProductStorage,
    private readonly ids: IdGenerator,
    private readonly config: PlatformConnectionServiceConfig,
    private readonly audit: AuditSink,
    adapter?: MockTemuAdapter,
  ) {
    this.adapter = adapter ?? new MockTemuAdapter()
  }

  async start(): Promise<{ connectionId: string; state: string; authorizationUrl: string }> {
    const connectionId = this.ids.next()
    const nowIso = new Date().toISOString()
    const start = await this.adapter.createAuthorization({
      businessAccountId: this.config.businessAccountId,
      connectionId,
      userId: this.config.actorId,
    })
    await this.storage.platformConnections.insert({
      id: connectionId,
      businessAccountId: this.config.businessAccountId,
      platform: 'temu',
      externalSellerAccountId: `pending-${connectionId}`,
      connectionType: 'oauth',
      displayName: null,
      status: 'pending',
      scopes: [],
      connectedByUserId: this.config.actorId,
      connectedAt: nowIso,
      expiresAt: null,
      lastVerifiedAt: nowIso,
    })
    this.auditAction('platform.connection.start', connectionId, { status: 'pending' })
    return { connectionId, state: start.state, authorizationUrl: start.authorizationUrl }
  }

  async authorizeCallback(input: {
    connectionId: string
    state: string
    approved: boolean
  }): Promise<AuthorizeCallbackOutcome> {
    const result = await this.adapter.handleAuthorizationCallback({
      connectionId: input.connectionId,
      state: input.state,
      approved: input.approved,
      rawPayloadRef: null,
    })
    const existingActive = await this.storage.platformConnections.findActiveByBusinessAccount(
      this.config.businessAccountId,
    )
    const conflict = platformConnectionConflict(existingActive, { id: result.connectionId, status: 'active' })
    if (conflict !== null) throw new Error(conflict)
    const nowIso = new Date().toISOString()
    await this.storage.externalSellerAccounts.insert({
      id: this.ids.next(),
      businessAccountId: this.config.businessAccountId,
      platform: 'temu',
      externalSellerAccountId: result.externalSellerAccountId,
      displayName: null,
      region: null,
      status: 'linked',
      linkedAt: nowIso,
      lastVerifiedAt: nowIso,
    })
    await this.storage.platformCredentials.insert({
      id: this.ids.next(),
      businessAccountId: this.config.businessAccountId,
      platformConnectionId: result.connectionId,
      platform: 'temu',
      credentialType: result.credentialType,
      secretRef: result.credentialSecretRef,
      scopes: result.scopes,
      status: 'active',
      expiresAt: result.expiresAt,
      lastVerifiedAt: nowIso,
    })
    const allStores = await this.storage.stores.list(this.config.businessAccountId)
    const operationalCount = allStores.filter(store =>
      store.status === 'connecting' || store.status === 'connected' || store.status === 'degraded',
    ).length
    if (p0StoreLimit(operationalCount, result.externalStoreIds.length) !== null) {
      throw new Error('p0_single_store_limit')
    }
    const succeeded = applyAuthorizationEvent('authorize_succeeded', {
      connection: 'pending',
      credential: 'pending',
      store: 'connecting',
    })
    await this.storage.platformConnections.updateStatus(result.connectionId, succeeded.connection, nowIso)
    for (const externalStoreId of result.externalStoreIds) {
      const externalStore = await this.adapter.fetchStore(result.connectionId, externalStoreId)
      const existing = allStores.find(store =>
        store.platform === 'temu' && store.externalStoreId === externalStoreId,
      )
      const storeId = existing?.id ?? this.ids.next()
      if (existing === undefined) {
        await this.storage.stores.insert({
          id: storeId,
          businessAccountId: this.config.businessAccountId,
          platformConnectionId: result.connectionId,
          platform: 'temu',
          externalSellerAccountId: result.externalSellerAccountId,
          externalStoreId,
          name: externalStore.name,
          region: externalStore.region,
          businessMode: externalStore.businessMode,
          currency: externalStore.currency,
          timezone: externalStore.timezone,
          status: succeeded.store,
          connectedAt: nowIso,
          lastSyncedAt: null,
        })
      } else {
        // Reconnect reuses the existing Store row (same internal id); audit keeps the trail.
        await this.storage.stores.updateStatus(storeId, succeeded.store)
      }
      const capabilities = await this.adapter.fetchStoreCapabilities(result.connectionId, externalStoreId)
      for (const capability of capabilities) {
        await this.storage.storeCapabilities.upsert({ ...capability, storeId })
      }
    }
    this.auditAction('platform.connection.authorized', result.connectionId, {
      connectionStatus: succeeded.connection,
      credentialStatus: succeeded.credential,
      storeStatus: succeeded.store,
    })
    return {
      connectionId: result.connectionId,
      connectionStatus: succeeded.connection,
      storeStatus: succeeded.store,
    }
  }

  async verify(connectionId: string): Promise<ConnectionHealthSnapshot> {
    const health = await this.adapter.verifyConnection(connectionId)
    await this.persistHealth(connectionId, health)
    this.auditAction('platform.connection.verify', connectionId, health)
    return health
  }

  async disconnect(connectionId: string): Promise<ConnectionHealthSnapshot> {
    await this.adapter.disconnect(connectionId)
    const health = await this.adapter.verifyConnection(connectionId)
    await this.persistHealth(connectionId, health)
    this.auditAction('platform.connection.disconnect', connectionId, health)
    return health
  }

  /** Mock-only dev hook: forces the TAC §3.4 token_expired transition without waiting for TTL. */
  async expire(connectionId: string): Promise<void> {
    this.adapter.forceExpire(connectionId)
  }

  listStores(): {
    connections: { id: string; status: string; lastVerifiedAt: string }[]
    stores: {
      id: string
      name: string
      region: string
      businessMode: string
      currency: string
      status: string
      lastSyncedAt: string | null
      capabilities: { capabilityKey: string; status: string; mode: string; notes: string | null }[]
    }[]
  } {
    return {
      connections: this.storage.listPlatformConnections(this.config.businessAccountId).map(connection => ({
        id: connection.id,
        status: connection.status,
        lastVerifiedAt: connection.lastVerifiedAt,
      })),
      stores: this.storage.listPlatformStoreViews(this.config.businessAccountId).map(({ store, capabilities }) => ({
        id: store.id,
        name: store.name,
        region: store.region,
        businessMode: store.businessMode,
        currency: store.currency,
        status: store.status,
        lastSyncedAt: store.lastSyncedAt,
        capabilities: capabilities.map(capability => ({
          capabilityKey: capability.capabilityKey,
          status: capability.status,
          mode: capability.mode,
          notes: capability.notes,
        })),
      })),
    }
  }

  private async persistHealth(connectionId: string, health: ConnectionHealthSnapshot): Promise<void> {
    await this.storage.platformConnections.updateStatus(connectionId, health.connectionStatus, health.verifiedAt)
    await this.storage.platformCredentials.updateStatusByConnection(connectionId, health.credentialStatus, health.verifiedAt)
    for (const view of this.storage.listPlatformStoreViews(this.config.businessAccountId)) {
      if (view.store.platformConnectionId !== connectionId) continue
      await this.storage.stores.updateStatus(view.store.id, health.storeStatus)
      await this.storage.stores.markSynced(view.store.id, health.verifiedAt)
    }
  }

  private auditAction(action: string, objectId: string, after: unknown): void {
    this.audit.append({
      id: this.ids.next(),
      workspaceId: this.config.businessAccountId,
      actorType: 'user',
      actorId: this.config.actorId,
      action,
      objectType: 'PlatformConnection',
      objectId,
      before: null,
      after: JSON.stringify(after),
      reason: null,
      source: 'product-host',
      occurredAt: new Date().toISOString(),
      traceId: null,
    })
  }
}
