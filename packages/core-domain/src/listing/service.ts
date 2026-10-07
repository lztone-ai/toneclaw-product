/** Listing governance lifecycle per CORE_MODEL 6.4-6.5 / 8.1-8.3 / 9.1-9.3.2 and
 * STATE_MACHINES 5.3-5.5 / 6.1-6.3 / 8.5. Pure domain; hosts apply persistence outcomes. */
import type { StoreRepository } from '../platform/ports.ts'
import type { AuditSink, IdGenerator, Clock } from '../ports.ts'
import type { AuditActorType } from '../objects.ts'
import type {
  ApprovalTask,
  ContentDraft,
  Finding,
  ListingContentType,
  ListingDraft,
  ListingDraftVariant,
  ListingProductContext,
  ManualListingPackage,
  MediaAsset,
  MediaVariant,
  PlatformAttributeMapping,
  PlatformCategoryMapping,
  PlatformAttributeValue,
  PlatformFitAssessment,
} from './objects.ts'
import type {
  ApprovalTaskRepository,
  ContentDraftRepository,
  ListingDraftContentLinkRepository,
  ListingDraftRepository,
  ListingDraftVariantRepository,
  ListingProductSource,
  ListingRepositories,
  ManualListingPackageRepository,
  MediaAssetRepository,
  MediaVariantRepository,
  PlatformAttributeMappingRepository,
  PlatformCategoryMappingRepository,
  PlatformFitAssessmentRepository,
} from './ports.ts'

export const LISTING_CONTENT_TYPES: readonly ListingContentType[] = [
  'title', 'description', 'bullets', 'keywords',
] as const
export const TEMU_MAIN_IMAGE_SPEC = { specKey: 'temu.square.1200', width: 1200, height: 1200 } as const

export interface ListingDeps extends ListingRepositories {
  ids: IdGenerator
  clock: Clock
  audit: AuditSink
  stores: StoreRepository
}

export interface GenerateListingInput {
  workspaceId: string
  productId: string
  storeId: string
  actorId: string
  platformCategoryId?: string
  priceMinor?: number
  stockQty?: number
}

export interface GeneratedListing {
  draft: ListingDraft
  assessment: PlatformFitAssessment
  contentDrafts: ContentDraft[]
  draftVariant: ListingDraftVariant | null
  mediaVariants: MediaVariant[]
  categoryMapping: PlatformCategoryMapping | null
}

export interface ListingActionInput {
  workspaceId: string
  listingDraftId: string
  actorId: string
}

export interface EditListingDraftInput extends ListingActionInput {
  title?: string
  description?: string
  bullets?: string[]
  keywords?: string[]
  platformCategoryId?: string
  attributes?: PlatformAttributeValue[]
  priceMinor?: number
  stockQty?: number
  mediaVariantIds?: string[]
}

export interface ValidationResult {
  status: ListingDraft['status']
  findings: Finding[]
}

export interface ListingApprovalResult {
  draft: ListingDraft
  task: ApprovalTask
}

export interface DecideListingApprovalInput extends ListingActionInput {
  decision: 'approved' | 'rejected'
  reason: string
}

export interface UpdateMediaAssetInput {
  workspaceId: string
  mediaAssetId: string
  actorId: string
  rightsStatus?: MediaAsset['rightsStatus']
  status?: Extract<MediaAsset['status'], 'ready' | 'blocked' | 'archived'>
}

export interface ManualListingPackageResult {
  draft: ListingDraft
  pkg: ManualListingPackage
}

function auditEvent(
  deps: ListingDeps,
  workspaceId: string,
  action: string,
  objectType: string,
  objectId: string,
  after: unknown,
  actorId: string,
): void {
  const actorType: AuditActorType = actorId === 'listing-domain' ? 'system' : 'user'
  deps.audit.append({
    id: deps.ids.next(),
    workspaceId,
    actorType,
    actorId,
    action,
    objectType,
    objectId,
    before: null,
    after: JSON.stringify(after),
    reason: null,
    source: 'core-domain',
    occurredAt: deps.clock.now().toISOString(),
    traceId: null,
  })
}

function riskScore(risk: ListingProductContext['product']['riskStatus']): number {
  return risk === 'high' ? 90 : risk === 'medium' ? 60 : risk === 'low' ? 20 : 50
}

