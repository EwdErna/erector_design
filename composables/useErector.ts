import { Quaternion, Vector3 } from 'three'
import { useErectorGraph } from '~/stores/ErectorGraph'
import { useErectorScene } from '~/stores/ErectorScene'
import { useErectorValidation } from '~/stores/ErectorValidation'
import { useErectorSimulation } from '~/stores/ErectorSimulation'
import { useErectorHistory } from '~/stores/ErectorHistory'
import type { HistorySnapshot } from '~/stores/ErectorHistory'
import type { ErectorJointHole, ErectorPipe, ErectorPipeConnection } from '~/types/erector_component'
import erectorComponentDefinition from '~/data/erector_component.json'
import { getMovableDefForJoint } from '~/utils/Erector/erectorComponentDefinition'

let _isRestoring = false

function _lookupJointDef(name: string): { category: string, holes: ErectorJointHole[] } | null {
  for (const cat of erectorComponentDefinition.pla_joints.categories) {
    const typeDef = (cat.types as { name: string, joints?: { to: [number, number, number], start?: [number, number, number], through?: boolean }[] }[]).find(t => t.name === name)
    if (typeDef?.joints) {
      return {
        category: cat.name,
        holes: typeDef.joints.map(j => ({
          type: j.through !== true ? 'FIX' as const : 'THROUGH' as const,
          dir: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3().fromArray(j.to)),
          offset: new Vector3().fromArray(j.start ?? [0, 0, 0]),
        })),
      }
    }
  }
  return null
}

/**
 * useErector — 3ストアをまとめるファサード composable。
 * 既存の useErectorPipeJoint() と同じ API を提供する。
 */
