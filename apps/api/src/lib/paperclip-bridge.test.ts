import { describe, expect, it, vi } from 'vitest'

const { mockPaperclipCtor } = vi.hoisted(() => ({
  mockPaperclipCtor: vi.fn(),
}))

vi.mock('@patioer/agent-runtime', () => ({
  PaperclipBridge: class {
    constructor(config: unknown) {
      mockPaperclipCtor(config)
    }
  },
}))

import {
  createPaperclipBridgeFromEnv,
  getPaperclipBridgeConfigFromEnv,
} from './paperclip-bridge.js'

describe('paperclip bridge env helpers', () => {
  it('returns null when required env vars are missing', () => {
    const config = getPaperclipBridgeConfigFromEnv({})
    expect(config).toBeNull()
  })

  it('builds config from env with defaults', () => {
    const config = getPaperclipBridgeConfigFromEnv({
      PAPERCLIP_API_URL: 'http://paperclip.local',
      PAPERCLIP_API_KEY: 'key-1',
    })
    expect(config).toEqual({
      baseUrl: 'http://paperclip.local',
      apiKey: 'key-1',
      timeoutMs: 5000,
      maxRetries: 2,
      retryBaseMs: 200,
    })
  })

  it('uses numeric overrides and falls back on invalid numbers', () => {
    const config = getPaperclipBridgeConfigFromEnv({
      PAPERCLIP_API_URL: 'http://paperclip.local',
      PAPERCLIP_API_KEY: 'key-1',
      PAPERCLIP_TIMEOUT_MS: '7000',
      PAPERCLIP_MAX_RETRIES: 'bad',
      PAPERCLIP_RETRY_BASE_MS: '-1',
    })
    expect(config).toEqual({
      baseUrl: 'http://paperclip.local',
      apiKey: 'key-1',
      timeoutMs: 7000,
      maxRetries: 2,
      retryBaseMs: 200,
    })
  })

  it('creates PaperclipBridge instance when config exists', () => {
    const bridge = createPaperclipBridgeFromEnv({
      PAPERCLIP_API_URL: 'http://paperclip.local',
      PAPERCLIP_API_KEY: 'key-1',
      PAPERCLIP_TIMEOUT_MS: '6000',
      PAPERCLIP_MAX_RETRIES: '3',
      PAPERCLIP_RETRY_BASE_MS: '250',
    })
    expect(bridge).toBeTruthy()
    expect(mockPaperclipCtor).toHaveBeenCalledWith({
      baseUrl: 'http://paperclip.local',
      apiKey: 'key-1',
      timeoutMs: 6000,
      maxRetries: 3,
      retryBaseMs: 250,
    })
  })
})
