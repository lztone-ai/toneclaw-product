import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const releaseDir = resolve(root, 'release')
const transportSource = resolve(releaseDir, 'feishu-long-connection')
const billingSource = resolve(releaseDir, 'billing-host')
const productSource = resolve(releaseDir, 'product-host')
const profileSource = resolve(releaseDir, 'profiles/desktop.patch.yml')
const uiSource = resolve(root, 'packages/desktop-ui/dist')
const resourcesDir = resolve(releaseDir, 'desktop-resources')
const pluginDestination = resolve(resourcesDir, 'plugins/feishu-long-connection')
const billingDestination = resolve(resourcesDir, 'plugins/billing-host')
const productDestination = resolve(resourcesDir, 'plugins/product-host')
const uiDestination = resolve(resourcesDir, 'ui')
const profileDestination = resolve(resourcesDir, 'profiles/desktop.patch.yml')

async function productCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })
  return stdout.trim()
}

function inventory(rootDirectory, manifestRoot = rootDirectory) {
  const files = []
  for (const entry of readdirSync(rootDirectory, { withFileTypes: true })) {
    const path = join(rootDirectory, entry.name)
    if (entry.isDirectory()) files.push(...inventory(path, manifestRoot))
    else if (entry.isFile()) {
      const body = readFileSync(path)
      files.push({
        path: relative(manifestRoot, path).replaceAll('\\', '/'),
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function assertNoDeveloperPaths(text) {
  const forbidden = [resolve(root).replaceAll('\\', '/'), 'D:/commerce-space', 'D:\\commerce-space']
  for (const value of forbidden) {
    if (text.includes(value)) throw new Error(`generated resources contain developer path: ${value}`)
  }
}

if (!existsSync(transportSource)) {
  throw new Error(`transport release missing: ${transportSource}; run pnpm run package:transport`)
}
if (!existsSync(join(billingSource, 'dist/index.mjs'))) {
  throw new Error(`billing host build missing: ${billingSource}; run pnpm run package:transport`)
}
if (!existsSync(join(productSource, 'dist/index.mjs'))) {
  throw new Error(`product host build missing: ${productSource}; run pnpm run package:transport`)
}
if (!existsSync(profileSource)) {
  throw new Error(`generated profile missing: ${profileSource}; run pnpm run package:transport`)
}
if (!existsSync(join(uiSource, 'index.html'))) {
  throw new Error(`desktop UI build missing: ${uiSource}; run pnpm --filter @toneclaw/desktop-ui run build`)
}

rmSync(resourcesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
cpSync(transportSource, pluginDestination, { recursive: true, dereference: true })
cpSync(billingSource, billingDestination, { recursive: true, dereference: true })
cpSync(productSource, productDestination, { recursive: true, dereference: true })
cpSync(uiSource, uiDestination, { recursive: true, dereference: true })

// Regenerate the profile for its final resource-relative location.
const pluginEntrySource = join(pluginDestination, 'dist/index.mjs')
const generator = resolve(root, 'scripts/generate-profile.mjs')
const generated = spawnSync(process.execPath, [generator,
  '--plugin', pluginEntrySource,
  '--billing-plugin', join(billingDestination, 'dist/index.mjs'),
  '--product-plugin', join(productDestination, 'dist/index.mjs'),
  '--out', profileDestination,
], { stdio: 'inherit', windowsHide: true })
if (generated.status !== 0) process.exit(generated.status ?? 1)

for (const text of [readFileSync(profileDestination, 'utf8'), readFileSync(join(uiDestination, 'index.html'), 'utf8'),
  readFileSync(join(uiDestination, 'app.js'), 'utf8')]) {
  assertNoDeveloperPaths(text.replaceAll(root.replaceAll('\\', '/'), ''))
}
const pluginModule = await import(pathToFileURL(pluginEntrySource).href)
if (pluginModule.name !== 'feishu-long-connection' || !Array.isArray(pluginModule.inject)) {
  throw new Error('composed transport plugin does not expose the expected Cordis entry shape')
}
const billingEntrySource = join(billingDestination, 'dist/index.mjs')
const billingModule = await import(pathToFileURL(billingEntrySource).href)
if (billingModule.name !== 'billing-host' || !Array.isArray(billingModule.inject)) {
  throw new Error('composed billing plugin does not expose the expected Cordis entry shape')
}
const productEntrySource = join(productDestination, 'dist/index.mjs')
const productModule = await import(pathToFileURL(productEntrySource).href)
if (productModule.name !== 'product-host' || !Array.isArray(productModule.inject)) {
  throw new Error('composed product plugin does not expose the expected Cordis entry shape')
}

const engineLock = JSON.parse(readFileSync(resolve(root, 'engine-lock.json'), 'utf8'))
const transportManifest = JSON.parse(readFileSync(join(transportSource, 'package.json'), 'utf8'))
const billingManifest = JSON.parse(readFileSync(join(billingSource, 'package.json'), 'utf8'))
const productManifest = JSON.parse(readFileSync(join(productSource, 'package.json'), 'utf8'))
const uiManifest = JSON.parse(readFileSync(resolve(root, 'packages/desktop-ui/package.json'), 'utf8'))
const manifest = {
  schemaVersion: 1,
  productCommit: await productCommit(),
  engine: engineLock.engine,
  packages: [
    {
      name: transportManifest.name,
      version: transportManifest.version,
      path: 'plugins/feishu-long-connection',
      entry: 'plugins/feishu-long-connection/dist/index.mjs',
    },
    {
      name: uiManifest.name,
      version: uiManifest.version,
      path: 'ui',
      entry: 'ui/index.html',
    },
    {
      name: billingManifest.name,
      version: billingManifest.version,
      path: 'plugins/billing-host',
      entry: 'plugins/billing-host/dist/index.mjs',
    },
    {
      name: productManifest.name,
      version: productManifest.version,
      path: 'plugins/product-host',
      entry: 'plugins/product-host/dist/index.mjs',
    },
  ],
  profiles: [{
    id: 'desktop',
    path: 'profiles/desktop.patch.yml',
  }],
  files: inventory(resourcesDir),
}
writeFileSync(join(resourcesDir, 'toneclaw-manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
writeFileSync(resolve(resourcesDir, 'README.txt'), `ToneClaw desktop resource bundle.\nLoad profile: ${manifest.profiles[0].path}\nPlugin entry: ${manifest.packages[0].entry}\nUI entry: ${manifest.packages[1].entry}\nBilling entry: ${manifest.packages[2].entry}\nProduct entry: ${manifest.packages[3].entry}\n`)

console.log(`desktop resources: ${resourcesDir}`)
console.log(`files: ${manifest.files.length}`)
console.log(`plugin: ${manifest.packages[0].entry}`)
console.log(`ui: ${manifest.packages[1].entry}`)
console.log(`billing: ${manifest.packages[2].entry}`)
console.log(`product: ${manifest.packages[3].entry}`)
console.log(`profile: ${manifest.profiles[0].path}`)
