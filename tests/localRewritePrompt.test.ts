import { describe, it, expect } from 'vitest'
import { LOCAL_REWRITE_PROMPT, localRewritePrompt } from '../src/main/localRewritePrompt'
import { REDUCE_AI_RATE_SYSTEM_PROMPT } from '../src/shared/prompts/zh-CN'
import { normalizeLocalSettings } from '../src/shared/localEdition'

describe('本地小模型文档提示与兼容', () => {
  it('未明确选择简洁编辑时默认沿用原版降 AI 提示', () => {
    for (const documentPromptMode of [undefined, null, 'invalid']) {
      const settings = normalizeLocalSettings({ contextLength: 16384, maxTokens: 8192, documentPromptMode })
      expect(settings.documentPromptMode).toBe('original')
      expect(localRewritePrompt(REDUCE_AI_RATE_SYSTEM_PROMPT, REDUCE_AI_RATE_SYSTEM_PROMPT, settings.documentPromptMode)).toBe(REDUCE_AI_RATE_SYSTEM_PROMPT)
    }
  })
  it('明确选择简洁编辑时仍保留短提示和事实约束', () => {
    const settings = normalizeLocalSettings({ contextLength: 16384, maxTokens: 8192, documentPromptMode: 'compact' })
    const prompt = localRewritePrompt(REDUCE_AI_RATE_SYSTEM_PROMPT, REDUCE_AI_RATE_SYSTEM_PROMPT, settings.documentPromptMode)
    expect(prompt).toBe(LOCAL_REWRITE_PROMPT)
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThan(600)
    expect(prompt).toContain('否定条件')
    expect(prompt).toContain('公式与脚注标记逐字保留')
  })
  it('用户可选择并持久化原版提示，不修改原版提示常量', () => {
    const settings = normalizeLocalSettings({ documentPromptMode: 'original' })
    expect(localRewritePrompt(REDUCE_AI_RATE_SYSTEM_PROMPT, REDUCE_AI_RATE_SYSTEM_PROMPT, settings.documentPromptMode)).toBe(REDUCE_AI_RATE_SYSTEM_PROMPT)
    expect(Buffer.byteLength(REDUCE_AI_RATE_SYSTEM_PROMPT, 'utf8')).toBeGreaterThan(6000)
  })
  it('不覆盖自定义提示或英文提示', () => {
    for (const prompt of ['按企业规范保留系统名称与操作步骤。', 'Rewrite the target paragraph.']) {
      expect(localRewritePrompt(prompt, REDUCE_AI_RATE_SYSTEM_PROMPT, 'compact')).toBe(prompt)
    }
  })
})
