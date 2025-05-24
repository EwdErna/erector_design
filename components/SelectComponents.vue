<template>
    <div class="container">
        <h2>Components</h2>
        <SelectPipe :pipe="components.pipe"></SelectPipe>
        <SelectPlaJoint :pla_joints="components.pla_joints"></SelectPlaJoint>
        <SelectMetalJoint :metal_joints="components.metal_joints"></SelectMetalJoint>
    </div>
</template>

<script lang="ts" setup>
import components_json from "@/data/erector_component.json"
import type { ErectorComponent } from "~/types/erector_component";
const components = components_json as ErectorComponent
// パイプの選び方：
// パイプの太さをselectで選択
// パイプの色を丸で選択
// パイプの長さを一覧から選択
</script>
<style scoped>
.container {
    height: 100%;
    width: 100%;
    box-sizing: content-box;
    display: flow-root;
    overflow-y: scroll;
}
</style>