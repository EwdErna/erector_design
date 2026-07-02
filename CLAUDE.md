# Erector Design - CLAUDE.md

## プロジェクト概要

矢崎の「イレクター」パイプ＆ジョイントシステムを使った構造物を設計するWeb CADアプリ。
Three.js で3Dリアルタイム描画し、パイプとジョイントの接続関係を管理・バリデーションする。
モバイル対応（タッチ操作 + BottomSheet UI）、可動ジョイントのシミュレーションモード、
undo/redo、配置境界（バウンダリ）チェック、価格見積もり機能を搭載。

## 技術スタック

| 種別 | 技術 |
|------|------|
| フレームワーク | Nuxt 3 (v3.16.2) + Vue 3 (v3.5.13) |
| 言語 | TypeScript |
| 3D描画 | Three.js (v0.175.0) |
| 状態管理 | Pinia (v3.0.2) |
| パッケージ管理 | pnpm |
| Node.js | v24.12 |

## ディレクトリ構造

```
erector_design/
├── app.vue                               # ルートコンポーネント（デスクトップ3パネル＋モバイルレイアウト）
├── components/
│   ├── Navigation.vue                    # ヘッダー（シミュレーション切替/見積/Download/Upload）
│   ├── SelectComponents.vue              # 左パネル：コンポーネント選択
│   ├── RightPanel.vue                    # 右パネル：編集/バウンダリのタブ切替
│   ├── EditComponent.vue                 # プロパティ編集
│   ├── BoundaryEditor.vue                # 配置境界（設置可能領域・除外領域）の編集
│   ├── CostEstimateDialog.vue            # 価格見積もりダイアログ
│   ├── InvalidConnections.vue            # バリデーションエラーオーバーレイ
│   ├── SelectPipe.vue / SelectPlaJoint.vue / SelectMetalJoint.vue
│   ├── BottomSheet.vue                   # モバイル用ボトムシート（パーツ/編集/エラー/バウンダリ タブ）
│   ├── FloatingFileButtons.vue           # モバイル用浮動ボタン（見積¥/アップロード/ダウンロード）
│   └── ThreeD/Scene.vue                  # Three.jsシーン管理（タッチ対応・キーボードショートカット）
├── composables/
│   ├── useErector.ts                     # ★ファサード：graph/scene/validation/simulation/history を統合
│   ├── useBottomSheet.ts                 # ボトムシートの開閉・タブ状態管理
│   └── useCostEstimate.ts                # 見積ダイアログの開閉状態
├── stores/
│   ├── ErectorGraph.ts                   # パイプ・ジョイント・接続関係のデータ構造管理
│   ├── ErectorScene.ts                   # Three.jsオブジェクト管理・ワールド位置計算（★最重要）
│   ├── ErectorValidation.ts              # 接続バリデーションロジック
│   ├── ErectorSimulation.ts              # シミュレーションモード状態管理
│   ├── ErectorHistory.ts                 # undo/redo スナップショットスタック
│   ├── ErectorBoundary.ts                # 配置境界の管理・干渉チェック
│   ├── ErectorPricing.ts                 # 見積用の既製長さON/OFF設定（localStorage永続化）
│   ├── ObjectSelection.ts                # 選択状態管理
│   ├── three.ts                          # Three.jsシーン参照
│   └── ErectorPipeJoint.ts               # ⚠️ 非推奨：useErector()への後方互換re-export
├── utils/
│   ├── angleUtils.ts                     # 角度変換（度数 ↔ ラジアン）
│   └── Erector/
│       ├── pipe.ts                       # パイプジオメトリ生成
│       ├── erectorComponentDefinition.ts # カタログローダー + getMovableDefForJoint()
│       ├── ControlsShared.ts             # ギズモ共通ユーティリティ（ホバー検出・軸制約等）
│       ├── JointControls.ts              # ジョイント操作ギズモ
│       ├── PipeControls.ts               # パイプ操作ギズモ
│       ├── SimulationControls.ts         # シミュレーションモード用ギズモ
│       ├── cuttingStock.ts               # 見積計算（カッティングストック問題の探索）
│       └── priceLoader.ts                # 価格表ローダー
├── types/
│   ├── erector_component.ts              # 型定義（可動ジョイント型・境界型含む）
│   └── erector_price.ts                  # 価格データ型定義
└── data/
    ├── erector_component.json            # イレクターカタログデータ
    └── erector_price.json                # 価格表（直径×長さ・ジョイント名 -> 単価）
```

