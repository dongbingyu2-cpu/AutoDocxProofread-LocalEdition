<template>
  <div class="setting-section">
    <div class="section-header">
      <el-icon><DataLine /></el-icon>
      <span>{{ t('tokenStats.title') }}</span>
    </div>
    <div class="token-stats">
      <el-statistic :value="totalTokens" class="statistic">
        <template #title>
          <div class="statistic-title">
            <span>{{ t('tokenStats.totalTokens') }}</span>
            <el-tooltip effect="dark" :content="t('tokenStats.tooltip')" placement="top">
              <el-icon class="tooltip-icon"><QuestionFilled /></el-icon>
            </el-tooltip>
          </div>
        </template>
      </el-statistic>
      <el-button :icon="Delete" class="btn-reset" @click="handleReset">
        {{ t('tokenStats.clearStats') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Delete, DataLine, QuestionFilled } from '@element-plus/icons-vue'
import { useToken } from '../../composables/useToken'

const { t } = useI18n()
const { totalTokens, resetTokens } = useToken()

const handleReset = () => {
  resetTokens()
}
</script>

<style scoped>
.token-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.statistic {
  flex: 1;
}

.statistic :deep(.el-statistic__number) {
  color: var(--text-1);
  font-weight: 600;
}

.statistic-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
}

.tooltip-icon {
  cursor: help;
  color: var(--text-3);
  transition: color 0.25s;
}

.tooltip-icon:hover {
  color: var(--brand);
}

/* 危险操作：Codex 风格为「红字 + 细边框」，hover 才给淡红底，不用实心红抢视线 */
.btn-reset {
  white-space: nowrap;
  --el-button-bg-color: transparent;
  --el-button-border-color: var(--border-color);
  --el-button-text-color: var(--el-color-danger);
  --el-button-hover-bg-color: var(--el-color-danger-light-9);
  --el-button-hover-border-color: var(--el-color-danger-light-5);
  --el-button-hover-text-color: var(--el-color-danger-dark-2);
  --el-button-active-bg-color: var(--el-color-danger-light-8);
  --el-button-active-border-color: var(--el-color-danger-light-5);
  --el-button-active-text-color: var(--el-color-danger-dark-2);
}

</style>

<style>
/* setting-section / section-header / tooltip-icon 的公共暗色适配已收敛至 common.css */
html.dark .statistic .el-statistic__number {
  color: var(--text-1);
}

html.dark .statistic-title {
  color: var(--text-3);
}
</style>
