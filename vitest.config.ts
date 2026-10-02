import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 10000, coverage: { provider: 'v8', include: ['src/core/**/*.ts', 'src/host/**/*.ts'], reporter: ['text', 'json-summary'] } } })
