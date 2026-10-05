export interface SelectionToolConfig {
  workspaceId: string
  llmProvider: string
  llmModel: string
  reservedInputTokens: number
  reservedOutputTokens: number
}

/** Validate model route and quota bounds for the observe-only sourcing suggestion. */
export function normalizeSelectionToolConfig(config: unknown): SelectionToolConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('selection-tool: config must be an object')
  }
  const raw = config as Record<string, unknown>
  const workspaceId = raw['workspaceId'] ?? 'workspace-local'
  const llmProvider = raw['llmProvider'] ?? 'deepseek-official'
  const llmModel = raw['llmModel'] ?? 'deepseek-v4-flash'
  const reservedInputTokens = optionalInteger(raw['reservedInputTokens'], 1200)
  const reservedOutputTokens = optionalInteger(raw['reservedOutputTokens'], 800)
  if (typeof workspaceId !== 'string' || workspaceId === '') {
    throw new Error('selection-tool: workspaceId must be a non-empty string')
  }
  if (typeof llmProvider !== 'string' || llmProvider === '') {
    throw new Error('selection-tool: llmProvider must be a non-empty string')
  }
  if (typeof llmModel !== 'string' || llmModel === '') {
    throw new Error('selection-tool: llmModel must be a non-empty string')
  }
  const tokenBounds: Array<[string, number]> = [
    ['reservedInputTokens', reservedInputTokens],
    ['reservedOutputTokens', reservedOutputTokens],
  ]
  for (const [name, value] of tokenBounds) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 100 || value > 100_000) {
      throw new Error(`selection-tool: ${name} must be an integer from 100 to 100000`)
    }
  }
  return {
    workspaceId,
    llmProvider,
    llmModel,
    reservedInputTokens,
    reservedOutputTokens,
  }
}

function optionalInteger(value: unknown, fallback: number): number {
  return value === undefined ? fallback : value as number
}
