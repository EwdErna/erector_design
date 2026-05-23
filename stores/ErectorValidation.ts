import { defineStore } from 'pinia'
import { Quaternion, Vector3, Object3D } from 'three'
import type { ErectorPipe, ErectorPipeConnection } from '~/types/erector_component'
import { degreesToRadians, radiansToDegrees, roundAngleDegrees, normalizeAngle180 } from '~/utils/angleUtils'
import { useErectorGraph, clampMidwayPosition, type PipeJointRelationship, type RootMerge } from '~/stores/ErectorGraph'
import { useErectorScene } from '~/stores/ErectorScene'

type RotationFix = {
  connectionId: string
  pipeId: string
  side: 'start' | 'end' | 'midway'
  currentRotation: number
  newRotation: number
}

type LengthFix = {
  pipeId: string
  currentLength: number
  newLength: number
}

export type InvalidConnection = {
  id: string
  pipeId: string
  jointId: string
  holeId: number
  side: 'start' | 'end' | 'midway'
  position: {
    actual: Vector3
    expected: Vector3
    diff: number
  }
  rotation: {
    actual: Vector3
    expected: Vector3
    diff: number
  }
  right: {
    actual: Vector3
    expected: Vector3
    diff: number
  }
  conflictType?: 'constraint'
  conflictingConnectionId?: string
  conflictingSide?: 'start' | 'end' | 'midway'
  rotationFixes?: RotationFix[]
  rightFix?: RotationFix
  lengthFixes?: LengthFix[]
}

// validateConnections のスケジューリング用（ドラッグ中の連続呼び出しをデバウンス）
let _validationPendingId: number | null = null

type ConnectionReference = { connectionId: string; pipeId: string; side: 'start' | 'end' | 'midway' }

function getAllConnectionsToJoint(pipes: ErectorPipe[], jointId: string): ConnectionReference[] {
  const result: ConnectionReference[] = []
  for (const pipe of pipes) {
    if (pipe.connections.start?.jointId === jointId) {
      result.push({ connectionId: pipe.connections.start.id, pipeId: pipe.id, side: 'start' })
    }
    if (pipe.connections.end?.jointId === jointId) {
      result.push({ connectionId: pipe.connections.end.id, pipeId: pipe.id, side: 'end' })
    }
    for (const conn of pipe.connections.midway) {
      if (conn.jointId === jointId) {
        result.push({ connectionId: conn.id, pipeId: pipe.id, side: 'midway' })
      }
    }
  }
  return result
}

function isReachableExcludingPipe(
  fromJointId: string,
  targetJointId: string,
  excludePipeId: string,
  pipes: ErectorPipe[]
): boolean {
  if (fromJointId === targetJointId) return true
  const visitedJoints = new Set<string>([fromJointId])
  const visitedPipes = new Set<string>([excludePipeId])
  const queue: string[] = [fromJointId]

  while (queue.length > 0) {
    const currentJointId = queue.shift()!
    for (const pipe of pipes) {
      if (visitedPipes.has(pipe.id)) continue
      const touches =
        pipe.connections.start?.jointId === currentJointId ||
        pipe.connections.end?.jointId === currentJointId ||
        pipe.connections.midway.some(c => c.jointId === currentJointId)
      if (!touches) continue
      visitedPipes.add(pipe.id)
      const neighbors = [
        pipe.connections.start?.jointId,
        pipe.connections.end?.jointId,
        ...pipe.connections.midway.map(c => c.jointId)
      ].filter((id): id is string => !!id)
      for (const jId of neighbors) {
        if (jId === targetJointId) return true
        if (!visitedJoints.has(jId)) {
          visitedJoints.add(jId)
          queue.push(jId)
        }
      }
    }
  }
  return false
}

function isReachableDirected(
  fromJointId: string,
  targetJointId: string,
  pipes: ErectorPipe[],
  pipeJointRelationships: PipeJointRelationship[]
): boolean {
  if (fromJointId === targetJointId) return true
  const visitedJoints = new Set<string>([fromJointId])
  const queue: string[] = [fromJointId]

  while (queue.length > 0) {
    const currentJointId = queue.shift()!
    const drivenPipeIds = pipeJointRelationships
      .filter(r => r.jointId === currentJointId && r.relationshipType === 'j2p')
      .map(r => r.pipeId)

    for (const pipeId of drivenPipeIds) {
      const pipe = pipes.find(p => p.id === pipeId)
      if (!pipe) continue

      const j2pAnchors = new Set(
        pipeJointRelationships
          .filter(r => r.pipeId === pipeId && r.relationshipType === 'j2p')
          .map(r => r.jointId)
      )

      const movableJointIds = [
        pipe.connections.start?.jointId,
        pipe.connections.end?.jointId,
        ...pipe.connections.midway.map(c => c.jointId)
      ].filter((id): id is string => !!id && !j2pAnchors.has(id))

      for (const jointId of movableJointIds) {
        if (jointId === targetJointId) return true
        if (!visitedJoints.has(jointId)) {
          visitedJoints.add(jointId)
          queue.push(jointId)
        }
      }
    }
  }
  return false
}

