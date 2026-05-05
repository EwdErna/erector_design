/**
 * 角度変換のユーティリティ関数
 * アプリケーション全体で角度の単位を統一するためのヘルパー
 * 
 * 設計方針:
 * - 内部計算: ラジアン（Three.jsのネイティブ単位）
 * - UI表示: 度数（ユーザーフレンドリー）
 * - データ保存: 度数（JSON読みやすさ）
 */

/**
 * 度数をラジアンに変換
 */
export function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180
}

/**
 * ラジアンを度数に変換
 */
export function radiansToDegrees(radians: number): number {
  return radians * 180 / Math.PI
}

/**
 * 角度を正規化（0-360度の範囲に収める）
 */
export function normalizeDegrees(degrees: number): number {
  const normalized = degrees % 360
  return normalized < 0 ? normalized + 360 : normalized
}

/**
 * 角度を正規化（-π to π ラジアンの範囲に収める）
 */
export function normalizeRadians(radians: number): number {
  const normalized = radians % (2 * Math.PI)
  return normalized > Math.PI ? normalized - 2 * Math.PI :
    normalized < -Math.PI ? normalized + 2 * Math.PI : normalized
}

/**
 * 角度を正規化（-180 to 180 度の範囲に収める）
 * connection.rotation の無制限増大を防ぐために使用する
 */
export function normalizeAngle180(degrees: number): number {
  let n = degrees % 360
  if (n > 180) n -= 360
  if (n < -180) n += 360
  return n
}

/**
 * 角度の浮動小数誤差を除去（小数第10位で丸め）
 * calculateWorldPosition がクォータニオンを書き戻す際に生じる
 * オイラー再分解ノイズ（例: -5e-15°、39.9999999...°→40°）を消す
 */
export function roundAngleDegrees(degrees: number): number {
  return Math.round(degrees * 1e10) / 1e10
}
