<template>
  <div class="proof-results-panel">
    <DocumentModelSelector />
    <div v-if="proofreadingResults.length > 0" class="results-container">
      <el-collapse v-model="activeNames">
        <el-collapse-item
          v-for="(item, index) in proofreadingResults"
          :id="`error-item-${index}`"
          :key="index"
          :name="index"
          :class="[`correction-item type-${correctionTypeCssKey(item.type)}`, { 'correction-item-rejected': item.rejected }]"
        >
          <template #title>
            <div class="correction-header" @click="scrollPreviewToCorrection(index)">
              <span class="correction-type" :class="`type-${correctionTypeCssKey(item.type)}`">
                {{ formatCorrectionType(item.type) }}
              </span>
              <span v-if="item.rejected" class="correction-rejected-tag">{{ t('proof.rejectedTag') }}</span>
              <el-icon v-if="item.applied" class="correction-applied-check" :title="t('proof.appliedTag')">
                <Check />
              </el-icon>
              <span class="correction-count">{{ index + 1 }}/{{ proofreadingResults.length }}</span>
            </div>
          </template>

          <div class="correction-content">
            <div class="original">
              <strong>{{ t('proof.original') }}</strong> {{ item.original || t('proof.noData') }}
            </div>
            <div class="suggested">
              <strong>{{ t('proof.suggested') }}</strong>
              <el-tag v-if="item.edited" size="small" type="info" class="edited-tag">{{ t('proof.editedTag') }}</el-tag>
              <template v-if="editingIndex === index">
                <el-input
                  v-model="editingText"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 8 }"
                  class="suggested-editor"
                  @click.stop
                />
                <div class="edit-actions">
                  <el-button size="small" type="primary" @click.stop="saveEdit(index)">
                    {{ t('proof.saveEdit') }}
                  </el-button>
                  <el-button size="small" @click.stop="cancelEdit">
                    {{ t('proof.cancelEdit') }}
                  </el-button>
                </div>
              </template>
              <template v-else>
                <span class="suggested-text">{{ item.suggested || t('proof.noData') }}</span>
                <el-icon
                  v-if="!item.applied"
                  class="edit-icon"
                  :title="t('proof.editSuggested')"
                  @click.stop="startEdit(index)"
                >
                  <EditPen />
                </el-icon>
              </template>
            </div>
            <div class="reason">
              <strong>{{ t('proof.reason') }}</strong> {{ item.reason || t('proof.noData') }}
            </div>
            <div v-if="item.qualityWarnings?.length" class="quality-note" data-testid="quality-warning">
              <strong>待核对：</strong>{{ item.qualityWarnings.join('；') }}。该提示不代表已证实存在错误，请核对后决定是否应用。
            </div>
            <div class="actions">
              <el-button
                v-if="!item.applied && !item.rejected"
                type="primary"
                size="small"
                @click.stop="applyCorrection(index)"
              >
                {{ t('proof.applyChanges') }}
              </el-button>
              <el-button v-if="item.applied" type="warning" size="small" @click.stop="undoCorrection(index)">
                {{ t('proof.undo') }}
              </el-button>
              <el-button
                v-if="!item.applied && !item.rejected"
                type="info"
                size="small"
                plain
                @click.stop="ignoreCorrection(index)"
              >
                {{ t('proof.ignore') }}
              </el-button>
              <el-button v-if="item.rejected" type="info" size="small" @click.stop="unignoreCorrection(index)">
                {{ t('proof.unignore') }}
              </el-button>
              <el-popover
                v-if="item.References && item.References.length > 0"
                placement="bottom-start"
                width="500px"
                trigger="click"
                popper-class="reference-popover"
              >
                <template #reference>
                  <el-button type="primary" size="small" style="margin-left: 8px" @click.stop>
                    {{ t('proof.viewReference') }}
                  </el-button>
                </template>

                <div class="reference-content">
                  <h4>{{ t('proof.referenceContent') }}</h4>
                  <div class="reference-list">
                    <div v-for="(reference, refIndex) in item.References" :key="refIndex" class="reference-item">
                      <span class="reference-index">{{ refIndex + 1 }}.</span>
                      <span class="reference-text">{{ reference }}</span>
                    </div>
                  </div>
                </div>
              </el-popover>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <div v-else class="no-results">
      <el-empty :description="fileName ? t('proof.noResults') : t('proof.selectDocToProof')" :image-size="60" />
    </div>
  </div>
