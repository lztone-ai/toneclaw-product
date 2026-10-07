/** Repository ports for the platform authorization subdomain (implemented by product-storage). */
import type {
  BusinessWorkspace,
  ExternalSellerAccount,
  ExternalSellerAccountStatus,
  Platform,
  PlatformConnection,
  PlatformConnectionStatus,
  PlatformCredential,
  PlatformCredentialStatus,
  Store,
  StoreCapability,
  StoreStatus,
} from './objects.ts'

export interface BusinessWorkspaceRepository {
  insert(workspace: BusinessWorkspace): Promise<void>
  findById(businessAccountId: string, id: string): Promise<BusinessWorkspace | undefined>
  findDefault(businessAccountId: string): Promise<BusinessWorkspace | undefined>
}

export interface ExternalSellerAccountRepository {
  insert(account: ExternalSellerAccount): Promise<void>
  findByExternalId(
    businessAccountId: string,
    platform: Platform,
    externalSellerAccountId: string,
  ): Promise<ExternalSellerAccount | undefined>
  updateStatus(id: string, status: ExternalSellerAccountStatus, at: string): Promise<void>
}

export interface PlatformConnectionRepository {
  insert(connection: PlatformConnection): Promise<void>
  findById(businessAccountId: string, id: string): Promise<PlatformConnection | undefined>
  findActiveByBusinessAccount(businessAccountId: string): Promise<PlatformConnection | undefined>
  updateStatus(id: string, status: PlatformConnectionStatus, at: string): Promise<void>
}

export interface PlatformCredentialRepository {
  insert(credential: PlatformCredential): Promise<void>
  findActiveByConnection(platformConnectionId: string): Promise<PlatformCredential | undefined>
  updateStatus(id: string, status: PlatformCredentialStatus, at: string): Promise<void>
  updateStatusByConnection(platformConnectionId: string, status: PlatformCredentialStatus, at: string): Promise<void>
}

export interface StoreRepository {
  insert(store: Store): Promise<void>
  findById(businessAccountId: string, id: string): Promise<Store | undefined>
  list(businessAccountId: string): Promise<Store[]>
  countByBusinessAccount(businessAccountId: string): Promise<number>
  updateStatus(id: string, status: StoreStatus): Promise<void>
  markSynced(id: string, at: string): Promise<void>
}

export interface StoreCapabilityRepository {
  upsert(capability: StoreCapability): Promise<void>
  listByStore(storeId: string): Promise<StoreCapability[]>
}

export interface PlatformRepositories {
  workspaces: BusinessWorkspaceRepository
  externalSellerAccounts: ExternalSellerAccountRepository
  platformConnections: PlatformConnectionRepository
  platformCredentials: PlatformCredentialRepository
  stores: StoreRepository
  storeCapabilities: StoreCapabilityRepository
}
