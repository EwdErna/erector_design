import { defineStore } from 'pinia'
import { Euler, Mesh, Quaternion, Vector3, MeshPhongMaterial, Object3D, Scene, BufferGeometry, ArrowHelper } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import type { ErectorJoint, ErectorJointHole, ErectorPipe, ErectorPipeConnection } from '~/types/erector_component'
import { genPipe } from '~/utils/Erector/pipe'
import { degreesToRadians, radiansToDegrees } from '~/utils/angleUtils'
export type transform = { id: string, position: Vector3, rotation: Quaternion }
import erectorComponentDefinition from '~/data/erector_component.json'
export type PipeJointRelationship = {
  pipeId: string
  jointId: string
  holeId: number
  connectionType: 'start' | 'end' | 'midway'
  relationshipType: 'j2p' | 'p2j' // j2p: joint determines pipe, p2j: pipe determines joint
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
}

export const useErectorPipeJoint = defineStore('erectorPipeJoint', {
  state: () => ({
    pipes: [] as ErectorPipe[],
    joints: [] as ErectorJoint[],
    instances: [] as { id: string, obj?: Object3D }[],
    renderCount: 0,
    pipeJointRelationships: [] as PipeJointRelationship[],
    invalidConnections: [] as InvalidConnection[],
    rootPipeId: '' as string,
    debugArrows: [] as ArrowHelper[], // デバッグ用の矢印オブジェクト
  }),
  actions: {
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

      // 変更を加えたので再validate
      this.validateConnections()
      return id
    },
    updatePipe(id: string, key: 'length' | 'diameter', value: number) {
      const pipe = this.pipes.findIndex(p => p.id === id)
      if (pipe < 0) return;
      this.pipes[pipe][key] = value
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

      // 変更を加えたので再validate
      this.validateConnections()
      return id
    },
    addConnection(pipeId: string, jointId: string, holeId: number, side: "start" | "end" | "midway", rotation?: number, position?: number, id?: string) {//jointの穴にpipeを接続
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
            position: position ?? 0,
          })
          break
      }

      // 変更を加えたので再validate
      this.validateConnections()
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
        pipe.connections.midway[connection] = { ...connectionBeforeUpdate, ...connectionToUpdate }
      }

      // 変更を加えたので再validate
      this.validateConnections()
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

      // 変更を加えたので再validate
      this.validateConnections()
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
      this.rootPipeId = ''

      // 変更を加えたので再validate
      this.validateConnections()
    },
    loadFromStructure(structure: { pipes: ErectorPipe[], joints: { id: string, name: string }[], rootTransform?: { pipeId: string, position: [number, number, number], rotation: [number, number, number] } }) {
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
          } else this.addConnection(pipe.id, pipe.connections.start.jointId, pipe.connections.start.holeId, "start")
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
          } else this.addConnection(pipe.id, conn.jointId, conn.holeId, "midway", conn.rotation, conn.position)
        })
      })
      // Apply root transform if provided
      if (structure.rootTransform) {
        const rootPipeId = structure.rootTransform.pipeId
        this.updateObjectPosition(rootPipeId, structure.rootTransform.position)
        this.updateObjectRotation(rootPipeId, structure.rootTransform.rotation)
        this.rootPipeId = rootPipeId
      } else {
        // Set the first pipe as root if no root transform is provided
        this.rootPipeId = structure.pipes.length > 0 ? structure.pipes[0].id : ''
      }

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

      // 変更を加えたので再validate
      this.validateConnections()
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

      // 変更を加えたので再validate
      this.validateConnections()
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

      // 変更を加えたので再validate
      this.validateConnections()
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

      // 変更を加えたので再validate
      this.validateConnections()
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
        radiansToDegrees(instance.obj.rotation.x),
        radiansToDegrees(instance.obj.rotation.y),
        radiansToDegrees(instance.obj.rotation.z)
      ]
    },

    /**
     * オブジェクトの手動移動後に依存関係を再計算する
     * パイプやジョイントの位置が手動で変更された場合、接続されたオブジェクトの配置を更新する
     * @param id 変更されたオブジェクトのID
     */
    recalculateObjectDependencies(id: string) {
      // オブジェクトの種類を判定
      const pipe = this.pipes.find(p => p.id === id)
      const joint = this.joints.find(j => j.id === id)

      if (pipe) {
        // パイプが移動された場合、接続されたジョイントの位置を再計算
        //console.log(`Recalculating dependencies for pipe ${id}`)
        this.recalculatePipeDependencies(pipe)
      } else if (joint) {
        // ジョイントが移動された場合、接続されたパイプの位置を再計算
        //console.log(`Recalculating dependencies for joint ${id}`)
        this.recalculateJointDependencies(joint)
      }

      // レンダリングカウントを増やして更新をトリガー
      this.renderCount++
    },

    /**
     * パイプの依存関係を再計算（私的メソッド）
     */
    recalculatePipeDependencies(pipe: ErectorPipe) {
      // パイプの移動により影響を受けるジョイントを更新
      // このメソッドは worldPosition getter の計算ロジックを使用
      const dependencies = []

      if (pipe.connections.start) {
        dependencies.push({ jointId: pipe.connections.start.jointId, connectionType: 'start' })
      }
      if (pipe.connections.end) {
        dependencies.push({ jointId: pipe.connections.end.jointId, connectionType: 'end' })
      }
      pipe.connections.midway.forEach(conn => {
        dependencies.push({ jointId: conn.jointId, connectionType: 'midway' })
      })

      //console.log(`Pipe ${pipe.id} has ${dependencies.length} joint dependencies`)
    },

    /**
     * ジョイントの依存関係を再計算（私的メソッド）
     */
    recalculateJointDependencies(joint: ErectorJoint) {
      // ジョイントの移動により影響を受けるパイプを更新
      const connectedPipes = this.pipes.filter(pipe => {
        return (pipe.connections.start?.jointId === joint.id) ||
          (pipe.connections.end?.jointId === joint.id) ||
          pipe.connections.midway.some(conn => conn.jointId === joint.id)
      })

      //console.log(`Joint ${joint.id} affects ${connectedPipes.length} pipes`)
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
                  const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degreesToRadians(midway.rotation))))

                  // Calculate pipe position: joint position - (pipe direction * distance from pipe start to midway position)
                  const pipeDirection = new Vector3(0, 0, 1).applyQuaternion(rotation)
                  const distanceFromStart = pipe.length * (midway.position ?? 0) // Use position or default to start (0)
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
                  target?.rotation.setFromQuaternion(rotation)
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
                  target?.rotation.setFromQuaternion(rotation)
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
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(hole.dir.clone()
                      .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(conn.rotation)))).invert())
                  const position = pipeTransform.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(pipe.length * conn.position)).add(hole.offset.clone().applyQuaternion(rotation))
                  const target = instances.find(i => i.id === joint.id)?.obj;
                  target?.position.set(...position.toArray())
                  target?.rotation.setFromQuaternion(rotation)
                }
              }
            }
          })
        }
      }

      return (rootTransform: transform) => {// 構造のrootとなるpipeのidと座標・回転を受け取る
        const root = this.pipes.find(pipe => pipe.id === rootTransform.id)
        if (!root) return
        const rootObject = this.instances.find(i => i.id === rootTransform.id)?.obj
        rootObject?.position.set(...rootTransform.position.toArray())
        rootObject?.rotation.setFromQuaternion(rootTransform.rotation)
        updated.push(root.id)
        nextUpdate.push(root.id)
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
    validateConnections() {
      // コネクションの整合性を検証する
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
                .add(new Vector3(0, 0, 1).applyQuaternion(pipeInstance.quaternion).multiplyScalar(pipe.length * conn.position))
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
      this.invalidConnections = errors

      // デバッグ用: 無効な接続を可視化
      this.visualizeInvalidConnections()
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
    rootPipeObject(): Object3D | undefined {
      if (!this.rootPipeId) return undefined
      return this.instances.find(i => i.id === this.rootPipeId)?.obj
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
