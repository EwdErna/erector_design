<template>
  <div class="scene-container" ref="container" @click="selectObject">

  </div>
</template>

<script lang="ts" setup>
import { AmbientLight, AxesHelper, DirectionalLight, GridHelper, PerspectiveCamera, Scene, WebGLRenderer, Color, Vector2, Raycaster, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/Addons.js';
import type { ErectorPipe, ErectorPipeConnection } from '~/types/erector_component';
import erectorComponentDefinition from '~/data/erector_component.json'

const container = useTemplateRef("container")
const objectSelection = useObjectSelection()
const three = useThree()
let renderer: WebGLRenderer
let camera: PerspectiveCamera
const erector = useErectorPipeJoint()
function instanciate(structure: { pipes: ErectorPipe[], joints: { id: string, name: string }[] }) {
  if (!three.scene) return;
  const scene = three.scene
  structure.pipes.forEach(pipe => {
    // erectorにpipeを追加
    if (erector.pipes.findIndex(p => p.id === pipe.id) === -1) {
      erector.addPipe(scene, pipe.diameter, pipe.length, pipe.id)
    }
    // pipeの接続に使うjointを追加
    const jointInstanciate = (conn: ErectorPipeConnection) => {
      if (erector.joints.findIndex(j => j.id === conn.jointId) === -1) {
        const joint = structure.joints.find(joint => joint.id === conn.jointId)
        if (!joint) { return }// 接続先のjointがない。よろしくない
        const jointCategoryDefinition = erectorComponentDefinition.pla_joints.categories.find(c => c.types.some(t => t.name === joint.name))
        if (!jointCategoryDefinition) { return }//接続先のjointがない。よろしくない
        const jointDefinition = (jointCategoryDefinition?.types as { name: string, joints?: { to: [number, number, number], start?: [number, number, number], through?: boolean }[] }[]).find(t => t.name === joint.name)
        if (!jointDefinition) { return }//未知のjoint。よろしくない
        if (!jointDefinition.joints) { return }//接続先のjointが定義されていない。TBD
        erector.addJoint(scene, joint.name, jointCategoryDefinition.name, jointDefinition.joints.map(j => {
          return {
            type: j.through !== true ? 'FIX' as const : "THROUGH" as const,
            dir: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3().fromArray(j.to)),
            offset: new Vector3().fromArray(j.start ?? [0, 0, 0])
          }
        }), joint.id)
      }
    }
    if (pipe.connections.start) {
      jointInstanciate(pipe.connections.start)
      const startConnection = erector.pipes.find(p => p.id === pipe.id)?.connections.start
      if (startConnection) {
        //既に接続済み。BAD STRUCTURE
      } else erector.addConnection(pipe.id, pipe.connections.start.jointId, pipe.connections.start.holeId, "start")
    }
    if (pipe.connections.end) {
      jointInstanciate(pipe.connections.end)
      const endConnection = erector.pipes.find(p => p.id === pipe.id)?.connections.end
      if (endConnection) {
        //既に接続済み。BAD STRUCTURE
      } else erector.addConnection(pipe.id, pipe.connections.end.jointId, pipe.connections.end.holeId, "end", pipe.connections.end.rotation, pipe.connections.end.position)
    }
    pipe.connections.midway.forEach(conn => {
      jointInstanciate(conn)
      const midwayConnection = erector.pipes.find(p => p.id === pipe.id)?.connections.midway
      if (midwayConnection?.find(c => c.jointId === conn.jointId && c.holeId === conn.holeId)) {
        //既に接続済み。BAD STRUCTURE
      } else erector.addConnection(pipe.id, conn.jointId, conn.holeId, "midway", conn.rotation, conn.position)
    })
  })
}

function selectObject(event: MouseEvent) {
  const rect = container.value?.getBoundingClientRect()
  if (!rect) return
  const mouse = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
  const raycaster = new Raycaster()
  raycaster.setFromCamera(mouse, camera)
  const searchObjects = erector.instances.map(v => v.obj).filter(v => v !== undefined)
  const intersects = raycaster.intersectObjects(searchObjects, true)
  if (intersects.length > 0) {
    let rootObject = intersects[0].object
    while (rootObject.parent) {
      rootObject = rootObject.parent
      if (searchObjects.includes(rootObject))
        break
    }
    console.log(rootObject)
    objectSelection.select(rootObject.name)
  }
}

const setupScene = () => {
  if (!container.value) return

  const erector_structure: { pipes: ErectorPipe[], joints: { id: string, name: string }[] } = {
    pipes: [{
      id: "P_0001",
      length: 0.3,
      diameter: 0.028,
      connections: {
        end: {
          id: "P_0001-conn-0",
          jointId: "J-4_0001",
          holeId: 0,
          rotation: 30,
          position: 0
        },
        midway: [
          {
            id: "P_0001-conn-2",
            jointId: "J-12B_0001",
            holeId: 0,
            rotation: 0,
            position: 0.75
          }
        ]
      }
    }, {
      id: "P_0002",
      length: 0.3,
      diameter: 0.028,
      connections: {
        start: {
          id: "P_0002-conn-0",
          jointId: "J-4_0001",
          holeId: 1,
          rotation: 0,
          position: 0
        },
        midway: []
      }
    }],
    joints: [{
      id: 'J-4_0001',
      name: 'J-4'
    }, {
      id: 'J-12B_0001', name: 'J-12B'
    }]
  }

  renderer = new WebGLRenderer({ antialias: true })
  renderer.setSize(container.value.clientWidth, container.value.clientHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  container.value.appendChild(renderer.domElement)

  const scene = new Scene()
  three.resisterScene(scene)
  scene.background = new Color(0x333333)

  const aspect = container.value.clientWidth / container.value.clientHeight
  camera = new PerspectiveCamera(75, aspect)
  camera.translateY(.5)
  camera.translateZ(.5)
  camera.lookAt(0, 0, 0)

  const gridHelper = new GridHelper(10, 10)
  scene.add(gridHelper)

  const axesHelper = new AxesHelper(5)
  scene.add(axesHelper)

  instanciate(erector_structure)
  const ambientLight = new AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)
  const directionalLight = new DirectionalLight(0xffffff)
  scene.add(directionalLight)
  const gltfLoader = new GLTFLoader()
  animate(scene)
}
const animate = (scene: Scene) => {
  if (!scene) return;
  requestAnimationFrame(() => animate(scene))
  renderer.render(scene, camera)
}
const handleResize = () => {
  if (!container.value) return
  const w = container.value.clientWidth
  const h = container.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}
onMounted(() => {
  setupScene()
  window.addEventListener('resize', handleResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (renderer) renderer.dispose()
})
</script>

<style scoped>
.scene-container {
  height: 100%;
}
</style>