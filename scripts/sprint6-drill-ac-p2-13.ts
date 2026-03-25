import { createServer } from 'node:http'
import {
  FIXTURE_HARNESS_ERROR_FIRING,
  createDevOsClient,
  runAlertmanagerPipeline,
} from '@patioer/devos-bridge'

type CapturedTicket = {
  type?: string
  priority?: string
  title?: string
}

async function main() {
  const captured: CapturedTicket[] = []
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/devos/tickets') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { ticket?: CapturedTicket }
          captured.push(parsed.ticket ?? {})
        } catch {
          captured.push({})
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ticketId: `drill-${captured.length}` }))
      })
      return
    }

    res.statusCode = 404
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(3902, resolve))
  try {
    const client = createDevOsClient({ baseUrl: 'http://127.0.0.1:3902' })
    const result = await runAlertmanagerPipeline({
      body: FIXTURE_HARNESS_ERROR_FIRING,
      client,
    })

    const first = captured[0]
    const passed =
      result.webhookResult.created === 1 &&
      result.webhookResult.errors.length === 0 &&
      first?.priority === 'P0' &&
      first?.type === 'harness_update'

    const output = {
      passed,
      created: result.webhookResult.created,
      errors: result.webhookResult.errors.length,
      ticketIds: result.webhookResult.ticketIds,
      capturedTicket: first ?? null,
      suggestions: result.suggestions,
    }

    console.log(JSON.stringify(output, null, 2))
    if (!passed) process.exit(1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

main().catch((err) => {
  console.error('[ac-p2-13-drill] failed:', err)
  process.exit(1)
})
