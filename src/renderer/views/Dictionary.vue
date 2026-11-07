<template>
  <div class="dictionary-panel">
    <div class="panel-section">
      <div class="section-header">
        <el-icon><Collection /></el-icon>
        <span>{{ t('dictionary.repoList') }}</span>
      </div>

      <el-select
        v-model="selectform.id"
        :placeholder="t('dictionary.selectApiModel')"
        class="api-select"
        size="small"
        style="margin-bottom: 12px; width: 100%"
        @change="handleApiChange"
      >
        <el-option v-for="item in apiSettings" :key="item.id" :label="item.modelName" :value="item.id">
          <div class="api-option">
            <span class="api-name">{{ item.modelName }}</span>
          </div>
        </el-option>
      </el-select>

      <div class="repository-list">
        <div
          v-for="item in repositoryList"
          :key="item"
          :class="['repo-item', { active: activeIndex === item }]"
          @click="handleSelect(item)"
        >
          <span class="repo-name">{{ item }}</span>
          <el-button size="small" :icon="Delete" circle class="delete-btn" @click.stop="deleteSelectRepository(item)" />
        </div>

        <div v-if="repositoryList.length === 0" class="empty-state">
          <el-empty :description="t('dictionary.noRepos')" :image-size="50" />
        </div>
      </div>

      <el-button type="primary" size="small" class="add-repo-btn" @click="dialogFormVisible = true">
        <el-icon><FolderAdd /></el-icon>
        {{ t('dictionary.addRepo') }}
      </el-button>
    </div>

    <div v-if="activeIndex" class="panel-section detail-section">
      <div class="section-header">
        <span>{{ t('dictionary.currentRepo', { name: activeIndex }) }}</span>
        <el-button size="small" :icon="FolderAdd" class="btn-success" @click="addFile">
          {{ t('dictionary.addFile') }}
        </el-button>
      </div>

      <el-table :data="fileList" size="small" style="width: 100%">
        <el-table-column :label="t('dictionary.fileName')" show-overflow-tooltip>
          <template #default="{ row }">{{ row }}</template>
        </el-table-column>
        <el-table-column :label="t('dictionary.operations')" width="70">
          <template #default="{ row }">
            <el-button size="small" class="btn-danger-sm" @click.stop="deleteFile(row)">
              {{ t('dictionary.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else class="panel-section welcome-section">
      <el-empty :description="t('dictionary.welcomeHint')" :image-size="50" />
    </div>
  </div>

  <el-dialog
    v-model="dialogFormVisible"
    :title="t('dictionary.addRepoDialog.title')"
    width="400"
    :close-on-click-modal="false"
    class="morandi-dialog"
  >
    <el-form ref="repoFormRef" :model="form" :rules="repoFormRules" label-width="120px">
      <el-form-item :label="t('dictionary.addRepoDialog.nameLabel')" prop="repositoryName" required>
        <el-input
          v-model="form.repositoryName"
          :placeholder="t('dictionary.addRepoDialog.namePlaceholder')"
          clearable
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="dialogFormVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="addRepositoryWindow">
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Collection, FolderAdd, Delete } from '@element-plus/icons-vue'
import { ref, reactive, onMounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEmbeddingStore } from '../stores/embeddingStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

const { t } = useI18n()

const fileStore = useEmbeddingStore()
// 知识库列表改为统一从 repositoryStore 读取（与校对页面 DocPreview 共享同一份状态），
// 这样在本页增删知识库后调 store.refresh()，DocPreview 的下拉列表也会同步更新。
const repositoryStore = useRepositoryStore()
const repositoryList = computed(() => repositoryStore.list)
const activeIndex = ref('')
const electronAPI = window.electronAPI
const dialogFormVisible = ref(false)
const submitting = ref(false)

const form = reactive({
  repositoryName: '',
  modelName: '',
  apiKey: '',
  apiURL: ''
})

// 知识库名称校验：对齐 AddApiDialog 的 el-form rules 风格（computed 保持语言切换后文案更新），空名/纯空白拦截
const repoFormRef = ref<FormInstance>()
const repoFormRules = computed<FormRules>(() => ({
  repositoryName: [
    { required: true, whitespace: true, message: t('dictionary.messages.pleaseInputName'), trigger: 'blur' }
  ]
}))

const apiSettings = reactive<any[]>([])
const selectform = ref({
  id: null as number | null,
  URL: '',
  key: '',
  name: '',
  time: ''
})

const handleSelect = (index: string) => {
  activeIndex.value = index
}

const handleApiChange = async (newId: number | null) => {
  try {
    const settings = await electronAPI.getLocalSettings()
    settings.roles.embedding = newId
    await electronAPI.saveLocalSettings(settings)
  } catch (error) { ElMessage.error(String(error)); return }
  if (newId === null) {
    selectform.value.URL = ''
    selectform.value.key = ''
    selectform.value.name = ''
    return
  }

  const selectedItem = apiSettings.find(item => item.id === newId)
  if (selectedItem) {
    selectform.value.URL = selectedItem.apiURL || ''
    selectform.value.key = selectedItem.apiKey || ''
    selectform.value.name = selectedItem.modelName || ''

    form.apiURL = selectedItem.apiURL || ''
    form.apiKey = selectedItem.apiKey || ''
    form.modelName = selectedItem.modelName || ''

    fileStore.setConfig({
      apiURL: selectform.value.URL,
      apiKey: selectform.value.key,
      modelName: selectform.value.name
    })
  }
}

const getALLAPISettings = async () => {
  try {
    const res = await electronAPI.getALLAPISettings()
    apiSettings.splice(0, apiSettings.length)
    if (Array.isArray(res)) {
      apiSettings.push(...res)
    }
  } catch (error) {
    console.error('获取API设置失败:', error)
  }
}

const initSelect = async () => {
  try {
    const settings = await electronAPI.getLocalSettings()
    if (settings.roles.embedding != null) fileStore.setConfig(await electronAPI.getLocalEmbeddingConfig())
    const config = fileStore.getAPIConfig

    if (config.apiURL && config.apiKey && config.modelName) {
      selectform.value.URL = config.apiURL
      selectform.value.key = config.apiKey
      selectform.value.name = config.modelName

      form.apiKey = config.apiKey
      form.apiURL = config.apiURL
      form.modelName = config.modelName

      const matchedApi = apiSettings.find(item => item.modelName === config.modelName && item.apiURL === config.apiURL)
      if (matchedApi) {
        selectform.value.id = matchedApi.id
      }
    }
  } catch (error) {
    console.error('初始化API选择失败:', error)
  }
}

const getRepositories = async () => {
  // 统一走 store.refresh()，确保 DocPreview 等共享方也同步拿到最新列表。
  return await repositoryStore.refresh()
}

const addRepositoryWindow = async () => {
  if (!fileStore.isConfigured) {
    ElMessage.error(t('dictionary.messages.selectEmbeddingFirst'))
    return
  }

  const config = await electronAPI.getLocalEmbeddingConfig()

  if (repoFormRef.value) {
    const valid = await repoFormRef.value.validate().catch(() => false)
    if (!valid) return
  }

  submitting.value = true
  try {
    await electronAPI.createRepository({
      repositoryName: form.repositoryName.trim(),
      modelName: config.modelName,
      apiKey: config.apiKey,
      apiURL: config.apiURL
    })
    await getRepositories()
    dialogFormVisible.value = false
    form.repositoryName = ''
    ElMessage.success(t('dictionary.messages.createSuccess'))
  } catch (error) {
    ElMessage.error(t('dictionary.messages.createFailed'))
  } finally {
    submitting.value = false
  }
}

const deleteSelectRepository = async (repositoryName: string) => {
  try {
    await ElMessageBox.confirm(
      t('dictionary.messages.deleteConfirm', { name: repositoryName }),
      t('dictionary.messages.warning'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    await electronAPI.deleteRepository(repositoryName)
    await getRepositories()

    if (activeIndex.value === repositoryName) {
      activeIndex.value = ''
    }

    ElMessage.success(t('dictionary.messages.deleteSuccess'))
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(t('dictionary.messages.deleteFailed'))
    }
  }
}

const fileList = ref<string[]>([])

const loadFileList = async () => {
  if (!activeIndex.value) return
  try {
    const files = await electronAPI.listFilenamesInRepository(activeIndex.value)
    fileList.value = files
  } catch (error) {
    console.error('加载文件列表失败:', error)
    fileList.value = []
  }
}

const addFile = async () => {
  if (!activeIndex.value) {
    ElMessage.warning(t('dictionary.messages.pleaseSelectRepo'))
    return
  }
  try {
    const modelConfig = await electronAPI.getLocalEmbeddingConfig()
    const newConfig = {
      apiURL: modelConfig.apiURL,
      apiKey: modelConfig.apiKey,
      modelName: modelConfig.modelName
    }
    await electronAPI.selectAndProcessPDF(activeIndex.value, newConfig)
    await loadFileList()
    ElMessage.success(t('dictionary.messages.fileAdded'))
  } catch (error) {
    ElMessage.error(t('dictionary.messages.addFileFailed'))
    console.error(error)
  }
}

const deleteFile = async (filename: string) => {
  try {
    await ElMessageBox.confirm(
      t('dictionary.messages.deleteFileConfirm', { name: filename }),
      t('dictionary.messages.warning'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    await electronAPI.deleteDocumentByName(activeIndex.value, filename)
    await loadFileList()
    ElMessage.success(t('dictionary.messages.deleteSuccess'))
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(t('dictionary.messages.deleteFailed'))
    }
  }
}

watch(
  activeIndex,
  async newVal => {
    if (newVal) {
      await loadFileList()
    }
  },
  { immediate: true }
)

onMounted(async () => {
  await Promise.all([getRepositories(), getALLAPISettings()])
  await initSelect()
  // 知识库引擎加载失败（如杀毒软件拦截 vec0.dll）时列表静默为空，这里显式提示原因
  if (repositoryStore.lastError) {
    ElMessage.error({ message: repositoryStore.lastError, duration: 0, showClose: true })
  }
})
</script>

<style scoped>
.dictionary-panel {
  padding: 16px 20px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg-page);
}

.panel-section {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
}

/* 基类（.section-header/.section-header .el-icon）见 common.css（批次 9），
   这里仅保留与基类的差异项：更小的标题下距、图标随标题字号。
   注意：只有「左侧标题 + 右侧操作按钮」的区块才两端对齐，
   普通标题区一律左对齐，否则图标和文字会被推散。 */
.section-header {
  justify-content: flex-start;
  margin-bottom: 12px;
}

.detail-section .section-header {
  justify-content: space-between;
}

.section-header .el-icon {
  color: var(--brand);
  font-size: inherit;
}

.repository-list {
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.repo-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: var(--bg-sunken);
  cursor: pointer;
  transition: all 0.2s;
}

.repo-item:hover {
  background: var(--brand-soft);
}

.repo-item.active {
  background: var(--brand-soft);
}

.repo-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text-1);
}

.delete-btn {
  opacity: 0;
  transition: opacity 0.3s;
  color: var(--el-color-danger);
}

.delete-btn:hover {
  color: var(--el-color-danger-dark-2);
}

.repo-item:hover .delete-btn {
  opacity: 1;
}

.empty-state {
  padding: 12px;
  text-align: center;
}

.add-repo-btn {
  border-radius: var(--radius-md);
}

.detail-section {
  flex: 1;
  min-height: 0;
}

.detail-section :deep(.el-table__header th) {
  background-color: var(--bg-sunken);
  color: var(--text-1);
  font-weight: 600;
  border-bottom: none;
}

.detail-section :deep(.el-table__row td) {
  border-bottom: 1px solid var(--border-color);
}

.welcome-section {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.api-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-right: 8px;
}

.api-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-success {
  background-color: var(--el-color-success);
  border-color: var(--el-color-success);
  color: #ffffff;
}

.btn-success:hover {
  background-color: var(--el-color-success);
  border-color: var(--el-color-success);
}

.btn-danger-sm {
  color: var(--el-color-danger);
  border-color: var(--el-color-danger-light-5);
  background: var(--bg-page);
}

.btn-danger-sm:hover {
  color: var(--el-color-danger-dark-2);
  border-color: var(--el-color-danger-light-3);
  background: var(--el-color-danger-light-9);
}

.dialog-footer {
  text-align: right;
}

.repository-list::-webkit-scrollbar {
  width: 5px;
}

.repository-list::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--border-strong);
}

.repository-list::-webkit-scrollbar-track {
  background: transparent;
}
</style>

<style>
/* section-header 公共暗色适配已收敛至 common.css；
   非 scoped 块不能用 :deep()（浏览器整条丢弃规则），子元素直接写类名 */
html.dark .dictionary-panel {
  background-color: var(--bg-page);
}

/* .panel-section 的底色由基础样式统一取 --bg-elevated，深色下不再覆盖 */
html.dark .repo-item {
  background: var(--bg-sunken);
}

html.dark .repo-item:hover {
  background: var(--bg-elevated);
}

html.dark .repo-item.active {
  background: var(--bg-elevated);
}

html.dark .repo-name {
  color: var(--text-2);
}

html.dark .detail-section .el-table__header th {
  background-color: var(--bg-elevated);
  color: var(--text-2);
}

html.dark .detail-section .el-table__row td {
  border-bottom-color: var(--border-color);
}

html.dark .repository-list::-webkit-scrollbar-thumb {
  background: var(--border-strong);
}
</style>
