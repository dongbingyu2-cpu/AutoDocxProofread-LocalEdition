import { describe, expect, it } from 'vitest'
import { cloudRewriteWarnings } from '../src/main/rewriteQuality'

describe('云端改写风险提示', () => {
  it('无论、不同等字面变化不能被当成已证实的否定含义反转', () => {
    expect(cloudRewriteWarnings('无论采用哪种方式，都能查看不同任务。', '采用任何一种方式，都能查看各项任务。')).toEqual([])
  })
  it('数字改动仍形成可预览的风险提示', () => {
    expect(cloudRewriteWarnings('阈值为10%。', '阈值为20%。')).toContain('数字或比例发生变化')
  })
  it('公式标记和保护术语丢失仍可识别', () => {
    expect(cloudRewriteWarnings('系统采用Qwen，保留[[MATH:a]]。', '系统采用其他模型，保留公式。')).toEqual(expect.arrayContaining(['专业术语缺失', '公式或脚注占位符发生变化']))
  })
})
