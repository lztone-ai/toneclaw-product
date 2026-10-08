import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProductImportHost } from '../src/index.ts'
import type { ProductHostConfig } from '../src/config.ts'

let root = ''
let config: ProductHostConfig
let host: ProductImportHost | null = null
let snapshot: any = null

afterEach(() => {
  host?.close()
  host = null
  snapshot = null
  if (root !== '') {
    rmSync(root, { recursive: true, force: true })
    root = ''
  }
})

it('blocks store connection, listing generation, and manual export without entitlements', async () => {
  root = mkdtempSync(join(tmpdir(), 'toneclaw-billing-gate-'))
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
  const blockedFeatures: string[] = []
  const deniedBillingAuthority = {
    validateFeature: (_workspaceId: string, featureKey: string) => {
      blockedFeatures.push(featureKey)
      return { featureKey, allowed: false }
    },
  }
  host = new ProductImportHost({}, config, deniedBillingAuthority)
  host.startCommandServer()
  const csv = readFileSync(join(__dirname, '../../sourcing-provider/fixtures/valid-minimal.csv'))
  writeFileSync(join(config.importDir, 'catalog.csv'), csv)
  await host.scanNow()
  snapshot = await waitForCommandSnapshot()

  const connect = await post('/platform/connections/start', {})
  expect(connect.status).toBe(400)
  expect(connect.body.error).toBe('subscription feature blocked: store.temu')

  const generate = await post('/listings/generate', { productId: 'missing' })
  expect(generate.status).toBe(400)
  expect(generate.body.error).toBe('subscription feature blocked: listing.generation')

  const manualExport = await post('/listings/manual-package/generate', { listingDraftId: 'missing' })
  expect(manualExport.status).toBe(400)
  expect(manualExport.body.error).toBe('subscription feature blocked: export.data')

  expect(blockedFeatures).toEqual(['store.temu', 'listing.generation', 'export.data'])
  expect(JSON.parse(await readSnapshot()).platform.stores).toHaveLength(0)

  async function waitForCommandSnapshot(): Promise<any> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const current = JSON.parse(await readSnapshot())
        if (current.commands !== undefined) return current
      } catch {
        /* snapshot is created asynchronously */
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('command endpoint was not published')
  }

  async function readSnapshot(): Promise<string> {
    const { readFile } = await import('node:fs/promises')
    return readFile(join(config.dataDir, 'sourcing.json'), 'utf8')
  }

  async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    if (snapshot === null || snapshot.commands === undefined) throw new Error('commands are not ready')
    const response = await fetch(`${snapshot.commands.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${snapshot.commands.token}`,
        Origin: 'dsh-app://product-ui',
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    return { status: response.status, body: payload }
  }
})
