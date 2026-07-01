import { defineStore } from 'pinia'
import { Box3, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three'
import type { ErectorBoundary, BoundaryViolation } from '~/types/erector_component'
import { useThree } from '~/stores/three'
import { useErectorScene } from '~/stores/ErectorScene'
import { useErectorGraph } from '~/stores/ErectorGraph'

const _lineObjects = new Map<string, LineSegments>()

function makeBoundaryId() {
  return `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function boundaryToBox3(b: ErectorBoundary): Box3 {
  const [x, y, z] = b.position
  const [sx, sy, sz] = b.size
  return new Box3(
    new Vector3(x, y, z),
    new Vector3(x + sx, y + sy, z + sz)
  )
}

// 面でぴったり接触するだけでは違反とせず、実際にめり込んだ場合のみ true を返す。
// EPS は浮動小数点誤差の吸収用（1e-4 m = 0.1mm）。
const CONTACT_EPS = 1e-4

function boxesOverlap(a: Box3, b: Box3): boolean {
  return (
    a.min.x < b.max.x - CONTACT_EPS && a.max.x > b.min.x + CONTACT_EPS &&
    a.min.y < b.max.y - CONTACT_EPS && a.max.y > b.min.y + CONTACT_EPS &&
    a.min.z < b.max.z - CONTACT_EPS && a.max.z > b.min.z + CONTACT_EPS
  )
}

// objBox が outerBox の内側に収まっているか。面がぴったり一致するのは許容する。
function boxContainsBox(outer: Box3, objBox: Box3): boolean {
  return (
    outer.min.x - CONTACT_EPS <= objBox.min.x && objBox.max.x <= outer.max.x + CONTACT_EPS &&
    outer.min.y - CONTACT_EPS <= objBox.min.y && objBox.max.y <= outer.max.y + CONTACT_EPS &&
    outer.min.z - CONTACT_EPS <= objBox.min.z && objBox.max.z <= outer.max.z + CONTACT_EPS
  )
}

export const useErectorBoundary = defineStore('erectorBoundary', {
  state: () => ({
    boundaries: [] as ErectorBoundary[],
    violations: [] as BoundaryViolation[],
  }),
  getters: {
    outerBoundary: (state) => state.boundaries.find(b => b.type === 'outer'),
    exclusionBoundaries: (state) => state.boundaries.filter(b => b.type === 'exclusion'),
  },
  actions: {
    addBoundary(type: 'outer' | 'exclusion') {
      if (type === 'outer' && this.outerBoundary) return
      const id = makeBoundaryId()
      const count = type === 'exclusion' ? this.exclusionBoundaries.length + 1 : undefined
      const boundary: ErectorBoundary = {
        id,
        type,
        label: type === 'outer' ? '設置可能領域' : `除外領域${count}`,
        position: [0, 0, 0],
        size: [2, 2, 2],
      }
      this.boundaries.push(boundary)
      this._rebuildLineObject(boundary)
    },

    removeBoundary(id: string) {
      const three = useThree()
      const line = _lineObjects.get(id)
      if (line && three.scene) {
        three.scene.remove(line)
        line.geometry.dispose()
        ;(line.material as LineBasicMaterial).dispose()
      }
      _lineObjects.delete(id)
      this.boundaries = this.boundaries.filter(b => b.id !== id)
      this.violations = this.violations.filter(v => v.boundaryId !== id)
    },

    updateBoundary(id: string, updates: Partial<Pick<ErectorBoundary, 'label' | 'position' | 'size'>>) {
      const boundary = this.boundaries.find(b => b.id === id)
      if (!boundary) return
      if (updates.label !== undefined) boundary.label = updates.label
      if (updates.position) boundary.position = updates.position
      if (updates.size) boundary.size = updates.size
      this._rebuildLineObject(boundary)
    },

    _rebuildLineObject(boundary: ErectorBoundary) {
      const three = useThree()
      if (!three.scene) return
      const existing = _lineObjects.get(boundary.id)
      if (existing) {
        three.scene.remove(existing)
        existing.geometry.dispose()
        ;(existing.material as LineBasicMaterial).dispose()
      }
      const [px, py, pz] = boundary.position
      const [sx, sy, sz] = boundary.size
      const geo = new BoxGeometry(sx, sy, sz)
      const edges = new EdgesGeometry(geo)
      geo.dispose()
      const color = boundary.type === 'outer' ? 0x00cc44 : 0xcc2200
      const mat = new LineBasicMaterial({ color })
      const line = new LineSegments(edges, mat)
      line.position.set(px + sx / 2, py + sy / 2, pz + sz / 2)
      _lineObjects.set(boundary.id, line)
      three.scene.add(line)
    },

    clearAll() {
      const three = useThree()
      for (const [, line] of _lineObjects) {
        if (three.scene) three.scene.remove(line)
        line.geometry.dispose()
        ;(line.material as LineBasicMaterial).dispose()
      }
      _lineObjects.clear()
      this.boundaries = []
      this.violations = []
    },

    loadBoundaries(boundaries: ErectorBoundary[]) {
      this.clearAll()
      this.boundaries = boundaries
      this.syncAllToScene()
    },

    syncAllToScene() {
      for (const b of this.boundaries) {
        this._rebuildLineObject(b)
      }
    },

    checkInterference() {
      if (this.boundaries.length === 0) {
        if (this.violations.length > 0) this.violations = []
        return
      }
      const erectorScene = useErectorScene()
      const erectorGraph = useErectorGraph()
      const outer = this.outerBoundary
      const outerBox = outer ? boundaryToBox3(outer) : null
      const exclusions = this.exclusionBoundaries.map(b => ({ b, box: boundaryToBox3(b) }))
      const violations: BoundaryViolation[] = []
      const seen = new Set<string>()

      for (const inst of erectorScene.instances) {
        if (!inst.obj) continue
        const objBox = new Box3().setFromObject(inst.obj)
        const objectType = erectorGraph.pipes.some(p => p.id === inst.id) ? 'pipe' : 'joint'

        if (outerBox && !boxContainsBox(outerBox, objBox)) {
          const key = `${inst.id}|${outer!.id}`
          if (!seen.has(key)) {
            seen.add(key)
            violations.push({
              objectId: inst.id,
              objectType,
              boundaryId: outer!.id,
              boundaryType: 'outer',
              label: outer!.label,
            })
          }
        }

        for (const { b, box } of exclusions) {
          if (boxesOverlap(box, objBox)) {
            const key = `${inst.id}|${b.id}`
            if (!seen.has(key)) {
              seen.add(key)
              violations.push({
                objectId: inst.id,
                objectType,
                boundaryId: b.id,
                boundaryType: 'exclusion',
                label: b.label,
              })
            }
          }
        }
      }

      this.violations = violations
    },
  },
})