function parseStringArray(body: string): string[] {
  try {
    const value = JSON.parse(body) as unknown
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function titleBody(productTitle: string): string {
  return productTitle.length > 128 ? `${productTitle.slice(0, 125)}...` : productTitle
}

function contentBodies(context: ListingProductContext): Record<ListingContentType, string> {
  const category = context.categoryLabels[0] ?? 'General'
  return {
    title: titleBody(context.product.title),
    description: (context.description?.trim() || context.product.title).slice(0, 5000),
    bullets: JSON.stringify([
      'Ready to ship from the verified supplier catalog',
      'Quality checked before dispatch',
      `Category fit: ${category}`,
    ]),
    keywords: JSON.stringify([context.product.title, ...context.categoryLabels].slice(0, 8)),
  }
}

function checksum(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

function normalizeAttributes(attributes: PlatformAttributeValue[] | undefined): PlatformAttributeValue[] {
  if (attributes === undefined) return []
  const seen = new Set<string>()
  return attributes.filter(attribute => {
    const key = attribute.key.trim()
    if (key === '' || seen.has(key)) return false
    seen.add(key)
    return true
  }).map(attribute => ({ ...attribute, key: attribute.key.trim() }))
}

async function ensureCategoryMapping(
  deps: ListingDeps,
  input: { workspaceId: string; platform: PlatformCategoryMapping['platform']; categoryId: string; externalCategoryId: string },
): Promise<PlatformCategoryMapping> {
  const existing = await deps.categoryMappings.findByCategory(
    input.workspaceId, input.platform, input.categoryId,
  )
  if (existing !== undefined && existing.externalCategoryId === input.externalCategoryId) return existing
  const mapping: PlatformCategoryMapping = existing === undefined
    ? {
      id: deps.ids.next(),
      businessAccountId: input.workspaceId,
      platform: input.platform,
      categoryId: input.categoryId,
      externalCategoryId: input.externalCategoryId,
      externalPath: input.externalCategoryId,
      status: 'unverified',
    }
    : { ...existing, externalCategoryId: input.externalCategoryId, externalPath: input.externalCategoryId, status: 'unverified' }
  await deps.categoryMappings.upsert(mapping)
  return mapping
}

async function ensureAttributeMappings(
  deps: ListingDeps,
  input: { workspaceId: string; platform: PlatformAttributeMapping['platform']; attributes: PlatformAttributeValue[] },
): Promise<void> {
  for (const attribute of input.attributes) {
    const existing = (await deps.attributeMappings.listByPlatform(input.workspaceId, input.platform))
      .find(candidate => candidate.attributeKey === attribute.key)
    if (existing === undefined) {
      await deps.attributeMappings.upsert({
        id: deps.ids.next(),
        businessAccountId: input.workspaceId,
        platform: input.platform,
        attributeKey: attribute.key,
        attributeName: attribute.key,
        externalAttributeKey: attribute.key,
        externalAttributeName: attribute.key,
        required: false,
        valueMapping: null,
        status: 'unverified',
      })
    }
  }
}

async function ensureProductMedia(
  deps: ListingDeps,
  input: { workspaceId: string; platform: MediaVariant['platform']; productId: string; imageUrls: string[] },
): Promise<MediaVariant[]> {
  const existing = await deps.mediaVariants.listByOwner(input.workspaceId, 'product', input.productId)
  if (existing.length > 0) return existing
  const variants: MediaVariant[] = []
  for (const [index, imageUrl] of input.imageUrls.entries()) {
    const asset: MediaAsset = {
      id: deps.ids.next(),
      businessAccountId: input.workspaceId,
      ownerType: 'product',
      ownerId: input.productId,
      mediaType: 'image',
      sourceType: 'imported',
      storageRef: imageUrl,
      mimeType: imageUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      checksum: checksum(imageUrl),
      width: null,
      height: null,
      rightsStatus: 'unknown',
      status: 'ready',
    }
    await deps.mediaAssets.insert(asset)
    const variant: MediaVariant = {
      id: deps.ids.next(),
      businessAccountId: input.workspaceId,
      mediaAssetId: asset.id,
      platform: input.platform,
      purpose: index === 0 ? 'main' : 'detail',
      specKey: TEMU_MAIN_IMAGE_SPEC.specKey,
      width: TEMU_MAIN_IMAGE_SPEC.width,
      height: TEMU_MAIN_IMAGE_SPEC.height,
      mimeType: asset.mimeType,
      storageRef: asset.storageRef,
      status: 'ready',
    }
    await deps.mediaVariants.insert(variant)
    variants.push(variant)
  }
  return variants
}

async function createContentDraft(
  deps: ListingDeps,
  input: {
    workspaceId: string
    productId: string
    contentType: ListingContentType
    body: string
    actorId: string
  },
): Promise<ContentDraft> {
  const existing = await deps.contentDrafts.listByProduct(input.workspaceId, input.productId)
  const version = existing
    .filter(content => content.contentType === input.contentType)
    .reduce((max, content) => Math.max(max, content.version), 0) + 1
  const content: ContentDraft = {
    id: deps.ids.next(),
    businessAccountId: input.workspaceId,
    productId: input.productId,
    contentType: input.contentType,
    language: 'en-US',
    version,
    body: input.body,
    generatedBy: 'human',
    model: null,
    usageRecordId: null,
    status: 'ready',
    reviewedBy: null,
    reviewedAt: null,
  }
  await deps.contentDrafts.insert(content)
  return content
}

async function adoptContent(deps: ListingDeps, draft: ListingDraft, content: ContentDraft, actorId: string): Promise<void> {
  const approved: ContentDraft = {
    ...content, status: 'approved', reviewedBy: actorId, reviewedAt: deps.clock.now().toISOString(),
  }
  await deps.contentDrafts.update(approved)
  await deps.contentLinks.deselectByType(draft.businessAccountId, draft.id, content.contentType)
  await deps.contentLinks.select(draft.businessAccountId, draft.id, approved.id, content.contentType)
  if (content.contentType === 'title') {
    draft.titleContentDraftId = approved.id
    draft.title = approved.body
  } else if (content.contentType === 'description') {
    draft.descriptionContentDraftId = approved.id
    draft.description = approved.body
  } else if (content.contentType === 'bullets') {
    draft.bulletsContentDraftId = approved.id
    draft.bullets = parseStringArray(approved.body)
  } else {
    draft.keywordsContentDraftId = approved.id
    draft.keywords = parseStringArray(approved.body)
  }
}

async function buildAssessment(
  deps: ListingDeps,
  input: { workspaceId: string; context: ListingProductContext; storeId: string; platformCategoryId: string },
): Promise<PlatformFitAssessment> {
  const findings: Finding[] = []
  if (input.context.imageUrls.length === 0) {
    findings.push({
      code: 'media_missing', severity: 'error',
      message: 'No source image is available; add a compliant product image before submission.',
      fieldPath: 'media',
    })
  }
  if (input.platformCategoryId === 'temu.uncategorized') {
    findings.push({
      code: 'category_mapping_missing', severity: 'warning',
      message: 'The Temu category is not mapped yet; confirm it before submission.',
      fieldPath: 'platformCategoryId',
    })
  }
  return {
    id: deps.ids.next(),
    businessAccountId: input.workspaceId,
    productId: input.context.product.id,
    storeId: input.storeId,
    platform: 'temu',
    result: findings.some(finding => finding.severity === 'error') ? 'needs_info' : 'fit',
    categoryMappingId: null,
    complianceStatus: 'unknown',
    mediaStatus: input.context.imageUrls.length === 0 ? 'failed' : 'passed',
    priceStatus: 'passed',
    riskScore: riskScore(input.context.product.riskStatus),
    findings,
    status: 'completed',
    assessedAt: deps.clock.now().toISOString(),
  }
}

/** Generate a governed ListingDraft with source media variants, one platform Offer,
 * category/attribute mapping candidates, and four content candidates. */
export async function generateListingDraft(deps: ListingDeps, input: GenerateListingInput): Promise<GeneratedListing> {
  const context = await deps.products.findByProductId(input.workspaceId, input.productId)
  if (context === undefined) throw new Error(`product not found: ${input.productId}`)
  const store = await deps.stores.findById(input.workspaceId, input.storeId)
  if (store === undefined || store.businessAccountId !== input.workspaceId || store.platform !== 'temu') {
    throw new Error('target Temu store not found')
  }
  if (store.status !== 'connected') throw new Error(`listing generation requires a connected store, got ${store.status}`)
  if (store.currency !== context.product.currency) throw new Error('listing currency mismatch with store')

  const priceMinor = input.priceMinor ?? context.suggestedRetailPriceMinor
  if (priceMinor === null || !Number.isInteger(priceMinor) || priceMinor <= 0) {
    throw new Error('listing price_minor must be a positive integer')
  }
  const stockQty = input.stockQty ?? 1
  if (!Number.isInteger(stockQty) || stockQty < 0) throw new Error('stock_qty must be a non-negative integer')

  const now = deps.clock.now().toISOString()
  const externalCategoryId = input.platformCategoryId ?? 'temu.uncategorized'
  const categoryMapping = await ensureCategoryMapping(deps, {
    workspaceId: input.workspaceId, platform: 'temu',
    categoryId: context.product.coreCategoryId, externalCategoryId,
  })
  await ensureAttributeMappings(deps, {
    workspaceId: input.workspaceId, platform: 'temu', attributes: context.variantAttributes,
  })
  const mediaVariants = await ensureProductMedia(deps, {
    workspaceId: input.workspaceId, platform: 'temu',
    productId: context.product.id, imageUrls: context.imageUrls,
  })
  const assessment = await buildAssessment(deps, {
    workspaceId: input.workspaceId, context, storeId: store.id, platformCategoryId: externalCategoryId,
  })
  assessment.categoryMappingId = categoryMapping.id
  await deps.assessments.insert(assessment)

  const bodies = contentBodies(context)
  const contentDrafts: ContentDraft[] = []
  for (const contentType of LISTING_CONTENT_TYPES) {
    contentDrafts.push(await createContentDraft(deps, {
      workspaceId: input.workspaceId, productId: context.product.id,
      contentType, body: bodies[contentType], actorId: input.actorId,
    }))
  }

  const draftId = deps.ids.next()
  const draft: ListingDraft = {
    id: draftId,
    businessAccountId: input.workspaceId,
    productId: context.product.id,
    storeId: store.id,
    platform: 'temu',
    platformFitAssessmentId: assessment.id,
    titleContentDraftId: null,
    descriptionContentDraftId: null,
    bulletsContentDraftId: null,
    keywordsContentDraftId: null,
    title: bodies.title,
    description: bodies.description,
    bullets: parseStringArray(bodies.bullets),
    keywords: parseStringArray(bodies.keywords),
    platformCategoryId: externalCategoryId,
    attributes: context.variantAttributes,
    priceMinor,
    currency: store.currency,
    stockQty,
    mediaVariantIds: mediaVariants.map(variant => variant.id),
    status: 'draft',
    validationResult: null,
    approvedBy: null,
    approvedAt: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await deps.drafts.insert(draft)
  for (const content of contentDrafts) {
    await deps.contentLinks.insert({
      id: deps.ids.next(),
      businessAccountId: input.workspaceId,
      listingDraftId: draft.id,
      contentDraftId: content.id,
      contentType: content.contentType,
      isSelected: false,
    })
  }
  let draftVariant: ListingDraftVariant | null = null
  if (context.variantId !== null) {
    draftVariant = {
      id: deps.ids.next(),
      businessAccountId: input.workspaceId,
      listingDraftId: draft.id,
      productVariantId: context.variantId,
      platformVariantKey: `temu:${context.sku ?? context.variantId}`,
      externalVariantId: null,
      attributes: context.variantAttributes,
      priceMinor,
      currency: store.currency,
      stockQty,
      status: 'draft',
    }
    await deps.draftVariants.insert(draftVariant)
  }
  auditEvent(deps, input.workspaceId, 'listing.draft_created', 'ListingDraft', draft.id, {
    productId: draft.productId,
    storeId: draft.storeId,
    assessmentId: assessment.id,
    categoryMappingId: categoryMapping.id,
    mediaVariantIds: draft.mediaVariantIds,
    draftVariantId: draftVariant?.id ?? null,
  }, input.actorId)
  return { draft, assessment, contentDrafts, draftVariant, mediaVariants, categoryMapping }
}

/** Edit a draft while preserving every content change as a new ContentDraft version and
 * forcing the prior platform assessment to `outdated`. */
export async function editListingDraft(deps: ListingDeps, input: EditListingDraftInput): Promise<ListingDraft> {
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'draft') throw new Error(`editing requires status draft, got ${draft.status}`)
  const context = await deps.products.findByProductId(input.workspaceId, draft.productId)
  if (context === undefined) throw new Error(`product not found: ${draft.productId}`)
  const now = deps.clock.now().toISOString()
  const updated: ListingDraft = { ...draft, updatedAt: now }

  const priorAssessment = await deps.assessments.findById(input.workspaceId, draft.platformFitAssessmentId)
  if (priorAssessment !== undefined) {
    await deps.assessments.updateStatus(input.workspaceId, priorAssessment.id, 'outdated')
  }
  const mediaVariantIds = input.mediaVariantIds ?? draft.mediaVariantIds
  for (const mediaVariantId of mediaVariantIds) {
    const variant = await deps.mediaVariants.findById(input.workspaceId, mediaVariantId)
    if (variant === undefined || variant.platform !== draft.platform || variant.status !== 'ready') {
      throw new Error(`media variant is not ready for this platform: ${mediaVariantId}`)
    }
    const asset = await deps.mediaAssets.findById(input.workspaceId, variant.mediaAssetId)
    if (asset === undefined || asset.ownerId !== draft.productId || asset.status !== 'ready') {
      throw new Error(`media asset is not ready for this product: ${variant.mediaAssetId}`)
    }
  }
  updated.mediaVariantIds = mediaVariantIds

  if (input.platformCategoryId !== undefined && input.platformCategoryId !== draft.platformCategoryId) {
    const mapping = await ensureCategoryMapping(deps, {
      workspaceId: input.workspaceId, platform: draft.platform,
      categoryId: context.product.coreCategoryId, externalCategoryId: input.platformCategoryId,
    })
    const assessment = await buildAssessment(deps, {
      workspaceId: input.workspaceId, context, storeId: draft.storeId,
      platformCategoryId: input.platformCategoryId,
    })
    assessment.categoryMappingId = mapping.id
    await deps.assessments.insert(assessment)
    updated.platformCategoryId = input.platformCategoryId
    updated.platformFitAssessmentId = assessment.id
  }
  if (input.attributes !== undefined) {
    updated.attributes = normalizeAttributes(input.attributes)
    await ensureAttributeMappings(deps, {
      workspaceId: input.workspaceId, platform: draft.platform, attributes: updated.attributes,
    })
  }
  if (input.priceMinor !== undefined) {
    if (!Number.isInteger(input.priceMinor) || input.priceMinor <= 0) throw new Error('price_minor must be a positive integer')
    updated.priceMinor = input.priceMinor
  }
  if (input.stockQty !== undefined) {
    if (!Number.isInteger(input.stockQty) || input.stockQty < 0) throw new Error('stock_qty must be a non-negative integer')
    updated.stockQty = input.stockQty
  }

  const contentEdits: Partial<Record<ListingContentType, string>> = {}
  if (input.title !== undefined) contentEdits.title = input.title
  if (input.description !== undefined) contentEdits.description = input.description
  if (input.bullets !== undefined) contentEdits.bullets = JSON.stringify(input.bullets)
  if (input.keywords !== undefined) contentEdits.keywords = JSON.stringify(input.keywords)
  for (const contentType of LISTING_CONTENT_TYPES) {
    const body = contentEdits[contentType]
    if (body === undefined) continue
    const content = await createContentDraft(deps, {
      workspaceId: input.workspaceId, productId: draft.productId, contentType, body, actorId: input.actorId,
    })
    await adoptContent(deps, updated, content, input.actorId)
  }
  const variants = await deps.draftVariants.listByListingDraft(input.workspaceId, draft.id)
  for (const variant of variants) {
    await deps.draftVariants.update({
      ...variant, attributes: updated.attributes, priceMinor: updated.priceMinor,
      currency: updated.currency, stockQty: updated.stockQty, status: 'draft',
    })
  }
  await deps.drafts.update(updated)
  auditEvent(deps, input.workspaceId, 'listing.draft_edited', 'ListingDraft', draft.id, {
    fields: Object.keys(input).filter(field => !['workspaceId', 'listingDraftId', 'actorId'].includes(field)
      && input[field as keyof EditListingDraftInput] !== undefined),
  }, input.actorId)
  return updated
}

/** Human adoption approves the selected content candidates and syncs the submission snapshot. */
export async function adoptListingContent(deps: ListingDeps, input: ListingActionInput): Promise<ListingDraft> {
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'draft') throw new Error(`content adoption requires status draft, got ${draft.status}`)
  const now = deps.clock.now().toISOString()
  const updated: ListingDraft = { ...draft, updatedAt: now }

  for (const contentType of LISTING_CONTENT_TYPES) {
    const candidates = (await deps.contentDrafts.listByProduct(input.workspaceId, draft.productId))
      .filter(content => content.contentType === contentType)
      .sort((left, right) => right.version - left.version)
    const selected = candidates.find(content => content.status === 'ready' || content.status === 'approved')
    if (selected === undefined) throw new Error(`no adoptable ${contentType} content candidate`)

    const approved: ContentDraft = selected.status === 'approved'
      ? selected
      : { ...selected, status: 'approved', reviewedBy: input.actorId, reviewedAt: now }
    if (approved !== selected) await deps.contentDrafts.update(approved)

    const existingLinks = await deps.contentLinks.listByListingDraft(input.workspaceId, draft.id)
    const previous = existingLinks.find(link => link.contentType === contentType && link.isSelected)
    if (previous !== undefined && previous.contentDraftId !== approved.id) {
      const oldContent = await deps.contentDrafts.findById(input.workspaceId, previous.contentDraftId)
      if (oldContent?.status === 'approved') {
        await deps.contentDrafts.update({ ...oldContent, status: 'superseded', reviewedBy: input.actorId, reviewedAt: now })
      }
    }
    await deps.contentLinks.deselectByType(input.workspaceId, draft.id, contentType)
    await deps.contentLinks.select(input.workspaceId, draft.id, approved.id, contentType)

    if (contentType === 'title') {
      updated.titleContentDraftId = approved.id
      updated.title = approved.body
    } else if (contentType === 'description') {
      updated.descriptionContentDraftId = approved.id
      updated.description = approved.body
    } else if (contentType === 'bullets') {
      updated.bulletsContentDraftId = approved.id
      updated.bullets = parseStringArray(approved.body)
    } else {
      updated.keywordsContentDraftId = approved.id
      updated.keywords = parseStringArray(approved.body)
    }
  }
  await deps.drafts.update(updated)
  auditEvent(deps, input.workspaceId, 'listing.content_adopted', 'ListingDraft', draft.id, {
    titleContentDraftId: updated.titleContentDraftId,
    descriptionContentDraftId: updated.descriptionContentDraftId,
    bulletsContentDraftId: updated.bulletsContentDraftId,
    keywordsContentDraftId: updated.keywordsContentDraftId,
  }, input.actorId)
  return updated
}

/** Validate required mappings, adopted content, media governance, and offer snapshots. */
export async function validateListingDraft(deps: ListingDeps, input: ListingActionInput): Promise<ValidationResult> {
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'draft') throw new Error(`validation requires status draft, got ${draft.status}`)
  const now = deps.clock.now().toISOString()
  await deps.drafts.update({ ...draft, status: 'ready_for_validation', updatedAt: now })
  auditEvent(deps, input.workspaceId, 'listing.validation_submitted', 'ListingDraft', draft.id, { status: 'ready_for_validation' }, input.actorId)

  const links = await deps.contentLinks.listByListingDraft(input.workspaceId, draft.id)
  const findings: Finding[] = []
  const missingContent = LISTING_CONTENT_TYPES.filter(contentType =>
    !links.some(link => link.contentType === contentType && link.isSelected && link.contentDraftId !== ''),
  )
  for (const contentType of missingContent) {
    findings.push({
      code: 'content_not_adopted', severity: 'error',
      message: `Adopt approved ${contentType} content before validation.`,
      fieldPath: contentType,
    })
  }
  if (draft.title.trim() === '' || draft.title.length > 200) {
    findings.push({ code: 'title_invalid', severity: 'error', message: 'The platform title must contain 1-200 characters.', fieldPath: 'title' })
  }
  if (draft.description.trim() === '') {
    findings.push({ code: 'description_missing', severity: 'error', message: 'The platform description is required.', fieldPath: 'description' })
  }
  if (draft.priceMinor <= 0) {
    findings.push({ code: 'price_invalid', severity: 'error', message: 'The platform price must be greater than zero.', fieldPath: 'price' })
  }
  if (draft.stockQty < 0) {
    findings.push({ code: 'stock_invalid', severity: 'error', message: 'Stock quantity cannot be negative.', fieldPath: 'stock' })
  }
  if (draft.mediaVariantIds.length === 0) {
    findings.push({ code: 'media_missing', severity: 'error', message: 'At least one ready platform image is required.', fieldPath: 'media' })
  }
  for (const mediaVariantId of draft.mediaVariantIds) {
    const variant = await deps.mediaVariants.findById(input.workspaceId, mediaVariantId)
    if (variant === undefined || variant.platform !== draft.platform || variant.status !== 'ready') {
      findings.push({
        code: 'media_not_ready', severity: 'error',
        message: 'A selected platform image is missing or not ready.', fieldPath: 'media',
      })
      continue
    }
    const asset = await deps.mediaAssets.findById(input.workspaceId, variant.mediaAssetId)
    if (asset === undefined || asset.status !== 'ready' || asset.rightsStatus === 'restricted') {
      findings.push({
        code: 'media_governance_failed', severity: 'error',
        message: 'A selected image is blocked, missing, or has restricted rights.', fieldPath: 'media',
      })
    }
  }
  for (const mapping of await deps.attributeMappings.listByPlatform(input.workspaceId, draft.platform)) {
    if (!mapping.required || mapping.status === 'inactive') continue
    const value = draft.attributes.find(attribute => attribute.key === mapping.attributeKey)
    if (value === undefined || value.value.trim() === '') {
      findings.push({
        code: 'required_attribute_missing', severity: 'error',
        message: `Required platform attribute "${mapping.attributeName}" is missing.`, fieldPath: mapping.attributeKey,
      })
    }
  }
  const productContext = await deps.products.findByProductId(input.workspaceId, draft.productId)
  const categoryMapping = productContext === undefined
    ? undefined
    : await deps.categoryMappings.findByCategory(input.workspaceId, draft.platform, productContext.product.coreCategoryId)
  if (categoryMapping === undefined || categoryMapping.status === 'inactive') {
    findings.push({
      code: 'category_mapping_missing', severity: 'error',
      message: 'The core category is not mapped to this platform.', fieldPath: 'platformCategoryId',
    })
  } else if (categoryMapping.status === 'unverified') {
    findings.push({
      code: 'category_mapping_unverified', severity: 'warning',
      message: 'The platform category mapping has not been verified.', fieldPath: 'platformCategoryId',
    })
  }
  const assessment = await deps.assessments.findById(input.workspaceId, draft.platformFitAssessmentId)
  if (assessment === undefined || assessment.status !== 'completed') {
    findings.push({ code: 'assessment_missing', severity: 'error', message: 'The platform fit assessment is missing or outdated.', fieldPath: 'assessment' })
  } else if (assessment.result === 'needs_info') {
    findings.push(...assessment.findings.filter(finding => finding.severity === 'error'))
  }

  const draftVariants = await deps.draftVariants.listByListingDraft(input.workspaceId, draft.id)
  if (findings.some(finding => finding.severity === 'error')) {
    const failed: ListingDraft = { ...draft, status: 'draft', validationResult: findings, updatedAt: now }
    await deps.drafts.update(failed)
    for (const variant of draftVariants) await deps.draftVariants.update({ ...variant, status: 'draft' })
    auditEvent(deps, input.workspaceId, 'listing.validation_failed', 'ListingDraft', draft.id, findings, input.actorId)
    return { status: 'draft', findings }
  }
  const validated: ListingDraft = { ...draft, status: 'validated', validationResult: findings, updatedAt: now }
  await deps.drafts.update(validated)
  for (const variant of draftVariants) await deps.draftVariants.update({ ...variant, status: 'validated' })
  auditEvent(deps, input.workspaceId, 'listing.validation_passed', 'ListingDraft', draft.id, findings, input.actorId)
  return { status: 'validated', findings }
}

/** Move a validated draft into explicit human approval and create its ApprovalTask. */
export async function submitListingApproval(deps: ListingDeps, input: ListingActionInput): Promise<ListingApprovalResult> {
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'validated') throw new Error(`approval submission requires status validated, got ${draft.status}`)
  const existing = await deps.approvalTasks.findPendingByTarget(
    input.workspaceId, 'ListingDraft', draft.id, 'listing_approval',
  )
  if (existing !== undefined) throw new Error(`listing approval is already pending: ${existing.id}`)
  const now = deps.clock.now().toISOString()
  const waiting: ListingDraft = { ...draft, status: 'waiting_approval', updatedAt: now }
  await deps.drafts.update(waiting)
  const task: ApprovalTask = {
    id: deps.ids.next(),
    businessAccountId: input.workspaceId,
    targetType: 'ListingDraft',
    targetId: draft.id,
    taskType: 'listing_approval',
    status: 'pending',
    reason: 'Approve the adopted Listing snapshot before publishing or manual export.',
    assignedTo: null,
    createdAt: now,
    resolvedAt: null,
  }
  await deps.approvalTasks.insert(task)
  auditEvent(deps, input.workspaceId, 'listing.approval_submitted', 'ListingDraft', draft.id, {
    status: 'waiting_approval', approvalTaskId: task.id,
  }, input.actorId)
  return { draft: waiting, task }
}

