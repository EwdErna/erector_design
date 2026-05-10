<template>
  <div class="container">
    <div class="header">
      <div class="title">
        <h1>Erector Design</h1>
      </div>
      <div>
        <h4>by EwdErna</h4>
      </div>
    </div>
    <div class="buttons">
      <div class="button" @click="download">Download</div>
      <div class="button" @click="upload">Upload</div>
      <input ref="fileInput" type="file" accept=".json" @change="handleFileUpload" style="display: none;">
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ErectorPipe } from '~/types/erector_component'

type UploadedStructure = {
  // User-facing JSON uses millimeters for numeric length/position values.
  pipes: Array<ErectorPipe & {
    diameter: number
    length: number
    connections: {
      start?: ErectorPipe['connections']['start']
      end?: ErectorPipe['connections']['end']
      midway: ErectorPipe['connections']['midway']
    }
  }>
  joints: { id: string, name: string }[]
  rootTransforms?: {
    pipeId: string
    position: [number, number, number]
    rotation: [number, number, number]
  }[]
}

const fileInput = useTemplateRef('fileInput')

const isValidRootTransform = (value: unknown): value is { pipeId: string, position: [number, number, number], rotation: [number, number, number] } => {
  const isNumberTuple3 = (arr: unknown): arr is [number, number, number] =>
    Array.isArray(arr) &&
    arr.length === 3 &&
    arr.every(v => typeof v === 'number' && Number.isFinite(v))

  if (!value || typeof value !== 'object') return false
  const candidate = value as { pipeId?: unknown, position?: unknown, rotation?: unknown }
  return typeof candidate.pipeId === 'string'
    && isNumberTuple3(candidate.position)
    && isNumberTuple3(candidate.rotation)
}

function download() {
  const a = document.body.appendChild(document.createElement('a'))
  const erector = useErectorPipeJoint()

  // Get root pipe transforms if available
  const rootTransforms = erector.rootPipeIds
    .map(rootPipeId => {
      const rootInstance = erector.instances.find(i => i.id === rootPipeId)?.obj
      if (!rootInstance) return null
      return {
        pipeId: rootPipeId,
        position: [rootInstance.position.x, rootInstance.position.y, rootInstance.position.z].map(v => v * 1000) as [number, number, number],
        rotation: [rootInstance.rotation.x, rootInstance.rotation.y, rootInstance.rotation.z].map(v => v * 180 / Math.PI) as [number, number, number]
      }
    })
    .filter((transform): transform is { pipeId: string, position: [number, number, number], rotation: [number, number, number] } => transform !== null)

  const pipes = erector.pipes.map(pipe => ({
    ...pipe,
    diameter: pipe.diameter * 1000,
    length: pipe.length * 1000,
    connections: {
      start: pipe.connections.start,
      end: pipe.connections.end,
      midway: pipe.connections.midway.map(conn => ({
        ...conn,
        position: conn.position * 1000
      }))
    }
  }))

  const output = {
    pipes,
    joints: erector.joints.map(joint => {
      return {
        id: joint.id,
        name: joint.name
      }
    }),
    ...(rootTransforms.length > 0 && { rootTransforms })
  }
  const data = new Blob([JSON.stringify(output, null, 4)], { type: 'application/json' })
  a.href = URL.createObjectURL(data)
  a.download = 'erector-design.json'
  a.click()
  URL.revokeObjectURL(a.href)
  document.body.removeChild(a)
}

function upload() {
  fileInput.value?.click()
}

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string
      const structure = JSON.parse(content) as UploadedStructure

      // Validate structure format
      if (!structure.pipes || !structure.joints || !Array.isArray(structure.pipes) || !Array.isArray(structure.joints)) {
        alert('Invalid file format. Please select a valid erector design JSON file.')
        return
      }

      // Validate rootTransforms if present
      if (structure.rootTransforms) {
        if (!Array.isArray(structure.rootTransforms)) {
          console.warn('Invalid rootTransforms format, ignoring.')
          delete structure.rootTransforms
        } else {
          structure.rootTransforms = structure.rootTransforms.filter(isValidRootTransform)
        }
      }

      const structureInMeters = {
        ...structure,
        pipes: structure.pipes.map((pipe) => ({
          ...pipe,
          diameter: pipe.diameter / 1000,
          length: pipe.length / 1000,
          connections: {
            start: pipe.connections.start,
            end: pipe.connections.end,
            midway: pipe.connections.midway.map(conn => ({
              ...conn,
              position: conn.position / 1000
            }))
          }
        })),
        ...(structure.rootTransforms
          ? {
            rootTransforms: structure.rootTransforms.map(rt => ({
              ...rt,
              position: rt.position.map((v: number) => v / 1000) as [number, number, number]
            }))
          }
          : {})
      }

      const erector = useErectorPipeJoint()
      const objectSelection = useObjectSelection()

      // Clear all existing instances and data
      erector.clearAll()

      // Clear object selection to reset gizmo state
      objectSelection.select('')

      // Load the new structure
      erector.loadFromStructure(structureInMeters)

      console.log('Structure loaded successfully')
    } catch (error) {
      console.error('Error parsing JSON file:', error)
      alert('Error reading file. Please select a valid JSON file.')
    }
  }

  reader.readAsText(file)

  // Reset the input value so the same file can be uploaded again
  input.value = ''
}
</script>

<style scoped>
.container {
  display: flex;
  justify-content: space-between;

  .header {
    display: flex;
    align-items: baseline;

    .title {
      color: transparent;
      background: linear-gradient(72deg, #4facfe, #00f2fe);
      background-clip: text;
      margin-right: 20px;
    }
  }

  .buttons {
    display: flex;
    align-items: center;

    .button {
      padding: 10px 20px;
      background-color: #007bff;
      color: white;
      border-radius: 5px;
      cursor: pointer;
      margin-left: 10px;

      &:hover {
        background-color: #0056b3;
      }

      &.disabled {
        background-color: #757575;
        pointer-events: none;
      }
    }
  }
}
</style>
