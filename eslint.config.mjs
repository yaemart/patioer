import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'paperclip/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      // Tenant business queries should run through request.withDb (withTenantDb),
      // not the global db connection.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@patioer/db',
              importNames: ['db'],
              message: 'Use request.withDb()/withTenantDb for tenant-scoped queries.',
            },
          ],
        },
      ],
    },
  },
]
