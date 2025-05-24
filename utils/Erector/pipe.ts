import { ExtrudeGeometry, Shape, Vector2 } from "three"

export function genPipe(length: number, d: number) {
    const ring = genRing(d)
    const pipe = new ExtrudeGeometry(ring, { depth: length, bevelEnabled: false })
    return pipe
}

function genRing(d: number) {
    const t = 0.0007//m
    const r_i = d / 2 - t
    const r_o = d / 2
    const p_i = [...Array<number>(32).keys()].map(i => {
        const theta = i * Math.PI / 16
        const x = r_o * Math.cos(theta)
        const y = r_o * Math.sin(theta)
        return new Vector2(x, y)
    })
    const p_o = [...Array<number>(32).keys()].map(i => {
        const theta = i * Math.PI / 16
        const x = r_i * Math.cos(theta)
        const y = r_i * Math.sin(theta)
        return new Vector2(x, y)
    })
    const ring = new Shape(p_i)
    ring.holes.push(new Shape(p_o))
    return ring
}