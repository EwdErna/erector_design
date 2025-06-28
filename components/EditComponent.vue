<template>
  <div class="container">
    <h2>Edit Component</h2>
    <h3>{{ objectSelection.object }}</h3>
    <div v-if="selectedPipe">
      <div><button @click="removeObject(selectedPipe)">remove</button></div>
      <hr>
      <div v-if="selectedObject?.obj">
        <div>
          position: <input type="number" :value="currentPosition[0]"
            @change="updatePosition(0, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentPosition[1]"
            @change="updatePosition(1, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentPosition[2]"
            @change="updatePosition(2, Number.parseFloat(($event.target as HTMLInputElement).value))">
        </div>
        <div>
          rotation: <input type="number" :value="currentRotation[0]"
            @change="updateRotation(0, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentRotation[1]"
            @change="updateRotation(1, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentRotation[2]"
            @change="updateRotation(2, Number.parseFloat(($event.target as HTMLInputElement).value))">
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
              @input="connStart.rotation = Number.parseFloat(($event.target as HTMLInputElement).value)"
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
              @input="connEnd.rotation = Number.parseFloat(($event.target as HTMLInputElement).value)"
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
              @input="conn.rotation = Number.parseFloat(($event.target as HTMLInputElement).value)"
              @change="updateConnection($event, selectedPipe.id, conn.id, 'rotation')">
            <span style="margin-left: 10px; color: #666;">
              rel: {{ erector.getPipeJointRelationship(selectedPipe.id, conn.jointId, conn.holeId, 'midway') || 'none'
              }}
            </span>
          </div>
          <div>Position: <input type="number" :value="conn.position" min="0" max="1" step="0.01"
              @input="conn.position = Number.parseFloat(($event.target as HTMLInputElement).value)"
              @change="updateConnection($event, selectedPipe.id, conn.id, 'position')"> : {{
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
          position: <input type="number" :value="currentPosition[0]"
            @change="updatePosition(0, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentPosition[1]"
            @change="updatePosition(1, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentPosition[2]"
            @change="updatePosition(2, Number.parseFloat(($event.target as HTMLInputElement).value))">
        </div>
        <div>
          rotation: <input type="number" :value="currentRotation[0]"
            @change="updateRotation(0, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentRotation[1]"
            @change="updateRotation(1, Number.parseFloat(($event.target as HTMLInputElement).value))">,
          <input type="number" :value="currentRotation[2]"
            @change="updateRotation(2, Number.parseFloat(($event.target as HTMLInputElement).value))">
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
import { radiansToDegrees, degreesToRadians } from '~/utils/angleUtils';

const objectSelection = useObjectSelection()
const erector = useErectorPipeJoint()
const selectedPipe = computed(() => erector.pipes.find(p => p.id === objectSelection.object))
const selectedJoint = computed(() => erector.joints.find(j => j.id === objectSelection.object))
const selectedObject = computed(() => erector.instances.find(i => i.id === objectSelection.object))

// 現在の位置と回転を取得するcomputed値
const currentPosition = computed(() => {
  if (!objectSelection.object) return [0, 0, 0]
  return erector.getObjectPosition(objectSelection.object) || [0, 0, 0]
})

const currentRotation = computed(() => {
  if (!objectSelection.object) return [0, 0, 0]
  return erector.getObjectRotation(objectSelection.object) || [0, 0, 0]
})

// 位置更新関数
function updatePosition(axis: number, value: number) {
  if (!objectSelection.object) return
  if (isNaN(value)) return

  const newPosition = [...currentPosition.value] as [number, number, number]
  newPosition[axis] = value

  erector.updateObjectPosition(objectSelection.object, newPosition)

  // 依存関係を再計算
  erector.recalculateObjectDependencies(objectSelection.object)
}

// 回転更新関数
function updateRotation(axis: number, value: number) {
  if (!objectSelection.object) return
  if (isNaN(value)) return

  const newRotation = [...currentRotation.value] as [number, number, number]
  newRotation[axis] = value

  erector.updateObjectRotation(objectSelection.object, newRotation)

  // 依存関係を再計算
  erector.recalculateObjectDependencies(objectSelection.object)
}

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
  console.log(`Updating connection ${id} on pipe ${pipeId} with key ${key}`);
  const target = event.target as HTMLSelectElement | HTMLInputElement;
  const value = target.value;
  if (value === '') return;

  //console.log(`connection: ${connection} toUpdate: ${JSON.stringify(connectionToUpdate)}`)
  console.log(`Updating connection ${id} on pipe ${pipeId} with key ${key} and value ${value}`);

  // 更新オブジェクトを作成
  const updateObj: Partial<ErectorPipeConnection> = {};

  // 値を適切に設定
  if (key === 'jointId' || key === 'id') {
    updateObj[key] = value;
  } else {
    updateObj[key] = Number.parseFloat(value);
  }

  // ErectorPipeJointストアのupdateConnectionメソッドを使用
  erector.updateConnection(id, updateObj);
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