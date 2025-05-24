<template>
  <div class="scene-container" ref="container" @click="selectObject">

  </div>
</template>

<script lang="ts" setup>
import { AmbientLight, AxesHelper, DirectionalLight, GridHelper, PerspectiveCamera, Scene, WebGLRenderer, Color } from 'three';
const container = useTemplateRef("container")
const three = useThree()
let renderer: WebGLRenderer
let camera: PerspectiveCamera
const setupScene = () => {
  if (!container.value) return

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