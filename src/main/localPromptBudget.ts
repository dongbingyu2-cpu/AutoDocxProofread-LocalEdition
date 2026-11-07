import { QUALITY_REVIEW_PROMPT } from './rewriteQuality'

export interface LocalPromptBudget {
  context: number
  inputBytes: number
  maxTokens: number
  thinkingOnly?: boolean
}

const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
// 将公式/脚注标记作为原子，不在代理对、占位符内部切开；所有空格和换行均保留。
const atoms = (text: string) => text.match(/\[\[[\s\S]*?\]\]|[\s\S]/gu) || []

/** 最大输出是上限；非思考模型可为短子片减少预留，不改提示词或用户上下文。 */
export function fitLocalRewriteOutputBudget(system: string, budget: LocalPromptBudget): LocalPromptBudget {
  const fixedBytes = bytes(system + buildRewriteMessage(''))
  const minimumTargetBytes = 256
  if (budget.thinkingOnly || budget.inputBytes >= fixedBytes + minimumTargetBytes) return budget
  const templateReserve = Math.max(0, budget.context - budget.inputBytes - budget.maxTokens)
  // 与设置控件的 128 Token 步长一致，保留至少 512 输出，避免用极小预算制造截断。
  const availableOutput = Math.floor((budget.context - templateReserve - fixedBytes - minimumTargetBytes) / 128) * 128
  const maxTokens = Math.min(budget.maxTokens, availableOutput)
  if (maxTokens < 512 || maxTokens >= budget.maxTokens) return budget
  return { ...budget, maxTokens, inputBytes: budget.context - templateReserve - maxTokens }
}

export function splitTextToFit(text: string, fits: (value: string) => boolean, maxBytes = Infinity): string[] {
  if (!text) return []
  const units = atoms(text), result: string[] = []
  let offset = 0
  while (offset < units.length) {
    let low = 0, high = units.length - offset
    while (low < high) {
      const mid = Math.ceil((low + high) / 2), candidate = units.slice(offset, offset + mid).join('')
      if (bytes(candidate) <= maxBytes && fits(candidate)) low = mid
      else high = mid - 1
    }
    if (!low) throw new Error('本地提示词或单个公式/脚注标记超出上下文预算，请增大上下文或减少输出上限。')
    // 优先在后半段的句末或换行处切分，减少对句意和段内衔接的影响。
    if (offset + low < units.length) {
      for (let index = low - 1; index >= Math.floor(low / 2); index--) {
        if (/^[。！？!?；;\n]$/.test(units[offset + index])) { low = index + 1; break }
      }
    }
    result.push(units.slice(offset, offset + low).join(''))
    offset += low
  }
  return result
}

export function buildRewriteMessage(target: string, previous = '', next = ''): string {
  return (previous ? `[上一段]\n${previous}\n\n` : '') + `[需要改写的段落]\n${target}` + (next ? `\n\n[下一段]\n${next}` : '')
}

function referencePart(text: string, maxBytes: number, tail: boolean) {
  const units = atoms(text), chosen: string[] = []
  let used = 0
  for (const unit of tail ? units.reverse() : units) {
    if (used + bytes(unit) > maxBytes) break
    chosen.push(unit); used += bytes(unit)
  }
  return (tail ? chosen.reverse() : chosen).join('')
}

/** 只裁剪用于衔接的参考前后文，目标原文完整拆分并最终逐字连接回同一段。 */
export function planLocalRewrite(
  system: string, target: string, previous: string, next: string, budget: LocalPromptBudget,
  toModelText: (text: string) => string = text => text, maxTargetBytes?: number
): { original: string; message: string }[] {
  if (target && bytes(system + buildRewriteMessage('')) > budget.inputBytes) {
    // 这里是固定提示占满预算，不能误报为文档太长或要求用户删除公式。
    throw new Error(`本地系统提示超出预算：上下文 ${budget.context} tokens，输出预留 ${budget.maxTokens} tokens，保守输入预算 ${budget.inputBytes} 字节，系统提示 ${bytes(system)} 字节。请增大上下文或减少输出上限。`)
  }
  const fits = (message: string) => bytes(system + message) <= budget.inputBytes
  const canFitTarget = (candidate: string) => {
    // 为语义复核中的“原文+改写”以及允许的最大扩写比例预留空间，避免生成成功后复核超限。
    const projected = JSON.stringify({ original: candidate, rewritten: candidate + candidate.slice(0, Math.ceil(candidate.length * 0.8)) })
    return fits(buildRewriteMessage(toModelText(candidate))) && bytes(QUALITY_REVIEW_PROMPT + projected) <= budget.inputBytes
  }
  // 同时约束输出规模，给 Qwen 等思考模型留出生成正文的余量。
  const pieces = splitTextToFit(target, canFitTarget,
    maxTargetBytes ?? Math.max(1, Math.floor(budget.maxTokens / (budget.thinkingOnly ? 8 : 4))))
  return pieces.map((original, index) => {
    const before = toModelText(index ? pieces[index - 1] : previous)
    const after = toModelText(index + 1 < pieces.length ? pieces[index + 1] : next)
    const content = toModelText(original)
    let message = buildRewriteMessage(content, before, after)
    if (!fits(message)) {
      const available = Math.max(0, budget.inputBytes - bytes(system + buildRewriteMessage(content)) - 128)
      const beforeLimit = after ? Math.floor(available / 2) : available
      const afterLimit = before ? Math.floor(available / 2) : available
      message = buildRewriteMessage(content, referencePart(before, beforeLimit, true), referencePart(after, afterLimit, false))
    }
    if (!fits(message)) throw new Error('本地参考上下文超出预算，请增大上下文或减少输出上限。')
    return { original, message }
  })
}