function computeRotationFixes(
  error: InvalidConnection,
  pipes: ErectorPipe[],
  instances: { id: string; obj?: Object3D }[]
): RotationFix[] {
  if (error.position.diff <= 0.001) return []
  const RADIUS_TOLERANCE = 0.005
  const fixes: RotationFix[] = []
  const actual = error.position.actual
  const expected = error.position.expected

  for (const pipe of pipes) {
    const pipeObj = instances.find(i => i.id === pipe.id)?.obj
    if (!pipeObj) continue
    const axis = new Vector3(0, 0, 1).applyQuaternion(pipeObj.quaternion)

    const toA = actual.clone().sub(pipeObj.position)
    const toE = expected.clone().sub(pipeObj.position)
    const aPerp = toA.clone().sub(axis.clone().multiplyScalar(toA.dot(axis)))
    const ePerp = toE.clone().sub(axis.clone().multiplyScalar(toE.dot(axis)))

    if (Math.abs(aPerp.length() - ePerp.length()) > RADIUS_TOLERANCE) continue
    if (aPerp.length() < 0.001) continue

    const cross = aPerp.clone().cross(ePerp)
    const crossLen = cross.length()
    const dot = aPerp.dot(ePerp)
    let θDeg: number
    if (crossLen < 1e-4 && dot < 0) {
      θDeg = 180
    } else if (crossLen < 1e-4) {
      continue
    } else {
      θDeg = Math.sign(cross.dot(axis)) * radiansToDegrees(aPerp.angleTo(ePerp))
    }

    const allConns: Array<{ conn: ErectorPipeConnection; side: 'start' | 'end' | 'midway' }> = []
    if (pipe.connections.start) allConns.push({ conn: pipe.connections.start, side: 'start' })
    if (pipe.connections.end) allConns.push({ conn: pipe.connections.end, side: 'end' })
    pipe.connections.midway.forEach(c => allConns.push({ conn: c, side: 'midway' }))

    for (const { conn, side } of allConns) {
      if (conn.jointId === error.jointId) continue
      if (!isReachableExcludingPipe(conn.jointId, error.jointId, pipe.id, pipes)) continue
      fixes.push({
        connectionId: conn.id,
        pipeId: pipe.id,
        side,
        currentRotation: conn.rotation,
        newRotation: normalizeAngle180(roundAngleDegrees(conn.rotation + θDeg))
      })
    }
  }
  return fixes
}

function computeRightFix(
  error: InvalidConnection,
  pipes: ErectorPipe[],
  instances: { id: string; obj?: Object3D }[]
): RotationFix | undefined {
  if (error.right.diff <= 0.001) return undefined
  const pipe = pipes.find(p =>
    p.connections.start?.id === error.id ||
    p.connections.end?.id === error.id ||
    p.connections.midway.some(c => c.id === error.id)
  )
  if (!pipe) return undefined
  const pipeObj = instances.find(i => i.id === pipe.id)?.obj
  if (!pipeObj) return undefined

  const actual = error.right.actual
  const pipeQuat = pipeObj.quaternion
  const pipeForward = new Vector3(0, 0, 1).applyQuaternion(pipeQuat)

  let r_rad: number
  let conn: ErectorPipeConnection | undefined

  if (error.side === 'end') {
    conn = pipe.connections.end
    const baseEnd = new Vector3(-1, 0, 0).applyQuaternion(pipeQuat)
    r_rad = Math.atan2(baseEnd.clone().cross(actual).dot(pipeForward), baseEnd.dot(actual))
  } else {
    conn = error.side === 'start'
      ? pipe.connections.start
      : pipe.connections.midway.find(c => c.id === error.id)
    const base = new Vector3(1, 0, 0).applyQuaternion(pipeQuat)
    r_rad = Math.atan2(actual.clone().cross(base).dot(pipeForward), actual.dot(base))
  }
  if (!conn) return undefined

  return {
    connectionId: error.id,
    pipeId: pipe.id,
    side: error.side,
    currentRotation: conn.rotation,
    newRotation: roundAngleDegrees(radiansToDegrees(r_rad))
  }
}

