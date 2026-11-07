<template>
  <div class="about-container">
    <!-- 头部：品牌 + 版本 -->
    <header class="hero">
      <img src="../assets/logo.png" alt="Logo" class="logo" />
      <h1 class="hero-title">{{ t('about.pageTitle') }}</h1>
      <p class="hero-sub">{{ t('about.subtitle') }}</p>
      <p v-if="appVersion" class="hero-version cx-mono">v{{ appVersion }}</p>
    </header>

    <el-tabs v-model="activeTab" class="content-tabs">
      <!-- ==================== 概览 ==================== -->
      <el-tab-pane :label="t('about.tabs.overview')" name="overview">
        <div class="tab-card">
          <h2>{{ t('about.overview.title') }}</h2>
          <p>{{ t('about.overview.desc') }}</p>

          <h3>{{ t('about.overview.capabilities') }}</h3>
          <ul class="cap-list">
            <li v-for="index in 6" :key="index">
              <span class="cap-dot" />
              <span>{{ t(`about.overview.cap${index}`) }}</span>
            </li>
          </ul>

          <div class="notice">
            <el-icon class="notice-icon"><InfoFilled /></el-icon>
            <div>
              <strong>{{ t('about.overview.noticeTitle') }}</strong>
              <p>{{ t('about.overview.notice') }}</p>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ==================== 使用指南 ==================== -->
      <el-tab-pane :label="t('about.tabs.guide')" name="guide">
        <div class="tab-card">
          <h2>{{ t('about.guide.title') }}</h2>

          <ol class="steps">
            <li v-for="index in 4" :key="index" class="step">
              <span class="step-index cx-mono">{{ index }}</span>
              <div class="step-body">
                <span class="step-title">{{ t(`about.guide.step${index}Title`) }}</span>
                <p>{{ t(`about.guide.step${index}`) }}</p>
              </div>
            </li>
          </ol>

          <h3>{{ t('about.guide.sidebarTitle') }}</h3>
          <p>{{ t('about.guide.sidebarDesc') }}</p>

          <h3>{{ t('about.guide.tipsTitle') }}</h3>
          <ul>
            <li v-for="index in 3" :key="index">{{ t(`about.guide.tip${index}`) }}</li>
          </ul>
        </div>
      </el-tab-pane>

      <!-- ==================== 数据与隐私 ==================== -->
      <el-tab-pane :label="t('about.tabs.data')" name="data">
        <div class="tab-card">
          <h2>{{ t('about.data.title') }}</h2>
          <p>{{ t('about.data.desc') }}</p>

          <h3>{{ t('about.data.pathsTitle') }}</h3>
          <dl class="path-list">
            <div v-for="item in pathRows" :key="item.key" class="path-row">
              <dt>{{ t(item.labelKey) }}</dt>
              <dd>
                <code class="cx-mono" :title="item.value">{{ displayPath(item) }}</code>
                <button v-if="item.value" class="copy-btn" :title="t('about.data.copy')" @click="copyPath(item.value)">
                  <el-icon><CopyDocument /></el-icon>
                </button>
              </dd>
            </div>
          </dl>

          <h3>{{ t('about.data.backupTitle') }}</h3>
          <p>{{ t('about.data.backupDesc') }}</p>

          <h3>{{ t('about.data.privacyTitle') }}</h3>
          <p>{{ t('about.data.privacyDesc') }}</p>
        </div>
      </el-tab-pane>

      <!-- ==================== 开源许可 ==================== -->
      <el-tab-pane :label="t('about.tabs.license')" name="license">
        <div class="tab-card">
          <h2>{{ t('about.license.title') }}</h2>

          <h3>{{ t('about.license.originTitle') }}</h3>
          <p>{{ t('about.license.originDesc') }}</p>

          <h3>{{ t('about.license.licenseTitle') }}</h3>
          <p>{{ t('about.license.licenseDesc') }}</p>

          <h3>{{ t('about.license.thirdPartyTitle') }}</h3>
          <ul>
            <li v-for="index in 4" :key="index">{{ t(`about.license.thirdParty${index}`) }}</li>
          </ul>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon, ElMessage, ElTabPane, ElTabs } from 'element-plus'
