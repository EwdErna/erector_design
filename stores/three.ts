import { defineStore } from 'pinia'
import { Vector3 } from 'three'
import type { Scene } from 'three'

export const useThree = defineStore('three', {
  state: (): { scene?: Scene; orbitTarget: { x: number; y: number; z: number } } => ({
    scene: undefined,
    orbitTarget: { x: 0, y: 0, z: 0 }
  }),
  actions: {
    resisterScene(scene: Scene) {
      this.scene = scene
    },
    updateOrbitTarget(v: Vector3) {
      this.orbitTarget.x = v.x
      this.orbitTarget.y = v.y
      this.orbitTarget.z = v.z
    }
  }
})