export async function decideListingApproval(deps: ListingDeps, input: DecideListingApprovalInput): Promise<ListingApprovalResult> {
  if (input.reason.trim() === '') throw new Error('approval reason is required')
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'waiting_approval') throw new Error(`approval decision requires status waiting_approval, got ${draft.status}`)
  const task = await deps.approvalTasks.findPendingByTarget(
    input.workspaceId, 'ListingDraft', draft.id, 'listing_approval',
  )
  if (task === undefined) throw new Error('pending listing approval task not found')
  const now = deps.clock.now().toISOString()
  const resolvedTask: ApprovalTask = {
    ...task, status: input.decision, reason: input.reason, resolvedAt: now,
  }
  await deps.approvalTasks.update(resolvedTask)
  const nextDraft: ListingDraft = input.decision === 'approved'
    ? { ...draft, status: 'approved', approvedBy: input.actorId, approvedAt: now, updatedAt: now }
    : { ...draft, status: 'draft', validationResult: [{
      code: 'listing_rejected', severity: 'warning', message: input.reason, fieldPath: 'approval',
    }], updatedAt: now }
  await deps.drafts.update(nextDraft)
  const draftVariants = await deps.draftVariants.listByListingDraft(input.workspaceId, draft.id)
  for (const variant of draftVariants) {
    await deps.draftVariants.update({ ...variant, status: input.decision === 'approved' ? 'approved' : 'draft' })
  }
  auditEvent(deps, input.workspaceId, `listing.approval_${input.decision}`, 'ListingDraft', draft.id, {
    status: nextDraft.status, approvalTaskId: task.id, reason: input.reason,
  }, input.actorId)
  return { draft: nextDraft, task: resolvedTask }
}

