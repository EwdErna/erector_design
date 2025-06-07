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
      <div class="button disabled">Upload</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
function download() {
  const a = document.body.appendChild(document.createElement('a'))
  const erector = useErectorPipeJoint()
  const output = {
    pipes: erector.pipes, joints: erector.joints.map(joint => {
      return {
        id: joint.id,
        name: joint.name
      }
    })
  }
  const data = new Blob([JSON.stringify(output, null, 4)], { type: 'application/json' })
  a.href = URL.createObjectURL(data)
  a.download = 'erector-design.json'
  a.click()
  URL.revokeObjectURL(a.href)
  document.body.removeChild(a)
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