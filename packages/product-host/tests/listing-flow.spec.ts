import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProductImportHost } from '../src/index.ts'
import type { ProductHostConfig } from '../src/config.ts'

const roots: string[] = []
let activeHost: ProductImportHost | null = null

afterEach(() => {
  activeHost?.close()
  activeHost = null
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('generates a listing, adopts content snapshots, validates it, and confirms a manual package', async () => {
  const root = mkdtempSync(join(tmpdir(), 'toneclaw-listing-'))
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
  const host = new ProductImportHost({}, config)
  activeHost = host
  host.startCommandServer()
  const csv = readFileSync(join(__dirname, '../../sourcing-provider/fixtures/valid-minimal.csv'))
  writeFileSync(join(config.importDir, 'catalog.csv'), csv)
  await host.scanNow()

  let snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
  for (let attempt = 0; snapshot.commands === undefined && attempt < 50; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20))
    snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${snapshot.commands.token}`,
    Origin: 'dsh-app://product-ui',
  }
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${snapshot.commands.baseUrl}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    return await response.json() as Record<string, unknown>
  }

  const itemId = snapshot.items[0]!.id
  await post('/selection/decisions', {
    sourcingItemId: itemId, decision: 'approved', reason: 'margin passes the P0 gate',
  })
  const created = await post('/products/from-selection', { sourcingItemId: itemId })
  const productId = String(created['productId'])

  const start = await post('/platform/connections/start', {})
  await post('/platform/connections/callback', {
    connectionId: start['connectionId'], state: start['state'], approved: true,
  })
  snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
  expect(snapshot.platform.stores[0]?.status).toBe('connected')
  const storeId = String(snapshot.platform.stores[0]!.id)

  const generated = await post('/listings/generate', { productId, storeId })
  const listingDraftId = String(generated['listingDraftId'])
  expect(generated['status']).toBe('draft')
  expect(generated['contentDraftIds']).toHaveLength(4)

  snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
  expect(snapshot.mediaAssets).toHaveLength(2)
  expect(snapshot.mediaVariants).toHaveLength(2)
  expect(snapshot.draftVariants).toHaveLength(1)
  expect(snapshot.categoryMappings).toHaveLength(1)

  const edited = await post('/listings/edit', {
    listingDraftId,
    title: 'Edited Linen storage box',
    description: 'Governed listing description',
    platformCategoryId: 'mock-cat-root',
    attributes: [{ key: 'material', value: 'Linen', valueType: 'string' }],
    priceMinor: 8990,
    stockQty: 80,
  })
  expect(edited).toMatchObject({ listingDraftId, status: 'draft' })

  const adopted = await post('/listings/content/adopt', { listingDraftId })
  expect(adopted).toMatchObject({ listingDraftId, status: 'draft' })
  const validated = await post('/listings/validate', { listingDraftId })
  expect(validated).toMatchObject({ status: 'validated' })
  const submitted = await post('/listings/approval/submit', { listingDraftId })
  expect(submitted).toMatchObject({ listingDraftId, status: 'waiting_approval' })
  const approved = await post('/listings/approval/decide', {
    listingDraftId, decision: 'approved', reason: 'Listing snapshot is complete and compliant',
  })
  expect(approved).toMatchObject({ listingDraftId, status: 'approved' })
  const packaged = await post('/listings/manual-package/generate', { listingDraftId })
  expect(packaged).toMatchObject({ listingDraftId, status: 'approved' })
  const fileRef = String(packaged['fileRef'])
  expect(fileRef).toMatch(/^listing-packages\/.+\.json$/)

  snapshot = JSON.parse(readFileSync(join(config.dataDir, 'sourcing.json'), 'utf8'))
  expect(snapshot.listings).toHaveLength(1)
  expect(snapshot.listings[0]).toMatchObject({
    id: listingDraftId, productId, storeId, status: 'approved',
    titleContentDraftId: expect.any(String),
    descriptionContentDraftId: expect.any(String),
    bulletsContentDraftId: expect.any(String),
    keywordsContentDraftId: expect.any(String),
  })
  const listing = snapshot.listings[0] as any
  const selectedContentIds = [
    listing.titleContentDraftId,
    listing.descriptionContentDraftId,
    listing.bulletsContentDraftId,
    listing.keywordsContentDraftId,
  ]
  expect(selectedContentIds.every((id: any) => typeof id === 'string')).toBe(true)
  expect(snapshot.contentDrafts
    .filter((content: any) => selectedContentIds.includes(content.id))
    .every((content: any) => content.status === 'approved')).toBe(true)
  expect(snapshot.contentDrafts.filter((content: any) => content.productId === productId).length)
    .toBeGreaterThanOrEqual(6)
  expect(snapshot.manualPackages).toHaveLength(1)
  expect(snapshot.approvalTasks).toHaveLength(1)
  expect(snapshot.approvalTasks[0]).toMatchObject({ targetType: 'ListingDraft', status: 'approved' })

  const packagePath = join(config.dataDir, fileRef)
  expect(existsSync(packagePath)).toBe(true)
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  expect(pkg).toMatchObject({
    schemaVersion: 1,
    submissionChannel: 'manual_export_import',
    product: { id: productId },
    store: { id: storeId },
  })
  expect(pkg.contentDrafts).toHaveLength(4)
  expect(pkg.images.length).toBeGreaterThan(0)

  const auditEvents = await host.productApi().auditEvents('workspace-1')
  const auditActions = auditEvents.map(event => event.action)
  expect(auditActions).toEqual(expect.arrayContaining([
    'listing.draft_created',
    'listing.draft_edited',
    'listing.content_adopted',
    'listing.validation_passed',
    'listing.approval_approved',
    'listing.manual_package_created',
  ]))
})