function computeLengthFixes(
  error: InvalidConnection,
  pipes: ErectorPipe[],
  instances: { id: string; obj?: Object3D }[],
  pipeJointRelationships: PipeJointRelationship[]
): LengthFix[] {
  if (error.position.diff <= 0.001) return []
  const diff = error.position.expected.clone().sub(error.position.actual)
  const diffNorm = diff.clone().normalize()
  const fixes: LengthFix[] = []

  for (const pipe of pipes) {
    const pipeObj = instances.find(i => i.id === pipe.id)?.obj
    if (!pipeObj) continue
    const forward = new Vector3(0, 0, 1).applyQuaternion(pipeObj.quaternion)

    if (Math.abs(forward.dot(diffNorm)) < 0.999) continue

    const movingViaEnd = pipeJointRelationships.some(r =>
      r.pipeId === pipe.id && r.connectionType === 'end' && r.relationshipType === 'j2p'
    )

    const startingJointId = movingViaEnd
      ? pipe.connections.start?.jointId
      : pipe.connections.end?.jointId
    if (!startingJointId) continue

    if (!isReachableDirected(startingJointId, error.jointId, pipes, pipeJointRelationships)) continue

    const isIndirect = startingJointId !== error.jointId
    const deltaLength = (movingViaEnd !== isIndirect) ? -forward.dot(diff) : forward.dot(diff)

    const newLength = pipe.length + deltaLength
    if (newLength < 0.1) continue

    fixes.push({ pipeId: pipe.id, currentLength: pipe.length, newLength })
  }
  return fixes
}

