// 価格データの型定義。
// data/erector_price.json は (直径×長さ) キー・色非依存の価格表。
// 価格未設定は null で表す。

export type CutMargin = {
  kerf: number       // 1切断あたりの切りしろ [mm]
  minRemnant: number // これ未満の端材・切片は作れない制約 [mm]
}

export type ErectorPriceData = {
  currency: string
  margin: CutMargin
  joints: Record<string, number | null>                    // ジョイント名 -> 単価
  pipes: Record<string, Record<string, number | null>>     // 直径(mm) -> { 長さ(mm) -> 単価 }
}
