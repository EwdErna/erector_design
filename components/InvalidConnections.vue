<template>
  <div class="container">
    <div class="header">
      <div class="toggle">
        <Icon :name="`mdi-chevron-${open ? 'right' : 'left'}`" @click="open = !open" />
      </div>
      <label v-if="open" class="auto-resolve-label">
        <input type="checkbox" v-model="erector.autoResolveConflicts" />
        自動解決
      </label>
    </div>
    <template v-if="open">
      <div
        v-for="merge in erector.rootMerges"
        :key="merge.mergedRoots.join('-')"
        class="root-merge"
      >
        <div class="merge-label">
          ルート競合:
          <span v-for="rootId in merge.mergedRoots" :key="rootId" class="root-chip">{{ rootId }}</span>
        </div>
        <div class="merge-actions">
          <button
            v-for="rootId in merge.mergedRoots"
            :key="rootId"
            @click="erector.resolveByRemoveRoot(rootId)"
          >{{ rootId }} のルートを解除</button>
        </div>
      </div>
      <div v-for="(connection) in erector.invalidConnections" :key="connection.id" class="invalid-connection">
        <div class="connection-info">
          {{ connection.pipeId }} - {{ connection.jointId }} - {{ connection.holeId }}
          <span v-if="connection.conflictType === 'constraint'" class="conflict-badge">競合</span>
        </div>
        <div class="position">
          actual: {{connection.position.actual.toArray().map(v => v.toFixed(5))}} expected: {{
            connection.position.expected.toArray().map(v => v.toFixed(5))}}
        </div>
        <div class="rotation">
          actual: {{connection.rotation.actual.toArray().map(v => v.toFixed(5))}} expected: {{
            connection.rotation.expected.toArray().map(v => v.toFixed(5))}}
        </div>
        <div v-if="connection.conflictType === 'constraint'" class="conflict-actions">
          <button @click="erector.resolveByDisconnect(connection.id)">この接続を切断</button>
          <button
            v-if="connection.conflictingConnectionId"
            @click="erector.resolveByDisconnect(connection.conflictingConnectionId!)"
          >相手の接続を切断</button>
          <button
            v-if="connection.side === 'midway'"
            @click="erector.resolveByUpdatePosition(connection.id)"
          >この位置を更新</button>
          <button
            v-if="connection.conflictingSide === 'midway' && connection.conflictingConnectionId"
            @click="erector.resolveByUpdatePosition(connection.conflictingConnectionId!)"
          >相手の位置を更新</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
const erector = useErectorPipeJoint()
const open = ref(true)
</script>

<style scoped>
.container {
  background-color: #ff4444cc;
  padding: 10px;

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .auto-resolve-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.85em;
    cursor: pointer;
  }

  .root-merge {
    background-color: #bb880033;
    border: 1px solid #ffaa0077;
    padding: 4px;
    margin-top: 4px;

    .merge-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85em;
    }

    .root-chip {
      background-color: #ffaa00;
      color: #000;
      font-size: 0.78em;
      padding: 1px 5px;
      border-radius: 3px;
    }

    .merge-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;

      button {
        font-size: 0.78em;
        padding: 2px 6px;
        cursor: pointer;
        background-color: #ffffff33;
        border: 1px solid #ffffff66;
        border-radius: 3px;
        color: inherit;

        &:hover {
          background-color: #ffffff55;
        }
      }
    }
  }

  .invalid-connection {
    background-color: #ffffff22;
    padding: 4px;
    margin-top: 4px;

    .connection-info {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .conflict-badge {
      background-color: #ffaa00;
      color: #000;
      font-size: 0.75em;
      padding: 1px 5px;
      border-radius: 3px;
    }

    .position,
    .rotation {
      margin-left: 5px;
    }

    .conflict-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;

      button {
        font-size: 0.78em;
        padding: 2px 6px;
        cursor: pointer;
        background-color: #ffffff33;
        border: 1px solid #ffffff66;
        border-radius: 3px;
        color: inherit;

        &:hover {
          background-color: #ffffff55;
        }
      }
    }
  }
}
</style>