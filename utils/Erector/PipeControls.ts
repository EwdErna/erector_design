import { BufferGeometry, Camera, Controls, Group, Line, Mesh, MeshBasicMaterial, Object3D, Plane, Raycaster, SphereGeometry, TorusGeometry, Vector2, Vector3, CylinderGeometry, BoxGeometry } from "three";
import type { ErectorPipe, ErectorPipeConnection, ErectorJoint } from "~/types/erector_component";
import { radiansToDegrees } from "~/utils/angleUtils";

/**
 * Type guard to check if an object is a Mesh with MeshBasicMaterial
 */
function isMeshWithBasicMaterial(obj: any): obj is Mesh<BufferGeometry, MeshBasicMaterial> {
  return obj instanceof Mesh &&
    obj.material instanceof MeshBasicMaterial &&
    !Array.isArray(obj.material);
}

/**
 * Coordinate system manager for pipe controls
 */
class CoordinateManager {
  constructor(
    private pipeObject: Mesh,
    private controlGroup: Group
  ) { }

  pipeLocalToWorldDirection(localDirection: Vector3): Vector3 {
    return localDirection.clone().applyQuaternion(this.pipeObject.quaternion).normalize();
  }

  controlLocalToWorld(localPosition: Vector3): Vector3 {
    return this.controlGroup.localToWorld(localPosition.clone());
  }

  worldToControlRelative(worldPosition: Vector3, gizmoLocalPosition: Vector3): Vector3 {
    return worldPosition.clone().sub(this.controlLocalToWorld(gizmoLocalPosition));
  }

  getPipeDirection(): Vector3 {
    return this.pipeLocalToWorldDirection(new Vector3(0, 0, 1));
  }
}

/**
 * Calculation helpers for different control types
 */
class ControlCalculators {
  /**
   * Calculate length change for pipe length controls
   */
  static calculateLengthChange(dragVector: Vector3, pipeDirection: Vector3, isEndGizmo: boolean): number {
    const projectedDistance = dragVector.dot(pipeDirection);
    return projectedDistance;
  }

  /**
   * Apply length constraints
   */
  static applyLengthConstraints(newLength: number, minLength: number = 0.1): number {
    return Math.max(newLength, minLength);
  }

  /**
   * Calculate rotation angle between two vectors around a normal
   */
  static calculateSignedAngle(startVector: Vector3, currentVector: Vector3, normal: Vector3): number {
    const crossProduct = startVector.clone().cross(currentVector);
    const sinTheta = normal.clone().dot(crossProduct);
    const cosTheta = startVector.clone().dot(currentVector);
    return Math.atan2(sinTheta, cosTheta);
  }

  /**
   * Apply relationship-based rotation direction
   */
  static applyRelationshipDirection(angle: number, relationshipType: 'j2p' | 'p2j' | null): number {
    const multiplier = relationshipType === 'p2j' ? -1 : 1;
    return angle * multiplier;
  }
}

/**
 * Gizmo type definitions
 */
type GizmoType = 'pipe-length-control' | 'connection-rotation-control' | 'connection-position-control';

interface LengthGizmoData {
  type: 'pipe-length-control';
  pipe: string;
  isEnd: boolean;
  length: number;
}

interface ConnectionGizmoData {
  type: 'connection-rotation-control';
  connectionId: string;
  connectionType: 'start' | 'end' | 'midway';
  jointId: string;
  holeId: number;
  joint: ErectorJoint;
  connection: ErectorPipeConnection;
  normal: number[];
  rotation: number;
}

interface PositionGizmoData {
  type: 'connection-position-control';
  connectionId: string;
  connectionType: 'midway';
  jointId: string;
  holeId: number;
  joint: ErectorJoint;
  connection: ErectorPipeConnection;
  position: number; // [0,1] range
}

type GizmoData = LengthGizmoData | ConnectionGizmoData | PositionGizmoData;

