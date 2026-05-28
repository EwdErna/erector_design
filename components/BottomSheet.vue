<template>
  <div class="bottom-sheet" :class="{ open: isOpen }">
    <div
      class="handle-area"
      @touchstart.prevent="onHandleTouchStart"
      @touchmove.prevent
      @touchend="onHandleTouchEnd"
      @click="onHandleClick"
    >
      <div class="handle-bar"></div>
    </div>
    <div class="tabs">
      <button
        class="tab"
        :class="{ active: activeTab === 'parts' }"
        @click.stop="switchTab('parts')"
      >パーツ</button>
      <button
        class="tab"
        :class="{ active: activeTab === 'edit' }"
        @click.stop="switchTab('edit')"
      >編集</button>
      <button
        class="tab"
        :class="{ active: activeTab === 'error', 'has-error': hasErrors }"
        @click.stop="switchTab('error')"
      >
        エラー<span v-if="errorCount > 0" class="badge">{{ errorCount }}</span>
      </button>
      <button
        class="tab"
        :class="{ active: activeTab === 'boundary', 'has-violation': violationCount > 0 }"
        @click.stop="switchTab('boundary')"
      >
        バウンダリ<span v-if="violationCount > 0" class="badge">{{ violationCount }}</span>
      </button>
    </div>
    <div class="content">
      <SelectComponents v-show="activeTab === 'parts'" class="tab-pane" />
      <div v-show="activeTab === 'edit'" class="tab-pane edit-pane">
        <span v-if="!objectSelection.object" class="no-selection">オブジェクトを選択してください</span>
        <EditComponent v-else />
      </div>
      <InvalidConnections v-show="activeTab === 'error'" class="tab-pane" />
      <BoundaryEditor v-show="activeTab === 'boundary'" class="tab-pane" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useErectorBoundary } from '~/stores/ErectorBoundary'

const { isOpen, activeTab, open, close, switchTab } = useBottomSheet()
const erector = useErector()
const objectSelection = useObjectSelection()
const boundary = useErectorBoundary()

const errorCount = computed(() => erector.invalidConnections.length + erector.rootMerges.length)
const hasErrors = computed(() => errorCount.value > 0)
const violationCount = computed(() => boundary.violations.length)

// 選択オブジェクト変更時に編集タブを自動で開く
watch(() => objectSelection.object, (newVal) => {
  if (newVal && newVal !== '') {
    switchTab('edit')
  }
})

let touchStartY = 0

function onHandleTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0].clientY
}

function onHandleTouchEnd(e: TouchEvent) {
  const dy = e.changedTouches[0].clientY - touchStartY
  if (dy < -30) open()
  else if (dy > 30) close()
}

function onHandleClick() {
  if (isOpen.value) close()
  else open()
}
</script>

<style scoped>
.bottom-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: #f0f0f0;
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 64px;
  transition: height 0.25s ease;
  box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.3);

  &.open {
    height: 50vh;
  }
}

.handle-area {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
  background: #e4e4e4;
  border-radius: 16px 16px 0 0;
}

.handle-bar {
  width: 40px;
  height: 4px;
  background: #aaa;
  border-radius: 2px;
}

.tabs {
  display: flex;
  flex-shrink: 0;
  background: #e4e4e4;
  border-bottom: 1px solid #ccc;
}

.tab {
  flex: 1;
  height: 44px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #666;
  font-size: 14px;
  cursor: pointer;

  &.active {
    color: #000;
    border-bottom-color: #007bff;
  }

  &.has-error {
    color: #cc0000;

    &.active {
      border-bottom-color: #cc0000;
    }
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
  background: #f0f0f0;
}

.tab-pane {
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
}

.edit-pane {
  padding: 8px;
}

.no-selection {
  color: #888;
  font-size: 14px;
}
</style>
