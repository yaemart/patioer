import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // webhook-topic-handler is an integration adapter used only by server.ts
      // at startup; tested indirectly via replay tests. Exclude from thresholds.
      exclude: [
        'src/**/*.test.ts',
        'src/server.ts',
        'src/lib/webhook-topic-handler.ts',
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
