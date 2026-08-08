import nextPlugin from 'eslint-config-next';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'node_modules/**',
      'prisma/migrations/**',
      'next-env.d.ts',
    ],
  },
  ...nextPlugin,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react/no-danger': 'error',
      // This codebase deliberately uses plain useEffect + useState for data
      // fetching (no React Query/SWR in the approved stack) — that pattern
      // inherently sets loading/error/data state from inside an effect.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: [
      'src/test/**/*.ts',
      'src/test/**/*.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      'e2e/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
