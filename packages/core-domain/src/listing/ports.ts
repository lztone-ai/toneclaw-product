/** Repository ports for the Listing generation subdomain (implemented by product-storage). */
import type {
  ContentDraft,
  ListingContentType,
  ListingDraft,
  ListingDraftContentLink,
  ListingProductContext,
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
  manualPackages: ManualListingPackageRepository
  products: ListingProductSource
}
