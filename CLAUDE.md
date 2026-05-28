# Erector Design - CLAUDE.md

## プロジェクト概要

矢崎の「イレクター」パイプ＆ジョイントシステムを使った構造物を設計するWeb CADアプリ。
Three.js で3Dリアルタイム描画し、パイプとジョイントの接続関係を管理・バリデーションする。
モバイル対応済み（タッチ操作 + BottomSheet UI）、可動ジョイントのシミュレーションモードを搭載。

## 技術スタック

| 種別 | 技術 |
|------|------|
| フレームワーク | Nuxt 3 (v3.16.2) + Vue 3 (v3.5.13) |
| 言語 | TypeScript |
| 3D描画 | Three.js (v0.175.0) |
| 状態管理 | Pinia (v3.0.2) |
| パッケージ管理 | pnpm |
| Node.js | v22 |

## ディレクトリ構造

```
erector_design/
├── app.vue                               # ルートコンポーネント（デスクトップ3パネル＋モバイルレイアウト）
├── components/
│   ├── Navigation.vue                    # ヘッダー（デスクトップ用ダウンロード/アップロード）
│   ├── SelectComponents.vue              # 左パネル：コンポーネント選択
│   ├── EditComponent.vue                 # 右パネル：プロパティ編集
│   ├── InvalidConnections.vue            # バリデーションエラーオーバーレイ
│   ├── SelectPipe.vue / SelectPlaJoint.vue / SelectMetalJoint.vue
│   ├── BottomSheet.vue                   # モバイル用ボトムシート（パーツ/編集/エラー タブ）
│   ├── FloatingFileButtons.vue           # モバイル用浮動アップロード/ダウンロードボタン
│   └── ThreeD/Scene.vue                  # Three.jsシーン管理（タッチ対応）
├── composables/
│   ├── useErector.ts                     # ★ファサード：4ストアを統合するメインAPI
│   └── useBottomSheet.ts                 # ボトムシートの開閉・タブ状態管理
├── stores/
│   ├── ErectorGraph.ts                   # パイプ・ジョイント・接続関係のデータ構造管理
│   ├── ErectorScene.ts                   # Three.jsオブジェクト管理・ワールド位置計算（★最重要）
│   ├── ErectorValidation.ts              # 接続バリデーションロジック
│   ├── ErectorSimulation.ts              # シミュレーションモード状態管理
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
│       └── SimulationControls.ts         # シミュレーションモード用ギズモ
├── types/erector_component.ts            # TypeScript型定義（可動ジョイント型含む）
└── data/erector_component.json           # イレクターカタログデータ
```

## UIレイアウト

### デスクトップ（min-width: 769px または pointer: fine）
```
┌─────────────────────────────────────────┐
│          Navigation Bar (64px)          │
├──────────┬──────────────────┬───────────┤
│ Select   │  3D Scene (50%)  │  Edit     │
│ (25%)    ├──────────────────┤  (25%)    │
│          │  Errors (20%)    │           │
└──────────┴──────────────────┴───────────┘
│ Footer (20px)                           │
└─────────────────────────────────────────┘
```

### モバイル（max-width: 768px かつ pointer: coarse）
```
┌─────────────────────────────────────────┐
│  [↑][↓] ← FloatingFileButtons           │
│                                         │
│           3D Scene (全画面)              │
│                                         │
├─────────────────────────────────────────┤
│ [パーツ] [編集] [エラー🔴]  ← タブ       │
│ ─────────────────────────────────────── │
│  タブコンテンツ                          │
└─────────────────────────────────────────┘
```

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

## 重要な設計概念

### j2p / p2j 関係
接続の「基準」を表す。
- **j2p**: ジョイントが固定されており、パイプがジョイントの穴に従って配置される
- **p2j**: パイプが固定されており、ジョイントがパイプの位置に追従する
- 回転ギズモの動作方向がこの関係で変わる（JointControls.ts、PipeControls.ts）

### calculateWorldPosition()
`stores/ErectorScene.ts` の最重要アルゴリズム（750行超のファイル内に存在）。
イテレーティブな深さ優先探索で全オブジェクトのワールド位置を計算。
`updated` と `nextUpdate` キューで依存チェーンを処理する。
Scene.vue が毎フレーム呼び出す。

### ストアアーキテクチャ（分割済み）
旧 `useErectorPipeJoint`（モノリシック）は4つに分割された。
`composables/useErector.ts` のファサードを通じて使用する：
```typescript
const erector = useErector()
// 内部で useErectorGraph / useErectorScene / useErectorValidation / useErectorSimulation を集約
```

### シミュレーションモード
可動ジョイント（pivot/free_rotation/detachable）を動かして構造の動作確認ができる。
`stores/ErectorSimulation.ts` がモード状態を管理し、
`utils/Erector/SimulationControls.ts` がインタラクション処理を担う。

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

現在のソースコードにはTODO/FIXMEコメントなし（クリーンな状態）。

旧来の課題（GLTFLoader singleton化・console.log残存）は
`stores/ErectorPipeJoint.ts` のリファクタリング時に解消済み。

## カタログデータ規模

- **パイプ**: 直径3種 × 長さ12種 × 色4種
- **プラジョイント**: カテゴリ別50種以上（J-4〜J-120 系）
- **メタルジョイント**: 12種（HJ-1〜HJ-12）
- **3Dモデル**: `/public/models/{category}/erector_component-{name}.gltf`

## バリデーション

`validateConnections()` が接続のたびに実行される（`stores/ErectorValidation.ts`）。
不正接続は `InvalidConnections.vue` でオーバーレイ表示し、
`debugArrows`（ArrowHelper）で3Dシーン上に視覚的に示す。

## JSON入出力

Navigation（デスクトップ）または FloatingFileButtons（モバイル）の
Download/Upload ボタンでデザインをJSON形式で保存・復元。
`loadFromStructure()` でJSONからパイプ・ジョイント・接続関係を復元。
位置はmm単位・回転は度数でシリアライズし、内部ではメートル・ラジアンに変換。
