/** 可选的简洁编辑提示，仅服务文字编辑目标，不替代默认的原版降 AI 提示。 */
export const LOCAL_REWRITE_PROMPT = '你是中文技术文档编辑。只改写用户标记的目标段落，前后文仅作参考。使表达自然、简洁、清楚，不增加冗余或固定替换词。技术事实、数值、单位、名称、术语、按钮/菜单、否定条件和操作顺序必须保留；公式与脚注标记逐字保留，英文不翻译。不得编造经验或新事实。原文已清楚可直接原样返回。只输出目标段落的改写正文，不输出标题、解释、JSON或思考过程。'

/** 只替换内置中文默认提示；用户自定义、英文和明确选定的原版提示一律保留。 */
export function localRewritePrompt(configured: string, builtinChinese: string, mode: 'compact' | 'original'): string {
  return mode === 'compact' && configured === builtinChinese ? LOCAL_REWRITE_PROMPT : configured
}
