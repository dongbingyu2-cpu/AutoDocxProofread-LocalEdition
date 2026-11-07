<template>
  <section class="document-model" data-testid="document-model-panel">
    <label>执行模型</label>
    <el-select :model-value="selectedApi.id" filterable :disabled="busy" placeholder="选择已保存的本地或云端模型" data-testid="document-model-select" @change="selectApi">
      <el-option v-for="profile in apiSettings" :key="profile.id" :value="profile.id" :label="`${profile.provider === 'ollama' ? '本地' : '云端'} · ${profile.modelName} (#${profile.id})`" />
    </el-select>
    <p v-if="selectedApi.id" data-testid="document-model-destination">
      {{ selectedApi.provider === 'ollama' ? '本地处理：使用本机 Ollama，失败不回退云端。降 AI 默认每片一次生成，质量风险在预览中核对。' : '云端处理：本次任务文本将发送给所选服务商；降 AI 默认每段一次生成，质量提示供人工核对。' }}
    </p>
    <p v-else>请先在设置页保存模型配置，再在这里选择。校对、润色和降 AI 均使用此模型。</p>
    <el-checkbox v-if="selectedApi.id && selectedApi.provider !== 'ollama'" v-model="apiStore.reduceReviewEnabled" :disabled="busy" data-testid="cloud-extra-review">
      降 AI 额外语义复核（增加请求与耗时，默认关闭）
    </el-checkbox>
    <el-checkbox v-if="selectedApi.id && selectedApi.provider === 'ollama'" v-model="apiStore.localReduceReviewEnabled" :disabled="busy" data-testid="local-extra-review">
      降 AI 严格复核（增加耗时，未通过保留原文；默认关闭）
    </el-checkbox>
  </section>
</template>

<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { useApiStore } from '../stores/apiStore'
import { useApiSettings } from '../composables/useApiSettings'

// 复用原模型配置和选中状态；运行中的任务锁定选择，避免界面与实际模型不一致。
const apiStore = useApiStore()
const busy = inject('documentTaskRunning', ref(false))
const { selectedApi, apiSettings, selectApi, initialize } = useApiSettings()
onMounted(initialize)
</script>

<style scoped>
.document-model { flex-shrink: 0; padding: 16px; border-bottom: 1px solid var(--border-color); background: var(--bg-panel); }
label { display: block; margin-bottom: 8px; font-size: 13px; color: var(--text-primary); }
.el-select { width: 100%; }
p { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
</style>
