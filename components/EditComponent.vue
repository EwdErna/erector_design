<template>
  <div class="container">
    <h2>Edit Component</h2>
    <h3>{{ objectSelection.object }}</h3>
    <div v-if="selectedPipe">
      <div><button @click="removeObject(selectedPipe)">remove</button></div>
      <hr>
      <div v-if="selectedObject?.obj">
        <div>
          position: <input type="number" :value="selectedObject.obj.position.x"
            @change="selectedObject.obj.position.x = Number.parseFloat(($event.target as HTMLInputElement).value)">,
          <input type="number" :value="selectedObject.obj.position.y"
            @change="selectedObject.obj.position.y = Number.parseFloat(($event.target as HTMLInputElement).value)">,
          <input type="number" :value="selectedObject.obj.position.z"
            @change="selectedObject.obj.position.z = Number.parseFloat(($event.target as HTMLInputElement).value)">
        </div>
        <div>
          rotation: <input type="number" :value="selectedObject.obj.rotation.x * 180 / Math.PI"
            @change="selectedObject.obj.rotation.x = Number.parseFloat(($event.target as HTMLInputElement).value) / 180 * Math.PI">,
          <input type="number" :value="selectedObject.obj.rotation.y * 180 / Math.PI"
            @change="selectedObject.obj.rotation.y = Number.parseFloat(($event.target as HTMLInputElement).value) / 180 * Math.PI">,
          <input type="number" :value="selectedObject.obj.rotation.z * 180 / Math.PI"
            @change="selectedObject.obj.rotation.z = Number.parseFloat(($event.target as HTMLInputElement).value) / 180 * Math.PI">
        </div>
      </div>
      <div>{{ selectedPipe.length * 1000 }}mm
        <input type="range" min="0" max="4000" step="100" :value="selectedPipe.length * 1000"
          @change="lenChange($event, selectedPipe)" />
        <input type="number" min="0" max="4000" :value="selectedPipe.length * 1000"
          @change="lenChange($event, selectedPipe)" />
      </div>
      <div><select :value="selectedPipe.diameter">
          <option v-for="d in [28, 32, 42]" :value="d / 1000">Φ{{ d }}</option>
        </select>
      </div>
      <div>
        <div>
          <h4>Start Connection</h4>
          <button v-if="!connStart"
            @click="erector.addConnection(selectedPipe.id, erector.joints[0].id, 0, 'start')">add</button>
          <button v-if="connStart" @click="selectedPipe.connections.start = undefined">remove</button>
        </div>
        <div v-if="connStart">
          <div>Joint ID: <select :value="connStart.jointId"
              @change="updateConnection($event, selectedPipe.id, connStart.id, 'jointId')">
              <option v-for="joint in erector.joints" :value="joint.id">{{ joint.id }} / {{ joint.name }}</option>
            </select>
          </div>
          <div>Hole ID: <select :value="connStart.holeId"
              @change="updateConnection($event, selectedPipe.id, connStart.id, 'holeId')">
              <option v-for="_, i in connStartJoint?.holes" :value="i">{{ i }}</option>
            </select>
          </div>
          <div>Rotation: <input type="number" :value="connStart.rotation"
              @change="updateConnection($event, selectedPipe.id, connStart.id, 'rotation')">
            <span v-if="connStart" style="margin-left: 10px; color: #666;">
              rel: {{ erector.getPipeJointRelationship(selectedPipe.id, connStart.jointId, connStart.holeId, 'start') ||
              'none' }}
            </span>
          </div>
        </div>
        <div>
          <h4>End Connection</h4>
          <button v-if="!connEnd" @click="erector.addConnection(selectedPipe.id, erector.joints[0].id, 0, 'end')">
            add
          </button>
          <button v-if="connEnd" @click="selectedPipe.connections.end = undefined">remove</button>
        </div>
        <div v-if="connEnd">
          <div>Joint ID: <select :value="connEnd.jointId"
              @change="updateConnection($event, selectedPipe.id, connEnd.id, 'jointId')">
              <option v-for="joint in erector.joints" :value="joint.id">{{ joint.id }} / {{ joint.name }}</option>
            </select>
          </div>
          <div>Hole ID: <select :value="connEnd.holeId"
              @change="updateConnection($event, selectedPipe.id, connEnd.id, 'holeId')">
              <option v-for="_, i in connEndJoint?.holes" :value="i">{{ i }}</option>
            </select>
          </div>
          <div>Rotation: <input type="number" :value="connEnd.rotation"
              @change="updateConnection($event, selectedPipe.id, connEnd.id, 'rotation')">
            <span v-if="connEnd" style="margin-left: 10px; color: #666;">
              rel: {{ erector.getPipeJointRelationship(selectedPipe.id, connEnd.jointId, connEnd.holeId, 'end') ||
              'none' }}
            </span>
          </div>
        </div>
        <div>
          <h4>Midway Connections</h4>
          <button @click="erector.addConnection(selectedPipe.id, erector.joints[0].id, 0, 'midway')">add</button>
        </div>
        <div v-if="connMidway" v-for="conn, i in connMidway" :key="i">
          <div><button @click="connMidway.splice(i, 1)">remove</button></div>
          <div>Joint ID: <select :value="conn.jointId"
              @change="updateConnection($event, selectedPipe.id, conn.id, 'jointId')">
              <option v-for="joint in erector.joints" :value="joint.id">{{ joint.id }} / {{ joint.name }}</option>
            </select>
          </div>
          <div>Hole ID:
            <select :value="conn.holeId" @change="updateConnection($event, selectedPipe.id, conn.id, 'holeId')">
              <option v-for="_, j in connMidJoint(i)?.holes" :value="j">{{ j }}</option>
            </select>
          </div>
          <div>Rotation:
            <input type="number" :value="conn.rotation"
              @change="updateConnection($event, selectedPipe.id, conn.id, 'rotation')">
            <span style="margin-left: 10px; color: #666;">
              rel: {{ erector.getPipeJointRelationship(selectedPipe.id, conn.jointId, conn.holeId, 'midway') || 'none'
              }}
            </span>
          </div>
          <div>Position: <input type="number" v-model="conn.position" min="0" max="1" step="0.01"> : {{
            conn.position * selectedPipe.length * 1000 }}mm</div>
        </div>
      </div>
      <div>
        <h4>Pipe-Joint Relationships</h4>
        <div v-if="selectedPipe">
          <div v-for="rel in pipeRelationships" :key="`${rel.jointId}-${rel.holeId}-${rel.connectionType}`"
            style="font-size: 0.9em; color: #666; margin: 2px 0;">
            {{ rel.connectionType }}: {{ rel.jointId }} hole{{ rel.holeId }} → {{ rel.relationshipType }}
          </div>
          <div v-if="pipeRelationships.length === 0" style="color: #999; font-style: italic;">
            No relationships recorded yet
          </div>
        </div>
      </div>
    </div>
    <div v-if="selectedJoint">
      <div><button @click="removeObject(selectedJoint)">remove</button></div>
      <hr>
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
import { isErectorPipe, type ErectorJoint, type ErectorPipe, type ErectorPipeConnection } from '~/types/erector_component';

