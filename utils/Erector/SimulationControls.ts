import {
  BufferGeometry, Camera, Controls, Group, Mesh, MeshBasicMaterial,
  Object3D, Plane, Quaternion, Raycaster, TorusGeometry, Vector2, Vector3,
} from 'three'
import type { ErectorJoint, JointMovableDefinition } from '~/types/erector_component'
import { radiansToDegrees } from '~/utils/angleUtils'
import { calculateSignedAngle, disposeDebugObjects, isMeshWithBasicMaterial, GizmoHoverManager, GIZMO_VISUAL } from './ControlsShared'
import type { HoverCurveRing } from './ControlsShared'

type SimGizmoUserData = {
  role: 'pivot' | 'spin' | 'orbit'
  jointId: string
  axisWorld: Vector3
  centerWorld: Vector3
  startAngle: number
  hoverCurve?: HoverCurveRing
}

export class SimulationControls extends Controls<{
  change: { value: boolean }
  'dragging-changed': { value: boolean }
}> {
  gizmoGroup: Group = new Group()
  debugObjects: Group = new Group()
  private gizmos: Mesh[] = []
  private target: { joint: ErectorJoint, object: Object3D, movableDef: JointMovableDefinition } | null = null

  camera: Camera
  override domElement: HTMLElement

  private hoverManager = new GizmoHoverManager()

  private isDragging = false
  private dragging: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  private draggingPlane: Plane | null = null
  private dragStart: Vector3 | null = null
  private cachedCenter: Vector3 | null = null
  private cachedAxis: Vector3 | null = null
  private dragStartAngle = 0

  constructor(camera: Camera, domElement: HTMLElement) {
    super(camera, domElement)
    this.camera = camera
    this.domElement = domElement
    domElement.addEventListener('mousedown', this.onMouseDown.bind(this))
    domElement.addEventListener('mousemove', this.onMouseMove.bind(this))
    domElement.addEventListener('mouseup', this.onMouseUp.bind(this))
    domElement.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: true })
    domElement.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: true })
    domElement.addEventListener('touchend', this.onTouchEnd.bind(this))
  }

  setTarget(joint: ErectorJoint, object: Object3D, movableDef: JointMovableDefinition) {
    this.clear()
    this.target = { joint, object, movableDef }
    this.createGizmo()
    this.dispatchEvent({ type: 'change', value: true })
  }

  private createGizmo() {
    if (!this.target) return
    const { joint, object, movableDef } = this.target

    if (movableDef.type === 'pivot') {
      // One arc gizmo centered at pivotCenter, oriented along pivotAxis
      const pivotCenterLocal = new Vector3(...movableDef.pivotCenter)
      const pivotAxisLocal = new Vector3(...movableDef.pivotAxis).normalize()

      const pivotCenterWorld = pivotCenterLocal.clone().applyQuaternion(object.quaternion).add(object.position)
      const pivotAxisWorld = pivotAxisLocal.clone().applyQuaternion(object.quaternion)

      const gizmo = this.makeArc(0xffa500, 0.06)
      gizmo.position.copy(pivotCenterWorld)
      gizmo.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), pivotAxisWorld)

      // gizmoGroup は origin (transform なし) なので position = world座標
      // sampleHoverCurveWorld は group.localToWorld を呼ぶが identity なのでそのまま使える
      const hoverCurvePivot: HoverCurveRing = {
        type: 'ring',
        center: pivotCenterWorld.clone(),  // gizmoGroup local = world
        radius: 0.06,
        normal: pivotAxisWorld.clone(),    // gizmoGroup local = world
      }
      const userData: SimGizmoUserData = {
        role: 'pivot',
        jointId: joint.id,
        axisWorld: pivotAxisWorld,
        centerWorld: pivotCenterWorld,
        startAngle: 0,
      }
      gizmo.userData = { ...userData, hoverCurve: hoverCurvePivot }
      this.gizmoGroup.add(gizmo)
      this.gizmos.push(gizmo)
    }
    else if (movableDef.type === 'free_rotation') {
      const clampedIdx = joint.clampedHoleIndex ?? 0
      const nonClampedIdx = 1 - clampedIdx
      const nonClampedHole = joint.holes[nonClampedIdx]
      const clampedHole = joint.holes[clampedIdx]
      if (!nonClampedHole || !clampedHole) return

      const holeCenterWorld = nonClampedHole.offset.clone().applyQuaternion(object.quaternion).add(object.position)
      const holeAxisWorld = new Vector3(0, 0, 1).applyQuaternion(nonClampedHole.dir).applyQuaternion(object.quaternion)
      const axisQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), holeAxisWorld)

      // Spin gizmo: 非固定穴中心、固定半径
      const spinGizmo = this.makeArc(0x00e5ff, 0.06)
      spinGizmo.position.copy(holeCenterWorld)
      spinGizmo.quaternion.copy(axisQuat)
      const hoverCurveSpin: HoverCurveRing = {
        type: 'ring',
        center: holeCenterWorld.clone(),
        radius: 0.06,
        normal: holeAxisWorld.clone(),
      }
      spinGizmo.userData = {
        role: 'spin',
        jointId: joint.id,
        axisWorld: holeAxisWorld,
        centerWorld: holeCenterWorld,
        startAngle: 0,
        hoverCurve: hoverCurveSpin,
      } satisfies SimGizmoUserData
      this.gizmoGroup.add(spinGizmo)
      this.gizmos.push(spinGizmo)

      // Orbit gizmo: 同中心・同軸、半径 = 二穴間距離
      const clampedOffsetWorld = clampedHole.offset.clone().applyQuaternion(object.quaternion)
      const nonClampedOffsetWorld = nonClampedHole.offset.clone().applyQuaternion(object.quaternion)
      const orbitRadius = Math.max(clampedOffsetWorld.distanceTo(nonClampedOffsetWorld), 0.04)
      const orbitGizmo = this.makeArc(0xff8c00, orbitRadius)
      orbitGizmo.position.copy(holeCenterWorld)
      orbitGizmo.quaternion.copy(axisQuat)
      const hoverCurveOrbit: HoverCurveRing = {
        type: 'ring',
        center: holeCenterWorld.clone(),
        radius: orbitRadius,             // 二穴間距離（可変）
        normal: holeAxisWorld.clone(),
      }
      orbitGizmo.userData = {
        role: 'orbit',
        jointId: joint.id,
        axisWorld: holeAxisWorld,
        centerWorld: holeCenterWorld,
        startAngle: 0,
        hoverCurve: hoverCurveOrbit,
      } satisfies SimGizmoUserData
      this.gizmoGroup.add(orbitGizmo)
      this.gizmos.push(orbitGizmo)
    }
  }

  private makeArc(color: number, radius: number): Mesh<BufferGeometry, MeshBasicMaterial> {
    const geo = new TorusGeometry(radius, GIZMO_VISUAL.torus.thin.tube, 8, 32)
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: GIZMO_VISUAL.torus.thin.opacity, depthTest: false })
    return new Mesh(geo, mat)
  }

  clear() {
    disposeDebugObjects(this.debugObjects)
    // geometry を dispose する前に内部参照だけリセット
    this.hoverManager.reset()
    this.gizmos.forEach(g => {
      g.geometry.dispose();
      (g.material as MeshBasicMaterial).dispose()
    })
    this.gizmoGroup.clear()
    this.debugObjects.clear()
    this.gizmos = []
    this.target = null
    this.isDragging = false
    this.dragging = null
    this.draggingPlane = null
    this.dragStart = null
    this.cachedCenter = null
    this.cachedAxis = null
  }

  // ---- mouse / touch forwarding ----

  private onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    if (t) this.startFromClient(t.clientX, t.clientY)
  }
  private onTouchMove(e: TouchEvent) {
    const t = e.touches[0]
    if (t) this.moveFromClient(t.clientX, t.clientY)
  }
  private onTouchEnd(_e: TouchEvent) { this.endDrag() }

  onMouseDown(event: MouseEvent) { this.startFromClient(event.clientX, event.clientY) }
  onMouseMove(event: MouseEvent) {
    if (!this.isDragging) {
      // ドラッグ中でなければホバー判定のみ実行
      this.hoverManager.update(this.gizmos, event, this.camera, this.domElement, this.gizmoGroup)
      return
    }
    this.moveFromClient(event.clientX, event.clientY)
  }
  onMouseUp(_event: MouseEvent) { this.endDrag() }

  // ---- interaction ----

  private startFromClient(clientX: number, clientY: number) {
    if (!this.target) return
    const rect = this.domElement.getBoundingClientRect()
    const mouse = new Vector2(
      (clientX - rect.left) / rect.width * 2 - 1,
      -(clientY - rect.top) / rect.height * 2 + 1,
    )
    const raycaster = new Raycaster()
    raycaster.setFromCamera(mouse, this.camera)
    const hits = raycaster.intersectObjects(this.gizmos)
    if (hits.length === 0) return
    const hit = hits[0]
    const gizmo = hit.object
    if (!isMeshWithBasicMaterial(gizmo)) return

    this.isDragging = true
    this.dragging = gizmo
    this.domElement.style.cursor = 'grabbing'
    this.dispatchEvent({ type: 'dragging-changed', value: true })

    const ud = gizmo.userData as SimGizmoUserData
    this.cachedAxis = ud.axisWorld.clone().normalize()
    this.cachedCenter = ud.centerWorld.clone()
    this.dragStart = hit.point.clone().sub(this.cachedCenter)
    this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(this.cachedAxis, this.cachedCenter)

    // Store current simulation angle as starting angle for this drag
    const erector = useErector()
    const simState = erector.simulationStates[ud.jointId]
    if (simState?.type === 'pivot') {
      this.dragStartAngle = simState.angle
    } else if (simState?.type === 'free_rotation') {
      this.dragStartAngle = ud.role === 'orbit' ? simState.orbitAngle : simState.spinAngle
    } else {
      this.dragStartAngle = 0
    }

    gizmo.material.opacity = 1.0
    this.dispatchEvent({ type: 'change', value: true })
  }

  private moveFromClient(clientX: number, clientY: number) {
    if (!this.isDragging || !this.dragging || !this.draggingPlane || !this.cachedAxis || !this.cachedCenter || !this.dragStart) return

    const rect = this.domElement.getBoundingClientRect()
    const mouse = new Vector2(
      (clientX - rect.left) / rect.width * 2 - 1,
      -(clientY - rect.top) / rect.height * 2 + 1,
    )
    const raycaster = new Raycaster()
    raycaster.setFromCamera(mouse, this.camera)
    const intersection = new Vector3()
    if (!raycaster.ray.intersectPlane(this.draggingPlane, intersection)) return

    const dragCurrent = intersection.clone().sub(this.cachedCenter)
    const delta = calculateSignedAngle(this.dragStart, dragCurrent, this.cachedAxis)
    const newAngle = this.dragStartAngle + delta

    const ud = this.dragging.userData as SimGizmoUserData
    const erector = useErector()
    if (ud.role === 'pivot') {
      erector.setSimulationAngle(ud.jointId, newAngle)
    } else if (ud.role === 'spin') {
      erector.setSpinAngle(ud.jointId, newAngle)
    } else if (ud.role === 'orbit') {
      erector.setOrbitAngle(ud.jointId, newAngle)
    }
    this.dispatchEvent({ type: 'change', value: true })
  }

  private endDrag() {
    if (!this.isDragging) return
    if (this.dragging) {
      this.dragging = null
    }
    // ドラッグ終了後は全ギズモを thin に戻す（次の mousemove で再評価）
    this.hoverManager.clearAll(this.gizmos)
    this.isDragging = false
    this.draggingPlane = null
    this.dragStart = null
    this.domElement.style.cursor = 'default'
    this.dispatchEvent({ type: 'dragging-changed', value: false })
    this.dispatchEvent({ type: 'change', value: false })
  }

  override dispose() {
    this.domElement.removeEventListener('mousedown', this.onMouseDown.bind(this))
    this.domElement.removeEventListener('mousemove', this.onMouseMove.bind(this))
    this.domElement.removeEventListener('mouseup', this.onMouseUp.bind(this))
    this.domElement.removeEventListener('touchstart', this.onTouchStart.bind(this))
    this.domElement.removeEventListener('touchmove', this.onTouchMove.bind(this))
    this.domElement.removeEventListener('touchend', this.onTouchEnd.bind(this))
    this.clear()
    super.dispose()
  }
}
