import { PaperclipBridge } from '@patioer/agent-runtime'

export interface PaperclipBridgeConfig {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  maxRetries: number
  retryBaseMs: number
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 200

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function getPaperclipBridgeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PaperclipBridgeConfig | null {
  const baseUrl = env.PAPERCLIP_API_URL
  const apiKey = env.PAPERCLIP_API_KEY
  if (!baseUrl || !apiKey) return null

  return {
    baseUrl,
    apiKey,
    timeoutMs: parsePositiveInt(env.PAPERCLIP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: parsePositiveInt(env.PAPERCLIP_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    retryBaseMs: parsePositiveInt(env.PAPERCLIP_RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS),
  }
}

export function createPaperclipBridgeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PaperclipBridge | null {
  const config = getPaperclipBridgeConfigFromEnv(env)
  if (!config) return null
  return new PaperclipBridge(config)
}
