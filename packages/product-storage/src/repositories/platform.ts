/** Platform authorization repositories (A0). One context module per business subdomain —
 * new contexts (listing/publish, orders/procurement) follow this pattern instead of
 * growing the ProductStorage God class. */
import type { DatabaseSync } from 'node:sqlite'
import type {
  BusinessWorkspace,
  BusinessWorkspaceRepository,
  ExternalSellerAccount,
  ExternalSellerAccountRepository,
  PlatformConnection,
  PlatformConnectionRepository,
  PlatformCredential,
  PlatformCredentialRepository,
  PlatformRepositories,
  Store,
  StoreCapability,
  StoreCapabilityRepository,
  StoreRepository,
} from '@toneclaw/core-domain'

interface WorkspaceRow {
  id: string
  business_account_id: string
  name: string
  is_default: number
  created_at: string
  updated_at: string
}

interface ExternalSellerAccountRow {
  id: string
  business_account_id: string
  platform: ExternalSellerAccount['platform']
  external_seller_account_id: string
  display_name: string | null
  region: string | null
  status: ExternalSellerAccount['status']
  linked_at: string
  last_verified_at: string
}

interface PlatformConnectionRow {
  id: string
  business_account_id: string
  platform: PlatformConnection['platform']
  external_seller_account_id: string
  connection_type: PlatformConnection['connectionType']
  display_name: string | null
  status: PlatformConnection['status']
  scopes_json: string
  connected_by_user_id: string
  connected_at: string
  expires_at: string | null
  last_verified_at: string
}

interface PlatformCredentialRow {
  id: string
  business_account_id: string
  platform_connection_id: string
  platform: PlatformCredential['platform']
  credential_type: PlatformCredential['credentialType']
  secret_ref: string
  scopes_json: string
  status: PlatformCredential['status']
  expires_at: string | null
  last_verified_at: string
}

interface StoreRow {
  id: string
  business_account_id: string
  platform_connection_id: string
  platform: Store['platform']
  external_seller_account_id: string
  external_store_id: string
  name: string
  region: string
  business_mode: Store['businessMode']
  currency: string
  timezone: string
  status: Store['status']
  connected_at: string
  last_synced_at: string | null
}

interface StoreCapabilityRow {
  id: string
  store_id: string
  capability_key: string
  status: StoreCapability['status']
  mode: StoreCapability['mode']
  checked_at: string
  notes: string | null
}

