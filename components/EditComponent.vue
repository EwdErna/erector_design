<template>
  <div class="container">
    <h2>Edit Component</h2>
    <h3>{{ objectSelection.object }}</h3>
  </div>
</template>

<script lang="ts" setup>
import { useObjectSelection } from '~/stores/ObjectSelection';

const objectSelection = useObjectSelection()

</script>

<style>
.container {
  height: 100%;
  width: 100%;
  box-sizing: content-box;
  display: flow-root;
  overflow-y: scroll;
}
</style>