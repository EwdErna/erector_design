import { defineStore } from 'pinia'
import { Euler, ExtrudeGeometry, Mesh, Quaternion, Vector3, MeshPhongMaterial, Object3D, Scene } from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'
import { generateUUID } from 'three/src/math/MathUtils.js'
import type { ErectorJoint, ErectorJointHole, ErectorPipe, ErectorPipeConnection } from '~/types/erector_component'
import { genPipe } from '~/utils/Erector/pipe'
export type transform = { id: string, position: Vector3, rotation: Quaternion }
import erectorComponentDefinition from '~/data/erector_component.json'
export const useErectorPipeJoint = defineStore('erectorPipeJoint', {
    state: () => ({
        pipes: [] as ErectorPipe[],
        joints: [] as ErectorJoint[],
        instances: [] as { id: string, obj?: Object3D }[],
        renderCount: 0,
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
        },
        clearAll() {
            const three = useThree()
            if (!three.scene) return;
            const scene = three.scene

            // Remove all instances from the scene
            this.instances.forEach(instance => {
                if (instance.obj) {
                    scene.remove(instance.obj)
                    // Dispose of geometry and materials to free memory
                    instance.obj.traverse((child) => {
                        if (child instanceof Mesh) {
                            if (child.geometry) child.geometry.dispose()
                            if (child.material) {
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

            // Clear all data arrays
            this.pipes = []
            this.joints = []
            this.instances = []
            this.renderCount = 0
        },
        loadFromStructure(structure: { pipes: ErectorPipe[], joints: { id: string, name: string }[], rootTransform?: { pipeId: string, position: [number, number, number], rotation: [number, number, number, number] } }) {
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
                const rootInstance = this.instances.find(i => i.id === structure.rootTransform!.pipeId)?.obj
                if (rootInstance) {
                    rootInstance.position.set(...structure.rootTransform.position)
                    rootInstance.quaternion.set(...structure.rootTransform.rotation)
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
            const nextUpdate: string[] = []
            const pipes = this.pipes
            const joints = this.joints
            const instances = this.instances
            const renderCount = this.renderCount++
            function update(updated: string[], pipe: ErectorPipe, pipeTransform: transform) {
                if (!updated.includes(pipe.id)) {
                    // 一つ以上のjointが更新済みなのでそれを探し、pipe自身の座標を更新してupdatedに追加し離脱
                    // nextUpdateにまだいるので、次の周回で上のif句に入りpipeに接続された他のjointの座標が更新される
                    const start = pipe.connections.start
                    const end = pipe.connections.end
                    if (start && updated.includes(start.jointId)) {
                        const joint = joints.find(joint => joint.id === start.jointId)
                        const jointInstance = instances.find(i => i.id === start.jointId)?.obj
                        if (joint && jointInstance) {
                            const hole = joint.holes[start.holeId]
                            if (hole) {
                                updated.push(pipe.id)
                                const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                                const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                                    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), start.rotation / 180 * Math.PI)))
                                pipeTransform.position.set(...position.toArray())
                                pipeTransform.rotation.set(...rotation.toArray())
                                // 座標を更新したのでもう離脱していい
                            }
                        }
                    }
                    else if (end && updated.includes(end.jointId)) {
                        const joint = joints.find(joint => joint.id === end.jointId)
                        const jointInstance = instances.find(i => i.id === end.jointId)?.obj
                        if (joint && jointInstance) {
                            const hole = joint.holes[end.holeId]
                            if (hole) {
                                updated.push(pipe.id)
                                const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                                const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                                    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), end.rotation / 180 * Math.PI)))
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
                                    const position = jointInstance.position.clone().add(hole.offset.clone().applyQuaternion(jointInstance.quaternion))
                                    const rotation = jointInstance.quaternion.clone().multiply(hole.dir.clone()
                                        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), midway.rotation / 180 * Math.PI)))
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
                                }
                            })
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
                            joint.holes.forEach((hole, index) => {
                                const next_start = pipes.find(p =>
                                    ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) || //startか
                                        (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) || //endか
                                        p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index) //midwayに接続していて
                                    ) && !updated.includes(p.id) && !nextUpdate.includes(p.id) //まだ更新されていない・更新予定でもないパイプ
                                )
                                if (next_start) { //があったら更新予定に追加
                                    nextUpdate.push(next_start.id)
                                }
                            })
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
                            joint.holes.forEach((hole, index) => {
                                const next_start = pipes.find(p =>
                                    ((p.connections.start?.jointId === joint.id && p.connections.start?.holeId === index) || //startか
                                        (p.connections.end?.jointId === joint.id && p.connections.end?.holeId === index) || //endか
                                        p.connections.midway.some(conn => conn.jointId === joint.id && conn.holeId === index) //midwayに接続していて
                                    ) && !updated.includes(p.id) && !nextUpdate.includes(p.id) //まだ更新されていない・更新予定でもないパイプ
                                )
                                if (next_start) { //があったら更新予定に追加
                                    nextUpdate.push(next_start.id)
                                }
                            })
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
                    update(updated, pipe, updatedTransform)
                }
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
