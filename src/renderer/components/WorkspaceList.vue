<template>
  <div v-show="!collapsed" class="wl">
    <div class="wl-head">
      <span class="wl-title cx-mono">{{ t('workspace.sidebarTitle') }}</span>
      <div class="wl-head-actions">
        <button
          class="wl-head-btn"
          :class="{ active: searchOpen }"
          :title="t('workspace.searchSidebar')"
          @click="toggleSearch"
        >
          <el-icon><Search /></el-icon>
        </button>
        <button class="wl-head-btn" :title="t('workspace.refresh')" @click="loadList">
          <el-icon :class="{ spinning: loading }"><Refresh /></el-icon>
        </button>
      </div>
    </div>

    <div v-if="searchOpen" class="wl-search">
      <el-input
        ref="searchInputRef"
        v-model="keyword"
        size="small"
        :placeholder="t('workspace.searchSidebar')"
        clearable
        @input="scheduleSearch"
      />
    </div>

    <div v-loading="loading" class="wl-tree thin-scrollbar">
      <section v-for="folder in tree" :key="folder.key" class="wl-folder">
        <button class="wl-folder-head" :title="folder.path" @click="toggleFolder(folder.key)">
          <el-icon class="wl-folder-icon" :class="{ open: !isCollapsed(folder.key) }">
            <FolderOpened v-if="!isCollapsed(folder.key)" />
            <Folder v-else />
          </el-icon>
          <span class="wl-folder-name">{{ folder.name }}</span>
          <span class="wl-folder-count cx-mono">{{ folder.items.length }}</span>
          <el-icon class="wl-folder-chevron" :class="{ open: !isCollapsed(folder.key) }">
            <ArrowRight />
          </el-icon>
        </button>

        <div v-show="!isCollapsed(folder.key)" class="wl-folder-items">
          <div
            v-for="doc in folder.items"
            :key="doc.id"
            class="wl-doc"
            :class="{
              'is-active': doc.filePath === activePath,
              'is-missing': doc.fileExists === false
            }"
            role="button"
            tabindex="0"
            :title="doc.filePath"
            @click="openDoc(doc)"
            @keydown.enter.prevent="openDoc(doc)"
          >
            <span class="wl-doc-name">{{ doc.fileName }}</span>
            <el-icon v-if="openingId === doc.id" class="wl-doc-loading"><Loading /></el-icon>
            <span v-else class="wl-doc-time cx-mono">{{ relativeTime(doc.updatedAt) }}</span>

            <!-- 行内菜单：hover / 聚焦时出现，替代时间显示 -->
            <el-dropdown
              trigger="click"
              placement="bottom-end"
              :hide-on-click="true"
              @command="command => handleCommand(command, doc)"
              @click.stop
            >
              <button class="wl-doc-more" :title="t('workspace.moreActions')" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="open" :disabled="doc.fileExists === false">
                    {{ t('workspace.continueProof') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="reveal" :disabled="doc.fileExists === false">
                    {{ t('workspace.reveal') }}
                  </el-dropdown-item>
                  <el-dropdown-item v-if="doc.lastExportPath" command="openExport">
                    {{ t('workspace.openExport') }}
                  </el-dropdown-item>
                  <el-dropdown-item command="remove" divided>{{ t('workspace.remove') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </section>

      <p v-if="!loading && tree.length === 0" class="wl-empty">
        {{ keyword.trim() ? t('workspace.emptyFiltered') : t('workspace.emptySidebar') }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElIcon,
  ElInput,
  ElMessage,
  ElMessageBox
} from 'element-plus'
import { Folder, FolderOpened, ArrowRight, Refresh, Search, MoreFilled, Loading } from '@element-plus/icons-vue'
import { fileInfoStore } from '../stores/store'

const props = defineProps({
  /** 侧栏折叠时整个隐藏 */
  collapsed: { type: Boolean, default: false }
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const electronAPI = window.electronAPI
const fileStore = fileInfoStore()
// 由 App.vue 提供：把文档加载进右侧预览（复用 DocPreview 的统一入口）
const openDocument = inject('openDocument', null)

const docs = ref([])
const loading = ref(false)
const collapsedFolders = ref(new Set())
const keyword = ref('')
const searchOpen = ref(false)
const searchInputRef = ref(null)
/** 正在打开的文档 id：行内显示 loading，避免点了没反应的感觉 */
const openingId = ref(null)

/** 当前正在校对/预览的文档路径，用于高亮 */
const activePath = computed(() => fileStore.filePath || '')

const parseSqliteDate = raw => {
  if (!raw) return null
  const date = new Date(`${String(raw).replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const dirOf = filePath => {
  const normalized = String(filePath || '')
  const idx = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return idx > 0 ? normalized.slice(0, idx) : normalized
}

const baseName = dir => {
  const idx = Math.max(dir.lastIndexOf('\\'), dir.lastIndexOf('/'))
  return idx >= 0 ? dir.slice(idx + 1) || dir : dir
}

const relativeTime = raw => {
  const date = parseSqliteDate(raw)
  if (!date) return ''
  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return t('workspace.timeJustNow')
  if (diff < hour) return `${Math.floor(diff / minute)}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  if (diff < 30 * day) return `${Math.floor(diff / day)}d`
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo`
  return `${Math.floor(diff / (365 * day))}y`
}

/** 按文件夹分组，组内/组间都按最近操作倒序 */
const tree = computed(() => {
  const buckets = new Map()
  for (const doc of docs.value) {
    const dir = dirOf(doc.filePath)
    if (!buckets.has(dir)) {
      buckets.set(dir, { key: dir, path: dir, name: baseName(dir), items: [], latest: 0 })
    }
    const bucket = buckets.get(dir)
    bucket.items.push(doc)
    const ts = parseSqliteDate(doc.updatedAt)?.getTime() || 0
    if (ts > bucket.latest) bucket.latest = ts
  }
  return Array.from(buckets.values())
    .map(bucket => ({
      ...bucket,
      items: bucket.items.sort(
        (a, b) => (parseSqliteDate(b.updatedAt)?.getTime() || 0) - (parseSqliteDate(a.updatedAt)?.getTime() || 0)
      )
    }))
    .sort((a, b) => b.latest - a.latest)
})

const isCollapsed = key => collapsedFolders.value.has(key)

const toggleFolder = key => {
  const next = new Set(collapsedFolders.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedFolders.value = next
}

const toggleSearch = async () => {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    await nextTick()
    searchInputRef.value?.focus?.()
  } else if (keyword.value) {
    keyword.value = ''
    loadList()
  }
}

const loadList = async () => {
  if (loading.value) return
  loading.value = true
  try {
    docs.value = (await electronAPI.workspaceList(keyword.value)) || []
  } catch (error) {
    console.error('工作区列表加载失败:', error)
    docs.value = []
  } finally {
    loading.value = false
  }
}

// 搜索防抖：避免每敲一个字打一次 IPC
let searchTimer = null
const scheduleSearch = () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadList, 220)
}

/** 点击文档：恢复上次校对结果并跳到校对页 */
const openDoc = async doc => {
  if (doc.fileExists === false) {
    ElMessage.warning(t('workspace.fileMissing'))
    return
  }
  // 已经在校对页打开的就是它：给个明确提示，而不是静默返回（否则看起来像点击没反应）
  if (doc.filePath === activePath.value && route.path === '/proof') {
    ElMessage.info(t('workspace.alreadyOpen'))
    return
  }
  if (openingId.value) return
  openingId.value = doc.id
  try {
    const result = await electronAPI.workspaceRestore(doc.id)
    if (!result || !result.success) {
      ElMessage.warning(result?.reason === 'file-missing' ? t('workspace.fileMissing') : t('workspace.restoreFailed'))
      await loadList()
      return
    }
    fileStore.setCorrectResult([])
    if (typeof openDocument === 'function') {
      await openDocument(result.filePath, result.fileName)
    } else {
      fileStore.setFilePath(result.filePath)
      fileStore.setFileName(result.fileName)
    }
    if (result.results && result.results.length) {
      fileStore.setCorrectResult(result.results)
    }
    if (route.path !== '/proof') router.push('/proof')
  } catch (error) {
    console.error('从侧栏打开文档失败:', error)
    ElMessage.error(t('workspace.restoreFailed'))
  } finally {
    openingId.value = null
  }
}

const reveal = async doc => {
  const ok = await electronAPI.workspaceReveal(doc.filePath)
  if (!ok) ElMessage.warning(t('workspace.fileMissing'))
}

const openExport = async doc => {
  const ok = await electronAPI.workspaceOpenExport(doc.lastExportPath)
  if (!ok) ElMessage.warning(t('workspace.exportMissing'))
}

const remove = async doc => {
  try {
    await ElMessageBox.confirm(t('workspace.removeConfirm', { name: doc.fileName }), t('workspace.remove'), {
      type: 'warning',
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  const ok = await electronAPI.workspaceRemove(doc.id)
  if (ok) {
    docs.value = docs.value.filter(d => d.id !== doc.id)
    ElMessage.success(t('workspace.removed'))
  }
}

const handleCommand = (command, doc) => {
  if (command === 'open') openDoc(doc)
  else if (command === 'reveal') reveal(doc)
  else if (command === 'openExport') openExport(doc)
  else if (command === 'remove') remove(doc)
}

// 侧栏常驻，靠路由切换时机刷新：校对完切到别的页面时就能看到最新状态
watch(
  () => route.path,
  () => loadList(),
  { immediate: true }
)

defineExpose({ refresh: loadList })
</script>

<style scoped>
.wl {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-color);
  /* 显式声明非拖拽区：防止祖先的 app-region 让点击失效 */
  -webkit-app-region: no-drag;
}

.wl-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px 0 12px;
  margin-top: 4px;
}

.wl-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  user-select: none;
}

.wl-head-actions {
  display: flex;
  align-items: center;
  gap: 1px;
}

.wl-head-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.wl-head-btn:hover,
.wl-head-btn.active {
  background: var(--bg-hover);
  color: var(--text-1);
}

.wl-head-btn .spinning {
  animation: wl-spin 0.9s linear infinite;
}

@keyframes wl-spin {
  to {
    transform: rotate(360deg);
  }
}

.wl-search {
  flex-shrink: 0;
  padding: 4px 8px 6px;
}

.wl-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 12px;
}

.wl-folder + .wl-folder {
  margin-top: 1px;
}

.wl-folder-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.wl-folder-head:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.wl-folder-icon {
  font-size: 12px;
  color: var(--text-3);
  flex-shrink: 0;
}

.wl-folder-icon.open {
  color: var(--brand);
}

html.dark .wl-folder-icon.open {
  color: var(--brand-bright);
}

.wl-folder-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wl-folder-count {
  font-size: 9px;
  color: var(--text-3);
  flex-shrink: 0;
  margin-right: 1px;
}

.wl-folder-chevron {
  font-size: 9px;
  color: var(--text-3);
  flex-shrink: 0;
  transition: transform var(--dur-fast) var(--ease);
}

.wl-folder-chevron.open {
  transform: rotate(90deg);
}

.wl-folder-items {
  padding-left: 12px;
  overflow: hidden;
}

/* ---------- 文档行 ---------- */
.wl-doc {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 25px;
  padding: 0 4px 0 7px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
  outline: none;
}

.wl-doc:hover,
.wl-doc:focus-visible {
  background: var(--bg-hover);
}

.wl-doc:focus-visible {
  box-shadow: inset 0 0 0 1px var(--brand);
}

/* 当前打开的文档：左竖条 + 淡底，与校对页联动 */
.wl-doc.is-active {
  background: var(--bg-active);
}

.wl-doc.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 13px;
  border-radius: 0 2px 2px 0;
  background: var(--brand);
}

.wl-doc.is-missing {
  opacity: 0.5;
}

.wl-doc-name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wl-doc.is-active .wl-doc-name {
  color: var(--text-1);
  font-weight: 500;
}

.wl-doc.is-missing .wl-doc-name {
  text-decoration: line-through;
  text-decoration-color: var(--text-3);
}

.wl-doc-time {
  flex-shrink: 0;
  font-size: 9.5px;
  color: var(--text-3);
}

/* 打开中的转圈：替代时间位置，给出明确的进行中反馈 */
.wl-doc-loading {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--brand);
  animation: wl-spin 0.9s linear infinite;
}

html.dark .wl-doc-loading {
  color: var(--brand-bright);
}

/* 行内更多操作：hover / 聚焦时顶替时间位置 */
.wl-doc-more {
  position: absolute;
  right: 3px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.wl-doc:hover .wl-doc-more,
.wl-doc:focus-within .wl-doc-more {
  opacity: 1;
  pointer-events: auto;
}

.wl-doc:hover .wl-doc-time,
.wl-doc:focus-within .wl-doc-time {
  opacity: 0;
  /* 必须同时关掉命中测试：只设 opacity 的话它仍会挡住下方的「⋯」按钮 */
  pointer-events: none;
}

.wl-doc-more:hover {
  background: var(--bg-active);
  color: var(--text-1);
}

.wl-empty {
  margin: 10px 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}
</style>
