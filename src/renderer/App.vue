<template>
  <div class="app-layout">
    <el-config-provider :locale="elementLocale">
      <!-- ==================== 左侧栏（全高，可折叠） ==================== -->
      <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="sidebar-brand">
          <img src="./assets/logo.png" alt="Logo" class="sidebar-logo" />
          <div v-if="!sidebarCollapsed" class="brand-text">
            <span class="brand-name">AutoDocxProofread</span>
            <span class="brand-sub cx-mono">LOCAL EDITION</span>
          </div>
        </div>

        <nav class="sidebar-nav thin-scrollbar">
          <el-tooltip
            v-for="item in navPrimary"
            :key="item.path"
            :content="t(item.label)"
            placement="right"
            :disabled="!sidebarCollapsed"
            :show-after="300"
          >
            <button
              class="nav-item"
              :class="{ active: isActive(item) }"
              :aria-current="isActive(item) ? 'page' : undefined"
              @click="router.push(item.path)"
            >
              <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
              <span v-if="!sidebarCollapsed" class="nav-label">{{ t(item.label) }}</span>
            </button>
          </el-tooltip>

          <p v-if="!sidebarCollapsed" class="nav-group-label nav-group-label-spaced">{{ t('app.sidebar.preferences') }}</p>

          <el-tooltip
            v-for="item in navSecondary"
            :key="item.path"
            :content="t(item.label)"
            placement="right"
            :disabled="!sidebarCollapsed"
            :show-after="300"
          >
            <button
              class="nav-item"
              :class="{ active: isActive(item) }"
              :aria-current="isActive(item) ? 'page' : undefined"
              @click="router.push(item.path)"
            >
              <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
              <span v-if="!sidebarCollapsed" class="nav-label">{{ t(item.label) }}</span>
            </button>
          </el-tooltip>
        </nav>

        <!-- 文档列表（工作区）：常驻侧栏，点击直接在校对页打开 -->
        <WorkspaceList :collapsed="sidebarCollapsed" />

        <div class="sidebar-footer">
          <el-tooltip :content="t('app.sidebar.theme')" placement="right" :disabled="!sidebarCollapsed" :show-after="300">
            <button class="nav-item nav-item-compact" @click="toggleDark()">
              <el-icon class="nav-icon">
                <Moon v-if="isDark" />
                <Sunny v-else />
              </el-icon>
              <span v-if="!sidebarCollapsed" class="nav-label">{{ isDark ? t('app.theme.dark') : t('app.theme.light') }}</span>
            </button>
          </el-tooltip>

          <el-tooltip :content="t('app.sidebar.language')" placement="right" :disabled="!sidebarCollapsed" :show-after="300">
            <button class="nav-item nav-item-compact" @click="toggleLocale">
              <span class="lang-badge cx-mono">{{ localeStore.locale === 'en' ? 'EN' : '中' }}</span>
              <span v-if="!sidebarCollapsed" class="nav-label">{{ localeStore.locale === 'en' ? 'English' : '简体中文' }}</span>
            </button>
          </el-tooltip>

          <el-tooltip
            :content="sidebarCollapsed ? t('app.sidebar.expand') : t('app.sidebar.collapse')"
            placement="right"
            :show-after="300"
          >
            <button class="nav-item nav-item-compact" @click="sidebarCollapsed = !sidebarCollapsed">
              <el-icon class="nav-icon">
                <Expand v-if="sidebarCollapsed" />
                <Fold v-else />
              </el-icon>
              <span v-if="!sidebarCollapsed" class="nav-label">{{ t('app.sidebar.collapse') }}</span>
            </button>
          </el-tooltip>
        </div>
      </aside>

      <!-- ==================== 右侧主区 ==================== -->
      <div class="main-area">
        <!-- 全局顶栏：拖拽区 + 页面标题 + 模型状态 + 窗口控制 -->
        <header class="topbar">
          <div class="topbar-left">
            <span class="topbar-title">{{ pageTitle }}</span>
            <span class="topbar-path cx-mono">{{ route.path }}</span>
          </div>

          <div class="topbar-right">
            <span class="model-chip" :class="modelChipTone" :title="modelStatus">
              <span class="model-dot" />
              <span class="model-text">{{ modelStatus }}</span>
            </span>
            <WindowControls />
          </div>
        </header>

        <!-- 工作区 + 预览：预览面板在所有页面常驻（用户可随时对照文档），
             窄容器下的宽表格靠横向滚动 + 固定列不透明遮挡来保证不重叠，
             见 codex.css 表格段的注释。 -->
        <div class="content-row">
          <main class="function-panel">
            <FormatClone v-if="activeMode === 'format-clone'" />
            <router-view v-else />
          </main>

          <div class="pane-divider" aria-hidden="true" />

          <section class="preview-panel">
            <DocPreview ref="docPreviewRef" />
          </section>
        </div>

        <!-- 状态栏：mono 元信息，Codex 式底栏 -->
        <footer class="statusbar">
          <span class="status-item">
            <span class="status-dot" :class="modelChipTone" />
            {{ modelStatus }}
          </span>
          <span v-if="taskRunning" class="status-item status-item-accent">{{ t('app.status.running') }}</span>
          <span class="status-spacer" />
          <span v-if="fileName" class="status-item status-ellipsis" :title="fileName">{{ fileName }}</span>
          <span class="status-item cx-mono">{{ appVersion }}</span>
        </footer>
      </div>
    </el-config-provider>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, provide, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { HomeFilled, InfoFilled, Setting, Clock, Collection, Sunny, Moon, Fold, Expand } from '@element-plus/icons-vue'
