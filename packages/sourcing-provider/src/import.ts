/** S2.2 CSV import contract (09 §3; PHASE1_TECH_DESIGN §9). */
import { createHash } from 'node:crypto'
import type {
  Clock,
  DataSource,
  IdGenerator,
  SourcingImportBatch,
  SourcingImportRowError,
  SourcingItem,
  SourcingItemMedia,
  SourcingItemQualification,
  SourceRecord,
  Supplier,
} from '@toneclaw/core-domain'
import { parseCsvRecords, stripUtf8Bom } from './csv.ts'

export const IMPORT_HEADERS = [
  'sourceId',
  'supplierName',
  'supplierUrl',
  'title',
  'description',
  'categoryCandidate',
  'costPrice',
  'currency',
  'moq',
  'supplyAbility',
  'imageUrls',
  'skuAttributesJson',
  'complianceJson',
  'suggestedRetailPrice',
  'stockQty',
  'leadTimeDays',
] as const

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_DATA_ROWS = 5000
const MAX_ROW_BYTES = 1024 * 1024
const SKU_MISSING = 'SKU_MISSING'

export interface SourcingImportOptions {
  workspaceId: string
  createdBy: string
  fileName: string
  fileRefDirectory: string
  country: string
  sourceBatchId?: string
  ids: IdGenerator
  clock: Clock
}

export interface SourcingImportPlan {
  batch: SourcingImportBatch
  dataSource: DataSource
  suppliers: Supplier[]
  items: SourcingItem[]
  sourceRecords: SourceRecord[]
  media: SourcingItemMedia[]
  qualifications: SourcingItemQualification[]
}

export interface SourcingImportReport {
  batchId: string
  status: SourcingImportBatch['status']
  fileName: string
  fingerprint: string
  totalRows: number
  validRows: number
  failedRows: number
  warningRows: number
  duplicateChecksumCount: number
  errors: SourcingImportBatch['errors']
  warnings: { rowIndex: number; code: string; message: string }[]
}

export interface SourcingImportParseResult {
  plan: SourcingImportPlan
  report: Omit<SourcingImportReport, 'duplicateChecksumCount'>
}