</template>

<script setup>
import DocumentModelSelector from '../components/DocumentModelSelector.vue'
import { ref, onMounted, onUnmounted, watch, nextTick, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { ElButton, ElEmpty, ElCollapse, ElCollapseItem, ElInput, ElMessage, ElPopover, ElTag } from 'element-plus'
import { Check, EditPen } from '@element-plus/icons-vue'

import { scrollTo } from 'vue-scrollto'
import { fileInfoStore } from '../stores/store'
import { undoCorrectionsInPreview } from '../utils/correctionMatching'
import {
  applyAndHighlightCorrections,
  highlightCorrections as rebuildPreviewHighlights,
  unwrapHighlight
} from '../utils/highlight'
import { forceVisibleSection } from '../utils/previewPerf'
import { correctionTypeCssKey, correctionTypeLabel } from '../../shared/correctionTypes'

const previewContainer = inject('previewContainer')
const fileStore = fileInfoStore()
const fileName = computed(() => fileStore.fileName)
const proofreadingResults = computed({
  get: () => fileStore.results,
  set: val => fileStore.setCorrectResult(val)
})
const activeNames = ref([])
let previewFocusTimer = null
// 平滑滚动后恢复 content-visibility 的延迟句柄：组件卸载时需要清理
let restoreVisibilityTimer = null

// ---- 建议文本编辑 ----
const editingIndex = ref(-1)
const editingText = ref('')

const startEdit = index => {
  const item = proofreadingResults.value[index]
  if (!item || item.applied) return
  editingIndex.value = index
  editingText.value = item.suggested || ''
}

const cancelEdit = () => {
  editingIndex.value = -1
  editingText.value = ''
}

const saveEdit = index => {
  const text = editingText.value
  if (!text.trim()) {
    ElMessage.warning(t('proof.messages.editEmpty'))
    return
  }
  const item = proofreadingResults.value[index]
  if (!item) return
  if (text === item.suggested) {
    cancelEdit()
    return
  }
  // 编辑只改侧栏展示的建议文本；未应用建议的原文在预览中原样存在，预览 DOM
  // 无需任何改动，双豁免跳过整篇重渲染与整列表重高亮（编辑入口已挡掉已应用项）
  fileStore.requestSkipResultRerender()
  fileStore.requestSkipResultRehighlight()
  const newResults = [...proofreadingResults.value]
  newResults[index] = { ...newResults[index], suggested: text, edited: true }
  proofreadingResults.value = newResults
  cancelEdit()
  ElMessage.success(t('proof.messages.editSaved'))
}

// ---- 忽略 / 恢复 ----
const ignoreCorrection = index => {
  const item = proofreadingResults.value[index]
  if (!item) return
  // 原位移除对应高亮：按 data-correction-id 精确查找、不做文本定位，
  // 脚注等复杂段落同样安全；移除失败（该条本就未定位到高亮）则不豁免，
  // 由侦听方整篇重渲染兜底
  const container = previewContainer.value
  const removed = container ? unwrapHighlight(container, item.id || `correction-${index}`) : false
  if (removed) {
    fileStore.requestSkipResultRerender()
    fileStore.requestSkipResultRehighlight()
  }
  const newResults = [...proofreadingResults.value]
  newResults[index] = { ...newResults[index], rejected: true, applied: false }
  proofreadingResults.value = newResults
  if (editingIndex.value === index) cancelEdit()
  ElMessage.info(t('proof.messages.ignored'))
}

const unignoreCorrection = index => {
  const item = proofreadingResults.value[index]
  if (!item) return
  // 恢复后该条要重新参与高亮，必须用改动后的 results 重建（本条要算进
  // 未处理列表参与出现次序分配）：豁免两侧侦听后手动重建一次高亮，
  // 只重建高亮、不重渲染文档
  fileStore.requestSkipResultRerender()
  fileStore.requestSkipResultRehighlight()
  const newResults = [...proofreadingResults.value]
  newResults[index] = { ...newResults[index], rejected: false }
  proofreadingResults.value = newResults
  highlightCorrections()
  ElMessage.success(t('proof.messages.unignored'))
}

const formatCorrectionType = type => correctionTypeLabel(type, t)

// 高亮重建收敛到 utils/highlight.js（与右侧预览共用同一实现）；
// 本列表的高亮点击回到侧栏聚焦
const highlightCorrections = () => {
  rebuildPreviewHighlights(previewContainer.value, proofreadingResults.value, {
    onHighlightClick: scrollToCorrectionItem
  })
}

const scrollToCorrectionItem = index => {
  if (index === -1) return
  activeNames.value = [index]
  nextTick(() => {
    scrollTo(`#error-item-${index}`, {
      container: '.results-container',
      duration: 500,
      offset: -350,
      easing: 'ease-in-out',
      force: true
    })
    focusSidebarItem(index)
  })
}

const focusSidebarItem = index => {
  const itemEl = document.querySelector(`#error-item-${index}`)
  if (!itemEl) return
  if (previewFocusTimer) {
    clearTimeout(previewFocusTimer)
    previewFocusTimer = null
  }
  itemEl.classList.remove('correction-item-focused')
  void itemEl.offsetWidth
  itemEl.classList.add('correction-item-focused')
  previewFocusTimer = setTimeout(() => {
    itemEl.classList.remove('correction-item-focused')
    previewFocusTimer = null
  }, 2800)
}

const findHighlightElement = correctionId => {
  const container = previewContainer.value
  if (!container || !correctionId) return null
  return container.querySelector(`.highlight-correction[data-correction-id="${correctionId}"]`)
}

const focusPreviewHighlight = highlightEl => {
  if (!highlightEl) return
  if (previewFocusTimer) {
    clearTimeout(previewFocusTimer)
    previewFocusTimer = null
  }
  highlightEl.classList.remove('highlight-correction-focused')
  void highlightEl.offsetWidth
  highlightEl.classList.add('highlight-correction-focused')
  previewFocusTimer = setTimeout(() => {
    highlightEl.classList.remove('highlight-correction-focused')
    previewFocusTimer = null
  }, 2800)
}

const scrollPreviewToCorrection = index => {
  const container = previewContainer.value
  const correction = proofreadingResults.value[index]
  if (!container || !correction) return false
  const correctionId = correction.id || `correction-${index}`
  const highlightEl = findHighlightElement(correctionId)
  if (!highlightEl) return false
  // content-visibility:auto 的未渲染页面没有布局盒，量取坐标前临时强制可见
  const restoreVisibility = forceVisibleSection(highlightEl)
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect()
      const highlightRect = highlightEl.getBoundingClientRect()
      const offsetTop = highlightRect.top - containerRect.top + container.scrollTop
      const targetScrollTop = Math.max(offsetTop - container.clientHeight * 0.35, 0)
      container.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      })
      focusPreviewHighlight(highlightEl)
      // 平滑滚动结束后恢复按需渲染
      restoreVisibilityTimer = setTimeout(restoreVisibility, 700)
    })
  )
  return true
}

