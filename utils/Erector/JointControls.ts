import { Camera, Euler, EventDispatcher, Group, Material, Mesh, MeshBasicMaterial, Object3D, Plane, Quaternion, Raycaster, TorusGeometry, Vector2, Vector3, LineBasicMaterial, BufferGeometry, Line, SphereGeometry } from "three";
import type { ErectorComponent, ErectorJoint, ErectorJointComponent, ErectorJointType, ErectorPipeConnection } from "~/types/erector_component";
import components from "~/data/erector_component.json";
import { degToRad, radToDeg } from "three/src/math/MathUtils.js";
const erectorDefinitions = components as ErectorComponent

export class JointControl extends EventDispatcher<{
  change: { connection: ErectorPipeConnection, rotation: number },
  'dragging-changed': { value: boolean }
}> {
  camera: Camera;
  domElement: HTMLElement;
  enabled: boolean;
  gizmos: Group;
  selectedJoint: { joint: ErectorJoint; object: Object3D } | null;
  activeGizmo: Mesh | null;
  isDragging: boolean;
  startRotation: number;
  startAngle: number;
  lastAngle: number;
  raycaster: Raycaster;
  mouse: Vector2;
  debugObjects: Group;
  intersection: Vector3 | null;
  intersectionStart: Vector3 | null;
  intersectionSphere: SphereGeometry | null;
  intersectionLine: Line | null;
  intersectionStartLine: Line | null;
  startAngleLine: Line | null;
  lastAngleLine: Line | null;
  normalLine: Line | null;

  constructor(camera: Camera, domElement: HTMLElement) {
    super();

    this.camera = camera;
    this.domElement = domElement;
    this.enabled = true;

    this.gizmos = new Group();
    this.debugObjects = new Group();
    this.selectedJoint = null;
    this.activeGizmo = null;
    this.isDragging = false;
    this.startRotation = 0;
    this.startAngle = 0;
    this.lastAngle = 0;
    this.intersection = null;
    this.intersectionStart = null;
    this.intersectionSphere = null;
    this.intersectionLine = null;
    this.intersectionStartLine = null;
    this.startAngleLine = null;
    this.lastAngleLine = null;
    this.normalLine = null;

    this.raycaster = new Raycaster();
    this.mouse = new Vector2();

    this.bindEvents();
  }

  setSelectedJoint(joint: ErectorJoint, jointObject: Object3D) {
    this.clear();
    this.selectedJoint = {
      joint: joint,
      object: jointObject
    };
    this.createGizmos();
  }

  clear() {
    this.gizmos.clear();
    this.debugObjects.clear();
    this.selectedJoint = null;
    this.activeGizmo = null;
    this.startAngleLine = null;
    this.lastAngleLine = null;
    if (this.isDragging) {
      this.dispatchEvent({ type: 'dragging-changed', value: false });
    }
    this.isDragging = false;
  }
  updateGizmosTransform() {
    if (!this.selectedJoint) return;
    this.gizmos.position.copy(this.selectedJoint.object.position);
    this.gizmos.rotation.copy(this.selectedJoint.object.rotation);
  }

  createGizmos() {
    if (!this.selectedJoint) return;
    const joint = this.selectedJoint.joint;
    const jointDef = erectorDefinitions.pla_joints.categories.reduce((ret: ErectorJointComponent | undefined, category) => {
      if (ret) return ret;
      return category.types.find(def => def.name === joint.name);
    }, undefined)
    //jointDefinitions.find(def => def.name === joint.name);
    if (!jointDef) return;

    const erector = useErectorPipeJoint();
    this.gizmos.position.copy(this.selectedJoint.object.position)
    this.gizmos.rotation.copy(this.selectedJoint.object.rotation);
    jointDef.joints?.forEach((hole, holeIndex) => {
      const pipe = erector.pipes.find(pipe => {
        return pipe.connections.start?.jointId === joint.id && pipe.connections.start?.holeId === holeIndex ||
          pipe.connections.end?.jointId === joint.id && pipe.connections.end?.holeId === holeIndex ||
          pipe.connections.midway.some(midway => midway.jointId === joint.id && midway.holeId === holeIndex);
      })
      const connection = !pipe ? undefined : (pipe.connections.start?.jointId === joint.id && pipe.connections.start?.holeId === holeIndex) ? pipe.connections.start :
        (pipe.connections.end?.jointId === joint.id && pipe.connections.end?.holeId === holeIndex) ? pipe.connections.end :
          pipe.connections.midway.find(midway => midway.jointId === joint.id && midway.holeId === holeIndex);

      const gizmo = this.createRotationGizmo(hole, holeIndex, connection);
      this.gizmos.add(gizmo);
    });
  }

  createRotationGizmo(hole: ErectorJointType, holeIndex: number, connection?: ErectorPipeConnection) {
    const group = new Group();

    // gizmoの位置を設定
    if (!hole.through) {
      group.position.fromArray(hole.start?.map(c => c * 5) || [0, 0, 0]);
    }

    // 回転軸の方向ベクトル
    const direction = new Vector3(...hole.to).normalize();

    // トーラス形状のgizmo（接続がある場合は緑、ない場合は灰色）
    const torusGeometry = new TorusGeometry(0.05, 0.005, 8, 24);
    const color = connection ? 0x00ff00 : 0x666666;
    const torusMaterial = new MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: connection ? 0.8 : 0.3
    });
    const torus = new Mesh(torusGeometry, torusMaterial);
    torus.rotation.setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction));

    // // 回転軸に垂直になるようにトーラスを配置
    // if (Math.abs(direction.z) < 0.9) {
    //   const up = new Vector3(0, 0, 1);
    //   const axis = new Vector3().crossVectors(direction, up).normalize();
    //   const angle = Math.acos(direction.dot(up));
    //   torus.rotateOnAxis(axis, angle);
    // } else {
    //   const up = new Vector3(0, 1, 0);
    //   const axis = new Vector3().crossVectors(direction, up).normalize();
    //   const angle = Math.acos(direction.dot(up));
    //   torus.rotateOnAxis(axis, angle);
    // }

    // メタデータを保存
    torus.userData = {
      type: 'rotationGizmo',
      holeIndex: holeIndex,
      connection: connection,
      direction: direction,
      originalColor: color,
      hasConnection: !!connection
    };

    group.add(torus);
    return group;
  }

  bindEvents() {
    this.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.domElement.addEventListener('mouseup', this.onMouseUp.bind(this));
  }

  onMouseDown(event: MouseEvent) {
    if (!this.enabled || !this.selectedJoint) return;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const gizmoMeshes: Mesh[] = [];
    this.gizmos.traverse(child => {
      if (child.userData.type === 'rotationGizmo') {
        gizmoMeshes.push(child as Mesh);
      }
    });

    const intersects = this.raycaster.intersectObjects(gizmoMeshes);

    if (intersects.length > 0) {
      const gizmo = intersects[0].object as Mesh;
      this.activeGizmo = gizmo;
      if (!this.isDragging) {
        this.dispatchEvent({ type: 'dragging-changed', value: true });
      }
      this.isDragging = true;
      this.startRotation = degToRad(gizmo.userData.connection.rotation);
      this.startAngle = this.getAngleOnGizmoPlane(this.mouse);

      // ギズモのワールド位置と法線ベクトルを取得
      const gizmoWorldPos = new Vector3();
      gizmo.getWorldPosition(gizmoWorldPos);
      const gizmosWorldRotation = new Quaternion();
      this.gizmos.getWorldQuaternion(gizmosWorldRotation);
      const normal = gizmo.userData.direction.clone();
      const worldNormal = normal.clone().applyQuaternion(gizmosWorldRotation).normalize();

      // デバッグ線を初期化
      this.updateDebugLines(gizmoWorldPos, worldNormal, this.intersection ?? undefined, this.startAngle, this.startAngle);

      // ハイライト
      const material = gizmo.material;
      if (material instanceof Material) {
        material.blendColor.setHex(0xff0000);
      } else if (Array.isArray(material)) {
        material.forEach(m => m.blendColor.setHex(0xff0000));
      } else {
      }

      this.domElement.style.cursor = 'grabbing';
      event.preventDefault();
    }
  }

  onMouseMove(event: MouseEvent) {
    if (!this.enabled) return;

    this.updateMouse(event);

    if (this.isDragging && this.activeGizmo) {
      // ギズモのワールド位置と法線ベクトルを取得
      const gizmoWorldPos = new Vector3();
      this.activeGizmo.getWorldPosition(gizmoWorldPos);
      const gizmosWorldRotation = new Quaternion();
      this.gizmos.getWorldQuaternion(gizmosWorldRotation);
      const normal = this.activeGizmo.userData.direction.clone();
      const worldNormal = normal.clone().applyQuaternion(gizmosWorldRotation).normalize();

      // 現在のマウス位置から角度を計算
      const currentAngle = this.getAngleOnGizmoPlane(this.mouse);
      let deltaAngle = currentAngle - this.startAngle;

      if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
      if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;


      // 回転を更新
      const newRotation = this.startRotation - deltaAngle;
      this.activeGizmo.userData.connection.rotation = radToDeg(newRotation);

      // 変更イベントを発火
      this.dispatchEvent({
        type: 'change',
        connection: this.activeGizmo.userData.connection,
        rotation: newRotation
      });

      // デバッグ用のラインを更新
      this.updateDebugLines(gizmoWorldPos, worldNormal, this.intersection ?? undefined, this.startAngle, currentAngle);

    } else {
      // ホバー処理
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const gizmoMeshes: Mesh[] = [];
      this.gizmos.traverse(child => {
        if (child.userData.type === 'rotationGizmo') {
          gizmoMeshes.push(child as Mesh);
        }
      });

      const intersects = this.raycaster.intersectObjects(gizmoMeshes);

      // 全てのgizmoの色をリセット
      gizmoMeshes.forEach(mesh => {
        if (!this.isDragging || mesh !== this.activeGizmo) {
          if (mesh.material instanceof Material) {
            mesh.material.blendColor.setHex(mesh.userData.originalColor);
          }
          else {
            mesh.material.forEach(m => m.blendColor.setHex(mesh.userData.originalColor));
          }
        }
      });

      if (intersects.length > 0) {
        const gizmo = intersects[0].object as Mesh;
        if (!this.isDragging) {
          const material = gizmo.material;
          if (material instanceof Material) {
            material.blendColor.setHex(0xffff00);
          }
          else {
            material.forEach(m => m.blendColor.setHex(0xffff00));
          }
          this.domElement.style.cursor = 'grab';
        }
      } else {
        if (!this.isDragging) {
          this.domElement.style.cursor = 'default';
        }
      }
    }
  }

  onMouseUp(event: MouseEvent) {
    if (this.isDragging && this.activeGizmo) {
      // ハイライトを解除
      const material = this.activeGizmo.material;
      if (material instanceof Material) {
        material.blendColor.setHex(this.activeGizmo.userData.originalColor);
      } else {
        const originalColor = this.activeGizmo.userData.originalColor;
        material.forEach(m => m.blendColor.setHex(originalColor));
      }

      this.isDragging = false;
      this.dispatchEvent({ type: 'dragging-changed', value: false })

      // ドラッグ終了時にデバッグ線をクリア
      this.debugObjects.clear();
      this.intersection = null;
      this.intersectionStart = null;
      this.intersectionSphere = null;
      this.intersectionLine = null;
      this.intersectionStartLine = null;
      this.normalLine = null;
      this.startAngleLine = null;
      this.lastAngleLine = null;

      this.activeGizmo = null;
      this.domElement.style.cursor = 'default';
    }
  }
  getAngleOnGizmoPlane(mousePosition: Vector2): number {
    if (!this.activeGizmo) return 0;

    // ギズモのワールド位置を取得
    const gizmoWorldPos = new Vector3();
    this.activeGizmo.getWorldPosition(gizmoWorldPos);
    const gizmoWorldRotation = new Quaternion();
    this.activeGizmo.getWorldQuaternion(gizmoWorldRotation);

    // ギズモの回転軸（法線ベクトル）
    const normal = this.activeGizmo.userData.direction.clone();
    const worldNormal = normal.clone().applyQuaternion(gizmoWorldRotation).normalize();

    // カメラからギズモへの方向ベクトル
    const cameraToGizmo = new Vector3().subVectors(gizmoWorldPos, this.camera.position).normalize();

    // カメラがギズモの表側にいるか裏側にいるかを判定
    // 回転軸との内積で判断（正なら表、負なら裏）
    const dotProduct = cameraToGizmo.dot(worldNormal);
    const isFrontSide = dotProduct <= 0;

    // ギズモ平面上の点を取得するためのレイキャスト
    this.raycaster.setFromCamera(mousePosition, this.camera);

    // 平面との交点を計算
    const plane = new Plane();
    plane.setFromNormalAndCoplanarPoint(worldNormal, gizmoWorldPos);

    const intersection = new Vector3();
    this.raycaster.ray.intersectPlane(plane, intersection);

    if (!intersection) {
      // 交点がない場合は前回の値を返す
      return this.lastAngle || 0;
    }

    this.intersection = intersection.clone();
    if (!this.intersectionStart) {
      this.intersectionStart = intersection.clone();
    }

    // ギズモ中心からの相対ベクトルを計算
    const localPoint = intersection.clone().sub(gizmoWorldPos);
    const localPointStart = this.intersectionStart.clone().sub(gizmoWorldPos);
    // ギズモの向きに合わせて基準となる軸を決定
    // 回転軸と直交するベクトルを求める
    const worldUp = new Vector3(0, 1, 0); // 仮の上方向
    let referenceAxis = new Vector3().crossVectors(normal, worldUp);

    // もし参照軸が小さすぎる場合（normalとworldUpがほぼ平行の場合）
    if (referenceAxis.length() < 0.1) {
      referenceAxis = new Vector3().crossVectors(normal, new Vector3(1, 0, 0));
    }

    referenceAxis.normalize();

    // 2つ目の参照軸（1つ目と直交）
    const secondAxis = new Vector3().crossVectors(normal, referenceAxis).normalize();

    // 平面上での2D座標を計算
    const y = localPoint.dot(referenceAxis);
    const x = localPoint.dot(secondAxis);

    // 角度を計算（ラジアン）
    const angle = Math.atan2(y, x) + Math.PI / 2;

    this.lastAngle = angle;
    return angle;
  }

  getAngleFromMousePosition(gizmoWorldPos: Vector3) {
    // スクリーン座標でのマウス位置から角度を計算
    const gizmoScreen = gizmoWorldPos.clone().project(this.camera);
    const dx = this.mouse.x - gizmoScreen.x;
    const dy = this.mouse.y - gizmoScreen.y;
    return Math.atan2(dy, dx);
  }

  updateMouse(event: MouseEvent) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  // デバッグ用の角度表示線を作成・更新するメソッド
  updateDebugLines(gizmoWorldPos: Vector3, gizmoWorldNormal: Vector3, intersects?: Vector3, startAngle?: number, lastAngle?: number) {
    // 既存のデバッグ線をクリア
    this.debugObjects.clear();
    this.intersectionSphere = null;
    this.intersectionLine = null;
    this.intersectionStartLine = null;
    this.normalLine = null;
    this.startAngleLine = null;
    this.lastAngleLine = null;

    if (!this.activeGizmo) return;

    // 線の長さを設定
    const lineLength = 0.15;

    // 基準となる軸を計算（getAngleOnGizmoPlaneと同様の計算）
    const worldUp = new Vector3(0, 1, 0);
    let referenceAxis = new Vector3().crossVectors(gizmoWorldNormal, worldUp);

    if (referenceAxis.length() < 0.1) {
      referenceAxis = new Vector3().crossVectors(gizmoWorldNormal, new Vector3(1, 0, 0));
    }

    referenceAxis.normalize();
    const secondAxis = new Vector3().crossVectors(gizmoWorldNormal, referenceAxis).normalize();
    const normalDir = gizmoWorldNormal.clone().normalize().multiplyScalar(lineLength * 10);
    const normalGeometry = new BufferGeometry().setFromPoints([
      new Vector3(0, 0, 0),
      normalDir
    ]);
    const normalMaterial = new LineBasicMaterial({ color: 0x0000ff, linewidth: 2 });
    this.normalLine = new Line(normalGeometry, normalMaterial);
    this.normalLine.position.copy(gizmoWorldPos);
    this.debugObjects.add(this.normalLine);

    if (intersects !== undefined) {
      const intersectionGeometry = new SphereGeometry(0.01);
      const intersectionMaterial = new MeshBasicMaterial({ color: 0xffff00 });
      const intersectionMesh = new Mesh(intersectionGeometry, intersectionMaterial);
      intersectionMesh.position.copy(intersects);
      this.debugObjects.add(intersectionMesh);
    }
    if (this.intersectionStart !== null) {
      const intersectionStartGeometry = new BufferGeometry().setFromPoints([
        gizmoWorldPos.clone(),
        this.intersectionStart.clone().normalize().multiplyScalar(lineLength)
      ]);
      const intersectionStartMaterial = new LineBasicMaterial({ color: 0xff00ff, linewidth: 2 });
      this.intersectionStartLine = new Line(intersectionStartGeometry, intersectionStartMaterial);
      this.debugObjects.add(this.intersectionStartLine);
    }

    // startAngle用の線を作成
    if (startAngle !== undefined) {
      const startDir = new Vector3(
        Math.cos(startAngle) * referenceAxis.x + Math.sin(startAngle) * secondAxis.x,
        Math.cos(startAngle) * referenceAxis.y + Math.sin(startAngle) * secondAxis.y,
        Math.cos(startAngle) * referenceAxis.z + Math.sin(startAngle) * secondAxis.z
      ).normalize().multiplyScalar(lineLength);

      const startGeometry = new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        startDir
      ]);

      const startMaterial = new LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
      this.startAngleLine = new Line(startGeometry, startMaterial);
      this.startAngleLine.position.copy(gizmoWorldPos);
      this.debugObjects.add(this.startAngleLine);
    }

    // lastAngle用の線を作成
    if (lastAngle !== undefined) {
      const lastDir = new Vector3(
        Math.cos(lastAngle) * referenceAxis.x + Math.sin(lastAngle) * secondAxis.x,
        Math.cos(lastAngle) * referenceAxis.y + Math.sin(lastAngle) * secondAxis.y,
        Math.cos(lastAngle) * referenceAxis.z + Math.sin(lastAngle) * secondAxis.z
      ).normalize().multiplyScalar(lineLength);

      const lastGeometry = new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        lastDir
      ]);

      const lastMaterial = new LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
      this.lastAngleLine = new Line(lastGeometry, lastMaterial);
      this.lastAngleLine.position.copy(gizmoWorldPos);
      this.debugObjects.add(this.lastAngleLine);
    }
  }
}