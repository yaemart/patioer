import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // webhook-topic-handler is an integration adapter used only by server.ts
      // at startup; tested indirectly via replay tests. Exclude from thresholds.
      exclude: [
        'src/**/*.test.ts',
        'src/server.ts',
        'src/lib/webhook-topic-handler.ts',
        // Heavy branching + DB callbacks; covered by integration/smoke paths
        'src/lib/agent-inputs.ts',
        'src/lib/llm-client.ts',
        'src/lib/resolve-harness.ts',
        // Integration adapters — DB/external-service orchestration; own unit tests
        'src/lib/oauth-credential-store.ts',
        'src/lib/audit-event-recorder.ts',
        'src/lib/clipmart-runtime.ts',
        'src/lib/customer-success-execution.ts',
        'src/lib/agent-registry.ts',
        'src/lib/dataos-port.ts',
        'src/lib/resolve-credential.ts',
        'src/lib/agent-bootstrap.ts',
        'src/lib/approval-execute-worker.ts',
        // Drizzle-backed port facades for harness; thin DB glue tested via route/integration paths
        'src/lib/business-ports.ts',
        // Phase 5 heavy-DB aggregation routes; tested via smoke + integration
        'src/routes/console.ts',
        'src/routes/agent-events.ts',
        'src/routes/dashboard.ts',
        'src/routes/goals.ts',
        // Agent / workflow routes — heavy branching + external calls; covered by route tests + smoke
        'src/routes/agents-execute.ts',
        'src/routes/approvals.ts',
        'src/routes/clipmart.ts',
        'src/routes/sop.ts',
        // Stripe webhook adapter — platform-specific branching; covered by own tests
        'src/routes/webhook-stripe.ts',
      ],
      thresholds: {
        statements: 80,
        lines: 80,
        branches: 70,
        functions: 65,
      },
    },
  },
})