const applyCorrection = index => {
  const target = proofreadingResults.value[index]
  if (!target) return
  // 单趟完成「替换本条 + 重高亮其余未处理」：定位时把全部未处理项与本条
  // 一并纳入分配，重复文本按出现次序命中本条对应的位置（与高亮分配一致），
  // 而不是总替换第一处；相比旧流程省去替换后重高亮的第二次全文定位
  const container = previewContainer.value
  const targetList = [{ item: target, index }]
  const pendingList = proofreadingResults.value
    .map((item, i) => ({ item, index: i }))
    .filter(({ item, index: i }) => !item.applied && !item.rejected && i !== index)
  const { targetReplaced } = container
    ? applyAndHighlightCorrections(container, targetList, pendingList, scrollToCorrectionItem)
    : { targetReplaced: new Set() }
  const updated = targetReplaced.has(target)
  if (updated) {
    // 原位替换成功：预览 DOM 与高亮均已就位，豁免两侧侦听的整篇重建
    fileStore.requestSkipResultRerender()
    fileStore.requestSkipResultRehighlight()
  }
  const newResults = [...proofreadingResults.value]
  newResults[index] = { ...newResults[index], applied: true }
  proofreadingResults.value = newResults
  if (updated) {
    ElMessage.success(t('proof.messages.applied'))
  } else {
    // 原位未命中：不豁免，由预览侧侦听整篇重渲染重放已应用项兜底
    ElMessage.warning(t('proof.messages.notLocatedInPreview'))
  }
}

