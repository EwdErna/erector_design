<template>
  <div class="container">
    <h2>Edit Component</h2>
    <h3>{{ objectSelection.object }}</h3>
    <div v-if="selectedPipe">
      <div><button @click="removeObject(selectedPipe)">remove</button></div>
      <hr>
      <div v-if="selectedObject?.obj">
        <div>
          position: <input type="number" v-model="inputPosition[0]" @change="updatePosition(0, inputPosition[0])">,
          <input type="number" v-model="inputPosition[1]" @change="updatePosition(1, inputPosition[1])">,
          <input type="number" v-model="inputPosition[2]" @change="updatePosition(2, inputPosition[2])">
        </div>
        <div>
          rotation: <input type="number" v-model="inputRotation[0]" @change="updateRotation(0, inputRotation[0])">,
          <input type="number" v-model="inputRotation[1]" @change="updateRotation(1, inputRotation[1])">,
          <input type="number" v-model="inputRotation[2]" @change="updateRotation(2, inputRotation[2])">
        </div>
      </div>
      <div>{{ selectedPipe.length * 1000 }}mm
        <input type="range" min="0" max="4000" step="100" v-model="inputLength" @change="updateLength" />
        <input type="number" min="0" max="4000" v-model="inputLength" @change="updateLength" />
      </div>
      <div><select v-model="inputDiameter" @change="updateDiameter">
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
          <div>Rotation: <input type="number" v-model="inputConnStartRotation"
              @change="updateConnectionRotation('start', inputConnStartRotation)">
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
          <div>Rotation: <input type="number" v-model="inputConnEndRotation"
              @change="updateConnectionRotation('end', inputConnEndRotation)">
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
            <input type="number" v-model="inputConnMidwayRotations[i]"
              @change="updateConnectionRotation('midway', inputConnMidwayRotations[i], i)">
            <span style="margin-left: 10px; color: #666;">
              rel: {{ erector.getPipeJointRelationship(selectedPipe.id, conn.jointId, conn.holeId, 'midway') || 'none'
              }}
            </span>
          </div>
          <div>Position: <input type="number" v-model="inputConnMidwayPositions[i]" min="0" max="1" step="0.01"
              @change="updateConnectionPosition(i, inputConnMidwayPositions[i])"> : {{
                (inputConnMidwayPositions[i] || 0) * selectedPipe.length * 1000 }}mm</div>
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
          position: <input type="number" v-model="inputPosition[0]" @change="updatePosition(0, inputPosition[0])">,
          <input type="number" v-model="inputPosition[1]" @change="updatePosition(1, inputPosition[1])">,
          <input type="number" v-model="inputPosition[2]" @change="updatePosition(2, inputPosition[2])">
        </div>
        <div>
          rotation: <input type="number" v-model="inputRotation[0]" @change="updateRotation(0, inputRotation[0])">,
          <input type="number" v-model="inputRotation[1]" @change="updateRotation(1, inputRotation[1])">,
          <input type="number" v-model="inputRotation[2]" @change="updateRotation(2, inputRotation[2])">
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

// 入力用の一時的な値を管理するref
const inputPosition = ref([0, 0, 0])
const inputRotation = ref([0, 0, 0])
const inputLength = ref(0)
const inputDiameter = ref(0)

// connection用の一時的な値
const inputConnStartRotation = ref(0)
const inputConnEndRotation = ref(0)
const inputConnMidwayRotations = ref<number[]>([])
const inputConnMidwayPositions = ref<number[]>([])

// 現在の位置と回転を取得するcomputed値
const currentPosition = computed(() => {
  if (!objectSelection.object) return [0, 0, 0]
  return erector.getObjectPosition(objectSelection.object) || [0, 0, 0]
})

const currentRotation = computed(() => {
  if (!objectSelection.object) return [0, 0, 0]
  return erector.getObjectRotation(objectSelection.object) || [0, 0, 0]
})

// オブジェクトが変更された時に入力値を同期
watch([objectSelection, currentPosition, currentRotation], () => {
  inputPosition.value = [...currentPosition.value]
  inputRotation.value = [...currentRotation.value]
}, { immediate: true })

// pipeが変更された時にlengthとdiameterを同期
watch(selectedPipe, (pipe) => {
  if (pipe) {
    inputLength.value = pipe.length * 1000
    inputDiameter.value = pipe.diameter
  }
}, { immediate: true })

// 位置更新関数
function updatePosition(axis: number, value: number) {
  if (!objectSelection.object) return
  if (isNaN(value)) return

  const newPosition = [...currentPosition.value] as [number, number, number]
  newPosition[axis] = value

  erector.updateObjectPosition(objectSelection.object, newPosition)

  // 依存関係を再計算
  erector.recalculateObjectDependencies(objectSelection.object)

  // 入力値をストアの値で更新（他の操作による変更を反映）
  inputPosition.value = [...currentPosition.value]
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

  // 入力値をストアの値で更新（他の操作による変更を反映）
  inputRotation.value = [...currentRotation.value]
}

function lenChange(event: Event, pipe: ErectorPipe) {
  const target = event.target as HTMLInputElement
  const value = parseInt(target.value)
  if (isNaN(value)) { return }
  erector.updatePipe(pipe.id, 'length', value / 1000)
}

function updateLength() {
  if (!selectedPipe.value) return
  const value = Number(inputLength.value)
  if (isNaN(value)) return

  erector.updatePipe(selectedPipe.value.id, 'length', value / 1000)
  // 入力値をストアの値で更新
  inputLength.value = selectedPipe.value.length * 1000
}

function updateDiameter() {
  if (!selectedPipe.value) return
  const value = Number(inputDiameter.value)
  if (isNaN(value)) return

  erector.updatePipe(selectedPipe.value.id, 'diameter', value)
  // 入力値をストアの値で更新
  inputDiameter.value = selectedPipe.value.diameter
}

function updateConnectionRotation(connectionType: 'start' | 'end' | 'midway', value: number, index?: number) {
  if (!selectedPipe.value) return
  if (isNaN(value)) return

  if (connectionType === 'start' && connStart.value) {
    erector.updateConnection(connStart.value.id, { rotation: value })
    inputConnStartRotation.value = connStart.value.rotation || 0
  } else if (connectionType === 'end' && connEnd.value) {
    erector.updateConnection(connEnd.value.id, { rotation: value })
    inputConnEndRotation.value = connEnd.value.rotation || 0
  } else if (connectionType === 'midway' && connMidway.value && typeof index === 'number') {
    const conn = connMidway.value[index]
    if (conn) {
      erector.updateConnection(conn.id, { rotation: value })
      inputConnMidwayRotations.value[index] = conn.rotation || 0
    }
  }
}

function updateConnectionPosition(index: number, value: number) {
  if (!selectedPipe.value || !connMidway.value) return
  if (isNaN(value)) return

  const conn = connMidway.value[index]
  if (conn) {
    erector.updateConnection(conn.id, { position: value })
    inputConnMidwayPositions.value[index] = conn.position || 0
  }
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

// connectionの値を同期
watch([connStart, connEnd, connMidway], () => {
  if (connStart.value) {
    inputConnStartRotation.value = connStart.value.rotation || 0
  }
  if (connEnd.value) {
    inputConnEndRotation.value = connEnd.value.rotation || 0
  }
  if (connMidway.value) {
    inputConnMidwayRotations.value = connMidway.value.map(conn => conn.rotation || 0)
    inputConnMidwayPositions.value = connMidway.value.map(conn => conn.position || 0)
  } else {
    inputConnMidwayRotations.value = []
    inputConnMidwayPositions.value = []
  }
}, { immediate: true, deep: true })

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