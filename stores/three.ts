import { defineStore } from 'pinia'
import type { Scene } from 'three'

export const useThree = defineStore('three', {
  state: (): { scene?: Scene } => ({ scene: undefined }),
  actions: {
    resisterScene(scene: Scene) {
      this.scene = scene
    }
  }
})
