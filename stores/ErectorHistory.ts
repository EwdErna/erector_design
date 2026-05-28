import { defineStore } from 'pinia'
import type { ErectorPipe } from '~/types/erector_component'

export type HistorySnapshot = {
  pipes: ErectorPipe[]
  joints: { id: string, name: string, clampedHoleIndex?: number }[]
  rootPipeIds: string[]
  rootTransforms: { id: string, position: [number, number, number], rotation: [number, number, number, number] }[]
}

const MAX_HISTORY = 50

export const useErectorHistory = defineStore('erectorHistory', {
  state: () => ({
    past: [] as HistorySnapshot[],
    future: [] as HistorySnapshot[],
  }),
  actions: {
    record(snapshot: HistorySnapshot) {
      this.past.push(snapshot)
      if (this.past.length > MAX_HISTORY) this.past.shift()
      this.future = []
    },
    undoPop(): HistorySnapshot | null {
      return this.past.length > 0 ? this.past.pop()! : null
    },
    redoPop(): HistorySnapshot | null {
      return this.future.length > 0 ? this.future.pop()! : null
    },
    pushFuture(snapshot: HistorySnapshot) {
      this.future.push(snapshot)
    },
    pushPast(snapshot: HistorySnapshot) {
      this.past.push(snapshot)
      if (this.past.length > MAX_HISTORY) this.past.shift()
    },
  },
  getters: {
    canUndo: (state): boolean => state.past.length > 0,
    canRedo: (state): boolean => state.future.length > 0,
  },
})
