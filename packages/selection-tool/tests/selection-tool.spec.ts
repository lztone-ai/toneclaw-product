import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

const config = {
  workspaceId: 'workspace-1',
  llmProvider: 'test-provider',
  llmModel: 'test-model',
  reservedInputTokens: 100,
  reservedOutputTokens: 100,
}

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    item: {
      id: 'item-1',
      title: 'Ceramic mug',
      status: 'candidate',
      currency: 'USD',
      purchasePriceMinor: 4500,
      suggestedRetailPriceMinor: 8900,
      moq: 1,
      leadTimeDays: 7,
      stockStatus: 'available',
      riskStatus: 'unknown',
      categoryLabels: ['Home'],
      complianceJson: null,
    },
    decision: null,
    scoresJson: null,
    productCreated: false,
    ...overrides,
  }
}

function makeHarness({ chunks = [] as any[], view = makeView() as any, persistError = undefined as unknown } = {}) {
  const registered: any[] = []
  const authority = {
    validateFeature: vi.fn(async () => ({ featureKey: 'ai.generation', allowed: true })),
    reserve: vi.fn(async () => ({ reservationId: 'usage-1', deduplicated: false })),
    commit: vi.fn(async () => ({ id: 'usage-1', status: 'Succeeded' })),
    release: vi.fn(async () => ({ id: 'usage-1', status: 'Failed' })),
  }
  const productApi = {
    getSourcingItemView: vi.fn(async () => view),
    recordAiSuggestion: vi.fn(async () => {
      if (persistError !== undefined) throw persistError
      return { decision: { id: 'decision-1' } }
    }),
  }
  const llm = {
    stream: vi.fn(async function * () {
      for (const chunk of chunks) yield chunk
    }),
  }
  const ctx = {
    tools: { register: vi.fn((tool: any) => { registered.push(tool); return () => undefined }) },
    llm,
    billingAuthority: authority,
    productApi,
  }
  apply(ctx as any, config)
  expect(registered).toHaveLength(1)
  return { tool: registered[0]!, authority, productApi, llm }
}

describe('AI sourcing suggestion tool', () => {
  it('never overrides an active human decision', async () => {
    const view = makeView({
      decision: {
        id: 'decision-user',
        decision: 'observing',
        reason: 'seller marked observing',
        decidedBy: 'user',
        status: 'active',
      },
    })
    const { tool, authority } = makeHarness({ view })
    await expect(tool.execute({ sourcingItemId: 'item-1' }, { signal: new AbortController().signal }))
      .rejects.toThrow('active human decision already exists')
    expect(authority.reserve).not.toHaveBeenCalled()
  })

  it('blocks model calls when ai.generation is not entitled', async () => {
    const { tool, authority, llm } = makeHarness()
    authority.validateFeature.mockResolvedValueOnce({
      featureKey: 'ai.generation', allowed: false,
    })
    await expect(tool.execute({ sourcingItemId: 'item-1' }, { signal: new AbortController().signal }))
      .rejects.toThrow('subscription feature blocked: ai.generation')
    expect(authority.reserve).not.toHaveBeenCalled()
    expect(llm.stream).not.toHaveBeenCalled()
  })

  it('reserves quota, commits actual usage, and persists an observe-only decision', async () => {
    const { tool, authority, productApi, llm } = makeHarness({
      chunks: [
        { type: 'text-delta', text: '{"recommendation":"observe","score":78,"summary":"毛利健康，MOQ 低。","risks":[" compliance unknown"]}' },
        { type: 'usage', usage: { inputTokens: 120, outputTokens: 35 } },
        { type: 'finish', finish: 'stop' },
      ],
    })
    const output = await tool.execute({ sourcingItemId: 'item-1' }, { signal: new AbortController().signal })

    expect(output).toMatchObject({
      recommendation: 'observe',
      score: 78,
      usageRecordId: 'usage-1',
      decisionId: 'decision-1',
      persisted: true,
      deduplicated: false,
    })
    expect(authority.reserve).toHaveBeenCalledWith(expect.objectContaining({
      scene: 'sourcing_analysis',
      relatedObjectType: 'SourcingItem',
      relatedObjectId: 'item-1',
    }))
    expect(authority.commit).toHaveBeenCalledWith('usage-1', expect.objectContaining({
      inputTokens: 120,
      outputTokens: 35,
      estimated: false,
    }))
    expect(productApi.recordAiSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      sourcingItemId: 'item-1',
      scoresJson: expect.stringContaining('"usageRecordId":"usage-1"'),
    }))
    expect(llm.stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'test-model', maxTokens: 100 }))
  })

  it('releases the reservation when the model fails and never persists a suggestion', async () => {
    const { tool, authority, productApi } = makeHarness({
      chunks: [{ type: 'finish', finish: 'error' }],
    })
    await expect(tool.execute({ sourcingItemId: 'item-1' }, { signal: new AbortController().signal }))
      .rejects.toThrow('model stream failed')
    expect(authority.release).toHaveBeenCalledWith('usage-1', 'model stream failed')
    expect(productApi.recordAiSuggestion).not.toHaveBeenCalled()
  })

  it('returns the existing active AI suggestion without spending quota again', async () => {
    const suggestion = {
      recommendation: 'observe',
      score: 64,
      summary: '已有建议',
      risks: [],
      usageRecordId: 'usage-old',
    }
    const view = makeView({
      decision: {
        id: 'decision-old',
        decision: 'observing',
        reason: '已有建议',
        decidedBy: 'ai',
        status: 'active',
      },
      scoresJson: JSON.stringify(suggestion),
    })
    const { tool, authority } = makeHarness({ view })
    const output = await tool.execute({ sourcingItemId: 'item-1' }, { signal: new AbortController().signal })

    expect(output).toMatchObject({ usageRecordId: 'usage-old', decisionId: 'decision-old', deduplicated: true })
    expect(authority.reserve).not.toHaveBeenCalled()
  })

  it('releases quota when persistence fails after a successful model response', async () => {
    const { tool, authority, productApi } = makeHarness({
      chunks: [
        { type: 'text-delta', text: '{"recommendation":"observe","score":50,"summary":"可行","risks":[]}' },
        { type: 'usage', usage: { inputTokens: 80, outputTokens: 20 } },
        { type: 'finish', finish: 'stop' },
      ],
      persistError: new Error('storage unavailable'),
    })
    await expect(tool.execute({ sourcingItemId: 'item-1' }, { signal: new AbortController().signal }))
      .rejects.toThrow('storage unavailable')
    expect(authority.release).toHaveBeenCalledWith('usage-1', 'storage unavailable')
    expect(productApi.recordAiSuggestion).toHaveBeenCalledTimes(1)
  })
})
