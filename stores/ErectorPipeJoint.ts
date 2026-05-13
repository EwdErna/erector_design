import { defineStore } from 'pinia'
import { Euler, Mesh, Quaternion, Vector3, MeshPhongMaterial, Object3D, Scene, BufferGeometry, ArrowHelper } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import type { ErectorJoint, ErectorJointHole, ErectorPipe, ErectorPipeConnection } from '~/types/erector_component'
import { genPipe } from '~/utils/Erector/pipe'
import { degreesToRadians, radiansToDegrees, roundAngleDegrees, normalizeAngle180 } from '~/utils/angleUtils'
export type transform = { id: string, position: Vector3, rotation: Quaternion }
import erectorComponentDefinition from '~/data/erector_component.json'
export type PipeJointRelationship = {
  pipeId: string
  jointId: string
  holeId: number
  connectionType: 'start' | 'end' | 'midway'
  relationshipType: 'j2p' | 'p2j' // j2p: joint determines pipe, p2j: pipe determines joint
}

type RotationFix = {
  connectionId: string
  pipeId: string
  side: 'start' | 'end' | 'midway'
  currentRotation: number
  newRotation: number
}

type InvalidConnection = {
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
}

type RootMerge = {
  mergedRoots: string[]    // 同一連結成分に属する root pipe の ID 群（length >= 2）
  componentPipes: string[] // その連結成分に属する全 pipe の ID 群
}

// validateConnections のスケジューリング用（ドラッグ中の連続呼び出しをデバウンス）
let _validationPendingId: number | null = null

type ConnectionReference = { connectionId: string; pipeId: string; side: 'start' | 'end' | 'midway' }

/**
 * 指定ジョイントに接続している全コネクションを返すヘルパー
 */
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

function clampMidwayPosition(position: number, pipeLength: number): number {
  return Math.max(0, Math.min(pipeLength, position))
}

/**
 * fromJointId から undirected BFS で targetJointId に到達できるか判定する。
 * excludePipeId のパイプは通過しない（ループを断ち切り、逆戻りを防ぐ）。
 */
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

