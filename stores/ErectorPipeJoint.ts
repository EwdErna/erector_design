import { defineStore } from 'pinia'
import { MeshPhongMaterial, Object3D, Scene } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import type { ErectorJoint, ErectorJointHole } from '~/types/erector_component'
export const useErectorPipeJoint = defineStore('erectorPipeJoint', {
  state: () => ({
    joints: [] as ErectorJoint[],
    instances: [] as { id: string, obj?: Object3D }[],
  }),
  actions: {
    addJoint(scene: Scene, name: string, category: string, holes: ErectorJointHole[], id?: string) {//jointの存在だけを追加
      const loader = new GLTFLoader() //TODO: use singleton
      if (!id) id = this.newJointId(name)
      this.joints.push({
        id,
        name,
        holes
      })
      if (!this.instances.some(i => i.id === id)) {
        loader.load(`/models/${category}/erector_component-${name}.gltf`, (gltf) => {
          const model = gltf.scene
          model.traverse((child) => {
            if (child instanceof Mesh) {
              child.material = new MeshPhongMaterial()
            }
          })
          model.name = id
          this.instances.push({ id, obj: model })
          // TODO: get scene and add model to it
          scene.add(model)
        })
      }
      return id
    },
  },
  getters: {
    newJointId() {
      return (joint: string) => {
        const existing_id = this.joints.filter(v => v.id.startsWith(joint)).map(v => Number.parseInt(v.id.split('_')[1], 10))
        const id = (existing_id.length > 0 ? Math.max(...existing_id) : 0) + 1
        return `${joint}_${id.toString().padStart(4, '0')}`
      }
    },
  }
})