export async function updateMediaAsset(deps: ListingDeps, input: UpdateMediaAssetInput): Promise<MediaAsset> {
  const asset = await deps.mediaAssets.findById(input.workspaceId, input.mediaAssetId)
  if (asset === undefined) throw new Error(`media asset not found: ${input.mediaAssetId}`)
  const updated: MediaAsset = {
    ...asset,
    ...(input.rightsStatus === undefined ? {} : { rightsStatus: input.rightsStatus }),
    ...(input.status === undefined ? {} : { status: input.status }),
  }
  if (updated.status === 'ready' && updated.rightsStatus === 'restricted') {
    throw new Error('restricted media cannot be marked ready')
  }
  await deps.mediaAssets.update(updated)
  auditEvent(deps, input.workspaceId, 'media.asset_updated', 'MediaAsset', asset.id, {
    rightsStatus: updated.rightsStatus, status: updated.status,
  }, input.actorId)
  return updated
}

/** Freeze an approved snapshot into the manual-channel package artifact. */
export async function generateManualListingPackage(
  deps: ListingDeps,
  input: ListingActionInput,
): Promise<ManualListingPackageResult> {
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'approved') throw new Error(`manual package requires status approved, got ${draft.status}`)
  const now = deps.clock.now().toISOString()
  const links = await deps.contentLinks.listByListingDraft(input.workspaceId, draft.id)
  const contentDrafts: ContentDraft[] = []
  for (const contentType of LISTING_CONTENT_TYPES) {
    const link = links.find(candidate => candidate.contentType === contentType && candidate.isSelected)
    if (link === undefined) throw new Error(`selected ${contentType} content link is missing`)
    const content = await deps.contentDrafts.findById(input.workspaceId, link.contentDraftId)
    if (content === undefined) throw new Error(`selected content draft not found: ${link.contentDraftId}`)
    contentDrafts.push(content)
  }
  const store = await deps.stores.findById(input.workspaceId, draft.storeId)
  if (store === undefined) throw new Error(`store not found: ${draft.storeId}`)
  const productContext = await deps.products.findByProductId(input.workspaceId, draft.productId)
  if (productContext === undefined) throw new Error(`product not found: ${draft.productId}`)
  const assessment = await deps.assessments.findById(input.workspaceId, draft.platformFitAssessmentId)
  if (assessment === undefined) throw new Error(`platform fit assessment not found: ${draft.platformFitAssessmentId}`)
  const mediaVariants: MediaVariant[] = []
  for (const mediaVariantId of draft.mediaVariantIds) {
    const variant = await deps.mediaVariants.findById(input.workspaceId, mediaVariantId)
    if (variant !== undefined) mediaVariants.push(variant)
  }
  const packageId = deps.ids.next()
  const payload = {
    schemaVersion: 1,
    packageId,
    generatedAt: now,
    listingDraft: draft,
    assessment,
    contentDrafts,
    mediaVariants,
    product: {
      id: productContext.product.id,
      title: productContext.product.title,
      sku: productContext.sku,
      currency: productContext.product.currency,
    },
    store: {
      id: store.id,
      name: store.name,
      externalStoreId: store.externalStoreId,
      businessMode: store.businessMode,
      region: store.region,
      currency: store.currency,
    },
    images: mediaVariants.map(variant => variant.storageRef),
    submissionChannel: 'manual_export_import',
  }
  const pkg: ManualListingPackage = {
    id: packageId,
    businessAccountId: input.workspaceId,
    listingDraftId: draft.id,
    productId: draft.productId,
    storeId: draft.storeId,
    fileRef: `listing-packages/${packageId}.json`,
    payloadJson: `${JSON.stringify(payload, null, 2)}\n`,
    createdBy: input.actorId,
    createdAt: now,
  }
  await deps.manualPackages.insert(pkg)
  auditEvent(deps, input.workspaceId, 'listing.manual_package_created', 'ManualListingPackage', pkg.id, {
    listingDraftId: pkg.listingDraftId,
    fileRef: pkg.fileRef,
  }, input.actorId)
  return { draft, pkg }
}
