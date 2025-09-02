bookmaker

最小構成の TypeScript + Express プロジェクトです。今後このリポジトリでアプリを育てていきます。

セットアップ

- Node.js 22 系を想定しています。
- 依存関係のインストール: `npm ci` または `npm install`

スクリプト

- 開発サーバ起動: `npm run dev`
- フォーマット: `npm run format`
- Lint: `npm run lint`
- テスト: `npm test`
- ビルド: `npm run build`
- 実行（ビルド済み）: `npm start`

GitHub Pages 公開

- `docs/` 配下に静的SPAを配置しています。
- 本リポジトリには GitHub Pages 用ワークフロー（.github/workflows/pages.yml）を同梱しています。main へ push すると自動で Pages へ反映されます。
- 初回のみ、リポジトリ設定 → Pages → Build and deployment の Source を “GitHub Actions” に設定してください。

PWA

- `docs/manifest.json` と `docs/sw.js` を同梱しています。オフライン時も主要画面が動作します。
- Service Worker のキャッシュバージョンは `docs/sw.js` 内の `VERSION` を更新してください。

ライセンス
未定（必要に応じて後で追加します）。
