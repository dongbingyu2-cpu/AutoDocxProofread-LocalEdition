<template>
  <div v-if="!recentFilesStore.isEmpty" class="recent-cards">
    <div class="recent-cards-title">
      <el-icon><Files /></el-icon>
      <span>{{ t('recentFiles.cardTitle') }}</span>
    </div>
    <div class="recent-cards-grid">
      <div
        v-for="item in recentCardList"
        :key="item.path"
        class="recent-card"
        @click="emit('open', item)"
      >
        <el-icon class="recent-card-icon"><Document /></el-icon>
        <div class="recent-card-body">
          <div class="recent-card-name" :title="item.name">{{ item.name }}</div>
          <div class="recent-card-meta" :title="item.dir">{{ formatRecentTime(item.lastOpenedAt) }}</div>
        </div>
        <el-icon class="recent-card-close" @click.stop="removeRecentFile(item)"><Close /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon, ElMessage } from 'element-plus'
import { Close, Document, Files } from '@element-plus/icons-vue'
import { useRecentFilesStore, formatRelativeTime } from '../stores/recentFilesStore'

const emit = defineEmits(['open'])

const { t } = useI18n()
const recentFilesStore = useRecentFilesStore()

/** 预览区空状态展示的卡片列表（最多 6 条，避免空状态过长） */
const recentCardList = computed(() => recentFilesStore.getList.slice(0, 6))

const formatRecentTime = ts => formatRelativeTime(ts, t)

const removeRecentFile = item => {
  recentFilesStore.removeRecent(item.path)
  ElMessage.success(t('recentFiles.removed'))
}
</script>

<style scoped>
/* 预览区空状态：最近文件卡片（批次 9 自 DocPreview.vue 迁入） */
.recent-cards {
  width: 100%;
  max-width: 720px;
  margin-top: 12px;
}

.recent-cards-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 12px;
  padding-left: 4px;
}

.recent-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.recent-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background-color: var(--bg-elevated);
  cursor: pointer;
  transition: all 0.2s ease;
}

.recent-card:hover {
  border-color: var(--brand);
  background-color: var(--brand-soft);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px var(--brand-soft);
}

.recent-card-icon {
  color: var(--brand);
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.recent-card-body {
  flex: 1;
  min-width: 0;
}

.recent-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-card-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-card-close {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--text-3);
  font-size: 12px;
  padding: 2px;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.2s ease;
}

.recent-card:hover .recent-card-close {
  opacity: 1;
}

.recent-card-close:hover {
  color: var(--el-color-danger);
  background-color: rgba(194, 138, 138, 0.1);
}

/* 最近文件卡片：暗色模式 */
html.dark .recent-cards-title {
  color: var(--text-3);
}




</style>
