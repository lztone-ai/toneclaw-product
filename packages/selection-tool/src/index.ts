/** Raw JSON-Schema tool: AI sourcing suggestions are observe-only and quota-gated. */
import { createHash } from 'node:crypto'
import { normalizeSelectionToolConfig, type SelectionToolConfig } from './config.ts'

export const name = 'selection-tool'
export const inject = ['tools', 'llm', 'billingAuthority', 'productApi']
export { normalizeSelectionToolConfig }
export type { SelectionToolConfig }

interface SourcingView {
  item: {
    id: string
    title: string
    status: string
    currency: string
    purchasePriceMinor: number
    suggestedRetailPriceMinor: number | null
    moq: number | null
    leadTimeDays: number | null
    stockStatus: string
    riskStatus: string
    categoryLabels: string[]
    complianceJson: string | null
  }
  decision: {
    id: string
    decision: 'approved' | 'rejected' | 'observing'
    reason: string
    decidedBy: 'user' | 'ai' | 'system'
    status: 'active' | 'superseded' | 'canceled'
  } | null
  scoresJson: string | null
  productCreated: boolean
}

interface ProductApi {
  getSourcingItemView(sourcingItemId: string, workspaceId?: string): Promise<SourcingView>
  recordAiSuggestion(input: {
    sourcingItemId: string
    reason: string
    scoresJson: string
  }): Promise<{ decision: { id: string } }>
}

interface BillingAuthority {
  reserve(input: {
    workspaceId: string
    scene: 'sourcing_analysis'
    model: string
    reservedInputTokens: number
    reservedOutputTokens: number
    idempotencyKey: string
    relatedObjectType?: string
    relatedObjectId?: string
  }): Promise<{ reservationId: string; deduplicated: boolean }>
  commit(reservationId: string, usage: {
    inputTokens: number
    outputTokens: number
    estimated: boolean
    costEstimateMinor?: number
    auditRef?: string
  }): Promise<{ id: string; status: string }>
  release(reservationId: string, reason: string): Promise<{ id: string; status: string }>
}

interface Suggestion {
  recommendation: 'observe'
  score: number
  summary: string
  risks: string[]
}

interface ToolOutput {
  sourcingItemId: string
  recommendation: 'observe'
  score: number
  summary: string
  risks: string[]
  usageRecordId: string | null
  decisionId: string | null
  persisted: boolean
  deduplicated: boolean
}

interface LlmStreamChunk {
  type: string
  text?: string
  usage?: { inputTokens?: unknown; outputTokens?: unknown }
  finish?: unknown
}

interface SelectionToolContext {
  tools?: { register(tool: unknown): () => void }
  llm?: {
    stream(options: {
      provider: string
      model: string
      system?: string
      messages: Array<{ role: 'user'; content: Array<{ type: 'text'; text: string }> }>
      maxTokens?: number
      signal?: AbortSignal
    }): AsyncIterable<LlmStreamChunk>
  }
  billingAuthority?: BillingAuthority
  productApi?: ProductApi
}

