import { defineStore } from 'pinia'
import type { JointSimulationState } from '~/types/erector_component'

export const useErectorSimulation = defineStore('erectorSimulation', {
  state: () => ({
    isSimulationMode: false,
    simulationStates: {} as Record<string, JointSimulationState>,
  }),
  actions: {
    toggleSimulationMode() {
      this.isSimulationMode = !this.isSimulationMode
    },

    enterSimulationMode() {
      this.isSimulationMode = true
    },

    exitSimulationMode() {
      this.isSimulationMode = false
    },

    initSimulationState(jointId: string, type: JointSimulationState['type']) {
      if (this.simulationStates[jointId]) return
      if (type === 'pivot') {
        this.simulationStates[jointId] = { type: 'pivot', angle: 0 }
      } else if (type === 'free_rotation') {
        this.simulationStates[jointId] = { type: 'free_rotation', spinAngle: 0, orbitAngle: 0 }
      } else {
        this.simulationStates[jointId] = { type: 'detachable', attached: true }
      }
    },

    setSimulationAngle(jointId: string, angle: number) {
      const state = this.simulationStates[jointId]
      if (state?.type === 'pivot') state.angle = angle
    },

    setSpinAngle(jointId: string, spinAngle: number) {
      const state = this.simulationStates[jointId]
      if (state?.type === 'free_rotation') state.spinAngle = spinAngle
    },

    setOrbitAngle(jointId: string, orbitAngle: number) {
      const state = this.simulationStates[jointId]
      if (state?.type === 'free_rotation') state.orbitAngle = orbitAngle
    },

    setAttached(jointId: string, attached: boolean) {
      const state = this.simulationStates[jointId]
      if (state?.type === 'detachable') state.attached = attached
    },

    resetSimulationStates() {
      this.simulationStates = {}
    },

    clear() {
      this.isSimulationMode = false
      this.simulationStates = {}
    },
  },
})
