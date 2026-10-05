import { describe, expect, it } from 'vitest'
import { normalizeBillingHostConfig } from '../src/config.ts'

describe('normalizeBillingHostConfig', () => {
  it('resolves provided paths and defaults the workspace id', () => {
    const config = normalizeBillingHostConfig({ dbPath: 'data/billing.sqlite', dataDir: 'data' })
    expect(config.workspaceId).toBe('workspace-local')
    expect(config.dbPath.endsWith('billing.sqlite')).toBe(true)
    expect(config.dataDir.endsWith('data')).toBe(true)
  })

  it('rejects missing paths', () => {
    expect(() => normalizeBillingHostConfig({ dataDir: 'data' })).toThrow('dbPath')
    expect(() => normalizeBillingHostConfig({ dbPath: 'x.sqlite' })).toThrow('dataDir')
    expect(() => normalizeBillingHostConfig(null)).toThrow('must be an object')
  })
})
