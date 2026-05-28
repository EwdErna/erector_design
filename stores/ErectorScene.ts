import { defineStore } from 'pinia'
import { Euler, Mesh, Quaternion, Vector3, MeshPhongMaterial, Object3D, BufferGeometry, ArrowHelper } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import type { ErectorJoint, ErectorJointHole } from '~/types/erector_component'
import { genPipe } from '~/utils/Erector/pipe'
import { degreesToRadians, radiansToDegrees, roundAngleDegrees } from '~/utils/angleUtils'
import { useErectorGraph, clampMidwayPosition, type PipeJointRelationship } from '~/stores/ErectorGraph'
import { useErectorSimulation } from '~/stores/ErectorSimulation'
import { getMovableDefForJoint } from '~/utils/Erector/erectorComponentDefinition'

function computePivotHoles(joint: ErectorJoint, pivotCenter: [number, number, number], pivotAxis: [number, number, number], rotatingHoles: number[], angle: number): ErectorJointHole[] {
  const center = new Vector3(...pivotCenter)
  const axis = new Vector3(...pivotAxis).normalize()
  const q = new Quaternion().setFromAxisAngle(axis, angle)
  return joint.holes.map((hole, i) => {
    if (!rotatingHoles.includes(i)) return hole
    const newOffset = center.clone().add(hole.offset.clone().sub(center).applyQuaternion(q))
    const newDir = q.clone().multiply(hole.dir)
    return { ...hole, offset: newOffset, dir: newDir }
  })
}

export type transform = { id: string, position: Vector3, rotation: Quaternion }

type InvalidConnectionForViz = {
  id: string
  position: { actual: Vector3; expected: Vector3 }
  rotation: { actual: Vector3; expected: Vector3 }
  right: { actual: Vector3; expected: Vector3 }
}

const _gltfLoader = new GLTFLoader()
const _gltfCache = new Map<string, Object3D>()

// Non-reactive module-scope store for pipeJointRelationships.
// Kept outside Pinia state to prevent Vue reactivity from firing every frame
// when calculateWorldPosition() rewrites all relationships.
const _pjRelMap = new Map<string, PipeJointRelationship>()

function pjRelKey(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway'): string {
  return `${pipeId}|${jointId}|${holeId}|${connectionType}`
}

