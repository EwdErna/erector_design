<template>
  <div class="floating-file-buttons">
    <button class="fab" @click="upload" title="Upload">↑</button>
    <button class="fab" @click="download" title="Download">↓</button>
    <input ref="fileInput" type="file" accept=".json" @change="handleFileUpload" style="display: none;">
  </div>
</template>

<script lang="ts" setup>
import type { ErectorPipe } from '~/types/erector_component'

type UploadedStructure = {
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
    Array.isArray(arr) && arr.length === 3 && arr.every(v => typeof v === 'number' && Number.isFinite(v))
  if (!value || typeof value !== 'object') return false
  const candidate = value as { pipeId?: unknown, position?: unknown, rotation?: unknown }
  return typeof candidate.pipeId === 'string'
    && isNumberTuple3(candidate.position)
    && isNumberTuple3(candidate.rotation)
}

function download() {
  const a = document.body.appendChild(document.createElement('a'))
  const erector = useErectorPipeJoint()
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
    .filter((t): t is { pipeId: string, position: [number, number, number], rotation: [number, number, number] } => t !== null)
  const pipes = erector.pipes.map(pipe => ({
    ...pipe,
    diameter: pipe.diameter * 1000,
    length: pipe.length * 1000,
    connections: {
      start: pipe.connections.start,
      end: pipe.connections.end,
      midway: pipe.connections.midway.map(conn => ({ ...conn, position: conn.position * 1000 }))
    }
  }))
  const output = {
    pipes,
    joints: erector.joints.map(j => ({ id: j.id, name: j.name })),
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
      if (!structure.pipes || !structure.joints || !Array.isArray(structure.pipes) || !Array.isArray(structure.joints)) {
        alert('Invalid file format. Please select a valid erector design JSON file.')
        return
      }
      if (structure.rootTransforms) {
        if (!Array.isArray(structure.rootTransforms)) {
          delete structure.rootTransforms
        } else {
          structure.rootTransforms = structure.rootTransforms.filter(isValidRootTransform)
        }
      }
      const structureInMeters = {
        ...structure,
        pipes: structure.pipes.map(pipe => ({
          ...pipe,
          diameter: pipe.diameter / 1000,
          length: pipe.length / 1000,
          connections: {
            start: pipe.connections.start,
            end: pipe.connections.end,
            midway: pipe.connections.midway.map(conn => ({ ...conn, position: conn.position / 1000 }))
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
      erector.clearAll()
      objectSelection.select('')
      erector.loadFromStructure(structureInMeters)
    } catch {
      alert('Error reading file. Please select a valid JSON file.')
    }
  }
  reader.readAsText(file)
  input.value = ''
}
</script>

<style scoped>
.floating-file-buttons {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
  z-index: 200;
}

.fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #007bff;
  color: white;
  border: none;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);

  &:active {
    background: #0056b3;
  }
}
</style>
