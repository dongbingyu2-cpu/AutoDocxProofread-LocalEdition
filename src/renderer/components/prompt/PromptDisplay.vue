<template>
  <div class="setting-section">
    <div class="section-header">
      <el-icon><DataLine /></el-icon>
      <span>{{ t('promptDisplay.title') }}</span>
    </div>
    <div class="prompt-content-wrapper">
      <div class="prompt-meta">
        <span class="prompt-label">{{ t('promptDisplay.currentMode') }}</span>
        <el-tag size="small" class="mode-tag">{{ modeLabel }}</el-tag>
      </div>
      <div class="prompt-label">{{ t('promptDisplay.currentPrompt') }}</div>
      <el-text class="prompt-content">
        {{ effectivePrompt }}
      </el-text>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DataLine } from '@element-plus/icons-vue'
import { usePrompt } from '../../composables/usePrompt'

const { t } = useI18n()
const { effectivePrompt, settings } = usePrompt()

const modeLabel = computed(() =>
  settings.value.customPromptEnabled ? t('promptDisplay.modeCustomLabel') : t('promptDisplay.modeGeneratedLabel')
)
</script>

<style scoped>
.prompt-content-wrapper {
  padding: 4px 0;
}

.prompt-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.prompt-label {
  font-weight: 600;
  margin-bottom: 12px;
  font-size: 14px;
  color: var(--text-1);
}

.mode-tag {
  background-color: var(--brand-soft);
  border-color: var(--border-strong);
  color: var(--brand);
}

.prompt-content {
  display: block;
  padding: 14px 16px;
  background-color: var(--bg-sunken);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 13px;
  line-height: 1.8;
  max-height: 260px;
  overflow-y: auto;
  border: none;
  color: var(--text-2);
}

.prompt-content::-webkit-scrollbar {
  width: 5px;
}

.prompt-content::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 3px;
}

.prompt-content::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.prompt-content::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

</style>

<style>
/* setting-section / section-header 的公共暗色适配已收敛至 common.css */
html.dark .prompt-label {
  color: var(--text-2);
}

html.dark .mode-tag {
  background-color: var(--bg-elevated);
  border-color: var(--border-color);
  color: var(--text-2);
}

html.dark .prompt-content {
  background-color: var(--bg-elevated);
  color: var(--text-3);
}

html.dark .prompt-content::-webkit-scrollbar-thumb {
  background: var(--border-strong);
}

html.dark .prompt-content::-webkit-scrollbar-thumb:hover {
  background: var(--text-3);
}
</style>
