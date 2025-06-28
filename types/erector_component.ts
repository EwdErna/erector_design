import type { Quaternion, Vector3 } from "three"

export type ErectorComponent = {
  pipe: ErectorPipeComponent,
  pla_joints: { categories: { name: string, types: ErectorJointComponent[] }[] },
  metal_joints: ErectorJointComponent[],
}
export type ErectorPipeComponent = {
  colors: { name: string, color: string }[],
  diameters: number[],
  lengths: number[],
}
export type ErectorJointComponent = {
  name: string,
  joints?: ErectorJointType[]
}
export type ErectorJointType = {
  through?: boolean,
  start?: [number, number, number],
  to: [number, number, number]
}

export type ErectorJointHole = {
  type: "FIX" | "THROUGH",
  dir: Quaternion // joint自体のz軸に対するholeの方向,
  offset: Vector3 // jointの中心からのオフセット
}

export type ErectorJoint = {
  id: string,
  name: string,
  holes: ErectorJointHole[],
}
export type ErectorPipeConnection = {
  id: string,
  jointId: string,
  holeId: number,
  rotation: number, // pipeに対するjointの回転角度
  position: number, //throughの場合のjointの位置。fixなら無視
}
export type ErectorPipe = {
  id: string,
  diameter: number,
  length: number,
  connections: {
    start?: ErectorPipeConnection,
    end?: ErectorPipeConnection,
    midway: ErectorPipeConnection[]
  }
}

export function isErectorPipe(obj: any): obj is ErectorPipe {
  return obj &&
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.diameter === 'number' &&
    typeof obj.length === 'number' &&
    obj.connections &&
    typeof obj.connections === 'object' &&
    Array.isArray(obj.connections.midway)
}

export function isErectorJoint(obj: any): obj is ErectorJoint {
  return obj &&
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.holes) &&
    obj.holes.every((hole: any) =>
      hole &&
      typeof hole === 'object' &&
      (hole.type === 'FIX' || hole.type === 'THROUGH') &&
      hole.dir &&
      hole.offset
    )
}