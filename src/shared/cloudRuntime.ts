/** 云端并发独立保存，避免切到 Ollama 的并发 1 后污染云端配置。 */
export function restoredCloudParallel(saved: any): number {
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100
  // 新字段明确保存的 1 也要尊重；仅迁移旧版含混的共享并发值。
  if (valid(saved?.cloudParallel)) return saved.cloudParallel
  if (saved?.selectedApi?.provider !== 'ollama' && valid(saved?.selectedApi?.parallel) && saved.selectedApi.parallel > 1) {
    return saved.selectedApi.parallel
  }
  return 30
}
