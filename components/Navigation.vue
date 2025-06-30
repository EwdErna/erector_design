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
const fileInput = useTemplateRef('fileInput')

function download() {
  const a = document.body.appendChild(document.createElement('a'))
  const erector = useErectorPipeJoint()

  // Get root pipe transform if available
  let rootTransform = null
  if (erector.pipes.length > 0) {
    const rootPipeId = erector.pipes[0].id
    const rootInstance = erector.instances.find(i => i.id === rootPipeId)?.obj
    if (rootInstance) {
      rootTransform = {
        pipeId: rootPipeId,
        position: [rootInstance.position.x, rootInstance.position.y, rootInstance.position.z] as [number, number, number],
        rotation: [rootInstance.quaternion.x, rootInstance.quaternion.y, rootInstance.quaternion.z, rootInstance.quaternion.w] as [number, number, number, number]
      }
    }
  }

  const output = {
    pipes: erector.pipes,
    joints: erector.joints.map(joint => {
      return {
        id: joint.id,
        name: joint.name
      }
    }),
    ...(rootTransform && { rootTransform })
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
      const structure = JSON.parse(content)

      // Validate structure format
      if (!structure.pipes || !structure.joints || !Array.isArray(structure.pipes) || !Array.isArray(structure.joints)) {
        alert('Invalid file format. Please select a valid erector design JSON file.')
        return
      }

      // Validate rootTransform if present
      if (structure.rootTransform) {
        const rt = structure.rootTransform
        if (!rt.pipeId || !Array.isArray(rt.position) || rt.position.length !== 3 ||
          !Array.isArray(rt.rotation) || rt.rotation.length !== 3) {
          console.warn('Invalid rootTransform format, ignoring.')
          delete structure.rootTransform
        }
      }

      const erector = useErectorPipeJoint()
      const objectSelection = useObjectSelection()

      // Clear all existing instances and data
      erector.clearAll()

      // Clear object selection to reset gizmo state
      objectSelection.select('')

      // Load the new structure
      erector.loadFromStructure(structure)

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