/**
 * position 不一致を解消する rotation 変更候補を返す。
 * 各パイプの軸を中心に actual を回転させると expected に一致するか判定し、
 * 一致するパイプ軸上の接続を候補として列挙する。
 */
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
    if (aPerp.length() < 0.001) continue // 軸上の縮退ケース

    const cross = aPerp.clone().cross(ePerp)
    const crossLen = cross.length()
    const dot = aPerp.dot(ePerp)
    let θDeg: number
    if (crossLen < 1e-4 && dot < 0) {
      θDeg = 180 // 180° 反転ケース
    } else if (crossLen < 1e-4) {
      continue // すでに一致、またはゼロベクトル
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

/**
 * right 不一致を解消するために conflicting connection の rotation を変更する候補を返す。
 * 適用対象は conflicting connection 自身（自由度は恣意的に選択）。
 */
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

  // r_rad: actual を r_rad だけ pipeForward 周りに回転させると base になる角度
  // → conn.rotation = r_deg とすれば expectedHoleRight が actual に一致する
  let r_rad: number
  let conn: ErectorPipeConnection | undefined

  if (error.side === 'end') {
    conn = pipe.connections.end
    const baseEnd = new Vector3(-1, 0, 0).applyQuaternion(pipeQuat)
    // end: rotate(baseEnd, r_rad, pipeForward) = actual
    r_rad = Math.atan2(baseEnd.clone().cross(actual).dot(pipeForward), baseEnd.dot(actual))
  } else {
    conn = error.side === 'start'
      ? pipe.connections.start
      : pipe.connections.midway.find(c => c.id === error.id)
    const base = new Vector3(1, 0, 0).applyQuaternion(pipeQuat)
    // start/midway: rotate(actual, r_rad, pipeForward) = base
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

export const useErectorPipeJoint = defineStore('erectorPipeJoint', {
  state: () => ({
    pipes: [] as ErectorPipe[],
    joints: [] as ErectorJoint[],
    instances: [] as { id: string, obj?: Object3D }[],
    renderCount: 0,
    pipeJointRelationships: [] as PipeJointRelationship[],
    invalidConnections: [] as InvalidConnection[],
    rootPipeIds: [] as string[],
    debugArrows: [] as ArrowHelper[], // デバッグ用の矢印オブジェクト
    lastModifiedConnectionId: null as string | null,
    autoResolveConflicts: false as boolean,
    rootMerges: [] as RootMerge[],
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
    addPipe(scene: Scene, diameter: number, length: number, id?: string) {//pipeの存在だけを追加
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
      if (this.instances.some(i => i.id === id)) {
        //既存のpipeを削除
        this.removePipe(id)
      }
      const pipeModel = genPipe(length, diameter)
      const pipeObject = new Object3D()
      const pipeMesh = new Mesh(pipeModel, new MeshPhongMaterial())
      pipeObject.name = id
      pipeObject.add(pipeMesh)
      this.instances.push({ id, obj: pipeObject })
      console.log(pipeObject)
      // TODO: get scene and add pipeObject to it
      scene.add(pipeObject)

      return id
    },
    updatePipe(id: string, key: 'length' | 'diameter', value: number) {
      const pipe = this.pipes.findIndex(p => p.id === id)
      if (pipe < 0) return;
      this.pipes[pipe][key] = value
      if (key === 'length') {
        this.pipes[pipe].connections.midway = this.pipes[pipe].connections.midway.map(conn => ({
          ...conn,
          position: clampMidwayPosition(conn.position, value)
        }))
      }
      const obj = this.instances.find(v => v.id === id)?.obj
      if (!obj) return;
      obj.traverse(v => {
        if (v instanceof Mesh && v.geometry instanceof BufferGeometry) {
          v.geometry.dispose()
          v.geometry = genPipe(this.pipes[pipe].length, this.pipes[pipe].diameter)
          v.geometry.needsUpdate = true
        }
      })

      // 変更を加えたので再validate
      this.validateConnections()
    },
    addJoint(scene: Scene, name: string, category: string, holes: ErectorJointHole[], id?: string) {//jointの存在だけを追加
      const loader = new GLTFLoader() //TODO: use singleton
      if (!id) id = this.newJointId(name)
      this.joints.push({
        id,
        name,
        holes
      })
      if (!this.instances.some(i => i.id === id)) {
        loader.load(`/models/${category}/erector_component-${name}.gltf`, (gltf) => {
          const model = gltf.scene
          model.traverse((child) => {
            if (child instanceof Mesh) {
              child.material = new MeshPhongMaterial()
            }
          })
          model.name = id
          this.instances.push({ id, obj: model })
          // TODO: get scene and add model to it
          scene.add(model)
        })
      }

      return id
    },
    addConnection(pipeId: string, jointId: string, holeId: number, side: "start" | "end" | "midway", rotation?: number, position?: number, id?: string, reverse?: boolean) {//jointの穴にpipeを接続
      const pipe = this.pipes.find(pipe => pipe.id === pipeId)
      const joint = this.joints.find(joint => joint.id === jointId)
      if (!pipe || !joint) return
      const hole = joint.holes[holeId]
      if (!hole) return
      switch (side) {
        case 'start':
        case 'end':
          if (id && pipe.connections[side]?.id === id) {
            //既に接続されてるので無視
            return
          }
          pipe.connections[side] = {
            id: id ?? this.newConnectionId(pipeId),
            jointId,
            holeId,
            rotation: rotation ?? 0,
            position: 0,
          }
          break
        case 'midway':
          //console.log(position)
          if (id && pipe.connections.midway.some(conn => conn.id === id)) {
            //既に接続されてるので無視
            return
          }
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
      //find connection with id 
      const pipe = this.pipes.find(p => p.connections.start?.id === id || p.connections.end?.id === id || p.connections.midway.some(conn => conn.id === id))
      if (!pipe) return
      const connection = pipe.connections.start?.id === id ? 'start' : pipe.connections.end?.id === id ? 'end' : pipe.connections.midway.findIndex(conn => conn.id === id)
      if (connection === -1) return //startでもendでもなく、midwayにも存在しない
      const connectionBeforeUpdate = typeof connection === 'number' ? pipe.connections.midway[connection] : pipe.connections[connection]
      if (!connectionBeforeUpdate) return
      //console.log(`connection: ${connection} toUpdate: ${JSON.stringify(connectionToUpdate)}`)
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

      // 変更を加えたので再validate（ドラッグ中の連続呼び出しを間引く）
      this.lastModifiedConnectionId = id
      this.scheduleValidation()
    },
    removeConnection(id: string) {
      const pipe = this.pipes.find(p => p.connections.start?.id === id || p.connections.end?.id === id || p.connections.midway.some(conn => conn.id === id))
      if (!pipe) return

      if (pipe.connections.start?.id === id) {
        this.removeConnectionRelationship(pipe.id, pipe.connections.start.jointId, pipe.connections.start.holeId, 'start')
        pipe.connections.start = undefined
      }
      else if (pipe.connections.end?.id === id) {
        this.removeConnectionRelationship(pipe.id, pipe.connections.end.jointId, pipe.connections.end.holeId, 'end')
        pipe.connections.end = undefined
      }
      else {
        const index = pipe.connections.midway.findIndex(conn => conn.id === id)
        if (index !== -1) {
          const midwayConn = pipe.connections.midway[index]
          this.removeConnectionRelationship(pipe.id, midwayConn.jointId, midwayConn.holeId, 'midway')
          pipe.connections.midway.splice(index, 1)
        }
      }

    },
    clearAll() {
      const three = useThree()
      if (!three.scene) return;
      const scene = three.scene

      // Remove all instances from the scene
      this.instances.forEach(instance => {
        console.log(`Removing instance with id: ${instance.id}`)
        if (instance.obj) {
          console.log(`Removing object with id: ${instance.id} from scene`)
          scene.remove(instance.obj)
          // Dispose of geometry and materials to free memory
          instance.obj.traverse((child) => {
            console.log(`Disposing child: ${child.name} (${child.type})`)
            if (child instanceof Mesh) {
              if (child.geometry) {
                console.log(`Disposing geometry for child: ${child.name}`)
                child.geometry.dispose()
              }
              if (child.material) {
                console.log(`Disposing material for child: ${child.name}`)
                if (Array.isArray(child.material)) {
                  child.material.forEach(material => material.dispose())
                } else {
                  child.material.dispose()
                }
              }
            }
          })
        }
      })

      // デバッグ矢印もクリア
      this.clearDebugArrows()

      // Clear all data arrays
      this.pipes = []
      this.joints = []
      this.instances = []
      this.pipeJointRelationships = []
      this.renderCount = 0
      this.rootPipeIds = []
    },
    loadFromStructure(structure: { pipes: ErectorPipe[], joints: { id: string, name: string }[], rootTransforms?: { pipeId: string, position: [number, number, number], rotation: [number, number, number] }[] }) {
      // Clear all existing pipes and joints before loading new structure
      this.clearAll()

      const three = useThree()
      if (!three.scene) return;
      const scene = three.scene
      structure.pipes.forEach(pipe => {
        // erectorにpipeを追加
        if (this.pipes.findIndex(p => p.id === pipe.id) === -1) {
          this.addPipe(scene, pipe.diameter, pipe.length, pipe.id)
        }
        // pipeの接続に使うjointを追加
        const jointInstanciate = (conn: ErectorPipeConnection) => {
          if (this.joints.findIndex(j => j.id === conn.jointId) === -1) {
            const joint = structure.joints.find(joint => joint.id === conn.jointId)
            if (!joint) { return }// 接続先のjointがない。よろしくない
            const jointCategoryDefinition = erectorComponentDefinition.pla_joints.categories.find(c => c.types.some(t => t.name === joint.name))
            if (!jointCategoryDefinition) { return }//接続先のjointがない。よろしくない
            const jointDefinition = (jointCategoryDefinition?.types as { name: string, joints?: { to: [number, number, number], start?: [number, number, number], through?: boolean }[] }[]).find(t => t.name === joint.name)
            if (!jointDefinition) { return }//未知のjoint。よろしくない
            if (!jointDefinition.joints) { return }//接続先のjointが定義されていない。TBD
            this.addJoint(scene, joint.name, jointCategoryDefinition.name, jointDefinition.joints.map(j => {
              return {
                type: j.through !== true ? 'FIX' as const : "THROUGH" as const,
                dir: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3().fromArray(j.to)),
                offset: new Vector3().fromArray(j.start ?? [0, 0, 0])
              }
            }), joint.id)
          }
        }
        if (pipe.connections.start) {
          jointInstanciate(pipe.connections.start)
          const startConnection = this.pipes.find(p => p.id === pipe.id)?.connections.start
          if (startConnection) {
            //既に接続済み。BAD STRUCTURE
          } else this.addConnection(pipe.id, pipe.connections.start.jointId, pipe.connections.start.holeId, "start", pipe.connections.start.rotation, pipe.connections.start.position)
        }
        if (pipe.connections.end) {
          jointInstanciate(pipe.connections.end)
          const endConnection = this.pipes.find(p => p.id === pipe.id)?.connections.end
          if (endConnection) {
            //既に接続済み。BAD STRUCTURE
          } else this.addConnection(pipe.id, pipe.connections.end.jointId, pipe.connections.end.holeId, "end", pipe.connections.end.rotation, pipe.connections.end.position)
        } pipe.connections.midway.forEach(conn => {
          jointInstanciate(conn)
          const midwayConnection = this.pipes.find(p => p.id === pipe.id)?.connections.midway
          if (midwayConnection?.find(c => c.jointId === conn.jointId && c.holeId === conn.holeId)) {
            //既に接続済み。BAD STRUCTURE
          } else this.addConnection(pipe.id, conn.jointId, conn.holeId, "midway", conn.rotation, conn.position, undefined, conn.reverse)
        })
      })
      // Apply root transforms if provided
      if (structure.rootTransforms && structure.rootTransforms.length > 0) {
        const rootPipeIds = new Set<string>()
        structure.rootTransforms.forEach(rootTransform => {
          const rootPipe = this.pipes.find(p => p.id === rootTransform.pipeId)
          if (!rootPipe) return
          this.updateObjectPosition(rootTransform.pipeId, rootTransform.position)
          this.updateObjectRotation(rootTransform.pipeId, rootTransform.rotation)
          rootPipeIds.add(rootTransform.pipeId)
        })
        this.rootPipeIds = Array.from(rootPipeIds)
      }
      this.syncRootPipeIds()

      // 変更を加えたので再validate
      this.validateConnections()
    },
    updatePipeJointRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway', relationshipType: 'j2p' | 'p2j') {
      // Remove existing relationship for this specific connection
      this.pipeJointRelationships = this.pipeJointRelationships.filter(rel =>
        !(rel.pipeId === pipeId && rel.jointId === jointId && rel.holeId === holeId && rel.connectionType === connectionType)
      )

      // Add new relationship
      this.pipeJointRelationships.push({
        pipeId,
        jointId,
        holeId,
        connectionType,
        relationshipType
      })
    },

    getPipeJointRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway'): 'j2p' | 'p2j' | null {
      const relationship = this.pipeJointRelationships.find(rel =>
        rel.pipeId === pipeId && rel.jointId === jointId && rel.holeId === holeId && rel.connectionType === connectionType
      )
      return relationship?.relationshipType ?? null
    },

    removeConnectionRelationship(pipeId: string, jointId: string, holeId: number, connectionType: 'start' | 'end' | 'midway') {
      this.pipeJointRelationships = this.pipeJointRelationships.filter(rel =>
        !(rel.pipeId === pipeId && rel.jointId === jointId && rel.holeId === holeId && rel.connectionType === connectionType)
      )
    },

    /**
     * オブジェクトの位置を更新する
     * @param id パイプまたはジョイントのID
     * @param position 新しい位置 [x, y, z]
     */
    updateObjectPosition(id: string, position: [number, number, number]) {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) {
        console.warn(`Object with id ${id} not found or has no 3D object`)
        return
      }

      instance.obj.position.set(...position)

      // 座標変更をログに記録（デバッグ用）
      console.log(`Updated position for ${id}: [${position.join(', ')}]`)
    },

    /**
     * オブジェクトの回転を更新する（度数で指定）
     * @param id パイプまたはジョイントのID
     * @param rotation 新しい回転 [x, y, z] (度数)
     */
    updateObjectRotation(id: string, rotation: [number, number, number]) {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) {
        console.warn(`Object with id ${id} not found or has no 3D object`)
        return
      }

      // 度数をラジアンに変換してから設定
      instance.obj.rotation.set(
        degreesToRadians(rotation[0]),
        degreesToRadians(rotation[1]),
        degreesToRadians(rotation[2])
      )

      // 回転変更をログに記録（デバッグ用）
      console.log(`Updated rotation for ${id}: [${rotation.join(', ')}]° -> [${instance.obj.rotation.x}, ${instance.obj.rotation.y}, ${instance.obj.rotation.z}] rad`)
    },

    /**
     * オブジェクトの位置と回転を同時に更新する
     * @param id パイプまたはジョイントのID
     * @param transform 新しい変換情報
     */
    updateObjectTransform(id: string, transform: {
      position?: [number, number, number],
      rotation?: [number, number, number]
    }) {
      if (transform.position) {
        this.updateObjectPosition(id, transform.position)
      }
      if (transform.rotation) {
        this.updateObjectRotation(id, transform.rotation)
      }

      // 変更を加えたので再validate
      this.validateConnections()
    },

    /**
     * オブジェクトの現在の位置を取得する
     * @param id パイプまたはジョイントのID
     * @returns 位置 [x, y, z] または undefined
     */
    getObjectPosition(id: string): [number, number, number] | undefined {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) {
        return undefined
      }
      return [instance.obj.position.x, instance.obj.position.y, instance.obj.position.z]
    },

    /**
     * オブジェクトの現在の回転を取得する（度数で返す）
     * @param id パイプまたはジョイントのID  
     * @returns 回転 [x, y, z] (度数) または undefined
     */
    getObjectRotation(id: string): [number, number, number] | undefined {
      const instance = this.instances.find(i => i.id === id)
      if (!instance?.obj) {
        return undefined
      }
      return [
        roundAngleDegrees(radiansToDegrees(instance.obj.rotation.x)),
        roundAngleDegrees(radiansToDegrees(instance.obj.rotation.y)),
        roundAngleDegrees(radiansToDegrees(instance.obj.rotation.z))
      ]
    },

    /**
     * Calculate world positions for all pipes and joints based on their relationships
     * This was moved from getters to actions to enable proper type safety
     */
    calculateWorldPosition() {
      const updated: string[] = []
      const nextUpdate: string[] = []
      const pipes = this.pipes
      const joints = this.joints
      const instances = this.instances
      const renderCount = this.renderCount++

      // Use proper method reference with type safety
      const updatePipeJointRelationshipMethod = this.updatePipeJointRelationship

      function update(updated: string[], pipe: ErectorPipe, pipeTransform: transform, updatePipeJointRelationship: typeof updatePipeJointRelationshipMethod) {
        if (!updated.includes(pipe.id)) {
          // 一つ以上のjointが更新済みなのでそれを探し、pipe自身の座標を更新してupdatedに追加し離脱
          // nextUpdateにまだいるので、次の周回で上のif句に入りpipeに接続された他のjointの座標が更新される
          const start = pipe.connections.start
          const end = pipe.connections.end
          if (start && updated.includes(start.jointId)) {
            if (renderCount % 100 === 0) {
              //console.log(`Pipe ${pipe.id} start joint ${start.jointId} already updated`)
            }
            const joint = joints.find(joint => joint.id === start.jointId)
            const jointInstance = instances.find(i => i.id === start.jointId)?.obj
            if (joint && jointInstance) {
              const hole = joint.holes[start.holeId]
              if (hole) {
                updated.push(pipe.id)
                // Record j2p relationship (joint determines pipe position)
                updatePipeJointRelationship(pipe.id, start.jointId, start.holeId, 'start', 'j2p')
                const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(start.rotation))))
                pipeTransform.position.set(...position.toArray())
                pipeTransform.rotation.set(...rotation.toArray())
                // 座標を更新したのでもう離脱していい
              }
            }
          }
          else if (end && updated.includes(end.jointId)) {
            if (renderCount % 100 === 0) {
              //console.log(`Pipe ${pipe.id} end joint ${end.jointId} already updated`)
            }
            const joint = joints.find(joint => joint.id === end.jointId)
            const jointInstance = instances.find(i => i.id === end.jointId)?.obj
            if (joint && jointInstance) {
              const hole = joint.holes[end.holeId]
              if (hole) {
                updated.push(pipe.id)
                // Record j2p relationship (joint determines pipe position)
                updatePipeJointRelationship(pipe.id, end.jointId, end.holeId, 'end', 'j2p')
                const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(end.rotation))))
                pipeTransform.position.set(...position.toArray())
                pipeTransform.rotation.set(...rotation.toArray())
                // 座標を更新したのでもう離脱していい
              }
            }
          }
          else {
            const midway = pipe.connections.midway.find(conn => updated.includes(conn.jointId)) //複数更新済みでも、pipeを複数回更新することはないので、最初に見つかったものを使う
            if (midway) {
              const joint = joints.find(joint => joint.id === midway.jointId)
              const jointInstance = instances.find(i => i.id === midway.jointId)?.obj
              if (joint && jointInstance) {
                const hole = joint.holes[midway.holeId]
                if (hole) {
                  updated.push(pipe.id)
                  // Record j2p relationship (joint determines pipe position)
                  updatePipeJointRelationship(pipe.id, midway.jointId, midway.holeId, 'midway', 'j2p')

                  // For j2p midway connections, we need to position the pipe so that the midway connection
                  // aligns with the joint hole at the specified position along the pipe
                  const flipQ = midway.reverse
                    ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(hole.dir), Math.PI)
                    : new Quaternion()
                  const rotation = jointInstance.quaternion.clone()
                    .multiply(flipQ.clone().multiply(hole.dir.clone()
                      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(midway.rotation)))))

                  // Calculate pipe position: joint position - (pipe direction * distance from pipe start to midway position)
                  const pipeDirection = new Vector3(0, 0, 1).applyQuaternion(rotation)
                  const distanceFromStart = clampMidwayPosition(midway.position ?? 0, pipe.length)
                  const holeWorldPosition = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                  const position = holeWorldPosition.clone().sub(pipeDirection.clone().multiplyScalar(distanceFromStart))

                  pipeTransform.position.set(...position.toArray())
                  pipeTransform.rotation.set(...rotation.toArray())
                  // 座標を更新したのでもう離脱していい
                }
              }
            }
          }
          if (!updated.includes(pipe.id)) {
            console.log(`Pipe ${pipe.id} is not updated, but should be!`)
            // モデルのロードが済んでいないときにここに来ることがあるので、とりあえず放置
            return;
          }
        }
        if (updated.includes(pipe.id)) {// 上で更新済みのpipeはここで処理する
          // nextUpdateにいたら消す
          const nextIndex = nextUpdate.indexOf(pipe.id)
          if (nextIndex !== -1) {
            nextUpdate.splice(nextIndex, 1)
          }
          // jointのみ更新
          if (pipe.connections.start) {
            const start = pipe.connections.start
            const joint = joints.find(joint => joint.id === start.jointId)
            if (joint) {
              // jointの各holeについて、つながっているパイプを探し、updatedにもnextUpdateにもいなければ、nextUpdateに追加
              joint.holes.forEach((hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) || //startか
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) || //endか
                    p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index) //midwayに接続していて
                  ) && !updated.includes(p.id) && !nextUpdate.includes(p.id) //まだ更新されていない・更新予定でもないパイプ 今見ているpipeはupdatedにいるはずなので引っかからない
                )
                if (next_start) { //があったら更新予定に追加
                  nextUpdate.push(next_start.id)
                  if (renderCount % 100 === 0) {
                    //console.log(`pipe ${next_start.id} pushed to next by start joint ${joint.id} for pipe ${pipe.id}`)
                  }
                }
              })
              const hole = joint.holes[start.holeId]
              if (updated.includes(pipe.connections.start.jointId)) {
                // 更新の必要なし
              }
              else {
                updated.push(pipe.connections.start.jointId)
                // Record p2j relationship (pipe determines joint position)
                updatePipeJointRelationship(pipe.id, start.jointId, start.holeId, 'start', 'p2j')
                if (hole) {
                  /*Unity C#
                    var startJoint = ErectorJoint.joints.Where(j => j.id == start.j_id).First();
                    var startHole = startJoint.holes.Where((h) => h.id == start.h_id).First();
                    var r = transform.rotation
                      * Quaternion.Inverse(Quaternion.Euler(startHole.rotation) * Quaternion.AngleAxis(-start.rot, Vector3.forward));
                    startJoint.transform.rotation = r;
                    startJoint.transform.position = transform.position + r * -startHole.offset;
                   */
                  const holeDir = new Euler().setFromQuaternion(hole.dir)
                  const pipeZRot = new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(start.rotation)))
                  const invertedHoleDir = hole.dir.clone().multiply(pipeZRot).invert()
                  const rotation = pipeTransform.rotation.clone().multiply(invertedHoleDir)
                  const rotatedHoleOffset = hole.offset.clone().applyQuaternion(rotation)
                  const position = pipeTransform.position.clone().add(rotatedHoleOffset.clone().negate())
                  const target = instances.find(i => i.id === joint.id)?.obj;
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          }
          if (pipe.connections.end) {
            const end = pipe.connections.end
            const joint = joints.find(joint => joint.id === end.jointId)
            if (joint) {
              joint.holes.forEach((hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) || //startか
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) || //endか
                    p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index) //midwayに接続していて
                  ) && !updated.includes(p.id) && !nextUpdate.includes(p.id) //まだ更新されていない・更新予定でもないパイプ
                )
                if (next_start) { //があったら更新予定に追加
                  nextUpdate.push(next_start.id)
                  if (renderCount % 100 === 0) {
                    //console.log(`pipe ${next_start.id} pushed to next by end joint ${joint.id} for pipe ${pipe.id}`)
                  }
                }
              })
              const hole = joint.holes[end.holeId]
              if (updated.includes(pipe.connections.end.jointId)) {
                // 更新の必要なし
              }
              else {
                updated.push(pipe.connections.end.jointId)
                // Record p2j relationship (pipe determines joint position)
                updatePipeJointRelationship(pipe.id, end.jointId, end.holeId, 'end', 'p2j')
                if (hole) {
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(new Quaternion().setFromEuler(new Euler(0, Math.PI, 0))
                      .multiply(hole.dir.clone()
                        .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(end.rotation)))).invert()))
                  const position = pipeTransform.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(pipe.length)).add(hole.offset.clone().negate().applyQuaternion(rotation))
                  const target = instances.find(i => i.id === joint.id)?.obj;
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          }
          pipe.connections.midway.forEach(conn => {
            const joint = joints.find(joint => joint.id === conn.jointId)
            if (joint) {
              joint.holes.forEach((hole, index) => {
                const next_start = pipes.find(p =>
                  ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) || //startか
                    (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) || //endか
                    p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index) //midwayに接続していて
                  ) && !updated.includes(p.id) && !nextUpdate.includes(p.id) //まだ更新されていない・更新予定でもないパイプ
                )
                if (next_start) { //があったら更新予定に追加
                  nextUpdate.push(next_start.id)
                  if (renderCount % 100 === 0) {
                    //console.log(`pipe ${next_start.id} pushed to next by midway joint ${joint.id} for pipe ${pipe.id}`)
                  }
                }
              })
              const hole = joint.holes[conn.holeId]
              if (updated.includes(conn.jointId)) {
                // 更新の必要なし
              }
              else {
                updated.push(conn.jointId)
                // Record p2j relationship (pipe determines joint position)
                updatePipeJointRelationship(pipe.id, conn.jointId, conn.holeId, 'midway', 'p2j')
                if (hole && hole.type === "THROUGH") {//midwayにはfixはつけられない
                  /*Unity C#
                    var joint = ErectorJoint.joints.Where(j => j.id == conn.j_id).First();
                    var hole = joint.holes.Where((h) => h.id == conn.h_id).First();
                    var r = transform.rotation * Quaternion.AngleAxis(180, transform.up) * Quaternion.Inverse(Quaternion.Euler(hole.rotation) * Quaternion.AngleAxis(-conn.rot, Vector3.forward));
                    joint.transform.rotation = r;
                    joint.transform.position = transform.position + transform.forward * (pipeLength / 1000f * conn.axis_pos / 100f) + r * -hole.offset;
                   */
                  const flipQ = conn.reverse
                    ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(hole.dir), Math.PI)
                    : new Quaternion()
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(flipQ.clone().multiply(hole.dir.clone()
                      .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(conn.rotation))))).invert())
                  const position = pipeTransform.position.clone()
                    .add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(clampMidwayPosition(conn.position, pipe.length)))
                    .add(hole.offset.clone().negate().applyQuaternion(rotation))
                  const target = instances.find(i => i.id === joint.id)?.obj;
                  target?.position.set(...position.toArray())
                  target?.quaternion.copy(rotation)
                }
              }
            }
          })
        }
      }

      return (rootTransforms: transform[]) => {// 構造のrootとなるpipeのidと座標・回転を受け取る
        const updatedSet = new Set(updated)
        rootTransforms.forEach(rootTransform => {
          const root = this.pipes.find(pipe => pipe.id === rootTransform.id)
          if (!root) return
          const rootObject = this.instances.find(i => i.id === rootTransform.id)?.obj
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
    /**
     * ドラッグ操作など連続呼び出しされる場面で使用する。
     * requestAnimationFrame でバリデーションを1フレーム後に遅延し、
     * 同一フレーム内の重複呼び出しをキャンセルすることで処理を間引く。
     */
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
      const errors: InvalidConnection[] = []

      this.pipes.forEach(pipe => {
        if (pipe.connections.start) {
          const conn = pipe.connections.start
          const joint = this.joints.find(j => j.id === conn.jointId)
          if (!joint) {
          } else if (!joint.holes[pipe.connections.start.holeId]) {
          } else {
            const hole = joint.holes[pipe.connections.start.holeId]
            const jointInstance = this.instances.find(i => i.id === conn.jointId)?.obj
            const pipeInstance = this.instances.find(i => i.id === pipe.id)?.obj
            if (!jointInstance || !pipeInstance) { } else {
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
                  side: 'start',
                  id: conn.id,
                  pipeId: pipe.id,
                  jointId: conn.jointId,
                  holeId: conn.holeId,
                  position: {
                    actual: actualHolePos,
                    expected: expectedHolePos,
                    diff: holePosDiff
                  },
                  rotation: {
                    actual: actualHoleDir,
                    expected: expectedHoleDir,
                    diff: holeDirDiff
                  },
                  right: {
                    actual: actualHoleRight,
                    expected: expectedHoleRight,
                    diff: holeRightDiff
                  }
                })
              }
            }
          }
        }
        if (pipe.connections.end) {
          const conn = pipe.connections.end
          const joint = this.joints.find(j => j.id === conn.jointId)
          if (!joint) {
          } else if (!joint.holes[pipe.connections.end.holeId]) {
          } else {
            const hole = joint.holes[pipe.connections.end.holeId]
            const jointInstance = this.instances.find(i => i.id === conn.jointId)?.obj
            const pipeInstance = this.instances.find(i => i.id === pipe.id)?.obj
            if (!jointInstance || !pipeInstance) { } else {
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
                  side: 'end',
                  id: conn.id,
                  pipeId: pipe.id,
                  jointId: conn.jointId,
                  holeId: conn.holeId,
                  position: {
                    actual: actualHolePos,
                    expected: expectedHolePos,
                    diff: holePosDiff
                  },
                  rotation: {
                    actual: actualHoleDir,
                    expected: expectedHoleDir,
                    diff: holeDirDiff
                  },
                  right: {
                    actual: actualHoleRight,
                    expected: expectedHoleRight,
                    diff: holeRightDiff
                  }
                })
              }
            }
          }
        }
        pipe.connections.midway.forEach(conn => {
          const joint = this.joints.find(j => j.id === conn.jointId)
          if (!joint) {
          } else if (!joint.holes[conn.holeId]) {
          } else {
            const hole = joint.holes[conn.holeId]
            const jointInstance = this.instances.find(i => i.id === conn.jointId)?.obj
            const pipeInstance = this.instances.find(i => i.id === pipe.id)?.obj
            if (!jointInstance || !pipeInstance) { } else {
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
                  side: 'midway',
                  id: conn.id,
                  pipeId: pipe.id,
                  jointId: conn.jointId,
                  holeId: conn.holeId,
                  position: {
                    actual: actualHolePos,
                    expected: expectedHolePos,
                    diff: holePosDiff
                  },
                  rotation: {
                    actual: actualHoleDir,
                    expected: expectedHoleDir,
                    diff: holeDirDiff
                  },
                  right: {
                    actual: actualHoleRight,
                    expected: expectedHoleRight,
                    diff: holeRightDiff
                  }
                })
              }
            }
          }
        })
      })

      // 競合検出: 同じジョイントを複数の接続が参照し位置矛盾が生じているケース
      errors.forEach(error => {
        const otherConns = getAllConnectionsToJoint(this.pipes, error.jointId)
          .filter(c => c.connectionId !== error.id)
        if (otherConns.length > 0) {
          error.conflictType = 'constraint'
          error.conflictingConnectionId = otherConns[0].connectionId
          error.conflictingSide = otherConns[0].side
        }
      })

      // パイプ軸回転による position 修正候補と right 修正候補を計算する
      errors.forEach(error => {
        error.rotationFixes = computeRotationFixes(error, this.pipes, this.instances)
        error.rightFix = computeRightFix(error, this.pipes, this.instances)
      })

      this.invalidConnections = errors

      // 自動解決モードが有効な場合、constraint競合を自動解決する
      if (this.autoResolveConflicts) {
        errors.filter(e => e.conflictType === 'constraint').forEach(error => {
          if (this.lastModifiedConnectionId === error.id) {
            // 最後に動かした接続が「負け」側に判定されている → 競合相手を更新する
            if (error.conflictingSide === 'midway' && error.conflictingConnectionId) {
              this.resolveByUpdatePosition(error.conflictingConnectionId)
            }
          } else {
            // 通常ケース: エラー（負け側）が midway なら位置を更新して接続を維持する
            if (error.side === 'midway') {
              this.resolveByUpdatePosition(error.id)
            }
          }
        })
      }

      // root merge 検出: 同一連結成分に複数 root が存在する場合を報告
      const components = this.buildConnectedComponents()
      const merges: RootMerge[] = []
      for (const component of components) {
        const roots = component.filter(id => this.rootPipeIds.includes(id))
        if (roots.length >= 2) {
          merges.push({ mergedRoots: roots, componentPipes: component })
        }
      }
      this.rootMerges = merges

      // デバッグ用: 無効な接続を可視化
      this.visualizeInvalidConnections()
    },
    resolveByDisconnect(connectionId: string) {
      this.removeConnection(connectionId)
      this.validateConnections()
    },
    resolveByRemoveRoot(pipeId: string) {
      this.rootPipeIds = this.rootPipeIds.filter(id => id !== pipeId)
      this.validateConnections()
    },
    resolveByUpdatePosition(connectionId: string) {
      // midway 接続のみ有効（start/end はパイプ端点固定のため位置を変えられない）
      const pipe = this.pipes.find(p => p.connections.midway.some(c => c.id === connectionId))
      if (!pipe) return
      const conn = pipe.connections.midway.find(c => c.id === connectionId)
      if (!conn) return

      const joint = this.joints.find(j => j.id === conn.jointId)
      if (!joint) return
      const hole = joint.holes[conn.holeId]
      if (!hole) return

      const jointInstance = this.instances.find(i => i.id === conn.jointId)?.obj
      const pipeInstance = this.instances.find(i => i.id === pipe.id)?.obj
      if (!jointInstance || !pipeInstance) return

      // ジョイントの穴のワールド座標をパイプ軸に射影して新しい position[m] を求める
      // パイプ外にはみ出した場合はクランプしてパイプ端点に固定する
      const holeWorldPos = jointInstance.position.clone()
        .add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
      const pipeStart = pipeInstance.position.clone()
      const pipeDir = new Vector3(0, 0, 1).applyQuaternion(pipeInstance.quaternion)
      const dist = holeWorldPos.clone().sub(pipeStart).dot(pipeDir)
      const newPosition = clampMidwayPosition(dist, pipe.length)

      this.updateConnection(connectionId, { position: newPosition })
    },
    resolveByRotationFix(connectionId: string, newRotation: number) {
      this.updateConnection(connectionId, { rotation: newRotation })
    },
    removeJoint(jointId: string) {
      // 削除対象のジョイントを使用している全てのコネクションを収集して削除
      const connectionsToRemove: string[] = [];

      this.pipes.forEach(pipe => {
        // start connection
        if (pipe.connections.start?.jointId === jointId) {
          connectionsToRemove.push(pipe.connections.start.id);
        }

        // end connection
        if (pipe.connections.end?.jointId === jointId) {
          connectionsToRemove.push(pipe.connections.end.id);
        }

        // midway connections
        pipe.connections.midway.forEach(conn => {
          if (conn.jointId === jointId) {
            connectionsToRemove.push(conn.id);
          }
        });
      });

      // 収集したコネクションを削除
      connectionsToRemove.forEach(connectionId => {
        this.removeConnection(connectionId);
      });

      // ジョイントを配列から削除
      const jointIndex = this.joints.findIndex(j => j.id === jointId);
      if (jointIndex !== -1) {
        this.joints.splice(jointIndex, 1);
      }

      // 3Dオブジェクトのインスタンスを削除
      const instanceIndex = this.instances.findIndex(i => i.id === jointId);
      if (instanceIndex !== -1) {
        const three = useThree();
        if (three.scene) {
          const instance = this.instances[instanceIndex];
          if (instance.obj) {
            three.scene.remove(instance.obj);
          }
        }
        this.instances.splice(instanceIndex, 1);
      }

      //削除されたので再validate
      this.validateConnections();
    },

    removePipe(pipeId: string) {
      // 削除対象のパイプのコネクションを収集して削除
      const connectionsToRemove: string[] = [];
      const pipe = this.pipes.find(p => p.id === pipeId);

      if (!pipe) {
        console.warn(`Pipe with id ${pipeId} not found`);
        return;
      }

      // start connection
      if (pipe.connections.start) {
        connectionsToRemove.push(pipe.connections.start.id);
      }

      // end connection
      if (pipe.connections.end) {
        connectionsToRemove.push(pipe.connections.end.id);
      }

      // midway connections
      pipe.connections.midway.forEach(conn => {
        connectionsToRemove.push(conn.id);
      });

      // 収集したコネクションを削除
      connectionsToRemove.forEach(connectionId => {
        this.removeConnection(connectionId);
      });

      // パイプを配列から削除
      const pipeIndex = this.pipes.findIndex(p => p.id === pipeId);
      if (pipeIndex !== -1) {
        this.pipes.splice(pipeIndex, 1);
      }
      this.syncRootPipeIds()

      // 3Dオブジェクトのインスタンスを削除
      const instanceIndex = this.instances.findIndex(i => i.id === pipeId);
      if (instanceIndex !== -1) {
        const three = useThree();
        if (three.scene) {
          const instance = this.instances[instanceIndex];
          if (instance.obj) {
            // シーンから削除
            three.scene.remove(instance.obj);

            // ジオメトリとマテリアルを適切に破棄してメモリリークを防ぐ
            instance.obj.traverse((child) => {
              if (child instanceof Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    child.material.forEach(material => material.dispose());
                  } else {
                    child.material.dispose();
                  }
                }
              }
            });
          }
        }
        this.instances.splice(instanceIndex, 1);
      }

      //削除されたので再validate
      this.validateConnections();
    },

    /**
     * デバッグ用の矢印をすべて削除する
     */
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

    /**
     * 無効な接続のデバッグ情報を可視化する
     */
    visualizeInvalidConnections() {
      const three = useThree()
      if (!three.scene) return

      // 既存のデバッグ矢印を削除
      this.clearDebugArrows()

      this.invalidConnections.forEach(invalidConn => {
        if (!three.scene) return

        // Position arrows (actual: red, expected: green)
        const actualPosArrow = new ArrowHelper(
          invalidConn.rotation.actual.clone().normalize(),
          invalidConn.position.actual,
          0.5,
          0x0000ff,
          0.1,
          0.05
        )
        actualPosArrow.name = `debug-actual-pos-${invalidConn.id}`
        three.scene.add(actualPosArrow)
        this.debugArrows.push(actualPosArrow)

        const expectedPosArrow = new ArrowHelper(
          invalidConn.rotation.expected.clone().normalize(),
          invalidConn.position.expected,
          0.5,
          0xccccff,
          0.1,
          0.05
        )
        expectedPosArrow.name = `debug-expected-pos-${invalidConn.id}`
        three.scene.add(expectedPosArrow)
        this.debugArrows.push(expectedPosArrow)

        // Right direction arrows (actual: orange, expected: cyan)
        const actualRightArrow = new ArrowHelper(
          invalidConn.right.actual.clone().normalize(),
          invalidConn.position.actual,
          0.5,
          0xff0000,
          0.1,
          0.05
        )
        actualRightArrow.name = `debug-actual-right-${invalidConn.id}`
        three.scene.add(actualRightArrow)
        this.debugArrows.push(actualRightArrow)

        const expectedRightArrow = new ArrowHelper(
          invalidConn.right.expected.clone().normalize(),
          invalidConn.position.expected,
          0.5,
          0xffcccc,
          0.1,
          0.05
        )
        expectedRightArrow.name = `debug-expected-right-${invalidConn.id}`
        three.scene.add(expectedRightArrow)
        this.debugArrows.push(expectedRightArrow)
      })
    },
  },
  getters: {
    instanceObjectMap(): Map<string, Object3D | undefined> {
      return new Map(this.instances.map(instance => [instance.id, instance.obj]))
    },
    rootPipeObjects(): Object3D[] {
      return this.rootPipeIds
        .map(id => this.instanceObjectMap.get(id))
        .filter((obj): obj is Object3D => obj !== undefined)
    },
    newPipeId(): string {
      const existing_id = this.pipes.map(v => Number.parseInt(v.id.split('_')[1], 10));
      const id = ((existing_id.length > 0 ? Math.max(...existing_id) : 0) + 1).toString().padStart(4, '0');
      return `P_${id.toString().padStart(4, '0')}`;
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
        let baseId = `${pipeId}-conn`
        const pipe = this.pipes.find(pipe => pipe.id === pipeId)
        if (!pipe) return baseId //それはそれでどうなんだ
        const ids: string[] = []
        pipe.connections.start && ids.push(pipe.connections.start.id)
        pipe.connections.end && ids.push(pipe.connections.end.id)
        pipe.connections.midway.forEach(conn => ids.push(conn.id))
        const id_numbers = ids.map(i => i.split("-")).filter(l => l.length > 1).map(l => l[2]) ?? ['-1'] // まだなければ0にしたい
        const maxNumber = id_numbers.length > 0 ? Math.max(...id_numbers.map(i => parseInt(i))) : 0
        return `${baseId}-${maxNumber + 1}`
      }
    }
  }
})