function mapWorkspace(row: WorkspaceRow): BusinessWorkspace {
  return {
    id: row.id, businessAccountId: row.business_account_id, name: row.name,
    isDefault: row.is_default === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapExternalSellerAccount(row: ExternalSellerAccountRow): ExternalSellerAccount {
  return {
    id: row.id, businessAccountId: row.business_account_id, platform: row.platform,
    externalSellerAccountId: row.external_seller_account_id, displayName: row.display_name,
    region: row.region, status: row.status, linkedAt: row.linked_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

function mapPlatformConnection(row: PlatformConnectionRow): PlatformConnection {
  return {
    id: row.id, businessAccountId: row.business_account_id, platform: row.platform,
    externalSellerAccountId: row.external_seller_account_id,
    connectionType: row.connection_type, displayName: row.display_name,
    status: row.status, scopes: JSON.parse(row.scopes_json) as string[],
    connectedByUserId: row.connected_by_user_id, connectedAt: row.connected_at,
    expiresAt: row.expires_at, lastVerifiedAt: row.last_verified_at,
  }
}

function mapPlatformCredential(row: PlatformCredentialRow): PlatformCredential {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    platformConnectionId: row.platform_connection_id, platform: row.platform,
    credentialType: row.credential_type, secretRef: row.secret_ref,
    scopes: JSON.parse(row.scopes_json) as string[], status: row.status,
    expiresAt: row.expires_at, lastVerifiedAt: row.last_verified_at,
  }
}

function mapStore(row: StoreRow): Store {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    platformConnectionId: row.platform_connection_id, platform: row.platform,
    externalSellerAccountId: row.external_seller_account_id,
    externalStoreId: row.external_store_id, name: row.name, region: row.region,
    businessMode: row.business_mode, currency: row.currency, timezone: row.timezone,
    status: row.status, connectedAt: row.connected_at, lastSyncedAt: row.last_synced_at,
  }
}

function mapStoreCapability(row: StoreCapabilityRow): StoreCapability {
  return {
    id: row.id, storeId: row.store_id, capabilityKey: row.capability_key,
    status: row.status, mode: row.mode, checkedAt: row.checked_at, notes: row.notes,
  }
}

export function createPlatformRepositories(db: DatabaseSync): PlatformRepositories {
  return {
    workspaces: {
      insert: async workspace => {
        db.prepare(`
          INSERT INTO business_workspaces (
            id, business_account_id, name, is_default, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          workspace.id, workspace.businessAccountId, workspace.name,
          workspace.isDefault ? 1 : 0, workspace.createdAt, workspace.updatedAt,
        )
      },
      findById: async (businessAccountId, id) => {
        const row = db.prepare(
          `SELECT * FROM business_workspaces WHERE id = ? AND business_account_id = ? LIMIT 1`,
        ).get(id, businessAccountId) as unknown as WorkspaceRow | undefined
        return row === undefined ? undefined : mapWorkspace(row)
      },
      findDefault: async businessAccountId => {
        const row = db.prepare(
          `SELECT * FROM business_workspaces WHERE business_account_id = ? AND is_default = 1 LIMIT 1`,
        ).get(businessAccountId) as unknown as WorkspaceRow | undefined
        return row === undefined ? undefined : mapWorkspace(row)
      },
    },
    externalSellerAccounts: {
      insert: async account => {
        db.prepare(`
          INSERT INTO external_seller_accounts (
            id, business_account_id, platform, external_seller_account_id,
            display_name, region, status, linked_at, last_verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          account.id, account.businessAccountId, account.platform,
          account.externalSellerAccountId, account.displayName, account.region,
          account.status, account.linkedAt, account.lastVerifiedAt,
        )
      },
      findByExternalId: async (businessAccountId, platform, externalSellerAccountId) => {
        const row = db.prepare(`
          SELECT * FROM external_seller_accounts
          WHERE business_account_id = ? AND platform = ? AND external_seller_account_id = ?
          LIMIT 1
        `).get(businessAccountId, platform, externalSellerAccountId) as unknown as ExternalSellerAccountRow | undefined
        return row === undefined ? undefined : mapExternalSellerAccount(row)
      },
      updateStatus: async (id, status, at) => {
        db.prepare(`UPDATE external_seller_accounts SET status = ?, last_verified_at = ? WHERE id = ?`)
          .run(status, at, id)
      },
    },
    platformConnections: {
      insert: async connection => {
        db.prepare(`
          INSERT INTO platform_connections (
            id, business_account_id, platform, external_seller_account_id, connection_type,
            display_name, status, scopes_json, connected_by_user_id, connected_at,
            expires_at, last_verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          connection.id, connection.businessAccountId, connection.platform,
          connection.externalSellerAccountId, connection.connectionType,
          connection.displayName, connection.status, JSON.stringify(connection.scopes),
          connection.connectedByUserId, connection.connectedAt,
          connection.expiresAt, connection.lastVerifiedAt,
        )
      },
      findById: async (businessAccountId, id) => {
        const row = db.prepare(
          `SELECT * FROM platform_connections WHERE id = ? AND business_account_id = ? LIMIT 1`,
        ).get(id, businessAccountId) as unknown as PlatformConnectionRow | undefined
        return row === undefined ? undefined : mapPlatformConnection(row)
      },
      findActiveByBusinessAccount: async businessAccountId => {
        const row = db.prepare(`
          SELECT * FROM platform_connections
          WHERE business_account_id = ? AND status = 'active' LIMIT 1
        `).get(businessAccountId) as unknown as PlatformConnectionRow | undefined
        return row === undefined ? undefined : mapPlatformConnection(row)
      },
      updateStatus: async (id, status, at) => {
        db.prepare(`UPDATE platform_connections SET status = ?, last_verified_at = ? WHERE id = ?`)
          .run(status, at, id)
      },
    },
    platformCredentials: {
      insert: async credential => {
        db.prepare(`
          INSERT INTO platform_credentials (
            id, business_account_id, platform_connection_id, platform, credential_type,
            secret_ref, scopes_json, status, expires_at, last_verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          credential.id, credential.businessAccountId, credential.platformConnectionId,
          credential.platform, credential.credentialType, credential.secretRef,
          JSON.stringify(credential.scopes), credential.status,
          credential.expiresAt, credential.lastVerifiedAt,
        )
      },
      findActiveByConnection: async platformConnectionId => {
        const row = db.prepare(`
          SELECT * FROM platform_credentials
          WHERE platform_connection_id = ? AND status = 'active' LIMIT 1
        `).get(platformConnectionId) as unknown as PlatformCredentialRow | undefined
        return row === undefined ? undefined : mapPlatformCredential(row)
      },
      updateStatus: async (id, status, at) => {
        db.prepare(`UPDATE platform_credentials SET status = ?, last_verified_at = ? WHERE id = ?`)
          .run(status, at, id)
      },
      updateStatusByConnection: async (platformConnectionId, status, at) => {
        db.prepare(`UPDATE platform_credentials SET status = ?, last_verified_at = ? WHERE platform_connection_id = ?`)
          .run(status, at, platformConnectionId)
      },
    },
    stores: {
      insert: async store => {
        db.prepare(`
          INSERT INTO stores (
            id, business_account_id, platform_connection_id, platform,
            external_seller_account_id, external_store_id, name, region, business_mode,
            currency, timezone, status, connected_at, last_synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          store.id, store.businessAccountId, store.platformConnectionId, store.platform,
          store.externalSellerAccountId, store.externalStoreId, store.name, store.region,
          store.businessMode, store.currency, store.timezone, store.status,
          store.connectedAt, store.lastSyncedAt,
        )
      },
      findById: async (businessAccountId, id) => {
        const row = db.prepare(
          `SELECT * FROM stores WHERE id = ? AND business_account_id = ? LIMIT 1`,
        ).get(id, businessAccountId) as unknown as StoreRow | undefined
        return row === undefined ? undefined : mapStore(row)
      },
      list: async businessAccountId => {
        const rows = db.prepare(
          `SELECT * FROM stores WHERE business_account_id = ? ORDER BY connected_at DESC, id`,
        ).all(businessAccountId) as unknown as StoreRow[]
        return rows.map(mapStore)
      },
      countByBusinessAccount: async businessAccountId => {
        const row = db.prepare(
          `SELECT COUNT(*) AS n FROM stores WHERE business_account_id = ?`,
        ).get(businessAccountId) as unknown as { n: number }
        return row.n
      },
      updateStatus: async (id, status) => {
        db.prepare(`UPDATE stores SET status = ? WHERE id = ?`).run(status, id)
      },
      markSynced: async (id, at) => {
        db.prepare(`UPDATE stores SET last_synced_at = ? WHERE id = ?`).run(at, id)
      },
    },
    storeCapabilities: {
      upsert: async capability => {
        db.prepare(`
          INSERT INTO store_capabilities (
            id, store_id, capability_key, status, mode, checked_at, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(store_id, capability_key) DO UPDATE SET
            status = excluded.status,
            mode = excluded.mode,
            checked_at = excluded.checked_at,
            notes = excluded.notes
        `).run(
          capability.id, capability.storeId, capability.capabilityKey,
          capability.status, capability.mode, capability.checkedAt, capability.notes,
        )
      },
      listByStore: async storeId => {
        const rows = db.prepare(
          `SELECT * FROM store_capabilities WHERE store_id = ? ORDER BY capability_key`,
        ).all(storeId) as unknown as StoreCapabilityRow[]
        return rows.map(mapStoreCapability)
      },
    },
  }
}

export interface PlatformStoreView {
  store: Store
  capabilities: StoreCapability[]
}

export function listPlatformConnections(db: DatabaseSync, businessAccountId: string): PlatformConnection[] {
  const rows = db.prepare(
    `SELECT * FROM platform_connections WHERE business_account_id = ? ORDER BY connected_at DESC, id`,
  ).all(businessAccountId) as unknown as PlatformConnectionRow[]
  return rows.map(mapPlatformConnection)
}

export function listPlatformStoreViews(db: DatabaseSync, businessAccountId: string): PlatformStoreView[] {
  const storeRows = db.prepare(
    `SELECT * FROM stores WHERE business_account_id = ? ORDER BY connected_at DESC, id`,
  ).all(businessAccountId) as unknown as StoreRow[]
  return storeRows.map(row => {
    const store = mapStore(row)
    const capabilityRows = db.prepare(
      `SELECT * FROM store_capabilities WHERE store_id = ? ORDER BY capability_key`,
    ).all(store.id) as unknown as StoreCapabilityRow[]
    return { store, capabilities: capabilityRows.map(mapStoreCapability) }
  })
}
