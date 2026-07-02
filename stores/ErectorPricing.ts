import { defineStore } from 'pinia'
import { getPricedDiameters, getStockLengths } from '~/utils/Erector/priceLoader'

const STORAGE_KEY = 'erector-enabled-stock-lengths'

function loadPersisted(): Record<number, number[]> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const out: Record<number, number[]> = {}
    for (const [dia, lens] of Object.entries(parsed)) {
      if (Array.isArray(lens)) out[Number(dia)] = lens.map(Number).filter(n => Number.isFinite(n))
    }
    return out
  } catch {
    return null
  }
}

function defaultAllEnabled(): Record<number, number[]> {
  const out: Record<number, number[]> = {}
  for (const dia of getPricedDiameters()) out[dia] = getStockLengths(dia)
  return out
}

/**
 * 見積で使う既製長さのON/OFF選択を保持する。
 * OFF（＝チェック外し）の長さは取り寄せ扱いで、必要な時のみ探索に投入される。
 */
export const useErectorPricing = defineStore('erectorPricing', {
  state: () => ({
    // 直径(mm) -> 有効な長さ(mm)配列
    enabled: {} as Record<number, number[]>,
    initialized: false,
  }),
  actions: {
    ensureInit() {
      if (this.initialized) return
      const persisted = loadPersisted()
      this.enabled = persisted ?? defaultAllEnabled()
      // 価格表に存在するのに未登録の直径があれば補完（全ON）
      for (const dia of getPricedDiameters()) {
        if (!this.enabled[dia]) this.enabled[dia] = getStockLengths(dia)
      }
      this.initialized = true
    },

    persist() {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.enabled))
      } catch {
        /* ignore quota / privacy-mode errors */
      }
    },

    isEnabled(diameter: number, length: number): boolean {
      return (this.enabled[diameter] ?? []).includes(length)
    },

    toggleLength(diameter: number, length: number) {
      const list = this.enabled[diameter] ? [...this.enabled[diameter]] : []
      const idx = list.indexOf(length)
      if (idx >= 0) list.splice(idx, 1)
      else list.push(length)
      list.sort((a, b) => a - b)
      this.enabled[diameter] = list
      this.persist()
    },

    reset() {
      this.enabled = defaultAllEnabled()
      this.persist()
    },
  },
  getters: {
    /** estimate() に渡す Map<直径, Set<長さ>> 形式。 */
    enabledMap(state): Map<number, Set<number>> {
      const m = new Map<number, Set<number>>()
      for (const [dia, lens] of Object.entries(state.enabled)) {
        m.set(Number(dia), new Set(lens))
      }
      return m
    },
  },
})
