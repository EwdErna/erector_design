import type { CutMargin } from '~/types/erector_price'
import { getJointPrice, getStockPrice, getStockLengths, getMargin } from './priceLoader'

// ------------------------------------------------------------------
// 型
// ------------------------------------------------------------------

export type JointRow = {
  name: string
  count: number
  unitPrice: number | null
  subtotal: number | null
}

export type Stock = {
  length: number       // 既製長さ [mm]
  price: number | null // 単価（未設定は null）
  special: boolean     // 取り寄せ（チェックOffだが必要で投入）
}

export type CutBar = {
  length: number       // 購入する既製棒の長さ [mm]
  price: number | null
  special: boolean
  pieces: number[]     // この棒から切り出す長さ [mm]
  remnant: number      // 端材 [mm]
}

export type CutPlan = {
  diameter: number     // [mm]
  bars: CutBar[]
  total: number | null // 棒価格の合計（未設定価格が含まれる場合 null）
  hasMissingPrice: boolean
  infeasible: number[] // どの既製長にも入らない（最長超過）必要長
  smallPieces: number[]// minRemnant 未満で手切断困難な必要長
}

export type EstimateResult = {
  jointRows: JointRow[]
  jointsTotal: number      // 価格既知分の合計
  jointsMissing: boolean
  pipePlans: CutPlan[]
  pipesTotal: number       // 価格既知分の合計
  pipesMissing: boolean
  grandTotal: number
  anyMissing: boolean
  currency: string
}

// ------------------------------------------------------------------
// マージンモデル
// ------------------------------------------------------------------

/**
 * pieces を長さ L の棒に並べたときの実行可否と端材(scrap)を返す。
 *
 * 切りしろ(kerf)は「隣り合う切片の間」と「最後の切片と端材の間」にだけ入る。
 * - n 個をちょうど並べると内部の切り口は n-1 箇所。最後の切片が棒端に達すれば端材ゼロ・切り口 n-1。
 * - 端材が残る場合は最後の切片を切り離す切り口が1つ増えて n 箇所、端材 = 余り - kerf。
 * 端材は 0（切り落とし不要）か minRemnant 以上でなければならない（30mm未満の端切りは困難）。
 * これにより「300mm素材に300mm」はちょうど一致＝切り口0で収まる。
 */
function packInfo(pieces: number[], L: number, margin: CutMargin): { feasible: boolean; scrap: number } {
  const n = pieces.length
  if (n === 0) return { feasible: true, scrap: L }
  const sum = pieces.reduce((a, b) => a + b, 0)
  const rem = L - (sum + margin.kerf * (n - 1)) // 内部切り口 n-1 だけ入れた残り
  if (rem < 0) return { feasible: false, scrap: rem }
  if (rem === 0) return { feasible: true, scrap: 0 }   // ちょうど一致（切り口 n-1）
  const scrap = rem - margin.kerf                       // 最後の切片を切り離した端材
  if (scrap === 0 || scrap >= margin.minRemnant) return { feasible: true, scrap }
  return { feasible: false, scrap } // 端材が 0 < scrap < minRemnant → 端切り困難で不可
}

/** pieces を長さ L の棒に収められるか（切りしろ + 最小残制約）。 */
function fits(pieces: number[], L: number, margin: CutMargin): boolean {
  return packInfo(pieces, L, margin).feasible
}

// ------------------------------------------------------------------
// 決定的な擬似乱数（再計算で結果がぶれないようにシード固定）
// ------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(arr: number[], rng: () => number): number[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ------------------------------------------------------------------
// パッキング（貪欲 best-fit + コスト考慮の新規棒選択）
// ------------------------------------------------------------------

function chooseNewBar(piece: number, stocks: Stock[], margin: CutMargin): CutBar | null {
  const cands = stocks.filter(s => fits([piece], s.length, margin))
  if (cands.length === 0) return null
  cands.sort((a, b) => {
    const pa = a.price == null ? Infinity : a.price
    const pb = b.price == null ? Infinity : b.price
    if (pa !== pb) return pa - pb        // 価格最小
    return a.length - b.length           // 同値（両方nullも含む）は短い方＝無駄小
  })
  const s = cands[0]
  return {
    length: s.length,
    price: s.price,
    special: s.special,
    pieces: [piece],
    remnant: packInfo([piece], s.length, margin).scrap,
  }
}

function packOnce(order: number[], enabled: Stock[], special: Stock[], margin: CutMargin): CutBar[] {
  const bars: CutBar[] = []
  for (const piece of order) {
    // 既に開いた棒への best-fit（残り最小になる棒へ）
    let bestBar: CutBar | null = null
    let bestRem = Infinity
    for (const bar of bars) {
      const info = packInfo([...bar.pieces, piece], bar.length, margin)
      if (!info.feasible) continue
      if (info.scrap < bestRem) { bestRem = info.scrap; bestBar = bar }
    }
    if (bestBar) {
      bestBar.pieces.push(piece)
      bestBar.remnant = packInfo(bestBar.pieces, bestBar.length, margin).scrap
      continue
    }
    // 新規に棒を開く。まずチェック済み、入らなければ取り寄せから。
    const newBar = chooseNewBar(piece, enabled, margin) ?? chooseNewBar(piece, special, margin)
    if (newBar) bars.push(newBar)
  }
  return bars
}

