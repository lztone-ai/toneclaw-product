import { isAbsolute, resolve } from 'node:path'

export interface ProductHostConfig {
  dbPath: string
  dataDir: string
  importDir: string
  workspaceId: string
  createdBy: string
  supplierCountry: string
  stabilityDelayMs: number
  pollIntervalMs: number
}

/** Validate absolute product-owned paths; the caller must inject them from the product data root. */
export function normalizeProductHostConfig(config: unknown): ProductHostConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('product-host: config must be an object with dbPath, dataDir, and importDir')
  }
  const raw = config as Record<string, unknown>
  const pathNames = ['dbPath', 'dataDir', 'importDir'] as const
  for (const name of pathNames) {
    const value = raw[name]
    if (typeof value !== 'string' || value.trim() === '' || !isAbsolute(value)) {
      throw new Error(`product-host: config.${name} must be an absolute string path`)
    }
  }
  const workspaceId = raw['workspaceId'] ?? 'workspace-local'
  const createdBy = raw['createdBy'] ?? 'toneclaw-operation'
  const supplierCountry = raw['supplierCountry'] ?? 'CN'
  const stabilityDelayMs = raw['stabilityDelayMs'] ?? 75
  const pollIntervalMs = raw['pollIntervalMs'] ?? 1000
  if (typeof workspaceId !== 'string' || workspaceId === '') throw new Error('product-host: workspaceId must be non-empty')
  if (typeof createdBy !== 'string' || createdBy === '') throw new Error('product-host: createdBy must be non-empty')
  if (typeof supplierCountry !== 'string' || supplierCountry === '') throw new Error('product-host: supplierCountry must be non-empty')
  if (typeof stabilityDelayMs !== 'number' || !Number.isFinite(stabilityDelayMs) || stabilityDelayMs < 0) {
    throw new Error('product-host: stabilityDelayMs must be a non-negative number')
  }
  if (typeof pollIntervalMs !== 'number' || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 100) {
    throw new Error('product-host: pollIntervalMs must be at least 100')
  }
  return {
    dbPath: resolve(raw['dbPath'] as string),
    dataDir: resolve(raw['dataDir'] as string),
    importDir: resolve(raw['importDir'] as string),
    workspaceId,
    createdBy,
    supplierCountry,
    stabilityDelayMs,
    pollIntervalMs,
  }
}