import { useDark, useToggle } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { useApiStore } from './stores/apiStore'
import { useLocaleStore } from './stores/localeStore'
import { useSkinStore } from './stores/skinStore'
import { fileInfoStore } from './stores/store'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/theme-chalk/dark/css-vars.css'
import DocPreview from './components/DocPreview.vue'
import WindowControls from './components/WindowControls.vue'
import WorkspaceList from './components/WorkspaceList.vue'
// 格式克隆初始不可见且体量大，异步加载：首屏不拉取该 chunk
const FormatClone = defineAsyncComponent(() => import('./views/FormatClone.vue'))

const SIDEBAR_KEY = 'cx-sidebar-collapsed'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const apiStore = useApiStore()
const localeStore = useLocaleStore()
const skinStore = useSkinStore()
const fileStore = fileInfoStore()

/* ---------------- 主题：Codex 默认深色 ---------------- */
const isDark = useDark({ initialValue: 'dark' })
const toggleDark = useToggle(isDark)

// 浅色皮肤同步到 html[data-skin]（tokens.css 据此覆盖品牌色；深色主题下无效果）
watch(
  () => skinStore.skin,
  skin => {
    document.documentElement.setAttribute('data-skin', skin)
  },
  { immediate: true }
)

/* ---------------- 侧栏折叠（持久化） ---------------- */
const sidebarCollapsed = ref(false)
try {
  sidebarCollapsed.value = window.localStorage.getItem(SIDEBAR_KEY) === '1'
} catch {
  // localStorage 不可用时保持默认展开
}
watch(sidebarCollapsed, value => {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, value ? '1' : '0')
  } catch {
    // 忽略写入失败
  }
})

/* ---------------- 导航 ---------------- */
const navPrimary = [
  { path: '/proof', icon: HomeFilled, label: 'app.nav.proof' },
  { path: '/history', icon: Clock, label: 'app.nav.history' },
  { path: '/dictionary', icon: Collection, label: 'app.nav.dictionary' }
]

const navSecondary = [
  { path: '/api', icon: Setting, label: 'app.nav.settings', aliases: ['/set'] },
  { path: '/about', icon: InfoFilled, label: 'app.nav.about' }
]

const isActive = item => route.path === item.path || (item.aliases || []).includes(route.path)

const pageTitle = computed(() => {
  const map = {
    '/proof': 'app.nav.proof',
    '/history': 'app.nav.history',
    '/dictionary': 'app.nav.dictionary',
    '/api': 'app.nav.settings',
    '/set': 'app.nav.settings',
    '/about': 'app.nav.about'
  }
  return t(map[route.path] || 'app.nav.proof')
})

const toggleLocale = () => {
  localeStore.setLocale(localeStore.locale === 'en' ? 'zh-CN' : 'en')
}

/* ---------------- 模型状态 ---------------- */
const modelStatus = computed(() => {
  const api = apiStore.selectedApi
  if (!api?.id) return t('app.status.noModel')
  const where = api.provider === 'ollama' ? t('app.status.local') : t('app.status.cloud')
  return `${where} · ${api.name}`
})

// 状态点颜色：未选模型为中性灰，本地为品牌绿，云端为蓝
const modelChipTone = computed(() => {
  const api = apiStore.selectedApi
  if (!api?.id) return 'is-idle'
  return api.provider === 'ollama' ? 'is-local' : 'is-cloud'
})

const fileName = computed(() => fileStore.fileName || '')
const appVersion = ref('')
onMounted(async () => {
  try {
    appVersion.value = (await window.electronAPI?.getAppVersion?.()) || ''
  } catch {
    appVersion.value = ''
  }
})

/* ---------------- 跨组件契约（不能删：Proof / DocPreview / FormatClone 依赖） ---------------- */
const previewContainer = ref(null)
provide('previewContainer', previewContainer)

const documentTaskRunning = ref(false)
provide('documentTaskRunning', documentTaskRunning)
const taskRunning = documentTaskRunning

const activeMode = ref('proof')
provide('activeMode', activeMode)
provide('setActiveMode', mode => {
  activeMode.value = mode
})