export class PipeControls extends Controls<{ change: { value: boolean }, 'dragging-changed': { value: boolean } }> {
  controlGroup: Group = new Group()
  gizmos: Mesh[] = []
  target: { pipe: ErectorPipe, object: Mesh } | null = null
  camera: Camera
  override domElement: HTMLElement
  isDragging: boolean = false
  dragging: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  draggingPlane: Plane | null = null
  debugObjects: Group = new Group()
  dragStart: Vector3 | null = null
  dragStartValue: number = 0 // Can be length, angle, or position depending on gizmo type
  currentValue: number = 0

  private coordinateManager: CoordinateManager | null = null

  constructor(camera: Camera, domElement: HTMLElement) {
    super(camera, domElement);
    this.camera = camera
    this.domElement = domElement

    domElement.addEventListener('mousedown', this.onMouseDown.bind(this))
    domElement.addEventListener('mousemove', this.onMouseMove.bind(this))
    domElement.addEventListener('mouseup', this.onMouseUp.bind(this))
  }

  setTarget(pipe: ErectorPipe, object: Mesh) {
    this.clear()
    this.target = { pipe, object }
    this.coordinateManager = new CoordinateManager(object, this.controlGroup);
    this.createAllGizmos()
    this.dispatchEvent({ type: 'change', value: true });
  }

  createAllGizmos() {
    if (!this.target) return;

    this.controlGroup.position.copy(this.target.object.position)
    this.controlGroup.rotation.copy(this.target.object.rotation)

    // Create length control gizmos
    this.createLengthGizmos()

    // Create connection control gizmos
    this.createConnectionGizmos()
  }

