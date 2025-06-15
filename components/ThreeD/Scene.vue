<template>
  <div class="scene-container" ref="container" @click="selectObject">

  </div>
</template>

<script lang="ts" setup>
import { AmbientLight, AxesHelper, DirectionalLight, GridHelper, PerspectiveCamera, Scene, WebGLRenderer, Color, Vector2, Raycaster, Quaternion, Vector3, Euler, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/Addons.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ErectorPipe, ErectorPipeConnection } from '~/types/erector_component';
import { JointControl } from '~/utils/Erector/JointControls';

const container = useTemplateRef("container")
const objectSelection = useObjectSelection()
const three = useThree()
let renderer: WebGLRenderer
let camera: PerspectiveCamera
let controls: OrbitControls
let jointControls: JointControl
let rootPipeId: string
const erector = useErectorPipeJoint()
const rootPipeObject: Ref<Object3D | undefined> = ref()

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
    const jointObject = erector.joints.find(j => j.id === rootObject.name)
    const pipeObject = erector.pipes.find(p => p.id === rootObject.name)
    if (jointObject) {
      jointControls.setSelectedJoint(jointObject, rootObject)
    }
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
  // OrbitControlsの初期化
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.screenSpacePanning = true
  controls.minDistance = 0.1
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI

  jointControls = new JointControl(camera, renderer.domElement)
  jointControls.addEventListener('dragging-changed', e => {
    controls.enabled = !e.value
  })
  scene.add(jointControls.gizmos)
  scene.add(jointControls.debugObjects)

  const gridHelper = new GridHelper(10, 10)
  scene.add(gridHelper)

  const axesHelper = new AxesHelper(5)
  scene.add(axesHelper)

  erector.loadFromStructure(erector_structure)
  rootPipeId = erector_structure.pipes[0].id
  rootPipeObject.value = erector.instances.find(i => i.id === rootPipeId)?.obj
  rootPipeObject.value?.rotation.set(0, 40 / 180 * Math.PI, 0)

  const ambientLight = new AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)
  const directionalLight = new DirectionalLight(0xffffff)
  scene.add(directionalLight)
  const gltfLoader = new GLTFLoader()
  animate(scene)
}
const animate = (scene: Scene) => {
  if (!scene) return;
  if (!erector.pipes.find(p => p.id === rootPipeId)) {
    rootPipeObject.value = undefined
    if (erector.pipes.length === 0) {
      //console.log("No pipes in erector")
    } else {
      console.log("rootPipeId not found in erector pipes, resetting to first instance")
      rootPipeId = erector.instances[0].id
      rootPipeObject.value = erector.instances.find(i => i.id === rootPipeId)?.obj
    }
  } if (rootPipeObject.value) {
    erector.worldPosition({
      id: rootPipeId, position: rootPipeObject.value?.position.clone() ?? new Vector3(), rotation: new Quaternion().setFromEuler(rootPipeObject.value?.rotation ?? new Euler(0, 0, 0))
    })
  }

  // OrbitControlsの更新
  controls.update()
  jointControls.updateGizmosTransform()

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
  controls.update()
}
onMounted(() => {
  setupScene()
  window.addEventListener('resize', handleResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (controls) controls.dispose()
  if (renderer) renderer.dispose()
})
</script>

<style scoped>
.scene-container {
  height: 100%;
}
</style>