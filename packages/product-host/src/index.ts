/** Cordis plugin entry: assemble local product storage and run the S2 import watcher. */
import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  adoptListingContent,
  createProductFromSelection,
  decide,
  decideListingApproval,
  decidePublishConfirmation,
  editListingDraft,
  generateListingDraft,
  generateManualListingPackage,
  importManualListingResult,
  markListingPublishManualFallback,
  markManualPackageSubmitted,
  submitListingApproval,
  submitPublishConfirmation,
  updateMediaAsset,
  updatePlatformListingStatus,
  validateListingDraft,
  reopenSelection,
  type CommerceDeps,
  type SelectionDeps,
  type ListingDeps,
} from '@toneclaw/core-domain'
import { ProductStorage } from '@toneclaw/product-storage'
import { MockTemuAdapter } from '@toneclaw/marketplace-adapter-mock'
import { PlatformConnectionService } from './platform/connection-service.ts'
import { handlePlatformCommand } from './routes/platform.ts'
import { handleCommerceCommand } from './routes/commerce.ts'
import type { IdGenerator } from '@toneclaw/core-domain'
import {
  fingerprintBytes,
  parseSourcingCsv,
  type SourcingImportOptions,
  type SourcingImportParseResult,
  type SourcingImportPlan,
  type SourcingImportReport,
} from '@toneclaw/sourcing-provider'
import { normalizeProductHostConfig, type ProductHostConfig } from './config.ts'
import { writeSourcingSnapshot } from './snapshot.ts'

export const name = 'product-host'
export const inject: string[] = []
export { normalizeProductHostConfig, writeSourcingSnapshot }
export type { ProductHostConfig }
const PRODUCT_UI_ORIGIN = 'dsh-app://product-ui'
const MAX_COMMAND_BYTES = 64 * 1024

export interface ProductHostContext {
  logger?: {
    info?: (message: unknown, ...values: unknown[]) => void
    warn?: (message: unknown, ...values: unknown[]) => void
    error?: (message: unknown, ...values: unknown[]) => void
  }
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  productApi?: unknown
}

class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID()
  }
}

export function apply(ctx: ProductHostContext, config: unknown): () => void {
  const normalized = normalizeProductHostConfig(config)
  const host = new ProductImportHost(ctx, normalized)
  host.start()
  ;(ctx as { productApi?: unknown }).productApi = host.productApi()
  ctx.logger?.info?.(`[product-host] import watcher ready: ${normalized.importDir}`)
  return () => host.close()
}

export class ProductImportHost {
  private readonly storage: ProductStorage
  private readonly platform: PlatformConnectionService
  private readonly marketplaceAdapter = new MockTemuAdapter()
  private readonly commandToken = randomUUID()
  private watcher: FSWatcher | null = null
  private commandServer: Server | null = null
  private commandBaseUrl: string | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(
    private readonly context: ProductHostContext,
    private readonly config: ProductHostConfig,
  ) {
    mkdirSync(config.dataDir, { recursive: true })
    mkdirSync(config.importDir, { recursive: true })
    mkdirSync(join(config.importDir, 'processed'), { recursive: true })
    mkdirSync(join(config.importDir, 'failed'), { recursive: true })
    this.storage = new ProductStorage(config.dbPath)
    this.platform = new PlatformConnectionService(this.storage, new UuidGenerator(), {
      businessAccountId: config.workspaceId,
      actorId: config.createdBy,
    }, this.storage.audit)
  }

  start(): void {
    this.startCommandServer()
    void this.scanNow()
    try {
      this.watcher = watch(this.config.importDir, { persistent: true, recursive: false }, () => {
        this.enqueueScan()
      })
    } catch (error) {
      this.context.logger?.warn?.('[product-host] filesystem watch unavailable; using polling', error)
    }
    this.pollTimer = setInterval(() => { this.enqueueScan() }, this.config.pollIntervalMs)
    this.pollTimer.unref?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.watcher?.close()
    this.commandServer?.close()
    if (this.pollTimer !== null) clearInterval(this.pollTimer)
    this.storage.close()
  }

