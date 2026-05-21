import { defineStore } from 'pinia'
import { Euler, Mesh, Quaternion, Vector3, MeshPhongMaterial, Object3D, BufferGeometry, ArrowHelper } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import type { ErectorComponent, ErectorJoint, ErectorJointHole, JointMovableDefinition } from '~/types/erector_component'
import { genPipe } from '~/utils/Erector/pipe'
import { degreesToRadians, radiansToDegrees, roundAngleDegrees } from '~/utils/angleUtils'
import { useErectorGraph, clampMidwayPosition, type PipeJointRelationship } from '~/stores/ErectorGraph'
import { useErectorSimulation } from '~/stores/ErectorSimulation'
import erectorComponentDefinitionRaw from '~/data/erector_component.json'

const erectorComponentDef = erectorComponentDefinitionRaw as unknown as ErectorComponent

function getMovableDefForJoint(name: string): JointMovableDefinition | undefined {
  const allTypes = [
    ...erectorComponentDef.pla_joints.categories.flatMap(c => c.types),
    ...erectorComponentDef.metal_joints,
  ]
  return (allTypes.find(t => t.name === name) as any)?.movable
}

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

export const useErectorScene = defineStore('erectorScene', {
  state: () => ({
    instances: [] as { id: string, obj?: Object3D, movablePart?: Object3D }[],
    renderCount: 0,
    pipeJointRelationships: [] as PipeJointRelationship[],
    debugArrows: [] as ArrowHelper[],
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
      const loader = new GLTFLoader()
      const { x, y, z } = three.orbitTarget
      const spawnPos = new Vector3(x, y, z)
      loader.load(`/models/${category}/erector_component-${name}.gltf`, (gltf) => {
        const model = gltf.scene
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
      })
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
      this.pipeJointRelationships = this.pipeJointRelationships.filter(rel =>
        !(rel.pipeId === pipeId && rel.jointId === jointId && rel.holeId === holeId && rel.connectionType === connectionType)
      )
      this.pipeJointRelationships.push({ pipeId, jointId, holeId, connectionType, relationshipType })
    },

    getPipeJointRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway'): 'j2p' | 'p2j' | null {
      const rel = this.pipeJointRelationships.find(r =>
        r.pipeId === pipeId && r.jointId === jointId && r.holeId === holeId && r.connectionType === connectionType
      )
      return rel?.relationshipType ?? null
    },

    removeConnectionRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway') {
      this.pipeJointRelationships = this.pipeJointRelationships.filter(rel =>
        !(rel.pipeId === pipeId && rel.jointId === jointId && rel.holeId === holeId && rel.connectionType === connectionType)
      )
    },

    calculateWorldPosition() {
      const graph = useErectorGraph()
      const simulation = useErectorSimulation()
      const updated: string[] = []
      const nextUpdate: string[] = []
      const pipes = graph.pipes
      const joints = graph.joints
      const instances = this.instances
      this.renderCount++
      const isSimMode = simulation.isSimulationMode

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
        const joint = joints.find(j => j.id === instance.id)
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
        const joint = joints.find(j => j.id === jointId)
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

      function isConnectionDetached(jointId: string, holeId: number): boolean {
        if (!isSimMode) return false
        const simState = simulation.simulationStates[jointId]
        if (simState?.type !== 'detachable' || simState.attached !== false) return false
        const joint = joints.find(j => j.id === jointId)
        if (!joint) return false
        const movableDef = getMovableDefForJoint(joint.name)
        if (movableDef?.type !== 'detachable') return false
        return holeId === movableDef.detachableHoleIndex
      }

      const updatePipeJointRelationshipMethod = this.updatePipeJointRelationship

      function update(updated: string[], pipe: typeof pipes[number], pipeTransform: transform, updatePipeJointRelationship: typeof updatePipeJointRelationshipMethod) {
        if (!updated.includes(pipe.id)) {
          const start = pipe.connections.start
          const end = pipe.connections.end
          if (start && updated.includes(start.jointId) && !isConnectionDetached(start.jointId, start.holeId)) {
            const joint = joints.find(joint => joint.id === start.jointId)
            const jointInstance = instances.find(i => i.id === start.jointId)?.obj
            if (joint && jointInstance) {
              const hole = getEffectiveHoles(joint)[start.holeId]
              if (hole) {
                updated.push(pipe.id)
                updatePipeJointRelationship(pipe.id, start.jointId, start.holeId, 'start', 'j2p')
                const effectiveRotation = getEffectiveConnRotation(start.rotation, start.holeId, start.jointId)
                const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(effectiveRotation))))
                pipeTransform.position.set(...position.toArray())
                pipeTransform.rotation.set(...rotation.toArray())
              }
            }
          }
          else if (end && updated.includes(end.jointId) && !isConnectionDetached(end.jointId, end.holeId)) {
            const joint = joints.find(joint => joint.id === end.jointId)
            const jointInstance = instances.find(i => i.id === end.jointId)?.obj
            if (joint && jointInstance) {
              const hole = getEffectiveHoles(joint)[end.holeId]
              if (hole) {
                updated.push(pipe.id)
                updatePipeJointRelationship(pipe.id, end.jointId, end.holeId, 'end', 'j2p')
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
              updated.includes(conn.jointId) && !isConnectionDetached(conn.jointId, conn.holeId)
            )
            if (midway) {
              const joint = joints.find(joint => joint.id === midway.jointId)
              const jointInstance = instances.find(i => i.id === midway.jointId)?.obj
              if (joint && jointInstance) {
                const hole = getEffectiveHoles(joint)[midway.holeId]
                if (hole) {
                  updated.push(pipe.id)
                  updatePipeJointRelationship(pipe.id, midway.jointId, midway.holeId, 'midway', 'j2p')
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
          if (!updated.includes(pipe.id)) {
            return
          }
        }
        if (updated.includes(pipe.id)) {
          const nextIndex = nextUpdate.indexOf(pipe.id)
          if (nextIndex !== -1) {
            nextUpdate.splice(nextIndex, 1)
          }
          if (pipe.connections.start && !isConnectionDetached(pipe.connections.start.jointId, pipe.connections.start.holeId)) {
            const start = pipe.connections.start
            const joint = joints.find(joint => joint.id === start.jointId)
            if (joint) {
              getEffectiveHoles(joint).forEach((_hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) ||
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) ||
                    p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index)
                  ) && !updated.includes(p.id) && !nextUpdate.includes(p.id)
                )
                if (next_start) {
                  nextUpdate.push(next_start.id)
                }
              })
              const hole = getEffectiveHoles(joint)[start.holeId]
              if (!updated.includes(pipe.connections.start.jointId)) {
                updated.push(pipe.connections.start.jointId)
                updatePipeJointRelationship(pipe.id, start.jointId, start.holeId, 'start', 'p2j')
                if (hole) {
                  const pipeZRot = new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(start.rotation)))
                  const invertedHoleDir = hole.dir.clone().multiply(pipeZRot).invert()
                  const rotation = pipeTransform.rotation.clone().multiply(invertedHoleDir)
                  const rotatedHoleOffset = hole.offset.clone().applyQuaternion(rotation)
                  const position = pipeTransform.position.clone().add(rotatedHoleOffset.clone().negate())
                  const target = instances.find(i => i.id === joint.id)?.obj
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          }
          if (pipe.connections.end && !isConnectionDetached(pipe.connections.end.jointId, pipe.connections.end.holeId)) {
            const end = pipe.connections.end
            const joint = joints.find(joint => joint.id === end.jointId)
            if (joint) {
              getEffectiveHoles(joint).forEach((_hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) ||
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) ||
                    p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index)
                  ) && !updated.includes(p.id) && !nextUpdate.includes(p.id)
                )
                if (next_start) {
                  nextUpdate.push(next_start.id)
                }
              })
              const hole = getEffectiveHoles(joint)[end.holeId]
              if (!updated.includes(pipe.connections.end.jointId)) {
                updated.push(pipe.connections.end.jointId)
                updatePipeJointRelationship(pipe.id, end.jointId, end.holeId, 'end', 'p2j')
                if (hole) {
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(new Quaternion().setFromEuler(new Euler(0, Math.PI, 0))
                      .multiply(hole.dir.clone()
                        .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(end.rotation)))).invert()))
                  const position = pipeTransform.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(pipe.length)).add(hole.offset.clone().negate().applyQuaternion(rotation))
                  const target = instances.find(i => i.id === joint.id)?.obj
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          }
          pipe.connections.midway.forEach(conn => {
            if (isConnectionDetached(conn.jointId, conn.holeId)) return
            const joint = joints.find(joint => joint.id === conn.jointId)
            if (joint) {
              getEffectiveHoles(joint).forEach((_hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) ||
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) ||
                    p.connections.midway.some(c => c.jointId === joint.id && c.holeId === index)
                  ) && !updated.includes(p.id) && !nextUpdate.includes(p.id)
                )
                if (next_start) {
                  nextUpdate.push(next_start.id)
                }
              })
              const hole = getEffectiveHoles(joint)[conn.holeId]
              if (!updated.includes(conn.jointId)) {
                updated.push(conn.jointId)
                updatePipeJointRelationship(pipe.id, conn.jointId, conn.holeId, 'midway', 'p2j')
                if (hole && hole.type === 'THROUGH') {
                  const flipQ = conn.reverse
                    ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(hole.dir), Math.PI)
                    : new Quaternion()
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(flipQ.clone().multiply(hole.dir.clone()
                      .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(conn.rotation))))).invert())
                  const position = pipeTransform.position.clone()
                    .add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(clampMidwayPosition(conn.position, pipe.length)))
                    .add(hole.offset.clone().negate().applyQuaternion(rotation))
                  const target = instances.find(i => i.id === joint.id)?.obj
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          })
        }
      }

      return (rootTransforms: transform[]) => {
        const updatedSet = new Set(updated)
        rootTransforms.forEach(rootTransform => {
          const root = pipes.find(pipe => pipe.id === rootTransform.id)
          if (!root) return
          const rootObject = instances.find(i => i.id === rootTransform.id)?.obj
          rootObject?.position.set(...rootTransform.position.toArray())
          rootObject?.quaternion.copy(rootTransform.rotation)
          if (!updatedSet.has(root.id)) {
            updated.push(root.id)
            updatedSet.add(root.id)
          }
          if (!nextUpdate.includes(root.id)) {
            nextUpdate.push(root.id)
          }
        })
        while (nextUpdate.length > 0) {
          const pipeId = nextUpdate.shift()
          if (!pipeId) continue
          const pipe = pipes.find(pipe => pipe.id === pipeId)
          if (!pipe) continue
          const pipeObject = instances.find(i => i.id === pipeId)?.obj
          if (!pipeObject) continue
          const updatedTransform: transform = {
            id: pipe.id,
            position: pipeObject.position,
            rotation: pipeObject.quaternion
          }
          update(updated, pipe, updatedTransform, updatePipeJointRelationshipMethod)
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
      this.pipeJointRelationships = []
      this.renderCount = 0
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
