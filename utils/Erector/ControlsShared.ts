import { BufferGeometry, Camera, Group, Line, Mesh, MeshBasicMaterial, TorusGeometry, Vector3 } from "three";

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

// ============================================================
// ギズモホバー判定
// ============================================================

/**
 * 断面中心カーブの型定義（グループ local 座標で保持）
 *
 * ring    … トーラス：中心円（半径 radius、平面法線 normal）
 * segment … 円柱/ボックス：軸線分（start〜end）
 * point   … 予備（現在未使用）
 */
export interface HoverCurveRing {
  type: 'ring'
  center: Vector3   // グループローカル
  radius: number
  normal: Vector3   // グループローカル（リング平面の法線）
  sampleCount?: number
}
export interface HoverCurveSegment {
  type: 'segment'
  start: Vector3    // グループローカル
  end: Vector3      // グループローカル
}
export interface HoverCurvePoint {
  type: 'point'
  position: Vector3 // グループローカル（予備）
}
export type HoverCurve = HoverCurveRing | HoverCurveSegment | HoverCurvePoint

/**
 * thin / hover 状態のビジュアル定数
 * ここを変えるだけで全ギズモの見た目を一括変更できる。
 *
 * disk / box の scaleXZ / scaleXY:
 *   disk … CylinderGeometry(r, r, h) + rotateX(π/2)。Y が軸、XZ がディスク面。
 *           scale.set(s, 1, s) で半径のみ変わる。
 *   box  … BoxGeometry(w, h, len)。Z がパイプ軸。
 *           scale.set(s, s, 1) で断面のみ変わる。
 */
export const GIZMO_VISUAL = {
  torus: {
    thin:  { tube: 0.003, opacity: 0.25 },
    hover: { tube: 0.013, opacity: 0.80 },
  },
  cylinder: {
    thin:  { radiusScale: 0.5, opacity: 0.35 },
    hover: { radiusScale: 1.0, opacity: 0.70 },
  },
  disk: {
    thin:  { scaleXZ: 0.75, opacity: 0.20 },
    hover: { scaleXZ: 1.00, opacity: 0.65 },
  },
  box: {
    thin:  { scaleXY: 0.5, opacity: 0.20 },
    hover: { scaleXY: 1.0, opacity: 0.55 },
  },
  hoverThresholdPx: 28,
} as const

// ------------------------------------------------------------
// 内部ユーティリティ
// ------------------------------------------------------------

/** normal に直交する 2 つの単位ベクトル (u, v) を返す */
function getPerpendicularBasis(normal: Vector3): [Vector3, Vector3] {
  const arbitrary = Math.abs(normal.x) < 0.9
    ? new Vector3(1, 0, 0)
    : new Vector3(0, 1, 0)
  const u = arbitrary.clone().cross(normal).normalize()
  const v = normal.clone().cross(u).normalize()
  return [u, v]
}

/** 2D 点 P から線分 AB への最短距離 */
function pointToSegment2D(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ex = px - ax, ey = py - ay
    return Math.sqrt(ex * ex + ey * ey)
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const nx = ax + t * dx - px
  const ny = ay + t * dy - py
  return Math.sqrt(nx * nx + ny * ny)
}

// ------------------------------------------------------------
// 公開ユーティリティ
// ------------------------------------------------------------

/**
 * 断面中心カーブをワールド座標の点列にサンプリングする。
 * group の worldMatrix が最新であることを前提とする。
 */
export function sampleHoverCurveWorld(curve: HoverCurve, group: Group): Vector3[] {
  group.updateWorldMatrix(true, false)

  if (curve.type === 'ring') {
    const N = curve.sampleCount ?? 24
    const [u, v] = getPerpendicularBasis(curve.normal)
    const points: Vector3[] = []
    for (let i = 0; i < N; i++) {
      const angle = (2 * Math.PI * i) / N
      const local = curve.center.clone()
        .addScaledVector(u, curve.radius * Math.cos(angle))
        .addScaledVector(v, curve.radius * Math.sin(angle))
      points.push(group.localToWorld(local))
    }
    points.push(points[0].clone()) // ループを閉じる
    return points

  } else if (curve.type === 'segment') {
    return [
      group.localToWorld(curve.start.clone()),
      group.localToWorld(curve.end.clone()),
    ]

  } else { // 'point'
    return [group.localToWorld(curve.position.clone())]
  }
}

