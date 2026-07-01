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
      <div
        class="button"
        :class="{ active: erector.isSimulationMode }"
        @click="toggleSimulation"
      >{{ erector.isSimulationMode ? 'Design Mode' : 'Simulation' }}</div>
      <div class="button" :class="{ disabled: erector.isSimulationMode }" @click="download">Download</div>
      <div class="button" :class="{ disabled: erector.isSimulationMode }" @click="upload">Upload</div>
      <input ref="fileInput" type="file" accept=".json" @change="handleFileUpload" style="display: none;">
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ErectorPipe, ErectorBoundary } from '~/types/erector_component'
import { definitions } from '~/utils/Erector/erectorComponentDefinition'
import { useErectorBoundary } from '~/stores/ErectorBoundary'

const erector = useErector()
const boundary = useErectorBoundary()

function toggleSimulation() {
  if (erector.isSimulationMode) {
    erector.exitSimulationMode()
    erector.resetSimulationStates()
  } else {
    erector.enterSimulationMode()
    const allTypes = [
      ...definitions.pla_joints.categories.flatMap(c => c.types),
      ...definitions.metal_joints,
    ]
    for (const joint of erector.joints) {
      const movableDef = (allTypes.find(t => t.name === joint.name) as any)?.movable
      if (!movableDef) continue
      erector.initSimulationState(joint.id, movableDef.type)
      if (movableDef.type === 'detachable') {
        erector.setAttached(joint.id, false)
      }
    }
  }
}

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
  boundaries?: Array<ErectorBoundary & { position: [number, number, number], size: [number, number, number] }>
}

const lastFileName = useState('erector-last-filename', () => 'erector-design.json')
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
  const erector = useErector()

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

  const boundaries = boundary.boundaries.map(b => ({
    ...b,
    position: b.position.map(v => v * 1000) as [number, number, number],
    size: b.size.map(v => v * 1000) as [number, number, number],
  }))

  const output = {
    pipes,
    joints: erector.joints.map(joint => ({
      id: joint.id,
      name: joint.name,
      ...(joint.clampedHoleIndex !== undefined && { clampedHoleIndex: joint.clampedHoleIndex }),
    })),
    ...(rootTransforms.length > 0 && { rootTransforms }),
    ...(boundaries.length > 0 && { boundaries }),
  }
  const data = new Blob([JSON.stringify(output, null, 4)], { type: 'application/json' })
  a.href = URL.createObjectURL(data)
  a.download = lastFileName.value
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
  lastFileName.value = file.name

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

      const erector = useErector()
      const objectSelection = useObjectSelection()

      erector.clearAll()
      objectSelection.select('')
      boundary.clearAll()

      erector.loadFromStructure(structureInMeters)

      if (structure.boundaries) {
        boundary.loadBoundaries(structure.boundaries.map(b => ({
          ...b,
          position: b.position.map(v => v / 1000) as [number, number, number],
          size: b.size.map(v => v / 1000) as [number, number, number],
        })))
      }

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
@media (min-width: 769px), (pointer: fine) {
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

        &.active {
          background-color: #e67e00;

          &:hover {
            background-color: #b35f00;
          }
        }
      }
    }
  }
}
</style>
