<template>
  <div>
    <div class="container">
      <h3>Metal Joint</h3>
      <div class="page-container">
        <div class="page">
          <div class="item" v-for="t in metal_joints" :key="t.name">
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

const componens = defineProps({
  metal_joints: {
    type: Array<ErectorJointComponent>,
    required: true
  }
})

</script>

<style scoped>
.container {
  width: 100%;

  .page-container {
    width: 100%;
    height: 250px;
    overflow-y: auto;
    background-color: #f9f9f9;
  }

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
        margin: 0 10%;
        width: 80%;
        display: flex;
        justify-content: center;
        align-items: center;

        img {
          max-width: 100%;
          max-height: 100%;
          background-color: #000000;
        }
      }
    }
  }
}
</style>