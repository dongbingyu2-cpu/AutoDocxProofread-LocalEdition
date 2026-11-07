import { describe, it, expect } from 'vitest'
import { buildRewriteMessage, planLocalRewrite, splitTextToFit, fitLocalRewriteOutputBudget } from '../src/main/localPromptBudget'
import { REDUCE_AI_RATE_SYSTEM_PROMPT } from '../src/shared/prompts/zh-CN'
import { QUALITY_REVIEW_PROMPT } from '../src/main/rewriteQuality'

const budget = { context: 16384, inputBytes: 16384 - 4096 - 256, maxTokens: 4096 }
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

describe('本地文档提示词预算', () => {
  it('8K/2048 原版提示自动使用较小单次输出上限，不增大用户上下文', () => {
    const requested = { context: 8192, maxTokens: 2048, inputBytes: 5888 }
    const fitted = fitLocalRewriteOutputBudget(REDUCE_AI_RATE_SYSTEM_PROMPT, requested)
    expect(fitted).toMatchObject({ context: 8192, maxTokens: 1024, inputBytes: 6912 })
    expect(requested).toEqual({ context: 8192, maxTokens: 2048, inputBytes: 5888 })
    const target = '系统通过本地模型处理文档，原始文件保持独立保存。'.repeat(15)
    const parts = planLocalRewrite(REDUCE_AI_RATE_SYSTEM_PROMPT, target, '', '', fitted)
    expect(parts.map(p => p.original).join('')).toBe(target)
    expect(parts.every(p => bytes(REDUCE_AI_RATE_SYSTEM_PROMPT + p.message) + fitted.maxTokens + 256 <= fitted.context)).toBe(true)
  })
  it('原本能容纳提示的默认配置、短提示和较小输出上限不变', () => {
    expect(fitLocalRewriteOutputBudget(REDUCE_AI_RATE_SYSTEM_PROMPT, budget)).toBe(budget)
    const low = { context: 8192, maxTokens: 512, inputBytes: 7424 }
    expect(fitLocalRewriteOutputBudget(REDUCE_AI_RATE_SYSTEM_PROMPT, low)).toBe(low)
    const short = { context: 8192, maxTokens: 2048, inputBytes: 5888 }
    expect(fitLocalRewriteOutputBudget('按企业规范改写，保留事实。', short)).toBe(short)
  })
  it('不暗中削减只能思考模型的预算，也不绕过真正放不下的系统提示', () => {
    const thinking = { context: 8192, maxTokens: 2048, inputBytes: 5888, thinkingOnly: true }
    expect(fitLocalRewriteOutputBudget(REDUCE_AI_RATE_SYSTEM_PROMPT, thinking)).toBe(thinking)
    const small = { context: 4096, maxTokens: 2048, inputBytes: 1792 }
    expect(fitLocalRewriteOutputBudget(REDUCE_AI_RATE_SYSTEM_PROMPT, small)).toBe(small)
    expect(() => planLocalRewrite(REDUCE_AI_RATE_SYSTEM_PROMPT, '保留原文。', '', '', small)).toThrow('系统提示超出预算')
  })
  it('固定提示占满预算时报告真实参数和字节数，不把正文写入错误消息', () => {
    const limited = { context: 8192, maxTokens: 7680, inputBytes: 256 }
    expect(() => planLocalRewrite(REDUCE_AI_RATE_SYSTEM_PROMPT, '私密正文。', '', '', limited)).toThrow(/上下文.*8192.*输出.*7680.*输入预算.*256.*系统提示.*6553/)
    try { planLocalRewrite(REDUCE_AI_RATE_SYSTEM_PROMPT, '私密正文。', '', '', limited) }
    catch (error) { expect(String(error)).not.toContain('私密正文') }
  })
  it('6000 字长段落不再整段拒绝，每次请求和语义复核均留足预算，原文不丢字符', () => {
    const text = '系统通过本地模型处理文档，原始文件保持独立保存。'.repeat(260)
    const parts = planLocalRewrite(REDUCE_AI_RATE_SYSTEM_PROMPT, text, '', '', budget)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.map(part => part.original).join('')).toBe(text)
    for (const part of parts) {
      expect(bytes(REDUCE_AI_RATE_SYSTEM_PROMPT + part.message)).toBeLessThanOrEqual(budget.inputBytes)
      expect(bytes(QUALITY_REVIEW_PROMPT + JSON.stringify({ original: part.original, rewritten: part.original.repeat(2).slice(0, Math.ceil(part.original.length * 1.8)) }))).toBeLessThanOrEqual(budget.inputBytes)
    }
  })
  it('前后参考段落超长时只缩小参考，目标正文逐字保留', () => {
    const text = '系统通过本地模型处理文档。'
    const [part] = planLocalRewrite(REDUCE_AI_RATE_SYSTEM_PROMPT, text, '前文。'.repeat(5000), '后文。'.repeat(5000), budget)
    expect(part.original).toBe(text)
    expect(part.message).toContain(`[需要改写的段落]\n${text}`)
    expect(bytes(REDUCE_AI_RATE_SYSTEM_PROMPT + part.message)).toBeLessThanOrEqual(budget.inputBytes)
  })
  it('短段落保留原提示结构及完整前后文', () => {
    expect(planLocalRewrite('规则', '目标内容。', '前文。', '后文。', budget)).toEqual([
      { original: '目标内容。', message: buildRewriteMessage('目标内容。', '前文。', '后文。') }
    ])
  })
  it('不切断公式标记、Emoji、空格或换行', () => {
    const original = '  文本😀。\n[[MATH:abcdefghijkl]]继续说明。尾部  '
    const parts = splitTextToFit(original, value => bytes(value) <= 32)
    expect(parts.join('')).toBe(original)
    expect(parts.some(part => part.includes('[[MATH:abcdefghijkl]]'))).toBe(true)
    expect(parts.join('')).not.toContain('\ufffd')
  })
  it('单个标记或系统提示超过预算时明确报错，不截断或无限循环', () => {
    expect(() => splitTextToFit('[[MATH:verylong]]', value => value.length < 5)).toThrow('标记超出')
    expect(() => planLocalRewrite('长'.repeat(6000), '待处理。', '', '', budget)).toThrow('预算')
    expect(splitTextToFit('', () => false)).toEqual([])
  })
})