const undoCorrection = index => {
  const target = proofreadingResults.value[index]
  if (!target) return
  // 原位撤销：把这条建议的文本替换回原文，避免整篇重渲染
  const container = previewContainer.value
  const appliedItems = proofreadingResults.value.filter(item => item.applied)
  const undone =
    container && appliedItems.length > 0 ? undoCorrectionsInPreview(container, appliedItems, [target]) : 0
  // 两种路径都已安排好 DOM 重建方（原位 + 手动重高亮 / rerenderVersion 整篇重建），
  // 豁免两侧 results 侦听避免二次重建
  fileStore.requestSkipResultRerender()
  fileStore.requestSkipResultRehighlight()
  const newResults = [...proofreadingResults.value]
  newResults[index] = { ...newResults[index], applied: false }
  proofreadingResults.value = newResults
  if (undone === 1) {
    highlightCorrections()
  } else {
    // 原位撤销失败（预览中找不到建议文本等），退回整篇重渲染重放已应用项
    fileStore.triggerRerender()
  }
  ElMessage.success(t('proof.messages.undoSuccess'))
}

// 批量应用/按类型应用的入口在右侧预览工具栏（DocPreview.vue）中，
// 本列表只负责单条的应用、撤销、忽略与编辑。

watch(
  () => fileStore.results,
  (newVal, oldVal) => {
    // 应用/忽略/编辑/撤销等原位操作已在改动前自行维护好预览 DOM 与高亮，
    // 消费一次性豁免标记，跳过整列表重建
    if (fileStore.consumeSkipResultRehighlight()) return
    if (newVal.length > 0) {
      nextTick(() => highlightCorrections())
      // 仅在结果从无到有时自动展开第一项，避免应用/编辑等操作打乱当前展开状态
      if (!oldVal || oldVal.length === 0) {
        activeNames.value = [0]
      }
    }
  }
)

// 响应右侧预览高亮的点击：聚焦到对应校对项（反向跳转）
watch(
  () => fileStore.sidebarFocusVersion,
  () => {
    if (fileStore.sidebarFocusIndex === -1) return
    scrollToCorrectionItem(fileStore.sidebarFocusIndex)
  }
)

onMounted(async () => {
  if (proofreadingResults.value.length > 0) {
    await nextTick()
    highlightCorrections()
    activeNames.value = [0]
  }
})

onUnmounted(() => {
  if (previewFocusTimer) {
    clearTimeout(previewFocusTimer)
    previewFocusTimer = null
  }
  if (restoreVisibilityTimer) {
    clearTimeout(restoreVisibilityTimer)
    restoreVisibilityTimer = null
  }
})
</script>

<style>
/* 预览高亮与类型色板已收敛到 assets/css/common.css；
   这里仅保留跨组件共享的「条目聚焦脉冲」与浮层样式。
   配色全部走 tokens 变量，不再需要逐条 html.dark 补丁。 */

/* 点击预览中的高亮时，对应列表项闪一下（跨 scoped 边界，只能放全局） */
.correction-item.correction-item-focused {
  box-shadow: 0 0 0 2px var(--brand-soft-strong) !important;
  animation: correction-item-pulse 0.9s var(--ease) 2 !important;
}

@keyframes correction-item-pulse {
  0% {
    box-shadow: 0 0 0 0 var(--brand-soft-strong);
  }
  55% {
    box-shadow: 0 0 0 5px var(--brand-soft), 0 0 16px var(--brand-soft-strong);
  }
  100% {
    box-shadow: 0 0 0 0 var(--brand-soft-strong);
  }
}

/* 质量风险提示：Codex 的「警示条」——左侧细竖条 + 极淡底，不抢视线 */
.quality-note {
  margin: 10px 0 2px;
  padding: 8px 10px;
  border-left: 2px solid var(--el-color-warning);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--el-color-warning-light-9);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.65;
}

.quality-note strong {
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
}

/* 参考片段浮层（挂在 body 层） */
.reference-popover {
  max-width: 500px;
}

