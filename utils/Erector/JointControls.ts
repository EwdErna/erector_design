import { BufferGeometry, Camera, Controls, Euler, Group, Line, Mesh, MeshBasicMaterial, Plane, Quaternion, Raycaster, SphereGeometry, TorusGeometry, Vector2, Vector3 } from "three";
import { definitions } from "@/utils/Erector/erectorComponentDefinition";
import type { ErectorJoint, ErectorPipeConnection } from "~/types/erector_component";
import { radiansToDegrees } from "~/utils/angleUtils";

export class JointControls extends Controls<{ change: { value: boolean }, 'dragging-changed': { value: boolean } }> {
  gizmoGroup: Group = new Group()
  gizmos: Mesh[] = []
  target: { joint: ErectorJoint, object: Mesh } | null = null
  camera: Camera
  override domElement: HTMLElement
  isDragging: boolean = false
  dragging: Mesh | null = null
  draggingPlane: Plane | null = null;
  debugObjects: Group = new Group()
  normalLine: Line | null = null;
  dragStartLine: Line | null = null;
  dragStart: Vector3 | null = null;
  dragStartAngle: number = 0;
  dragCurrent: Vector3 | null = null;
  draggingLine: Line | null = null;
  currentAngle: number = 0;
  constructor(camera: Camera, domElement: HTMLElement) {
    super(camera, domElement);
    this.camera = camera
    this.domElement = domElement

    domElement.addEventListener('mousedown', this.onMouseDown.bind(this))
    domElement.addEventListener('mousemove', this.onMouseMove.bind(this))
    domElement.addEventListener('mouseup', this.onMouseUp.bind(this))
  }
  setTarget(joint: ErectorJoint, object: Mesh) {
    this.clear()
    this.target = { joint, object }
    this.createGizmo()
    this.dispatchEvent({ type: 'change', value: true });
  }
  createGizmo() {
    if (!this.target) return;
    const connections = useErectorPipeJoint()
    const joint = this.target.joint


    this.gizmoGroup.position.copy(this.target.object.position)
    this.gizmoGroup.rotation.copy(this.target.object.rotation)

    joint.holes.forEach((j, i) => {
      const rotation = new Quaternion()
      const position = new Vector3()
      if (j.type === "THROUGH") {
        // j.toからtorusの向きを計算
        rotation.copy(j.dir)
        // positionは中心なのでzeroベクトルのまま
      }
      else {
        // j.toからtorusの向きを計算
        rotation.copy(j.dir)
        // j.startからtorusの位置を計算
        position.copy(j.offset).multiplyScalar(4) //ちょっとだけ離す
      }
      const gizmoMesh = new Mesh(new TorusGeometry(0.05, 0.01, 8, 16), new MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 }))
      gizmoMesh.position.copy(position)
      gizmoMesh.quaternion.copy(rotation)
      gizmoMesh.name = `${joint.name}-hole${i}-control`
      const targetPipe = connections.pipes.find(p => {
        if (p.connections.start && p.connections.start.jointId === joint.id && p.connections.start.holeId === i) return true;
        if (p.connections.end && p.connections.end.jointId === joint.id && p.connections.end.holeId === i) return true;
        return p.connections.midway.some(m => m.jointId === joint.id && m.holeId === i);
      })
      let targetConnection: undefined | ErectorPipeConnection = undefined
      if (targetPipe) {
        if (targetPipe.connections.start && targetPipe.connections.start.jointId === joint.id && targetPipe.connections.start.holeId === i) {
          targetConnection = targetPipe.connections.start;
        }
        else if (targetPipe.connections.end && targetPipe.connections.end.jointId === joint.id && targetPipe.connections.end.holeId === i) {
          targetConnection = targetPipe.connections.end;
        }
        else {
          const midway = targetPipe.connections.midway.find(m => m.jointId === joint.id && m.holeId === i);
          if (midway) {
            targetConnection = midway;
          }
        }
      }

      gizmoMesh.userData = {
        joint: joint.name,
        index: i,
        type: 'joint-control',
        normal: new Vector3(0, 0, 1).applyQuaternion(j.dir).toArray(),
        rotation: targetConnection ? targetConnection.rotation : 0
      }

      this.gizmoGroup.add(gizmoMesh)
      this.gizmos.push(gizmoMesh)
    })
  }
  clear() {
    // Properly dispose of debug objects before clearing
    this.disposeDebugObjects()

    this.gizmoGroup.clear()
    this.debugObjects.clear()
    this.gizmos.forEach(g => g.clear())
    this.gizmos = []
    this.target = null
    this.isDragging = false
    this.dragging = null
    this.draggingPlane = null
    this.dragStartLine = null
    this.dragStart = null
    this.dragCurrent = null
    this.draggingLine = null
  }

  onMouseDown(event: MouseEvent) {
    if (!this.target) return;
    const rect = this.domElement.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) / rect.width * 2 - 1;
    const mouseY = -(event.clientY - rect.top) / rect.height * 2 + 1;

    // マウス位置からraycasterを作成
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(mouseX, mouseY), this.camera);

    // gizmoGroup内のオブジェクトと交差するかチェック
    const intersects = raycaster.intersectObjects(this.gizmoGroup.children);
    if (intersects.length > 0) {
      if (!this.isDragging) {
        this.isDragging = true;
        this.domElement.style.cursor = 'grabbing';
        this.dispatchEvent({ type: 'dragging-changed', value: true });
      }
      this.dragging = intersects[0].object as Mesh;
      (this.dragging.material as MeshBasicMaterial).opacity = 0.8;

      const clickSphere = new Mesh(new SphereGeometry(0.01, 16, 16))
      clickSphere.name = `${this.dragging.name}-click-sphere`
      clickSphere.position.copy(intersects[0].point)
      this.debugObjects.add(clickSphere)
      const draggingPlaneNormal = new Vector3().fromArray(this.dragging.userData.normal).applyQuaternion(this.target.object.quaternion).normalize();
      // const normalLineGeometry = new BufferGeometry().setFromPoints([this.target.object.position, this.target.object.position.clone().add(draggingPlaneNormal)]);
      // this.normalLine = new Line(normalLineGeometry, new MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 }));
      // this.debugObjects.add(this.normalLine);
      this.dragStart = intersects[0].point.clone().sub(this.gizmoGroup.localToWorld(this.dragging.position.clone()));

      // Dispose existing dragStartLine if it exists
      this.dragStartLine = this.disposeDebugLine(this.dragStartLine)

      const dragStartLineGeometry = new BufferGeometry().setFromPoints([this.gizmoGroup.localToWorld(this.dragging.position.clone()), intersects[0].point]);
      this.dragStartLine = new Line(dragStartLineGeometry, new MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 }));
      this.debugObjects.add(this.dragStartLine);
      this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(draggingPlaneNormal, this.dragging.localToWorld(new Vector3(0, 0, 0)));
      this.dragStartAngle = this.dragging.userData.rotation;
      this.dispatchEvent({ type: 'change', value: true });
    }
  }
  onMouseMove(event: MouseEvent) {
    if (!this.target || !this.isDragging || !this.dragging || !this.draggingPlane) return;
    const rect = this.domElement.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) / rect.width * 2 - 1;
    const mouseY = -(event.clientY - rect.top) / rect.height * 2 + 1;

    // マウス位置からraycasterを作成
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(mouseX, mouseY), this.camera);
    let intersection = new Vector3();
    raycaster.ray.intersectPlane(this.draggingPlane, intersection);
    const clickSphere = this.debugObjects.getObjectByName(`${this.dragging.name}-click-sphere`);
    if (clickSphere) {
      clickSphere.position.copy(intersection);
    }
    this.dragCurrent = intersection.clone().sub(this.gizmoGroup.localToWorld(this.dragging.position.clone()));
    if (!this.draggingLine) {
      const draggingLineGeometry = new BufferGeometry().setFromPoints([this.gizmoGroup.localToWorld(this.dragging.position.clone()), intersection]);
      this.draggingLine = new Line(draggingLineGeometry, new MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.5 }));
      this.debugObjects.add(this.draggingLine);
    }
    else {
      // Safely update the line geometry, disposing the old one
      this.updateLineGeometry(this.draggingLine, [this.gizmoGroup.localToWorld(this.dragging.position.clone()), intersection]);
    }
    const normal = new Vector3().fromArray(this.dragging.userData.normal).applyQuaternion(this.target.object.quaternion).normalize();
    const a = this.dragStart?.clone() ?? new Vector3(0, 0, 0);
    const b = this.dragCurrent?.clone() ?? new Vector3(0, 0, 0);
    const angle = Math.atan2(normal.clone().dot(a.clone().cross(b)), a.clone().dot(b));
    const dragging = this.dragging;
    const connections = useErectorPipeJoint()
    const targetPipe = connections.pipes.find(p => {
      if (p.connections.start && p.connections.start.jointId === this.target?.joint.id && p.connections.start.holeId === dragging.userData.index) return true;
      if (p.connections.end && p.connections.end.jointId === this.target?.joint.id && p.connections.end.holeId === dragging.userData.index) return true;
      return p.connections.midway.some(m => m.jointId === this.target?.joint.id && m.holeId === dragging.userData.index);
    })
    let targetConnection: undefined | ErectorPipeConnection = undefined
    if (targetPipe) {
      if (targetPipe.connections.start && targetPipe.connections.start.jointId === this.target?.joint.id && targetPipe.connections.start.holeId === dragging.userData.index) {
        targetConnection = targetPipe.connections.start;
      }
      else if (targetPipe.connections.end && targetPipe.connections.end.jointId === this.target?.joint.id && targetPipe.connections.end.holeId === dragging.userData.index) {
        targetConnection = targetPipe.connections.end;
      }
      else {
        const midway = targetPipe.connections.midway.find(m => m.jointId === this.target?.joint.id && m.holeId === dragging.userData.index);
        if (midway) {
          targetConnection = midway;
        }
      }
    }
    if (targetConnection) {
      // Check the pipe-joint relationship to determine rotation direction
      let connectionType: 'start' | 'end' | 'midway' = 'start'
      if (targetPipe?.connections.start?.id === targetConnection.id) {
        connectionType = 'start'
      } else if (targetPipe?.connections.end?.id === targetConnection.id) {
        connectionType = 'end'
      } else {
        connectionType = 'midway'
      }

      const relationshipType = connections.getPipeJointRelationship(
        targetPipe!.id,
        this.target!.joint.id,
        dragging.userData.index,
        connectionType
      )

      // Reverse rotation direction for p2j relationships
      const rotationMultiplier = relationshipType === 'p2j' ? -1 : 1
      const adjustedAngle = angle * rotationMultiplier

      connections.updateConnection(targetConnection.id, { rotation: this.dragStartAngle + radiansToDegrees(adjustedAngle) });
      this.currentAngle = this.dragStartAngle + radiansToDegrees(adjustedAngle);
    } else {
      // Fallback if no connection found
      this.currentAngle = this.dragStartAngle + radiansToDegrees(angle);
    }

    this.dispatchEvent({ type: 'change', value: true });
    this.gizmoGroup.rotation.setFromQuaternion(this.target.object.quaternion)
  }
  onMouseUp(event: MouseEvent) {
    if (this.isDragging) {
      if (this.dragging) {
        this.dragging.userData.rotation = this.currentAngle;
        (this.dragging.material as MeshBasicMaterial).opacity = 0.5;
        this.dragging = null;
      }

      // Properly dispose of debug objects before clearing
      this.disposeDebugObjects();
      this.debugObjects.clear();

      this.draggingPlane = null;
      this.draggingLine = null;
      this.dragStartLine = null;
      this.isDragging = false;
      this.domElement.style.cursor = 'default';

      this.dispatchEvent({ type: 'dragging-changed', value: false });
      this.dispatchEvent({ type: 'change', value: false });
    }
  }

  /**
   * Properly dispose of debug objects to prevent memory leaks
   */
  private disposeDebugObjects() {
    this.debugObjects.traverse((child) => {
      if (child instanceof Mesh) {
        if (child.geometry) {
          child.geometry.dispose()
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose())
          } else {
            child.material.dispose()
          }
        }
      } else if (child instanceof Line) {
        if (child.geometry) {
          child.geometry.dispose()
        }
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

  /**
   * Safely dispose and remove a debug line
   */
  private disposeDebugLine(line: Line | null): Line | null {
    if (line) {
      if (line.geometry) {
        line.geometry.dispose()
      }
      if (line.material) {
        if (Array.isArray(line.material)) {
          line.material.forEach(material => material.dispose())
        } else {
          line.material.dispose()
        }
      }
      this.debugObjects.remove(line)
    }
    return null
  }

  /**
   * Update line geometry safely, disposing old geometry when needed
   */
  private updateLineGeometry(line: Line, points: Vector3[]) {
    // Dispose of the old geometry
    if (line.geometry) {
      line.geometry.dispose()
    }
    // Create new geometry
    line.geometry = new BufferGeometry().setFromPoints(points)
  }

  /**
   * Dispose of all resources when the JointControls instance is no longer needed
   */
  override dispose() {
    // Remove event listeners
    this.domElement.removeEventListener('mousedown', this.onMouseDown.bind(this))
    this.domElement.removeEventListener('mousemove', this.onMouseMove.bind(this))
    this.domElement.removeEventListener('mouseup', this.onMouseUp.bind(this))

    // Clean up all debug objects and gizmos
    this.clear()

    // Dispose of gizmo materials and geometries
    this.gizmoGroup.traverse((child) => {
      if (child instanceof Mesh) {
        if (child.geometry) {
          child.geometry.dispose()
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose())
          } else {
            child.material.dispose()
          }
        }
      }
    })

    // Call parent dispose
    super.dispose()
  }
}