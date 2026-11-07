import { describe, expect, it } from 'vitest'
import { restoredCloudParallel } from '../src/shared/cloudRuntime'

describe('云端并发迁移', () => {
  it('旧版从本地遗留的共享并发 1 恢复原版默认 30', () => {
    expect(restoredCloudParallel({ selectedApi: { provider: 'ollama', parallel: 1 } })).toBe(30)
    expect(restoredCloudParallel({ selectedApi: { provider: 'openai_compatible', parallel: 1 } })).toBe(30)
  })
  it('保留旧云端自定义并发及新字段明确选择的并发 1', () => {
    expect(restoredCloudParallel({ selectedApi: { provider: 'openai_compatible', parallel: 7 } })).toBe(7)
    expect(restoredCloudParallel({ cloudParallel: 1, selectedApi: { provider: 'ollama', parallel: 1 } })).toBe(1)
  })
  it('损坏或越界值不进入任务队列', () => {
    for (const cloudParallel of [0, -1, 101, '30', null]) expect(restoredCloudParallel({ cloudParallel })).toBe(30)
  })
})
