# ブックメイカー（却本作り）実装TODO（段階・完了条件つき）

最終更新: 2025-09-02 JST / 担当: 自動エージェント

## 第1段：土台（MVP）
1. プロジェクト雛形とPages公開（トップ表示まで）。
2. ストア（IndexedDB）雛形：books/settings/achievements/state/stats、UUID発番。
3. 新規/編集モーダル（必須バリデーション・Enter/保存継続・読了トグル）。
4. ホーム（検索＋最近の読了＋カード表示）。
- 完了条件：登録→編集→検索が一連で動作。再読/削除がDBに反映。

## 第2段：カレンダー・集計
5. 月ヒートマップ（当日セル長押しで一覧）。
6. 週合計/年棒グラフ＋合計ラベル（今週/今月/今年）。
7. Stats差分更新（累計・日別/週別/年別・ユニーク著者・ストリーク）。
- 完了条件：100冊ダミーで合計一致、切替200ms以内。

## 第3段：称号100・トースト
8. achievements.json読込とルールエンジン（TOTAL/COUNT_IN_PERIOD/STREAK/READ_SPEED/TEXT_LEN/CONTAINS/ONE_LINER_PATTERN/REREAD/SAME_AUTHOR_STREAK/UNIQUE_AUTHORS/DATE_PATTERN/USER_ACTION）。
9. 取得状態保存・トースト表示・実績画面（未達は線画）。
- 完了条件：100称号すべて到達可能、重複付与なし。

## 第4段：再会・演出
10. 「今日の再会本」（日替わり乱択・詳細遷移）。
11. 名言ランダム表示・紙吹雪（節目のみ）・設定で音ON/OFF。
- 完了条件：毎日異なる本提示、節目演出が1秒以内に発火。

## 第5段：入出力・PWA
12. JSONエクスポート（backup_YYYYMMDD.json）/インポート（上書き/マージ）。
13. PWA（manifest, sw.js）とプリキャッシュ。
- 完了条件：バックアップ→全削除→復元で完全一致、オフラインで起動。

## 第6段：品質
14. 単体/統合/E2E最小セット（CI任意）と境界テスト。
15. アクセシビリティ（フォーカス/コントラスト/文字倍率）最終調整。
- 完了条件：性能・整合・A11yの受け入れ基準を満たす。

---

## 直近スプリント（S0）
- Pages公開のための静的雛形追加（index.html / assets/style.css / assets/app.js / assets/ui.js / manifest.json / sw.js）。
- GitHub PagesデプロイWorkflow（.github/workflows/pages.yml）追加。
- 最小機能（ローカル保存・検索・最近の読了）をローカルストレージで仮実装（IndexedDBはS1で差し替え）。

## メモ
- タイムゾーンは `Asia/Tokyo` を既定。
- ルーティングはハッシュ方式（#home/#calendar/#add/#achievements）。
- 後段でIndexedDB化し、データ移行（localStorage→IndexedDB）を実装。

