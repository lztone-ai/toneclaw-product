/** Listing generation lifecycle invariants (STATE_MACHINES 5.5 / 6.1-6.2). */
import type { StoreRepository } from '../platform/ports.ts'
import type { AuditSink, IdGenerator, Clock } from '../ports.ts'
import type { AuditActorType } from '../objects.ts'
import type {
  ContentDraft,
  Finding,
  ListingContentType,
  ListingDraft,
  ListingProductContext,
  ManualListingPackage,
  PlatformFitAssessment,
} from './objects.ts'
import type {
  ContentDraftRepository,
  ListingDraftContentLinkRepository,
  ListingDraftRepository,
  ListingProductSource,
  ListingRepositories,
  ManualListingPackageRepository,
  PlatformFitAssessmentRepository,
} from './ports.ts'

export const LISTING_CONTENT_TYPES: readonly ListingContentType[] = [
  'title', 'description', 'bullets', 'keywords',
] as const

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
}

export interface ListingActionInput {
  workspaceId: string
  listingDraftId: string
  actorId: string
}

export interface ValidationResult {
  status: ListingDraft['status']
  findings: Finding[]
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

/** Generate an assessment, four P0 content candidates, and an editable ListingDraft. */
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
  const findings: Finding[] = []
  if (context.imageUrls.length === 0) {
    findings.push({
      code: 'media_missing', severity: 'error',
      message: 'No source image is available; add a compliant product image before manual submission.',
      fieldPath: 'media',
    })
  }
  if (input.platformCategoryId === undefined || input.platformCategoryId === 'temu.uncategorized') {
    findings.push({
      code: 'category_mapping_missing', severity: 'warning',
      message: 'The Temu category is not mapped yet; confirm it in Seller Central before submission.',
      fieldPath: 'platformCategoryId',
    })
  }

  const assessment: PlatformFitAssessment = {
    id: deps.ids.next(),
    businessAccountId: input.workspaceId,
    productId: context.product.id,
    storeId: store.id,
    platform: 'temu',
    result: findings.some(finding => finding.severity === 'error') ? 'needs_info' : 'fit',
    categoryMappingId: null,
    complianceStatus: 'unknown',
    mediaStatus: context.imageUrls.length === 0 ? 'failed' : 'passed',
    priceStatus: 'passed',
    riskScore: riskScore(context.product.riskStatus),
    findings,
    status: 'completed',
    assessedAt: now,
  }
  await deps.assessments.insert(assessment)

  const bodies = contentBodies(context)
  const contentDrafts: ContentDraft[] = LISTING_CONTENT_TYPES.map(contentType => ({
    id: deps.ids.next(),
    businessAccountId: input.workspaceId,
    productId: context.product.id,
    contentType,
    language: 'en-US',
    version: 1,
    body: bodies[contentType],
    generatedBy: 'human',
    model: null,
    usageRecordId: null,
    status: 'ready',
    reviewedBy: null,
    reviewedAt: null,
  }))
  for (const content of contentDrafts) await deps.contentDrafts.insert(content)

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
    platformCategoryId: input.platformCategoryId ?? 'temu.uncategorized',
    attributes: [],
    priceMinor,
    currency: store.currency,
    stockQty,
    mediaVariantIds: context.imageUrls.map((_, index) => `source-image-${index + 1}`),
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
  auditEvent(deps, input.workspaceId, 'listing.draft_created', 'ListingDraft', draft.id, {
    productId: draft.productId,
    storeId: draft.storeId,
    assessmentId: assessment.id,
  }, input.actorId)
  return { draft, assessment, contentDrafts }
}

/** Human adoption: approve ready candidates and atomically sync ListingDraft snapshots. */
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

/** Submit validation, persist findings, and return the state-machine outcome. */
export async function validateListingDraft(deps: ListingDeps, input: ListingActionInput): Promise<ValidationResult> {
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'draft') throw new Error(`validation requires status draft, got ${draft.status}`)
  const now = deps.clock.now().toISOString()
  await deps.drafts.update({ ...draft, status: 'ready_for_validation', updatedAt: now })
  auditEvent(deps, input.workspaceId, 'listing.validation_submitted', 'ListingDraft', draft.id, { status: 'ready_for_validation' }, input.actorId)

  const links = await deps.contentLinks.listByListingDraft(input.workspaceId, draft.id)
  const missingContent = LISTING_CONTENT_TYPES.filter(contentType =>
    !links.some(link => link.contentType === contentType && link.isSelected && link.contentDraftId !== ''),
  )
  const findings: Finding[] = []
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
  if (draft.priceMinor <= 0) findings.push({ code: 'price_invalid', severity: 'error', message: 'The platform price must be greater than zero.', fieldPath: 'price' })
  if (draft.stockQty < 0) findings.push({ code: 'stock_invalid', severity: 'error', message: 'Stock quantity cannot be negative.', fieldPath: 'stock' })
  if (draft.mediaVariantIds.length === 0) {
    findings.push({ code: 'media_missing', severity: 'error', message: 'At least one compliant product image is required.', fieldPath: 'media' })
  }
  const assessment = await deps.assessments.findById(input.workspaceId, draft.platformFitAssessmentId)
  if (assessment === undefined) {
    findings.push({ code: 'assessment_missing', severity: 'error', message: 'The platform fit assessment is missing.', fieldPath: 'assessment' })
  } else if (assessment.result === 'needs_info') {
    findings.push(...assessment.findings.filter(finding => finding.severity === 'error'))
  }

  if (findings.some(finding => finding.severity === 'error')) {
    const failed: ListingDraft = { ...draft, status: 'draft', validationResult: findings, updatedAt: now }
    await deps.drafts.update(failed)
    auditEvent(deps, input.workspaceId, 'listing.validation_failed', 'ListingDraft', draft.id, findings, input.actorId)
    return { status: 'draft', findings }
  }
  const validated: ListingDraft = { ...draft, status: 'validated', validationResult: findings, updatedAt: now }
  await deps.drafts.update(validated)
  auditEvent(deps, input.workspaceId, 'listing.validation_passed', 'ListingDraft', draft.id, findings, input.actorId)
  return { status: 'validated', findings }
}

export interface ConfirmManualPackageResult {
  draft: ListingDraft
  pkg: ManualListingPackage
}

/** Human approval freezes the adopted snapshot and records the manual package artifact. */
export async function confirmManualListingPackage(
  deps: ListingDeps,
  input: ListingActionInput,
): Promise<ConfirmManualPackageResult> {
  const draft = await deps.drafts.findById(input.workspaceId, input.listingDraftId)
  if (draft === undefined) throw new Error(`listing draft not found: ${input.listingDraftId}`)
  if (draft.status !== 'validated') throw new Error(`manual confirmation requires status validated, got ${draft.status}`)
  const now = deps.clock.now().toISOString()
  await deps.drafts.update({ ...draft, status: 'waiting_approval', updatedAt: now })
  auditEvent(deps, input.workspaceId, 'listing.approval_submitted', 'ListingDraft', draft.id, { status: 'waiting_approval' }, input.actorId)

  const approved: ListingDraft = { ...draft, status: 'approved', approvedBy: input.actorId, approvedAt: now, updatedAt: now }
  await deps.drafts.update(approved)
  auditEvent(deps, input.workspaceId, 'listing.approved', 'ListingDraft', draft.id, { status: 'approved' }, input.actorId)

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

  const packageId = deps.ids.next()
  const payload = {
    schemaVersion: 1,
    packageId,
    generatedAt: now,
    listingDraft: approved,
    assessment,
    contentDrafts,
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
    images: productContext.imageUrls,
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
  return { draft: approved, pkg }
}
