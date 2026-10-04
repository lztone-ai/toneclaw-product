import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(packageRoot, 'src')
const target = join(packageRoot, 'dist')

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const entry of readdirSync(source)) {
  if (!statSync(join(source, entry)).isFile()) continue
  cpSync(join(source, entry), join(target, entry))
}

console.log(`desktop-ui: ${readdirSync(target).length} document(s) -> dist/`)
