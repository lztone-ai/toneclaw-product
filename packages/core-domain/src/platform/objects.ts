/** Platform authorization subdomain per CORE_MODEL 4.1-4.9 (P0 field set, pure types only). */

/** Platform enum per CORE_MODEL 2.6: P0 ships temu only. New platforms activate via an
 * 08 §10 revision (reserved: tiktok_shop / amazon / shopee / aliexpress / shopify;
 * SHEIN joins through a P1 revision, R-2026-10-06). */
export type Platform = 'temu'

/** P0 ships a single default workspace; the workspaceId === businessAccountId coupling is
 * declared in 11号 v2.2 §17.3 and is decoupled in multi-tenant P1 (A0: model only). */
export interface BusinessWorkspace {
  id: string
  businessAccountId: string
  name: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type ExternalSellerAccountStatus = 'linked' | 'unverified' | 'disconnected' | 'blocked'

export interface ExternalSellerAccount {
  id: string
  businessAccountId: string
  platform: Platform
  externalSellerAccountId: string
  displayName: string | null
  region: string | null
  status: ExternalSellerAccountStatus
  linkedAt: string
  lastVerifiedAt: string
}

export type PlatformConnectionType = 'oauth' | 'app_key_secret' | 'seller_token'
export type PlatformConnectionStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'invalid'
  | 'error'
  | 'disconnected'

export interface PlatformConnection {
  id: string
  businessAccountId: string
  platform: Platform
  externalSellerAccountId: string
  connectionType: PlatformConnectionType
  displayName: string | null
  status: PlatformConnectionStatus
  scopes: string[]
  connectedByUserId: string
  connectedAt: string
  expiresAt: string | null
  lastVerifiedAt: string
}

export type PlatformCredentialType = 'oauth' | 'app_key_secret' | 'seller_token'
export type PlatformCredentialStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'invalid'

/** Credentials hang off PlatformConnection (CM 4.7). secretRef is a safe-storage reference
 * (Electron safeStorage) — plaintext secrets never enter the business database. */
export interface PlatformCredential {
  id: string
  businessAccountId: string
  platformConnectionId: string
  platform: Platform
  credentialType: PlatformCredentialType
  secretRef: string
  scopes: string[]
  status: PlatformCredentialStatus
  expiresAt: string | null
  lastVerifiedAt: string
}

export type StoreStatus =
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'disconnected'
  | 'expired'
  | 'error'
  | 'archived'
export type StoreBusinessMode = 'semi_managed' | 'full_managed' | 'local_store'

export interface Store {
  id: string
  businessAccountId: string
  platformConnectionId: string
  platform: Platform
  externalSellerAccountId: string
  externalStoreId: string
  name: string
  region: string
  businessMode: StoreBusinessMode
  currency: string
  timezone: string
  status: StoreStatus
  connectedAt: string
  lastSyncedAt: string | null
}

export type StoreCapabilityStatus = 'unknown' | 'checking' | 'available' | 'unavailable' | 'unsupported'
export type StoreCapabilityMode = 'api' | 'manual' | 'export_import'

export interface StoreCapability {
  id: string
  storeId: string
  capabilityKey: string
  status: StoreCapabilityStatus
  mode: StoreCapabilityMode
  checkedAt: string
  notes: string | null
}
