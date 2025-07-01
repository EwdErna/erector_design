<template>
  <div class="container">
    <div class="toggle">
      <Icon :name="`mdi-chevron-${open ? 'right' : 'left'}`" @click="open = !open" />
    </div>
    <div v-if="open" v-for="(connection) in erector.invalidConnections" :key="connection.id" class="invalid-connection">
      <div>
        {{ connection.pipeId }} - {{ connection.jointId }} - {{ connection.holeId }}
      </div>
      <div class="position">
        actual: {{connection.position.actual.toArray().map(v => v.toFixed(5))}} expected: {{
          connection.position.expected.toArray().map(v => v.toFixed(5))}}
      </div>
      <div class="rotation">
        actual: {{connection.rotation.actual.toArray().map(v => v.toFixed(5))}} expected: {{
          connection.rotation.expected.toArray().map(v => v.toFixed(5))}}
      </div>
    </div>
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

  .invalid-connection {
    background-color: #ffffff22;

    .position,
    .rotation {
      margin-left: 5px;
    }
  }
}
</style>