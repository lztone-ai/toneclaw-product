import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { BillingStore, LocalBillingAuthority } from '@toneclaw/billing-local'
import { apply as applySelectionTool } from '@toneclaw/selection-tool'
import { ProductStorage } from '@toneclaw/product-storage'
import { ProductImportHost } from '../src/index.ts'
import type { ProductHostConfig } from '../src/config.ts'

const roots: string[] = []
const stores: BillingStore[] = []
let activeHost: ProductImportHost | null = null
let activeStorage: ProductStorage | null = null

afterEach(() => {
  activeHost?.close()
  activeStorage?.close()
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('runs import, selection, AI usage, product creation, and audit as one chain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'toneclaw-s25-'))
  roots.push(root)
  const config: ProductHostConfig = {
    dbPath: join(root, 'product.sqlite'),
    dataDir: join(root, 'data'),
    importDir: join(root, 'import'),
    workspaceId: 'workspace-1',
    createdBy: 'toneclaw-operation',
    supplierCountry: 'CN',
    stabilityDelayMs: 0,
    pollIntervalMs: 100,
  }
  const host = new ProductImportHost({
    logger: { warn: console.warn, error: console.error },
  }, config)
  activeHost = host
  host.startCommandServer()

  // 1) Partial CSV import: failed rows stay in the report, the valid row enters as candidate.
  const partial = readFileSync(join(__dirname, '../../sourcing-provider/fixtures/invalid-rows.csv'))
  writeFileSync(join(config.importDir, 'partial.csv'), partial)
  await host.scanNow()
  let snapshot = await waitForCommandSnapshot(config.dataDir)
  expect(snapshot.summary).toMatchObject({ totalItems: 1, batches: 1, failedBatches: 0 })
  const partialBatchId = snapshot.batches[0]?.id
  const report = JSON.parse(readFileSync(join(config.dataDir, `import-report-${partialBatchId}.json`), 'utf8'))
  expect(report).toMatchObject({ status: 'partially_completed', validRows: 1, failedRows: 3 })
  expect(report.errors.map((error: any) => error.errorCodes[0])).toEqual(expect.arrayContaining([
    'INVALID_PRICE', 'INVALID_SKU_JSON', 'DUPLICATE_SOURCE_ID',
  ]))

  // 2) Same bytes, different file name: fingerprint idempotency adds no batch or item.
  writeFileSync(join(config.importDir, 'partial-again.csv'), partial)
  await host.scanNow()
  snapshot = readSnapshot(config.dataDir)
  expect(snapshot.summary).toMatchObject({ totalItems: 1, batches: 1 })
  expect(readdirSync(join(config.importDir, 'processed', 'duplicates'))).toHaveLength(1)

  // 3) A later batch with the same normalized supplier reuses that Supplier instead of failing.
  const additionalCsv = [
    'sourceId,supplierName,supplierUrl,title,description,categoryCandidate,costPrice,currency,moq,supplyAbility,imageUrls,skuAttributesJson,complianceJson,suggestedRetailPrice,stockQty,leadTimeDays',
    'S2-FULL-2,Harbor Goods,https://harbor.example.com/full-2,Second full-chain candidate,Kept for AI success,Home,42.00,USD,1,300,https://img.example.com/full-2.jpg,,{},69.00,120,5',
    'S2-FULL-3,Harbor Goods,https://harbor.example.com/full-3,Third full-chain candidate,Kept for AI failure,Home,58.00,USD,1,300,https://img.example.com/full-3.jpg,,{},89.00,80,8',
  ].join('\n')
  writeFileSync(join(config.importDir, 'additional.csv'), additionalCsv)
  await host.scanNow()
  snapshot = readSnapshot(config.dataDir)
  expect(snapshot.summary.totalItems).toBe(3)
  const first = snapshot.items.find((item: any) => item.externalSourceId === 'SKU-BAD-001')
  const second = snapshot.items.find((item: any) => item.externalSourceId === 'S2-FULL-2')
  const third = snapshot.items.find((item: any) => item.externalSourceId === 'S2-FULL-3')
  expect(first).toBeDefined()
  expect(second).toBeDefined()
  expect(third).toBeDefined()

  // 4) AI success burns quota, commits UsageRecord, and persists an observe-only suggestion.
  const billingStore = new BillingStore(join(root, 'billing.sqlite'))
  stores.push(billingStore)
  const authority = new LocalBillingAuthority(billingStore)
  const tools: any[] = []
  applySelectionTool({
    tools: { register: tool => { tools.push(tool); return () => undefined } },
    llm: successLlm(),
    billingAuthority: authority,
    productApi: host.productApi(),
  }, {
    workspaceId: 'workspace-1',
    llmProvider: 'test-provider',
    llmModel: 'test-model',
    reservedInputTokens: 120,
    reservedOutputTokens: 100,
  })
  const aiOutput = await tools[0]!.execute(
    { sourcingItemId: first!.id },
    { signal: new AbortController().signal },
  )
  expect(aiOutput).toMatchObject({ recommendation: 'observe', persisted: true })
  expect(typeof aiOutput.usageRecordId).toBe('string')
  let usage = authority.usageRecords('workspace-1')
  expect(usage).toHaveLength(1)
  expect(usage[0]).toMatchObject({ status: 'Succeeded', inputTokens: 123, outputTokens: 45 })
  expect(authority.currentQuota('workspace-1').usedInputTokens).toBe(123)
  expect(authority.currentQuota('workspace-1').usedOutputTokens).toBe(45)
  snapshot = readSnapshot(config.dataDir)
  expect(snapshot.items.find((item: any) => item.id === first!.id)).toMatchObject({
    decision: 'observing', decisionBy: 'ai',
  })

  // 5) AI failure releases reserved quota but retains a Failed UsageRecord.
  tools.length = 0
  applySelectionTool({
    tools: { register: tool => { tools.push(tool); return () => undefined } },
    llm: failedLlm(),
    billingAuthority: authority,
    productApi: host.productApi(),
  }, {
    workspaceId: 'workspace-1',
    llmProvider: 'test-provider',
    llmModel: 'test-model',
    reservedInputTokens: 100,
    reservedOutputTokens: 100,
  })
  await expect(tools[0]!.execute({ sourcingItemId: third!.id }, { signal: new AbortController().signal }))
    .rejects.toThrow('model stream failed')
  usage = authority.usageRecords('workspace-1')
  expect(usage.map((record: any) => record.status)).toEqual(['Failed', 'Succeeded'])
  expect(authority.currentQuota('workspace-1').usedInputTokens).toBe(123)

  // 6) Human decisions and product creation go through the Product API command endpoint.
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${snapshot.commands.token}`,
    Origin: 'dsh-app://product-ui',
  }
  const approved = await postJson(snapshot.commands.baseUrl, '/selection/decisions', headers, {
    sourcingItemId: first!.id,
    decision: 'approved',
    reason: 'margin and lead time pass',
  })
  expect(approved.status).toBe(200)
  const created = await postJson(snapshot.commands.baseUrl, '/products/from-selection', headers, {
    sourcingItemId: first!.id,
  })
  expect(created.status).toBe(200)
  const rejected = await postJson(snapshot.commands.baseUrl, '/selection/decisions', headers, {
    sourcingItemId: third!.id,
    decision: 'rejected',
    reason: 'AI failed and margin is not compelling',
  })
  expect(rejected.status).toBe(200)
  snapshot = readSnapshot(config.dataDir)
  const product = snapshot.products.find((row: any) => row.sourcingItemId === first!.id)
  expect(product).toMatchObject({ riskStatus: first!.riskStatus })
  expect(product?.purchasePriceMinor).toBe(first!.purchasePriceMinor)
  expect(product?.createdFromSelectionId).toBeTypeOf('string')

  host.close()

  // 7) Database-level acceptance: auto records, decision supersession, cost-basis double write, audits.
  const db = new ProductStorage(config.dbPath)
  activeStorage = db
  expect(db.prepare('SELECT COUNT(*) AS count FROM suppliers').get()).toMatchObject({ count: 1 })
  expect(db.prepare('SELECT COUNT(*) AS count FROM data_sources').get()).toMatchObject({ count: 2 })
  expect(db.prepare("SELECT COUNT(*) AS count FROM categories WHERE id = 'category-uncategorized'").get())
    .toMatchObject({ count: 1 })
  const decisions = db.prepare(`
    SELECT d.decision, d.decided_by, d.status, d.result_product_id, i.external_source_id
    FROM selection_decisions d JOIN sourcing_items i ON i.id = d.sourcing_item_id
    ORDER BY d.decided_at
  `).all() as any[]
  expect(decisions.filter(row => row.external_source_id === 'SKU-BAD-001')).toHaveLength(2)
  const approvedDecision = decisions.find(row => row.external_source_id === 'SKU-BAD-001' && row.status === 'active')
  const supersededAi = decisions.find(row => row.external_source_id === 'SKU-BAD-001' && row.status === 'superseded')
  expect(approvedDecision).toMatchObject({ decision: 'approved', decided_by: 'user' })
  expect(supersededAi).toMatchObject({ decision: 'observing', decided_by: 'ai' })
  expect(approvedDecision?.result_product_id).toBe(product?.id)
  const productRow = db.prepare('SELECT * FROM products WHERE id = ?').get(product!.id) as any
  const variant = db.prepare('SELECT * FROM product_variants WHERE product_id = ?').get(product!.id) as any
  expect(productRow).toMatchObject({
    sourcing_item_id: first!.id,
    created_from_selection_id: product!.createdFromSelectionId,
    risk_status: first!.riskStatus,
    status: 'draft',
  })
  expect(variant.purchase_price_minor).toBe(first!.purchasePriceMinor)
  const audits = db.auditEvents('workspace-1', 200)
  const creationAudit = audits.find(event => event.action === 'product.create_from_selection')
  expect(creationAudit).toBeDefined()
  const after = JSON.parse(creationAudit!.after ?? '{}')
  expect(after.costBasis).toMatchObject({
    purchasePriceMinor: first!.purchasePriceMinor,
    currency: first!.currency,
  })
  expect(audits.some(event => event.action === 'import.batch')).toBe(true)
  expect(audits.some(event => event.action === 'selection.observing')).toBe(true)
  expect(audits.some(event => event.action === 'selection.approved')).toBe(true)
})

async function waitForCommandSnapshot(dataDir: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (hasCommands(dataDir)) return readSnapshot(dataDir)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('command endpoint was not published')
}

function hasCommands(dataDir: string): boolean {
  try {
    return readSnapshot(dataDir).commands !== undefined
  } catch {
    return false
  }
}

function readSnapshot(dataDir: string): any {
  return JSON.parse(readFileSync(join(dataDir, 'sourcing.json'), 'utf8'))
}

function successLlm() {
  return {
    stream: async function * () {
      yield { type: 'text-delta', text: '{"recommendation":"observe","score":81,"summary":"毛利充足且履约时效可接受。","risks":["资质未知"]}' }
      yield { type: 'usage', usage: { inputTokens: 123, outputTokens: 45 } }
      yield { type: 'finish', finish: 'stop' }
    },
  }
}

function failedLlm() {
  return {
    stream: async function * () {
      yield { type: 'finish', finish: 'error' }
    },
  }
}

async function postJson(baseUrl: string, path: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
