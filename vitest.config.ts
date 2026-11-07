import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 上游 .js/.cjs 是独立 Node 验证脚本，不含 Vitest suite，另行执行。
    include: ['__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: true,
    environment: 'node'
  }
})
