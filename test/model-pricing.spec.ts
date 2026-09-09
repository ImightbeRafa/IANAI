import { describe, expect, it } from 'vitest'
import {
  estimateApiCostUsd,
  estimateGptImageCostUsd,
  modelPriceLabel,
} from '../api/lib/model-pricing'

describe('estimateApiCostUsd', () => {
  it('prices cached Grok 4.6 tokens at the official cached rate', () => {
    expect(
      estimateApiCostUsd({
        model: 'grok-4.6',
        inputTokens: 100_000,
        outputTokens: 0,
        cachedTokens: 40_000,
      })
    ).toBe(0.14)
  })

  it('falls back to stored Grok cost only when no tokens exist', () => {
    expect(
      estimateApiCostUsd({
        model: 'grok-4.6',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0.22,
      })
    ).toBe(0.22)
  })
})

describe('estimateGptImageCostUsd', () => {
  it('returns undefined when usage is empty', () => {
    expect(estimateGptImageCostUsd({})).toBeUndefined()
  })
})

describe('modelPriceLabel', () => {
  it('maps imagine variants to the Imagine 2.0 list line', () => {
    expect(modelPriceLabel('grok-imagine-image-2.0')).toContain('$0.04')
  })
})
