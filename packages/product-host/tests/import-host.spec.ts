import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ProductImportHost } from '../src/index.ts'
import type { ProductHostConfig } from '../src/config.ts'

let root = ''
let config: ProductHostConfig
const allowAllBillingAuthority = {
  validateFeature: () => ({ featureKey: 'test-allow', allowed: true }),
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toneclaw-product-host-'))
  config = {
    dbPath: join(root, 'product.sqlite'),
    dataDir: join(root, 'data'),
    importDir: join(root, 'import'),
    workspaceId: 'workspace-1',
    createdBy: 'toneclaw-operation',
    supplierCountry: 'CN',
    stabilityDelayMs: 0,
    pollIntervalMs: 100,
  }
})

describe('product import host', () => {
  it('imports a stable CSV, archives it, and publishes the sourcing snapshot', async () => {
    const host = new ProductImportHost({}, config, allowAllBillingAuthority)
    const csv = readFileSync(join(__dirname, '../../sourcing-provider/fixtures/valid-minimal.csv'))
    writeFileSync(join(config.importDir, 'catalog.csv'), csv)
    await host.scanNow()

    const processed = readdirSync(join(config.importDir, 'processed'), { recursive: true })
    expect(processed.some(path => String(path).endsWith('catalog.csv'))).toBe(true)
    const snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
    expect(snapshot.summary.totalItems).toBe(2)
    expect(snapshot.summary.candidateItems).toBe(2)
    expect(snapshot.items[0]?.title).toContain('storage box')
    expect(readdirSync(config.dataDir).some(path => String(path).startsWith('import-report-'))).toBe(true)
    host.close()
  })

  it('runs selection and product creation through the local command API', async () => {
    const host = new ProductImportHost({}, config)
    host.startCommandServer()
    const csv = readFileSync(join(__dirname, '../../sourcing-provider/fixtures/valid-minimal.csv'))
    writeFileSync(join(config.importDir, 'catalog.csv'), csv)
    await host.scanNow()

    let snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
    for (let attempt = 0; snapshot.commands === undefined && attempt < 50; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20))
      snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
    }
    expect(snapshot.commands?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/)
    const itemId = snapshot.items[0].id
    await host.productApi().recordAiSuggestion({
      sourcingItemId: itemId,
      reason: 'AI 观察建议',
      scoresJson: JSON.stringify({ recommendation: 'observe', score: 72, risks: [] }),
    })
    snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
    expect(snapshot.items[0].decision).toBe('observing')
    expect(snapshot.items[0].decisionBy).toBe('ai')
    expect(snapshot.items[0].scoresJson).toContain('"score":72')
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${snapshot.commands.token}`,
      Origin: 'dsh-app://product-ui',
    }
    const approved = await fetch(`${snapshot.commands.baseUrl}/selection/decisions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourcingItemId: itemId, decision: 'approved', reason: 'margin passes P0 gate' }),
    })
    expect(approved.status).toBe(200)
    snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
    expect(snapshot.items[0].status).toBe('selected')
    expect(snapshot.items[0].decision).toBe('approved')

    const unauthorized = await fetch(`${snapshot.commands.baseUrl}/selection/decisions`, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer wrong' },
      body: JSON.stringify({ sourcingItemId: itemId, decision: 'observing', reason: 'retry' }),
    })
    expect(unauthorized.status).toBe(401)

    const created = await fetch(`${snapshot.commands.baseUrl}/products/from-selection`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourcingItemId: itemId }),
    })
    expect(created.status).toBe(200)
    snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
    expect(snapshot.items[0].productCreated).toBe(true)
    expect(snapshot.products).toHaveLength(1)
    expect(snapshot.products[0].sourcingItemId).toBe(itemId)
    expect(snapshot.products[0].purchasePriceMinor).toBe(snapshot.items[0].purchasePriceMinor)
    host.close()
  })

  it('rejects a header mismatch, archives it under failed, and records the batch', async () => {
    const host = new ProductImportHost({}, config)
    writeFileSync(join(config.importDir, 'bad.csv'), 'wrong,header\nA,B')
    await host.scanNow()

    const failed = readdirSync(join(config.importDir, 'failed'), { recursive: true })
    expect(failed.some(path => String(path).endsWith('bad.csv'))).toBe(true)
    expect(JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8')).summary.failedBatches).toBe(1)
    host.close()
  })

  it('returns the existing batch for the same file fingerprint without adding rows', async () => {
    const host = new ProductImportHost({}, config)
    const csv = readFileSync(join(__dirname, '../../sourcing-provider/fixtures/valid-with-sku.csv'))
    writeFileSync(join(config.importDir, 'catalog.csv'), csv)
    await host.scanNow()
    writeFileSync(join(config.importDir, 'catalog.csv'), csv)
    await host.scanNow()

    const snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
    expect(snapshot.summary.totalItems).toBe(1)
    expect(snapshot.summary.batches).toBe(1)
    expect(readdirSync(join(config.importDir, 'processed', 'duplicates'))).toHaveLength(1)
    host.close()
  })
})
