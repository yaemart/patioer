import { describe, expect, it } from 'vitest'
import { previewPromptForLlmStub } from './agents-execute.js'

describe('previewPromptForLlmStub', () => {
  it('returns empty string when params is null or undefined', () => {
    expect(previewPromptForLlmStub(null)).toBe('')
    expect(previewPromptForLlmStub(undefined)).toBe('')
  })

  it('returns empty string when params is not a plain object', () => {
    expect(previewPromptForLlmStub('hello')).toBe('')
    expect(previewPromptForLlmStub(42)).toBe('')
    expect(previewPromptForLlmStub(true)).toBe('')
  })

  it('returns empty string when prompt is missing null or undefined', () => {
    expect(previewPromptForLlmStub({})).toBe('')
    expect(previewPromptForLlmStub({ prompt: null })).toBe('')
    expect(previewPromptForLlmStub({ prompt: undefined })).toBe('')
  })

  it('truncates string prompts to 80 chars', () => {
    const long = 'a'.repeat(100)
    expect(previewPromptForLlmStub({ prompt: long })).toBe('a'.repeat(80))
    expect(previewPromptForLlmStub({ prompt: 'short' })).toBe('short')
  })

  it('stringifies non-string prompt without throwing', () => {
    expect(previewPromptForLlmStub({ prompt: 12345 })).toBe('12345')
    expect(previewPromptForLlmStub({ prompt: { nested: true } })).toBe('[object Object]')
  })
})