export const useErectorScene = defineStore('erectorScene', {
  state: () => ({
    instances: [] as { id: string, obj?: Object3D, movablePart?: Object3D }[],
    debugArrows: [] as ArrowHelper[],
    savedRootTransforms: [] as { id: string, position: Vector3, rotation: Quaternion }[],
  }),
  actions: {
    addPipeObject(id: string, diameter: number, length: number) {
      const three = useThree()
      if (!three.scene) return
      if (this.instances.some(i => i.id === id)) return
      const pipeModel = genPipe(length, diameter)
      const pipeObject = new Object3D()
      const pipeMesh = new Mesh(pipeModel, new MeshPhongMaterial())
      pipeObject.name = id
      pipeObject.add(pipeMesh)
      const { x, y, z } = three.orbitTarget
      pipeObject.position.set(x, y, z)
      this.instances.push({ id, obj: pipeObject })
      three.scene.add(pipeObject)
    },

    addJointObject(id: string, name: string, category: string, holes: ErectorJointHole[]) {
      const three = useThree()
      if (!three.scene) return
      if (this.instances.some(i => i.id === id)) return
      const { x, y, z } = three.orbitTarget
      const spawnPos = new Vector3(x, y, z)
      const url = `/models/${category}/erector_component-${name}.gltf`

      const applyModel = (source: Object3D) => {
        const model = source.clone(true)
        model.traverse((child) => {
          if (child instanceof Mesh) {
            child.material = new MeshPhongMaterial()
          }
        })
        model.name = id
        model.position.copy(spawnPos)
        const movablePart = model.getObjectByName('Move') ?? undefined
        this.instances.push({ id, obj: model, movablePart })
        if (three.scene) {
          three.scene.add(model)
        }
      }

      const cached = _gltfCache.get(url)
      if (cached) {
        applyModel(cached)
      } else {
        _gltfLoader.load(url, (gltf) => {
          _gltfCache.set(url, gltf.scene)
          applyModel(gltf.scene)
        })
      }
    },

    removeObject(id: string) {
      const three = useThree()
      const instanceIndex = this.instances.findIndex(i => i.id === id)
      if (instanceIndex !== -1) {
        const instance = this.instances[instanceIndex]
        if (instance.obj && three.scene) {
          three.scene.remove(instance.obj)
          instance.obj.traverse((child) => {
            if (child instanceof Mesh) {
              if (child.geometry) child.geometry.dispose()
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach(m => m.dispose())
                } else {
                  child.material.dispose()
                }
              }
            }
          })
        }
        this.instances.splice(instanceIndex, 1)
      }
    },

    updatePipeGeometry(id: string, length: number, diameter: number) {
      const obj = this.instances.find(i => i.id === id)?.obj
      if (!obj) return
      obj.traverse(v => {
        if (v instanceof Mesh && v.geometry instanceof BufferGeometry) {
          v.geometry.dispose()
          v.geometry = genPipe(length, diameter)
          v.geometry.needsUpdate = true
        }
      })
    },

    updateObjectPosition(id: string, position: [number, number, number]) {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) return
      instance.obj.position.set(...position)
    },

    updateObjectRotation(id: string, rotation: [number, number, number]) {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) return
      instance.obj.rotation.set(
        degreesToRadians(rotation[0]),
        degreesToRadians(rotation[1]),
        degreesToRadians(rotation[2])
      )
    },

    getObjectPosition(id: string): [number, number, number] | undefined {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) return undefined
      return [instance.obj.position.x, instance.obj.position.y, instance.obj.position.z]
    },

    getObjectRotation(id: string): [number, number, number] | undefined {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) return undefined
      return [
        roundAngleDegrees(radiansToDegrees(instance.obj.rotation.x)),
        roundAngleDegrees(radiansToDegrees(instance.obj.rotation.y)),
        roundAngleDegrees(radiansToDegrees(instance.obj.rotation.z))
      ]
    },

    updatePipeJointRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway', relationshipType: 'j2p' | 'p2j') {
      _pjRelMap.set(pjRelKey(pipeId, jointId, holeId, connectionType), { pipeId, jointId, holeId, connectionType, relationshipType })
    },

    getPipeJointRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway'): 'j2p' | 'p2j' | null {
      return _pjRelMap.get(pjRelKey(pipeId, jointId, holeId, connectionType))?.relationshipType ?? null
    },

    getPipeJointRelationshipArray(): PipeJointRelationship[] {
      return [..._pjRelMap.values()]
    },

    removeConnectionRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway') {
      _pjRelMap.delete(pjRelKey(pipeId, jointId, holeId, connectionType))
    },

    calculateWorldPosition() {
      const graph = useErectorGraph()
      const simulation = useErectorSimulation()
      const updatedSet = new Set<string>()
      const nextUpdate: string[] = []
      const nextUpdateSet = new Set<string>()
      const pipes = graph.pipes
      const joints = graph.joints
      const instances = this.instances
      const isSimMode = simulation.isSimulationMode

      // Build O(1) lookup maps once per call instead of repeated .find() per operation
      const instanceMap = new Map(instances.map(i => [i.id, i]))
      const pipeMap = new Map(pipes.map(p => [p.id, p]))
      const jointMap = new Map(joints.map(j => [j.id, j]))

      function setRel(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway', relationshipType: 'j2p' | 'p2j') {
        _pjRelMap.set(pjRelKey(pipeId, jointId, holeId, connectionType), { pipeId, jointId, holeId, connectionType, relationshipType })
      }

      // Precompute simulation-modified holes for pivot joints
      const simulatedHoles = new Map<string, ErectorJointHole[]>()
      if (isSimMode) {
        for (const joint of joints) {
          const simState = simulation.simulationStates[joint.id]
          if (!simState || simState.type !== 'pivot') continue
          const movableDef = getMovableDefForJoint(joint.name)
          if (movableDef?.type === 'pivot') {
            simulatedHoles.set(joint.id, computePivotHoles(joint, movableDef.pivotCenter, movableDef.pivotAxis, movableDef.rotatingHoles, simState.angle))
          }
        }
      }

      // Update visual rotation of the "Move" child node for pivot joints
      for (const instance of instances) {
        if (!instance.movablePart) continue
        const joint = jointMap.get(instance.id)
        if (!joint) continue
        const movableDef = getMovableDefForJoint(joint.name)
        if (movableDef?.type !== 'pivot') continue
        const simState = isSimMode ? simulation.simulationStates[joint.id] : undefined
        const angle = simState?.type === 'pivot' ? simState.angle : 0
        instance.movablePart.quaternion.setFromAxisAngle(new Vector3(...movableDef.pivotAxis), angle)
      }

      function getEffectiveHoles(joint: ErectorJoint): ErectorJointHole[] {
        return simulatedHoles.get(joint.id) ?? joint.holes
      }

      function getEffectiveConnRotation(connRotation: number, holeId: number, jointId: string): number {
        if (!isSimMode) return connRotation
        const simState = simulation.simulationStates[jointId]
        if (simState?.type !== 'free_rotation') return connRotation
        const joint = jointMap.get(jointId)
        if (!joint) return connRotation
        const movableDef = getMovableDefForJoint(joint.name)
        if (movableDef?.type !== 'free_rotation') return connRotation
        const clampedIdx = joint.clampedHoleIndex ?? 0
        const nonClampedIdx = 1 - clampedIdx
        if (holeId === nonClampedIdx) {
          return connRotation + radiansToDegrees(simState.spinAngle)
        }
        return connRotation
      }

      function getP2JEffectiveConnRotation(connRotation: number, holeId: number, jointId: string): number {
        if (!isSimMode) return connRotation
        const simState = simulation.simulationStates[jointId]
        if (simState?.type !== 'free_rotation') return connRotation
        const joint = jointMap.get(jointId)
        if (!joint) return connRotation
        const movableDef = getMovableDefForJoint(joint.name)
        if (movableDef?.type !== 'free_rotation') return connRotation
        const nonClampedIdx = 1 - (joint.clampedHoleIndex ?? 0)
        if (holeId === nonClampedIdx) {
          return connRotation - radiansToDegrees(simState.orbitAngle)
        }
        return connRotation
      }

      // excludeJointId を除いたグラフで BFS し、currentRoots のどれかから targetPipeId に到達できる root ID を返す
      function findRootAncestorExcludingJoint(
        targetPipeId: string,
        excludeJointId: string,
        currentRoots: transform[]
      ): string | null {
        const visited = new Set<string>()
        const queue: Array<{ pipeId: string; rootId: string }> =
          currentRoots.map(rt => ({ pipeId: rt.id, rootId: rt.id }))
        while (queue.length > 0) {
          const item = queue.shift()!
          if (visited.has(item.pipeId)) continue
          visited.add(item.pipeId)
          if (item.pipeId === targetPipeId) return item.rootId
          const pipe = pipeMap.get(item.pipeId)
          if (!pipe) continue
          const adjacentJointIds = new Set<string>()
          if (pipe.connections.start?.jointId && pipe.connections.start.jointId !== excludeJointId)
            adjacentJointIds.add(pipe.connections.start.jointId)
          if (pipe.connections.end?.jointId && pipe.connections.end.jointId !== excludeJointId)
            adjacentJointIds.add(pipe.connections.end.jointId)
          pipe.connections.midway
            .filter(m => m.jointId !== excludeJointId)
            .forEach(m => adjacentJointIds.add(m.jointId))
          for (const jointId of adjacentJointIds) {
            for (const otherPipe of pipes) {
              if (visited.has(otherPipe.id)) continue
              if (
                otherPipe.connections.start?.jointId === jointId ||
                otherPipe.connections.end?.jointId === jointId ||
                otherPipe.connections.midway.some(m => m.jointId === jointId)
              ) {
                queue.push({ pipeId: otherPipe.id, rootId: item.rootId })
              }
            }
          }
        }
        return null
      }

      function isConnectionDetached(jointId: string, holeId: number): boolean {
        if (!isSimMode) return false
        const simState = simulation.simulationStates[jointId]
        if (simState?.type !== 'detachable' || simState.attached !== false) return false
        const joint = jointMap.get(jointId)
        if (!joint) return false
        const movableDef = getMovableDefForJoint(joint.name)
        if (movableDef?.type !== 'detachable') return false
        return holeId === movableDef.detachableHoleIndex
      }

      function isCoAxisSpinWaiting(jointId: string, currentPipeId: string): boolean {
        if (!isSimMode) return false
        const joint = jointMap.get(jointId)
        if (!joint) return false
        const movableDef = getMovableDefForJoint(joint.name)
        if (movableDef?.type !== 'free_rotation') return false
        const clampedIdx = joint.clampedHoleIndex ?? 0
        const nonClampedIdx = 1 - clampedIdx
        const currentPipe = pipeMap.get(currentPipeId)
        const isCurrentPipeClamped = currentPipe?.connections.midway.some(
          c => c.jointId === jointId && c.holeId === clampedIdx
        ) ?? false
        if (!isCurrentPipeClamped) return false
        const nonClampedPipe = pipes.find(p =>
          p.connections.midway.some(c => c.jointId === jointId && c.holeId === nonClampedIdx)
        )
        if (!nonClampedPipe) return false
        for (const conn of nonClampedPipe.connections.midway) {
          if (conn.jointId === jointId) continue
          const otherJoint = jointMap.get(conn.jointId)
          if (!otherJoint) continue
          const otherMovableDef = getMovableDefForJoint(otherJoint.name)
          if (otherMovableDef?.type !== 'free_rotation') continue
          const otherNonClampedIdx = 1 - (otherJoint.clampedHoleIndex ?? 0)
          if (conn.holeId !== otherNonClampedIdx) continue
          const otherSimState = simulation.simulationStates[otherJoint.id]
          if (otherSimState?.type === 'free_rotation' && Math.abs(otherSimState.spinAngle) > 1e-10) return true
        }
        return false
      }

      function update(pipe: typeof pipes[number], pipeTransform: transform) {
        if (!updatedSet.has(pipe.id)) {
          const start = pipe.connections.start
          const end = pipe.connections.end
          if (start && updatedSet.has(start.jointId) && !isConnectionDetached(start.jointId, start.holeId)) {
            const joint = jointMap.get(start.jointId)
            const jointInstance = instanceMap.get(start.jointId)?.obj
            if (joint && jointInstance) {
              const hole = getEffectiveHoles(joint)[start.holeId]
              if (hole) {
                updatedSet.add(pipe.id)
                setRel(pipe.id, start.jointId, start.holeId, 'start', 'j2p')
                const effectiveRotation = getEffectiveConnRotation(start.rotation, start.holeId, start.jointId)
                const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(effectiveRotation))))
                pipeTransform.position.set(...position.toArray())
                pipeTransform.rotation.set(...rotation.toArray())
              }
            }
          }
          else if (end && updatedSet.has(end.jointId) && !isConnectionDetached(end.jointId, end.holeId)) {
            const joint = jointMap.get(end.jointId)
            const jointInstance = instanceMap.get(end.jointId)?.obj
            if (joint && jointInstance) {
              const hole = getEffectiveHoles(joint)[end.holeId]
              if (hole) {
                updatedSet.add(pipe.id)
                setRel(pipe.id, end.jointId, end.holeId, 'end', 'j2p')
                const effectiveRotation = getEffectiveConnRotation(end.rotation, end.holeId, end.jointId)
                const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(effectiveRotation))))
                pipeTransform.position.set(...position.toArray())
                pipeTransform.rotation.set(...rotation.toArray())
              }
            }
          }
          else {
            const midway = pipe.connections.midway.find(conn =>
              updatedSet.has(conn.jointId) && !isConnectionDetached(conn.jointId, conn.holeId)
            )
            if (midway) {
              const joint = jointMap.get(midway.jointId)
              const jointInstance = instanceMap.get(midway.jointId)?.obj
              if (joint && jointInstance) {
                const hole = getEffectiveHoles(joint)[midway.holeId]
                if (hole) {
                  updatedSet.add(pipe.id)
                  setRel(pipe.id, midway.jointId, midway.holeId, 'midway', 'j2p')
                  const effectiveRotation = getEffectiveConnRotation(midway.rotation, midway.holeId, midway.jointId)
                  const flipQ = midway.reverse
                    ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(hole.dir), Math.PI)
                    : new Quaternion()
                  const rotation = jointInstance.quaternion.clone()
                    .multiply(flipQ.clone().multiply(hole.dir.clone()
                      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(effectiveRotation)))))
                  const pipeDirection = new Vector3(0, 0, 1).applyQuaternion(rotation)
                  const distanceFromStart = clampMidwayPosition(midway.position ?? 0, pipe.length)
                  const holeWorldPosition = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                  const position = holeWorldPosition.clone().sub(pipeDirection.clone().multiplyScalar(distanceFromStart))
                  pipeTransform.position.set(...position.toArray())
                  pipeTransform.rotation.set(...rotation.toArray())
                }
              }
            }
          }
          if (!updatedSet.has(pipe.id)) {
            return
          }
        }
        if (updatedSet.has(pipe.id)) {
          if (pipe.connections.start && !isConnectionDetached(pipe.connections.start.jointId, pipe.connections.start.holeId)) {
            const start = pipe.connections.start
            const joint = jointMap.get(start.jointId)
            if (joint) {
              getEffectiveHoles(joint).forEach((_hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) ||
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) ||
                    p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index)
                  ) && !updatedSet.has(p.id) && !nextUpdateSet.has(p.id)
                )
                if (next_start) {
                  nextUpdate.push(next_start.id)
                  nextUpdateSet.add(next_start.id)
                }
              })
              const hole = getEffectiveHoles(joint)[start.holeId]
              if (!updatedSet.has(pipe.connections.start.jointId)) {
                updatedSet.add(pipe.connections.start.jointId)
                setRel(pipe.id, start.jointId, start.holeId, 'start', 'p2j')
                if (hole) {
                  const pipeZRot = new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(start.rotation)))
                  const invertedHoleDir = hole.dir.clone().multiply(pipeZRot).invert()
                  const rotation = pipeTransform.rotation.clone().multiply(invertedHoleDir)
                  const rotatedHoleOffset = hole.offset.clone().applyQuaternion(rotation)
                  const position = pipeTransform.position.clone().add(rotatedHoleOffset.clone().negate())
                  const target = instanceMap.get(joint.id)?.obj
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          }
          if (pipe.connections.end && !isConnectionDetached(pipe.connections.end.jointId, pipe.connections.end.holeId)) {
            const end = pipe.connections.end
            const joint = jointMap.get(end.jointId)
            if (joint) {
              getEffectiveHoles(joint).forEach((_hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) ||
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) ||
                    p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index)
                  ) && !updatedSet.has(p.id) && !nextUpdateSet.has(p.id)
                )
                if (next_start) {
                  nextUpdate.push(next_start.id)
                  nextUpdateSet.add(next_start.id)
                }
              })
              const hole = getEffectiveHoles(joint)[end.holeId]
              if (!updatedSet.has(pipe.connections.end.jointId)) {
                updatedSet.add(pipe.connections.end.jointId)
                setRel(pipe.id, end.jointId, end.holeId, 'end', 'p2j')
                if (hole) {
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(new Quaternion().setFromEuler(new Euler(0, Math.PI, 0))
                      .multiply(hole.dir.clone()
                        .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(end.rotation)))).invert()))
                  const position = pipeTransform.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(pipe.length)).add(hole.offset.clone().negate().applyQuaternion(rotation))
                  const target = instanceMap.get(joint.id)?.obj
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          }
          pipe.connections.midway.forEach(conn => {
            if (isConnectionDetached(conn.jointId, conn.holeId)) return
            const joint = jointMap.get(conn.jointId)
            if (joint) {
              getEffectiveHoles(joint).forEach((_hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) ||
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) ||
                    p.connections.midway.some(c => c.jointId === joint.id && c.holeId === index)
                  ) && !updatedSet.has(p.id) && !nextUpdateSet.has(p.id)
                )
                if (next_start) {
                  nextUpdate.push(next_start.id)
                  nextUpdateSet.add(next_start.id)
                }
              })
              const hole = getEffectiveHoles(joint)[conn.holeId]
              if (!updatedSet.has(conn.jointId) && !isCoAxisSpinWaiting(conn.jointId, pipe.id)) {
                updatedSet.add(conn.jointId)
                setRel(pipe.id, conn.jointId, conn.holeId, 'midway', 'p2j')
                if (hole && hole.type === 'THROUGH') {
                  const flipQ = conn.reverse
                    ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(hole.dir), Math.PI)
                    : new Quaternion()
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(flipQ.clone().multiply(hole.dir.clone()
                      .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(getP2JEffectiveConnRotation(conn.rotation, conn.holeId, conn.jointId)))))).invert())
                  const position = pipeTransform.position.clone()
                    .add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(clampMidwayPosition(conn.position, pipe.length)))
                    .add(hole.offset.clone().negate().applyQuaternion(rotation))
                  const target = instanceMap.get(joint.id)?.obj
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          })
        }
      }

      return (rootTransforms: transform[]) => {
        // root swap: free_rotation ジョイントのシミュレーション用 BFS ルート差し替え
        let effectiveRoots = rootTransforms
        if (isSimMode) {
          const filteredRoots = [...rootTransforms]
          const addedRoots: transform[] = []
          let swapped = false
          const orbitSwappedJoints = new Set<string>()

          // orbit swap: 固定穴パイプが root 連鎖にある場合に非固定穴パイプへ root を swap
          for (const joint of joints) {
            const simState = simulation.simulationStates[joint.id]
            if (simState?.type !== 'free_rotation' || Math.abs(simState.orbitAngle) < 1e-10) continue
            const movableDef = getMovableDefForJoint(joint.name)
            if (movableDef?.type !== 'free_rotation') continue
            const clampedIdx = joint.clampedHoleIndex ?? 0
            const nonClampedIdx = 1 - clampedIdx
            const clampedPipe = pipes.find(p =>
              p.connections.midway.some(c => c.jointId === joint.id && c.holeId === clampedIdx)
            )
            const nonClampedPipe = pipes.find(p =>
              p.connections.midway.some(c => c.jointId === joint.id && c.holeId === nonClampedIdx)
            )
            if (!clampedPipe || !nonClampedPipe) continue
            let clampedRootIdx = filteredRoots.findIndex(rt => rt.id === clampedPipe.id)
            if (clampedRootIdx === -1) {
              // clampedPipe 自体は root でないが root 連鎖に属する場合: 祖先 root を特定してスワップ
              const ancestorRootId = findRootAncestorExcludingJoint(clampedPipe.id, joint.id, filteredRoots)
              if (!ancestorRootId) continue
              clampedRootIdx = filteredRoots.findIndex(rt => rt.id === ancestorRootId)
              if (clampedRootIdx === -1) continue
            }
            const nonClampedObj = instanceMap.get(nonClampedPipe.id)?.obj
            if (!nonClampedObj) continue
            filteredRoots.splice(clampedRootIdx, 1)
            if (!filteredRoots.some(rt => rt.id === nonClampedPipe.id) && !addedRoots.some(rt => rt.id === nonClampedPipe.id)) {
              addedRoots.push({
                id: nonClampedPipe.id,
                position: nonClampedObj.position.clone(),
                rotation: nonClampedObj.quaternion.clone(),
              })
            }
            orbitSwappedJoints.add(joint.id)
            swapped = true
          }

          // spin swap: 非固定穴パイプが root 連鎖にある場合に固定穴パイプへ root を swap
          for (const joint of joints) {
            if (orbitSwappedJoints.has(joint.id)) continue
            const simState = simulation.simulationStates[joint.id]
            if (simState?.type !== 'free_rotation' || Math.abs(simState.spinAngle) < 1e-10) continue
            const movableDef = getMovableDefForJoint(joint.name)
            if (movableDef?.type !== 'free_rotation') continue
            const clampedIdx = joint.clampedHoleIndex ?? 0
            const nonClampedIdx = 1 - clampedIdx
            const clampedPipe = pipes.find(p =>
              p.connections.midway.some(c => c.jointId === joint.id && c.holeId === clampedIdx)
            )
            const nonClampedPipe = pipes.find(p =>
              p.connections.midway.some(c => c.jointId === joint.id && c.holeId === nonClampedIdx)
            )
            if (!clampedPipe || !nonClampedPipe) continue
            let nonClampedRootIdx = filteredRoots.findIndex(rt => rt.id === nonClampedPipe.id)
            if (nonClampedRootIdx === -1) {
              // nonClampedPipe 自体は root でないが root 連鎖に属する場合: 祖先 root を特定してスワップ
              const ancestorRootId = findRootAncestorExcludingJoint(nonClampedPipe.id, joint.id, filteredRoots)
              if (!ancestorRootId) continue
              nonClampedRootIdx = filteredRoots.findIndex(rt => rt.id === ancestorRootId)
              if (nonClampedRootIdx === -1) continue
            }
            const clampedObj = instanceMap.get(clampedPipe.id)?.obj
            if (!clampedObj) continue
            filteredRoots.splice(nonClampedRootIdx, 1)
            if (!filteredRoots.some(rt => rt.id === clampedPipe.id) && !addedRoots.some(rt => rt.id === clampedPipe.id)) {
              addedRoots.push({
                id: clampedPipe.id,
                position: clampedObj.position.clone(),
                rotation: clampedObj.quaternion.clone(),
              })
            }
            swapped = true
          }

          if (swapped) effectiveRoots = [...filteredRoots, ...addedRoots]
        }

        effectiveRoots.forEach(rootTransform => {
          const root = pipeMap.get(rootTransform.id)
          if (!root) return
          const rootObject = instanceMap.get(rootTransform.id)?.obj
          rootObject?.position.set(...rootTransform.position.toArray())
          rootObject?.quaternion.copy(rootTransform.rotation)
          updatedSet.add(root.id)
          if (!nextUpdateSet.has(root.id)) {
            nextUpdate.push(root.id)
            nextUpdateSet.add(root.id)
          }
        })
        while (nextUpdate.length > 0) {
          const pipeId = nextUpdate.shift()
          if (!pipeId) continue
          nextUpdateSet.delete(pipeId)
          const pipe = pipeMap.get(pipeId)
          if (!pipe) continue
          const pipeObject = instanceMap.get(pipeId)?.obj
          if (!pipeObject) continue
          const updatedTransform: transform = {
            id: pipe.id,
            position: pipeObject.position,
            rotation: pipeObject.quaternion
          }
          update(pipe, updatedTransform)
        }
      }
    },

    clearDebugArrows() {
      const three = useThree()
      if (!three.scene) return
      this.debugArrows.forEach(arrow => {
        if (three.scene) {
          three.scene.remove(arrow)
        }
        arrow.dispose()
      })
      this.debugArrows = []
    },

    visualizeInvalidConnections(invalidConnections: InvalidConnectionForViz[]) {
      const three = useThree()
      if (!three.scene) return
      this.clearDebugArrows()
      invalidConnections.forEach(invalidConn => {
        if (!three.scene) return
        const actualPosArrow = new ArrowHelper(
          invalidConn.rotation.actual.clone().normalize(),
          invalidConn.position.actual,
          0.5, 0x0000ff, 0.1, 0.05
        )
        actualPosArrow.name = `debug-actual-pos-${invalidConn.id}`
        three.scene.add(actualPosArrow)
        this.debugArrows.push(actualPosArrow)

        const expectedPosArrow = new ArrowHelper(
          invalidConn.rotation.expected.clone().normalize(),
          invalidConn.position.expected,
          0.5, 0xccccff, 0.1, 0.05
        )
        expectedPosArrow.name = `debug-expected-pos-${invalidConn.id}`
        three.scene.add(expectedPosArrow)
        this.debugArrows.push(expectedPosArrow)

        const actualRightArrow = new ArrowHelper(
          invalidConn.right.actual.clone().normalize(),
          invalidConn.position.actual,
          0.5, 0xff0000, 0.1, 0.05
        )
        actualRightArrow.name = `debug-actual-right-${invalidConn.id}`
        three.scene.add(actualRightArrow)
        this.debugArrows.push(actualRightArrow)

        const expectedRightArrow = new ArrowHelper(
          invalidConn.right.expected.clone().normalize(),
          invalidConn.position.expected,
          0.5, 0xffcccc, 0.1, 0.05
        )
        expectedRightArrow.name = `debug-expected-right-${invalidConn.id}`
        three.scene.add(expectedRightArrow)
        this.debugArrows.push(expectedRightArrow)
      })
    },

    clear() {
      const three = useThree()
      if (three.scene) {
        this.instances.forEach(instance => {
          if (instance.obj && three.scene) {
            three.scene.remove(instance.obj)
            instance.obj.traverse((child) => {
              if (child instanceof Mesh) {
                if (child.geometry) child.geometry.dispose()
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose())
                  } else {
                    child.material.dispose()
                  }
                }
              }
            })
          }
        })
      }
      this.clearDebugArrows()
      this.instances = []
      _pjRelMap.clear()
      this.savedRootTransforms = []
    },

    saveRootTransforms() {
      const graph = useErectorGraph()
      this.savedRootTransforms = graph.rootPipeIds.flatMap(id => {
        const obj = this.instances.find(i => i.id === id)?.obj
        if (!obj) return []
        return [{ id, position: obj.position.clone(), rotation: obj.quaternion.clone() }]
      })
    },

    restoreRootTransforms() {
      this.savedRootTransforms.forEach(saved => {
        const obj = this.instances.find(i => i.id === saved.id)?.obj
        if (!obj) return
        obj.position.copy(saved.position)
        obj.quaternion.copy(saved.rotation)
      })
    },
  },
  getters: {
    instanceObjectMap(): Map<string, Object3D | undefined> {
      return new Map(this.instances.map(instance => [instance.id, instance.obj]))
    },
    rootPipeObjects(): Object3D[] {
      const graph = useErectorGraph()
      return graph.rootPipeIds
        .map(id => this.instanceObjectMap.get(id))
        .filter((obj): obj is Object3D => obj !== undefined)
    },
  }
})
