/** 08:28 dependency-direction Gate: pure domain packages must not touch Node APIs,
 * DB drivers, Electron, DOM, or DSH packages. Extend PURE_PACKAGES as domains grow. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const purePackages = ['core-domain']
const forbiddenSourceImports = [/^node:/, /^@deepseek-ai\//, /^electron$/, /^@toneclaw\//]

const failures = []

for (const name of purePackages) {
  const packageDir = resolve(root, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const deps = Object.keys(manifest.dependencies ?? {})
  if (deps.length > 0) failures.push(`@toneclaw/${name}: pure domain package must declare no runtime dependencies, got ${deps.join(', ')}`)
  scanSources(join(packageDir, 'src'), name)
}

function scanSources(directory, name) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (statSync(path).isDirectory()) { scanSources(path, name); continue }
    if (!/\.ts$/.test(entry.name)) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const match = line.match(/from\s+['"]([^'"]+)['"]/) ?? line.match(/import\s*\(\s*['"]([^'"]+)['"]/)
      if (match === null) return
      const spec = match[1]
      for (const pattern of forbiddenSourceImports) {
        if (pattern.test(spec)) failures.push(`packages/${name}/src/${entry.name}:${index + 1}: forbidden import "${spec}" (violates 08:28 invariants)`)
      }
    })
  }
}

if (failures.length > 0) {
  console.error('dependency direction violations:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`dependency direction ok: ${purePackages.length} pure package(s) free of Node/DB/UI/DSH dependencies`)
