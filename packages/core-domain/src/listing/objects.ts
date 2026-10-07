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
  sku: string | null
  description: string | null
  categoryLabels: string[]
  imageUrls: string[]
  purchasePriceMinor: number | null
  suggestedRetailPriceMinor: number | null
  stockStatus: StockStatus
}
