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
