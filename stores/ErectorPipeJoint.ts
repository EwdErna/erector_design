import { defineStore } from 'pinia'
import { Euler, ExtrudeGeometry, Mesh, Quaternion, Vector3, MeshPhongMaterial, Object3D, Scene } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import { generateUUID } from 'three/src/math/MathUtils.js'
import type { ErectorJoint, ErectorJointHole, ErectorPipe, ErectorPipeConnection } from '~/types/erector_component'
import { genPipe } from '~/utils/Erector/pipe'
export type transform = { id: string, position: Vector3, rotation: Quaternion }
export const useErectorPipeJoint = defineStore('erectorPipeJoint', {
  state: () => ({
    pipes: [] as ErectorPipe[],
    joints: [] as ErectorJoint[],
    instances: [] as { id: string, obj?: Object3D }[],
  }),
  actions: {
    addPipe(scene: Scene, diameter: number, length: number, id?: string) {//pipeの存在だけを追加
      if (!id) id = this.newPipeId
      this.pipes.push({
        id,
        diameter,
        length,
        connections: {
          midway: [],
        }
      })
      if (!this.instances.some(i => i.id === id)) {
        const pipeModel = genPipe(length, diameter)
        const pipeObject = new Object3D()
        const pipeMesh = new Mesh(pipeModel, new MeshPhongMaterial())
        pipeObject.name = id
        pipeObject.add(pipeMesh)
        this.instances.push({ id, obj: pipeObject })
        console.log(pipeObject)
        // TODO: get scene and add pipeObject to it
        scene.add(pipeObject)
      }
      return id
    },
    updatePipe(id: string, key: 'length' | 'diameter', value: number) {
      const pipe = this.pipes.findIndex(p => p.id === id)
      if (pipe < 0) return;
      this.pipes[pipe][key] = value
      const obj = this.instances.find(v => v.id === id)?.obj
      if (!obj) return;
      obj.traverse(v => {
        if (v instanceof Mesh && v.geometry instanceof ExtrudeGeometry) {
          v.geometry.dispose()
          v.geometry = genPipe(this.pipes[pipe].length, this.pipes[pipe].diameter)
          v.geometry.needsUpdate = true
        }
      })
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
          console.log(position)
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
    },
    updateConnection(id: string, connectionToUpdate: Partial<ErectorPipeConnection>) {
      //find connection with id 
      const pipe = this.pipes.find(p => p.connections.start?.id === id || p.connections.end?.id === id || p.connections.midway.some(conn => conn.id === id))
      if (!pipe) return
      const connection = pipe.connections.start?.id === id ? 'start' : pipe.connections.end?.id === id ? 'end' : pipe.connections.midway.findIndex(conn => conn.id === id)
      if (connection === -1) return //startでもendでもなく、midwayにも存在しない
      const connectionBeforeUpdate = typeof connection === 'number' ? pipe.connections.midway[connection] : pipe.connections[connection]
      if (!connectionBeforeUpdate) return
      if (connection === 'start' || connection === 'end') {
        pipe.connections[connection] = { ...connectionBeforeUpdate, ...connectionToUpdate }
      } else {
        pipe.connections.midway[connection] = { ...connectionBeforeUpdate, ...connectionToUpdate }
      }
    },
    removeConnection(id: string) {
      const pipe = this.pipes.find(p => p.connections.start?.id === id || p.connections.end?.id === id || p.connections.midway.some(conn => conn.id === id))
      if (!pipe) return
      if (pipe.connections.start?.id === id) {
        pipe.connections.start = undefined
      }
      else if (pipe.connections.end?.id === id) {
        pipe.connections.end = undefined
      }
      else {
        const index = pipe.connections.midway.findIndex(conn => conn.id === id)
        if (index !== -1) {
          pipe.connections.midway.splice(index, 1)
        }
      }
    }
  },
  getters: {
    invalidJoints() {
      // jointの座標や向きを検証し、つなげることのできない場所があれば配列として返却
      return []
    },
    worldPosition() {
      const updated: string[] = []
      const joints = this.joints
      const instances = this.instances
      function update(updated: string[], pipe: ErectorPipe, pipeTransform: transform) {
        if (updated.includes(pipe.id)) {
          // jointのみ更新
          if (pipe.connections.start) {
            const start = pipe.connections.start
            const joint = joints.find(joint => joint.id === start.jointId)
            if (joint) {
              const hole = joint.holes[start.holeId]
              if (updated.includes(pipe.connections.start.jointId)) {
                // 更新の必要なし
              }
              else {
                updated.push(pipe.connections.start.jointId)
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
                  console.log(`${holeDir.x}, ${holeDir.y}, ${holeDir.z}`)
                  const pipeZRot = new Quaternion().setFromEuler(new Euler(0, 0, start.rotation / 180 * Math.PI))
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
              const hole = joint.holes[end.holeId]
              if (updated.includes(pipe.connections.end.jointId)) {
                // 更新の必要なし
              }
              else {
                updated.push(pipe.connections.end.jointId)
                if (hole) {
                  const rotation = pipeTransform.rotation.clone()
                    .multiply(new Quaternion().setFromEuler(new Euler(0, Math.PI, 0))
                      .multiply(hole.dir.clone()
                        .multiply(new Quaternion().setFromEuler(new Euler(0, 0, end.rotation / 180 * Math.PI))).invert()))
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
              const hole = joint.holes[conn.holeId]
              if (updated.includes(conn.jointId)) {
                // 更新の必要なし
              }
              else {
                updated.push(conn.jointId)
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
                      .multiply(new Quaternion().setFromEuler(new Euler(0, 0, conn.rotation / 180 * Math.PI))).invert())
                  const position = pipeTransform.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(pipe.length * conn.position)).add(hole.offset.clone().applyQuaternion(rotation))
                  const target = instances.find(i => i.id === joint.id)?.obj;
                  target?.position.set(...position.toArray())
                  target?.rotation.setFromQuaternion(rotation)
                }
              }
            }
          })
        } else {
          // jointの座標が一つ以上確定していれば、それをもとに更新
          // 一つも確定していなければ一旦無視→後で見るリストが必要
          const start = pipe.connections.start
          const end = pipe.connections.end
          if (start && updated.includes(start.jointId)) {
            const joint = joints.find(joint => joint.id === start.jointId)
            const jointInstance = instances.find(i => i.id === start.jointId)?.obj
            if (joint && jointInstance) {
              const hole = joint.holes[start.holeId]
              if (hole) {
                updated.push(pipe.id)
                const position = jointInstance.position.clone().add(hole.offset.clone().applyEuler(jointInstance.rotation))
                const rotation = new Quaternion().setFromEuler(jointInstance.rotation).multiply(hole.dir.clone())
                pipeTransform.position.set(...position.toArray())
                pipeTransform.rotation.set(...rotation.toArray())
              }
            }
          }
          else if (end && updated.includes(end.jointId)) { }
          else {
            const midway = pipe.connections.midway.find(conn => updated.includes(conn.jointId))
            if (midway) { }
          }
        }
        // if (pipe.connections.start) {
        //   const start = pipe.connections.start
        //   const joint = joints.find(joint => joint.id === start.jointId)
        //   if (joint) {
        //     const hole = joint.holes[start.holeId]
        //     if (updated.includes(pipe.connections.start.jointId)) {
        //       //jointの座標は確定しているので、pipeの座標を更新するべし
        //     }
        //     else {
        //       updated.push(pipe.connections.start.jointId)
        //       if (hole) {
        //         /*Unity C#
        //           var startJoint = ErectorJoint.joints.Where(j => j.id == start.j_id).First();
        //           var startHole = startJoint.holes.Where((h) => h.id == start.h_id).First();
        //           var r = transform.rotation
        //             * Quaternion.Inverse(Quaternion.Euler(startHole.rotation) * Quaternion.AngleAxis(-start.rot, Vector3.forward));
        //           startJoint.transform.rotation = r;
        //           startJoint.transform.position = transform.position + r * -startHole.offset;
        //          */
        //         const holeDir = new Euler().setFromQuaternion(hole.dir)
        //         console.log(`${holeDir.x}, ${holeDir.y}, ${holeDir.z}`)
        //         const pipeZRot = new Quaternion().setFromEuler(new Euler(0, 0, start.rotation / 180 * Math.PI))
        //         const invertedHoleDir = hole.dir.clone().multiply(pipeZRot).invert()
        //         const rotation = pipeTransform.rotation.clone().multiply(invertedHoleDir)
        //         const rotatedHoleOffset = hole.offset.clone().applyQuaternion(rotation)
        //         const position = pipeTransform.position.clone().add(rotatedHoleOffset.clone().negate())
        //         const target = instances.find(i => i.id === joint.id)?.obj;
        //         target?.position.set(...position.toArray())
        //         target?.rotation.setFromQuaternion(rotation)
        //       }
        //     }
        //   }
        // }
        // if (pipe.connections.end) {
        //   const end = pipe.connections.end
        //   const joint = joints.find(joint => joint.id === end.jointId)
        //   if (joint) {
        //     const hole = joint.holes[end.holeId]
        //     if (updated.includes(pipe.connections.end.jointId)) {
        //       //jointの座標は確定しているので、pipeの座標を更新するべし
        //     }
        //     else {
        //       updated.push(pipe.connections.end.jointId)
        //       if (hole) {
        //         /*Unity C#
        //           var endJoint = ErectorJoint.joints.Where(j => j.id == end.j_id).First();
        //           var endHole = endJoint.holes.Where((h) => h.id == end.h_id).First();
        //           var r = transform.rotation * Quaternion.AngleAxis(180, transform.up) * Quaternion.Inverse(Quaternion.Euler(endHole.rotation) * Quaternion.AngleAxis(-end.rot, Vector3.forward));
        //           endJoint.transform.rotation = r;
        //           endJoint.transform.position = transform.position + transform.forward * pipeLength / 1000 + r * -endHole.offset;
        //         */
        //         const rotation = pipeTransform.rotation.clone()
        //           .multiply(new Quaternion().setFromEuler(new Euler(0, Math.PI, 0))
        //             .multiply(hole.dir.clone()
        //               .multiply(new Quaternion().setFromEuler(new Euler(0, 0, end.rotation / 180 * Math.PI))).invert()))
        //         const position = pipeTransform.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(pipe.length)).add(hole.offset.clone().negate().applyQuaternion(rotation))
        //         const target = instances.find(i => i.id === joint.id)?.obj;
        //         target?.position.set(...position.toArray())
        //         target?.rotation.setFromQuaternion(rotation)
        //       }
        //     }
        //   }
        // }
        // pipe.connections.midway.forEach(conn => {
        //   const joint = joints.find(joint => joint.id === conn.jointId)
        //   if (joint) {
        //     const hole = joint.holes[conn.holeId]
        //     if (updated.includes(conn.jointId)) {
        //       //jointの座標は確定しているので、pipeの座標を更新するべし
        //     }
        //     else {
        //       updated.push(conn.jointId)
        //       if (hole && hole.type === "THROUGH") {//midwayにはfixはつけられない
        //         /*Unity C#
        //           var joint = ErectorJoint.joints.Where(j => j.id == conn.j_id).First();
        //           var hole = joint.holes.Where((h) => h.id == conn.h_id).First();
        //           var r = transform.rotation * Quaternion.AngleAxis(180, transform.up) * Quaternion.Inverse(Quaternion.Euler(hole.rotation) * Quaternion.AngleAxis(-conn.rot, Vector3.forward));
        //           joint.transform.rotation = r;
        //           joint.transform.position = transform.position + transform.forward * (pipeLength / 1000f * conn.axis_pos / 100f) + r * -hole.offset;
        //          */
        //         const rotation = pipeTransform.rotation.clone()
        //           .multiply(hole.dir.clone()
        //             .multiply(new Quaternion().setFromEuler(new Euler(0, 0, conn.rotation / 180 * Math.PI))).invert())
        //         const position = pipeTransform.position.clone().add(new Vector3(0, 0, 1).applyQuaternion(pipeTransform.rotation).multiplyScalar(pipe.length * conn.position)).add(hole.offset.clone().applyQuaternion(rotation))
        //         const target = instances.find(i => i.id === joint.id)?.obj;
        //         target?.position.set(...position.toArray())
        //         target?.rotation.setFromQuaternion(rotation)
        //       }
        //     }
        //   }
        // })
      }

      return (rootTransform: transform) => {// 構造のrootとなるpipeのidと座標・回転を受け取る
        const root = this.pipes.find(pipe => pipe.id === rootTransform.id)
        if (!root) return
        const rootObject = this.instances.find(i => i.id === rootTransform.id)?.obj
        rootObject?.position.set(...rootTransform.position.toArray())
        rootObject?.rotation.setFromQuaternion(rootTransform.rotation)
        updated.push(root.id)
        update(updated, root, rootTransform)
        this.pipes.reduce((a: ErectorPipe[], v) => v.id === root.id ? a : [...a, v], []).forEach(pipe => {
          const pipeObject = this.instances.find(i => i.id === pipe.id)?.obj
          if (!pipeObject) return
          update(updated, pipe, {
            id: pipe.id,
            position: pipeObject.position,
            rotation: pipeObject.quaternion
          })
        })
      }
    },
    newPipeId() {
      let id = generateUUID()
      while (this.pipes.some(instance => instance.id === id)) {
        id = generateUUID()
      }
      return id
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
