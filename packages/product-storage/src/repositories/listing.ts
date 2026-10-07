/** Listing generation repositories (Slice D). One context module per business subdomain; the
 * ProductStorage God class only exposes this composed port, it does not grow SQL branches. */
import type { DatabaseSync } from 'node:sqlite'
import type {
  ApprovalTask,
  ApprovalTaskRepository,
  ContentDraft,
  ContentDraftRepository,
  ListingDraftVariant,
  ListingDraftVariantRepository,
  ListingContentType,
  ListingDraft,
  ListingDraftContentLink,
  ListingDraftContentLinkRepository,
  ListingDraftRepository,
  ListingProductContext,
  ListingProductSource,
  ListingRepositories,
  MediaAsset,
  MediaAssetRepository,
  MediaVariant,
  MediaVariantRepository,
  ManualListingPackage,
  ManualListingPackageRepository,
  PlatformAttributeMapping,
  PlatformAttributeMappingRepository,
  PlatformCategoryMapping,
  PlatformCategoryMappingRepository,
  PlatformAttributeValue,
  PlatformFitAssessment,
  PlatformFitAssessmentRepository,
} from '@toneclaw/core-domain'

interface ContentDraftRow {
  id: string
  business_account_id: string
  product_id: string
  content_type: ContentDraft['contentType']
  language: string
  version: number
  body: string
  generated_by: ContentDraft['generatedBy']
  model: string | null
  usage_record_id: string | null
  status: ContentDraft['status']
  reviewed_by: string | null
  reviewed_at: string | null
}

interface AssessmentRow {
  id: string
  business_account_id: string
  product_id: string
  store_id: string
  platform: PlatformFitAssessment['platform']
  result: PlatformFitAssessment['result']
  category_mapping_id: string | null
  compliance_status: PlatformFitAssessment['complianceStatus']
  media_status: PlatformFitAssessment['mediaStatus']
  price_status: PlatformFitAssessment['priceStatus']
  risk_score: number | null
  findings_json: string
  status: PlatformFitAssessment['status']
  assessed_at: string
}

