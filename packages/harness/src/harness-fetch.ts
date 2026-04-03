import { HarnessError, httpStatusToCode } from './harness-error.js'
import { type TokenBucketConfig, getSharedBucket, jitteredBackoff, sleep } from './token-bucket.js'

export interface ResilientFetchOpts {
  platform: string
  bucketKey: string
  bucketConfig: TokenBucketConfig
  maxRetries: number
  baseDelayMs: number
  timeoutMs: number
  label: string
}

/**
 * Shared retry loop for Amazon Harness implementations.
 * Handles rate-limiting (TokenBucket), jittered backoff, AbortSignal timeout,
 * and maps failures to typed HarnessError.
 */
export async function resilientFetch<T>(
  url: string,
  init: RequestInit | undefined,
  opts: ResilientFetchOpts,
  parseOk: (res: Response) => Promise<T> = async (res) => (await res.json()) as T,
): Promise<T> {
  const bucket = getSharedBucket(opts.bucketKey, opts.bucketConfig)

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    await bucket.acquire()
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: { ...init?.headers },
      })
    } catch (error) {
      if (attempt < opts.maxRetries) { await sleep(jitteredBackoff(attempt, opts.baseDelayMs)); continue }
      throw new HarnessError(opts.platform, 'network_error', `${opts.label} network error: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (response.ok) return parseOk(response)
    if ((response.status === 429 || response.status >= 500) && attempt < opts.maxRetries) {
      await sleep(jitteredBackoff(attempt, opts.baseDelayMs))
      continue
    }
    throw new HarnessError(opts.platform, httpStatusToCode(response.status), `${opts.label} ${response.status} for ${url}`)
  }
  throw new HarnessError(opts.platform, 'max_retries', `${opts.label} max retries for ${url}`)
}
