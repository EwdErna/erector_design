<template>
  <div class="scene-container" ref="container" @click="selectObject">

  </div>
</template>

<script lang="ts" setup>
import type { ErectorPipe, ErectorPipeConnection } from '~/types/erector_component';
import erectorComponentDefinition from '~/data/erector_component.json'

const container = useTemplateRef("container")
const three = useThree()
let renderer: WebGLRenderer
let camera: PerspectiveCamera
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