/**
 * ワールド座標の点列をスクリーンに投影し、
 * マウス座標からポリラインへの最短ピクセル距離を返す。
 * カメラ背後の点は除外する。
 */
export function screenPolylineDistance(
  worldPoints: Vector3[],
  event: MouseEvent,
  camera: Camera,
  canvas: HTMLElement,
): number {
  const rect = canvas.getBoundingClientRect()
  const mx = event.clientX - rect.left
  const my = event.clientY - rect.top
  const W = rect.width
  const H = rect.height

  const screen: { x: number; y: number }[] = []
  for (const p of worldPoints) {
    const ndc = p.clone().project(camera)
    if (ndc.z > 1.0) continue // カメラ背後 or far plane 超過
    screen.push({
      x: (ndc.x * 0.5 + 0.5) * W,
      y: (-ndc.y * 0.5 + 0.5) * H,
    })
  }

  if (screen.length === 0) return Infinity
  if (screen.length === 1) {
    const dx = mx - screen[0].x, dy = my - screen[0].y
    return Math.sqrt(dx * dx + dy * dy)
  }

  let minDist = Infinity
  for (let i = 0; i < screen.length - 1; i++) {
    const d = pointToSegment2D(
      mx, my,
      screen[i].x, screen[i].y,
      screen[i + 1].x, screen[i + 1].y,
    )
    if (d < minDist) minDist = d
  }
  return minDist
}

// ------------------------------------------------------------
// GizmoHoverManager
// ------------------------------------------------------------

/**
 * 全ギズモのホバー状態を一元管理する。
 *
 * 使い方:
 *   - onMouseMove の isDragging=false 時に update() を呼ぶ
 *   - clear()/setTarget() 時には reset() を呼ぶ（geometry 操作なしで内部状態だけリセット）
 *   - onMouseUp/endDrag 時には clearAll() を呼ぶ（全ギズモを thin に戻す）
 */
export class GizmoHoverManager {
  private hovered: Mesh | null = null

  /**
   * マウス位置に最も近い断面中心曲線を持つギズモを hovered にする。
   * 状態が変わったときのみ applyState を呼ぶ（geometry 再生成を抑制）。
   */
  update(
    gizmos: Mesh[],
    event: MouseEvent,
    camera: Camera,
    canvas: HTMLElement,
    group: Group,
    threshold: number = GIZMO_VISUAL.hoverThresholdPx,
  ): void {
    if (gizmos.length === 0) return

    let minDist = Infinity
    let newHovered: Mesh | null = null

    for (const gizmo of gizmos) {
      const curve = gizmo.userData.hoverCurve as HoverCurve | undefined
      if (!curve) continue

      const worldPoints = sampleHoverCurveWorld(curve, group)
      const dist = screenPolylineDistance(worldPoints, event, camera, canvas)
      if (dist < minDist) {
        minDist = dist
        newHovered = gizmo
      }
    }

    if (minDist > threshold) newHovered = null
    if (newHovered === this.hovered) return // 変化なし → 再生成しない

    if (this.hovered) this.applyState(this.hovered, false)
    if (newHovered) this.applyState(newHovered, true)
    this.hovered = newHovered
  }

  /**
   * 全ギズモを thin 状態にリセットする。
   * onMouseUp / endDrag 後など、ドラッグ終了時に呼ぶ。
   */
  clearAll(gizmos: Mesh[]): void {
    for (const gizmo of gizmos) this.applyState(gizmo, false)
    this.hovered = null
  }

  /**
   * 内部の hovered 参照だけをクリアする（geometry は触らない）。
   * clear() / setTarget() の前に呼ぶ。
   */
  reset(): void {
    this.hovered = null
  }

