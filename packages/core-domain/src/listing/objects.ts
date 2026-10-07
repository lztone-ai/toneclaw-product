/** Listing generation subdomain per CORE_MODEL 8.3 / 9.1-9.3.1 and STATE_MACHINES 5.5 / 6.1-6.2. */
import type { Platform } from '../platform/objects.ts'
import type { Product, StockStatus } from '../objects.ts'

export type ListingContentType = 'title' | 'description' | 'bullets' | 'keywords'
export type ContentDraftGeneratedBy = 'ai' | 'human' | 'import'
export type ContentDraftStatus =
  | 'draft'
  | 'generating'
  | 'ready'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'archived'

export interface ContentDraft {
  id: string
  businessAccountId: string
  productId: string
  contentType: ListingContentType
  language: string
  version: number
  body: string
  generatedBy: ContentDraftGeneratedBy
  model: string | null
  usageRecordId: string | null
  status: ContentDraftStatus
  reviewedBy: string | null
  reviewedAt: string | null
}

export type FindingSeverity = 'info' | 'warning' | 'error'

export interface Finding {
  code: string
  severity: FindingSeverity
  message: string
  fieldPath: string | null
}

export type PlatformFitResult = 'fit' | 'not_fit' | 'needs_info'
export type PlatformCheckStatus = 'unknown' | 'passed' | 'warning' | 'failed'
export type PlatformFitAssessmentStatus =
  | 'not_started'
  | 'running'
  | 'completed'
  | 'outdated'
  | 'canceled'

export interface PlatformFitAssessment {
  id: string
  businessAccountId: string
  productId: string
  storeId: string
  platform: Platform
  result: PlatformFitResult
  categoryMappingId: string | null
  complianceStatus: PlatformCheckStatus
  mediaStatus: PlatformCheckStatus
  priceStatus: PlatformCheckStatus
  riskScore: number | null
  findings: Finding[]
  status: PlatformFitAssessmentStatus
  assessedAt: string
}

export interface PlatformAttributeValue {
  key: string
  value: string
  valueType: 'string' | 'number' | 'boolean'
}

export type ListingDraftStatus =
  | 'draft'
  | 'ready_for_validation'
  | 'validated'
  | 'waiting_approval'
  | 'approved'
  | 'published_snapshot'
  | 'archived'

export interface ListingDraft {
  id: string
  businessAccountId: string
  productId: string
  storeId: string
  platform: Platform
  platformFitAssessmentId: string
  titleContentDraftId: string | null
  descriptionContentDraftId: string | null
  bulletsContentDraftId: string | null
  keywordsContentDraftId: string | null
  title: string
  description: string
  bullets: string[]
  keywords: string[]
  platformCategoryId: string
  attributes: PlatformAttributeValue[]
  priceMinor: number
  currency: string
  stockQty: number
  mediaVariantIds: string[]
  status: ListingDraftStatus
  validationResult: Finding[] | null
  approvedBy: string | null
  approvedAt: string | null
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ListingDraftContentLink {
  id: string
  businessAccountId: string
  listingDraftId: string
  contentDraftId: string
  contentType: ListingContentType
  isSelected: boolean
}

export interface ListingDraftVariant {
  id: string
  businessAccountId: string
  listingDraftId: string
  productVariantId: string
  platformVariantKey: string
  externalVariantId: string | null
  attributes: PlatformAttributeValue[]
  priceMinor: number
  currency: string
  stockQty: number
  status: 'draft' | 'validated' | 'approved' | 'submitted' | 'live' | 'rejected' | 'inactive' | 'archived'
}

export type MediaOwnerType = 'product' | 'product_variant' | 'sourcing_item' | 'supplier' | 'store'
export type MediaSourceType = 'imported' | 'generated' | 'uploaded'
export type MediaAssetStatus = 'imported' | 'processing' | 'ready' | 'failed' | 'blocked' | 'archived'
export type MediaRightsStatus = 'unknown' | 'owned' | 'licensed' | 'restricted'

export interface MediaAsset {
  id: string
  businessAccountId: string
  ownerType: MediaOwnerType
  ownerId: string
  mediaType: 'image' | 'video' | 'document'
  sourceType: MediaSourceType
  storageRef: string
  mimeType: string
  checksum: string
  width: number | null
  height: number | null
  rightsStatus: MediaRightsStatus
  status: MediaAssetStatus
}

export type MediaVariantPurpose = 'main' | 'detail' | 'scene' | 'size_chart'
export type MediaVariantStatus = 'pending' | 'generating' | 'ready' | 'invalid' | 'archived'

export interface MediaVariant {
  id: string
  businessAccountId: string
  mediaAssetId: string
  platform: Platform
  purpose: MediaVariantPurpose
  specKey: string
  width: number
  height: number
  mimeType: string
  storageRef: string
  status: MediaVariantStatus
}

export type PlatformMappingStatus = 'active' | 'inactive' | 'unverified'

export interface PlatformCategoryMapping {
  id: string
  businessAccountId: string
  platform: Platform
  categoryId: string
  externalCategoryId: string
  externalPath: string
  status: PlatformMappingStatus
}

export interface PlatformAttributeMapping {
  id: string
  businessAccountId: string
  platform: Platform
  attributeKey: string
  attributeName: string
  externalAttributeKey: string
  externalAttributeName: string
  required: boolean
  valueMapping: Record<string, string> | null
  status: PlatformMappingStatus
}

export type ApprovalTaskType =
  | 'listing_approval'
  | 'publish_confirmation'
  | 'high_cost_ai'
  | 'manual_action'
export type ApprovalTaskStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled'

export interface ApprovalTask {
  id: string
  businessAccountId: string
  targetType: string
  targetId: string
  taskType: ApprovalTaskType
  status: ApprovalTaskStatus
  reason: string
  assignedTo: string | null
  createdAt: string
  resolvedAt: string | null
}

/** Local manual-channel artifact (TAC §14: listing.create may be unavailable in P0). */
export interface ManualListingPackage {
  id: string
  businessAccountId: string
  listingDraftId: string
  productId: string
  storeId: string
  fileRef: string
  payloadJson: string
  createdBy: string
  createdAt: string
}

/** Read model consumed by the pure listing lifecycle; storage joins Product + SourcingItem + Variant. */
export interface ListingProductContext {
  product: Product
  variantId: string | null
  sku: string | null
  variantAttributes: PlatformAttributeValue[]
  description: string | null
  categoryLabels: string[]
  imageUrls: string[]
  purchasePriceMinor: number | null
  suggestedRetailPriceMinor: number | null
  stockStatus: StockStatus
}
