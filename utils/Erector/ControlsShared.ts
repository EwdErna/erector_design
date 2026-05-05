import { BufferGeometry, Group, Line, Mesh, MeshBasicMaterial, Vector3 } from "three";

export function isMeshWithBasicMaterial(obj: any): obj is Mesh<BufferGeometry, MeshBasicMaterial> {
  return obj instanceof Mesh &&
    obj.material instanceof MeshBasicMaterial &&
    !Array.isArray(obj.material);
}

export class CoordinateManager {
  constructor(
    private object: Mesh,
    private group: Group
  ) {}

  localToWorldDirection(localDirection: Vector3): Vector3 {
    return localDirection.clone().applyQuaternion(this.object.quaternion).normalize();
  }

  groupLocalToWorld(localPosition: Vector3): Vector3 {
    return this.group.localToWorld(localPosition.clone());
  }

  worldToGroupRelative(worldPosition: Vector3, groupLocalPosition: Vector3): Vector3 {
    return worldPosition.clone().sub(this.groupLocalToWorld(groupLocalPosition));
  }
}

export function calculateSignedAngle(startVector: Vector3, currentVector: Vector3, normal: Vector3): number {
  const crossProduct = startVector.clone().cross(currentVector);
  const sinTheta = normal.clone().dot(crossProduct);
  const cosTheta = startVector.clone().dot(currentVector);
  return Math.atan2(sinTheta, cosTheta);
}

export function applyRelationshipDirection(angle: number, relationshipType: 'j2p' | 'p2j' | null): number {
  return angle * (relationshipType === 'p2j' ? -1 : 1);
}

export function disposeDebugObjects(debugObjects: Group): void {
  debugObjects.traverse((child) => {
    if (child instanceof Mesh || child instanceof Line) {
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

export function updateLineGeometry(line: Line, points: Vector3[]): void {
  if (line.geometry) line.geometry.dispose();
  line.geometry = new BufferGeometry().setFromPoints(points);
}
