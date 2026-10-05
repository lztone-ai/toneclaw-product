import { resolve } from 'node:path'

export interface BillingHostConfig {
  dbPath: string
  dataDir: string
  workspaceId: string
}

/** Validate and resolve plugin config; both paths are required absolute host paths. */
export function normalizeBillingHostConfig(config: unknown): BillingHostConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('billing-host: config must be an object with dbPath and dataDir')
  }
  const raw = config as Record<string, unknown>
  const dbPath = raw.dbPath
  const dataDir = raw.dataDir
  const workspaceId = raw.workspaceId ?? 'workspace-local'
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new Error('billing-host: config.dbPath must be a non-empty string')
  }
  if (typeof dataDir !== 'string' || dataDir.trim() === '') {
    throw new Error('billing-host: config.dataDir must be a non-empty string')
  }
  if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
    throw new Error('billing-host: config.workspaceId must be a non-empty string')
  }
  return { dbPath: resolve(dbPath), dataDir: resolve(dataDir), workspaceId }
}