import { InfoFilled, CopyDocument } from '@element-plus/icons-vue'

const { t } = useI18n()

const activeTab = ref('overview')
const appVersion = ref('')
const dataPaths = ref({ userData: '', database: '', logs: '', knowledge: '' })

const pathRows = computed(() => [
  { key: 'userData', labelKey: 'about.data.pathData', value: dataPaths.value.userData },
  { key: 'database', labelKey: 'about.data.pathDb', value: dataPaths.value.database },
  { key: 'logs', labelKey: 'about.data.pathLogs', value: dataPaths.value.logs },
  { key: 'knowledge', labelKey: 'about.data.pathKnowledge', value: dataPaths.value.knowledge }
])

const copyPath = async value => {
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(t('about.data.copied'))
  } catch {
    ElMessage.warning(value)
  }
}

/**
 * 路径展示：首项给完整路径，其余项省略公共前缀后只显示有区分度的尾部
 * （否则四个路径截断后长得一模一样，分不清）。复制时仍用完整路径。
 */
const displayPath = item => {
  if (!item.value) return '—'
  if (item.key === 'userData') return item.value
  const base = dataPaths.value.userData
  if (base && item.value.startsWith(base)) {
    return `…${item.value.slice(base.length)}`
  }
  return item.value
}

onMounted(async () => {
  try {
    appVersion.value = (await window.electronAPI?.getAppVersion?.()) || ''
  } catch {
    appVersion.value = ''
  }
  try {
    const paths = await window.electronAPI?.getDataPaths?.()
    if (paths) dataPaths.value = paths
  } catch {
    // 取不到路径时保留占位符，不影响其它信息展示
  }
})
</script>

<style scoped>
.about-container {
  height: 100%;
  overflow-y: auto;
  padding: 20px 22px 32px;
  background: var(--bg-page);
  color: var(--text-1);
}

/* ---------------- 头部 ---------------- */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0 18px;
}

.logo {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  margin-bottom: 6px;
}

.hero-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-1);
}

.hero-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-3);
}

.hero-version {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: var(--text-3);
  padding: 1px 7px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
}

/* ---------------- 标签页 ---------------- */
.content-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.content-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.content-tabs :deep(.el-tabs__item) {
  font-size: 13px;
  padding: 0 14px;
  height: 38px;
  line-height: 38px;
}

.content-tabs :deep(.el-tabs__active-bar) {
  height: 2px;
  border-radius: 1px;
}

.tab-card {
  padding: 18px 2px 4px;
}

.content-tabs h2 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.content-tabs h3 {
  margin: 18px 0 6px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--brand);
}

html.dark .content-tabs h3 {
  color: var(--brand-bright);
}

.content-tabs p {
  margin: 6px 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--text-2);
}

.content-tabs ul,
.content-tabs ol {
  margin: 6px 0;
  padding-left: 18px;
}

.content-tabs li {
  margin: 4px 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
}

/* ---------------- 能力列表 ---------------- */
.cap-list {
  list-style: none;
  padding-left: 0 !important;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.cap-list li {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 0;
}

.cap-dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  margin-top: 8px;
  border-radius: 50%;
  background: var(--brand);
}

html.dark .cap-dot {
  background: var(--brand-bright);
}

/* ---------------- 步骤 ---------------- */
.steps {
  list-style: none;
  padding-left: 0 !important;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.step-index {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 10px;
  font-weight: 600;
}

html.dark .step-index {
  color: var(--brand-bright);
}

.step-body {
  min-width: 0;
}

.step-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.step-body p {
  margin: 2px 0 0;
  font-size: 12.5px;
}

/* ---------------- 提示条 ---------------- */
.notice {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 16px;
  padding: 10px 12px;
  border-left: 2px solid var(--el-color-warning);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--el-color-warning-light-9);
}

.notice-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--el-color-warning-dark-2);
  font-size: 13px;
}

.notice strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--el-color-warning-dark-2);
  margin-bottom: 2px;
}

.notice p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-2);
}

/* ---------------- 路径列表 ---------------- */
.path-list {
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.path-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.path-row dt {
  flex-shrink: 0;
  width: 76px;
  font-size: 12px;
  color: var(--text-3);
}

.path-row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.path-row code {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.copy-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
</style>
