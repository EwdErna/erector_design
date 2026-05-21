import { Quaternion, Vector3 } from 'three'
import { useErectorGraph } from '~/stores/ErectorGraph'
import { useErectorScene } from '~/stores/ErectorScene'
import { useErectorValidation } from '~/stores/ErectorValidation'
import { useErectorSimulation } from '~/stores/ErectorSimulation'
import type { ErectorJointHole, ErectorPipe, ErectorPipeConnection } from '~/types/erector_component'
import erectorComponentDefinition from '~/data/erector_component.json'

/**
 * useErector — 3ストアをまとめるファサード composable。
 * 既存の useErectorPipeJoint() と同じ API を提供する。
 */
export function useErector() {
  const graph = useErectorGraph()
  const scene = useErectorScene()
  const validation = useErectorValidation()
  const simulation = useErectorSimulation()

  // ----------------------------------------------------------------
  // High-level composite operations
  // ----------------------------------------------------------------

  function addPipe(diameter: number, length: number, id?: string): string {
    const resolvedId = graph.addPipe(diameter, length, id)
    scene.addPipeObject(resolvedId, diameter, length)
    return resolvedId
  }

  function addJoint(name: string, category: string, holes: ErectorJointHole[], id?: string): string {
    const resolvedId = graph.addJoint(name, holes, id)
    scene.addJointObject(resolvedId, name, category, holes)
    return resolvedId
  }

  function removePipe(pipeId: string) {
    const pipe = graph.pipes.find(p => p.id === pipeId)
    if (!pipe) return

    // Clean up scene relationships BEFORE removing from graph
    if (pipe.connections.start) {
      scene.removeConnectionRelationship(pipeId, pipe.connections.start.jointId, pipe.connections.start.holeId, 'start')
    }
    if (pipe.connections.end) {
      scene.removeConnectionRelationship(pipeId, pipe.connections.end.jointId, pipe.connections.end.holeId, 'end')
    }
    for (const conn of pipe.connections.midway) {
      scene.removeConnectionRelationship(pipeId, conn.jointId, conn.holeId, 'midway')
    }

    graph.removePipe(pipeId)
    scene.removeObject(pipeId)
    validation.validateConnections()
  }

  function removeJoint(jointId: string) {
    // Clean up scene relationships for all connections referencing this joint
    for (const pipe of graph.pipes) {
      if (pipe.connections.start?.jointId === jointId) {
        scene.removeConnectionRelationship(pipe.id, jointId, pipe.connections.start.holeId, 'start')
      }
      if (pipe.connections.end?.jointId === jointId) {
        scene.removeConnectionRelationship(pipe.id, jointId, pipe.connections.end.holeId, 'end')
      }
      for (const conn of pipe.connections.midway) {
        if (conn.jointId === jointId) {
          scene.removeConnectionRelationship(pipe.id, jointId, conn.holeId, 'midway')
        }
      }
    }

    graph.removeJoint(jointId)
    scene.removeObject(jointId)
    validation.validateConnections()
  }

  function removeConnection(id: string) {
    // Find connection details BEFORE removing
    let found = false
    for (const pipe of graph.pipes) {
      if (pipe.connections.start?.id === id) {
        scene.removeConnectionRelationship(pipe.id, pipe.connections.start.jointId, pipe.connections.start.holeId, 'start')
        found = true
        break
      }
      if (pipe.connections.end?.id === id) {
        scene.removeConnectionRelationship(pipe.id, pipe.connections.end.jointId, pipe.connections.end.holeId, 'end')
        found = true
        break
      }
      const midwayIdx = pipe.connections.midway.findIndex(c => c.id === id)
      if (midwayIdx !== -1) {
        const conn = pipe.connections.midway[midwayIdx]
        scene.removeConnectionRelationship(pipe.id, conn.jointId, conn.holeId, 'midway')
        found = true
        break
      }
    }
    if (found) graph.removeConnection(id)
  }

  function updatePipe(id: string, key: 'length' | 'diameter', value: number) {
    graph.updatePipe(id, key, value)
    const pipe = graph.pipes.find(p => p.id === id)
    if (pipe) scene.updatePipeGeometry(id, pipe.length, pipe.diameter)
    validation.validateConnections()
  }

  function addConnection(pipeId: string, jointId: string, holeId: number, side: 'start' | 'end' | 'midway', rotation?: number, position?: number, id?: string, reverse?: boolean) {
    graph.addConnection(pipeId, jointId, holeId, side, rotation, position, id, reverse)
  }

  function updateConnection(id: string, connectionToUpdate: Partial<ErectorPipeConnection>) {
    graph.updateConnection(id, connectionToUpdate)
    validation.lastModifiedConnectionId = id
    validation.scheduleValidation()
  }

  function clearAll() {
    scene.clear()
    graph.clear()
    validation.clear()
    simulation.clear()
  }

  function updateClampedHoleIndex(jointId: string, index: number) {
    graph.updateClampedHoleIndex(jointId, index)
  }

  function loadFromStructure(structure: { pipes: ErectorPipe[], joints: { id: string, name: string, clampedHoleIndex?: number }[], rootTransforms?: { pipeId: string, position: [number, number, number], rotation: [number, number, number] }[] }) {
    clearAll()

    const three = useThree()
    if (!three.scene) return

    structure.pipes.forEach(pipe => {
      if (graph.pipes.findIndex(p => p.id === pipe.id) === -1) {
        addPipe(pipe.diameter, pipe.length, pipe.id)
      }

      const jointInstanciate = (conn: ErectorPipeConnection) => {
        if (graph.joints.findIndex(j => j.id === conn.jointId) === -1) {
          const joint = structure.joints.find(j => j.id === conn.jointId)
          if (!joint) return
          const jointCategoryDefinition = erectorComponentDefinition.pla_joints.categories.find(c =>
            c.types.some(t => t.name === joint.name)
          )
          if (!jointCategoryDefinition) return
          const jointDefinition = (jointCategoryDefinition?.types as { name: string, joints?: { to: [number, number, number], start?: [number, number, number], through?: boolean }[] }[]).find(t => t.name === joint.name)
          if (!jointDefinition?.joints) return
          addJoint(joint.name, jointCategoryDefinition.name, jointDefinition.joints.map(j => ({
            type: j.through !== true ? 'FIX' as const : 'THROUGH' as const,
            dir: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3().fromArray(j.to)),
            offset: new Vector3().fromArray(j.start ?? [0, 0, 0])
          })), joint.id)
          if (typeof joint.clampedHoleIndex === 'number') {
            const addedJoint = graph.joints.find(j => j.id === joint.id)
            if (addedJoint) addedJoint.clampedHoleIndex = joint.clampedHoleIndex
          }
        }
      }

      if (pipe.connections.start) {
        jointInstanciate(pipe.connections.start)
        const startConnection = graph.pipes.find(p => p.id === pipe.id)?.connections.start
        if (!startConnection) {
          addConnection(pipe.id, pipe.connections.start.jointId, pipe.connections.start.holeId, 'start', pipe.connections.start.rotation, pipe.connections.start.position)
        }
      }
      if (pipe.connections.end) {
        jointInstanciate(pipe.connections.end)
        const endConnection = graph.pipes.find(p => p.id === pipe.id)?.connections.end
        if (!endConnection) {
          addConnection(pipe.id, pipe.connections.end.jointId, pipe.connections.end.holeId, 'end', pipe.connections.end.rotation, pipe.connections.end.position)
        }
      }
      pipe.connections.midway.forEach(conn => {
        jointInstanciate(conn)
        const midwayConnection = graph.pipes.find(p => p.id === pipe.id)?.connections.midway
        if (!midwayConnection?.find(c => c.jointId === conn.jointId && c.holeId === conn.holeId)) {
          addConnection(pipe.id, conn.jointId, conn.holeId, 'midway', conn.rotation, conn.position, undefined, conn.reverse)
        }
      })
    })

    if (structure.rootTransforms && structure.rootTransforms.length > 0) {
      const rootPipeIds = new Set<string>()
      structure.rootTransforms.forEach(rootTransform => {
        const rootPipe = graph.pipes.find(p => p.id === rootTransform.pipeId)
        if (!rootPipe) return
        scene.updateObjectPosition(rootTransform.pipeId, rootTransform.position)
        scene.updateObjectRotation(rootTransform.pipeId, rootTransform.rotation)
        rootPipeIds.add(rootTransform.pipeId)
      })
      graph.rootPipeIds = Array.from(rootPipeIds)
    }

    graph.syncRootPipeIds()
    validation.validateConnections()
  }

  // ----------------------------------------------------------------
  // Return unified API surface (same shape as old useErectorPipeJoint)
  // JS getters preserve Pinia reactivity when accessed in templates.
  // ----------------------------------------------------------------
  return {
    // --- Graph state ---
    get pipes() { return graph.pipes },
    get joints() { return graph.joints },
    get rootPipeIds() { return graph.rootPipeIds },
    set rootPipeIds(v) { graph.rootPipeIds = v },
    get newPipeId() { return graph.newPipeId },
    get newJointId() { return graph.newJointId },
    get newConnectionId() { return graph.newConnectionId },

    // --- Scene state ---
    get instances() { return scene.instances },
    get renderCount() { return scene.renderCount },
    get pipeJointRelationships() { return scene.pipeJointRelationships },
    get debugArrows() { return scene.debugArrows },
    get instanceObjectMap() { return scene.instanceObjectMap },
    get rootPipeObjects() { return scene.rootPipeObjects },

    // --- Simulation state ---
    get isSimulationMode() { return simulation.isSimulationMode },
    get simulationStates() { return simulation.simulationStates },

    // --- Validation state ---
    get invalidConnections() { return validation.invalidConnections },
    get autoResolveConflicts() { return validation.autoResolveConflicts },
    set autoResolveConflicts(v: boolean) { validation.autoResolveConflicts = v },
    get lastModifiedConnectionId() { return validation.lastModifiedConnectionId },
    set lastModifiedConnectionId(v: string | null) { validation.lastModifiedConnectionId = v },
    get rootMerges() { return validation.rootMerges },

    // --- Composite operations ---
    addPipe,
    addJoint,
    removePipe,
    removeJoint,
    removeConnection,
    updatePipe,
    addConnection,
    updateConnection,
    updateClampedHoleIndex,
    clearAll,
    loadFromStructure,

    // --- Graph operations (pass-through) ---
    syncRootPipeIds: () => graph.syncRootPipeIds(),
    buildConnectedComponents: () => graph.buildConnectedComponents(),
    getDefaultRootPipeIds: () => graph.getDefaultRootPipeIds(),

    // --- Scene operations (pass-through) ---
    calculateWorldPosition: () => scene.calculateWorldPosition(),
    updateObjectPosition: (id: string, position: [number, number, number]) => scene.updateObjectPosition(id, position),
    updateObjectRotation: (id: string, rotation: [number, number, number]) => scene.updateObjectRotation(id, rotation),
    getObjectPosition: (id: string) => scene.getObjectPosition(id),
    getObjectRotation: (id: string) => scene.getObjectRotation(id),
    getPipeJointRelationship: (pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway') =>
      scene.getPipeJointRelationship(pipeId, jointId, holeId, connectionType),

    // --- Simulation operations (pass-through) ---
    toggleSimulationMode: () => simulation.toggleSimulationMode(),
    enterSimulationMode: () => simulation.enterSimulationMode(),
    exitSimulationMode: () => simulation.exitSimulationMode(),
    initSimulationState: (jointId: string, type: Parameters<typeof simulation.initSimulationState>[1]) =>
      simulation.initSimulationState(jointId, type),
    setSimulationAngle: (jointId: string, angle: number) => simulation.setSimulationAngle(jointId, angle),
    setSpinAngle: (jointId: string, spinAngle: number) => simulation.setSpinAngle(jointId, spinAngle),
    setAttached: (jointId: string, attached: boolean) => simulation.setAttached(jointId, attached),
    resetSimulationStates: () => simulation.resetSimulationStates(),

    // --- Validation operations (pass-through) ---
    validateConnections: () => validation.validateConnections(),
    scheduleValidation: () => validation.scheduleValidation(),
    resolveByDisconnect: (connectionId: string) => validation.resolveByDisconnect(connectionId),
    resolveByRemoveRoot: (pipeId: string) => validation.resolveByRemoveRoot(pipeId),
    resolveByUpdatePosition: (connectionId: string) => validation.resolveByUpdatePosition(connectionId),
    resolveByRotationFix: (connectionId: string, newRotation: number) => validation.resolveByRotationFix(connectionId, newRotation),
    resolveByLengthFix: (pipeId: string, newLength: number) => validation.resolveByLengthFix(pipeId, newLength),
  }
}
