import type { ErectorPriceData, CutMargin } from '~/types/erector_price'
import priceDataRaw from '~/data/erector_price.json'

export const priceData = priceDataRaw as unknown as ErectorPriceData

export function getMargin(): CutMargin {
  return priceData.margin
}

/** ジョイント名から単価を取得。未設定(null)や未登録は null。 */
export function getJointPrice(name: string): number | null {
  const v = priceData.joints[name]
  return typeof v === 'number' ? v : null
}

/** 既製パイプ (直径mm × 長さmm) の単価を取得。未設定(null)や未登録は null。 */
export function getStockPrice(diameterMm: number, lengthMm: number): number | null {
  const v = priceData.pipes[String(diameterMm)]?.[String(lengthMm)]
  return typeof v === 'number' ? v : null
}

/** その直径で価格表に載っている既製長さ(mm)の一覧（昇順）。 */
export function getStockLengths(diameterMm: number): number[] {
  const row = priceData.pipes[String(diameterMm)]
  if (!row) return []
  return Object.keys(row)
    .map(k => Number(k))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b)
}

/** 価格表に載っている全直径(mm)の一覧（昇順）。 */
export function getPricedDiameters(): number[] {
  return Object.keys(priceData.pipes)
    .map(k => Number(k))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b)
}
