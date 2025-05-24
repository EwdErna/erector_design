import { defineStore } from 'pinia'
import { MeshPhongMaterial, Object3D, Scene } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import { generateUUID } from 'three/src/math/MathUtils.js'
import type { ErectorJoint, ErectorJointHole, ErectorPipe } from '~/types/erector_component'
import { genPipe } from '~/utils/Erector/pipe'
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
  },
  getters: {
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
