<template>
  <div class="container">
    <h2>Edit Component</h2>
    <h3>{{ objectSelection.object }}</h3>
    <div v-if="selectedPipe">
      <div v-if="selectedObject?.obj">
        <div>
          position: {{ selectedObject.obj.position.x }}, {{ selectedObject.obj.position.y }}, {{
            selectedObject.obj.position.z }}
        </div>
        <div>
          rotation: {{ selectedObject.obj.rotation.x }}, {{ selectedObject.obj.rotation.y }}, {{
            selectedObject.obj.rotation.z }}
        </div>
        </div>
      <div>{{ selectedPipe.length * 1000 }}mm
      </div>
      <div>{{ selectedPipe.diameter }}mm
      </div>
      <div>
        <div>
          <h4>Start Connection</h4>
        </div>
        <div v-if="connStart">
          <div>Joint ID: {{ connStart.jointId }}
          </div>
          <div>Hole ID: {{ connStart.holeId }}
          </div>
          <div>Rotation: {{ connStart.rotation }}
          </div>
        </div>
        <div>
          <h4>End Connection</h4>
        </div>
        <div v-if="connEnd">
          <div>Joint ID: {{ connEnd.jointId }}
          </div>
          <div>Hole ID: {{ connEnd.holeId }}
          </div>
          <div>Rotation: {{ connEnd.rotation }}
          </div>
        </div>
        <div>
          <h4>Midway Connections</h4>
        </div>
        <div v-if="connMidway" v-for="conn, i in connMidway" :key="i">
          <div>Joint ID: {{ conn.jointId }}
          </div>
          <div>Hole ID: {{ conn.holeId }}
          </div>
          <div>Rotation: {{ conn.rotation }}
          </div>
          <div>Position: {{ conn.position }}
          </div>
        </div>
      </div>
      </div>
    <div v-if="selectedJoint">
      <div v-if="selectedObject?.obj">
        <div>
          position:{{ selectedObject.obj.position.x }} , {{ selectedObject.obj.position.y }} ,
          {{ selectedObject.obj.position.z }}
        </div>
        <div>
          rotation: {{ selectedObject.obj.rotation.x }} , {{ selectedObject.obj.rotation.y }} ,
          {{ selectedObject.obj.rotation.z }}
        </div>
      </div>
      <div>Joint ID: {{ selectedJoint.id }}</div>
      <div>Joint Name: {{ selectedJoint.name }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useObjectSelection } from '~/stores/ObjectSelection';
import type { ErectorPipe, ErectorPipeConnection } from '~/types/erector_component';

const objectSelection = useObjectSelection()
const erector = useErectorPipeJoint()
const selectedPipe = computed(() => erector.pipes.find(p => p.id === objectSelection.object))
const selectedJoint = computed(() => erector.joints.find(j => j.id === objectSelection.object))
const selectedObject = computed(() => erector.instances.find(i => i.id === objectSelection.object))
const connStart = computed(() => selectedPipe.value?.connections.start)
const connEnd = computed(() => selectedPipe.value?.connections.end)
const connMidway = computed(() => selectedPipe.value?.connections.midway)

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