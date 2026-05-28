<template>
  <div class="container">
    <h2>バウンダリ</h2>
    <div class="add-buttons">
      <button @click="boundary.addBoundary('outer')" :disabled="!!boundary.outerBoundary">
        + 設置可能領域
      </button>
      <button @click="boundary.addBoundary('exclusion')">
        + 除外領域
      </button>
    </div>

    <div v-for="b in boundary.boundaries" :key="b.id" class="boundary-item">
      <div class="boundary-header">
        <span class="color-dot" :style="{ color: b.type === 'outer' ? '#00aa33' : '#cc2200' }">■</span>
        <input
          class="label-input"
          :value="b.label"
          @change="boundary.updateBoundary(b.id, { label: ($event.target as HTMLInputElement).value })"
        />
        <button class="remove-btn" @click="boundary.removeBoundary(b.id)">削除</button>
      </div>
      <div class="field-row">
        <span class="field-label">左下奥(mm)</span>
        <input type="number" :value="b.position[0] * 1000" @change="updatePos(b.id, b, 0, $event)" />
        <input type="number" :value="b.position[1] * 1000" @change="updatePos(b.id, b, 1, $event)" />
        <input type="number" :value="b.position[2] * 1000" @change="updatePos(b.id, b, 2, $event)" />
      </div>
      <div class="field-row">
        <span class="field-label">サイズ(mm)</span>
        <input type="number" min="1" :value="b.size[0] * 1000" @change="updateSize(b.id, b, 0, $event)" />
        <input type="number" min="1" :value="b.size[1] * 1000" @change="updateSize(b.id, b, 1, $event)" />
        <input type="number" min="1" :value="b.size[2] * 1000" @change="updateSize(b.id, b, 2, $event)" />
      </div>
    </div>

    <template v-if="boundary.boundaries.length > 0">
      <hr>
      <h4>干渉チェック</h4>
      <div v-if="boundary.violations.length === 0" class="no-violation">違反なし</div>
      <div v-else>
        <div class="violation-count">{{ boundary.violations.length }}件の違反</div>
        <div
          v-for="v in boundary.violations"
          :key="`${v.objectId}-${v.boundaryId}`"
          class="violation-item"
        >
          {{ v.objectId }}:
          {{ v.boundaryType === 'outer' ? `${v.label}外` : `${v.label}と接触` }}
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { useErectorBoundary } from '~/stores/ErectorBoundary'
import type { ErectorBoundary } from '~/types/erector_component'

const boundary = useErectorBoundary()

function updatePos(id: string, b: ErectorBoundary, axis: 0 | 1 | 2, event: Event) {
  const v = parseFloat((event.target as HTMLInputElement).value)
  if (isNaN(v)) return
  const pos = [...b.position] as [number, number, number]
  pos[axis] = v / 1000
  boundary.updateBoundary(id, { position: pos })
}

function updateSize(id: string, b: ErectorBoundary, axis: 0 | 1 | 2, event: Event) {
  const v = parseFloat((event.target as HTMLInputElement).value)
  if (isNaN(v) || v <= 0) return
  const size = [...b.size] as [number, number, number]
  size[axis] = v / 1000
  boundary.updateBoundary(id, { size })
}
</script>

<style scoped>
.container {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  display: flow-root;
  overflow-y: auto;
  padding: 0 8px;
}

.add-buttons {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.boundary-item {
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
  background: #fff;
}

.boundary-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.color-dot {
  font-size: 18px;
  line-height: 1;
}

.label-input {
  flex: 1;
  font-size: 13px;
}

.remove-btn {
  font-size: 12px;
  color: #cc0000;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
}

.field-label {
  width: 5em;
  color: #555;
  flex-shrink: 0;
}

.field-row input[type="number"] {
  width: 4.5em;
}

.no-violation {
  color: #00aa33;
  font-size: 13px;
}

.violation-count {
  color: #cc2200;
  font-size: 13px;
  margin-bottom: 4px;
}

.violation-item {
  font-size: 12px;
  color: #cc2200;
  margin: 2px 0;
}
</style>
