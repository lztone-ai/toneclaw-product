import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LocalBillingAuthority } from './authority.ts'

export interface ExportBundle {
  schemaVersion: 1
  exportedAt: string
  workspaceId: string
  subscription: ReturnType<LocalBillingAuthority['currentSubscription']>
  quotas: ReturnType<LocalBillingAuthority['currentQuota']>[]
  usageRecords: ReturnType<LocalBillingAuthority['usageRecords']>
  auditEvents: ReturnType<LocalBillingAuthority['auditEvents']>
}

/** Build the portable export bundle (S1 导出兜底: no cloud backup, export is the fallback). */
export function buildExportBundle(authority: LocalBillingAuthority, workspaceId: string): ExportBundle {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workspaceId,
    subscription: authority.currentSubscription(workspaceId),
    quotas: authority.quotas(workspaceId),
    usageRecords: authority.usageRecords(workspaceId),
    auditEvents: authority.auditEvents(workspaceId, 1_000),
  }
}

/** Atomically write the export bundle as JSON to `outPath`. */
export function writeExportBundle(
  authority: LocalBillingAuthority,
  workspaceId: string,
  outPath: string,
): string {
  mkdirSync(dirname(outPath), { recursive: true })
  const staging = join(dirname(outPath), `.${basename(outPath)}.${process.pid}.tmp`)
  writeFileSync(staging, `${JSON.stringify(buildExportBundle(authority, workspaceId), null, 2)}\n`, 'utf8')
  renameSync(staging, outPath)
  return outPath
}

function basename(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}
