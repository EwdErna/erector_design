import type { ErectorComponent, JointMovableDefinition } from "~/types/erector_component";
import erectorComponentDefinition_json from "@/data/erector_component.json"

export const definitions = erectorComponentDefinition_json as unknown as ErectorComponent

export function getMovableDefForJoint(name: string): JointMovableDefinition | undefined {
  const allTypes = [
    ...definitions.pla_joints.categories.flatMap(c => c.types),
    ...definitions.metal_joints,
  ]
  return (allTypes.find(t => t.name === name) as any)?.movable
}