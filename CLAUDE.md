# Erector Design - CLAUDE.md

## プロジェクト概要

矢崎の「イレクター」パイプ＆ジョイントシステムを使った構造物を設計するWeb CADアプリ。
Three.js で3Dリアルタイム描画し、パイプとジョイントの接続関係を管理・バリデーションする。

## 技術スタック

| 種別 | 技術 |
|------|------|
| フレームワーク | Nuxt 3 (v3.16.2) + Vue 3 |
| 言語 | TypeScript |
| 3D描画 | Three.js (v0.175.0) |
| 状態管理 | Pinia (v3.0.2) |
| パッケージ管理 | pnpm |
| Node.js | v22 |

## ディレクトリ構造

```
erector_design/
├── app.vue                          # ルートコンポーネント（3パネルレイアウト）
├── components/
│   ├── Navigation.vue               # ヘッダー（ダウンロード/アップロード）
│   ├── SelectComponents.vue         # 左パネル：コンポーネント選択
│   ├── EditComponent.vue            # 右パネル：プロパティ編集
│   ├── InvalidConnections.vue       # バリデーションエラーオーバーレイ
│   ├── SelectPipe.vue / SelectPlaJoint.vue / SelectMetalJoint.vue
│   └── ThreeD/Scene.vue             # Three.jsシーン管理
├── stores/
│   ├── ErectorPipeJoint.ts          # コアビジネスロジック（★最重要）
│   ├── ObjectSelection.ts           # 選択状態管理
│   └── three.ts                     # Three.jsシーン参照
├── utils/Erector/
│   ├── pipe.ts                      # パイプジオメトリ生成
│   ├── erectorComponentDefinition.ts # カタログローダー
│   ├── JointControls.ts             # ジョイント操作ギズモ
│   └── PipeControls.ts              # パイプ操作ギズモ
├── types/erector_component.ts       # TypeScript型定義
└── data/erector_component.json      # イレクターカタログデータ
```

## UIレイアウト

```
┌─────────────────────────────────────────┐
│          Navigation Bar (64px)          │
├──────────┬──────────────────┬───────────┤
│ Select   │  3D Scene (50%)  │  Edit     │
│ (25%)    │                  │ (25%)     │
└──────────┴──────────────────┴───────────┘
│ Footer (20px)                           │
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
  name: string,   // "J-4", "J-66A" など
  holes: ErectorJointHole[]
}
// 各穴は FIX（固定）または THROUGH（貫通）タイプ
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

## 重要な設計概念

### j2p / p2j 関係
接続の「基準」を表す。
- **j2p**: ジョイントが固定されており、パイプがジョイントの穴に従って配置される
- **p2j**: パイプが固定されており、ジョイントがパイプの位置に追従する
- 回転ギズモの動作方向がこの関係で変わる（JointControls.ts、PipeControls.ts）

### calculateWorldPosition()
`stores/ErectorPipeJoint.ts` の最重要アルゴリズム（750行超）。
イテレーティブな深さ優先探索で全オブジェクトのワールド位置を計算。
`updated` と `nextUpdate` キューで依存チェーンを処理する。
Scene.vue が毎フレーム呼び出す。

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

| 場所 | TODO | 内容 |
|------|------|------|
| `stores/ErectorPipeJoint.ts:74` | `console.log` 残存 | 本番前に削除要 |
| `stores/ErectorPipeJoint.ts:100` | GLTFLoader singleton化 | ジョイント追加ごとに新規インスタンス生成→パフォーマンス懸念 |
| `stores/ErectorPipeJoint.ts:117` | コメント整理 | TODOとして残っているがコードは実装済み |
| `utils/Erector/pipe.ts:10` | `console.log` 残存 | 本番前に削除要 |

## カタログデータ規模

- **パイプ**: 直径3種 × 長さ12種 × 色4種
- **プラジョイント**: カテゴリ別50種以上（J-4〜J-120 系）
- **メタルジョイント**: 12種（HJ-1〜HJ-12）
- **3Dモデル**: `/public/models/{category}/erector_component-{name}.gltf`

## バリデーション

`validateConnections()` が接続のたびに実行される。
不正接続は `InvalidConnections.vue` でオーバーレイ表示し、
`debugArrows`（ArrowHelper）で3Dシーン上に視覚的に示す。

## JSON入出力

Navigation の Download/Upload ボタンでデザインをJSON形式で保存・復元。
`loadFromStructure()` でJSONからパイプ・ジョイント・接続関係を復元。
