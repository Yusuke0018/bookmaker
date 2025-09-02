# TODO / ロードマップ（ブックメイカー）

目的: 最小入力で学びを蓄積し、楽しく振り返れる静的PWA（GitHub Pages配信）。データはブラウザ内（IndexedDB/LocalStorage）に保持し、JSONでバックアップ/復元します。タイムゾーンは Asia/Tokyo、週は月曜始まり。

## スプリント0（今日やる）

- [ ] achievements.json（称号100）の登録（仕様どおり）
- [ ] Stats差分更新→称号一括評価→初回のみトースト通知の最小フロー
- [ ] 月カレンダー（ヒートマップ）βと「日替わり再会」β（乱択）

受け入れ基準:

- [ ] ダミーデータで称号のいくつかが実際に付与され、トースト表示される
- [ ] 月別ヒートマップに日毎読了数が表示される（手計算と一致）
- [ ] ホームで「今日の再会本」が1冊表示され、詳細に遷移できる

---

## マイルストン計画

M0 準備/方針

- [ ] 配信方式: GitHub Pages（`/docs` 配下の静的サイト）に決定
- [ ] ルーティング: ハッシュルーティング（`/#/...`）
- [ ] 既存のNode/Expressはローカル開発ユーティリティに限定（本番は静的）
- [ ] Lint/Formatを`assets/*.js`にも適用するスクリプト整備

M1 ひな型（静的SPA）

- [ ] `docs/index.html`（シェル: ヘッダー・タブ・ルーターアウトレット）
- [ ] `docs/assets/style.css`（トークン: 色/余白/角丸/影）
- [ ] `docs/assets/app.js`（状態/DB/集計の骨組み）
- [ ] `docs/assets/ui.js`（描画/モーダル/トースト/カレンダー骨組み）
- [ ] `docs/manifest.json`・`docs/sw.js`（プレースホルダ）
- [ ] `docs/icons/*`（PWAアイコン雛形）
      受け入れ基準: Pages公開でトップが表示（オフラインはまだ不要）

M2 データ層/ユーティリティ

- [ ] IndexedDB: `books`, `achievements`, `settings`, `stats` ストア実装
- [ ] バリデーション（軽量実装 or 手書き）とUUID発行
- [ ] 日付/集計ユーティリティ（Asia/Tokyo, ISO週, 丸め）
- [ ] `assets/achievements.json` 読み込み（100件）
      受け入れ基準: CRUDが通り、簡易ユニットテストで検証

M3 入力（新規/編集モーダル）

- [ ] タイトル・著者 必須、開始日は自動で今日
- [ ] 読了トグル=今日をセット、★評価、感想、一言（20字カウンタ）
- [ ] ショートカット: `n`/`/`/`e`/`Ctrl+S`
      受け入れ基準: 保存/編集で一覧・カレンダーが即時更新

M4 ホーム/検索/再会

- [ ] 検索: タイトル/著者/感想のインクリメンタル（1000件<50ms）
- [ ] 並び替え: 最近/評価/タイトル
- [ ] 最近の読了リスト + 日替わり再会の詳細遷移
      受け入れ基準: 1000件で体感快適、ナビの戻る進むが破綻しない

M5 カレンダー/集計

- [ ] 月: ヒートマップ（日セルに数バッジ、長押し=該当一覧）
- [ ] 年: 月別棒グラフ + 今年の頻出語（トップ10）
- [ ] 週: 月曜始まりの週合計表示
      受け入れ基準: 100冊ダミーで月/週/年の数が手計算と一致

M6 Stats/称号

- [ ] イベント: 新規/編集/削除/検索/バックアップ/復元でStats差分更新
- [ ] ルール評価: Statsベースで一括判定・重複付与なし
- [ ] トースト: 初回取得のみ2.2秒表示、実績画面に反映
      受け入れ基準: 代表的な称号（総数/連続/著者/テキスト系）が確実に付与

M7 バックアップ/復元

- [ ] JSONエクスポート（ダウンロード）
- [ ] JSONインポート（上書き/マージ選択、重複排除）
- [ ] 復元後にStats/称号を再計算
      受け入れ基準: バックアップ→削除→復元で完全一致へ戻る

M8 PWA

- [ ] manifest（name/short_name/start_url/theme/icon群）
- [ ] Service Worker: プリキャッシュ+ランタイムキャッシュ
- [ ] オフライン起動/更新戦略（Stale-While-Revalidate）
      受け入れ基準: 機内モードでも主要画面が動作、更新が自動反映

M9 テスト/CI

- [ ] ロジックのユニットテスト（集計/ストリーク/称号）
- [ ] E2E（Playwright）: 新規→検索→読了→称号→バックアップ→復元
- [ ] GitHub ActionsでE2E実行（Pages公開と分離）
      受け入れ基準: CI緑、主要フローが安定

M10 ポリッシュ/アクセシビリティ/演出

- [ ] a11y: フォーカスリング/コントラスト/44pxタップ領域
- [ ] マイクロインタラクション（栞/紙吹雪大台演出）
- [ ] 文言/空状態/エラーメッセージの磨き込み
      受け入れ基準: Lighthouse/PWA/A11y 90点台、UXフィードバック反映

---

## データモデル（最小）

- Book: { id, title, author, startedAt, finishedAt, reviewText, oneLiner, rating, createdAt, updatedAt }
- Achievement: { id, name, category, description, rule, acquiredAt }
- Stats: { totals, streaks, byMonth, byWeek, byAuthor, searchCount, edits, backups, imports }
- Settings: { theme, reviewIntervals, startOfWeek, exportFormat }
  注: 日付はISO文字列、idはUUID。集計は finishedAt でカウント。

## 仕様メモ（抜粋）

- 週はMon–Sun。連続読了は finishedAt が連続した最大長。
- 評価タイミングは 保存/編集/削除/検索/バックアップ/復元。
- 種別例: TOTAL*READS, STREAK_DAYS, WEEK_READS, REREAD*\*, SAME_AUTHOR_STREAK, REVIEW_CHARS など。

## リスク/留意

- 大量データ（1万件）時の検索: 事前トークン化+前方/部分一致のハイブリッド
- 端末時刻ズレ: すべてUTC基準保存+表示時にJST丸め
- SWのキャッシュ更新: 破棄タイミングを慎重に（バージョニング）

## 作業ルール

- 小さく頻繁にコミット/プッシュ（Conventional Commits）
- 変更時は Format→Lint→Test→Commit→Push（失敗時は中断して理由共有）