export function useErector() {
  const graph = useErectorGraph()
  const scene = useErectorScene()
  const validation = useErectorValidation()
  const simulation = useErectorSimulation()
  const history = useErectorHistory()

  // ----------------------------------------------------------------
  // Undo / Redo
  // ----------------------------------------------------------------

  function takeSnapshot(): HistorySnapshot {
    return {
      pipes: graph.pipes.map(p => ({
        id: p.id,
        diameter: p.diameter,
        length: p.length,
        connections: {
          start: p.connections.start ? { ...p.connections.start } : undefined,
          end: p.connections.end ? { ...p.connections.end } : undefined,
          midway: p.connections.midway.map(c => ({ ...c })),
        },
      })),
      joints: graph.joints.map(j => ({
        id: j.id,
        name: j.name,
        ...(typeof j.clampedHoleIndex === 'number' ? { clampedHoleIndex: j.clampedHoleIndex } : {}),
      })),
      rootPipeIds: [...graph.rootPipeIds],
      rootTransforms: graph.rootPipeIds.flatMap(id => {
        const obj = scene.instances.find(i => i.id === id)?.obj
        if (!obj) return []
        return [{ id, position: [obj.position.x, obj.position.y, obj.position.z] as [number, number, number], rotation: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w] as [number, number, number, number] }]
      }),
    }
  }

  function pushHistory() {
    if (_isRestoring) return
    history.record(takeSnapshot())
  }

  function _applySnapshot(snapshot: HistorySnapshot) {
    _isRestoring = true
    try {
      const currentPipeIds = new Set(graph.pipes.map(p => p.id))
      const currentJointIds = new Set(graph.joints.map(j => j.id))
      const snapshotPipeIds = new Set(snapshot.pipes.map(p => p.id))
      const snapshotJointIds = new Set(snapshot.joints.map(j => j.id))

      // Remove joints not in snapshot (graph.removeJoint also nulls their connections in pipes)
      for (const id of currentJointIds) {
        if (snapshotJointIds.has(id)) continue
        for (const pipe of graph.pipes) {
          if (pipe.connections.start?.jointId === id)
            scene.removeConnectionRelationship(pipe.id, id, pipe.connections.start.holeId, 'start')
          if (pipe.connections.end?.jointId === id)
            scene.removeConnectionRelationship(pipe.id, id, pipe.connections.end.holeId, 'end')
          for (const conn of pipe.connections.midway)
            if (conn.jointId === id) scene.removeConnectionRelationship(pipe.id, id, conn.holeId, 'midway')
        }
        graph.removeJoint(id)
        scene.removeObject(id)
      }

      // Remove pipes not in snapshot
      for (const id of currentPipeIds) {
        if (snapshotPipeIds.has(id)) continue
        const pipe = graph.pipes.find(p => p.id === id)
        if (pipe) {
          if (pipe.connections.start)
            scene.removeConnectionRelationship(id, pipe.connections.start.jointId, pipe.connections.start.holeId, 'start')
          if (pipe.connections.end)
            scene.removeConnectionRelationship(id, pipe.connections.end.jointId, pipe.connections.end.holeId, 'end')
          for (const conn of pipe.connections.midway)
            scene.removeConnectionRelationship(id, conn.jointId, conn.holeId, 'midway')
        }
        graph.removePipe(id)
        scene.removeObject(id)
      }

      // Add joints present in snapshot but not in scene
      for (const sj of snapshot.joints) {
        if (currentJointIds.has(sj.id)) continue
        const def = _lookupJointDef(sj.name)
        if (!def) continue
        graph.addJoint(sj.name, def.holes, sj.id)
        scene.addJointObject(sj.id, sj.name, def.category, def.holes)
      }

      // Add pipes present in snapshot but not in scene
      for (const sp of snapshot.pipes) {
        if (!currentPipeIds.has(sp.id)) {
          graph.addPipe(sp.diameter, sp.length, sp.id)
          scene.addPipeObject(sp.id, sp.diameter, sp.length)
        }
      }

      // Restore graph data (pipes + connections + rootPipeIds); joint holes stay as-is
      // snapshot.pipes may be Pinia-reactive at this point, so avoid structuredClone and spread manually
      graph.restoreState(
        snapshot.pipes.map(p => ({
          id: p.id,
          diameter: p.diameter,
          length: p.length,
          connections: {
            start: p.connections.start ? { ...p.connections.start } : undefined,
            end: p.connections.end ? { ...p.connections.end } : undefined,
            midway: p.connections.midway.map((c: ErectorPipeConnection) => ({ ...c })),
          },
        })),
        snapshot.joints.map(j => ({ id: j.id, clampedHoleIndex: j.clampedHoleIndex })),
        [...snapshot.rootPipeIds],
      )

      // Update pipe geometries for pipes that existed before (new ones already have correct geometry)
      for (const sp of snapshot.pipes) {
        if (currentPipeIds.has(sp.id)) scene.updatePipeGeometry(sp.id, sp.length, sp.diameter)
      }

      // Apply root transforms (stored as quaternion xyzw)
      for (const rt of snapshot.rootTransforms) {
        const instance = scene.instances.find(i => i.id === rt.id)
        if (!instance?.obj) continue
        instance.obj.position.set(rt.position[0], rt.position[1], rt.position[2])
        instance.obj.quaternion.set(rt.rotation[0], rt.rotation[1], rt.rotation[2], rt.rotation[3])
      }

      scene.clearPjRelMap()
      // Defer validation until after the next calculateWorldPosition() frame so that
      // Three.js world positions reflect the restored state before validation runs.
      requestAnimationFrame(() => validation.validateConnections())
    } finally {
      _isRestoring = false
    }
  }

  function undo() {
    if (_isRestoring) return
    const target = history.undoPop()
    if (!target) return
    const current = takeSnapshot()
    _applySnapshot(target)
    history.pushFuture(current)
  }

  function redo() {
    if (_isRestoring) return
    const target = history.redoPop()
    if (!target) return
    const current = takeSnapshot()
    _applySnapshot(target)
    history.pushPast(current)
  }

  // ----------------------------------------------------------------
  // High-level composite operations
  // ----------------------------------------------------------------

  function addPipe(diameter: number, length: number, id?: string): string {
    if (!_isRestoring) pushHistory()
    const resolvedId = graph.addPipe(diameter, length, id)
    scene.addPipeObject(resolvedId, diameter, length)
    return resolvedId
  }

  function addJoint(name: string, category: string, holes: ErectorJointHole[], id?: string): string {
    if (!_isRestoring) pushHistory()
    const resolvedId = graph.addJoint(name, holes, id)
    scene.addJointObject(resolvedId, name, category, holes)
    return resolvedId
  }

  function removePipe(pipeId: string) {
    if (!_isRestoring) pushHistory()
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
    if (!_isRestoring) pushHistory()
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
    if (!_isRestoring) pushHistory()
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
    if (!_isRestoring) pushHistory()
    graph.addConnection(pipeId, jointId, holeId, side, rotation, position, id, reverse)
  }

  function updateConnection(id: string, connectionToUpdate: Partial<ErectorPipeConnection>) {
    graph.updateConnection(id, connectionToUpdate)
    scene.markDirty()
    validation.lastModifiedConnectionId = id
    validation.scheduleValidation()
  }

  function clearAll() {
    if (!_isRestoring) pushHistory()
    scene.clear()
    graph.clear()
    validation.clear()
    simulation.clear()
  }

  function updateClampedHoleIndex(jointId: string, index: number) {
    if (!_isRestoring) pushHistory()
    graph.updateClampedHoleIndex(jointId, index)
  }

  function loadFromStructure(structure: { pipes: ErectorPipe[], joints: { id: string, name: string, clampedHoleIndex?: number }[], rootTransforms?: { pipeId: string, position: [number, number, number], rotation: [number, number, number] }[] }) {
    // clearAll() already calls pushHistory() inside, so no duplicate push needed
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

  function findCoAxisJointIds(drivingJointId: string): string[] {
    const drivingJoint = graph.joints.find(j => j.id === drivingJointId)
    if (!drivingJoint) return []
    const movableDef = getMovableDefForJoint(drivingJoint.name)
    if (movableDef?.type !== 'free_rotation') return []
    const nonClampedIdx = 1 - (drivingJoint.clampedHoleIndex ?? 0)
    const orbitAxisPipe = graph.pipes.find(p =>
      p.connections.midway.some(c => c.jointId === drivingJointId && c.holeId === nonClampedIdx)
    )
    if (!orbitAxisPipe) return []
    const result: string[] = []
    for (const conn of orbitAxisPipe.connections.midway) {
      if (conn.jointId === drivingJointId) continue
      const otherJoint = graph.joints.find(j => j.id === conn.jointId)
      if (!otherJoint) continue
      const otherMovableDef = getMovableDefForJoint(otherJoint.name)
      if (otherMovableDef?.type !== 'free_rotation') continue
      const otherNonClampedIdx = 1 - (otherJoint.clampedHoleIndex ?? 0)
      if (conn.holeId !== otherNonClampedIdx) continue
      result.push(conn.jointId)
    }
    return result
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

    // --- History operations ---
    pushHistory,
    undo,
    redo,
    get canUndo() { return history.canUndo },
    get canRedo() { return history.canRedo },

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
    markDirty: () => scene.markDirty(),
    calculateWorldPosition: () => scene.calculateWorldPosition(),
    updateObjectPosition: (id: string, position: [number, number, number]) => scene.updateObjectPosition(id, position),
    updateObjectRotation: (id: string, rotation: [number, number, number]) => scene.updateObjectRotation(id, rotation),
    getObjectPosition: (id: string) => scene.getObjectPosition(id),
    getObjectRotation: (id: string) => scene.getObjectRotation(id),
    getPipeJointRelationship: (pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway') =>
      scene.getPipeJointRelationship(pipeId, jointId, holeId, connectionType),
    getPipeJointRelationshipArray: () => scene.getPipeJointRelationshipArray(),

    // --- Simulation operations (pass-through) ---
    toggleSimulationMode: () => {
      if (simulation.isSimulationMode) {
        simulation.exitSimulationMode()
        scene.restoreRootTransforms()
      } else {
        scene.saveRootTransforms()
        simulation.enterSimulationMode()
      }
    },
    enterSimulationMode: () => {
      scene.saveRootTransforms()
      simulation.enterSimulationMode()
    },
    exitSimulationMode: () => {
      simulation.exitSimulationMode()
      scene.restoreRootTransforms()
    },
    initSimulationState: (jointId: string, type: Parameters<typeof simulation.initSimulationState>[1]) =>
      simulation.initSimulationState(jointId, type),
    setSimulationAngle: (jointId: string, angle: number) => {
      simulation.setSimulationAngle(jointId, angle)
      scene.markDirty()
    },
    setSpinAngle: (jointId: string, spinAngle: number) => {
      simulation.setSpinAngle(jointId, spinAngle)
      for (const coJointId of findCoAxisJointIds(jointId)) {
        simulation.initSimulationState(coJointId, 'free_rotation')
        simulation.setSpinAngle(coJointId, spinAngle)
      }
      scene.markDirty()
    },
    setOrbitAngle: (jointId: string, orbitAngle: number) => {
      simulation.setOrbitAngle(jointId, orbitAngle)
      for (const coJointId of findCoAxisJointIds(jointId)) {
        simulation.initSimulationState(coJointId, 'free_rotation')
        simulation.setOrbitAngle(coJointId, orbitAngle)
      }
      scene.markDirty()
    },
    setAttached: (jointId: string, attached: boolean) => {
      simulation.setAttached(jointId, attached)
      scene.markDirty()
    },
    resetSimulationStates: () => {
      simulation.resetSimulationStates()
      scene.markDirty()
    },

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
