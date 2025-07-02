import { BufferGeometry, Camera, Controls, Euler, Group, Line, Mesh, MeshBasicMaterial, Object3D, Plane, Quaternion, Raycaster, SphereGeometry, TorusGeometry, Vector2, Vector3, CylinderGeometry } from "three";
import { definitions } from "@/utils/Erector/erectorComponentDefinition";
import type { ErectorJoint, ErectorPipeConnection, ErectorPipe } from "~/types/erector_component";
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
 * Coordinate system manager for joint controls
 * Clearly separates different coordinate systems and their transformations
 */
class CoordinateManager {
  constructor(
    private jointObject: Mesh,  // The joint object in world space
    private gizmoGroup: Group   // The gizmo group (joint local space)
  ) { }

  /**
   * Convert a direction from joint local space to world space
   */
  jointLocalToWorldDirection(localDirection: Vector3): Vector3 {
    return localDirection.clone().applyQuaternion(this.jointObject.quaternion).normalize();
  }

  /**
   * Convert a position from gizmo local space to world space
   */
  gizmoLocalToWorld(localPosition: Vector3): Vector3 {
    return this.gizmoGroup.localToWorld(localPosition.clone());
  }

  /**
   * Convert a world position to relative position from gizmo
   */
  worldToGizmoRelative(worldPosition: Vector3, gizmoLocalPosition: Vector3): Vector3 {
    return worldPosition.clone().sub(this.gizmoLocalToWorld(gizmoLocalPosition));
  }
}

/**
 * Rotation angle calculator
 * Handles the complex angle calculation logic separately
 */
class RotationCalculator {
  /**
   * Calculate rotation angle between two vectors around a normal
   * Uses scalar triple product to get signed angle
   * @param startVector - Starting position vector (relative to rotation center)
   * @param currentVector - Current position vector (relative to rotation center)
   * @param normal - Rotation axis normal in world space
   * @returns Signed rotation angle in radians
   */
  static calculateSignedAngle(startVector: Vector3, currentVector: Vector3, normal: Vector3): number {
    // Scalar triple product: normal · (start × current)
    // This gives us |start||current|sin(θ) with correct sign
    const crossProduct = startVector.clone().cross(currentVector);
    const sinTheta = normal.clone().dot(crossProduct);

    // Dot product gives us |start||current|cos(θ)
    const cosTheta = startVector.clone().dot(currentVector);

    // atan2 handles the sign correctly and gives us the full range [-π, π]
    return Math.atan2(sinTheta, cosTheta);
  }

  /**
   * Apply relationship-based rotation direction
   * @param angle - Base angle in radians
   * @param relationshipType - Type of pipe-joint relationship
   * @returns Adjusted angle considering relationship direction
   */
  static applyRelationshipDirection(angle: number, relationshipType: 'j2p' | 'p2j' | null): number {
    // For p2j relationships, reverse the rotation direction
    const multiplier = relationshipType === 'p2j' ? -1 : 1;
    return angle * multiplier;
  }
}

export class JointControls extends Controls<{ change: { value: boolean }, 'dragging-changed': { value: boolean } }> {
  gizmoGroup: Group = new Group()
  gizmos: Mesh[] = []
  positionSliders: Mesh[] = []
  target: { joint: ErectorJoint, object: Mesh } | null = null
  camera: Camera
  override domElement: HTMLElement
  isDragging: boolean = false
  dragging: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  draggingPlane: Plane | null = null;
  debugObjects: Group = new Group()
  normalLine: Line | null = null;
  dragStartLine: Line | null = null;
  dragStart: Vector3 | null = null;
  dragStartAngle: number = 0;
  dragCurrent: Vector3 | null = null;
  draggingLine: Line | null = null;
  currentAngle: number = 0;

  // Coordinate and calculation helpers
  private coordinateManager: CoordinateManager | null = null;

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
    this.coordinateManager = new CoordinateManager(object, this.gizmoGroup);
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

