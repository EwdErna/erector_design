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
        <div class="page-container">
          <div class="page">
            <div class="item" v-for="t in selectedTypes">
              <div @click="addJointToScene(t.name, selected.category)">
                <h4>{{ t.name }}</h4>
                <div class="preview">
                  <img :src="`./models/${selected.category}/erector_component-${t.name}.png`" :alt="t.name">
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Quaternion, Scene, Vector3 } from 'three';
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
function addJointToScene(name: string, category: string) {
  const scene: Scene | undefined = useThree().scene
  if (!scene) { return }
  const joint = components.pla_joints.categories.find(c => c.name === category)?.types.find(t => t.name === name)
  if (!joint?.joints) { return }
  // Add the joint to the scene
  // This is a placeholder for the actual implementation
  console.log(`Adding joint ${name} of category ${category} to the scene`)
  const erector = useErectorPipeJoint()
  const added_id = erector.addJoint(scene, name, category, joint.joints.map(j => {
    return {
      type: j.through !== true ? 'FIX' as const : "THROUGH" as const,
      dir: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3().fromArray(j.to)),
      offset: new Vector3().fromArray(j.start ?? [0, 0, 0])
    }
  }))
  console.log(`added ${added_id}`)
}
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
        overflow-x: scroll;
        scrollbar-width: none;

        background: linear-gradient(90deg,
            rgb(240, 240, 240) 50%,
            rgb(240, 240, 240, 0)),
          linear-gradient(90deg,
            rgb(240, 240, 240, 0),
            rgb(240, 240, 240) 50%) 0 100%,
          linear-gradient(90deg,
            rgb(128, 195, 255) 50%,
            transparent),
          linear-gradient(90deg,
            transparent,
            rgb(128, 195, 255) 50%) 0 100%;
        background-color: #f0f0f0;
        background-repeat: no-repeat;
        background-attachment: local, local, scroll, scroll;
        background-position: 0 0, 100%, 0 0, 100%;
        background-size: 60px 100%,
          60px 100%, 30px 100%,
          30px 100%;

        &::-webkit-scrollbar {
          display: none;
        }

        .tab-item {
          padding: 10px;
          cursor: pointer;
          border-radius: 5px;
          transition: background-color 0.3s;

          &.selected {
            background-color: #007bff;
            color: white;
          }
        }
      }
    }

    .page-container {
      width: 100%;
      height: 250px;
      overflow-y: auto;
      background-color: #f9f9f9;

      .page {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 10px;
        border-radius: 5px;

        .item {
          width: 100px;
          height: 100px;
          background-color: #f0f0f9;
          border-radius: 5px;
          display: flex;
          justify-content: center;

          &:hover {
            background-color: #e0e0f0;
          }

          h4 {
            margin: 0;
          }

          .preview {
            margin: 0 10px;
            width: 80px;
            flex-grow: 1;
            display: flex;
            justify-content: center;
            align-items: center;

            img {
              width: 100%;
              height: 100%;
              background-color: #000000;
            }
          }
        }
      }
    }
  }
}
</style>