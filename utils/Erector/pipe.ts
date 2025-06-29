import { BufferGeometry, Vector2, Vector3 } from "three"

export function genPipe(length: number, d: number) {
  const ring = genRing(d)
  const pipe = new BufferGeometry()
  const outer = ring[0].map(p => [new Vector3(p.x, p.y, 0), new Vector3(p.x, p.y, length)]).flat()
  const inner = ring[1].map(p => [new Vector3(p.x, p.y, 0), new Vector3(p.x, p.y, length)]).flat()
  const front = ring[0].map((p, i) => [new Vector3(p.x, p.y, 0), new Vector3(ring[1][i].x, ring[1][i].y, 0)]).flat()
  const back = ring[0].map((p, i) => [new Vector3(p.x, p.y, length), new Vector3(ring[1][i].x, ring[1][i].y, length)]).flat()
  console.log(outer.length, inner.length, front.length, back.length)
  pipe.setFromPoints([...outer, ...inner, ...front, ...back])
  const outer_index = ring[0].map((_, i) => [
    i * 2 + 1, i * 2, ((i + 1) % 32) * 2, ((i + 1) % 32) * 2, ((i + 1) % 32) * 2 + 1, i * 2 + 1
  ]).flat()
  const inner_index = ring[1].map((_, i) => [
    i * 2, i * 2 + 1, ((i + 1) % 32) * 2 + 1, ((i + 1) % 32) * 2 + 1, ((i + 1) % 32) * 2, i * 2
  ]).flat().map(i => i + 64)
  const front_index = ring[0].map((_, i) => [
    i * 2, i * 2 + 1, ((i + 1) % 32) * 2 + 1, ((i + 1) % 32) * 2 + 1, ((i + 1) % 32) * 2, i * 2
  ]).flat().map(i => i + 64 * 2)
  const back_index = ring[0].map((_, i) => [
    i * 2 + 1, i * 2, ((i + 1) % 32) * 2, ((i + 1) % 32) * 2, ((i + 1) % 32) * 2 + 1, i * 2 + 1
  ]).flat().map(i => i + 64 * 3)
  pipe.setIndex([...outer_index, ...inner_index, ...front_index, ...back_index])
  pipe.computeVertexNormals()

  //const pipe = new ShapeGeometry(ring)
  return pipe
}

function genRing(d: number) {
  const t = 0.0007//m
  const r_i = d / 2 - t
  const r_o = d / 2
  const p_o = [...Array<number>(32).keys()].map(i => {
    const theta = i * Math.PI / 16
    const x = r_o * Math.cos(theta)
    const y = r_o * Math.sin(theta)
    return new Vector2(x, y)
  })
  const p_i = [...Array<number>(32).keys()].map(i => {
    const theta = i * Math.PI / 16
    const x = r_i * Math.cos(theta)
    const y = r_i * Math.sin(theta)
    return new Vector2(x, y)
  })
  return [p_o, p_i]
}