/* 供「工作区」等页面调用：把指定文档加载进预览，并确保回到校对模式 */
const docPreviewRef = ref(null)
provide('openDocument', async (filePath, fileName) => {
  if (activeMode.value !== 'proof') activeMode.value = 'proof'
  const ok = await docPreviewRef.value?.loadFile(filePath, fileName, { preserveResults: true })
  return ok === true
})

// 离开校对页面时自动退出格式克隆模式
watch(() => route.path, newPath => {
  if (newPath !== '/proof' && activeMode.value !== 'proof') {
    activeMode.value = 'proof'
  }
})

const elementLocale = computed(() => (localeStore.locale === 'en' ? en : zhCn))
</script>

<style scoped>
.app-layout {
  height: 100vh;
  display: flex;
  overflow: hidden;
  background-color: var(--bg-page);
  color: var(--text-1);
}

/* ==================== 侧栏 ==================== */
.sidebar {
  width: var(--sidebar-expanded);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-panel);
  border-right: 1px solid var(--border-color);
  transition: width var(--dur-base) var(--ease);
  overflow: hidden;
  /* 注意：这里不能设 -webkit-app-region: drag。
     整栏设为 drag 后，其中的文档列表、按钮点击会被窗口拖拽吞掉（真实 Electron 下表现为「点不动」）。
     只有品牌区需要拖窗，见 .sidebar-brand。 */
}

.sidebar.collapsed {
  width: var(--sidebar-width);
}

.sidebar-brand {
  height: var(--topbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border-color);
  overflow: hidden;
  /* 唯一可拖窗区域：侧栏其余部分都是交互控件 */
  -webkit-app-region: drag;
}

.collapsed .sidebar-brand {
  padding: 0;
  justify-content: center;
}

.sidebar-logo {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.brand-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-sub {
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--text-3);
  white-space: nowrap;
}

/* ---------- 导航 ---------- */
/* 导航不再独占剩余空间：下方要让给常驻的文档列表 */
.sidebar-nav {
  flex: 0 0 auto;
  padding: 8px 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.collapsed .sidebar-nav {
  padding: 10px 6px;
}

.nav-group-label {
  margin: 0 0 6px;
  padding: 0 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  white-space: nowrap;
}

.nav-group-label-spaced {
  margin-top: 16px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  -webkit-app-region: no-drag;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.collapsed .nav-item {
  justify-content: center;
  padding: 0;
  gap: 0;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.nav-item.active {
  background: var(--bg-active);
  color: var(--text-1);
}

.nav-item.active .nav-icon {
  color: var(--brand);
}

html.dark .nav-item.active .nav-icon {
  color: var(--brand-bright);
}

.nav-icon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--text-3);
  transition: color var(--dur-fast) var(--ease);
}

.nav-item:hover .nav-icon {
  color: var(--text-2);
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item-compact {
  height: 32px;
  font-size: 12px;
  color: var(--text-3);
}

.lang-badge {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xs);
}

.sidebar-footer {
  flex-shrink: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--border-color);
}

.collapsed .sidebar-footer {
  padding: 8px 6px;
}

/* ==================== 主区 ==================== */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ---------- 顶栏 ---------- */
.topbar {
  height: var(--topbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-left: 16px;
  background-color: var(--bg-panel);
  border-bottom: 1px solid var(--border-color);
  /* 整条顶栏作为窗口拖拽手柄 */
  -webkit-app-region: drag;
}

.topbar-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.topbar-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
}

.topbar-path {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-right {
  display: flex;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
}

/* 模型状态 chip */
.model-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  margin-right: 12px;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  border: 1px solid var(--border-color);
  font-size: 11.5px;
  color: var(--text-2);
  max-width: 260px;
  -webkit-app-region: no-drag;
}

.model-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-dot,
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-3);
}

.model-chip.is-local .model-dot,
.status-dot.is-local {
  background: var(--brand);
}

.model-chip.is-cloud .model-dot,
.status-dot.is-cloud {
  background: #388bfd;
}

/* ---------- 内容区 ---------- */
.content-row {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.function-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background-color: var(--bg-page);
}

.pane-divider {
  width: 1px;
  flex-shrink: 0;
  background: var(--border-color);
}

.preview-panel {
  flex: 1.35;
  min-width: 0;
  overflow: hidden;
  background-color: var(--bg-panel);
}

/* ---------- 状态栏 ---------- */
.statusbar {
  height: var(--statusbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-color);
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  overflow: hidden;
}

.status-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.status-item-accent {
  color: var(--brand);
}

html.dark .status-item-accent {
  color: var(--brand-bright);
}

.status-spacer {
  flex: 1;
}

.status-ellipsis {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
}

/* ---------- 窄屏自适应 ---------- */
@media (max-width: 1024px) {
  .preview-panel {
    flex: 1;
  }

  .topbar-path {
    display: none;
  }
}
</style>