export const useErectorValidation = defineStore('erectorValidation', {
  state: () => ({
    invalidConnections: [] as InvalidConnection[],
    autoResolveConflicts: false as boolean,
    lastModifiedConnectionId: null as string | null,
    rootMerges: [] as RootMerge[],
  }),
  actions: {
    scheduleValidation() {
      if (_validationPendingId !== null) {
        cancelAnimationFrame(_validationPendingId)
      }
      _validationPendingId = requestAnimationFrame(() => {
        _validationPendingId = null
        this.validateConnections()
      })
    },

    validateConnections() {
      const graph = useErectorGraph()
      const scene = useErectorScene()
      const errors: InvalidConnection[] = []

      graph.pipes.forEach(pipe => {
        if (pipe.connections.start) {
          const conn = pipe.connections.start
          const joint = graph.joints.find(j => j.id === conn.jointId)
          if (joint && joint.holes[pipe.connections.start.holeId]) {
            const hole = joint.holes[pipe.connections.start.holeId]
            const jointInstance = scene.instances.find(i => i.id === conn.jointId)?.obj
            const pipeInstance = scene.instances.find(i => i.id === pipe.id)?.obj
            if (jointInstance && pipeInstance) {
              const actualHolePos = jointInstance.position.clone()
                .add(hole.offset.clone().applyQuaternion(jointInstance.quaternion.clone()))
              const expectedHolePos = pipeInstance.position.clone()
              const holePosDiff = actualHolePos.distanceTo(expectedHolePos)

              const actualHoleDir = new Vector3(0, 0, 1).applyQuaternion(jointInstance.quaternion.clone().multiply(hole.dir))
              const expectedHoleDir = new Vector3(0, 0, 1).applyQuaternion(pipeInstance.quaternion)
              const holeDirDiff = actualHoleDir.angleTo(expectedHoleDir)
              const actualHoleRight = new Vector3(1, 0, 0).applyQuaternion(jointInstance.quaternion.clone().multiply(hole.dir))
              const expectedHoleRight = new Vector3(1, 0, 0).applyQuaternion(pipeInstance.quaternion.clone()
                .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(-conn.rotation))))
              const holeRightDiff = actualHoleRight.angleTo(expectedHoleRight)
              if (holePosDiff > 0.001 || holeDirDiff > 0.001 || holeRightDiff > 0.001) {
                errors.push({
                  side: 'start', id: conn.id, pipeId: pipe.id, jointId: conn.jointId, holeId: conn.holeId,
                  position: { actual: actualHolePos, expected: expectedHolePos, diff: holePosDiff },
                  rotation: { actual: actualHoleDir, expected: expectedHoleDir, diff: holeDirDiff },
                  right: { actual: actualHoleRight, expected: expectedHoleRight, diff: holeRightDiff }
                })
              }
            }
          }
        }
        if (pipe.connections.end) {
          const conn = pipe.connections.end
          const joint = graph.joints.find(j => j.id === conn.jointId)
          if (joint && joint.holes[pipe.connections.end.holeId]) {
            const hole = joint.holes[pipe.connections.end.holeId]
            const jointInstance = scene.instances.find(i => i.id === conn.jointId)?.obj
            const pipeInstance = scene.instances.find(i => i.id === pipe.id)?.obj
            if (jointInstance && pipeInstance) {
              const actualHolePos = jointInstance.position.clone()
                .add(hole.offset.clone().applyQuaternion(jointInstance.quaternion.clone()))
              const expectedHolePos = pipeInstance.position.clone()
                .add(new Vector3(0, 0, 1).applyQuaternion(pipeInstance.quaternion).multiplyScalar(pipe.length))
              const holePosDiff = actualHolePos.distanceTo(expectedHolePos)

              const actualHoleDir = new Vector3(0, 0, 1).applyQuaternion(jointInstance.quaternion.clone().multiply(hole.dir))
              const expectedHoleDir = new Vector3(0, 0, -1).applyQuaternion(pipeInstance.quaternion)
              const holeDirDiff = actualHoleDir.angleTo(expectedHoleDir)
              const actualHoleRight = new Vector3(1, 0, 0).applyQuaternion(jointInstance.quaternion.clone().multiply(hole.dir))
              const expectedHoleRight = new Vector3(-1, 0, 0).applyQuaternion(pipeInstance.quaternion.clone()
                .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), degreesToRadians(-conn.rotation))))
              const holeRightDiff = actualHoleRight.angleTo(expectedHoleRight)
              if (holePosDiff > 0.001 || holeDirDiff > 0.001 || holeRightDiff > 0.001) {
                errors.push({
                  side: 'end', id: conn.id, pipeId: pipe.id, jointId: conn.jointId, holeId: conn.holeId,
                  position: { actual: actualHolePos, expected: expectedHolePos, diff: holePosDiff },
                  rotation: { actual: actualHoleDir, expected: expectedHoleDir, diff: holeDirDiff },
                  right: { actual: actualHoleRight, expected: expectedHoleRight, diff: holeRightDiff }
                })
              }
            }
          }
        }
        pipe.connections.midway.forEach(conn => {
          const joint = graph.joints.find(j => j.id === conn.jointId)
          if (joint && joint.holes[conn.holeId]) {
            const hole = joint.holes[conn.holeId]
            const jointInstance = scene.instances.find(i => i.id === conn.jointId)?.obj
            const pipeInstance = scene.instances.find(i => i.id === pipe.id)?.obj
            if (jointInstance && pipeInstance) {
              const actualHolePos = jointInstance.position.clone()
                .add(hole.offset.clone().applyQuaternion(jointInstance.quaternion.clone()))
              const expectedHolePos = pipeInstance.position.clone()
                .add(new Vector3(0, 0, 1).applyQuaternion(pipeInstance.quaternion).multiplyScalar(clampMidwayPosition(conn.position, pipe.length)))
              const holePosDiff = actualHolePos.distanceTo(expectedHolePos)

              const flipQ = conn.reverse
                ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(hole.dir), Math.PI)
                : new Quaternion()
              const actualHoleDir = new Vector3(0, 0, 1)
                .applyQuaternion(jointInstance.quaternion.clone().multiply(flipQ).multiply(hole.dir))
              const expectedHoleDir = new Vector3(0, 0, 1).applyQuaternion(pipeInstance.quaternion)
              const holeDirDiff = actualHoleDir.angleTo(expectedHoleDir)
              const actualHoleRight = new Vector3(1, 0, 0)
                .applyQuaternion(jointInstance.quaternion.clone().multiply(flipQ).multiply(hole.dir))
              const expectedHoleRight = new Vector3(1, 0, 0).applyQuaternion(pipeInstance.quaternion.clone()
                .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(-conn.rotation))))
              const holeRightDiff = actualHoleRight.angleTo(expectedHoleRight)
              if (holePosDiff > 0.001 || holeDirDiff > 0.001 || holeRightDiff > 0.001) {
                errors.push({
                  side: 'midway', id: conn.id, pipeId: pipe.id, jointId: conn.jointId, holeId: conn.holeId,
                  position: { actual: actualHolePos, expected: expectedHolePos, diff: holePosDiff },
                  rotation: { actual: actualHoleDir, expected: expectedHoleDir, diff: holeDirDiff },
                  right: { actual: actualHoleRight, expected: expectedHoleRight, diff: holeRightDiff }
                })
              }
            }
          }
        })
      })

      // 競合検出
      errors.forEach(error => {
        const otherConns = getAllConnectionsToJoint(graph.pipes, error.jointId)
          .filter(c => c.connectionId !== error.id)
        if (otherConns.length > 0) {
          error.conflictType = 'constraint'
          error.conflictingConnectionId = otherConns[0].connectionId
          error.conflictingSide = otherConns[0].side
        }
      })

      // 修正候補を計算
      errors.forEach(error => {
        error.rotationFixes = computeRotationFixes(error, graph.pipes, scene.instances)
        error.rightFix = computeRightFix(error, graph.pipes, scene.instances)
        error.lengthFixes = computeLengthFixes(error, graph.pipes, scene.instances, scene.getPipeJointRelationshipArray())
      })

      this.invalidConnections = errors

      // 自動解決モードが有効な場合
      if (this.autoResolveConflicts) {
        errors.filter(e => e.conflictType === 'constraint').forEach(error => {
          if (this.lastModifiedConnectionId === error.id) {
            if (error.conflictingSide === 'midway' && error.conflictingConnectionId) {
              this.resolveByUpdatePosition(error.conflictingConnectionId)
            }
          } else {
            if (error.side === 'midway') {
              this.resolveByUpdatePosition(error.id)
            }
          }
        })
      }

      // root merge 検出
      const components = graph.buildConnectedComponents()
      const merges: RootMerge[] = []
      for (const component of components) {
        const roots = component.filter(id => graph.rootPipeIds.includes(id))
        if (roots.length >= 2) {
          merges.push({ mergedRoots: roots, componentPipes: component })
        }
      }
      this.rootMerges = merges

      // デバッグ用: 無効な接続を可視化
      scene.visualizeInvalidConnections(this.invalidConnections)
    },

    resolveByDisconnect(connectionId: string) {
      const graph = useErectorGraph()
      const scene = useErectorScene()

      // Clean up scene relationships before removing from graph
      for (const pipe of graph.pipes) {
        if (pipe.connections.start?.id === connectionId) {
          scene.removeConnectionRelationship(pipe.id, pipe.connections.start.jointId, pipe.connections.start.holeId, 'start')
          break
        }
        if (pipe.connections.end?.id === connectionId) {
          scene.removeConnectionRelationship(pipe.id, pipe.connections.end.jointId, pipe.connections.end.holeId, 'end')
          break
        }
        const midwayIdx = pipe.connections.midway.findIndex(c => c.id === connectionId)
        if (midwayIdx !== -1) {
          const conn = pipe.connections.midway[midwayIdx]
          scene.removeConnectionRelationship(pipe.id, conn.jointId, conn.holeId, 'midway')
          break
        }
      }

      graph.removeConnection(connectionId)
      this.validateConnections()
    },

    resolveByRemoveRoot(pipeId: string) {
      const graph = useErectorGraph()
      graph.rootPipeIds = graph.rootPipeIds.filter(id => id !== pipeId)
      this.validateConnections()
    },

    resolveByUpdatePosition(connectionId: string) {
      const graph = useErectorGraph()
      const scene = useErectorScene()

      const pipe = graph.pipes.find(p => p.connections.midway.some(c => c.id === connectionId))
      if (!pipe) return
      const conn = pipe.connections.midway.find(c => c.id === connectionId)
      if (!conn) return

      const joint = graph.joints.find(j => j.id === conn.jointId)
      if (!joint) return
      const hole = joint.holes[conn.holeId]
      if (!hole) return

      const jointInstance = scene.instances.find(i => i.id === conn.jointId)?.obj
      const pipeInstance = scene.instances.find(i => i.id === pipe.id)?.obj
      if (!jointInstance || !pipeInstance) return

      const holeWorldPos = jointInstance.position.clone()
        .add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
      const pipeStart = pipeInstance.position.clone()
      const pipeDir = new Vector3(0, 0, 1).applyQuaternion(pipeInstance.quaternion)
      const dist = holeWorldPos.clone().sub(pipeStart).dot(pipeDir)
      const newPosition = clampMidwayPosition(dist, pipe.length)

      graph.updateConnection(connectionId, { position: newPosition })
      this.scheduleValidation()
    },

    resolveByRotationFix(connectionId: string, newRotation: number) {
      useErectorGraph().updateConnection(connectionId, { rotation: newRotation })
      this.scheduleValidation()
    },

    resolveByLengthFix(pipeId: string, newLength: number) {
      const graph = useErectorGraph()
      const scene = useErectorScene()
      graph.updatePipe(pipeId, 'length', newLength)
      const pipe = graph.pipes.find(p => p.id === pipeId)
      if (pipe) scene.updatePipeGeometry(pipeId, pipe.length, pipe.diameter)
      this.validateConnections()
    },

    clear() {
      this.invalidConnections = []
      this.rootMerges = []
      this.lastModifiedConnectionId = null
    },
  }
})
