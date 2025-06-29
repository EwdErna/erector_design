import { BufferGeometry, Camera, Controls, Group, Line, Mesh, MeshBasicMaterial, Plane, Raycaster, SphereGeometry, Vector2, Vector3, CylinderGeometry } from "three";
import type { ErectorPipe, ErectorPipeConnection } from "~/types/erector_component";

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
 * Manages transformations between different coordinate systems
 */
class PipeCoordinateManager {
  constructor(
    private pipeObject: Mesh,  // The pipe object in world space
    private gizmoGroup: Group   // The gizmo group (pipe local space)
  ) { }

  /**
   * Convert a direction from pipe local space to world space
   */
  pipeLocalToWorldDirection(localDirection: Vector3): Vector3 {
    return localDirection.clone().applyQuaternion(this.pipeObject.quaternion).normalize();
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

  /**
   * Get pipe direction vector in world space (normalized)
   */
  getPipeDirection(): Vector3 {
    // Pipe direction is along the Z-axis in local space
    return this.pipeLocalToWorldDirection(new Vector3(0, 0, 1));
  }
}

/**
 * Length calculation helper
 * Handles length change calculations along pipe axis
 */
class LengthCalculator {
  /**
   * Calculate length change based on drag distance along pipe axis
   * @param dragVector - Vector from drag start to current position
   * @param pipeDirection - Normalized pipe direction vector
   * @param isEndGizmo - Whether this is the end gizmo (affects direction)
   * @returns Length change value
   */
  static calculateLengthChange(dragVector: Vector3, pipeDirection: Vector3, isEndGizmo: boolean): number {
    // Project drag vector onto pipe direction
    const projectedDistance = dragVector.dot(pipeDirection);

    // For end gizmo, positive drag in pipe direction increases length
    return projectedDistance;
  }

  /**
   * Apply minimum length constraint
   * @param newLength - Proposed new length
   * @param minLength - Minimum allowed length
   * @returns Constrained length value
   */
  static applyLengthConstraints(newLength: number, minLength: number = 0.1): number {
    return Math.max(newLength, minLength);
  }
}

export class PipeControls extends Controls<{ change: { value: boolean }, 'dragging-changed': { value: boolean } }> {
  gizmoGroup: Group = new Group()
  gizmos: Mesh[] = []
  target: { pipe: ErectorPipe, object: Mesh } | null = null
  camera: Camera
  override domElement: HTMLElement
  isDragging: boolean = false
  dragging: Mesh<BufferGeometry, MeshBasicMaterial> | null = null
  draggingPlane: Plane | null = null
  debugObjects: Group = new Group()
  dragStart: Vector3 | null = null
  dragStartLength: number = 0
  currentLength: number = 0

  // Coordinate and calculation helpers
  private coordinateManager: PipeCoordinateManager | null = null

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
    this.coordinateManager = new PipeCoordinateManager(object, this.gizmoGroup);
    this.createGizmo()
    this.dispatchEvent({ type: 'change', value: true });
  }