/** Register the suggestion tool. Raw schema means this tool owns argument validation. */
export function apply(ctx: SelectionToolContext, config: unknown): () => void {
  const normalized = normalizeSelectionToolConfig(config)
  if (ctx.tools === undefined || ctx.llm === undefined || ctx.billingAuthority === undefined || ctx.productApi === undefined) {
    throw new Error('selection-tool: tools, llm, billingAuthority, and productApi are required')
  }
  return ctx.tools.register({
    name: 'toneclaw_sourcing_advice',
    description: 'Generate an observe-only sourcing suggestion for one candidate. It never approves a selection.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['sourcingItemId'],
      properties: {
        sourcingItemId: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['sourcingItemId', 'recommendation', 'score', 'summary', 'risks', 'usageRecordId', 'decisionId', 'persisted', 'deduplicated'],
        properties: {
          sourcingItemId: { type: 'string' },
          recommendation: { type: 'string', enum: ['observe'] },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          summary: { type: 'string' },
          risks: { type: 'array', items: { type: 'string' } },
          usageRecordId: { type: ['string', 'null'] },
          decisionId: { type: ['string', 'null'] },
          persisted: { type: 'boolean' },
          deduplicated: { type: 'boolean' },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (rawArgs: unknown, execution: { signal: AbortSignal }) =>
      generateSuggestion(ctx, normalized, rawArgs, execution.signal),
  })
}

async function generateSuggestion(
  ctx: SelectionToolContext,
  config: SelectionToolConfig,
  rawArgs: unknown,
  signal: AbortSignal,
): Promise<ToolOutput> {
  if (typeof rawArgs !== 'object' || rawArgs === null) throw new Error('arguments must be an object')
  const args = rawArgs as Record<string, unknown>
  const sourcingItemId = args['sourcingItemId']
  if (typeof sourcingItemId !== 'string' || sourcingItemId === '' || sourcingItemId.length > 128) {
    throw new Error('sourcingItemId must be a non-empty string')
  }
  const view = await ctx.productApi!.getSourcingItemView(sourcingItemId, config.workspaceId)
  if (view.decision !== null && view.decision.decidedBy !== 'ai') {
    throw new Error('an active human decision already exists; AI cannot override it')
  }
  const existing = existingAiSuggestion(view)
  if (existing !== null) return existing
  if (view.item.status !== 'candidate') {
    throw new Error(`AI suggestions require candidate status, got ${view.item.status}`)
  }

  const prompt = buildPrompt(view)
  const idempotencyKey = `sourcing_analysis:${config.workspaceId}:${createHash('sha256').update(sourcingItemId).digest('hex')}`
  const reservation = await ctx.billingAuthority!.reserve({
    workspaceId: config.workspaceId,
    scene: 'sourcing_analysis',
    model: config.llmModel,
    reservedInputTokens: config.reservedInputTokens,
    reservedOutputTokens: config.reservedOutputTokens,
    idempotencyKey,
    relatedObjectType: 'SourcingItem',
    relatedObjectId: sourcingItemId,
  })
  try {
    const model = await callModel(ctx.llm!, config, prompt, signal)
    const usageRecord = await ctx.billingAuthority!.commit(reservation.reservationId, {
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      estimated: model.estimated,
      auditRef: reservation.reservationId,
    })
    const scoresJson = JSON.stringify({
      ...model.suggestion,
      model: config.llmModel,
      usageRecordId: usageRecord.id,
    })
    const decision = await ctx.productApi!.recordAiSuggestion({
      sourcingItemId,
      reason: model.suggestion.summary,
      scoresJson,
    })
    return {
      sourcingItemId,
      recommendation: model.suggestion.recommendation,
      score: model.suggestion.score,
      summary: model.suggestion.summary,
      risks: model.suggestion.risks,
      usageRecordId: usageRecord.id,
      decisionId: decision.decision.id,
      persisted: true,
      deduplicated: reservation.deduplicated,
    }
  } catch (error) {
    await ctx.billingAuthority!.release(
      reservation.reservationId,
      error instanceof Error ? error.message : 'sourcing suggestion failed',
    )
    throw error
  }
}

function existingAiSuggestion(view: SourcingView): ToolOutput | null {
  if (view.decision?.decidedBy !== 'ai' || view.decision.status !== 'active' || view.scoresJson === null) return null
  try {
    const scores = JSON.parse(view.scoresJson) as Partial<Suggestion> & { usageRecordId?: string }
    if (scores.recommendation !== 'observe' || typeof scores.score !== 'number'
      || typeof scores.summary !== 'string' || !Array.isArray(scores.risks)) return null
    return {
      sourcingItemId: view.item.id,
      recommendation: 'observe',
      score: scores.score,
      summary: scores.summary,
      risks: scores.risks.filter((risk): risk is string => typeof risk === 'string'),
      usageRecordId: typeof scores.usageRecordId === 'string' ? scores.usageRecordId : null,
      decisionId: view.decision.id,
      persisted: true,
      deduplicated: true,
    }
  } catch {
    return null
  }
}

function buildPrompt(view: SourcingView): string {
  const item = view.item
  const payload = {
    title: item.title,
    categories: item.categoryLabels,
    purchasePriceMinor: item.purchasePriceMinor,
    suggestedRetailPriceMinor: item.suggestedRetailPriceMinor,
    currency: item.currency,
    moq: item.moq,
    leadTimeDays: item.leadTimeDays,
    stockStatus: item.stockStatus,
    riskStatus: item.riskStatus,
    complianceJson: item.complianceJson,
  }
  return [
    ' Analyze this sourcing candidate for a cross-border seller. Consider margin, MOQ, delivery time, stock, compliance, and risk.',
    'Return only compact JSON with this exact shape:',
    '{"recommendation":"observe","score":0,"summary":"one sentence","risks":["short risk"]}',
    'recommendation must be observe. score must be 0-100. summary must be Chinese. Give zero to five Chinese risks.',
    JSON.stringify(payload),
  ].join('\n')
}

async function callModel(
  llm: NonNullable<SelectionToolContext['llm']>,
  config: SelectionToolConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<{ suggestion: Suggestion; inputTokens: number; outputTokens: number; estimated: boolean }> {
  let text = ''
  let usage: { inputTokens: number; outputTokens: number } | null = null
  let failed = false
  for await (const chunk of llm.stream({
    provider: config.llmProvider,
    model: config.llmModel,
    system: 'You are a cautious cross-border sourcing analyst. Respond with valid JSON only.',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: config.reservedOutputTokens,
    signal,
  })) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    if (chunk.type === 'usage' && chunk.usage !== undefined) {
      const inputTokens = Number(chunk.usage.inputTokens)
      const outputTokens = Number(chunk.usage.outputTokens)
      if (Number.isSafeInteger(inputTokens) && inputTokens >= 0
        && Number.isSafeInteger(outputTokens) && outputTokens >= 0) {
        usage = { inputTokens, outputTokens }
      }
    }
    if (chunk.type === 'finish' && chunk.finish === 'error') failed = true
  }
  if (failed) throw new Error('model stream failed')
  const estimated = usage === null
  const suggestion = parseSuggestion(text)
  return {
    suggestion,
    inputTokens: usage?.inputTokens ?? estimateTokens(prompt),
    outputTokens: usage?.outputTokens ?? estimateTokens(text),
    estimated,
  }
}

function parseSuggestion(text: string): Suggestion {
  const jsonText = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('model output is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('model output must be an object')
  const value = parsed as Record<string, unknown>
  if (value['recommendation'] !== 'observe') throw new Error('model suggestions cannot approve or reject')
  const score = value['score']
  const summary = value['summary']
  const risks = value['risks']
  if (typeof score !== 'number' || !Number.isSafeInteger(score) || score < 0 || score > 100) {
    throw new Error('model score must be an integer from 0 to 100')
  }
  if (typeof summary !== 'string' || summary.trim() === '' || summary.length > 500) {
    throw new Error('model summary must be 1-500 characters')
  }
  if (!Array.isArray(risks) || risks.length > 5 || risks.some(risk => typeof risk !== 'string' || risk.length > 200)) {
    throw new Error('model risks must contain at most five short strings')
  }
  return {
    recommendation: 'observe',
    score,
    summary: summary.trim(),
    risks: risks.map(risk => String(risk).trim()).filter(risk => risk !== ''),
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4))
}