interface RowWarnings {
  rowIndex: number
  entries: { code: string; message: string }[]
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Build the whole-batch rejection used for size/header failures. */
export function rejectedSourcingImport(
  bytes: Uint8Array,
  options: SourcingImportOptions,
  errorCode: string,
  reason: string,
): SourcingImportParseResult {
  const now = options.clock.now().toISOString()
  const batchId = options.ids.next()
  const fingerprint = fingerprintBytes(bytes)
  const batch: SourcingImportBatch = {
    id: batchId,
    businessAccountId: options.workspaceId,
    format: 'csv',
    fileName: options.fileName,
    fileRef: `failed/${batchId}/${options.fileName}`,
    fingerprint,
    sourceBatchId: options.sourceBatchId ?? null,
    totalRows: 0,
    validRows: 0,
    failedRows: 0,
    warningRows: 0,
    status: 'failed',
    errors: [{ rowIndex: null, errorCodes: [errorCode], reason, rawCsvLine: null }],
    createdAt: now,
    createdBy: options.createdBy,
  }
  return {
    plan: {
      batch,
      dataSource: dataSourceFor(batch, options),
      suppliers: [],
      items: [],
      sourceRecords: [],
      media: [],
      qualifications: [],
    },
    report: {
      batchId,
      status: batch.status,
      fileName: options.fileName,
      fingerprint,
      totalRows: 0,
      validRows: 0,
      failedRows: 0,
      warningRows: 0,
      errors: batch.errors,
      warnings: [],
    },
  }
}

/** Validate and map CSV bytes to a transaction-ready domain write plan. */
export function parseSourcingCsv(
  bytes: Uint8Array,
  options: SourcingImportOptions,
): SourcingImportParseResult {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return rejectedSourcingImport(bytes, options, 'FILE_TOO_LARGE', 'file exceeds 50 MiB')
  }
  const text = stripUtf8Bom(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
  const records = parseCsvRecords(text)
  const header = records.shift() ?? []
  if (!headerMatches(header)) {
    return rejectedSourcingImport(bytes, options, 'HEADER_MISMATCH', 'CSV header does not match the P0 catalog template')
  }
  if (records.length > MAX_DATA_ROWS) {
    return rejectedSourcingImport(bytes, options, 'FILE_TOO_LARGE', 'file exceeds 5000 data rows')
  }
  const now = options.clock.now().toISOString()
  const batchId = options.ids.next()
  const fingerprint = fingerprintBytes(bytes)
  const batch: SourcingImportBatch = {
    id: batchId,
    businessAccountId: options.workspaceId,
    format: 'csv',
    fileName: options.fileName,
    fileRef: `processed/${batchId}/${options.fileName}`,
    fingerprint,
    sourceBatchId: options.sourceBatchId ?? null,
    totalRows: Math.min(records.length, MAX_DATA_ROWS),
    validRows: 0,
    failedRows: 0,
    warningRows: 0,
    status: 'completed',
    errors: [],
    createdAt: now,
    createdBy: options.createdBy,
  }
  const dataSource = dataSourceFor(batch, options)
  const suppliersByNormalized = new Map<string, Supplier>()
  const supplierCurrency = new Map<string, Set<string>>()
  const seenSourceIds = new Set<string>()
  const seenSupplierUrls = new Map<string, number>()
  const items: SourcingItem[] = []
  const sourceRecords: SourceRecord[] = []
  const media: SourcingItemMedia[] = []
  const qualifications: SourcingItemQualification[] = []
  const warnings: RowWarnings[] = []
  const supplierIds = new Map<string, string>()

  for (const [dataIndex, record] of records.entries()) {
    if (dataIndex >= MAX_DATA_ROWS) break
    const rowIndex = dataIndex + 2
    if (new TextEncoder().encode(record.join(',')).byteLength > MAX_ROW_BYTES) {
      batch.failedRows += 1
      batch.errors.push(rowError(rowIndex, ['ROW_TOO_LONG'], 'row exceeds 1 MiB', record))
      continue
    }
    const raw = rawRecord(header, record)
    const errors: string[] = []
    const rowWarnings: { code: string; message: string }[] = []

    const sourceId = normalizeText(raw['sourceId'])
    if (sourceId !== null) {
      if (sourceId === '' || sourceId.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(sourceId)) {
        errors.push('MISSING_REQUIRED')
      } else if (seenSourceIds.has(sourceId)) {
        errors.push('DUPLICATE_SOURCE_ID')
      } else seenSourceIds.add(sourceId)
    }

    const supplierName = normalizeText(raw['supplierName'])
    if (supplierName === null || supplierName === '' || supplierName.length > 120) errors.push('MISSING_REQUIRED')
    const supplierUrl = normalizeUrl(raw['supplierUrl'])
    if (supplierUrl === null) {
      errors.push('INVALID_URL')
    } else {
      const previous = seenSupplierUrls.get(supplierUrl) ?? 0
      seenSupplierUrls.set(supplierUrl, previous + 1)
      if (previous > 0) {
        rowWarnings.push({
          code: 'DUPLICATE_SUPPLIER_URL',
          message: `supplier URL also appears on row ${String(seenSupplierUrls.get(supplierUrl))}`,
        })
      }
    }

    const title = normalizeText(raw['title'])
    if (title === null || title === '' || title.length > 200) errors.push('MISSING_REQUIRED')
    const description = cleanDescription(raw['description'])
    if (description !== null && description.length > 5000) errors.push('MISSING_REQUIRED')

    const categoryLabels = splitCategories(raw['categoryCandidate'])
    if (categoryLabels === null) errors.push('MISSING_REQUIRED')

    const purchasePriceMinor = priceToMinor(raw['costPrice'])
    if (purchasePriceMinor === null) errors.push('INVALID_PRICE')
    const currency = normalizeCurrency(raw['currency'])
    if (currency === null) errors.push('INVALID_CURRENCY')
    const moq = optionalPositiveInteger(raw['moq'], 1, 1_000_000)
    if (raw['moq'] !== '' && moq === null) errors.push('INVALID_PRICE')
    const supplyAbility = optionalPositiveInteger(raw['supplyAbility'], 1, Number.MAX_SAFE_INTEGER)
    if (raw['supplyAbility'] !== '' && supplyAbility === null) errors.push('INVALID_PRICE')
    const suggestedRetailPriceMinor = optionalPriceToMinor(raw['suggestedRetailPrice'])
    if (raw['suggestedRetailPrice'] !== '' && suggestedRetailPriceMinor === null) errors.push('INVALID_PRICE')
    const stockQty = optionalNonNegativeInteger(raw['stockQty'])
    if (raw['stockQty'] !== '' && stockQty === null) errors.push('INVALID_PRICE')
    const leadTimeDays = optionalPositiveInteger(raw['leadTimeDays'], 1, 3650)
    if (raw['leadTimeDays'] !== '' && leadTimeDays === null) errors.push('INVALID_PRICE')

    const imageUrls = parseImageUrls(raw['imageUrls'])
    if (imageUrls === null || imageUrls.length === 0) errors.push('INVALID_IMAGE_URL')
    const parsedSku = parseSkuAttributes(raw['skuAttributesJson'])
    if (parsedSku === 'invalid') errors.push('INVALID_SKU_JSON')
    const parsedCompliance = parseJsonObject(raw['complianceJson'])
    if (parsedCompliance === 'invalid') errors.push('INVALID_SKU_JSON')
    if (parsedSku === 'missing') {
      rowWarnings.push({ code: SKU_MISSING, message: 'SKU attributes absent; a default variant will be created later' })
    }

    if (errors.length > 0 || supplierName === null || title === null || currency === null
      || purchasePriceMinor === null || imageUrls === null || supplierUrl === null) {
      batch.failedRows += 1
      batch.errors.push(rowError(
        rowIndex,
        errors.length > 0 ? errors : ['MISSING_REQUIRED'],
        'row failed catalog validation',
        record,
      ))
      continue
    }

    const normalizedSupplier = supplierName.trim().replace(/\s+/g, ' ').toLowerCase()
    let supplier = suppliersByNormalized.get(normalizedSupplier)
    if (supplier === undefined) {
      supplier = {
        id: options.ids.next(),
        businessAccountId: options.workspaceId,
        name: supplierName.trim(),
        nameNormalized: normalizedSupplier,
        supplierUrl,
        code: null,
        country: options.country,
        contactName: null,
        contactChannel: null,
        defaultCurrency: currency,
        status: 'active',
        rating: null,
        notes: null,
      }
      suppliersByNormalized.set(normalizedSupplier, supplier)
      supplierCurrency.set(normalizedSupplier, new Set([currency]))
    } else {
      supplierCurrency.get(normalizedSupplier)?.add(currency)
      if (supplier.supplierUrl !== supplierUrl) {
        rowWarnings.push({ code: 'SUPPLIER_URL_VARIATION', message: 'supplier name repeats with another catalog URL' })
      }
    }
    const supplierId = supplier.id
    const currencies = supplierCurrency.get(normalizedSupplier)
    if (currencies !== undefined && currencies.size > 1 && supplier.defaultCurrency !== currency) {
      rowWarnings.push({ code: 'SUPPLIER_CURRENCY_MISMATCH', message: `supplier default currency remains ${supplier.defaultCurrency}` })
    }

    const externalSourceId = sourceId === '' ? sha256(`${supplierUrl}\n${title.trim().toLowerCase()}`) : sourceId
    const itemId = options.ids.next()
    const sourceRecordId = options.ids.next()
    const checksumInput = JSON.stringify({
      sourceId: externalSourceId,
      supplierName: normalizedSupplier,
      supplierUrl,
      title,
      description,
      categoryLabels,
      purchasePriceMinor,
      currency,
      moq,
      supplyAbility,
      imageUrls,
      skuAttributesJson: parsedSku === 'missing' ? null : JSON.stringify(parsedSku),
      complianceJson: parsedCompliance === 'missing' ? null : JSON.stringify(parsedCompliance),
      suggestedRetailPriceMinor,
      stockQty,
      leadTimeDays,
    })
    const checksum = sha256(checksumInput)
    const item: SourcingItem = {
      id: itemId,
      businessAccountId: options.workspaceId,
      supplierId,
      dataSourceId: dataSource.id,
      sourceRecordId,
      externalSourceId,
      title,
      descriptionRaw: description,
      categoryLabels: categoryLabels ?? [],
      currency,
      purchasePriceMinor,
      suggestedRetailPriceMinor,
      moq,
      leadTimeDays,
      stockStatus: stockQty === null ? 'unknown' : stockQty === 0 ? 'out_of_stock' : stockQty <= 10 ? 'low' : 'available',
      supplyStatus: 'active',
      riskStatus: 'unknown',
      status: 'candidate',
      imageUrls,
      skuAttributesJson: parsedSku === 'missing' ? null : JSON.stringify(parsedSku),
      complianceJson: parsedCompliance === 'missing' ? null : JSON.stringify(parsedCompliance),
      createdAt: now,
      updatedAt: now,
    }
    items.push(item)
    sourceRecords.push({
      id: sourceRecordId,
      businessAccountId: options.workspaceId,
      dataSourceId: dataSource.id,
      sourcingItemId: itemId,
      externalId: sourceId === '' ? null : sourceId,
      rawPayloadRef: `${batch.fileRef}#${String(rowIndex)}`,
      checksum,
      importedAt: now,
    })
    imageUrls.forEach((url, index) => {
      media.push({
        id: options.ids.next(),
        sourcingItemId: itemId,
        mediaType: 'image',
        purpose: index === 0 ? 'main' : 'detail',
        storageRef: url,
        sourceUrl: url,
        checksum: sha256(url),
        rightsStatus: 'unknown',
        status: 'imported',
      })
    })
    if (parsedCompliance !== 'invalid' && parsedCompliance !== 'missing') {
      for (const [type, value] of Object.entries(parsedCompliance)) {
        qualifications.push({
          id: options.ids.next(),
          sourcingItemId: itemId,
          qualificationType: type,
          fileRef: typeof value === 'string' ? value : JSON.stringify(value),
          status: 'unknown',
          issuedBy: null,
          issuedAt: null,
          expiresAt: null,
        })
      }
    }
    supplierIds.set(normalizedSupplier, supplierId)
    batch.validRows += 1
    if (rowWarnings.length > 0) {
      batch.warningRows += 1
      warnings.push({ rowIndex, entries: rowWarnings })
    }
  }

  batch.status = batch.failedRows > 0 ? 'partially_completed' : 'completed'
  return {
    plan: {
      batch,
      dataSource,
      suppliers: [...suppliersByNormalized.values()],
      items,
      sourceRecords,
      media,
      qualifications,
    },
    report: {
      batchId,
      status: batch.status,
      fileName: options.fileName,
      fingerprint,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      failedRows: batch.failedRows,
      warningRows: batch.warningRows,
      errors: batch.errors,
      warnings: warnings.flatMap(warning => warning.entries.map(entry => ({
        rowIndex: warning.rowIndex,
        code: entry.code,
        message: entry.message,
      }))),
    },
  }
}

function dataSourceFor(batch: SourcingImportBatch, options: SourcingImportOptions): DataSource {
  return {
    id: options.ids.next(),
    businessAccountId: options.workspaceId,
    type: 'csv',
    name: options.fileName,
    configRef: null,
    status: batch.status === 'failed' ? 'error' : 'active',
    lastSyncedAt: batch.createdAt,
  }
}

function headerMatches(header: string[]): boolean {
  return header.length === IMPORT_HEADERS.length
    && IMPORT_HEADERS.every((expected, index) => header[index] === expected)
}

function rawRecord(header: string[], record: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  IMPORT_HEADERS.forEach((name, index) => {
    result[name] = record[index] ?? ''
  })
  return result
}

function rowError(
  rowIndex: number,
  errorCodes: string[],
  reason: string,
  record: string[],
): SourcingImportRowError {
  return {
    rowIndex,
    errorCodes,
    reason,
    rawCsvLine: JSON.stringify(record),
  }
}

function normalizeText(value: string | undefined): string | null {
  if (value === undefined) return null
  return value.replace(/\u0000/g, '').trim()
}

function cleanDescription(value: string | undefined): string | null {
  if (value === undefined) return null
  return normalizeText(value.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, ''))
}

