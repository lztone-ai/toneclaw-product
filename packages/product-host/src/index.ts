/** Cordis plugin entry: assemble local product storage and run the S2 import watcher. */
import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { copyFile, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  createProductFromSelection,
  decide,
  reopenSelection,
  type SelectionDeps,
} from '@toneclaw/core-domain'
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
      sendCommandJson(response, 404, { error: 'command not found' })
    } catch (error) {
      sendCommandJson(response, 400, { error: error instanceof Error ? error.message : 'command rejected' })
    }
  }

  productApi() {
    return {
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
