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
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HarnessError'
  }
}
