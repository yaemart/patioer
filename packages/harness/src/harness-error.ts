/**
 * Well-known error codes emitted by harness implementations.
 * HTTP status codes are kept as numeric strings for direct pass-through.
 * Semantic codes describe categories the caller should branch on.
 */
const HTTP_STATUS_CODES = ['400', '401', '403', '404', '429', '500', '502', '503'] as const
type HttpStatusCode = (typeof HTTP_STATUS_CODES)[number]

export type HarnessErrorCode =
  | HttpStatusCode
  | 'auth_failed'
  | 'network_error'
  | 'max_retries'
  | 'not_implemented'
  | 'variant_not_found'
  | 'location_not_found'
  | 'json_parse_error'
  | 'business_error'
  | 'invalid_param'
  | 'insufficient_stock'
  | 'product_not_found'

const httpStatusSet = new Set<string>(HTTP_STATUS_CODES)

/** Maps a numeric HTTP status to a typed HarnessErrorCode, defaulting to '500' for unknowns. */
export function httpStatusToCode(status: number): HarnessErrorCode {
  const str = String(status)
  return httpStatusSet.has(str) ? (str as HttpStatusCode) : '500'
}

/**
 * Structured error thrown by PlatformHarness implementations.
 * Maps to the Constitution §4.3 `harness_error` AgentError variant,
 * enabling callers to programmatically distinguish platform failures
 * (rate-limited, auth expired, resource not found, etc.).
 */
export class HarnessError extends Error {
  readonly type = 'harness_error' as const

  constructor(
    readonly platform: string,
    readonly code: HarnessErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HarnessError'
  }
}
