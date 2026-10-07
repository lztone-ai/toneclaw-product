/** Marketplace Adapter contract per TAC §12 (logical contract → TS). Auth/store/capability
 * frozen for Slice A; listing/order/settlement payload types refine in Slice D/F. */
import type {
  Platform,
  PlatformConnectionStatus,
  PlatformCredentialStatus,
  Store,
  StoreCapability,
  StoreStatus,
} from '@toneclaw/core-domain'

export interface TimeRange {
  fromAt: string
  toAt: string
}

export interface AuthorizationStartRequest {
  businessAccountId: string
  /** Host-owned identity (CM 2.1): the connection row id is allocated before the flow starts. */
  connectionId: string
  userId: string
}

export interface AuthorizationStart {
  connectionId: string
  state: string
  authorizationUrl: string
}

export interface AuthorizationCallbackPayload {
  connectionId: string
  state: string
  approved: boolean
  /** Raw platform callback reference for audit; never contains secrets. */
  rawPayloadRef: string | null
}

export interface AuthorizationResult {
  connectionId: string
  platform: Platform
  externalSellerAccountId: string
  externalStoreIds: string[]
  credentialType: 'oauth' | 'app_key_secret' | 'seller_token'
  /** Safe-storage reference; plaintext secrets never enter the business database. */
  credentialSecretRef: string
  scopes: string[]
  expiresAt: string | null
}

/** TAC §3.4: one health probe yields the three-way authorization snapshot. */
export interface ConnectionHealth {
  connectionStatus: PlatformConnectionStatus
  credentialStatus: PlatformCredentialStatus
  storeStatus: StoreStatus
  verifiedAt: string
}

export interface PlatformCategory {
  platformCategoryId: string
  parentPlatformCategoryId: string | null
  name: string
}

export interface PlatformAttribute {
  platformCategoryId: string
  attributeKey: string
  name: string
  required: boolean
  valueSchema: unknown
}

export interface ProductFitInput {
  productId: string
  title: string
  coreCategoryId: string
  attributes: Record<string, string>
  priceMinor: number
  currency: string
  imageUrls: string[]
}

export interface AdapterFinding {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  fieldPath: string | null
}

export interface ProductFitResult {
  result: 'fit' | 'not_fit' | 'needs_info'
  findings: AdapterFinding[]
}

export interface ListingSubmitPayload {
  listingDraftId: string
  title: string
  description: string
  platformCategoryId: string
  attributes: Record<string, string>
  priceMinor: number
  currency: string
  stockQty: number
  imageUrls: string[]
}

export interface ListingSubmitResult {
  externalListingId: string | null
  submitted: boolean
  rawStatus: string
}

export interface ListingStatusResult {
  externalListingId: string
  coreStatus: 'submitted' | 'platform_review' | 'live' | 'rejected' | 'inactive' | 'archived'
  rawStatus: string
}

export interface ManualImportResult {
  externalListingId: string
  coreStatus: ListingStatusResult['coreStatus']
  rawStatus: string
}

/** TAC §12. Implementations must probe StoreCapability before writing (TAC §4) and never
 * leak raw platform codes into business state (CM 4.9) — route through the error catalog. */
export interface MarketplaceAdapter {
  readonly platform: Platform
  createAuthorization(request: AuthorizationStartRequest): Promise<AuthorizationStart>
  handleAuthorizationCallback(payload: AuthorizationCallbackPayload): Promise<AuthorizationResult>
  verifyConnection(platformConnectionId: string): Promise<ConnectionHealth>
  disconnect(platformConnectionId: string): Promise<void>
  fetchStore(platformConnectionId: string, storeId: string): Promise<Store>
  fetchStoreCapabilities(platformConnectionId: string, storeId: string): Promise<StoreCapability[]>
  fetchCategories(storeId: string): Promise<PlatformCategory[]>
  fetchAttributes(storeId: string, platformCategoryId: string): Promise<PlatformAttribute[]>
  validateProductFit(storeId: string, product: ProductFitInput): Promise<ProductFitResult>
  createListing(storeId: string, listingDraft: ListingSubmitPayload): Promise<ListingSubmitResult>
  fetchListingStatus(storeId: string, externalListingId: string): Promise<ListingStatusResult>
  importListingResult(storeId: string, importedListingPayload: unknown): Promise<ManualImportResult>
  fetchOrders(storeId: string, timeRange: TimeRange): Promise<unknown[]>
  fetchFulfillments(storeId: string, externalOrderId: string): Promise<unknown[]>
  fetchSettlements(storeId: string, timeRange: TimeRange): Promise<unknown[]>
}

/** Raised when a method has no capability backing (TAC §4 degraded path). */
export class AdapterUnsupportedError extends Error {
  constructor(readonly capabilityKey: string, message?: string) {
    super(message ?? `capability not available: ${capabilityKey}`)
    this.name = 'AdapterUnsupportedError'
  }
}
