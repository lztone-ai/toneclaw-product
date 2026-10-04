import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const uiDist = resolve(root, 'packages/desktop-ui/dist')

// Engine internals must never surface in product copy; URL tokens (for example
// the application document entry) are excluded from the scan.
const forbidden = [/dsh/i, /deepseek/i, /harness/i, /cordis/i, /webhook/i, /plugin/i, /runtime/i, /session/i]
const urlToken = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"<>)]+/g

if (statSync(uiDist, { throwIfNoEntry: false })?.isDirectory() !== true) {
  console.error(`desktop UI build missing: ${uiDist}; run pnpm run build first`)
  process.exit(1)
}

const failures = []
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { scan(path); continue }
    if (!/\.(html|css|js)$/.test(entry.name)) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const visible = line.replace(urlToken, '')
      for (const pattern of forbidden) {
        if (pattern.test(visible)) failures.push(`${path}:${index + 1}: /${pattern.source}/ matched "${visible.trim().slice(0, 120)}"`)
      }
    })
  }
}

scan(uiDist)
if (failures.length > 0) {
  console.error('product UI copy violations:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('product UI copy ok: no engine vocabulary in user-visible documents')
