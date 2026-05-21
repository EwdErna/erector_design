import { defineStore } from 'pinia'
import type { ErectorComponent, ErectorJoint, ErectorJointHole, ErectorPipe, ErectorPipeConnection, JointMovableDefinition } from '~/types/erector_component'
import erectorComponentDefinitionRaw from '~/data/erector_component.json'
const erectorComponentDefinition = erectorComponentDefinitionRaw as unknown as ErectorComponent

export type PipeJointRelationship = {
  pipeId: string
  jointId: string
  holeId: number
  connectionType: 'start' | 'end' | 'midway'
  relationshipType: 'j2p' | 'p2j' // j2p: joint determines pipe, p2j: pipe determines joint
}

export type RootMerge = {
  mergedRoots: string[]    // 同一連結成分に属する root pipe の ID 群（length >= 2）
  componentPipes: string[] // その連結成分に属する全 pipe の ID 群
}

export function clampMidwayPosition(position: number, pipeLength: number): number {
  return Math.max(0, Math.min(pipeLength, position))
}

export const useErectorGraph = defineStore('erectorGraph', {
  state: () => ({
    pipes: [] as ErectorPipe[],
    joints: [] as ErectorJoint[],
    rootPipeIds: [] as string[],
  }),
  actions: {
    getDefaultRootPipeIds(): string[] {
      const visited = new Set<string>()
      const roots: string[] = []

      for (const pipe of this.pipes) {
        if (visited.has(pipe.id)) continue

        roots.push(pipe.id)
        const queue: string[] = [pipe.id]
        visited.add(pipe.id)

        while (queue.length > 0) {
          const currentPipeId = queue.shift()
          if (!currentPipeId) continue
          const currentPipe = this.pipes.find(p => p.id === currentPipeId)
          if (!currentPipe) continue

          const jointIds = [
            currentPipe.connections.start?.jointId,
            currentPipe.connections.end?.jointId,
            ...currentPipe.connections.midway.map(conn => conn.jointId)
          ].filter((id): id is string => typeof id === 'string')

          for (const jointId of jointIds) {
            for (const candidate of this.pipes) {
              const connected =
                candidate.connections.start?.jointId === jointId ||
                candidate.connections.end?.jointId === jointId ||
                candidate.connections.midway.some(conn => conn.jointId === jointId)
              if (connected && !visited.has(candidate.id)) {
                visited.add(candidate.id)
                queue.push(candidate.id)
              }
            }
          }
        }
      }

      return roots
    },

    syncRootPipeIds() {
      const existingPipeIds = new Set(this.pipes.map(pipe => pipe.id))
      const validRootPipeIds = this.rootPipeIds.filter(id => existingPipeIds.has(id))
      const autoRoots = this.getDefaultRootPipeIds().filter(id => !validRootPipeIds.includes(id))
      this.rootPipeIds = [...validRootPipeIds, ...autoRoots]
    },

    buildConnectedComponents(): string[][] {
      const visited = new Set<string>()
      const components: string[][] = []
      for (const pipe of this.pipes) {
        if (visited.has(pipe.id)) continue
        const component: string[] = []
        const queue = [pipe.id]
        visited.add(pipe.id)
        while (queue.length > 0) {
          const currentId = queue.shift()!
          component.push(currentId)
          const currentPipe = this.pipes.find(p => p.id === currentId)!
          const jointIds = [
            currentPipe.connections.start?.jointId,
            currentPipe.connections.end?.jointId,
            ...currentPipe.connections.midway.map(c => c.jointId)
          ].filter((id): id is string => !!id)
          for (const jointId of jointIds) {
            for (const candidate of this.pipes) {
              const connected =
                candidate.connections.start?.jointId === jointId ||
                candidate.connections.end?.jointId === jointId ||
                candidate.connections.midway.some(c => c.jointId === jointId)
              if (connected && !visited.has(candidate.id)) {
                visited.add(candidate.id)
                queue.push(candidate.id)
              }
            }
          }
        }
        components.push(component)
      }
      return components
    },

    addPipe(diameter: number, length: number, id?: string): string {
      if (!id) id = this.newPipeId
      if (!this.pipes.some(p => p.id === id)) {
        this.pipes.push({
          id,
          diameter,
          length,
          connections: {
            midway: [],
          }
        })
      }
      return id
    },

    updatePipe(id: string, key: 'length' | 'diameter', value: number) {
      const pipeIdx = this.pipes.findIndex(p => p.id === id)
      if (pipeIdx < 0) return
      this.pipes[pipeIdx][key] = value
      if (key === 'length') {
        this.pipes[pipeIdx].connections.midway = this.pipes[pipeIdx].connections.midway.map(conn => ({
          ...conn,
          position: clampMidwayPosition(conn.position, value)
        }))
      }
    },

    addJoint(name: string, holes: ErectorJointHole[], id?: string): string {
      if (!id) id = this.newJointId(name)
      if (!this.joints.some(j => j.id === id)) {
        const allTypes = [
          ...erectorComponentDefinition.pla_joints.categories.flatMap(c => c.types),
          ...erectorComponentDefinition.metal_joints,
        ] as unknown as { name: string, movable?: JointMovableDefinition }[]
        const movableDef = allTypes.find(t => t.name === name)?.movable
        const jointData: ErectorJoint = { id, name, holes }
        if (movableDef?.type === 'free_rotation') {
          jointData.clampedHoleIndex = 0
        }
        this.joints.push(jointData)
      }
      return id
    },

    updateClampedHoleIndex(jointId: string, index: number) {
      const joint = this.joints.find(j => j.id === jointId)
      if (!joint) return
      joint.clampedHoleIndex = index
    },

    addConnection(pipeId: string, jointId: string, holeId: number, side: 'start' | 'end' | 'midway', rotation?: number, position?: number, id?: string, reverse?: boolean) {
      const pipe = this.pipes.find(p => p.id === pipeId)
      const joint = this.joints.find(j => j.id === jointId)
      if (!pipe || !joint) return
      const hole = (joint.holes)[holeId]
      if (!hole) return
      switch (side) {
        case 'start':
        case 'end':
          if (id && pipe.connections[side]?.id === id) return
          pipe.connections[side] = {
            id: id ?? this.newConnectionId(pipeId),
            jointId,
            holeId,
            rotation: rotation ?? 0,
            position: 0,
          }
          break
        case 'midway':
          if (id && pipe.connections.midway.some(conn => conn.id === id)) return
          pipe.connections.midway.push({
            id: id ?? this.newConnectionId(pipeId),
            jointId,
            holeId,
            rotation: rotation ?? 0,
            position: clampMidwayPosition(position ?? 0, pipe.length),
            ...(reverse ? { reverse: true } : {}),
          })
          break
      }
    },

    updateConnection(id: string, connectionToUpdate: Partial<ErectorPipeConnection>) {
      const pipe = this.pipes.find(p =>
        p.connections.start?.id === id ||
        p.connections.end?.id === id ||
        p.connections.midway.some(conn => conn.id === id)
      )
      if (!pipe) return
      const connection = pipe.connections.start?.id === id
        ? 'start'
        : pipe.connections.end?.id === id
          ? 'end'
          : pipe.connections.midway.findIndex(conn => conn.id === id)
      if (connection === -1) return
      const connectionBeforeUpdate = typeof connection === 'number'
        ? pipe.connections.midway[connection]
        : pipe.connections[connection]
      if (!connectionBeforeUpdate) return
      if (connection === 'start' || connection === 'end') {
        pipe.connections[connection] = { ...connectionBeforeUpdate, ...connectionToUpdate }
      } else {
        pipe.connections.midway[connection] = {
          ...connectionBeforeUpdate,
          ...connectionToUpdate,
          ...(typeof connectionToUpdate.position === 'number'
            ? { position: clampMidwayPosition(connectionToUpdate.position, pipe.length) }
            : {})
        }
      }
    },

    removeConnection(id: string) {
      for (const pipe of this.pipes) {
        if (pipe.connections.start?.id === id) {
          pipe.connections.start = undefined
          return
        }
        if (pipe.connections.end?.id === id) {
          pipe.connections.end = undefined
          return
        }
        const index = pipe.connections.midway.findIndex(conn => conn.id === id)
        if (index !== -1) {
          pipe.connections.midway.splice(index, 1)
          return
        }
      }
    },

    removePipe(pipeId: string) {
      const pipeIdx = this.pipes.findIndex(p => p.id === pipeId)
      if (pipeIdx === -1) return
      this.pipes.splice(pipeIdx, 1)
      this.syncRootPipeIds()
    },

    removeJoint(jointId: string) {
      // Remove all connections referencing this joint
      for (const pipe of this.pipes) {
        if (pipe.connections.start?.jointId === jointId) {
          pipe.connections.start = undefined
        }
        if (pipe.connections.end?.jointId === jointId) {
          pipe.connections.end = undefined
        }
        pipe.connections.midway = pipe.connections.midway.filter(c => c.jointId !== jointId)
      }
      this.joints = this.joints.filter(j => j.id !== jointId)
    },

    clear() {
      this.pipes = []
      this.joints = []
      this.rootPipeIds = []
    },
  },
  getters: {
    newPipeId(): string {
      const existing_id = this.pipes.map(v => Number.parseInt(v.id.split('_')[1], 10))
      const id = ((existing_id.length > 0 ? Math.max(...existing_id) : 0) + 1).toString().padStart(4, '0')
      return `P_${id.toString().padStart(4, '0')}`
    },
    newJointId() {
      return (joint: string) => {
        const existing_id = this.joints.filter(v => v.id.startsWith(joint)).map(v => Number.parseInt(v.id.split('_')[1], 10))
        const id = (existing_id.length > 0 ? Math.max(...existing_id) : 0) + 1
        return `${joint}_${id.toString().padStart(4, '0')}`
      }
    },
    newConnectionId() {
      return (pipeId: string) => {
        const baseId = `${pipeId}-conn`
        const pipe = this.pipes.find(p => p.id === pipeId)
        if (!pipe) return baseId
        const ids: string[] = []
        pipe.connections.start && ids.push(pipe.connections.start.id)
        pipe.connections.end && ids.push(pipe.connections.end.id)
        pipe.connections.midway.forEach(conn => ids.push(conn.id))
        const id_numbers = ids.map(i => i.split("-")).filter(l => l.length > 1).map(l => l[2]) ?? ['-1']
        const maxNumber = id_numbers.length > 0 ? Math.max(...id_numbers.map(i => parseInt(i))) : 0
        return `${baseId}-${maxNumber + 1}`
      }
    }
  }
})
