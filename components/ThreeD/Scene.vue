<template>
  <div
    class="scene-container"
    ref="container"
    @click="selectObject"
    @touchstart.passive="onTouchStart"
  ></div>
</template>

<script lang="ts" setup>
import { AmbientLight, AxesHelper, DirectionalLight, GridHelper, PerspectiveCamera, Scene, WebGLRenderer, Color, Vector2, Raycaster, Quaternion, Vector3, Object3D, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/Addons.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ErectorPipe } from '~/types/erector_component';
import { JointControls } from '~/utils/Erector/JointControls';
import { PipeControls } from '~/utils/Erector/PipeControls';
import { degreesToRadians } from '~/utils/angleUtils';

const container = useTemplateRef("container")
const objectSelection = useObjectSelection()
const three = useThree()
const bottomSheet = useBottomSheet()
let renderer: WebGLRenderer
let camera: PerspectiveCamera
let controls: OrbitControls
let jointControls: JointControls
let unifiedPipeControls: PipeControls
const erector = useErectorPipeJoint()

// タッチ開始座標を記録してドラッグとタップを区別する
let touchStartX = 0
let touchStartY = 0
const TOUCH_MOVE_THRESHOLD = 10 // px

function onTouchStart(event: TouchEvent) {
  const t = event.touches[0]
  if (!t) return
  touchStartX = t.clientX
  touchStartY = t.clientY
}

// @click はタッチタップでも発火する（ブラウザが合成するMouseEvent）。
// タッチドラッグ後はブラウザが click を抑制するため、追加のガードは不要。
function selectObject(event: MouseEvent) {
  const rect = container.value?.getBoundingClientRect()
  if (!rect) return
  const mouse = new Vector2(
    (event.clientX - rect.left) / rect.width * 2 - 1,
    -(event.clientY - rect.top) / rect.height * 2 + 1
  )
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
      jointControls.setTarget(jointObject, rootObject as Mesh)
      unifiedPipeControls.clear()
    } else if (pipeObject) {
      unifiedPipeControls.setTarget(pipeObject, rootObject as Mesh)
      jointControls.clear()
    } else {
      jointControls.clear()
      unifiedPipeControls.clear()
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
            position: 0.225
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

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.screenSpacePanning = true
  controls.minDistance = 0.1
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI
  controls.addEventListener('start', () => bottomSheet.onSceneDragStart())
  controls.addEventListener('change', () => three.updateOrbitTarget(controls.target))

  jointControls = new JointControls(camera, renderer.domElement)
  jointControls.addEventListener('dragging-changed', e => {
    controls.enabled = !e.value
  })
  scene.add(jointControls.gizmoGroup)
  scene.add(jointControls.debugObjects)

  unifiedPipeControls = new PipeControls(camera, renderer.domElement)
  unifiedPipeControls.addEventListener('dragging-changed', e => {
    controls.enabled = !e.value
  })
  scene.add(unifiedPipeControls.controlGroup)
  scene.add(unifiedPipeControls.debugObjects)

  const gridHelper = new GridHelper(10, 10)
  scene.add(gridHelper)

  const axesHelper = new AxesHelper(5)
  scene.add(axesHelper)

  erector.loadFromStructure(erector_structure)
  erector.rootPipeObjects.forEach(rootPipeObject => {
    rootPipeObject.rotation.set(0, degreesToRadians(40), 0)
  })

  const ambientLight = new AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)
  const directionalLight = new DirectionalLight(0xffffff)
  scene.add(directionalLight)
  const gltfLoader = new GLTFLoader()
  animate(scene)
}

const animate = (scene: Scene) => {
  if (!scene) return;
  erector.syncRootPipeIds()
  if (erector.rootPipeObjects.length > 0) {
    const calculatePosition = erector.calculateWorldPosition()
    calculatePosition(erector.rootPipeIds.map(rootPipeId => {
      const rootPipeObject = erector.instanceObjectMap.get(rootPipeId)
      return {
        id: rootPipeId,
        position: rootPipeObject?.position.clone() ?? new Vector3(),
        rotation: rootPipeObject?.quaternion.clone() ?? new Quaternion()
      }
    }))
  }

  controls.update()
  requestAnimationFrame(() => animate(scene))
  renderer.render(scene, camera)
}

watch(() => objectSelection.object, (newSelection) => {
  if (!newSelection || newSelection === '') {
    jointControls?.clear()
    unifiedPipeControls?.clear()
  }
})

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
  if (jointControls) jointControls.dispose()
  if (unifiedPipeControls) unifiedPipeControls.dispose()
  if (controls) controls.dispose()
  if (renderer) renderer.dispose()
})
</script>

<style scoped>
.scene-container {
  height: 100%;
}
</style>