const objectSelection = useObjectSelection()
const erector = useErectorPipeJoint()
const selectedPipe = computed(() => erector.pipes.find(p => p.id === objectSelection.object))
const selectedJoint = computed(() => erector.joints.find(j => j.id === objectSelection.object))
const selectedObject = computed(() => erector.instances.find(i => i.id === objectSelection.object))

function lenChange(event: Event, pipe: ErectorPipe) {
  const target = event.target as HTMLInputElement
  const value = parseInt(target.value)
  if (isNaN(value)) { return }
  erector.updatePipe(pipe.id, 'length', value / 1000)
}
const connStart = computed(() => selectedPipe.value?.connections.start)
const connStartJoint = computed(() => erector.joints.find(j => j.id === connStart.value?.jointId))
const connEnd = computed(() => selectedPipe.value?.connections.end)
const connEndJoint = computed(() => erector.joints.find(j => j.id === connEnd.value?.jointId))
const connMidway = computed(() => selectedPipe.value?.connections.midway)
const connMidJoint = computed(() => (i: number) => {
  const conn = selectedPipe.value?.connections.midway[i]
  if (!conn) return undefined
  return erector.joints.find(j => j.id === conn.jointId)
})

const pipeRelationships = computed(() => {
  if (!selectedPipe.value) return []
  return erector.pipeJointRelationships.filter(rel => rel.pipeId === selectedPipe.value!.id)
})

function removeObject(obj: ErectorPipe | ErectorJoint) {
  // erector.pipesもしくはerector.jointsから削除
  // もしerector.instancesに存在するなら、そちらも削除
  const id = obj.id;
  const obj_idx = erector.instances.findIndex(i => i.id === id);
  if (isErectorPipe(obj)) {
    erector.pipes.splice(erector.pipes.findIndex(p => p.id === id), 1);
  } else {
    erector.joints.splice(erector.joints.findIndex(j => j.id === id), 1);
  }
  if (obj_idx !== -1) {
    const scene = useThree().scene
    if (scene) {
      const instance = erector.instances[obj_idx];
      if (instance.obj) {
        scene.remove(instance.obj);
      }
      erector.instances.splice(obj_idx, 1);
      objectSelection.object = '';
    }
  }
}

function updateConnection(event: Event, pipeId: string, id: string, key: keyof ErectorPipeConnection) {
  const target = event.target as HTMLSelectElement;
  const value = target.value;
  if (!value) return;

  const pipe = erector.pipes.find(p => p.id === pipeId);
  if (!pipe) return;

  // 接続オブジェクトを取得
  let connection: ErectorPipeConnection | undefined;

  if (pipe.connections.start?.id === id) {
    connection = pipe.connections.start;
  } else if (pipe.connections.end?.id === id) {
    connection = pipe.connections.end;
  } else {
    connection = pipe.connections.midway.find(c => c.id === id);
  }

  if (!connection) return;

  // 値を適切に設定
  if (key === 'jointId' || key === 'id') {
    connection[key] = value;
  } else {
    connection[key] = Number.parseFloat(value);
  }
}

</script>

<style scoped>
.container {
  height: 100%;
  width: 100%;
  box-sizing: content-box;
  display: flow-root;
  overflow-y: auto;

  input {
    width: 4em;
  }
}
</style>