## UIレイアウト

### デスクトップ（min-width: 769px または pointer: fine）
```
┌─────────────────────────────────────────┐
│          Navigation Bar (64px)          │
├──────────┬──────────────────┬───────────┤
│ Select   │  3D Scene (80%)  │ RightPanel│
│ (25%)    ├──────────────────┤ 編集/バウ │
│          │  Errors (20%)    │ ンダリ(25%)│
└──────────┴──────────────────┴───────────┘
│ Footer (20px)                           │
└─────────────────────────────────────────┘
```

### モバイル（max-width: 768px かつ pointer: coarse）
```
┌─────────────────────────────────────────┐
│  [¥][↑][↓] ← FloatingFileButtons        │
│                                         │
│           3D Scene (全画面)              │
│                                         │
├─────────────────────────────────────────┤
│ [パーツ] [編集] [エラー🔴] [バウンダリ]   │
│ ─────────────────────────────────────── │
│  タブコンテンツ                          │
└─────────────────────────────────────────┘
```

見積ダイアログ（CostEstimateDialog）は app.vue 直下でデスクトップ・モバイル共通。

## 核心データモデル

### ErectorPipe
```typescript
{
  id: string,
  diameter: number,  // 28 | 32 | 42 mm
  length: number,    // 0.3m 〜 4m
  connections: {
    start?: ErectorPipeConnection,   // パイプ始端のジョイント接続
    end?: ErectorPipeConnection,     // パイプ終端のジョイント接続
    midway: ErectorPipeConnection[]  // 中間位置のジョイント接続（THROUGH穴のみ）
  }
}
```

### ErectorJoint
```typescript
{
  id: string,
  name: string,              // "J-4", "J-66A" など
  holes: ErectorJointHole[], // FIX（固定）または THROUGH（貫通）タイプ
  clampedHoleIndex?: number  // free_rotation ジョイントでUI設定するクランプ穴インデックス
}
// dir: Quaternion でジョイントローカル座標系における穴の方向
// offset: Vector3 でジョイント中心からのオフセット
```

### PipeJointRelationship
```typescript
{
  pipeId, jointId, holeId, connectionType,
  relationshipType: 'j2p' | 'p2j'
  // j2p: ジョイントがパイプの位置を決定する（ジョイント基準）
  // p2j: パイプがジョイントの位置を決定する（パイプ基準）
}
```

### 可動ジョイント型（JointMovableDefinition / JointSimulationState）
```typescript
// カタログ定義レベル（data/erector_component.json）
JointMovableDefinition =
  | { type: "pivot"; pivotCenter: [x,y,z]; pivotAxis: [x,y,z]; rotatingHoles: number[] }
  | { type: "free_rotation" }
  | { type: "detachable"; detachableHoleIndex: number }

// ランタイムシミュレーション状態（stores/ErectorSimulation.ts）
JointSimulationState =
  | { type: "pivot"; angle: number }
  | { type: "free_rotation"; spinAngle: number; orbitAngle: number }
  | { type: "detachable"; attached: boolean }
```

### ErectorBoundary / BoundaryViolation（types/erector_component.ts）
```typescript
ErectorBoundary = {
  id: string,
  type: 'outer' | 'exclusion',  // outer: 設置可能領域（1つのみ）、exclusion: 除外領域（複数可）
  label: string,
  position: [x, y, z],  // メートル
  size: [x, y, z]       // メートル
}
BoundaryViolation = { objectId, objectType: 'pipe' | 'joint', boundaryId, boundaryType, label }
```

### HistorySnapshot（stores/ErectorHistory.ts）
```typescript
{ pipes, joints: { id, name, clampedHoleIndex }[], rootPipeIds, rootTransforms }
// past/future スタック（最大50件）で undo/redo を実現
```

## 重要な設計概念

### j2p / p2j 関係
接続の「基準」を表す。
- **j2p**: ジョイントが固定されており、パイプがジョイントの穴に従って配置される
- **p2j**: パイプが固定されており、ジョイントがパイプの位置に追従する
- 回転ギズモの動作方向がこの関係で変わる（JointControls.ts、PipeControls.ts）

### calculateWorldPosition()
`stores/ErectorScene.ts` の最重要アルゴリズム（780行超のファイル内に存在）。
イテレーティブな深さ優先探索で全オブジェクトのワールド位置を計算。
`updated` と `nextUpdate` キューで依存チェーンを処理する。
Scene.vue が毎フレーム呼び出す。

