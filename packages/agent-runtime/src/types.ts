export interface LlmParams {
  prompt: string
}

export interface LlmResponse {
  text: string
}

export interface ApprovalRequest {
  action: string
  payload: unknown
  reason: string
}

export interface TicketParams {
  title: string
  body: string
}
