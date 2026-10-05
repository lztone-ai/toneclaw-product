import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = resolve(root, 'packages')
const packageDirs = (await readdir(packagesDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => join(packagesDir, entry.name))

function dependencyNames(manifest, section) {
  return Object.keys(manifest[section] ?? {})
}

function isExactVersion(version) {
  return typeof version === 'string' && version !== '' && !/^[\^~*>x]/i.test(version)
}

const failures = []

for (const packageDir of packageDirs) {
  const packagePath = join(packageDir, 'package.json')
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  const id = relative(root, packagePath)
  const metadata = manifest.toneclaw

  if (manifest.private !== true) failures.push(`${id}: product packages must set private=true`)
  if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@toneclaw/')) {
    failures.push(`${id}: package name must start with @toneclaw/`)
  }
  if (metadata?.layer !== 'product') failures.push(`${id}: toneclaw.layer must be "product"`)
  if (metadata?.kind !== 'dsh-plugin' && metadata?.kind !== 'product-library') {
    failures.push(`${id}: toneclaw.kind must be "dsh-plugin" or "product-library"`)
  }

  const productionDependencies = dependencyNames(manifest, 'dependencies')
  const allowed = metadata?.allowedExternalDependencies ?? []
  for (const name of productionDependencies) {
    if (name.startsWith('@deepseek-ai/')) failures.push(`${id}: product package must not depend on ${name}`)
    if (name.startsWith('@toneclaw/')) continue
    if (!allowed.includes(name)) {
      failures.push(`${id}: external dependency ${name} is not listed in toneclaw.allowedExternalDependencies`)
    }
  }

  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (name.startsWith('@toneclaw/')) continue
      if (!isExactVersion(version)) {
        failures.push(`${id}: ${section}.${name} must use an exact version, got ${JSON.stringify(version)}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error('product boundary violations:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`product boundaries ok: ${packageDirs.length} package(s)`)