/** プラン比較用スコア（小さいほど良い）。価格既知なら価格、未知はlengthを代理に。 */
function scorePlan(bars: CutBar[]): number {
  return bars.reduce((acc, b) => acc + (b.price == null ? b.length : b.price), 0)
}

function summarizePlan(bars: CutBar[]): { total: number | null; hasMissingPrice: boolean } {
  let total = 0
  let hasMissingPrice = false
  for (const b of bars) {
    if (b.price == null) hasMissingPrice = true
    else total += b.price
  }
  return { total: hasMissingPrice ? null : total, hasMissingPrice }
}

/**
 * 1直径ぶんの切り出し最適化。random-restart best-fit（局所解）。
 */
export function optimizeCuts(
  diameter: number,
  demandMm: number[],
  enabledStocks: Stock[],
  specialStocks: Stock[],
  margin: CutMargin,
  restarts = 6,
): CutPlan {
  const allStocks = [...enabledStocks, ...specialStocks]

  const infeasible: number[] = []
  const feasibleDemand: number[] = []
  for (const piece of demandMm) {
    if (allStocks.some(s => fits([piece], s.length, margin))) feasibleDemand.push(piece)
    else infeasible.push(piece)
  }
  const smallPieces = feasibleDemand.filter(p => p < margin.minRemnant)

  let best: CutBar[] = []
  let bestScore = Infinity
  const consider = (order: number[]) => {
    const bars = packOnce(order, enabledStocks, specialStocks, margin)
    const s = scorePlan(bars)
    if (s < bestScore) { bestScore = s; best = bars }
  }

  // 1回目は降順の決定的パス
  consider([...feasibleDemand].sort((a, b) => b - a))
  // シード固定のランダム再スタート
  const seed = feasibleDemand.reduce((a, b) => (a + b) | 0, diameter * 2654435761)
  const rng = mulberry32(seed >>> 0)
  for (let i = 0; i < restarts; i++) consider(shuffled(feasibleDemand, rng))

  const { total, hasMissingPrice } = summarizePlan(best)
  return { diameter, bars: best, total, hasMissingPrice, infeasible, smallPieces }
}

// ------------------------------------------------------------------
// 集計
// ------------------------------------------------------------------

export function aggregateJoints(joints: { name: string }[]): JointRow[] {
  const counts = new Map<string, number>()
  for (const j of joints) counts.set(j.name, (counts.get(j.name) ?? 0) + 1)
  const rows: JointRow[] = []
  for (const [name, count] of counts) {
    const unitPrice = getJointPrice(name)
    rows.push({ name, count, unitPrice, subtotal: unitPrice == null ? null : unitPrice * count })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return rows
}

/** 直径(mm) -> 必要長(mm)の配列。内部メートル値を mm に丸める。 */
export function collectPipeDemand(pipes: { diameter: number; length: number }[]): Map<number, number[]> {
  const m = new Map<number, number[]>()
  for (const p of pipes) {
    const dia = Math.round(p.diameter * 1000)
    const len = Math.round(p.length * 1000)
    if (!m.has(dia)) m.set(dia, [])
    m.get(dia)!.push(len)
  }
  return m
}

// ------------------------------------------------------------------
// 総合見積
// ------------------------------------------------------------------

/**
 * @param enabledLengths 直径(mm) -> チェックON の長さ(mm) 集合。
 *        集合に無い長さは取り寄せ扱いで、必要な時のみ探索に投入される。
 */
export function estimate(
  pipes: { diameter: number; length: number }[],
  joints: { name: string }[],
  enabledLengths: Map<number, Set<number>>,
  currency = 'JPY',
): EstimateResult {
  const margin = getMargin()

  const jointRows = aggregateJoints(joints)
  let jointsTotal = 0
  let jointsMissing = false
  for (const r of jointRows) {
    if (r.subtotal == null) jointsMissing = true
    else jointsTotal += r.subtotal
  }

  const demandByDia = collectPipeDemand(pipes)
  const pipePlans: CutPlan[] = []
  let pipesTotal = 0
  let pipesMissing = false

  for (const [dia, demand] of [...demandByDia.entries()].sort((a, b) => a[0] - b[0])) {
    const enabledSet = enabledLengths.get(dia) ?? new Set<number>()
    const enabledStocks: Stock[] = []
    const specialStocks: Stock[] = []
    for (const len of getStockLengths(dia)) {
      const stock: Stock = { length: len, price: getStockPrice(dia, len), special: !enabledSet.has(len) }
      if (enabledSet.has(len)) enabledStocks.push(stock)
      else specialStocks.push(stock)
    }
    const plan = optimizeCuts(dia, demand, enabledStocks, specialStocks, margin)
    pipePlans.push(plan)
    // 価格既知の棒だけ合算し、未設定があればフラグ（ジョイントの集計と同じ方針）
    for (const bar of plan.bars) {
      if (bar.price == null) pipesMissing = true
      else pipesTotal += bar.price
    }
  }

  return {
    jointRows,
    jointsTotal,
    jointsMissing,
    pipePlans,
    pipesTotal,
    pipesMissing,
    grandTotal: jointsTotal + pipesTotal,
    anyMissing: jointsMissing || pipesMissing,
    currency,
  }
}