  /** Start a loopback-only command endpoint; the token is published only in the local snapshot. */
  startCommandServer(): void {
    if (this.commandServer !== null || this.closed) return
    const server = createServer((request, response) => {
      void this.handleCommandRequest(request, response).catch(error => {
        this.context.logger?.error?.('[product-host] command failed', error)
        if (!response.headersSent) sendCommandJson(response, 500, { error: 'internal command failure' })
        else response.end()
      })
    })
    server.on('error', error => {
      this.context.logger?.error?.('[product-host] command server failed', error)
    })
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (typeof address === 'object' && address !== null) {
        this.commandBaseUrl = `http://127.0.0.1:${String(address.port)}/api/v1`
        void this.writeSnapshot()
      }
    })
    this.commandServer = server
  }

  enqueueScan(): void {
    if (this.closed) return
    this.queue = this.queue.then(() => this.scanNow()).catch(error => {
      this.context.logger?.error?.('[product-host] import scan failed', error)
    })
  }

  /** Scan direct children once; processed and failed subdirectories are never re-imported. */
  async scanNow(): Promise<void> {
    const entries = await readdir(this.config.importDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.csv')) continue
      const path = join(this.config.importDir, entry.name)
      if (!(await this.isStable(path))) continue
      try {
        await this.processFile(path)
      } catch (error) {
        this.context.logger?.error?.(`[product-host] failed to import ${entry.name}`, error)
      }
    }
  }

  private async isStable(path: string): Promise<boolean> {
    const first = await stat(path)
    await new Promise(resolve => setTimeout(resolve, this.config.stabilityDelayMs))
    const second = await stat(path)
    return first.isFile() && second.isFile()
      && first.size === second.size
      && first.mtimeMs === second.mtimeMs
      && second.size > 0
  }

  private async processFile(path: string): Promise<void> {
    const fileName = basename(path)
    const bytes = await readFile(path)
    const fingerprint = fingerprintBytes(bytes)
    const existing = await this.storage.importBatches.findByIdempotency(
      this.config.workspaceId,
      this.config.createdBy,
      fingerprint,
    )
    if (existing !== undefined) {
      const target = join(this.config.importDir, 'processed', 'duplicates', `${Date.now()}-${fileName}`)
      mkdirSync(join(this.config.importDir, 'processed', 'duplicates'), { recursive: true })
      await moveFile(path, target)
      await this.writeReport({
        batchId: existing.id,
        status: existing.status,
        fileName,
        fingerprint,
        totalRows: existing.totalRows,
        validRows: existing.validRows,
        failedRows: existing.failedRows,
        warningRows: existing.warningRows,
        duplicateChecksumCount: 0,
        errors: existing.errors,
        warnings: [],
      })
      await this.writeSnapshot()
      return
    }

    const options: SourcingImportOptions = {
      workspaceId: this.config.workspaceId,
      createdBy: this.config.createdBy,
      fileName,
      fileRefDirectory: '',
      country: this.config.supplierCountry,
      ids: new UuidGenerator(),
      clock: { now: () => new Date() },
    }
    const parsed = parseSourcingCsv(bytes, options)
    if (parsed.plan.batch.status === 'failed') {
      await this.storage.applyRejectedImportBatch({
        batch: parsed.plan.batch,
        dataSource: parsed.plan.dataSource,
      })
      await this.writeReport(toReport(parsed, 0))
      await moveFile(path, join(this.config.importDir, parsed.plan.batch.fileRef))
      await this.writeSnapshot()
      return
    }

    const checksums = parsed.plan.sourceRecords.map(record => record.checksum)
    const duplicateChecksums = await this.storage.existingChecksums(this.config.workspaceId, checksums)
    const uniquePlan = filterDuplicateChecksums(parsed.plan, duplicateChecksums)
    await this.storage.applyImportBatch(uniquePlan)
    await this.writeReport(toReport(parsed, duplicateChecksums.size))
    await moveFile(path, join(this.config.importDir, parsed.plan.batch.fileRef))
    await this.writeSnapshot()
  }

  private async writeReport(report: SourcingImportReport): Promise<void> {
    const path = join(this.config.dataDir, `import-report-${report.batchId}.json`)
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  private writeSnapshot(): Promise<string> {
    return writeSourcingSnapshot(
      this.config.dataDir,
      this.storage,
      this.config.workspaceId,
      this.commandBaseUrl === null ? undefined : { baseUrl: this.commandBaseUrl, token: this.commandToken },
    )
  }

  private selectionDeps(): SelectionDeps {
    return {
      ids: new UuidGenerator(),
      clock: { now: () => new Date() },
      audit: this.storage.audit,
      items: this.storage.sourcingItems,
      decisions: this.storage.decisions,
      products: this.storage.products,
    }
  }

  private listingDeps(): ListingDeps {
    return {
      ...this.storage.listing,
      ids: new UuidGenerator(),
      clock: { now: () => new Date() },
      audit: this.storage.audit,
      stores: this.storage.stores,
      submitListing: async (storeId, payload) => {
        const submitted = await this.marketplaceAdapter.createListing(storeId, payload)
        if (submitted.externalListingId === null || submitted.submitted !== true) return submitted
        const status = await this.marketplaceAdapter.fetchListingStatus(
          storeId, submitted.externalListingId,
        )
        return { ...submitted, coreStatus: status.coreStatus }
      },
    }
  }

  private commerceDeps(): CommerceDeps {
    return {
      ids: new UuidGenerator(),
      clock: { now: () => new Date() },
      audit: this.storage.audit,
      stores: this.storage.stores,
      ...this.storage.commerce,
    }
  }

  private async connectedStoreId(storeId: unknown): Promise<string> {
    if (storeId !== undefined && storeId !== null && storeId !== '') return requireString(storeId, 'storeId')
    const stores = await this.storage.stores.list(this.config.workspaceId)
    const store = stores.find(candidate => candidate.platform === 'temu' && candidate.status === 'connected')
    if (store === undefined) throw new Error('no connected Temu store')
    return store.id
  }

  private async writeManualPackage(pkg: { fileRef: string; payloadJson: string }): Promise<void> {
    const path = join(this.config.dataDir, pkg.fileRef)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, pkg.payloadJson, 'utf8')
  }

  private async handleCommandRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin
    if (origin !== undefined && origin !== PRODUCT_UI_ORIGIN && origin !== 'null') {
      sendCommandJson(response, 403, { error: 'origin not allowed' })
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin === 'null' || origin === undefined ? '*' : origin)
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }
    if (request.method !== 'POST') {
      sendCommandJson(response, 405, { error: 'method not allowed' })
      return
    }
    if (request.headers.authorization !== `Bearer ${this.commandToken}`) {
      sendCommandJson(response, 401, { error: 'command token missing or invalid' })
      return
    }
    const contentLength = Number(request.headers['content-length'] ?? '0')
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_COMMAND_BYTES) {
      sendCommandJson(response, 413, { error: 'command body too large' })
      return
    }
    const body = await readCommandBody(request)
    let input: Record<string, unknown>
    try {
      input = JSON.parse(body) as Record<string, unknown>
    } catch {
      sendCommandJson(response, 400, { error: 'invalid command JSON' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    try {
      if (url.pathname === '/api/v1/selection/decisions') {
        const result = await decide(this.selectionDeps(), {
          workspaceId: this.config.workspaceId,
          sourcingItemId: requireString(input['sourcingItemId'], 'sourcingItemId'),
          decision: requireDecision(input['decision']),
          reason: requireString(input['reason'], 'reason'),
          decidedBy: 'user',
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, { itemId: result.item.id, status: result.item.status })
        return
      }
      if (url.pathname === '/api/v1/selection/reopen') {
        const item = await reopenSelection(this.selectionDeps(), {
          workspaceId: this.config.workspaceId,
          sourcingItemId: requireString(input['sourcingItemId'], 'sourcingItemId'),
          actorId: this.config.createdBy,
          reason: requireString(input['reason'], 'reason'),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, { itemId: item.id, status: item.status })
        return
      }
      if (url.pathname === '/api/v1/products/from-selection') {
        const result = await createProductFromSelection(this.selectionDeps(), {
          workspaceId: this.config.workspaceId,
          sourcingItemId: requireString(input['sourcingItemId'], 'sourcingItemId'),
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, result)
        return
      }
      if (url.pathname === '/api/v1/listings/generate') {
        const result = await generateListingDraft(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          productId: requireString(input['productId'], 'productId'),
          storeId: await this.connectedStoreId(input['storeId']),
          actorId: this.config.createdBy,
          ...(input['platformCategoryId'] === undefined ? {} : {
            platformCategoryId: requireString(input['platformCategoryId'], 'platformCategoryId'),
          }),
          ...(input['priceMinor'] === undefined ? {} : { priceMinor: requireInteger(input['priceMinor'], 'priceMinor') }),
          ...(input['stockQty'] === undefined ? {} : { stockQty: requireInteger(input['stockQty'], 'stockQty') }),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          listingDraftId: result.draft.id,
          status: result.draft.status,
          contentDraftIds: result.contentDrafts.map(content => content.id),
        })
        return
      }
      if (url.pathname === '/api/v1/listings/content/adopt') {
        const result = await adoptListingContent(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, { listingDraftId: result.id, status: result.status })
        return
      }
      if (url.pathname === '/api/v1/listings/edit') {
        const result = await editListingDraft(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
          ...(input['title'] === undefined ? {} : { title: requireString(input['title'], 'title') }),
          ...(input['description'] === undefined ? {} : { description: requireString(input['description'], 'description') }),
          ...(input['bullets'] === undefined ? {} : { bullets: requireStringArray(input['bullets'], 'bullets') }),
          ...(input['keywords'] === undefined ? {} : { keywords: requireStringArray(input['keywords'], 'keywords') }),
          ...(input['platformCategoryId'] === undefined ? {} : {
            platformCategoryId: requireString(input['platformCategoryId'], 'platformCategoryId'),
          }),
          ...(input['attributes'] === undefined ? {} : { attributes: requireAttributes(input['attributes']) }),
          ...(input['priceMinor'] === undefined ? {} : { priceMinor: requireInteger(input['priceMinor'], 'priceMinor') }),
          ...(input['stockQty'] === undefined ? {} : { stockQty: requireInteger(input['stockQty'], 'stockQty') }),
          ...(input['mediaVariantIds'] === undefined ? {} : {
            mediaVariantIds: requireStringArray(input['mediaVariantIds'], 'mediaVariantIds'),
          }),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, { listingDraftId: result.id, status: result.status })
        return
      }
      if (url.pathname === '/api/v1/listings/validate') {
        const result = await validateListingDraft(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, { status: result.status, findings: result.findings })
        return
      }
      if (url.pathname === '/api/v1/listings/approval/submit') {
        const result = await submitListingApproval(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          listingDraftId: result.draft.id,
          status: result.draft.status,
          approvalTaskId: result.task.id,
        })
        return
      }
      if (url.pathname === '/api/v1/listings/approval/decide') {
        const decision = input['decision']
        if (decision !== 'approved' && decision !== 'rejected') throw new Error('decision must be approved or rejected')
        const result = await decideListingApproval(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
          decision,
          reason: requireString(input['reason'], 'reason'),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          listingDraftId: result.draft.id,
          status: result.draft.status,
          approvalTaskId: result.task.id,
        })
        return
      }
      if (url.pathname === '/api/v1/media/assets/update') {
        const result = await updateMediaAsset(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          mediaAssetId: requireString(input['mediaAssetId'], 'mediaAssetId'),
          actorId: this.config.createdBy,
          ...(input['rightsStatus'] === undefined ? {} : {
            rightsStatus: requireEnum(input['rightsStatus'], 'rightsStatus', ['unknown', 'owned', 'licensed', 'restricted'] as const),
          }),
          ...(input['status'] === undefined ? {} : {
            status: requireEnum(input['status'], 'status', ['ready', 'blocked', 'archived'] as const),
          }),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          mediaAssetId: result.id,
          rightsStatus: result.rightsStatus,
          status: result.status,
        })
        return
      }
      if (url.pathname === '/api/v1/listings/manual-package/generate') {
        const result = await generateManualListingPackage(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
        })
        await this.writeManualPackage(result.pkg)
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          listingDraftId: result.draft.id,
          status: result.draft.status,
          packageId: result.pkg.id,
          fileRef: result.pkg.fileRef,
        })
        return
      }
      if (url.pathname === '/api/v1/listings/publish-confirmation/submit') {
        const result = await submitPublishConfirmation(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          listingDraftId: result.draft.id,
          approvalTaskId: result.task.id,
        })
        return
      }
      if (url.pathname === '/api/v1/listings/publish-confirmation/decide') {
        const decision = input['decision']
        if (decision !== 'approved' && decision !== 'rejected') {
          throw new Error('decision must be approved or rejected')
        }
        const result = await decidePublishConfirmation(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: requireString(input['listingDraftId'], 'listingDraftId'),
          actorId: this.config.createdBy,
          decision,
          reason: requireString(input['reason'], 'reason'),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          listingDraftId: result.draft.id,
          approvalTaskId: result.task.id,
          publishJobId: result.job?.id ?? null,
          revisionId: result.revision?.id ?? null,
          platformListingId: result.platformListing?.id ?? null,
          externalListingId: result.platformListing?.externalListingId ?? null,
          coreStatus: result.platformListing?.coreStatus ?? null,
        })
        return
      }
      if (url.pathname === '/api/v1/listings/publish/manual-fallback') {
        const result = await markListingPublishManualFallback(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          actorId: this.config.createdBy,
          publishJobId: requireString(input['publishJobId'], 'publishJobId'),
          manualPackageId: requireString(input['manualPackageId'], 'manualPackageId'),
          reason: requireString(input['reason'], 'reason'),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          publishJobId: result.id,
          status: result.status,
          manualPackageId: result.manualPackageId,
        })
        return
      }
      if (url.pathname === '/api/v1/listings/manual-package/submit') {
        const result = await markManualPackageSubmitted(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          actorId: this.config.createdBy,
          manualPackageId: requireString(input['manualPackageId'], 'manualPackageId'),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          manualPackageId: result.id,
          status: result.status,
          submittedAt: result.submittedAt,
        })
        return
      }
      if (url.pathname === '/api/v1/listings/manual-result/import') {
        const result = await importManualListingResult(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          actorId: this.config.createdBy,
          manualPackageId: requireString(input['manualPackageId'], 'manualPackageId'),
          externalListingId: requireString(input['externalListingId'], 'externalListingId'),
          coreStatus: requireEnum(input['coreStatus'], 'coreStatus', [
            'submitted', 'platform_review', 'live', 'rejected', 'inactive', 'archived',
          ] as const),
          rawStatus: requireString(input['rawStatus'], 'rawStatus'),
          ...(input['url'] === undefined ? {} : { url: requireString(input['url'], 'url') }),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          platformListingId: result.platformListing.id,
          revisionId: result.revision.id,
          publishJobId: result.job?.id ?? null,
          listingDraftId: result.draft.id,
          status: result.draft.status,
        })
        return
      }
      if (url.pathname === '/api/v1/platform-listings/status') {
        const result = await updatePlatformListingStatus(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          actorId: this.config.createdBy,
          platformListingId: requireString(input['platformListingId'], 'platformListingId'),
          coreStatus: requireEnum(input['coreStatus'], 'coreStatus', [
            'submitted', 'platform_review', 'live', 'rejected', 'inactive', 'archived',
          ] as const),
          rawStatus: requireString(input['rawStatus'], 'rawStatus'),
          ...(input['url'] === undefined ? {} : { url: requireString(input['url'], 'url') }),
        })
        await this.writeSnapshot()
        sendCommandJson(response, 200, {
          platformListingId: result.id,
          coreStatus: result.coreStatus,
          rawStatus: result.rawStatus,
        })
        return
      }
      const platformHandled = await handlePlatformCommand(url.pathname, input, this.platform, (status, payload) => {
        sendCommandJson(response, status, payload)
      }, async () => { await this.writeSnapshot() })
      if (platformHandled) return
      const commerceHandled = await handleCommerceCommand(
        url.pathname.replace(/^\/api\/v1/, ''),
        input,
        this.commerceDeps(),
        {
          workspaceId: this.config.workspaceId,
          actorId: this.config.createdBy,
          connectedStoreId: (value: unknown) => this.connectedStoreId(value),
        },
        (status, payload) => sendCommandJson(response, status, payload),
        async () => { await this.writeSnapshot() },
      )
      if (commerceHandled) return
      sendCommandJson(response, 404, { error: 'command not found' })
    } catch (error) {
      sendCommandJson(response, 400, { error: error instanceof Error ? error.message : 'command rejected' })
    }
  }

  productApi() {
    return {
      listPlatformStores: async (workspaceId = this.config.workspaceId) => this.platform.listStores(),
      generateListingDraft: async (input: {
        productId: string
        storeId?: string
        platformCategoryId?: string
        priceMinor?: number
        stockQty?: number
      }) => {
        const result = await generateListingDraft(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          productId: input.productId,
          storeId: await this.connectedStoreId(input.storeId),
          actorId: this.config.createdBy,
          ...(input.platformCategoryId === undefined ? {} : { platformCategoryId: input.platformCategoryId }),
          ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
          ...(input.stockQty === undefined ? {} : { stockQty: input.stockQty }),
        })
        await this.writeSnapshot()
        return result
      },
      adoptListingContent: async (input: { listingDraftId: string }) => {
        const result = await adoptListingContent(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: input.listingDraftId,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      validateListingDraft: async (input: { listingDraftId: string }) => {
        const result = await validateListingDraft(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: input.listingDraftId,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      editListingDraft: async (input: {
        listingDraftId: string
        title?: string
        description?: string
        bullets?: string[]
        keywords?: string[]
        platformCategoryId?: string
        attributes?: { key: string; value: string; valueType: 'string' | 'number' | 'boolean' }[]
        priceMinor?: number
        stockQty?: number
        mediaVariantIds?: string[]
      }) => {
        const result = await editListingDraft(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          ...input,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      submitListingApproval: async (input: { listingDraftId: string }) => {
        const result = await submitListingApproval(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: input.listingDraftId,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      decideListingApproval: async (input: {
        listingDraftId: string
        decision: 'approved' | 'rejected'
        reason: string
      }) => {
        const result = await decideListingApproval(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          ...input,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      updateMediaAsset: async (input: {
        mediaAssetId: string
        rightsStatus?: 'unknown' | 'owned' | 'licensed' | 'restricted'
        status?: 'ready' | 'blocked' | 'archived'
      }) => {
        const result = await updateMediaAsset(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          ...input,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      generateManualListingPackage: async (input: { listingDraftId: string }) => {
        const result = await generateManualListingPackage(this.listingDeps(), {
          workspaceId: this.config.workspaceId,
          listingDraftId: input.listingDraftId,
          actorId: this.config.createdBy,
        })
        await this.writeManualPackage(result.pkg)
        await this.writeSnapshot()
        return result
      },
      listSourcingItemViews: async (workspaceId = this.config.workspaceId) =>
        this.storage.listSourcingItemViews(workspaceId),
      getSourcingItemView: async (sourcingItemId: string, workspaceId = this.config.workspaceId) => {
        const view = this.storage.listSourcingItemViews(workspaceId)
          .find(candidate => candidate.item.id === sourcingItemId)
        if (view === undefined) throw new Error(`sourcing item not found: ${sourcingItemId}`)
        return view
      },
      listSourcingItems: async (workspaceId = this.config.workspaceId) =>
        this.storage.listSourcingItems(workspaceId),
      listImportBatches: async (workspaceId = this.config.workspaceId, limit = 50) =>
        this.storage.importBatches.list(workspaceId, limit),
      auditEvents: async (workspaceId = this.config.workspaceId, limit = 100) =>
        this.storage.auditEvents(workspaceId, limit),
      scanNow: async () => { await this.scanNow() },
      decide: async (input: {
        sourcingItemId: string
        decision: 'approved' | 'rejected' | 'observing'
        reason: string
      }) => {
        const result = await decide(this.selectionDeps(), {
          ...input,
          workspaceId: this.config.workspaceId,
          decidedBy: 'user',
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      reopenSelection: async (input: { sourcingItemId: string; reason: string }) => {
        const item = await reopenSelection(this.selectionDeps(), {
          ...input,
          workspaceId: this.config.workspaceId,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return item
      },
      createProductFromSelection: async (input: { sourcingItemId: string }) => {
        const result = await createProductFromSelection(this.selectionDeps(), {
          ...input,
          workspaceId: this.config.workspaceId,
          actorId: this.config.createdBy,
        })
        await this.writeSnapshot()
        return result
      },
      recordAiSuggestion: async (input: {
        sourcingItemId: string
        reason: string
        scoresJson: string
      }) => {
        const result = await decide(this.selectionDeps(), {
          workspaceId: this.config.workspaceId,
          sourcingItemId: input.sourcingItemId,
          decision: 'observing',
          reason: input.reason,
          scoresJson: input.scoresJson,
          decidedBy: 'ai',
          actorId: 'selection-tool',
        })
        await this.writeSnapshot()
        return result
      },
    }
  }
}

async function readCommandBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    bytes += buffer.byteLength
    if (bytes > MAX_COMMAND_BYTES) throw new Error('command body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`)
  return value
}

function requireDecision(value: unknown): 'approved' | 'rejected' | 'observing' {
  if (value !== 'approved' && value !== 'rejected' && value !== 'observing') {
    throw new Error('decision must be approved, rejected, or observing')
  }
  return value
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${name} must be an integer`)
  return value
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim() !== '')) {
    throw new Error(`${name} must be an array of non-empty strings`)
  }
  return value as string[]
}

function requireAttributes(value: unknown): { key: string; value: string; valueType: 'string' | 'number' | 'boolean' }[] {
  if (!Array.isArray(value)) throw new Error('attributes must be an array')
  return value.map(item => {
    if (typeof item !== 'object' || item === null) throw new Error('attributes must contain objects')
    const record = item as Record<string, unknown>
    const key = requireString(record['key'], 'attribute.key')
    const attributeValue = requireString(record['value'], 'attribute.value')
    const valueType = record['valueType']
    if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
      throw new Error('attribute.valueType must be string, number, or boolean')
    }
    return { key, value: attributeValue, valueType }
  })
}

function requireEnum<T extends string>(value: unknown, name: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of: ${values.join(', ')}`)
  }
  return value as T
}

function sendCommandJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function toReport(
  parsed: SourcingImportParseResult,
  duplicateChecksumCount: number,
): SourcingImportReport {
  return { ...parsed.report, duplicateChecksumCount }
}

function filterDuplicateChecksums(
  plan: SourcingImportPlan,
  duplicates: Set<string>,
): SourcingImportPlan {
  const uniqueRecords = plan.sourceRecords.filter(record => !duplicates.has(record.checksum))
  const itemIds = new Set(uniqueRecords.map(record => record.sourcingItemId))
  return {
    ...plan,
    items: plan.items.filter(item => itemIds.has(item.id)),
    sourceRecords: uniqueRecords,
    media: plan.media.filter(media => itemIds.has(media.sourcingItemId)),
    qualifications: plan.qualifications.filter(item => itemIds.has(item.sourcingItemId)),
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  mkdirSync(dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await unlink(from)
  }
}