      // Create position slider for midway connections on THROUGH holes
      if (j.type === "THROUGH" && targetConnection && this.isMidwayConnection(targetPipe!, targetConnection)) {
        this.createPositionSlider(j, i, targetPipe!, targetConnection, position, rotation)
      }
    })
  }
  clear() {
    // Properly dispose of debug objects before clearing
    this.disposeDebugObjects()

    this.gizmoGroup.clear()
    this.debugObjects.clear()
    this.gizmos.forEach(g => g.clear())
    this.gizmos = []
    this.positionSliders.forEach(s => s.clear())
    this.positionSliders = []
    this.target = null
    this.coordinateManager = null
    this.isDragging = false
    this.dragging = null
    this.draggingPlane = null
    this.dragStartLine = null
    this.dragStart = null
    this.dragCurrent = null
    this.draggingLine = null
  }

  onMouseDown(event: MouseEvent) {
    if (!this.target || !this.coordinateManager) return;

    const intersectedGizmo = this.getIntersectedGizmo(event);
    if (!intersectedGizmo) return;

    this.startDragging(intersectedGizmo.object, intersectedGizmo.point);
  }

  /**
   * Get the intersected gizmo from mouse event
   */
  private getIntersectedGizmo(event: MouseEvent): { object: Mesh<BufferGeometry, MeshBasicMaterial>, point: Vector3 } | null {
    const rect = this.domElement.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) / rect.width * 2 - 1;
    const mouseY = -(event.clientY - rect.top) / rect.height * 2 + 1;

    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(mouseX, mouseY), this.camera);

    const intersects = raycaster.intersectObjects(this.gizmoGroup.children);
    if (intersects.length === 0) return null;

    const intersectedObject = intersects[0].object;
    if (!isMeshWithBasicMaterial(intersectedObject)) {
      console.warn('Intersected object is not a Mesh with MeshBasicMaterial');
      return null;
    }

    return { object: intersectedObject, point: intersects[0].point };
  }

  /**
   * Start dragging operation with clear coordinate system management
   */
  private startDragging(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    if (!this.target || !this.coordinateManager) return;

    // Set dragging state
    this.isDragging = true;
    this.domElement.style.cursor = 'grabbing';
    this.dispatchEvent({ type: 'dragging-changed', value: true });

    this.dragging = gizmo;
    gizmo.material.opacity = 0.8;

    // Create debug sphere at intersection point
    this.createDebugSphere(gizmo, intersectionPoint);

    // Setup coordinate system based on gizmo type
    if (gizmo.userData.type === 'position-slider') {
      this.setupPositionSliderDragging(gizmo, intersectionPoint);
    } else {
      // Original rotation gizmo setup
      this.setupDraggingCoordinates(gizmo, intersectionPoint);
      this.dragStartAngle = gizmo.userData.rotation;
    }

    this.dispatchEvent({ type: 'change', value: true });
  }

  /**
   * Setup coordinates and plane for dragging operation
   */
  private setupDraggingCoordinates(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    if (!this.target || !this.coordinateManager) return;

    // Get normal vector in world space (joint local -> world)
    const gizmoLocalNormal = new Vector3().fromArray(gizmo.userData.normal);
    const worldNormal = this.coordinateManager.jointLocalToWorldDirection(gizmoLocalNormal);

    // Calculate drag start vector (world intersection -> gizmo world position)
    this.dragStart = this.coordinateManager.worldToGizmoRelative(intersectionPoint, gizmo.position);

    // Create dragging plane (perpendicular to normal, passing through gizmo)
    const gizmoWorldPosition = this.coordinateManager.gizmoLocalToWorld(gizmo.position);
    this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(worldNormal, gizmoWorldPosition);

    // Create debug line
    this.createDebugLine(gizmoWorldPosition, intersectionPoint);
  }

  /**
   * Setup coordinates and plane for position slider dragging
   * Simplified approach similar to PipeControls
   */
  private setupPositionSliderDragging(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    if (!this.target || !this.coordinateManager) return;

    this.dragStart = intersectionPoint.clone();
    this.dragStartAngle = gizmo.userData.currentPosition; // Store current position

    // Create dragging plane with normal perpendicular to pipe direction (similar to PipeControls Y-axis approach)
    const pipeDirection = new Vector3().fromArray(gizmo.userData.pipeDirection);
    const worldPipeDirection = this.coordinateManager.jointLocalToWorldDirection(pipeDirection);

    // Use a perpendicular direction to pipe as plane normal
    let planeNormal = new Vector3(0, 1, 0); // Start with Y-axis

    // If pipe direction is too close to Y-axis, use X-axis instead
    if (Math.abs(worldPipeDirection.dot(planeNormal)) > 0.9) {
      planeNormal = new Vector3(1, 0, 0);
    }

    // Make plane normal perpendicular to pipe direction
    planeNormal = planeNormal.clone().cross(worldPipeDirection).normalize();

    const gizmoWorldPosition = this.coordinateManager.gizmoLocalToWorld(gizmo.position);
    this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, gizmoWorldPosition);

    // Create debug line
    this.createDebugLine(gizmoWorldPosition, intersectionPoint);
  }

  onMouseMove(event: MouseEvent) {
    if (!this.target || !this.isDragging || !this.dragging || !this.draggingPlane || !this.coordinateManager) return;

    const currentIntersection = this.getCurrentMouseIntersection(event);
    if (!currentIntersection) return;

    this.updateDebugVisualization(currentIntersection);

    if (this.dragging.userData.type === 'position-slider') {
      const newPosition = this.calculatePositionSliderValue(currentIntersection);
      this.applyPositionToMidwayConnection(newPosition);
    } else {
      const rotationAngle = this.calculateCurrentRotation(currentIntersection);
      this.applyRotationToConnection(rotationAngle);
    }

    this.dispatchEvent({ type: 'change', value: true });
    this.gizmoGroup.rotation.setFromQuaternion(this.target.object.quaternion);
  }

  /**
   * Get current mouse intersection with dragging plane
   */
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

  /**
   * Calculate current rotation angle using clear coordinate system logic
   */
  private calculateCurrentRotation(currentIntersection: Vector3): number {
    if (!this.dragging || !this.dragStart || !this.coordinateManager || !this.target) return 0;

    // Convert current intersection to relative position (same coordinate system as dragStart)
    this.dragCurrent = this.coordinateManager.worldToGizmoRelative(currentIntersection, this.dragging.position);

    // Get world normal for rotation axis
    const gizmoLocalNormal = new Vector3().fromArray(this.dragging.userData.normal);
    const worldNormal = this.coordinateManager.jointLocalToWorldDirection(gizmoLocalNormal);

    // Calculate angle using our dedicated rotation calculator
    const baseAngle = RotationCalculator.calculateSignedAngle(
      this.dragStart,     // Start vector (relative to gizmo)
      this.dragCurrent,   // Current vector (relative to gizmo)  
      worldNormal         // Rotation axis (world space)
    );

    // Apply relationship direction (for pipe-joint interaction)
    const relationshipType = this.getPipeJointRelationshipType();
    const adjustedAngle = RotationCalculator.applyRelationshipDirection(baseAngle, relationshipType);

    return this.dragStartAngle + radiansToDegrees(adjustedAngle);
  }

  /**
   * Calculate new position value for position slider
   * Handles both j2p and p2j relationships correctly
   */
  private calculatePositionSliderValue(currentIntersection: Vector3): number {
    if (!this.dragging || !this.coordinateManager || !this.target) return 0;

    // Get the pipe object from userData (set during slider creation)
    const pipeObject = this.dragging.userData.pipeObject;

    if (!pipeObject) {
      // Fallback: try to find pipe object by ID
      const pipeId = this.dragging.userData.pipeId;
      const connections = useErectorPipeJoint();
      const fallbackPipeObject = connections.instances.find(i => i.id === pipeId)?.obj;
      if (!fallbackPipeObject) return 0;
      this.dragging.userData.pipeObject = fallbackPipeObject; // Cache for future use
    }

    const actualPipeObject = this.dragging.userData.pipeObject;
    const pipeLength = this.dragging.userData.pipeLength;

    // Get relationship type to determine coordinate system approach
    const relationshipType = this.getPipeJointRelationshipType();

    if (relationshipType === 'j2p') {
      // For j2p (joint determines pipe), calculate based on joint's coordinate system
      // and the relative position along the pipe axis
      return this.calculateJ2PPositionValue(currentIntersection, actualPipeObject, pipeLength);
    } else {
      // For p2j (pipe determines joint) or null, use the original pipe-based calculation
      return this.calculateP2JPositionValue(currentIntersection, actualPipeObject, pipeLength);
    }
  }

  /**
   * Calculate position for j2p relationships (joint determines pipe position)
   */
  private calculateJ2PPositionValue(currentIntersection: Vector3, pipeObject: Object3D, pipeLength: number): number {
    if (!this.dragStart || !this.dragging) return this.dragStartAngle;

    const pipeWorldToLocal = pipeObject.worldToLocal.bind(pipeObject);

    // Convert both drag start and current intersection to pipe local coordinates
    const dragStartLocalPos = pipeWorldToLocal(this.dragStart.clone());
    const currentLocalPos = pipeWorldToLocal(currentIntersection.clone());

    // Calculate the difference along the pipe's Z-axis (pipe direction)
    const deltaZ = dragStartLocalPos.z - currentLocalPos.z;

    // Convert the Z difference to position change (normalized by pipe length)
    const positionDelta = deltaZ / pipeLength;

    // Apply the delta to the starting position
    const newPosition = this.dragStartAngle + positionDelta;

    // Clamp to valid range [0, 1]
    return Math.max(0, Math.min(1, newPosition));
  }

  /**
   * Calculate position for p2j relationships (pipe determines joint position)
   */
  private calculateP2JPositionValue(currentIntersection: Vector3, pipeObject: Object3D, pipeLength: number): number {
    const pipeWorldToLocal = pipeObject.worldToLocal.bind(pipeObject);
    const currentLocalPos = pipeWorldToLocal(currentIntersection.clone());
    const clampedZ = Math.max(0, Math.min(pipeLength, currentLocalPos.z));
    const newPosition = clampedZ / pipeLength;

    return newPosition;
  }

  /**
   * Apply new position to midway connection
   */
  private applyPositionToMidwayConnection(newPosition: number) {
    if (!this.dragging) return;

    const connections = useErectorPipeJoint();
    const connectionId = this.dragging.userData.connectionId;

    // Update the connection position
    connections.updateConnection(connectionId, { position: newPosition });

    // Update the position indicator based on relationship type
    const relationshipType = this.getPipeJointRelationshipType();
    this.updatePositionIndicator(this.dragging, newPosition, relationshipType);

    // Store the new position in userData
    this.dragging.userData.currentPosition = newPosition;
    this.currentAngle = newPosition; // Reuse currentAngle for position value
  }

  /**
   * Update position indicator on the slider
   */
  private updatePositionIndicator(sliderMesh: Mesh, newPosition: number, relationshipType?: 'j2p' | 'p2j' | null) {
    const indicator = sliderMesh.getObjectByName(`${sliderMesh.name}-indicator`);
    if (indicator) {
      const sliderLength = sliderMesh.userData.pipeLength;
      const indicatorOffset = (newPosition - 0.5) * sliderLength;

      if (relationshipType === 'j2p') {
        // For j2p: move the slider, keep indicator fixed
        sliderMesh.position.setY(-indicatorOffset);
        // Reset indicator position relative to slider
      }
      indicator.position.setY(indicatorOffset);
    }
  }

  /**
   * Update debug visualization during drag
   */
  private updateDebugVisualization(currentIntersection: Vector3) {
    if (!this.dragging || !this.coordinateManager) return;

    // Update click sphere position
    const clickSphere = this.debugObjects.getObjectByName(`${this.dragging.name}-click-sphere`);
    if (clickSphere) {
      clickSphere.position.copy(currentIntersection);
    }

    // Update dragging line
    const gizmoWorldPosition = this.coordinateManager.gizmoLocalToWorld(this.dragging.position);
    if (!this.draggingLine) {
      const geometry = new BufferGeometry().setFromPoints([gizmoWorldPosition, currentIntersection]);
      this.draggingLine = new Line(geometry, new MeshBasicMaterial({
        color: 0x0000ff,
        transparent: true,
        opacity: 0.5
      }));
      this.debugObjects.add(this.draggingLine);
    } else {
      this.updateLineGeometry(this.draggingLine, [gizmoWorldPosition, currentIntersection]);
    }
  }
  onMouseUp(event: MouseEvent) {
    if (this.isDragging) {
      if (this.dragging) {
        if (this.dragging.userData.type === 'position-slider') {
          this.dragging.userData.currentPosition = this.currentAngle; // currentAngle stores position for sliders
        } else {
          this.dragging.userData.rotation = this.currentAngle;
        }

        // Type guard to safely update material opacity
        if (isMeshWithBasicMaterial(this.dragging)) {
          this.dragging.material.opacity = 0.5;
        }
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
   * Create debug line
   */
  private createDebugLine(startPoint: Vector3, endPoint: Vector3) {
    // Dispose existing line
    this.dragStartLine = this.disposeDebugLine(this.dragStartLine);

    const geometry = new BufferGeometry().setFromPoints([startPoint, endPoint]);
    this.dragStartLine = new Line(geometry, new MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5
    }));
    this.debugObjects.add(this.dragStartLine);
  }

  /**
   * Create debug sphere at intersection point
   */
  private createDebugSphere(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    const clickSphere = new Mesh(new SphereGeometry(0.01, 16, 16));
    clickSphere.name = `${gizmo.name}-click-sphere`;
    clickSphere.position.copy(intersectionPoint);
    this.debugObjects.add(clickSphere);
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

    // Dispose of position slider materials and geometries
    this.positionSliders.forEach(slider => {
      slider.traverse((child) => {
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
    })

    // Call parent dispose
    super.dispose()
  }

  /**
   * Apply calculated rotation to the connection
   */
  private applyRotationToConnection(rotationAngle: number) {
    if (!this.dragging) return;

    const connection = this.findTargetConnection();
    if (connection.targetConnection) {
      const connections = useErectorPipeJoint();
      connections.updateConnection(connection.targetConnection.id, { rotation: rotationAngle });
    }

    this.currentAngle = rotationAngle;
  }

  /**
   * Get pipe-joint relationship type for current dragging gizmo
   */
  private getPipeJointRelationshipType(): 'j2p' | 'p2j' | null {
    if (!this.dragging || !this.target) return null;

    const connection = this.findTargetConnection();
    if (!connection.targetPipe || !connection.targetConnection) return null;

    const connections = useErectorPipeJoint();
    return connections.getPipeJointRelationship(
      connection.targetPipe.id,
      this.target.joint.id,
      this.dragging.userData.index,
      connection.connectionType
    );
  }

  /**
   * Find target pipe and connection for current dragging gizmo
   * Extracted to reduce code duplication
   */
  private findTargetConnection(): {
    targetPipe?: ErectorPipe,
    targetConnection?: ErectorPipeConnection,
    connectionType: 'start' | 'end' | 'midway'
  } {
    if (!this.dragging || !this.target) {
      return { connectionType: 'start' };
    }

    const connections = useErectorPipeJoint();
    const dragging = this.dragging;

    // Find the pipe connected to this gizmo
    const targetPipe = connections.pipes.find(p => {
      if (p.connections.start && p.connections.start.jointId === this.target?.joint.id && p.connections.start.holeId === dragging.userData.index) return true;
      if (p.connections.end && p.connections.end.jointId === this.target?.joint.id && p.connections.end.holeId === dragging.userData.index) return true;
      return p.connections.midway.some(m => m.jointId === this.target?.joint.id && m.holeId === dragging.userData.index);
    });

    if (!targetPipe) {
      return { connectionType: 'start' };
    }

    // Find the specific connection
    if (targetPipe.connections.start && targetPipe.connections.start.jointId === this.target.joint.id && targetPipe.connections.start.holeId === dragging.userData.index) {
      return {
        targetPipe,
        targetConnection: targetPipe.connections.start,
        connectionType: 'start'
      };
    }

    if (targetPipe.connections.end && targetPipe.connections.end.jointId === this.target.joint.id && targetPipe.connections.end.holeId === dragging.userData.index) {
      return {
        targetPipe,
        targetConnection: targetPipe.connections.end,
        connectionType: 'end'
      };
    }

    const midwayConnection = targetPipe.connections.midway.find(m =>
      m.jointId === this.target?.joint.id && m.holeId === dragging.userData.index
    );

    if (midwayConnection) {
      return {
        targetPipe,
        targetConnection: midwayConnection,
        connectionType: 'midway'
      };
    }

    return { connectionType: 'start' };
  }

  /**
   * Check if a connection is a midway connection
   */
  private isMidwayConnection(pipe: ErectorPipe, connection: ErectorPipeConnection): boolean {
    return pipe.connections.midway.some(m => m.id === connection.id);
  }

  /**
   * Create position slider for midway connections
   */
  private createPositionSlider(
    hole: any,
    holeIndex: number,
    pipe: ErectorPipe,
    connection: ErectorPipeConnection,
    basePosition: Vector3,
    baseRotation: Quaternion
  ) {
    if (!this.target) return;

    // Calculate the pipe direction from joint's hole direction and connection rotation
    // This follows the same logic as calculateWorldPosition for midway connections
    const pipeDirection = this.calculatePipeDirectionFromHole(hole, connection.rotation || 0);

    // Create a perpendicular direction for the slider offset (use X-axis as default)
    let offsetDirection = new Vector3(1, 0, 0);

    // If the pipe direction is too close to X-axis, use Y-axis instead
    if (Math.abs(pipeDirection.dot(offsetDirection)) > 0.9) {
      offsetDirection = new Vector3(0, 1, 0);
    }

    // Make offset direction perpendicular to pipe direction
    offsetDirection = offsetDirection.clone().cross(pipeDirection).normalize();

    // Create slider geometry - a thin cylinder representing the full pipe length
    const sliderLength = pipe.length;
    const sliderGeometry = new CylinderGeometry(0.005, 0.005, sliderLength, 8);
    const sliderMaterial = new MeshBasicMaterial({
      color: 0x00ffff, // Cyan for position control
      transparent: true,
      opacity: 0.6
    });

    const sliderMesh = new Mesh(sliderGeometry, sliderMaterial);

    // Position the slider so that its end aligns with the pipe ends
    // First, offset from the hole center perpendicular to pipe direction
    const perpendicularOffset = offsetDirection.clone().multiplyScalar(0.08);

    // Then, move along pipe direction so slider start is at pipe start (position 0)
    // Current joint position represents the midway connection position
    // We need to move back by (connection.position * pipe.length) to get to pipe start
    const connectionPosition = connection.position;
    const pipeStartOffset = pipeDirection.clone().multiplyScalar(-connectionPosition * pipe.length);

    // Finally, move forward by half slider length to center the slider on the pipe
    const sliderCenterOffset = pipeDirection.clone().multiplyScalar(sliderLength / 2);

    sliderMesh.position.copy(basePosition)
      .add(perpendicularOffset)
      .add(pipeStartOffset)
      .add(sliderCenterOffset);

    // Orient the slider along the pipe direction
    // The cylinder's default orientation is along Y-axis, we need to align it with pipe direction
    const cylinderUp = new Vector3(0, 1, 0);
    sliderMesh.quaternion.setFromUnitVectors(cylinderUp, pipeDirection);

    sliderMesh.name = `${this.target.joint.name}-hole${holeIndex}-position-slider`;

    sliderMesh.userData = {
      joint: this.target.joint.name,
      index: holeIndex,
      type: 'position-slider',
      pipeId: pipe.id,
      connectionId: connection.id,
      pipeLength: pipe.length,
      currentPosition: connection.position,
      pipeDirection: pipeDirection.toArray(),
      pipeObject: null // Will be set after finding the pipe object
    };

    // Find and store reference to the pipe object for direct coordinate conversion
    const connections = useErectorPipeJoint();
    const pipeObject = connections.instances.find(i => i.id === pipe.id)?.obj;
    if (pipeObject) {
      sliderMesh.userData.pipeObject = pipeObject;
    }

    this.gizmoGroup.add(sliderMesh);
    this.positionSliders.push(sliderMesh);

    // Create position indicator on the slider
    this.createPositionIndicator(sliderMesh, connection.position, sliderLength);
  }

  /**
   * Create position indicator on the slider
   */
  private createPositionIndicator(
    sliderMesh: Mesh,
    position: number,
    sliderLength: number
  ) {
    const indicatorGeometry = new SphereGeometry(0.015, 8, 8);
    const indicatorMaterial = new MeshBasicMaterial({
      color: 0xff0000, // Red for the indicator
      transparent: true,
      opacity: 0.8
    });

    const indicator = new Mesh(indicatorGeometry, indicatorMaterial);

    // Position the indicator along the slider based on the connection position
    // Position 0 = start of pipe, Position 1 = end of pipe
    // The indicator moves along the slider's local Y-axis (which is aligned with pipe direction)
    const indicatorOffset = (position - 0.5) * sliderLength;
    indicator.position.set(0, indicatorOffset, 0); // Y-axis because slider is oriented along pipe direction

    indicator.name = `${sliderMesh.name}-indicator`;
    indicator.userData = {
      type: 'position-indicator',
      parentSlider: sliderMesh.name
    };

    sliderMesh.add(indicator);
  }

  /**
   * Calculate pipe direction from hole direction and connection rotation
   * This follows the same logic as calculateWorldPosition
   */
  private calculatePipeDirectionFromHole(hole: any, connectionRotation: number): Vector3 {
    // From calculateWorldPosition midway connection logic:
    // const rotation = pipeTransform.rotation.clone()
    //   .multiply(hole.dir.clone()
    //     .multiply(new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(conn.rotation)))).invert())

    // For the pipe direction, we need to understand that:
    // - hole.dir is the hole direction quaternion in joint's local space
    // - connectionRotation is the rotation around the hole's Z-axis
    // - The pipe direction is what the hole direction becomes after applying the connection rotation

    // Apply connection rotation around hole's Z-axis
    const rotationAroundZ = new Quaternion().setFromEuler(new Euler(0, 0, degreesToRadians(connectionRotation)));
    const adjustedHoleDirection = hole.dir.clone().multiply(rotationAroundZ);

    // The pipe direction in joint's local space is the Z-axis transformed by the adjusted hole direction
    const pipeLocalDirection = new Vector3(0, 0, 1).applyQuaternion(adjustedHoleDirection);

    return pipeLocalDirection.normalize();
  }
}