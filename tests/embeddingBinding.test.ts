import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const state = vi.hoisted(() => ({ dir: process.cwd() + '/.validation/vector-binding', dimension: 8 }))
vi.mock('electron', () => ({ app: { getPath: () => state.dir, isPackaged: false } }))
vi.mock('../src/main/chat', () => ({ getEmbedding: vi.fn(async () => Array.from({ length: state.dimension }, (_, i) => (i + 1) / 10)) }))
import { initLanceDB, closeLanceDB, createRepository, insertDocument, queryDocuments, updateDocument, getAllDocuments } from '../src/main/lancedb'
beforeAll(() => { fs.mkdirSync(state.dir, { recursive: true }) })
afterAll(async () => { await closeLanceDB(); fs.rmSync(state.dir, { recursive: true, force: true }) })

describe('真实 SQLite/vec0 + Mock Embedding 模型绑定', () => {
  it('写入和检索，更新时保留原文件名', async () => {
    await createRepository('本地模型绑定测试', 'model-a', 'key', 'http://localhost/v1')
    const row = await insertDocument('本地模型绑定测试', '知识条目', '原文.txt', {}, 'model-a', 'key', 'http://localhost/v1')
    expect(await queryDocuments('本地模型绑定测试', '知识', 'model-a', 'key', 'http://localhost')).toHaveLength(1)
    await updateDocument('本地模型绑定测试', row.id, '更新的知识条目', {}, 'model-a', 'key', 'http://localhost/v1')
    expect((await getAllDocuments('本地模型绑定测试'))[0].filename).toBe('原文.txt')
  })
  it('不同模型同维度也拒绝混写与查询，保留旧文档', async () => {
    await expect(insertDocument('本地模型绑定测试', '新内容', '新文.txt', {}, 'model-b', 'key', 'http://localhost')).rejects.toThrow('绑定不一致')
    await expect(queryDocuments('本地模型绑定测试', '查询', 'model-b', 'key', 'http://localhost')).rejects.toThrow('绑定不一致')
    expect(await getAllDocuments('本地模型绑定测试')).toHaveLength(1)
  })
  it('同模型维度改变时不改旧表，不删除文档', async () => {
    state.dimension = 4
    await expect(insertDocument('本地模型绑定测试', '新内容', '新文.txt', {}, 'model-a', 'key', 'http://localhost')).rejects.toThrow('维度不匹配')
    expect(await getAllDocuments('本地模型绑定测试')).toHaveLength(1)
    state.dimension = 8
  })
  it('旧库无模型元数据时保留并拒绝推测来源', async () => {
    const db = await initLanceDB()
    await db.run('DELETE FROM _local_embedding_meta WHERE repository=?', '本地模型绑定测试')
    await expect(queryDocuments('本地模型绑定测试', '查询', 'model-a', 'key', 'http://localhost')).rejects.toThrow('旧知识库')
    expect((await getAllDocuments('本地模型绑定测试'))[0].text).toBe('更新的知识条目')
  })
})
