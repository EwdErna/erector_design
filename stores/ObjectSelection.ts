import { defineStore } from 'pinia'

export const useObjectSelection = defineStore('objectSelection', {
  state: (): { object?: string } => ({ object: undefined }),
  actions: {
    select(object: string) {
      this.object = object
    }
  }
})