function splitCategories(value: string | undefined): string[] | null {
  if (value === undefined) return null
  const labels = value.split(';').map(label => label.trim()).filter(label => label !== '')
  return labels.length > 10 ? null : labels
}

function normalizeUrl(value: string | undefined): string | null {
  if (value === undefined) return null
  const candidate = value.trim()
  if (candidate === '' || candidate.length > 2048) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username !== '' || url.password !== '') return null
    if (url.port === '80' || url.port === '443') url.port = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function normalizeCurrency(value: string | undefined): string | null {
  const candidate = value?.trim() ?? ''
  return /^[A-Z]{3}$/.test(candidate) ? candidate : null
}

function priceToMinor(value: string | undefined): number | null {
  const parsed = parsePrice(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function optionalPriceToMinor(value: string | undefined): number | null {
  const parsed = parsePrice(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function parsePrice(value: string | undefined): number | null {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return null
  if (!/^\d+(?:\.\d{1,2})?$/.test(candidate)) return null
  const [wholeText = '', fractionText = ''] = candidate.split('.')
  const minor = Number(wholeText) * 100 + Number((fractionText + '00').slice(0, 2))
  return Number.isSafeInteger(minor) && minor <= 100_000_000 ? minor : null
}

function optionalPositiveInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | null {
  return boundedInteger(value, minimum, maximum)
}

function optionalNonNegativeInteger(value: string | undefined): number | null {
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER)
}

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | null {
  const candidate = value?.trim() ?? ''
  if (candidate === '') return null
  if (!/^\d+$/.test(candidate)) return null
  const parsed = Number(candidate)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function parseImageUrls(value: string | undefined): string[] | null {
  if (value === undefined) return null
  const candidates = value.split(';').map(entry => entry.trim()).filter(entry => entry !== '')
  if (candidates.length < 1 || candidates.length > 10) return null
  const urls: string[] = []
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate)
    const extension = url === null ? '' : new URL(url).pathname.toLowerCase()
    if (url === null || !/\.(?:jpg|jpeg|png|webp)$/.test(extension)) return null
    urls.push(url)
  }
  return urls
}

type ParsedJson<T> = 'missing' | 'invalid' | T

function parseSkuAttributes(value: string | undefined): ParsedJson<Array<{ sku: string; optionValues: Record<string, unknown> }>> {
  if (value === undefined || value.trim() === '') return 'missing'
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0) return 'invalid'
    const seen = new Set<string>()
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) return 'invalid'
      const record = entry as Record<string, unknown>
      const sku = record['sku']
      if (typeof sku !== 'string' || sku.length < 1 || sku.length > 64 || seen.has(sku)) return 'invalid'
      if (typeof record['optionValues'] !== 'object' || record['optionValues'] === null || Array.isArray(record['optionValues'])) return 'invalid'
      seen.add(sku)
    }
    return parsed as Array<{ sku: string; optionValues: Record<string, unknown> }>
  } catch {
    return 'invalid'
  }
}

function parseJsonObject(value: string | undefined): ParsedJson<Record<string, unknown>> {
  if (value === undefined || value.trim() === '') return 'missing'
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'invalid'
    return parsed as Record<string, unknown>
  } catch {
    return 'invalid'
  }
}