interface ListingDraftRow {
  id: string
  business_account_id: string
  product_id: string
  store_id: string
  platform: ListingDraft['platform']
  platform_fit_assessment_id: string
  title_content_draft_id: string | null
  description_content_draft_id: string | null
  bullets_content_draft_id: string | null
  keywords_content_draft_id: string | null
  title: string
  description: string
  bullets_json: string
  keywords_json: string
  platform_category_id: string
  attributes_json: string
  price_minor: number
  currency: string
  stock_qty: number
  media_variant_ids_json: string
  status: ListingDraft['status']
  validation_result_json: string | null
  approved_by: string | null
  approved_at: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

interface ContentLinkRow {
  id: string
  business_account_id: string
  listing_draft_id: string
  content_draft_id: string
  content_type: ListingDraftContentLink['contentType']
  is_selected: number
}

interface ManualPackageRow {
  id: string
  business_account_id: string
  listing_draft_id: string
  product_id: string
  store_id: string
  file_ref: string
  payload_json: string
  created_by: string
  created_at: string
}

interface ProductContextRow {
  id: string
  business_account_id: string
  sourcing_item_id: string | null
  created_from_selection_id: string | null
  title: string
  core_category_id: string
  currency: string
  risk_status: ListingProductContext['product']['riskStatus']
  status: ListingProductContext['product']['status']
  created_at: string
  updated_at: string
  variant_id: string | null
  sku: string | null
  attributes_json: string | null
  purchase_price_minor: number | null
  description_raw: string | null
  category_labels_json: string | null
  image_urls_json: string | null
  suggested_retail_price_minor: number | null
  stock_status: ListingProductContext['stockStatus'] | null
}

interface ListingDraftVariantRow {
  id: string
  business_account_id: string
  listing_draft_id: string
  product_variant_id: string
  platform_variant_key: string
  external_variant_id: string | null
  attributes_json: string
  price_minor: number
  currency: string
  stock_qty: number
  status: ListingDraftVariant['status']
}

interface MediaAssetRow {
  id: string
  business_account_id: string
  owner_type: MediaAsset['ownerType']
  owner_id: string
  media_type: MediaAsset['mediaType']
  source_type: MediaAsset['sourceType']
  storage_ref: string
  mime_type: string
  checksum: string
  width: number | null
  height: number | null
  rights_status: MediaAsset['rightsStatus']
  status: MediaAsset['status']
}

interface MediaVariantRow {
  id: string
  business_account_id: string
  media_asset_id: string
  platform: MediaVariant['platform']
  purpose: MediaVariant['purpose']
  spec_key: string
  width: number
  height: number
  mime_type: string
  storage_ref: string
  status: MediaVariant['status']
}

interface PlatformCategoryMappingRow {
  id: string
  business_account_id: string
  platform: PlatformCategoryMapping['platform']
  category_id: string
  external_category_id: string
  external_path: string
  status: PlatformCategoryMapping['status']
}

interface PlatformAttributeMappingRow {
  id: string
  business_account_id: string
  platform: PlatformAttributeMapping['platform']
  attribute_key: string
  attribute_name: string
  external_attribute_key: string
  external_attribute_name: string
  required: number
  value_mapping_json: string | null
  status: PlatformAttributeMapping['status']
}

interface ApprovalTaskRow {
  id: string
  business_account_id: string
  target_type: string
  target_id: string
  task_type: ApprovalTask['taskType']
  status: ApprovalTask['status']
  reason: string
  assigned_to: string | null
  created_at: string
  resolved_at: string | null
}

function parseArray(text: string | null): string[] {
  if (text === null) return []
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function mapContentDraft(row: ContentDraftRow): ContentDraft {
  return {
    id: row.id, businessAccountId: row.business_account_id, productId: row.product_id,
    contentType: row.content_type, language: row.language, version: row.version,
    body: row.body, generatedBy: row.generated_by, model: row.model,
    usageRecordId: row.usage_record_id, status: row.status,
    reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
  }
}

function mapAssessment(row: AssessmentRow): PlatformFitAssessment {
  return {
    id: row.id, businessAccountId: row.business_account_id, productId: row.product_id,
    storeId: row.store_id, platform: row.platform, result: row.result,
    categoryMappingId: row.category_mapping_id, complianceStatus: row.compliance_status,
    mediaStatus: row.media_status, priceStatus: row.price_status, riskScore: row.risk_score,
    findings: JSON.parse(row.findings_json) as PlatformFitAssessment['findings'],
    status: row.status, assessedAt: row.assessed_at,
  }
}

function mapListingDraft(row: ListingDraftRow): ListingDraft {
  return {
    id: row.id, businessAccountId: row.business_account_id, productId: row.product_id,
    storeId: row.store_id, platform: row.platform,
    platformFitAssessmentId: row.platform_fit_assessment_id,
    titleContentDraftId: row.title_content_draft_id,
    descriptionContentDraftId: row.description_content_draft_id,
    bulletsContentDraftId: row.bullets_content_draft_id,
    keywordsContentDraftId: row.keywords_content_draft_id,
    title: row.title, description: row.description,
    bullets: parseArray(row.bullets_json), keywords: parseArray(row.keywords_json),
    platformCategoryId: row.platform_category_id,
    attributes: JSON.parse(row.attributes_json) as ListingDraft['attributes'],
    priceMinor: row.price_minor, currency: row.currency, stockQty: row.stock_qty,
    mediaVariantIds: parseArray(row.media_variant_ids_json), status: row.status,
    validationResult: row.validation_result_json === null
      ? null
      : JSON.parse(row.validation_result_json) as ListingDraft['validationResult'],
    approvedBy: row.approved_by, approvedAt: row.approved_at,
    lastSyncedAt: row.last_synced_at, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapContentLink(row: ContentLinkRow): ListingDraftContentLink {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    listingDraftId: row.listing_draft_id, contentDraftId: row.content_draft_id,
    contentType: row.content_type, isSelected: row.is_selected === 1,
  }
}

function mapManualPackage(row: ManualPackageRow): ManualListingPackage {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    listingDraftId: row.listing_draft_id, productId: row.product_id,
    storeId: row.store_id, fileRef: row.file_ref, payloadJson: row.payload_json,
    createdBy: row.created_by, createdAt: row.created_at,
  }
}

function mapProductContext(row: ProductContextRow): ListingProductContext {
  const variantAttributes = parsePlatformAttributes(row.attributes_json)
  return {
    product: {
      id: row.id, businessAccountId: row.business_account_id,
      sourcingItemId: row.sourcing_item_id,
      createdFromSelectionId: row.created_from_selection_id,
      title: row.title, coreCategoryId: row.core_category_id, currency: row.currency,
      riskStatus: row.risk_status, status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at,
    },
    variantId: row.variant_id,
    sku: row.sku,
    variantAttributes,
    description: row.description_raw,
    categoryLabels: parseArray(row.category_labels_json),
    imageUrls: parseArray(row.image_urls_json),
    purchasePriceMinor: row.purchase_price_minor,
    suggestedRetailPriceMinor: row.suggested_retail_price_minor,
    stockStatus: row.stock_status ?? 'unknown',
  }
}

function parsePlatformAttributes(text: string | null): PlatformAttributeValue[] {
  if (text === null || text.trim() === '') return []
  try {
    const value = JSON.parse(text) as unknown
    if (Array.isArray(value)) {
      return value.flatMap(item => {
        if (typeof item !== 'object' || item === null) return []
        const record = item as Record<string, unknown>
        const key = typeof record['key'] === 'string' ? record['key'] : null
        if (key === null) return []
        const rawValue = record['value'] ?? record['valueText'] ?? record['value_text'] ?? ''
        return [{ key, value: String(rawValue), valueType: 'string' as const }]
      })
    }
    if (typeof value !== 'object' || value === null) return []
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
      key, value: String(item), valueType: 'string' as const,
    }))
  } catch {
    return []
  }
}