.reference-popover .el-popover__title {
  margin-bottom: 10px;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}
</style>

<style scoped>
.proof-results-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--bg-page);
  color: var(--text-1);
}

.results-container {
  flex: 1;
  padding: 4px 10px 20px;
  overflow-y: auto;
}

/* ---------------- 校对条目：列表项而非卡片 ---------------- */
.correction-item {
  margin-bottom: 2px;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: none;
  background-color: transparent;
  transition: background-color var(--dur-fast) var(--ease);
}

.correction-item:hover {
  background-color: var(--bg-hover);
}

/* 已忽略：整体弱化，但仍可读 */
.correction-item-rejected {
  opacity: 0.5;
}

.correction-item-rejected .correction-type {
  filter: saturate(0.15);
}

.correction-rejected-tag {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  padding: 0 6px;
  line-height: 16px;
}

.correction-applied-check {
  color: var(--el-color-success);
  font-size: 13px;
}

.correction-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 8px;
  background-color: transparent;
}

/* 类型徽标的形状（配色来自 common.css 的 .type-* 变量） */
.correction-type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 62px;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  font-weight: 500;
}

.correction-count {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* ---------------- 条目内容 ---------------- */
.correction-content {
  padding: 2px 8px 12px 12px;
  border-top: none;
  background-color: transparent;
}

/* 原文 / 建议：Codex diff 视图——左侧竖条 + 极淡底色，不整块染色 */
.original,
.suggested {
  position: relative;
  margin-bottom: 6px;
  padding: 7px 10px;
  border-left: 2px solid transparent;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  line-height: 1.7;
  font-size: 13px;
  color: var(--text-1);
  word-break: break-word;
}

.original {
  background: rgba(248, 81, 73, 0.06);
  border-left-color: rgba(248, 81, 73, 0.6);
}

html.dark .original {
  background: rgba(248, 81, 73, 0.1);
}

.suggested {
  background: rgba(46, 160, 67, 0.07);
  border-left-color: rgba(46, 160, 67, 0.65);
}

html.dark .suggested {
  background: rgba(46, 160, 67, 0.12);
}

/* 「原文 / 建议 / 原因」标签：mono 小字，Codex 的元信息感 */
.original strong,
.suggested strong,
.reason strong {
  display: inline-block;
  margin-right: 8px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-3);
  vertical-align: 1px;
}

.reason {
  margin-bottom: 4px;
  padding: 0 2px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-2);
}

.suggested-text {
  word-break: break-word;
  color: var(--text-1);
}

.edit-icon {
  margin-left: 8px;
  cursor: pointer;
  color: var(--text-3);
  vertical-align: -2px;
  transition: color var(--dur-fast) var(--ease);
}

.edit-icon:hover {
  color: var(--brand);
}

html.dark .edit-icon:hover {
  color: var(--brand-bright);
}

.suggested-editor {
  margin-top: 8px;
  width: 100%;
}

.edit-actions {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.edited-tag {
  margin-left: 6px;
}

/* ---------------- 操作区 ---------------- */
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.actions .el-button {
  border-radius: var(--radius-sm);
}

/* ---------------- 参考片段（弹层内） ---------------- */
.reference-content {
  padding: 4px;
}

.reference-content h4 {
  margin: 0 0 12px;
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  letter-spacing: 0.02em;
}

.reference-list {
  max-height: 300px;
  overflow-y: auto;
}

.reference-item {
  display: flex;
  align-items: flex-start;
  margin-bottom: 8px;
  padding: 9px 12px;
  background: var(--bg-sunken);
  border-radius: var(--radius-sm);
  border-left: 2px solid var(--brand);
  line-height: 1.65;
  transition: background-color var(--dur-fast) var(--ease);
}

.reference-item:hover {
  background: var(--bg-hover);
}

.reference-item:last-child {
  margin-bottom: 0;
}

.reference-index {
  color: var(--brand);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  margin-right: 10px;
  min-width: 18px;
  flex-shrink: 0;
}

.reference-text {
  color: var(--text-2);
  font-size: 12.5px;
  word-break: break-word;
  white-space: pre-wrap;
}

/* ---------------- 空状态 ---------------- */
.no-results {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
</style>
