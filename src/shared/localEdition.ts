/** 本地版设置不含密钥；模型配置仍由原有加密 SQLite API 表管理。 */
export interface LocalEditionSettings {
  roles: { chat: number | null; proof: number | null; reduce: number | null; embedding: number | null }
  concurrency: number
  contextLength: number
  maxTokens: number
  timeoutSec: number
  protectedTerms: string
  documentPromptMode: 'compact' | 'original'
}

export const DEFAULT_LOCAL_SETTINGS: LocalEditionSettings = {
  roles: { chat: null, proof: null, reduce: null, embedding: null },
  concurrency: 1,
  // 原降 AI 提示较长；默认留足正文与思考/复核预算，避免首次使用就全部分片失败。
  contextLength: 16384,
  maxTokens: 8192,
  timeoutSec: 300,
  protectedTerms: '',
  documentPromptMode: 'original'
}

export function normalizeLocalSettings(input: any): LocalEditionSettings {
  const integer = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
  const roles = { ...DEFAULT_LOCAL_SETTINGS.roles }
  for (const role of Object.keys(roles) as (keyof typeof roles)[]) {
    const id = input?.roles?.[role]
    roles[role] = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
  }
  const contextLength = integer(input?.contextLength, DEFAULT_LOCAL_SETTINGS.contextLength, 2048, 131072)
  return {
    roles,
    concurrency: integer(input?.concurrency, 1, 1, 8),
    contextLength,
    maxTokens: integer(input?.maxTokens, Math.min(DEFAULT_LOCAL_SETTINGS.maxTokens, contextLength / 2), 128, contextLength - 512),
    timeoutSec: integer(input?.timeoutSec, 300, 5, 1800),
    protectedTerms: typeof input?.protectedTerms === 'string' ? input.protectedTerms.slice(0, 10000) : '',
    // 降 AI 默认沿用原版策略；通用简洁编辑仅在明确选择时启用，已有选择继续保留。
    documentPromptMode: input?.documentPromptMode === 'compact' ? 'compact' : 'original'
  }
}
