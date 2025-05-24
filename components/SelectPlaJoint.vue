<template>
  <div>
    <div class="container">
      <h3>Plastic Joint</h3>
      <div class="tab-controll">
        <div class="tabs">
          <div class="tabs-container">
            <div v-for="(category, index) in components.pla_joints.categories" :class="['tab-item', {
              selected: selected.category === category.name
            }]" :key="index" @click="selected.category = category.name">
              {{ category.name }}
            </div>
          </div>
          <div class="overlay"></div>
        </div>
        <div class="page">
          <div class="item" v-for="t in selectedTypes">
            <div>
              <h4>{{ t.name }}</h4>
              <div class="preview">
                <img src="#" :alt="t.name">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { PropType } from 'vue';
import type { ErectorJointComponent } from '~/types/erector_component';

const components = defineProps({
  pla_joints: {
    type: Object as PropType<{ categories: { name: string, types: ErectorJointComponent[] }[] }>,
    required: true
  }
})
const selected = useState<{
  category: string,
  type: string,
  color: string
}>("selectedJoint", () => ({
  category: "",
  type: "",
  color: ""
}))
const selectedTypes = computed(() => {
  return components.pla_joints.categories.find(category => category.name === selected.value.category)?.types || []
})
</script>

<style scoped>
.container {
  width: 100%;

  .tab-controll {
    .tabs {
      width: 100%;
      position: relative;

      .overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 5px;
        pointer-events: none;
      }

      .tabs-container {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
        overflow: scroll;
        scrollbar-width: none;

        &::-webkit-scrollbar {
          display: none;
        }

        .tab-item {
          padding: 10px;
          cursor: pointer;
          border-radius: 5px;
          background-color: #f0f0f0;
          transition: background-color 0.3s;

          &.selected {
            background-color: #007bff;
            color: white;
          }
        }
      }
    }

    .page {
      display: flex;
      flex-wrap: wrap;
      height: 450px;
      gap: 10px;
      padding: 10px;
      background-color: #f9f9f9;
      border-radius: 5px;

      .item {
        width: 100px;
        height: 100px;
        background-color: #f9f9f9;
        border-radius: 5px;
        display: flex;
        justify-content: center;
        align-items: center;

        &:hover {
          background-color: #f0f0f0;
        }

        .preview {
          width: 80%;
          height: 80%;
          display: flex;
          justify-content: center;
          align-items: center;

          img {
            max-width: 100%;
            max-height: 100%;
          }
        }
      }
    }
  }
}
</style>