<template>
  <div class="right-panel">
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'edit' }" @click="tab = 'edit'">編集</button>
      <button class="tab" :class="{ active: tab === 'boundary', 'has-violation': violationCount > 0 }" @click="tab = 'boundary'">
        バウンダリ<span v-if="violationCount > 0" class="badge">{{ violationCount }}</span>
      </button>
    </div>
    <div class="content">
      <EditComponent v-show="tab === 'edit'" />
      <BoundaryEditor v-show="tab === 'boundary'" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useErectorBoundary } from '~/stores/ErectorBoundary'

const tab = ref<'edit' | 'boundary'>('edit')
const boundary = useErectorBoundary()
const violationCount = computed(() => boundary.violations.length)
</script>

<style scoped>
.right-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f0f0;
}

.tabs {
  display: flex;
  flex-shrink: 0;
  background: #e4e4e4;
  border-bottom: 1px solid #ccc;
}

.tab {
  flex: 1;
  height: 36px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #666;
  font-size: 13px;
  cursor: pointer;

  &.active {
    color: #000;
    border-bottom-color: #007bff;
  }

  &.has-violation {
    color: #cc2200;

    &.active {
      border-bottom-color: #cc2200;
    }
  }
}

.badge {
  background: #cc0000;
  color: white;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 10px;
  margin-left: 4px;
  vertical-align: middle;
}

.content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