  /**
   * userData.type に応じて thin / hover のビジュアルを適用する。
   *
   * joint-control / connection-rotation-control (Torus):
   *   tube半径を geometry 再生成で変更（state変化時のみ呼ばれるので低コスト）
   * position-slider (Cylinder):
   *   scale.set(s, 1, s) で半径方向のみ拡縮（Y 軸が軸方向）
   * pipe-length-control (disk = 薄い Cylinder):
   *   scale.set(s, 1, s) で半径方向のみ拡縮（Y が元の軸 → XZ がディスク面）
   *   + 断面中心が ring(r=0.08) なので endトーラスとは自然に距離競合で分離される
   * connection-position-control (Box):
   *   scale.set(s, s, 1) で断面のみ拡縮（Z がパイプ軸）
   */
  private applyState(mesh: Mesh, isHover: boolean): void {
    if (!isMeshWithBasicMaterial(mesh)) return
    const type = mesh.userData.type as string | undefined

    // SimulationControls のギズモは type を持たず role を持つ → torus として扱う
    if (!type && mesh.userData.role) {
      if (mesh.geometry instanceof TorusGeometry) {
        const { radius, radialSegments, tubularSegments } = mesh.geometry.parameters
        mesh.geometry.dispose()
        mesh.geometry = new TorusGeometry(
          radius,
          isHover ? GIZMO_VISUAL.torus.hover.tube : GIZMO_VISUAL.torus.thin.tube,
          radialSegments,
          tubularSegments,
        )
      }
      mesh.material.opacity = isHover
        ? GIZMO_VISUAL.torus.hover.opacity
        : GIZMO_VISUAL.torus.thin.opacity
      return
    }

    if (type === 'joint-control' || type === 'connection-rotation-control') {
      // トーラス: tube 半径を geometry 再生成で変更
      if (mesh.geometry instanceof TorusGeometry) {
        const { radius, radialSegments, tubularSegments } = mesh.geometry.parameters
        mesh.geometry.dispose()
        mesh.geometry = new TorusGeometry(
          radius,
          isHover ? GIZMO_VISUAL.torus.hover.tube : GIZMO_VISUAL.torus.thin.tube,
          radialSegments,
          tubularSegments,
        )
      }
      mesh.material.opacity = isHover
        ? GIZMO_VISUAL.torus.hover.opacity
        : GIZMO_VISUAL.torus.thin.opacity

    } else if (type === 'position-slider') {
      // 円柱スライダー: XZ スケールで半径を変更（Y が軸方向）
      const s = isHover
        ? GIZMO_VISUAL.cylinder.hover.radiusScale
        : GIZMO_VISUAL.cylinder.thin.radiusScale
      mesh.scale.set(s, 1, s)
      mesh.material.opacity = isHover
        ? GIZMO_VISUAL.cylinder.hover.opacity
        : GIZMO_VISUAL.cylinder.thin.opacity

    } else if (type === 'pipe-length-control') {
      // 平板ディスク: XZ スケールで半径を変更（rotateX(π/2) 済みの薄い円柱）
      const s = isHover
        ? GIZMO_VISUAL.disk.hover.scaleXZ
        : GIZMO_VISUAL.disk.thin.scaleXZ
      mesh.scale.set(s, 1, s)
      mesh.material.opacity = isHover
        ? GIZMO_VISUAL.disk.hover.opacity
        : GIZMO_VISUAL.disk.thin.opacity

    } else if (type === 'connection-position-control') {
      // ボックス: XY スケールで断面を変更（Z がパイプ軸方向）
      const s = isHover
        ? GIZMO_VISUAL.box.hover.scaleXY
        : GIZMO_VISUAL.box.thin.scaleXY
      mesh.scale.set(s, s, 1)
      mesh.material.opacity = isHover
        ? GIZMO_VISUAL.box.hover.opacity
        : GIZMO_VISUAL.box.thin.opacity
    }
  }
}
