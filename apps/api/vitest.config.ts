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