function mapListingDraftVariant(row: ListingDraftVariantRow): ListingDraftVariant {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    listingDraftId: row.listing_draft_id, productVariantId: row.product_variant_id,
    platformVariantKey: row.platform_variant_key, externalVariantId: row.external_variant_id,
    attributes: JSON.parse(row.attributes_json) as ListingDraftVariant['attributes'],
    priceMinor: row.price_minor, currency: row.currency, stockQty: row.stock_qty,
    status: row.status,
  }
}

function mapMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    ownerType: row.owner_type, ownerId: row.owner_id, mediaType: row.media_type,
    sourceType: row.source_type, storageRef: row.storage_ref, mimeType: row.mime_type,
    checksum: row.checksum, width: row.width, height: row.height,
    rightsStatus: row.rights_status, status: row.status,
  }
}

function mapMediaVariant(row: MediaVariantRow): MediaVariant {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    mediaAssetId: row.media_asset_id, platform: row.platform, purpose: row.purpose,
    specKey: row.spec_key, width: row.width, height: row.height,
    mimeType: row.mime_type, storageRef: row.storage_ref, status: row.status,
  }
}

function mapPlatformCategoryMapping(row: PlatformCategoryMappingRow): PlatformCategoryMapping {
  return {
    id: row.id, businessAccountId: row.business_account_id, platform: row.platform,
    categoryId: row.category_id, externalCategoryId: row.external_category_id,
    externalPath: row.external_path, status: row.status,
  }
}

function mapPlatformAttributeMapping(row: PlatformAttributeMappingRow): PlatformAttributeMapping {
  return {
    id: row.id, businessAccountId: row.business_account_id, platform: row.platform,
    attributeKey: row.attribute_key, attributeName: row.attribute_name,
    externalAttributeKey: row.external_attribute_key,
    externalAttributeName: row.external_attribute_name,
    required: row.required === 1,
    valueMapping: row.value_mapping_json === null
      ? null
      : JSON.parse(row.value_mapping_json) as PlatformAttributeMapping['valueMapping'],
    status: row.status,
  }
}

