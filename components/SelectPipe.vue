<template>
  <div>
    <div class="container">
      <h3>Pipe</h3>
      <div class="selector">
        <div class="color-selector">
          <div v-for="color in components.pipe.colors" :key="color.name"
            :class="['color-circle-outer', { selected: selected.color === color.name }]"
            @click="selectColor(color.name)">
            <div class="color-circle" :style="{ backgroundColor: color.color }"></div>
          </div>
        </div>
        <div class="diameter-selector">
          <select v-model="selected.diameter">
            <option v-for="d in components.pipe.diameters" :key="d" :value="d">
              {{ d }} mm
            </option>
          </select>
        </div>
      </div>
      <div class="length-list">
        <div class="length-item" v-for="length in components.pipe.lengths" :key="length"
          @click="selected.length = length; addPipeToScene()">
          {{ length * 1000 }} mm
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { PropType } from 'vue';
import type { ErectorPipeComponent } from '~/types/erector_component';

const components = defineProps({
  pipe: {
    type: Object as PropType<ErectorPipeComponent>,
    required: true
  }
})
const selected = useState<{
  diameter: number,
  color: string,
  length: number
}>("selectedPipe", () => ({
  diameter: 28,
  color: "",
  length: 0
}))
const selectColor = (color: string) => {
  selected.value.color = color
}
const addPipeToScene = () => {
  const scene = useThree().scene
  if (!scene) { return }
  const erector = useErectorPipeJoint()
  const added_id = erector.addPipe(scene, selected.value.diameter / 1000, selected.value.length)
}

</script>

<style scoped>
.container {
  width: 100%;

  .selector {
    display: flex;
    gap: 10px;
    height: 32px;
    align-items: center;

    .color-selector {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;

      .color-circle-outer {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid #fff;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;

        &.selected {
          border-color: #f00;
        }

        .color-circle {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          box-shadow: 0 0 1px rgba(0, 0, 0, 0.5);
        }
      }
    }
  }

  .length-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 5px 10px;
    background-color: #f9f9f9;
    border-radius: 5px;

    .length-item {
      padding: 5px 10px;
      background-color: #f9f9f9;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background-color: #f0f0f0;
      }
    }
  }

}
</style>