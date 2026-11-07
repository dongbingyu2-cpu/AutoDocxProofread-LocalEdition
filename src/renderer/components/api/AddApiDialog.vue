<template>
  <el-dialog
    :model-value="visible"
    :title="dialogTitle"
    width="550px"
    class="api-dialog"
    @update:model-value="handleDialogVisibilityChange"
  >
    <template #header>
      <div class="dialog-header">
        <el-icon><component :is="headerIcon" /></el-icon>
        <span>{{ dialogTitle }}</span>
      </div>
    </template>
    <el-form ref="formRef" :model="formData" :rules="formRules" label-position="top" class="dialog-form">
      <el-form-item :label="t('addApiDialog.providerLabel')" class="form-item">
        <el-select v-model="formData.provider" class="w-full" @change="handleProviderChange">
          <el-option
            v-for="provider in providerOptions"
            :key="provider.id"
            :label="provider.name"
            :value="provider.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="showURLField" prop="URL" :label="t('addApiDialog.urlLabel')" class="form-item">
        <div class="input-tip">
          <el-icon class="tip-icon"><InfoFilled /></el-icon>
          <span>{{
            formData.provider === 'claude_code'
              ? t('addApiDialog.formatExampleClaudeCode')
              : t('addApiDialog.formatExample')
          }}</span>
        </div>
        <el-input v-model="formData.URL" :placeholder="t('addApiDialog.urlPlaceholder')" :prefix-icon="Link" />
      </el-form-item>
      <el-form-item v-if="formData.provider !== 'ollama'" prop="key" :label="t('addApiDialog.keyLabel')" class="form-item">
        <el-input
          v-model="formData.key"
          type="password"
          show-password
          :placeholder="t('addApiDialog.keyPlaceholder')"
          :prefix-icon="Lock"
        />
      </el-form-item>
      <el-form-item prop="name" :label="t('addApiDialog.modelLabel')" class="form-item">
        <div class="input-tip">
          <el-icon class="tip-icon"><InfoFilled /></el-icon>
          <span>{{ t('addApiDialog.defaultModelTip', { model: defaultModelForProvider }) }}</span>
        </div>
        <template v-if="formData.provider === 'ollama'">
          <el-select v-model="formData.name" filterable allow-create default-first-option placeholder="选择本地模型或输入完整模型名称" class="w-full" data-testid="ollama-model">
            <el-option v-for="model in localModels" :key="model.name" :label="model.name" :value="model.name" />
          </el-select>
          <el-button :loading="discovering" @click="refreshModels">刷新本地模型</el-button>
          <p role="status">{{ discoveryMessage }}</p>
          <el-alert title="仅本机处理；无需 API Key。不下载模型，失败不回退云端。" type="info" :closable="false" />
        </template>
        <el-input v-else v-model="formData.name" :placeholder="t('addApiDialog.modelPlaceholder')" :prefix-icon="Cpu" />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleReset">{{ t('addApiDialog.reset') }}</el-button>
        <el-button @click="handleClose">{{ t('addApiDialog.cancel') }}</el-button>
        <el-button :loading="testing" @click="handleTest">{{ t('addApiDialog.testConnection') }}</el-button>
        <el-button type="primary" :loading="submitting" class="btn-primary" @click="handleSubmit">
          {{ mode === 'edit' ? t('addApiDialog.saveEdit') : t('addApiDialog.save') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FormInstance, FormItemRule, FormRules } from 'element-plus'
import { Plus, Edit, Link, Lock, Cpu, InfoFilled } from '@element-plus/icons-vue'
import { useApiSettings, type ApiFormData } from '../../composables/useApiSettings'
import {
  ModelProvider,
  MODEL_PROVIDERS,
  getProviderDefaultModel,
  requiresBaseURL
} from '../../../shared/modelProviders'

const { t } = useI18n()

const providerOptions = Object.values(MODEL_PROVIDERS).map(p => ({
  id: p.id,
  name: p.name
}))

const props = withDefaults(
  defineProps<{
    visible: boolean
    mode?: 'create' | 'edit'
    initialData?: ApiFormData | null
    /** 保存处理函数：由父组件执行保存并返回是否成功，对话框据此控制 loading 与关闭 */
    submitHandler?: (data: ApiFormData) => Promise<boolean> | boolean
  }>(),
  {
    mode: 'create',
    initialData: null
  }
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [data: ApiFormData]
}>()

const { testApiConnection } = useApiSettings()

const formData = reactive<ApiFormData>({
  id: undefined,
  URL: '',
  key: '',
  name: '',
  provider: ModelProvider.OLLAMA
})

const showURLField = computed(() => {
  return requiresBaseURL(formData.provider)
})

// ---- 表单校验：此前空 URL/key 也能保存，这里补齐必填与格式校验 ----
const formRef = ref<FormInstance>()

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const validateURL = (_rule: FormItemRule, value: string, callback: (error?: Error) => void) => {
  const url = (value || '').trim()
  if (!url) {
    // 该字段仅在 provider 需要 baseURL 时渲染，必填校验交给 required 规则
    callback()
    return
  }
  if (isValidHttpUrl(url)) {
    callback()
  } else {
    callback(new Error(t('addApiDialog.validURLFormat')))
  }
}

const formRules = computed<FormRules>(() => ({
  URL: [
    { required: showURLField.value, message: t('addApiDialog.validURLRequired'), trigger: 'blur' },
    { validator: validateURL, trigger: 'blur' }
  ],
  key: [{ required: formData.provider !== ModelProvider.OLLAMA, message: t('addApiDialog.validKeyRequired'), trigger: 'blur' }],
  name: [{ required: true, message: t('addApiDialog.validNameRequired'), trigger: 'blur' }]
}))

const validateForm = async (): Promise<boolean> => {
  if (!formRef.value) return true
  try {
    await formRef.value.validate()
    return true
  } catch {
    return false
  }
}

const defaultModelForProvider = computed(() => {
  return getProviderDefaultModel(formData.provider)
})

const handleProviderChange = (provider: ModelProvider) => {
  if (provider === ModelProvider.OLLAMA) {
    formData.URL = 'http://127.0.0.1:11434'
    formData.key = 'ollama'
    formData.name = ''
    return
  }
  if (formData.key === 'ollama') { formData.key = ''; formData.URL = ''; formData.name = '' }
  if (!formData.name || formData.name === getProviderDefaultModel(ModelProvider.OPENAI_COMPATIBLE)) {
    formData.name = getProviderDefaultModel(provider)
  }
  if (!requiresBaseURL(provider)) {
    formData.URL = ''
  }
}

const testing = ref(false)
const localModels = ref<{ name: string }[]>([])
const discovering = ref(false)
const discoveryMessage = ref('')
let discoverySequence = 0
const refreshModels = async () => {
  const sequence = ++discoverySequence
  discovering.value = true
  const result = await window.electronAPI.discoverOllama(formData.URL || undefined)
  if (sequence !== discoverySequence) return
  localModels.value = result.models
  discoveryMessage.value = result.success ? `已连接，发现 ${result.models.length} 个本地模型；也可手动输入名称。` : `无法连接：${result.message}`
  discovering.value = false
}
// 打开窗口时自动探测；手动改地址后可点刷新，旧响应不能覆盖新发现结果。
watch(() => [props.visible, formData.provider] as const, ([visible, provider]) => {
  if (visible && provider === ModelProvider.OLLAMA) refreshModels()
  else { discoverySequence++; discovering.value = false }
})
const submitting = ref(false)

const dialogTitle = computed(() => (props.mode === 'edit' ? t('addApiDialog.editTitle') : t('addApiDialog.addTitle')))
const headerIcon = computed(() => (props.mode === 'edit' ? Edit : Plus))

const resetForm = () => {
  formData.id = undefined
  formData.URL = 'http://127.0.0.1:11434'
  formData.key = 'ollama'
  formData.name = ''
  formData.provider = ModelProvider.OLLAMA
  formRef.value?.clearValidate()
}

const syncFormData = () => {
  if (!props.visible) {
    return
  }

  if (props.mode === 'edit' && props.initialData) {
    formData.id = props.initialData.id
    formData.URL = props.initialData.URL || ''
    formData.key = props.initialData.key || ''
    formData.name = props.initialData.name || ''
    formData.provider = props.initialData.provider || ModelProvider.OPENAI_COMPATIBLE
    formRef.value?.clearValidate()
    return
  }

  resetForm()
}

watch(
  () => [props.visible, props.mode, props.initialData] as const,
  () => {
    syncFormData()
  },
  { immediate: true, deep: true }
)

const handleDialogVisibilityChange = (value: boolean) => {
  if (!value) {
    resetForm()
  }
  emit('update:visible', value)
}

const handleClose = () => {
  handleDialogVisibilityChange(false)
}

const handleSubmit = async () => {
  if (!(await validateForm())) return
  const payload: ApiFormData = {
    id: formData.id,
    URL: formData.URL,
    key: formData.key,
    name: formData.name,
    provider: formData.provider
  }
  // 旧事件模式：emit 是同步的，父组件的异步保存结果无法回传，
  // loading 会在 emit 后立即复位（假 loading），因此仅在未提供 submitHandler 时兜底
  if (!props.submitHandler) {
    emit('submit', payload)
    return
  }
  submitting.value = true
  try {
    const success = await props.submitHandler(payload)
    if (success) {
      handleDialogVisibilityChange(false)
    }
  } finally {
    submitting.value = false
  }
}

const handleReset = () => {
  if (props.mode === 'edit' && props.initialData) {
    formData.id = props.initialData.id
    formData.URL = props.initialData.URL || ''
    formData.key = props.initialData.key || ''
    formData.name = props.initialData.name || ''
    formData.provider = props.initialData.provider || ModelProvider.OPENAI_COMPATIBLE
    return
  }

  resetForm()
}

const handleTest = async () => {
  if (!(await validateForm())) return
  testing.value = true
  try {
    await testApiConnection({
      url: formData.URL,
      key: formData.key,
      modelName: formData.name,
      provider: formData.provider
    })
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.api-dialog {
  border-radius: 10px;
}

.api-dialog :deep(.el-dialog) {
  border-radius: 10px;
  border: none;
  box-shadow: 0 4px 24px rgba(75, 100, 130, 0.12);
}

.api-dialog :deep(.el-dialog__header) {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 16px;
}

.api-dialog :deep(.el-dialog__footer) {
  border-top: 1px solid var(--border-color);
  padding-top: 16px;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 16px;
  color: var(--text-1);
}

.dialog-header .el-icon {
  color: var(--brand);
}

.dialog-form {
  padding: 16px 0;
}

.form-item {
  margin-bottom: 20px;
}

.input-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 6px;
}

.tip-icon {
  color: var(--text-3);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-primary {
  background-color: var(--brand);
  border-color: var(--brand);
}

.btn-primary:hover {
  background-color: var(--brand-dark);
  border-color: var(--brand-dark);
}
</style>

<style>
/* 非 scoped 块不能用 :deep()（浏览器整条丢弃规则），子元素直接写类名 */
html.dark .api-dialog .el-dialog__header {
  border-bottom-color: var(--border-color);
}

html.dark .api-dialog .el-dialog__footer {
  border-top-color: var(--border-color);
}

html.dark .dialog-header {
  color: var(--text-1);
}

html.dark .dialog-header .el-icon {
  color: var(--brand-bright);
}

html.dark .input-tip {
  color: var(--text-2);
}

html.dark .tip-icon {
  color: var(--text-3);
}
</style>
