<template>
  <div class="model-download" data-testid="model-download">
    <el-button @click="dialogVisible = true" data-testid="open-model-download">下载模型</el-button>
    <div v-if="state.phase !== 'idle'" class="download-state" role="status" aria-live="polite" data-testid="download-state">
      <div class="progress-heading"><strong>{{ state.model }}</strong><span>{{ phaseLabel }}</span></div>
      <p>{{ statusLabel }}</p>
      <el-progress v-if="busy || state.phase === 'success'" :percentage="state.percent ?? 0" :indeterminate="busy && state.percent === undefined" :status="state.phase === 'success' ? 'success' : undefined" />
      <p v-if="state.total" class="hint">当前文件层：{{ formatBytes(state.completed ?? 0) }} / {{ formatBytes(state.total) }}（不是整个模型总进度）</p>
      <el-button v-if="busy" size="small" :loading="cancelling" @click="cancel" data-testid="cancel-model-download">取消下载</el-button>
    </div>

    <el-dialog v-model="dialogVisible" title="下载 Ollama 本地模型" width="min(600px, 92vw)" class="model-download-dialog" data-testid="model-download-dialog">
      <p class="hint">由本机 Ollama 从官方模型库联网下载，文档内容不会随下载发送。请为模型预留磁盘空间；下载体积不等于运行内存。</p>
      <el-form label-position="top">
        <el-form-item label="Ollama 服务地址"><el-input :model-value="busy ? state.origin : address" disabled /></el-form-item>
        <el-form-item label="选择常见模型或输入官方模型名称">
          <el-select v-model="model" filterable allow-create default-first-option :disabled="busy || starting" placeholder="例如 qwen3.5:4b" class="model-select" data-testid="download-model-select">
            <el-option-group v-for="kind in ['文本模型', '向量模型']" :key="kind" :label="kind">
              <el-option v-for="item in COMMON_OLLAMA_MODELS.filter(item => item.kind === kind)" :key="item.name" :value="item.name" :label="`${item.name} · ${item.size}`">
                <span>{{ item.name }}</span><span class="option-size">{{ item.size }}{{ isInstalled(item.name) ? ' · 已安装' : '' }}</span>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
      </el-form>
      <p v-if="selectedCommon" class="hint" data-testid="download-model-description">{{ selectedCommon.description }}。参考体积：{{ selectedCommon.size }}，实际以 Ollama 返回为准。</p>
      <el-alert v-if="isInstalled(model)" title="此模型已安装，再次下载会检查并更新同名模型。" type="info" :closable="false" />
      <p class="hint">下载完成后会刷新本地列表。请在“新增模型配置”中保存，再到文档页选择执行模型；向量模型应在知识库中配置。</p>
      <p v-if="dialogMessage" class="error-message" role="alert" data-testid="download-dialog-error">{{ dialogMessage }}</p>
      <p v-if="busy" role="status">正在下载 {{ state.model }} · {{ statusLabel }}。关闭此窗口或切换页面后下载仍会继续，退出程序会中止本程序的下载请求。</p>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ busy ? '后台下载' : '关闭' }}</el-button>
        <el-button v-if="busy" :loading="cancelling" @click="cancel">取消下载</el-button>
        <el-button v-else type="primary" :loading="starting" :disabled="!model.trim()" @click="start" data-testid="start-model-download">{{ isInstalled(model) ? '检查并更新' : '开始下载' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { COMMON_OLLAMA_MODELS, type OllamaDownloadState } from '../../../shared/ollamaDownload'

const props = defineProps<{ address: string; models: { name: string }[] }>()
const emit = defineEmits<{ downloaded: [origin: string]; busy: [value: boolean] }>()
const api = window.electronAPI
const dialogVisible = ref(false), model = ref(''), dialogMessage = ref(''), starting = ref(false), cancelling = ref(false)
const state = ref<OllamaDownloadState>({ id: '', model: '', origin: '', phase: 'idle', status: '' })
const busy = computed(() => state.value.phase === 'downloading')
const selectedCommon = computed(() => COMMON_OLLAMA_MODELS.find(item => item.name === model.value))
const isInstalled = (name: string) => props.models.some(item => item.name === name || item.name === `${name}:latest`)
const phaseLabel = computed(() => ({ idle: '', downloading: '下载中', success: '已完成', error: '下载失败', cancelled: '已取消' })[state.value.phase])
const statusLabel = computed(() => {
  const status = state.value.status
  if (status === 'pulling manifest') return '正在获取模型清单…'
  if (status.startsWith('pulling ')) return '正在下载模型文件…'
  if (status === 'verifying sha256 digest') return '正在校验模型文件…'
  if (status === 'writing manifest') return '正在写入模型清单…'
  if (status === 'removing any unused layers') return '正在整理模型文件…'
  if (status === 'success') return '正在完成下载…'
  return status
})
const formatBytes = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(2)} GB` : value >= 1e6 ? `${(value / 1e6).toFixed(1)} MB` : `${Math.round(value / 1e3)} KB`
watch(busy, value => emit('busy', value), { immediate: true })

let off: (() => void) | undefined, revision = 0, mounted = true, refreshedId = ''
const receive = (value: OllamaDownloadState) => {
  if (!mounted) return
  revision++
  state.value = value
  if (value.phase === 'success' && value.id !== refreshedId) {
    refreshedId = value.id
    emit('downloaded', value.origin)
  }
}
const start = async () => {
  if (starting.value || busy.value) return
  starting.value = true; dialogMessage.value = ''
  const before = revision
  try {
    const result = await api.downloadOllamaModel({ model: model.value.trim(), url: props.address.trim() })
    // 进度事件可能先于 invoke 返回，旧的开始快照不能覆盖已完成状态。
    if (revision === before) receive(result)
  } catch (error) { dialogMessage.value = error instanceof Error ? error.message : String(error) }
  finally { starting.value = false }
}
const cancel = async () => {
  cancelling.value = true
  try { await api.cancelOllamaDownload(state.value.id) }
  catch (error) { dialogMessage.value = error instanceof Error ? error.message : String(error) }
  finally { cancelling.value = false }
}
onMounted(async () => {
  off = api.onOllamaDownloadProgress(receive)
  const before = revision
  try {
    const value = await api.getOllamaDownloadState()
    if (value && revision === before) receive(value)
  } catch (error) { dialogMessage.value = String(error) }
})
onUnmounted(() => { mounted = false; off?.() })
</script>

<style scoped>
.model-download { margin-top: 12px; }
.download-state { padding: 12px; margin-top: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md, 8px); background: var(--bg-sunken); }
.progress-heading { display: flex; gap: 12px; justify-content: space-between; font-size: 12px; color: var(--text-1); }
.progress-heading span, .hint, .option-size { color: var(--text-2); }
p { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.model-select { width: 100%; }
.option-size { float: right; margin-left: 16px; font-size: 11px; }
.error-message { color: var(--el-color-danger); }
</style>