  private createLengthGizmos() {
    if (!this.target) return;

    const pipe = this.target.pipe;
    const pipeLength = pipe.length;

    // End gizmo for length control
    const endGizmo = new Mesh(
      new CylinderGeometry(0.08, 0.08, 0.005, 16),
      new MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.6 })
    )
    endGizmo.rotateX(Math.PI / 2)
    endGizmo.position.set(0, 0, pipeLength)
    endGizmo.name = `${pipe.id}-end-length-control`

    const lengthData: LengthGizmoData = {
      type: 'pipe-length-control',
      pipe: pipe.id,
      isEnd: true,
      length: pipeLength
    }
    endGizmo.userData = lengthData

    this.controlGroup.add(endGizmo)
    this.gizmos.push(endGizmo)
  }
  private createConnectionGizmos() {
    if (!this.target) return;

    const connections = useErectorPipeJoint()
    const pipe = this.target.pipe

    // Create gizmos for each connection
    this.createConnectionGizmo('start', pipe.connections.start || null, connections)
    this.createConnectionGizmo('end', pipe.connections.end || null, connections)

    pipe.connections.midway.forEach((connection, index) => {
      this.createConnectionGizmo('midway', connection, connections, index)
    })
  }

  private createConnectionGizmo(
    connectionType: 'start' | 'end' | 'midway',
    connection: ErectorPipeConnection | null,
    connections: any,
    midwayIndex?: number
  ) {
    if (!connection || !this.target) return;

    // Find the joint for this connection
    const joint = connections.joints.find((j: ErectorJoint) => j.id === connection.jointId)
    if (!joint) return;

    // Calculate position based on connection type
    let position: Vector3
    switch (connectionType) {
      case 'start':
        position = new Vector3(0, 0, 0)
        break
      case 'end':
        position = new Vector3(0, 0, this.target.pipe.length)
        break
      case 'midway':
        // Check if position is relative (0-1) or absolute
        const midwayPos = connection.position;
        const absolutePosition = midwayPos <= 1.0 ? midwayPos * this.target.pipe.length : midwayPos;
        position = new Vector3(0, 0, absolutePosition)
        break
    }

    // Get the hole information from the joint
    const hole = joint.holes[connection.holeId]
    if (!hole) return;

    // Create the gizmo mesh - smaller than length control to avoid overlap
    const gizmoMesh = new Mesh(
      new TorusGeometry(0.05, 0.008, 8, 16), // Smaller than length control
      new MeshBasicMaterial({
        color: this.getConnectionColor(connectionType),
        transparent: true,
        opacity: 0.7
      })
    )

    // Position and orient the gizmo
    gizmoMesh.position.copy(position)

    // For connection gizmos, we need to orient them according to the pipe's connection direction
    // The hole.dir is in joint's local space, but we need it in pipe's local space
    // For now, align with pipe's Z-axis (the pipe direction) as the rotation axis
    // This makes the torus hole face along the pipe direction, which is the intended rotation axis
    const pipeDirection = new Vector3(0, 0, 1); // Pipe's local Z-axis
    const torusNormal = new Vector3(0, 0, 1);   // Torus default normal (hole direction)
    gizmoMesh.quaternion.setFromUnitVectors(torusNormal, pipeDirection);

    if (hole.type !== "THROUGH") {
      const offsetDirection = new Vector3().copy(hole.offset).multiplyScalar(0.03)
      gizmoMesh.position.add(offsetDirection)
    }

    const connectionId = `${this.target.pipe.id}-${connectionType}${midwayIndex !== undefined ? `-${midwayIndex}` : ''}`
    gizmoMesh.name = `${connectionId}-rotation-control`

    const connectionData: ConnectionGizmoData = {
      type: 'connection-rotation-control',
      connectionId,
      connectionType,
      jointId: joint.id,
      holeId: connection.holeId,
      joint,
      connection,
      normal: [0, 0, 1], // Always use pipe's Z-axis as rotation normal
      rotation: connection.rotation || 0
    }

    gizmoMesh.userData = connectionData

    this.controlGroup.add(gizmoMesh)
    this.gizmos.push(gizmoMesh)

    // Create position control gizmo for midway connections
    if (connectionType === 'midway') {
      this.createPositionGizmo(connectionId, connection, joint, position)
    }
  }

  private createPositionGizmo(
    connectionId: string,
    connection: ErectorPipeConnection,
    joint: ErectorJoint,
    jointPosition: Vector3
  ) {
    if (!this.target) return;

    // Create a thin box gizmo offset in the X direction from the joint
    const positionGizmo = new Mesh(
      new BoxGeometry(0.01, 0.01, this.target.pipe.length), // Full pipe length
      new MeshBasicMaterial({
        color: 0x00ffff, // Cyan color for position control
        transparent: true,
        opacity: 0.5
      })
    )

    // Position the gizmo offset from the joint in X direction
    positionGizmo.position.copy(jointPosition)
    positionGizmo.position.x += 0.04 // Offset in local X direction

    // Center the box in the pipe's length
    positionGizmo.position.z = this.target.pipe.length / 2

    positionGizmo.name = `${connectionId}-position-control`

    const positionData: PositionGizmoData = {
      type: 'connection-position-control',
      connectionId,
      connectionType: 'midway',
      jointId: joint.id,
      holeId: connection.holeId,
      joint,
      connection,
      position: connection.position
    }

    positionGizmo.userData = positionData

    this.controlGroup.add(positionGizmo)
    this.gizmos.push(positionGizmo)
  }

  private getConnectionColor(connectionType: 'start' | 'end' | 'midway'): number {
    switch (connectionType) {
      case 'start': return 0x00ff00  // Green
      case 'end': return 0xff0000    // Red  
      case 'midway': return 0xffff00 // Yellow
      default: return 0xff00ff       // Magenta
    }
  }

  clear() {
    this.disposeDebugObjects()
    this.controlGroup.clear()
    this.debugObjects.clear()
    this.gizmos.forEach(g => g.clear())
    this.gizmos = []
    this.target = null
    this.coordinateManager = null
    this.isDragging = false
    this.dragging = null
    this.draggingPlane = null
    this.dragStart = null
  }

  onMouseDown(event: MouseEvent) {
    if (!this.target || !this.coordinateManager) return;

    const intersectedGizmo = this.getIntersectedGizmo(event);
    if (!intersectedGizmo) return;

    this.startDragging(intersectedGizmo.object, intersectedGizmo.point);
  }

  private getIntersectedGizmo(event: MouseEvent): { object: Mesh<BufferGeometry, MeshBasicMaterial>, point: Vector3 } | null {
    const rect = this.domElement.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) / rect.width * 2 - 1;
    const mouseY = -(event.clientY - rect.top) / rect.height * 2 + 1;

    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(mouseX, mouseY), this.camera);

    const intersects = raycaster.intersectObjects(this.controlGroup.children, true);
    if (intersects.length === 0) return null;

    const intersectedObject = intersects[0].object;
    if (!isMeshWithBasicMaterial(intersectedObject)) {
      console.warn('Intersected object is not a Mesh with MeshBasicMaterial');
      return null;
    }

    return { object: intersectedObject, point: intersects[0].point };
  }

  private startDragging(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    if (!this.target || !this.coordinateManager) return;

    this.isDragging = true;
    this.domElement.style.cursor = 'grabbing';
    this.dispatchEvent({ type: 'dragging-changed', value: true });

    this.dragging = gizmo;
    gizmo.material.opacity = 0.8;

    // Create debug sphere
    this.createDebugSphere(gizmo, intersectionPoint);

    // Setup coordinates based on gizmo type
    const gizmoData = gizmo.userData as GizmoData;
    if (gizmoData.type === 'pipe-length-control') {
      this.setupLengthDragging(gizmo, intersectionPoint, gizmoData);
    } else if (gizmoData.type === 'connection-rotation-control') {
      this.setupRotationDragging(gizmo, intersectionPoint, gizmoData);
    } else if (gizmoData.type === 'connection-position-control') {
      this.setupPositionDragging(gizmo, intersectionPoint, gizmoData);
    }

    this.dispatchEvent({ type: 'change', value: true });
  }

  private setupLengthDragging(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3, data: LengthGizmoData) {
    if (!this.target || !this.coordinateManager) return;

    this.dragStart = intersectionPoint.clone();
    this.dragStartValue = this.target.pipe.length;

    // Create dragging plane with normal in local Y-axis direction
    const localYNormal = new Vector3(0, 1, 0);
    const worldYNormal = this.coordinateManager.pipeLocalToWorldDirection(localYNormal);
    const gizmoWorldPosition = this.coordinateManager.controlLocalToWorld(gizmo.position);
    this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(worldYNormal, gizmoWorldPosition);

    this.createDebugLine(gizmoWorldPosition, intersectionPoint);
  }

  private setupRotationDragging(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3, data: ConnectionGizmoData) {
    if (!this.target || !this.coordinateManager) return;

    const gizmoLocalNormal = new Vector3().fromArray(data.normal);
    const worldNormal = this.coordinateManager.pipeLocalToWorldDirection(gizmoLocalNormal);

    this.dragStart = this.coordinateManager.worldToControlRelative(intersectionPoint, gizmo.position);
    this.dragStartValue = data.rotation;

    const gizmoWorldPosition = this.coordinateManager.controlLocalToWorld(gizmo.position);
    this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(worldNormal, gizmoWorldPosition);

    this.createDebugLine(gizmoWorldPosition, intersectionPoint);
  }

  private setupPositionDragging(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3, data: PositionGizmoData) {
    if (!this.target || !this.coordinateManager) return;

    this.dragStart = intersectionPoint.clone();
    this.dragStartValue = data.position;

    // Create dragging plane with normal in local Y-axis direction (same as length control)
    const localYNormal = new Vector3(0, 1, 0);
    const worldYNormal = this.coordinateManager.pipeLocalToWorldDirection(localYNormal);
    const gizmoWorldPosition = this.coordinateManager.controlLocalToWorld(gizmo.position);
    this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(worldYNormal, gizmoWorldPosition);

    this.createDebugLine(gizmoWorldPosition, intersectionPoint);
  }

  onMouseMove(event: MouseEvent) {
    if (!this.target || !this.isDragging || !this.dragging || !this.draggingPlane || !this.coordinateManager) return;

    const currentIntersection = this.getCurrentMouseIntersection(event);
    if (!currentIntersection) return;

    this.updateDebugVisualization(currentIntersection);

    const gizmoData = this.dragging.userData as GizmoData;
    if (gizmoData.type === 'pipe-length-control') {
      this.handleLengthDrag(currentIntersection, gizmoData);
    } else if (gizmoData.type === 'connection-rotation-control') {
      this.handleRotationDrag(currentIntersection, gizmoData);
    } else if (gizmoData.type === 'connection-position-control') {
      this.handlePositionDrag(currentIntersection, gizmoData);
    }

    this.dispatchEvent({ type: 'change', value: true });
  }

  private handleLengthDrag(currentIntersection: Vector3, data: LengthGizmoData) {
    if (!this.target || !this.dragStart || !this.coordinateManager) return;

    const pipeWorldPosition = this.target.object.position;
    const pipeWorldToLocal = this.target.object.worldToLocal.bind(this.target.object);

    const currentLocalPos = pipeWorldToLocal(currentIntersection.clone());
    const dragStartLocalPos = pipeWorldToLocal(this.dragStart.clone());

    const currentDistanceFromOrigin = currentLocalPos.length();
    const dragStartDistanceFromOrigin = dragStartLocalPos.length();
    const lengthChange = currentDistanceFromOrigin - dragStartDistanceFromOrigin;

    const newLength = ControlCalculators.applyLengthConstraints(this.dragStartValue + lengthChange);
    this.applyLengthToPipe(newLength);
  }

  private handleRotationDrag(currentIntersection: Vector3, data: ConnectionGizmoData) {
    if (!this.target || !this.dragStart || !this.coordinateManager || !this.dragging) return;

    const dragCurrent = this.coordinateManager.worldToControlRelative(currentIntersection, this.dragging.position);
    const gizmoLocalNormal = new Vector3().fromArray(data.normal);
    const worldNormal = this.coordinateManager.pipeLocalToWorldDirection(gizmoLocalNormal);

    const baseAngle = ControlCalculators.calculateSignedAngle(this.dragStart, dragCurrent, worldNormal);
    const relationshipType = this.getPipeJointRelationshipType(data);
    let adjustedAngle = ControlCalculators.applyRelationshipDirection(baseAngle, relationshipType);

    // For end connections, reverse the rotation direction
    if (data.connectionType === 'end') {
      adjustedAngle = -adjustedAngle;
    }

    const newRotation = this.dragStartValue + radiansToDegrees(adjustedAngle);
    this.applyRotationToConnection(newRotation, data);
  }

  private handlePositionDrag(currentIntersection: Vector3, data: PositionGizmoData) {
    if (!this.target || !this.dragStart || !this.coordinateManager) return;

    // Get relationship type to determine coordinate system approach
    const relationshipType = this.getPipeJointRelationshipType(data);

    let newPosition: number;

    if (relationshipType === 'j2p') {
      // For j2p (joint determines pipe), calculate based on relative movement
      newPosition = this.calculateJ2PPositionValue(currentIntersection, data);
    } else {
      // For p2j (pipe determines joint) or null, use the original pipe-based calculation
      newPosition = this.calculateP2JPositionValue(currentIntersection, data);
    }

    this.applyPositionToConnection(newPosition, data);
  }

  /**
   * Calculate position for j2p relationships (joint determines pipe position)
   * In pipe controls, this means calculating based on relative movement from drag start
   */
  private calculateJ2PPositionValue(currentIntersection: Vector3, data: PositionGizmoData): number {
    if (!this.dragStart || !this.target) return this.dragStartValue;

    const pipeWorldToLocal = this.target.object.worldToLocal.bind(this.target.object);

    // Convert both drag start and current intersection to pipe local coordinates
    const dragStartLocalPos = pipeWorldToLocal(this.dragStart.clone());
    const currentLocalPos = pipeWorldToLocal(currentIntersection.clone());

    // Calculate the difference along the pipe's Z-axis (pipe direction)
    // For j2p in pipe controls, reverse the direction to match expected behavior
    const deltaZ = dragStartLocalPos.z - currentLocalPos.z;

    // Convert the Z difference to position change (normalized by pipe length)
    const positionDelta = deltaZ / this.target.pipe.length;

    // Apply the delta to the starting position
    const newPosition = this.dragStartValue + positionDelta;

    // Clamp to valid range [0, 1]
    return Math.max(0, Math.min(1, newPosition));
  }

  /**
   * Calculate position for p2j relationships (pipe determines joint position)
   * This is the original pipe-based calculation
   */
  private calculateP2JPositionValue(currentIntersection: Vector3, data: PositionGizmoData): number {
    if (!this.target) return 0;

    // Convert current intersection to pipe's local space
    const pipeWorldToLocal = this.target.object.worldToLocal.bind(this.target.object);
    const currentLocalPos = pipeWorldToLocal(currentIntersection.clone());

    // Calculate position as ratio from start (0) to end (1) of the pipe
    // Clamp the Z position to pipe bounds [0, pipe.length]
    const clampedZ = Math.max(0, Math.min(this.target.pipe.length, currentLocalPos.z));
    const newPosition = clampedZ / this.target.pipe.length;

    return newPosition;
  }

  private getCurrentMouseIntersection(event: MouseEvent): Vector3 | null {
    if (!this.draggingPlane) return null;

    const rect = this.domElement.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) / rect.width * 2 - 1;
    const mouseY = -(event.clientY - rect.top) / rect.height * 2 + 1;

    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(mouseX, mouseY), this.camera);

    const intersection = new Vector3();
    const success = raycaster.ray.intersectPlane(this.draggingPlane, intersection);
    return success ? intersection : null;
  }

  private updateDebugVisualization(currentIntersection: Vector3) {
    if (!this.dragging || !this.coordinateManager) return;

    const clickSphere = this.debugObjects.getObjectByName(`${this.dragging.name}-click-sphere`);
    if (clickSphere) {
      clickSphere.position.copy(currentIntersection);
    }

    const gizmoWorldPosition = this.coordinateManager.controlLocalToWorld(this.dragging.position);
    const dragLine = this.debugObjects.getObjectByName(`${this.dragging.name}-drag-line`) as Line;
    if (dragLine) {
      this.updateLineGeometry(dragLine, [gizmoWorldPosition, currentIntersection]);
    }
  }

  onMouseUp(event: MouseEvent) {
    if (this.isDragging) {
      if (this.dragging) {
        const gizmoData = this.dragging.userData as GizmoData;
        if (gizmoData.type === 'pipe-length-control') {
          (gizmoData as LengthGizmoData).length = this.currentValue;
        } else if (gizmoData.type === 'connection-rotation-control') {
          (gizmoData as ConnectionGizmoData).rotation = this.currentValue;
        }

        if (isMeshWithBasicMaterial(this.dragging)) {
          this.dragging.material.opacity = 0.6;
        }
        this.dragging = null;
      }

      this.disposeDebugObjects();
      this.debugObjects.clear();

      this.draggingPlane = null;
      this.dragStart = null;
      this.isDragging = false;
      this.domElement.style.cursor = 'default';

      this.dispatchEvent({ type: 'dragging-changed', value: false });
      this.dispatchEvent({ type: 'change', value: false });
    }
  }

  private applyLengthToPipe(newLength: number) {
    if (!this.target) return;

    const connections = useErectorPipeJoint();
    connections.updatePipe(this.target.pipe.id, 'length', newLength);
    this.currentValue = newLength;
    this.updateGizmoPositions(newLength);
  }

  private updateGizmoPositions(newLength: number) {
    this.gizmos.forEach(gizmo => {
      const data = gizmo.userData as GizmoData;
      if (data.type === 'pipe-length-control' && (data as LengthGizmoData).isEnd) {
        gizmo.position.setZ(newLength);
      } else if (data.type === 'connection-rotation-control') {
        const connectionData = data as ConnectionGizmoData;
        if (connectionData.connectionType === 'end') {
          gizmo.position.setZ(newLength);
        }
      } else if (data.type === 'connection-position-control') {
        // Update position control gizmo length to match pipe length
        const positionData = data as PositionGizmoData;
        if (gizmo.geometry instanceof BoxGeometry) {
          gizmo.geometry.dispose();
          gizmo.geometry = new BoxGeometry(0.01, 0.01, newLength); // Full pipe length
        }
        gizmo.position.z = newLength / 2;
      }
    });
  }

  private updateConnectionGizmoPositions(data: PositionGizmoData, newPosition: number) {
    if (!this.target) return;

    const absolutePosition = newPosition * this.target.pipe.length;

    // Update both the position gizmo and rotation gizmo for this connection
    this.gizmos.forEach(gizmo => {
      const gizmoData = gizmo.userData as GizmoData;

      // Update the rotation gizmo position
      if (gizmoData.type === 'connection-rotation-control') {
        const rotationData = gizmoData as ConnectionGizmoData;
        if (rotationData.connectionId === data.connectionId) {
          gizmo.position.setZ(absolutePosition);
        }
      }
    });
  }

  private applyRotationToConnection(rotationAngle: number, data: ConnectionGizmoData) {
    const connections = useErectorPipeJoint();
    connections.updateConnection(data.connection.id, { rotation: rotationAngle });
    this.currentValue = rotationAngle;
  }

  private applyPositionToConnection(position: number, data: PositionGizmoData) {
    if (!this.target) return;

    const connections = useErectorPipeJoint();
    connections.updateConnection(data.connection.id, { position });
    this.currentValue = position;

    // Update the position gizmo and associated connection gizmo positions
    // For pipe controls, the visual feedback is primarily through gizmo position updates
    this.updateConnectionGizmoPositions(data, position);

    // Additional visual feedback based on relationship type could be added here
    // For consistency with JointControls, but pipe controls work primarily with gizmo positions
    const relationshipType = this.getPipeJointRelationshipType(data);
    // In pipe controls, both j2p and p2j use the same visual approach since
    // the pipe is the primary reference frame
  }

  private getPipeJointRelationshipType(data: ConnectionGizmoData | PositionGizmoData): 'j2p' | 'p2j' | null {
    if (!this.target) return null;

    const connections = useErectorPipeJoint();
    return connections.getPipeJointRelationship(
      this.target.pipe.id,
      data.jointId,
      data.holeId,
      data.connectionType
    );
  }

  private createDebugSphere(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    const clickSphere = new Mesh(new SphereGeometry(0.01, 16, 16), new MeshBasicMaterial({ color: 0x00ff00 }));
    clickSphere.name = `${gizmo.name}-click-sphere`;
    clickSphere.position.copy(intersectionPoint);
    this.debugObjects.add(clickSphere);
  }

  private createDebugLine(startPoint: Vector3, endPoint: Vector3) {
    if (!this.dragging) return;

    const geometry = new BufferGeometry().setFromPoints([startPoint, endPoint]);
    const line = new Line(geometry, new MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5
    }));
    line.name = `${this.dragging.name}-drag-line`;
    this.debugObjects.add(line);
  }

  private updateLineGeometry(line: Line, points: Vector3[]) {
    if (line.geometry) {
      line.geometry.dispose();
    }
    line.geometry = new BufferGeometry().setFromPoints(points);
  }

  private disposeDebugObjects() {
    this.debugObjects.traverse((child) => {
      if (child instanceof Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      } else if (child instanceof Line) {
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

  override dispose() {
    this.domElement.removeEventListener('mousedown', this.onMouseDown.bind(this));
    this.domElement.removeEventListener('mousemove', this.onMouseMove.bind(this));
    this.domElement.removeEventListener('mouseup', this.onMouseUp.bind(this));

    this.clear();

    this.controlGroup.traverse((child) => {
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

    super.dispose();
  }
}