  createGizmo() {
    if (!this.target) return;
    const pipe = this.target.pipe

    this.gizmoGroup.position.copy(this.target.object.position)
    this.gizmoGroup.rotation.copy(this.target.object.rotation)

    // Create length control gizmo at the end of the pipe (Z-axis positive direction)
    const pipeLength = pipe.length

    // End gizmo (at the end of the pipe in Z+ direction)
    // Cylinder aligned with Z-axis (rotate 90 degrees around X-axis)
    const endGizmo = new Mesh(
      new CylinderGeometry(0.08, 0.08, 0.005, 16),
      new MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.6 })
    )
    endGizmo.rotateX(Math.PI / 2) // Rotate to align with Z-axis
    endGizmo.position.set(0, 0, pipeLength)
    endGizmo.name = `${pipe.id}-end-length-control`
    endGizmo.userData = {
      pipe: pipe.id,
      type: 'pipe-length-control',
      isEnd: true,
      length: pipeLength
    }
    this.gizmoGroup.add(endGizmo)
    this.gizmos.push(endGizmo)
  }

  clear() {
    // Properly dispose of debug objects before clearing
    this.disposeDebugObjects()

    this.gizmoGroup.clear()
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
   * Start dragging operation
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

    // Setup coordinate system for length calculation
    this.setupDraggingCoordinates(gizmo, intersectionPoint);

    this.dragStartLength = this.target.pipe.length;
    this.dispatchEvent({ type: 'change', value: true });
  }

  /**
   * Setup coordinates and plane for dragging operation
   */
  private setupDraggingCoordinates(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    if (!this.target || !this.coordinateManager) return;

    // Store drag start position
    this.dragStart = intersectionPoint.clone();

    // Create dragging plane with normal in local Y-axis direction
    const localYNormal = new Vector3(0, 1, 0);
    const worldYNormal = this.coordinateManager.pipeLocalToWorldDirection(localYNormal);

    // Create plane passing through gizmo position with Y-axis normal
    const gizmoWorldPosition = this.coordinateManager.gizmoLocalToWorld(gizmo.position);
    this.draggingPlane = new Plane().setFromNormalAndCoplanarPoint(worldYNormal, gizmoWorldPosition);

    // Create debug line
    this.createDebugLine(gizmoWorldPosition, intersectionPoint);
  }

  onMouseMove(event: MouseEvent) {
    if (!this.target || !this.isDragging || !this.dragging || !this.draggingPlane || !this.coordinateManager) return;

    const currentIntersection = this.getCurrentMouseIntersection(event);
    if (!currentIntersection) return;

    this.updateDebugVisualization(currentIntersection);

    const newLength = this.calculateCurrentLength(currentIntersection);
    this.applyLengthToPipe(newLength);

    this.dispatchEvent({ type: 'change', value: true });
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
   * Calculate current length based on drag distance
   */
  private calculateCurrentLength(currentIntersection: Vector3): number {
    if (!this.dragging || !this.dragStart || !this.coordinateManager || !this.target) return this.dragStartLength;

    // Convert current intersection to pipe local coordinates
    const pipeWorldPosition = this.target.object.position;
    const pipeWorldToLocal = this.target.object.worldToLocal.bind(this.target.object);

    // Get current mouse position in pipe local coordinates
    const currentLocalPos = pipeWorldToLocal(currentIntersection.clone());
    const dragStartLocalPos = pipeWorldToLocal(this.dragStart.clone());

    // Calculate distance from local origin to current position
    const currentDistanceFromOrigin = currentLocalPos.length();
    const dragStartDistanceFromOrigin = dragStartLocalPos.length();

    // Calculate length change as the difference in distances
    const lengthChange = currentDistanceFromOrigin - dragStartDistanceFromOrigin;

    // Apply constraints
    const newLength = LengthCalculator.applyLengthConstraints(
      this.dragStartLength + lengthChange
    );

    return newLength;
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
    const dragLine = this.debugObjects.getObjectByName(`${this.dragging.name}-drag-line`) as Line;
    if (dragLine) {
      this.updateLineGeometry(dragLine, [gizmoWorldPosition, currentIntersection]);
    }
  }

  onMouseUp(event: MouseEvent) {
    if (this.isDragging) {
      if (this.dragging) {
        this.dragging.userData.length = this.currentLength;
        // Type guard to safely update material opacity
        if (isMeshWithBasicMaterial(this.dragging)) {
          this.dragging.material.opacity = 0.6;
        }
        this.dragging = null;
      }

      // Properly dispose of debug objects before clearing
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

  /**
   * Apply calculated length to the pipe
   */
  private applyLengthToPipe(newLength: number) {
    if (!this.target) return;

    const connections = useErectorPipeJoint();
    connections.updatePipe(this.target.pipe.id, 'length', newLength);

    this.currentLength = newLength;

    // Update gizmo positions based on new length
    this.updateGizmoPositions(newLength);
  }

  /**
   * Update gizmo positions when length changes
   */
  private updateGizmoPositions(newLength: number) {
    this.gizmos.forEach(gizmo => {
      if (gizmo.userData.isEnd) {
        gizmo.position.setZ(newLength);
      }
    });
  }

  /**
   * Create debug sphere at intersection point
   */
  private createDebugSphere(gizmo: Mesh<BufferGeometry, MeshBasicMaterial>, intersectionPoint: Vector3) {
    const clickSphere = new Mesh(new SphereGeometry(0.01, 16, 16), new MeshBasicMaterial({ color: 0x00ff00 }));
    clickSphere.name = `${gizmo.name}-click-sphere`;
    clickSphere.position.copy(intersectionPoint);
    this.debugObjects.add(clickSphere);
  }

  /**
   * Create debug line
   */
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

  /**
   * Update line geometry safely, disposing old geometry when needed
   */
  private updateLineGeometry(line: Line, points: Vector3[]) {
    // Dispose of the old geometry
    if (line.geometry) {
      line.geometry.dispose();
    }
    // Create new geometry
    line.geometry = new BufferGeometry().setFromPoints(points);
  }

  /**
   * Properly dispose of debug objects to prevent memory leaks
   */
  private disposeDebugObjects() {
    this.debugObjects.traverse((child) => {
      if (child instanceof Mesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      } else if (child instanceof Line) {
        if (child.geometry) {
          child.geometry.dispose();
        }
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

  /**
   * Dispose of all resources when the PipeControls instance is no longer needed
   */
  override dispose() {
    // Remove event listeners
    this.domElement.removeEventListener('mousedown', this.onMouseDown.bind(this));
    this.domElement.removeEventListener('mousemove', this.onMouseMove.bind(this));
    this.domElement.removeEventListener('mouseup', this.onMouseUp.bind(this));

    // Clean up all debug objects and gizmos
    this.clear();

    // Dispose of gizmo materials and geometries
    this.gizmoGroup.traverse((child) => {
      if (child instanceof Mesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });

    // Call parent dispose
    super.dispose();
  }
}
