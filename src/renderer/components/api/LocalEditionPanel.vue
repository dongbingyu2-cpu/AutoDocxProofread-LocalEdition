<template>
  <section class="local-panel" data-testid="local-edition-panel">
    <h3>本地模型检测</h3>
    <p class="hint">保存模型后，在文档校对页直接选择本地或云端配置。检测不会下载模型。</p>
    <div class="detect-row">
      <el-input v-model="address" :disabled="downloading" placeholder="http://127.0.0.1:11434" aria-label="Ollama 服务地址" />
      <el-button :loading="detecting" @click="detect" data-testid="detect-local-models">检测 / 刷新</el-button>
    </div>
    <p role="status" data-testid="local-model-status">{{ status }}</p>
    <div class="model-list">
      <el-tag v-for="model in models" :key="model.name">{{ model.name }}</el-tag>
    </div>
    <OllamaModelDownload :address="address" :models="models" @downloaded="refreshDownloadedModels" @busy="downloading = $event" />
    <el-collapse class="advanced">
      <el-collapse-item title="本地模型运行参数" name="runtime">
        <el-form label-position="top">
          <div class="parameter-grid">
            <el-form-item label="Ollama 并发（默认 1）"><el-input-number v-model="settings.concurrency" :min="1" :max="8" /></el-form-item>
            <el-form-item label="上下文长度（输入与输出总窗口）"><el-input-number v-model="settings.contextLength" :min="2048" :max="131072" :step="1024" /></el-form-item>
            <el-form-item label="最大输出 Token（单次上限）">
              <el-input-number v-model="settings.maxTokens" :min="128" :max="settings.contextLength - 512" :step="128" />
              <span class="hint">原版提示较长时，非思考模型可按短分片减少本次输出预留，保存的上限不变。</span>
            </el-form-item>
            <el-form-item label="请求超时（秒）"><el-input-number v-model="settings.timeoutSec" :min="5" :max="1800" /></el-form-item>
            <el-form-item label="文档改写提示">
              <el-select v-model="settings.documentPromptMode" data-testid="local-prompt-mode">
                <el-option value="original" label="原版降 AI 提示（默认）" />
                <el-option value="compact" label="简洁编辑（可选，检测效果未验证）" />
              </el-select>
              <span class="hint">仅影响本地降 AI。原版提示可能更慢；已有自定义提示词优先保留。</span>
            </el-form-item>
          </div>
          <el-button :loading="saving" @click="save" data-testid="save-local-settings">保存运行参数</el-button>
        </el-form>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { DEFAULT_LOCAL_SETTINGS, type LocalEditionSettings } from '../../../shared/localEdition'
import OllamaModelDownload from './OllamaModelDownload.vue'
const api = window.electronAPI
const settings = reactive<LocalEditionSettings>(structuredClone(DEFAULT_LOCAL_SETTINGS))
const address = ref('http://127.0.0.1:11434'), status = ref(''), detecting = ref(false), saving = ref(false)
const models = ref<{ name: string }[]>([])
const downloading = ref(false)
let detectionSequence = 0
const refreshDownloadedModels = async (origin: string) => {
  address.value = origin
  await detect()
}
const detect = async () => {
  const sequence = ++detectionSequence
  detecting.value = true
  models.value = []
  try {
    const result = await api.discoverOllama(address.value.trim())
    // 下载完成刷新可能与进入页面时的检测重叠，旧地址的迟到响应不能覆盖新列表。
    if (sequence !== detectionSequence) return
    models.value = result.success ? result.models : []
    status.value = result.success ? `检测成功，发现 ${models.value.length} 个本地模型。` : result.message || '未检测到 Ollama 服务。'
  } catch (error) { if (sequence === detectionSequence) status.value = String(error) }
  finally { if (sequence === detectionSequence) detecting.value = false }
}
const save = async () => {
  saving.value = true
  try {
    // 只更新运行参数，保留知识库页面所选的 Embedding 配置和旧版兼容字段。
    const current = await api.getLocalSettings()
    Object.assign(settings, await api.saveLocalSettings({ ...current,
      concurrency: settings.concurrency, contextLength: settings.contextLength,
      maxTokens: settings.maxTokens, timeoutSec: settings.timeoutSec, documentPromptMode: settings.documentPromptMode }))
    status.value = '运行参数已保存。'
  } catch (error) { status.value = String(error) }
  finally { saving.value = false }
}
onMounted(async () => {
  try { Object.assign(settings, await api.getLocalSettings()) } catch (error) { status.value = String(error) }
  await detect()
})
</script>

<style scoped>
.local-panel { padding: 20px; margin-bottom: 20px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-card); }
h3 { margin: 0 0 12px; color: var(--text-primary); }
.hint, p[role="status"] { color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
.detect-row { display: flex; gap: 8px; }
.model-list { display: flex; flex-wrap: wrap; gap: 8px; }
.advanced { margin-top: 16px; }
.parameter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
@media (max-width: 950px) { .parameter-grid { grid-template-columns: 1fr; } }
</style>
