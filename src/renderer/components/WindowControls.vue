<template>
  <!-- 自定义窗口控制按钮：融入 action-bar 右端，替代原生悬浮按钮 -->
  <div class="window-controls">
    <button class="win-btn" :title="t('app.window.minimize')" @click="minimizeWindow">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 5 H10" stroke="currentColor" stroke-width="1" />
      </svg>
    </button>
    <button
      class="win-btn"
      :title="isMaximized ? t('app.window.restore') : t('app.window.maximize')"
      @click="toggleMaximizeWindow"
    >
      <svg v-if="isMaximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
        <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" fill="none" stroke="currentColor" stroke-width="1" />
      </svg>
      <svg v-else width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
      </svg>
    </button>
    <button class="win-btn win-btn-close" :title="t('app.window.close')" @click="closeWindow">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" stroke-width="1" />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { useWindowControls } from '../composables/useWindowControls'

const { t } = useI18n()
const { isMaximized, minimizeWindow, toggleMaximizeWindow, closeWindow } = useWindowControls()
</script>

<style scoped>
/* 位于 App.vue 全局顶栏右端：作为 flex 项撑满顶栏高度，
   不再用 absolute 定位（原实现寄生在预览工具条里）。 */
.window-controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 46px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  outline: none;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.win-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-1);
}

.win-btn:active {
  background-color: var(--bg-active);
  color: var(--text-1);
}

.win-btn-close:hover {
  background-color: #e81123;
  color: #ffffff;
}

.win-btn-close:active {
  background-color: #c50f1f;
  color: #ffffff;
}
</style>
