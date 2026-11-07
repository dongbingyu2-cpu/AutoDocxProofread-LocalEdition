import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ handlers: new Map<string, Function>(), pull: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: Function) => mock.handlers.set(name, fn) } }))
vi.mock('../src/main/ollamaDownload', async importOriginal => ({ ...await importOriginal<any>(), pullOllamaModel: mock.pull }))
import { registerOllamaDownloadHandlers } from '../src/main/ipc/ollamaDownloadHandlers'

class Sender extends EventEmitter {
  constructor(public id: number) { super() }
  send = vi.fn()
  isDestroyed = () => false
}
const call = (name: string, sender: Sender, ...args: any[]) => mock.handlers.get('ollama:' + name)!({ sender }, ...args)
beforeEach(() => { mock.handlers.clear(); mock.pull.mockReset(); registerOllamaDownloadHandlers() })

describe('下载任务生命周期与 IPC 权限（Mock）', () => {
  it('限制一个下载任务，其他窗口无法取消或读取，取消后允许重试', async () => {
    const sender = new Sender(1), other = new Sender(2)
    mock.pull.mockImplementation((_m, _u, _cb, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const state = call('download', sender, { model: 'qwen3:4b' })
    expect(state.phase).toBe('downloading')
    expect(call('download-state', other)).toBe(null)
    expect(call('cancel-download', other, state.id)).toBe(false)
    expect(() => call('download', sender, { model: 'qwen3:8b' })).toThrow('已有模型')
    expect(call('cancel-download', sender, state.id)).toBe(true)
    await vi.waitFor(() => expect(call('download-state', sender).phase).toBe('cancelled'))
    await vi.waitFor(() => expect(sender.listenerCount('destroyed')).toBe(0))
    mock.pull.mockResolvedValue(undefined)
    call('download', sender, { model: 'qwen3:8b' })
    await vi.waitFor(() => expect(call('download-state', sender).phase).toBe('success'))
  })
  it('切页可查询进度，关闭所属窗口会取消并清理监听', async () => {
    const sender = new Sender(1)
    let activeSignal!: AbortSignal
    mock.pull.mockImplementation((_m, _u, cb, signal) => new Promise((_resolve, reject) => {
      activeSignal = signal; cb({ status: 'pulling layer', total: 100, completed: 50, percent: 50 })
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    call('download', sender, { model: 'qwen3:4b', url: 'http://localhost:11434/v1' })
    expect(call('download-state', sender)).toMatchObject({ percent: 50, origin: 'http://localhost:11434' })
    sender.emit('destroyed')
    expect(activeSignal.aborted).toBe(true)
    await vi.waitFor(() => expect(sender.listenerCount('destroyed')).toBe(0))
  })
  it('下载错误以明确终态发送给所属窗口', async () => {
    const sender = new Sender(1)
    mock.pull.mockRejectedValue(new Error('模型不存在'))
    call('download', sender, { model: 'missing:4b' })
    await vi.waitFor(() => expect(call('download-state', sender)).toMatchObject({ phase: 'error', status: '模型不存在' }))
    expect(sender.send).toHaveBeenLastCalledWith('ollama:download-progress', expect.objectContaining({ phase: 'error' }))
  })
  it('短时间内连续进度在传输暂停后仍刷新最后的字节数', async () => {
    const sender = new Sender(1)
    let progress!: Function, finish!: Function
    mock.pull.mockImplementation((_m, _u, cb) => new Promise(resolve => { progress = cb; finish = resolve }))
    call('download', sender, { model: 'qwen3:4b' })
    progress({ status: 'pulling layer', percent: 10, total: 100, completed: 10 })
    progress({ status: 'pulling layer', percent: 20, total: 100, completed: 20 })
    await vi.waitFor(() => expect(sender.send).toHaveBeenLastCalledWith('ollama:download-progress', expect.objectContaining({ completed: 20 })))
    finish()
    await vi.waitFor(() => expect(call('download-state', sender).phase).toBe('success'))
  })
})
