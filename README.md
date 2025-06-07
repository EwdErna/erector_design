# Erector Design

矢崎化工の製品「[イレクター](https://www.yazaki.co.jp/products/erector/)」を使用した構造物の設計を行うWebアプリケーションです。

## 📋 概要

イレクターの主要部品（パイプ・プラジョイント・メタルジョイント）をリストから選択し、  
それらを組み合わせて構造物を設計することができます。  
各部品の組み合わせや座標を入力して必要な部品や数量、完成品の形状・動作を確認することができます。

## 🛠️ 技術スタック

- **フレームワーク**: [Nuxt.js](https://nuxtjs.org/)
- **言語**: TypeScript
- **3Dレンダリング**: [Three.js](https://threejs.org/)
- **Node.js**: v22
- **パッケージマネージャー**: pnpm

## 🚀 セットアップ

### 前提条件

- Node.js v22
- pnpm

### インストール手順

1. リポジトリをクローンします：

    ```bash
    git clone https://github.com/EwdErna/erector-design.git
    cd erector-design
    ```

2. 依存関係をインストールします：

    ```bash
    pnpm install
    ```

## 💻 開発

### 開発サーバーの起動

```bash
pnpm dev
```

開発サーバーが起動し、`http://localhost:3000` でアプリケーションにアクセスできます。

### ビルド

```bash
pnpm build
```

### プレビュー（本番環境での動作確認）

```bash
pnpm preview
```

## 📁 プロジェクト構成

```yml
erector-design/
- components/       # Vue コンポーネント
- pages/            # ページコンポーネント
- public/           # 公開ファイル
    - models/       # コンポーネント3Dモデル
- types/            # TypeScript 型定義
- nuxt.config.ts    # Nuxt.js 設定
- package.json      # 依存関係とスクリプト
```

## 🤝 貢献

プロジェクトへの貢献を歓迎します。バグの報告や機能の提案がある場合は、Issue を作成してください。

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。

## 👤 作者

- Email: [ewderna@gmail.com](mailto:ewderna@gmail.com)
- GitHub: [@EwdErna](https://github.com/EwdErna)

## 📝 変更履歴

変更履歴については [CHANGELOG.md](CHANGELOG.md) をご覧ください。