function mapApprovalTask(row: ApprovalTaskRow): ApprovalTask {
  return {
    id: row.id, businessAccountId: row.business_account_id,
    targetType: row.target_type, targetId: row.target_id, taskType: row.task_type,
    status: row.status, reason: row.reason, assignedTo: row.assigned_to,
    createdAt: row.created_at, resolvedAt: row.resolved_at,
  }
}

export function createListingRepositories(db: DatabaseSync): ListingRepositories {
  const contentDrafts: ContentDraftRepository = {
    insert: async content => {
      db.prepare(`
        INSERT INTO content_drafts (
          id, business_account_id, product_id, content_type, language, version, body,
          generated_by, model, usage_record_id, status, reviewed_by, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        content.id, content.businessAccountId, content.productId, content.contentType,
        content.language, content.version, content.body, content.generatedBy,
        content.model, content.usageRecordId, content.status,
        content.reviewedBy, content.reviewedAt,
      )
    },
    findById: async (businessAccountId, id) => {
      const row = db.prepare(
        `SELECT * FROM content_drafts WHERE id = ? AND business_account_id = ? LIMIT 1`,
      ).get(id, businessAccountId) as unknown as ContentDraftRow | undefined
      return row === undefined ? undefined : mapContentDraft(row)
    },
    listByProduct: async (businessAccountId, productId) => {
      const rows = db.prepare(`
        SELECT * FROM content_drafts
        WHERE business_account_id = ? AND product_id = ?
        ORDER BY version DESC, id
      `).all(businessAccountId, productId) as unknown as ContentDraftRow[]
      return rows.map(mapContentDraft)
    },
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM content_drafts WHERE business_account_id = ? ORDER BY product_id, content_type, version DESC
      `).all(businessAccountId) as unknown as ContentDraftRow[]
      return rows.map(mapContentDraft)
    },
    update: async content => {
      db.prepare(`
        UPDATE content_drafts SET body = ?, status = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND business_account_id = ?
      `).run(
        content.body, content.status, content.reviewedBy, content.reviewedAt,
        content.id, content.businessAccountId,
      )
    },
  }

  const assessments: PlatformFitAssessmentRepository = {
    insert: async assessment => {
      db.prepare(`
        INSERT INTO platform_fit_assessments (
          id, business_account_id, product_id, store_id, platform, result,
          category_mapping_id, compliance_status, media_status, price_status,
          risk_score, findings_json, status, assessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assessment.id, assessment.businessAccountId, assessment.productId,
        assessment.storeId, assessment.platform, assessment.result,
        assessment.categoryMappingId, assessment.complianceStatus,
        assessment.mediaStatus, assessment.priceStatus, assessment.riskScore,
        JSON.stringify(assessment.findings), assessment.status, assessment.assessedAt,
      )
    },
    findById: async (businessAccountId, id) => {
      const row = db.prepare(`
        SELECT * FROM platform_fit_assessments WHERE id = ? AND business_account_id = ? LIMIT 1
      `).get(id, businessAccountId) as unknown as AssessmentRow | undefined
      return row === undefined ? undefined : mapAssessment(row)
    },
    updateStatus: async (businessAccountId, id, status) => {
      db.prepare(`UPDATE platform_fit_assessments SET status = ? WHERE id = ? AND business_account_id = ?`)
        .run(status, id, businessAccountId)
    },
  }

  const drafts: ListingDraftRepository = {
    insert: async draft => {
      db.prepare(`
        INSERT INTO listing_drafts (
          id, business_account_id, product_id, store_id, platform,
          platform_fit_assessment_id, title_content_draft_id, description_content_draft_id,
          bullets_content_draft_id, keywords_content_draft_id, title, description,
          bullets_json, keywords_json, platform_category_id, attributes_json,
          price_minor, currency, stock_qty, media_variant_ids_json, status,
          validation_result_json, approved_by, approved_at, last_synced_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        draft.id, draft.businessAccountId, draft.productId, draft.storeId, draft.platform,
        draft.platformFitAssessmentId, draft.titleContentDraftId,
        draft.descriptionContentDraftId, draft.bulletsContentDraftId,
        draft.keywordsContentDraftId, draft.title, draft.description,
        JSON.stringify(draft.bullets), JSON.stringify(draft.keywords),
        draft.platformCategoryId, JSON.stringify(draft.attributes), draft.priceMinor,
        draft.currency, draft.stockQty, JSON.stringify(draft.mediaVariantIds), draft.status,
        draft.validationResult === null ? null : JSON.stringify(draft.validationResult),
        draft.approvedBy, draft.approvedAt, draft.lastSyncedAt, draft.createdAt, draft.updatedAt,
      )
    },
    findById: async (businessAccountId, id) => {
      const row = db.prepare(`
        SELECT * FROM listing_drafts WHERE id = ? AND business_account_id = ? LIMIT 1
      `).get(id, businessAccountId) as unknown as ListingDraftRow | undefined
      return row === undefined ? undefined : mapListingDraft(row)
    },
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM listing_drafts WHERE business_account_id = ?
        ORDER BY created_at DESC, id DESC
      `).all(businessAccountId) as unknown as ListingDraftRow[]
      return rows.map(mapListingDraft)
    },
    update: async draft => {
      db.prepare(`
        UPDATE listing_drafts SET
          platform_fit_assessment_id = ?, title_content_draft_id = ?, description_content_draft_id = ?,
          bullets_content_draft_id = ?, keywords_content_draft_id = ?, title = ?,
          description = ?, bullets_json = ?, keywords_json = ?, platform_category_id = ?,
          attributes_json = ?, price_minor = ?, currency = ?, stock_qty = ?,
          media_variant_ids_json = ?, status = ?, validation_result_json = ?,
          approved_by = ?, approved_at = ?, last_synced_at = ?, updated_at = ?
        WHERE id = ? AND business_account_id = ?
      `).run(
        draft.platformFitAssessmentId, draft.titleContentDraftId, draft.descriptionContentDraftId,
        draft.bulletsContentDraftId, draft.keywordsContentDraftId, draft.title,
        draft.description, JSON.stringify(draft.bullets), JSON.stringify(draft.keywords),
        draft.platformCategoryId, JSON.stringify(draft.attributes), draft.priceMinor,
        draft.currency, draft.stockQty, JSON.stringify(draft.mediaVariantIds), draft.status,
        draft.validationResult === null ? null : JSON.stringify(draft.validationResult),
        draft.approvedBy, draft.approvedAt, draft.lastSyncedAt, draft.updatedAt,
        draft.id, draft.businessAccountId,
      )
    },
  }

  const contentLinks: ListingDraftContentLinkRepository = {
    insert: async link => {
      db.prepare(`
        INSERT INTO listing_draft_content_links (
          id, business_account_id, listing_draft_id, content_draft_id, content_type, is_selected
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        link.id, link.businessAccountId, link.listingDraftId, link.contentDraftId,
        link.contentType, link.isSelected ? 1 : 0,
      )
    },
    listByListingDraft: async (businessAccountId, listingDraftId) => {
      const rows = db.prepare(`
        SELECT * FROM listing_draft_content_links
        WHERE business_account_id = ? AND listing_draft_id = ?
        ORDER BY content_type, content_draft_id
      `).all(businessAccountId, listingDraftId) as unknown as ContentLinkRow[]
      return rows.map(mapContentLink)
    },
    deselectByType: async (businessAccountId, listingDraftId, contentType: ListingContentType) => {
      db.prepare(`
        UPDATE listing_draft_content_links SET is_selected = 0
        WHERE business_account_id = ? AND listing_draft_id = ? AND content_type = ?
      `).run(businessAccountId, listingDraftId, contentType)
    },
    select: async (businessAccountId, listingDraftId, contentDraftId, contentType) => {
      const result = db.prepare(`
        UPDATE listing_draft_content_links SET is_selected = 1
        WHERE business_account_id = ? AND listing_draft_id = ? AND content_draft_id = ? AND content_type = ?
      `).run(businessAccountId, listingDraftId, contentDraftId, contentType)
      if ((result as unknown as { changes?: number }).changes === 0) {
        db.prepare(`
          INSERT INTO listing_draft_content_links (
            id, business_account_id, listing_draft_id, content_draft_id, content_type, is_selected
          ) VALUES (?, ?, ?, ?, ?, 1)
        `).run(`${listingDraftId}:${contentType}:${contentDraftId}`, businessAccountId,
          listingDraftId, contentDraftId, contentType)
      }
    },
  }

  const manualPackages: ManualListingPackageRepository = {
    insert: async pkg => {
      db.prepare(`
        INSERT INTO manual_listing_packages (
          id, business_account_id, listing_draft_id, product_id, store_id,
          file_ref, payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pkg.id, pkg.businessAccountId, pkg.listingDraftId, pkg.productId, pkg.storeId,
        pkg.fileRef, pkg.payloadJson, pkg.createdBy, pkg.createdAt,
      )
    },
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM manual_listing_packages WHERE business_account_id = ?
        ORDER BY created_at DESC, id DESC
      `).all(businessAccountId) as unknown as ManualPackageRow[]
      return rows.map(mapManualPackage)
    },
  }

  const products: ListingProductSource = {
    findByProductId: async (businessAccountId, productId) => {
      const row = db.prepare(`
        SELECT
          p.id, p.business_account_id, p.sourcing_item_id, p.created_from_selection_id,
          p.title, p.core_category_id, p.currency, p.risk_status, p.status,
          p.created_at, p.updated_at, v.sku, v.purchase_price_minor,
          v.id AS variant_id, v.attributes_json,
          si.description_raw, si.category_labels_json, si.image_urls_json,
          si.suggested_retail_price_minor, si.stock_status
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id
        LEFT JOIN sourcing_items si ON si.id = p.sourcing_item_id
        WHERE p.id = ? AND p.business_account_id = ?
        ORDER BY v.id
        LIMIT 1
      `).get(productId, businessAccountId) as unknown as ProductContextRow | undefined
      return row === undefined ? undefined : mapProductContext(row)
    },
  }

  const draftVariants: ListingDraftVariantRepository = {
    insert: async variant => {
      db.prepare(`
        INSERT INTO listing_draft_variants (
          id, business_account_id, listing_draft_id, product_variant_id,
          platform_variant_key, external_variant_id, attributes_json,
          price_minor, currency, stock_qty, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        variant.id, variant.businessAccountId, variant.listingDraftId,
        variant.productVariantId, variant.platformVariantKey, variant.externalVariantId,
        JSON.stringify(variant.attributes), variant.priceMinor, variant.currency,
        variant.stockQty, variant.status,
      )
    },
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM listing_draft_variants WHERE business_account_id = ? ORDER BY listing_draft_id, id
      `).all(businessAccountId) as unknown as ListingDraftVariantRow[]
      return rows.map(mapListingDraftVariant)
    },
    listByListingDraft: async (businessAccountId, listingDraftId) => {
      const rows = db.prepare(`
        SELECT * FROM listing_draft_variants
        WHERE business_account_id = ? AND listing_draft_id = ? ORDER BY id
      `).all(businessAccountId, listingDraftId) as unknown as ListingDraftVariantRow[]
      return rows.map(mapListingDraftVariant)
    },
    update: async variant => {
      db.prepare(`
        UPDATE listing_draft_variants SET
          external_variant_id = ?, attributes_json = ?, price_minor = ?,
          currency = ?, stock_qty = ?, status = ?
        WHERE id = ? AND business_account_id = ?
      `).run(
        variant.externalVariantId, JSON.stringify(variant.attributes), variant.priceMinor,
        variant.currency, variant.stockQty, variant.status, variant.id,
        variant.businessAccountId,
      )
    },
  }

  const mediaAssets: MediaAssetRepository = {
    insert: async asset => {
      db.prepare(`
        INSERT INTO media_assets (
          id, business_account_id, owner_type, owner_id, media_type, source_type,
          storage_ref, mime_type, checksum, width, height, rights_status, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        asset.id, asset.businessAccountId, asset.ownerType, asset.ownerId,
        asset.mediaType, asset.sourceType, asset.storageRef, asset.mimeType,
        asset.checksum, asset.width, asset.height, asset.rightsStatus, asset.status,
      )
    },
    findById: async (businessAccountId, id) => {
      const row = db.prepare(
        `SELECT * FROM media_assets WHERE id = ? AND business_account_id = ? LIMIT 1`,
      ).get(id, businessAccountId) as unknown as MediaAssetRow | undefined
      return row === undefined ? undefined : mapMediaAsset(row)
    },
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM media_assets WHERE business_account_id = ? ORDER BY owner_id, id
      `).all(businessAccountId) as unknown as MediaAssetRow[]
      return rows.map(mapMediaAsset)
    },
    update: async asset => {
      db.prepare(`
        UPDATE media_assets SET rights_status = ?, status = ?
        WHERE id = ? AND business_account_id = ?
      `).run(asset.rightsStatus, asset.status, asset.id, asset.businessAccountId)
    },
  }

  const mediaVariants: MediaVariantRepository = {
    insert: async variant => {
      db.prepare(`
        INSERT INTO media_variants (
          id, business_account_id, media_asset_id, platform, purpose, spec_key,
          width, height, mime_type, storage_ref, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        variant.id, variant.businessAccountId, variant.mediaAssetId, variant.platform,
        variant.purpose, variant.specKey, variant.width, variant.height,
        variant.mimeType, variant.storageRef, variant.status,
      )
    },
    findById: async (businessAccountId, id) => {
      const row = db.prepare(
        `SELECT * FROM media_variants WHERE id = ? AND business_account_id = ? LIMIT 1`,
      ).get(id, businessAccountId) as unknown as MediaVariantRow | undefined
      return row === undefined ? undefined : mapMediaVariant(row)
    },
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM media_variants WHERE business_account_id = ? ORDER BY media_asset_id, id
      `).all(businessAccountId) as unknown as MediaVariantRow[]
      return rows.map(mapMediaVariant)
    },
    listByOwner: async (businessAccountId, ownerType, ownerId) => {
      const rows = db.prepare(`
        SELECT mv.* FROM media_variants mv
        JOIN media_assets ma ON ma.id = mv.media_asset_id AND ma.business_account_id = mv.business_account_id
        WHERE mv.business_account_id = ? AND ma.owner_type = ? AND ma.owner_id = ?
        ORDER BY mv.id
      `).all(businessAccountId, ownerType, ownerId) as unknown as MediaVariantRow[]
      return rows.map(mapMediaVariant)
    },
  }

  const categoryMappings: PlatformCategoryMappingRepository = {
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM platform_category_mappings WHERE business_account_id = ? ORDER BY platform, category_id
      `).all(businessAccountId) as unknown as PlatformCategoryMappingRow[]
      return rows.map(mapPlatformCategoryMapping)
    },
    upsert: async mapping => {
      db.prepare(`
        INSERT INTO platform_category_mappings (
          id, business_account_id, platform, category_id, external_category_id,
          external_path, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(business_account_id, platform, category_id) DO UPDATE SET
          external_category_id = excluded.external_category_id,
          external_path = excluded.external_path,
          status = excluded.status
      `).run(
        mapping.id, mapping.businessAccountId, mapping.platform, mapping.categoryId,
        mapping.externalCategoryId, mapping.externalPath, mapping.status,
      )
    },
    findByCategory: async (businessAccountId, platform, categoryId) => {
      const row = db.prepare(`
        SELECT * FROM platform_category_mappings
        WHERE business_account_id = ? AND platform = ? AND category_id = ? LIMIT 1
      `).get(businessAccountId, platform, categoryId) as unknown as PlatformCategoryMappingRow | undefined
      return row === undefined ? undefined : mapPlatformCategoryMapping(row)
    },
  }

  const attributeMappings: PlatformAttributeMappingRepository = {
    upsert: async mapping => {
      db.prepare(`
        INSERT INTO platform_attribute_mappings (
          id, business_account_id, platform, attribute_key, attribute_name,
          external_attribute_key, external_attribute_name, required,
          value_mapping_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(business_account_id, platform, attribute_key) DO UPDATE SET
          attribute_name = excluded.attribute_name,
          external_attribute_key = excluded.external_attribute_key,
          external_attribute_name = excluded.external_attribute_name,
          required = excluded.required,
          value_mapping_json = excluded.value_mapping_json,
          status = excluded.status
      `).run(
        mapping.id, mapping.businessAccountId, mapping.platform, mapping.attributeKey,
        mapping.attributeName, mapping.externalAttributeKey, mapping.externalAttributeName,
        mapping.required ? 1 : 0,
        mapping.valueMapping === null ? null : JSON.stringify(mapping.valueMapping),
        mapping.status,
      )
    },
    listByPlatform: async (businessAccountId, platform) => {
      const rows = db.prepare(`
        SELECT * FROM platform_attribute_mappings
        WHERE business_account_id = ? AND platform = ? ORDER BY attribute_key
      `).all(businessAccountId, platform) as unknown as PlatformAttributeMappingRow[]
      return rows.map(mapPlatformAttributeMapping)
    },
  }

  const approvalTasks: ApprovalTaskRepository = {
    insert: async task => {
      db.prepare(`
        INSERT INTO approval_tasks (
          id, business_account_id, target_type, target_id, task_type, status,
          reason, assigned_to, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id, task.businessAccountId, task.targetType, task.targetId,
        task.taskType, task.status, task.reason, task.assignedTo,
        task.createdAt, task.resolvedAt,
      )
    },
    findById: async (businessAccountId, id) => {
      const row = db.prepare(
        `SELECT * FROM approval_tasks WHERE id = ? AND business_account_id = ? LIMIT 1`,
      ).get(id, businessAccountId) as unknown as ApprovalTaskRow | undefined
      return row === undefined ? undefined : mapApprovalTask(row)
    },
    findPendingByTarget: async (businessAccountId, targetType, targetId, taskType) => {
      const row = db.prepare(`
        SELECT * FROM approval_tasks
        WHERE business_account_id = ? AND target_type = ? AND target_id = ?
          AND task_type = ? AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1
      `).get(businessAccountId, targetType, targetId, taskType) as unknown as ApprovalTaskRow | undefined
      return row === undefined ? undefined : mapApprovalTask(row)
    },
    list: async businessAccountId => {
      const rows = db.prepare(`
        SELECT * FROM approval_tasks WHERE business_account_id = ? ORDER BY created_at DESC, id DESC
      `).all(businessAccountId) as unknown as ApprovalTaskRow[]
      return rows.map(mapApprovalTask)
    },
    update: async task => {
      db.prepare(`
        UPDATE approval_tasks SET status = ?, reason = ?, assigned_to = ?, resolved_at = ?
        WHERE id = ? AND business_account_id = ?
      `).run(task.status, task.reason, task.assignedTo, task.resolvedAt, task.id, task.businessAccountId)
    },
  }

  return {
    contentDrafts, assessments, drafts, contentLinks,
    draftVariants, mediaAssets, mediaVariants, categoryMappings, attributeMappings,
    approvalTasks, manualPackages, products,
  }
}
