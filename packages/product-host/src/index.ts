/** Cordis plugin entry: assemble local product storage and run the S2 import watcher. */
import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { copyFile, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProductStorage } from '@toneclaw/product-storage'
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
  private watcher: FSWatcher | null = null
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
  }

  start(): void {
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
    if (this.pollTimer !== null) clearInterval(this.pollTimer)
    this.storage.close()
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
    return writeSourcingSnapshot(this.config.dataDir, this.storage, this.config.workspaceId)
  }

  productApi() {
    return {
      listSourcingItems: async (workspaceId = this.config.workspaceId) =>
        this.storage.listSourcingItems(workspaceId),
      listImportBatches: async (workspaceId = this.config.workspaceId, limit = 50) =>
        this.storage.importBatches.list(workspaceId, limit),
      auditEvents: async (workspaceId = this.config.workspaceId, limit = 100) =>
        this.storage.auditEvents(workspaceId, limit),
      scanNow: async () => { await this.scanNow() },
    }
  }
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