### ストアアーキテクチャ
`composables/useErector.ts` のファサードを通じて使用する：
```typescript
const erector = useErector()
// 内部で useErectorGraph / useErectorScene / useErectorValidation /
// useErectorSimulation / useErectorHistory を集約
```
`useErectorBoundary` / `useErectorPricing` はファサード外で、必要なコンポーネントが直接使用する。
旧 `useErectorPipeJoint`（stores/ErectorPipeJoint.ts）は後方互換のre-exportのみ。

### undo / redo
`useErector()` の `takeSnapshot()` / `undo()` / `redo()`。
構造変更時にスナップショットを `ErectorHistory` に記録し、`_applySnapshot()` で差分適用する。
キーボードショートカット（Scene.vue）: Ctrl/Cmd+Z = undo、Ctrl/Cmd+Y または Ctrl/Cmd+Shift+Z = redo、
Escape = 選択解除。

### 配置境界（バウンダリ）
設置可能領域（outer・緑ワイヤーフレーム）と除外領域（exclusion・赤ワイヤーフレーム）をAABBで定義。
`checkInterference()`（stores/ErectorBoundary.ts）が各オブジェクトの Box3 と照合し、
violations を RightPanel / BottomSheet のバウンダリタブにバッジ表示する。
チェックはシーンの dirty フラグまたは境界の watch を契機にレンダーループ内で実行。
面接触は違反とせず、CONTACT_EPS (0.1mm) を超えるめり込みのみ検出する。

### 価格見積もり
Navigation の「見積」ボタン / モバイルの ¥ ボタンで CostEstimateDialog を開く。
- ジョイント: `data/erector_price.json` の単価 × 個数
- パイプ: 必要な切片長を既製長さの棒に割り付けるカッティングストック探索
  （`utils/Erector/cuttingStock.ts` の `estimate()`）。
  切りしろ（kerf）と最小端材長（minRemnant）の制約を考慮する
- 使用する既製長さのON/OFFは `ErectorPricing` ストアで管理し、localStorageに永続化。
  OFFの長さは「取り寄せ」扱いで必要な場合のみ探索に投入される
- 価格未設定（null）の項目は合計から除外し、欠損ありと表示する

### シミュレーションモード
可動ジョイント（pivot/free_rotation/detachable）を動かして構造の動作確認ができる。
`stores/ErectorSimulation.ts` がモード状態を管理し、
`utils/Erector/SimulationControls.ts` がインタラクション処理を担う。
シミュレーション中は Download/Upload が無効化される。

### 角度の扱い
- 内部計算・Three.js: ラジアン
- UI表示・ユーザー入力: 度数
- `utils/angleUtils.ts` で変換

## 開発コマンド

```bash
pnpm dev        # 開発サーバー起動
pnpm build      # プロダクションビルド
pnpm generate   # 静的サイト生成
pnpm preview    # ビルド結果プレビュー
```

## 既知のTODOと技術的課題

現在のソースコードにTODO/FIXMEコメントなし（クリーンな状態）。

## カタログデータ規模

- **パイプ**: 直径3種 × 長さ12種 × 色4種
- **プラジョイント**: カテゴリ別50種以上（J-4〜J-120 系）
- **メタルジョイント**: 12種（HJ-1〜HJ-12）
- **3Dモデル**: `/public/models/{category}/erector_component-{name}.gltf`
- **価格表**: `data/erector_price.json`（currency / margin / joints / pipes、色非依存、未設定は null）

## バリデーション

`validateConnections()` が接続のたびに実行される（`stores/ErectorValidation.ts`）。
不正接続は `InvalidConnections.vue` でオーバーレイ表示し、
`debugArrows`（ArrowHelper）で3Dシーン上に視覚的に示す。

## JSON入出力

Navigation（デスクトップ）または FloatingFileButtons（モバイル）の
Download/Upload ボタンでデザインをJSON形式で保存・復元。
`loadFromStructure()` でJSONからパイプ・ジョイント・接続関係を復元。
境界（boundaries）も定義があればJSONに含めて保存・復元する。
位置はmm単位・回転は度数でシリアライズし、内部ではメートル・ラジアンに変換。
ダウンロードのファイル名はアップロードしたファイル名を記憶して再利用する
（`useState('erector-last-filename')`、初期値 erector-design.json）。
