export type PaperclipErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'invalid_response'
  | 'unknown'

export class PaperclipBridgeError extends Error {
  readonly code: PaperclipErrorCode
  readonly status?: number
  readonly details?: unknown

  constructor(
    message: string,
    options: { code: PaperclipErrorCode; status?: number; details?: unknown },
  ) {
    super(message)
    this.name = 'PaperclipBridgeError'
    this.code = options.code
    this.status = options.status
    this.details = options.details
  }
}
