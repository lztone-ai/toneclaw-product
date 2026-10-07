/** Repository ports for the Listing generation subdomain (implemented by product-storage). */
import type {
  ContentDraft,
  ApprovalTask,
  ListingContentType,
  ListingDraft,
  ListingDraftContentLink,
  ListingDraftVariant,
  ListingProductContext,
  MediaAsset,
  MediaVariant,
  PlatformAttributeMapping,
  PlatformCategoryMapping,
  ManualListingPackage,
  PlatformFitAssessment,
} from './objects.ts'

export interface ContentDraftRepository {
  insert(content: ContentDraft): Promise<void>
  findById(businessAccountId: string, id: string): Promise<ContentDraft | undefined>
  listByProduct(businessAccountId: string, productId: string): Promise<ContentDraft[]>
  list(businessAccountId: string): Promise<ContentDraft[]>
  update(content: ContentDraft): Promise<void>
}

export interface PlatformFitAssessmentRepository {
  insert(assessment: PlatformFitAssessment): Promise<void>
  findById(businessAccountId: string, id: string): Promise<PlatformFitAssessment | undefined>
  updateStatus(businessAccountId: string, id: string, status: PlatformFitAssessment['status']): Promise<void>
}

export interface ListingDraftRepository {
  insert(draft: ListingDraft): Promise<void>
  findById(businessAccountId: string, id: string): Promise<ListingDraft | undefined>
  list(businessAccountId: string): Promise<ListingDraft[]>
  update(draft: ListingDraft): Promise<void>
}

export interface ListingDraftContentLinkRepository {
  insert(link: ListingDraftContentLink): Promise<void>
  listByListingDraft(businessAccountId: string, listingDraftId: string): Promise<ListingDraftContentLink[]>
  deselectByType(businessAccountId: string, listingDraftId: string, contentType: ListingContentType): Promise<void>
  select(businessAccountId: string, listingDraftId: string, contentDraftId: string, contentType: ListingContentType): Promise<void>
}

export interface ListingDraftVariantRepository {
  insert(variant: ListingDraftVariant): Promise<void>
  list(businessAccountId: string): Promise<ListingDraftVariant[]>
  listByListingDraft(businessAccountId: string, listingDraftId: string): Promise<ListingDraftVariant[]>
  update(variant: ListingDraftVariant): Promise<void>
}

export interface MediaAssetRepository {
  insert(asset: MediaAsset): Promise<void>
  findById(businessAccountId: string, id: string): Promise<MediaAsset | undefined>
  list(businessAccountId: string): Promise<MediaAsset[]>
  update(asset: MediaAsset): Promise<void>
}

export interface MediaVariantRepository {
  insert(variant: MediaVariant): Promise<void>
  findById(businessAccountId: string, id: string): Promise<MediaVariant | undefined>
  list(businessAccountId: string): Promise<MediaVariant[]>
  listByOwner(businessAccountId: string, ownerType: MediaAsset['ownerType'], ownerId: string): Promise<MediaVariant[]>
}

export interface PlatformCategoryMappingRepository {
  list(businessAccountId: string): Promise<PlatformCategoryMapping[]>
  upsert(mapping: PlatformCategoryMapping): Promise<void>
  findByCategory(businessAccountId: string, platform: PlatformCategoryMapping['platform'], categoryId: string): Promise<PlatformCategoryMapping | undefined>
}

export interface PlatformAttributeMappingRepository {
  upsert(mapping: PlatformAttributeMapping): Promise<void>
  listByPlatform(businessAccountId: string, platform: PlatformAttributeMapping['platform']): Promise<PlatformAttributeMapping[]>
}

export interface ApprovalTaskRepository {
  insert(task: ApprovalTask): Promise<void>
  findById(businessAccountId: string, id: string): Promise<ApprovalTask | undefined>
  findPendingByTarget(businessAccountId: string, targetType: string, targetId: string, taskType: ApprovalTask['taskType']): Promise<ApprovalTask | undefined>
  list(businessAccountId: string): Promise<ApprovalTask[]>
  update(task: ApprovalTask): Promise<void>
}

export interface ManualListingPackageRepository {
  insert(pkg: ManualListingPackage): Promise<void>
  list(businessAccountId: string): Promise<ManualListingPackage[]>
}

export interface ListingProductSource {
  findByProductId(businessAccountId: string, productId: string): Promise<ListingProductContext | undefined>
}

export interface ListingRepositories {
  contentDrafts: ContentDraftRepository
  assessments: PlatformFitAssessmentRepository
  drafts: ListingDraftRepository
  contentLinks: ListingDraftContentLinkRepository
  draftVariants: ListingDraftVariantRepository
  mediaAssets: MediaAssetRepository
  mediaVariants: MediaVariantRepository
  categoryMappings: PlatformCategoryMappingRepository
  attributeMappings: PlatformAttributeMappingRepository
  approvalTasks: ApprovalTaskRepository
  manualPackages: ManualListingPackageRepository
  products: ListingProductSource
}
