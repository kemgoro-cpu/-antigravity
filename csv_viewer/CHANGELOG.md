# 変更履歴

開発を引き継ぐ人（人間・AIエージェント問わず）向けの正確な変更記録。
コミット単位の詳細は `git log` も参照のこと。

## 2026-07-27: MDC（Malaysian Driving Cycle）を内蔵走行モードに追加＋サイクル判別の改善

MDCの確定版1Hz車速トレース（配布資料「☆Final MDC.xlsx」【Final form】シート）を入手したため、
以前「実データが無いので内蔵廃止・カスタムモードで代用」としていたMDCを内蔵モードへ復帰させた。
併せて `HANDOFF_swap_bug.md` に保留課題として残っていた **1477秒問題**（MDCとWLTC 3フェーズ版が
同じ総時間で判別が衝突する）を解消した。

### 変更内容

1. **MDCトレースの追加** (`drive-cycles-data.js`): `SPEED.mdc` を追加。1478点（0..1477秒）。
   元資料が明記する1Hzチェックサム（Low 8830.5 / Medium 23879.1 / High 22414.2 / 合計 55123.8）と
   一致することを確認済み。総距離 15.312 km、最高車速 105.8 km/h。
   フェーズ名は元資料内で `Middle`（B列）と `Medium`（チェックサム表）に表記が割れていたが、
   UN GTR No.15 の正規表記および本アプリのWLTC表記に合わせ **Medium** に統一した。

2. **レジストリ登録** (`drive-index-utils.js`): `id: 'mdc'`、フェーズは
   Low 0-451 / Medium 451-1101 / High 1101-1477（WLTCと同じ共有境界方式）。
   走行モードのドロップダウンとフェーズ編集UIは `CYCLE_REGISTRY` を走査する作りなので自動追従する。

3. **`LEGACY_CYCLE_ID` から `mdc` を削除**: `mdc` は現行の有効IDに戻ったため読み替え不要。
   旧設定に残った `cycleId: 'mdc'` はそのまま新しい内蔵MDCへ解決される。

4. **`detectCycle` に最高車速タイブレークを追加**（1477秒問題の本体）:
   従来は総時間差の厳密比較だったため、同点時はレジストリ先頭が常に勝っていた
   （＝MDCが必ずWLTC 3フェーズ版に負ける）。同点候補を集めたうえで最高車速が最も近いものを選ぶ。
   決め手が無ければ `ambiguous: true` を立てて返し、呼び出し側が波形照合に委ねられるようにした。
   戻り値に `ambiguous` / `speedMismatch` / `candidates` を追加（既存フィールドは不変＝後方互換）。

5. **`speedMismatch`（長さ判別の信頼性チェック）を追加**: 計測ログは前後に余分データを含むため
   総時間が伸び、無関係なサイクルの許容差±5%に迷い込むことがある（前後120秒付きMDC=1717秒が
   WLTC 4フェーズ版1800秒に一致してしまう）。選ばれた候補の最高車速が実測と10km/h以上食い違う場合は
   長さ判別を信用せず波形照合へ回す。これにより**前後に余分データがあるMDCログも正しく判別される**。

6. **`pickBestCycleByAlignment` に候補の絞り込みを追加** (`app.js`): 総時間が同点で決着しなかった
   場合は、その同点候補の中だけを波形照合する。全モードを対象にすると、実測より短いサイクル
   （例: 1180秒のNEDC）が1477秒の窓内をスライドして偶然低いRMSEを出し、正解に勝ちうるため。

7. **`detectCycle` へ実測車速を渡すよう修正** (`app.js`): 従来 `detectCycle(timeData, null)` と
   速度を捨てていたため、タイブレーク以前に最高車速が判別へ全く使われていなかった。

### 検証

- `npm test` 全7本パス。MDCのチェックサム回帰テスト、タイブレーク、`speedMismatch` を追加。
- ブラウザ実機で、MDC / 前後余分データ付きMDC / WLTC 3a・3b（3フェーズ）/ NEDCサンプルが
  それぞれ正しく自動判別されること、フェーズ別距離が元資料と一致すること、
  コンソールエラーが無いことを確認。

## 2026-07-04: UI/UXリデザイン（FullHD対応・初心者向け改善、Claude Code実施）

機能増加によりFullHD(1920x1080)でもツールバーの右側ボタンが隠れ、サイドバーの
Channelsセクションが画面下に押し出される問題に対応。初心者にも分かりやすい
UIを目指した6フェーズの改修。

### 変更内容

1. **サイドバー幅復元の不具合修正**: 復元時に`minWidth`まで固定していたため、
   一度リサイズすると再び縮小できなくなっていた。`width`のみ設定しクランプする
2. **ツールバーのドロップダウン化**: 約26個のコントロールが1行に収まらず
   右側が隠れていた問題に対応。表示設定(サンプリング/フォント/線幅/マーカー/
   単色モード)を「表示▾」、出力系(PNG/コピー/CSV/レポート/設定入出力)を
   「エクスポート▾」に集約。頻用操作はトップレベルボタンのまま維持。
   `setupToolbarDropdown`で開閉・キーボード操作(矢印/Home/End/Esc/Tab)・
   クリック外閉じ・排他制御を実装。1500px以下ではラベルを隠しアイコンのみに
3. **リッチツールチップ**: ネイティブ`title`属性のみで機能が分かりにくかった
   ため、ホバー/キーボードフォーカスで名前・説明・ショートカットを表示する
   `#app-tooltip`を追加。ツールバー全ボタン・サイドバーのアイコンボタンを
   `data-tip-*`属性に移行
4. **サイドバーのアコーディオン化+状態保存**: Files/Settings/Custom RAM/Events
   を`.sidebar-upper`で内部スクロールさせ、Channelsは常に最低180pxの表示高さを
   確保。Channels含む全セクションを折りたたみ可能にし、状態を
   `state.sidebarCollapsed`としてlocalStorageへ永続化
   (`SETTINGS_VERSION` 4→5)
5. **UI文言の日本語統一**: ボタンラベル・サイドバー見出し・プレースホルダー・
   パース進捗・エラー/警告トースト・モード切替ラベルなどの英語表記を日本語に
   統一。Custom RAM/Drive Index/LTTB等の技術用語は維持
6. **空状態ガイドの強化**: チャート未表示時のプレースホルダーを
   「①ファイルを読み込む→②チャンネルを選択→③チャートを操作」の
   3ステップ案内カードに置き換え

### 守るべき制約（今後の開発向け・追加分）

- **`buildSettingsForExport`の`_version`は独立系統**（現在3）。localStorage
  スキーマの`SETTINGS_VERSION`(現在5)と混同しないこと。サイドバー折りたたみ
  など純粋なローカルUI状態はエクスポートJSONに含めない
- **ツールバーの`.toolbar-menu`パネルは`position:fixed`**。`.toolbar`が
  `overflow-x:auto`のため`absolute`だとクリップされる
- **ドロップダウン展開中は単打ショートカット(B/T/R/M)を無効化**する
  `isToolbarMenuOpen()`ガードがグローバルkeydownハンドラに入っている
- **モード切替ボタン(zoom/measure/shift/arrange)のinnerHTML書き換えは
  `<span class="btn-label">`を必ず維持**すること（狭幅でのラベル非表示に必要）

## 2026-07-03: 新機能 第2弾（F5〜F10、Claude Code実施）

`FEATURE_BACKLOG.md` の残り6機能を実装し、バックログ全10件が完了。
コミット: `90f63fc`（F5）/ `bedfc0a`（F6）/ `b831065`（F10）/ `a88ee55`（F8）/
`0e02714`（F9）/ `347f787`（F7）。

### 追加された機能

1. **表示範囲の統計サマリ（F5）**: Statsボタン。ズームに追従して min/max/mean/σ を
   パネル表示。集計は計測と共通の `computeIntervalStats` + `collectStatsRows`
2. **表示データのCSVエクスポート（F6）**: CSVボタン。表示範囲×表示チャンネル
   （Custom RAM含む）をBOM付きUTF-8で保存。メインファイルの時間軸基準
3. **XYプロット（F7）**: XYボタン。任意チャンネル同士の散布図モーダル。
   main/sub重ね描き、「表示中の時間範囲のみ」連動、5万点超は間引き
4. **Main−Sub差分カーブ（F8）**: Diffボタン。両ファイルに同名で存在する
   チャンネルから選んで `@Δ名_sN`（式 `名前 - sN:名前`）を一括生成
5. **HTMLレポート出力（F9）**: Reportボタン。チャート画像・ファイル情報・
   統計・Drive Index・Custom RAM・イベント一覧を自己完結HTMLで保存
6. **チャンネルセットのお気に入り（F10）**: Channelsセクションの★行。
   表示チャンネルの組み合わせを保存・ワンクリック適用。
   独立キー `csvViewer_channelFavorites`（Clear Allで消えない）。上限30件

### 挙動が変わった修正（バグ修正）

1. **クロスファイルCustom RAMの復元失敗**: `s1:` 参照を含むRAMが、参照先Sub
   ファイルの読み込み前に評価されて失敗・消失していた（複数ファイル同時
   ドロップとセッション自動復元で発生）。参照先Subが揃うまで
   `_deferredCrossRAMs` へ繰り延べ、後続パース完了時に再試行するようにした
2. **addCustomRAMのalert**: 2箇所（重複名・評価失敗）をトースト通知へ統一

### 守るべき制約（今後の開発向け・追加分）

- **表示範囲の取得は `getVisibleXRange()` を使う**（F5/F6/F7が共用。
  dataZoomのstartValue優先・%換算フォールバック込み）
- **区間統計は `computeIntervalStats` / `collectStatsRows` を使う**（F2/F5/F9が共用）
- **モーダル内にEChartsを作る場合は、閉じるあらゆる経路で `dispose()` する**
  （XYプロットはMutationObserverでoverlay除去を監視して破棄している）
- **ツールバーのボタン活性はrenderChartの2分岐（グリッド0/あり）と
  `updateUI()` の両方を確認する**（exportCsv/exportReport/statsBtn/measureBtn は
  renderChart、diffBtn=Sub有無・xyBtn=Main有無 は updateUI）

### 検証記録

- `npm test` 6本グリーン
- Playwright実ブラウザスモーク10本・計111チェック全PASS（第1弾4本の回帰含む。
  CSV/レポートは実ダウンロード内容の照合、統計は愚直計算との数値一致、
  差分カーブは main−sub との全点一致まで検証）

## 2026-07-03: 新機能 第1弾（F1〜F4、Claude Code実施）

`FEATURE_BACKLOG.md` の第1弾4機能を実装。コミット: `fd87195`（F1）/ `d2e803e`（F2）/
`22eb106`（F3）/ `db72eb8`（F4）。各機能の仕様はバックログ本文を参照。

### 追加された機能

1. **ライト/ダークテーマ切替（F1）**: ツールバー右のトグルボタン。
   `:root[data-theme="light"]` でCSSトークンを差し替え、`refreshThemeColors()` が
   ECharts用実値（`T`）を再解決して再描画する。設定キー `theme` で永続化
2. **カーソル計測（F2、ショートカット M）**: チャート2クリックで計測点A/Bを設置。
   区間のΔtと表示チャンネルごとのA/B/Δ/min/max/mean/RMSをパネル表示。
   Subファイルはタイムシフト適用済みの時間軸で集計
3. **しきい値イベント検出（F3）**: サイドバーのEventsセクション。条件式
   （例 `Actual_Speed > 120`）で真区間をメインファイルから検出し、一覧+markArea
   ハイライト+行クリックでズーム。**式パーサに比較演算子（`> < >= <= == !=`）と
   論理演算子（`&& ||`）を追加**（Custom RAMでも使用可。結果は1/0、NaNは伝播）
4. **セッション自動復元（F4）**: パース成功時に元ファイルをIndexedDB
   （`csvViewerSession`）へ保存し、次回起動時に自動再読み込み。ロール・選択等は
   既存のlocalStorage復元機構が適用する

### 守るべき制約（今後の開発向け・追加分）

- **チャートへ渡す色を増やすときはCSSトークン＋`cssVar()`経由にする**
  （`refreshThemeColors()` に追加。ハードコードするとライトテーマに追従しない）。
  DOM側のインライン色は `var(--accent-soft)` 等のCSS変数を直接書いてよい
- **式パーサの優先順位**: `|| < && < 比較 < 加減 < 乗除 < べき乗 < 単項`。
  演算レベルを増やすときは `parseExpr`→`parseLogicalOr`→…の階層に挿入し、
  深度ガード（`parseFactor`）を迂回しないこと
- **計測（`state.measure`）とイベント区間（`state.events.intervals`）は永続化しない**。
  設定に入るのは条件式 `eventExpr` のみ（`VISUAL_ONLY_KEYS` 登録済み）。
  イベント区間はメインの時間軸基準なので、メイン切替・削除・Clear Allで
  `clearEvents(false)` を呼んで破棄する
- **ファイルの削除経路を増やしたらセッションストアの掃除も追加する**
  （`sessionDeleteFile` / `sessionClearFiles`）。保存は Phase 2 complete の
  `sessionSaveFile(fileId, _origFileById.get(fileId), fileName)` のみで行う
  （TRNはパイプライン内が変換済みテキストのため、元Fileは `_origFileById` が持つ）
- **モード追加時は相互排他に組み込む**: enter系で他モードをexitし、
  マウス操作ガード（`state.shiftMode || state.brushMode || state.arrangeMode ||
  state.measureMode`）とEsc処理・ショートカット一覧に追加する

### 検証記録

- `npm test` 6本グリーン（chart-options-utilsにテーマ引数のケースを追加）
- Playwright実ブラウザスモーク4本・計53チェック全PASS
  （テーマ切替/計測/イベント検出/セッション復元。各機能の数値検証を含む）
- ライト/ダーク両テーマのスクリーンショット目視確認

## 2026-07-02: 改善バックログ全面実施（Claude Code実施）

全体コードレビューで作成した `IMPROVEMENT_BACKLOG.md`（29タスク）を7フェーズで実施。
各タスクの詳細・見送り理由はバックログ冒頭の「実施状況」を参照。コミット: `0973dd1`〜`ff0f928`。

### 新規ファイル

| ファイル | 内容 |
|---|---|
| `package.json` + `scripts/run-tests.js` | `npm test` で全テスト一括実行（失敗時は非0終了） |
| `chart-options-utils.js` | チャートオプション構築の純粋関数群（UMD、グローバル名 `CSVChartOptions`）。描画系定数 `CONSTANTS` の単一情報源 |
| `tests/chart-options-utils.test.js` | 16ケース。テストは計6本になった |

移動: `generate_nedc.js` → `scripts/`（シード付き乱数化で出力が決定的に）

### 挙動が変わった修正（バグ修正）

1. **複数ファイル同時ドロップのMainロール競合**: ロール判定を `state.files` 挿入直前
   （Phase 2 completeコールバック内）へ移動。CSV経路の非同期パースで両方Mainになる競合を解消
2. **`.trn` のスペース入りチャンネル名**: 区切りを「パイプ/タブ/連続2個以上の空白」に変更
   （`parser-utils.js` の `convertWhitespaceToTabs`）。既存サンプル3本の変換結果はバイト一致
3. **ゾーン外ドロップでの全状態消失**: windowレベルの `dragover`/`drop` ガードを追加
4. **並行パース中のヘッダー検出値汚染**: 行ヒントをパース開始時に固定し引数で受け渡し。
   `dom.nameRow` への書き戻しはUI表示専用になった
5. **`LEGACY_CYCLE_ID` の二重定義**: `drive-index-utils.js` を単一情報源に統一（`mdc: null` が正）。
   settings-utils は読み込み順の都合で `migrateSettings` 実行時に遅延参照する
6. **設定インポートの参照代入**: `applySettings` の `yRanges`/`fileColors` をコピー+形式検証に。
   `fileColors` は `#RRGGBB` 検証（不正値は破棄しデフォルト色へ）

### 守るべき制約（今後の開発向け・追加分）

- **チャート描画系の定数（`BIT_WEIGHT` 等）は `chart-options-utils.js` の `CONSTANTS` を編集する**
  （app.js側に重複定義を作らないこと）
- **app.jsはIIFEで包まれている**。トップレベルの関数・変数はwindowへ漏れない。
  テスト/コンソールから触る必要があるものは末尾の `window.__csvViewerDebug` に追加する
  （現在: state / getChartImageDataURL / buildPresetSettings / saveCurrentPreset / T /
  renderChart / parseExprToAST / evaluateAST / esc）
- **テーマ色は `styles.css` の `:root` トークンが単一情報源**。ECharts用の実値は起動時に
  `cssVar()` で解決（`T` 定数）。PNG背景も `--bg-main` に追従する
- **ユーザー向け文言は日本語が主言語**（READMEの言語ポリシー参照）。トーストは
  `showToast(kind, message, detail, ttl)` に一本化済み（showError等は薄いラッパー）
- **モーダルは `createModal(contentHtml, opts)` で作る**（`setupModalA11y` を直接呼ばない）。
  例外は独自機構の `showAlignChannelModal` のみ
- **`updatePerGridLabels` はrender時スナップショット（`_lastRenderedLookup`）だけを参照する**。
  ホバー経路に `columns.find` 等の線形検索を書き戻さないこと
- **式パーサ**: ネスト深度上限 `EXPR_MAX_DEPTH = 200`。関数のarityは
  `_builtinFuncArity`（`CUSTOM_RAM_FUNCTIONS` から導出）で検証時にチェックされる
- **プリセット保存**は件数上限 `PRESET_MAX_COUNT = 20`・サイズ上限
  `PRESET_MAX_JSON_CHARS`（約2MB）で保護されている

### 意図的な見送り（理由付き）

- **PF1（点配列キャッシュ）**: 実測で `getActiveGroups` はrender時間140.3msのうち2.4ms（1.7%）。
  `setOption` が支配的でキャッシュ無効化リスクに見合わない（2026-06-11の見送り判断を実測で追認）
- **U5（メッセージカタログへの全集約）**: 文字列の大半が状態と密結合のテンプレートリテラルで
  コスト過大。言語ポリシーのREADME明文化で代替（翻訳要件が出たら再検討）

### 検証済み事項（2026-07-02時点）

- `npm test` 6本合格、`node --check` 全JSクリーン
- Playwrightスモーク（フェーズごとに実施）: 2ファイル同時読込のMain/Sub判定、
  モーダル群の開閉・Escape・フォーカストラップ、トースト上限・aria-live、
  ホバー値のリファクタ前後一致（3位置×5グリッド×2ファイル）、
  `getOption()` 構造スナップショットのM1/M9前後byte一致、
  IIFE化後のwindow漏れゼロ（218名）、プリセット上限動作

## 2026-06-11 (3): チャート縦幅調整・チャンネル名表示改善・フォントサイズ設定（Claude Code実施）

### 新規ファイル

| ファイル | 内容 |
|---|---|
| `layout-utils.js` | フォントサイズプリセットとグリッド高さ配分の純粋関数（UMD、グローバル名 `CSVLayout`） |
| `tests/layout-utils.test.js` | 7ケースのNodeテスト |

### 機能

1. **チャート縦幅調整（スクロール型）**
   - ツールバーの `Fit / − / ＋` で全グリッドの基準高さ(`state.rowHeightPx`)を段階調整。
     コンテナに入りきらない分は `#chart` の `style.height` をpx指定して
     `.chart-container`（`overflow-y:auto` に変更）が縦スクロールする
   - **グリッド下端±6pxの帯**をドラッグで個別の高さ調整(`state.gridHeights`)。
     帯のダブルクリックでそのグリッドだけ自動に戻す。`Fit` は両方リセット
   - 個別高さのキーは **signature（チャンネル名のソート'|'結合）**。
     `chartGroups` の id は連番カウンタでセッションごとに変わるため使わない
2. **フォントサイズの段階調整**（ツールバーの 小/標準/大/特大）
   - `CSVLayout.FONT_PRESETS`: 軸数値(label)・Y軸名(name)・tooltip/ホバーラベル・
     Xスライダーが連動。**標準でもY軸名は10px→13pxに拡大**（常に数値より大きい）
   - フォントに応じて数値ラベル幅・nameGap・グリッド左マージン・複数軸の間隔も
     `CSVLayout.deriveLayout()` で連動（見切れ防止）
3. **Y軸チャンネル名の重なり対策**: yAxisに `nameTruncate: { maxWidth: gridH-8 }` を設定。
   グリッド高さに収まらない長い名前は「…」で自動省略される（ECharts 5.5組み込み）

### 設計判断と制約

- `fontScale` / `rowHeightPx` / `gridHeights` は `collectSettings()` で永続化されるが、
  **`VISUAL_ONLY_KEYS`（history-utils.js）に追加済み = Undo履歴の比較から除外**。
  境界ドラッグ中の連続saveSettingsで履歴がスパムになるのを防ぐため
- settings-utils.js の `OBJECT_KEYS` に `gridHeights` を追加（型防御）
- **ツールチップ表示中に `chart.resize()` するとECharts内部で
  「offsetWidth of null」エラーが出る** → resize前に `hideTip` をdispatchする
  （renderChart内。今後resizeを追加する場合も同様にすること）
- 割り切り: X軸スライダーはキャンバス最下部に付くため、縦スクロール時は
  最下部までスクロールしないと見えない（必要なら将来 position:sticky 等を検討）
- 検証メモ: ヘッドレスプレビューはウィンドウ非表示時に requestAnimationFrame が
  発火しないため、rAF経由の処理（境界ドラッグの再描画等）は直呼びで検証した

## 2026-06-11 (2): アプリ全体のUndo/Redo機能（Claude Code実施）

Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z とツールバーボタンで、ズーム・チャンネル選択・
マージ・Custom RAM・色変更など**全操作を1本の統合履歴**でUndo/Redoできるようにした。
旧来の「Box Zoom限定のCtrl+Z/Y」（`state.zoomHistory`機構）は新機構に完全包含されるため削除。

### 新規ファイル

| ファイル | 内容 |
|---|---|
| `history-utils.js` | 履歴の積み方・辿り方の純粋関数（UMD、グローバル名 `CSVHistory`）。重複排除 / Redo切り捨て / coalesce（連続操作の統合）/ 上限50件。エントリは「正規化済み設定スナップショット+X軸ズーム範囲」 |
| `tests/history-utils.test.js` | 9ケースのNodeテスト |

### 仕組み（重要な設計判断）

- **記録**: `saveSettings()` 冒頭で `recordHistory()` を同期実行。ユーザー操作の確定点は
  すべて `saveSettings()` を通るため、**操作側のコードを変えずに全操作が自動記録される**。
  記録はdebounceしない（debounce後だと「操作直後のCtrl+Z」で最後の操作が履歴に無い事故が起きる）。
- **スナップショット**: `collectSettings()`（localStorage保存と同じ単一情報源）を
  `CSVHistory.makeEntry` がdeep copyして保持。`sidebarWidth` は履歴比較から除外
  （サイドバーのリサイズはUndo対象にしない）。
- **復元**: `restoreHistoryEntry()` が `applySettings()` を再利用。設定が現在と同一なら
  ズームだけ適用する軽量パス。**スナップショットに無いCustom RAMは復元前に
  `removeCustomRAM` で削除**する（`applyPendingSettings` は追加しかしないため）。
- **ズーム復元**: `_pendingZoomRestore` を `renderChart` の `savedXZoom` に注入。
  dispatchActionの後追いではなく、復元中の全再描画が目標ズームで描かれる（レース無し）。
- **再記録防止**: 復元中は `_restoringHistory` フラグで記録を抑制。解除はrAF 1フレーム後。
  万一漏れても `push` の重複排除（key一致でskipped）が最終防衛線。
- **直列化**: Ctrl+Z連打は `_restoreQueue`（Promiseチェーン）で1件ずつ実行。
- **coalesce**: カラーピッカーの `input` 連続発火は `saveSettings('fileColor:'+fid)` で
  1秒以内の連続変更を1エントリに統合。

### 履歴がクリアされる操作（仕様上の制約）

ファイル追加 / ファイル削除 / Clear All / Time単位の手動変更。
CSVの数値データ本体はスナップショットに含まれず復元不可能なため、ファイル構成が
変わった時点で履歴を捨てて現在状態を新しい起点にする。履歴はlocalStorageに保存しない
（セッション限定。リロードで消える）。

### 守るべき制約（今後の開発向け）

- **状態を変える操作を追加したら必ず `saveSettings()` を呼ぶこと**（永続化とUndo記録の両方を担う）
- 設定項目の追加は `collectSettings()` に対して行うこと（履歴とlocalStorageの単一情報源）
- 「見た目だけ」の設定を追加した場合は `history-utils.js` の `VISUAL_ONLY_KEYS` にも追加
- Reset View（`resetZoom`）は履歴に記録される（Undoで戻れる）。ホイール/スライダーの
  ズームは従来どおり記録しない（スパム防止）

### 【バグ修正】Box ZoomでY軸ズームが壊れる（既存バグ）

`dispatchAction({type:'dataZoom', xAxisIndex:[...]})` の `xAxisIndex` はフィルタとして
機能せず、アクションが**全dataZoom（Y軸スライダー含む）に波及**していた。
X軸の時間値（例: 300〜800秒）がY軸ズームに適用され、Y軸の値域が時間値と重なる
グリッド（Engine_RPM等）だけY軸が異常拡大して一部しか表示されなくなる。
Y範囲を数値入力すると直って見えたのは、renderChartがY軸ズームを作り直すため。

修正: `dataZoomIndex: 0`（X軸スライダー）のみを対象にdispatchする。X軸のinsideズームは
軸を共有しているためEChartsが自動連動させる。対象箇所は `onBrushEnd` / `dispatchZoom`
（Undo復元）/ `resetZoom`（冗長な初回dispatchを削除しループのみに）。
旧 `applyZoomFromHistory` 時代から存在した既存バグで、Undo/Redo実装由来ではない。

**制約: dataZoomを操作するdispatchActionは必ず `dataZoomIndex` で対象を明示すること。**

### 【バグ修正】Custom RAMの永続化漏れ

`addCustomRAM` / `removeCustomRAM` が `saveSettings()` を呼んでおらず、RAMの追加/削除が
リロードで失われていた（直後に別の操作をした場合だけ偶然保存されていた）。
両関数の末尾に `saveSettings()` を追加。これによりUndo履歴にも正しく記録される。

### 検証済み事項（2026-06-11時点）

- Nodeテスト3本合格、コンソールエラーなし
- ブラウザ実機: 選択/ズーム/Custom RAM追加のUndo/Redo（種類をまたいだ逆順復帰）、
  Ctrl+Shift+ZのRedo、Ctrl+Z×10連打の整合性、Undo後のリロード整合（localStorage）、
  Clear All/ファイル追加での履歴クリア、ボタンの有効/無効表示、
  RedoでのCustom RAM再計算（11,801点）

## 2026-06-11: 堅牢性・パフォーマンス・プロジェクト整備（Claude Code実施）

改善調査に基づく6コミット（`893e2e3`〜`a82f82c`）。
**リファクタリング（renderChart分割等）と機能追加は意図的に未実施**（下記「今後の改善候補」参照）。

### 新規ファイル

| ファイル | 内容 |
|---|---|
| `settings-utils.js` | 設定データのバージョンチェック+マイグレーション。parser-utils.jsと同じUMDパターン（ブラウザ: `CSVSettings`グローバル / Node: `module.exports`）。`SETTINGS_VERSION = 3`、`migrateSettings(s)` → `{ok, reason, settings}` を返す純粋関数 |
| `tests/settings-utils.test.js` | 上記のテスト5ケース。`node tests/settings-utils.test.js` で実行 |
| `/.gitignore`（リポジトリルート） | ルート直下の `*.csv`（実測データ）と `.claude/settings.local.json` を除外。ルートにあった実測CSV 3つは `git rm --cached` 済み（ディスク上には存在するがgit管理外） |
| `/.claude/launch.json` | プレビュー用。`python -m http.server 8765 --directory csv_viewer` |

削除: `prompt.md`（0バイトの空ファイルだった）

### app.js の変更点（正確な位置と意図）

**1. 非同期エラーの捕捉漏れ修正**
- `onHeaderParsed` 内（約1600行付近）: `addCustomRAMsToFile(fileId)` に `.catch()` を追加。
  **`.catch` を `.then` の前に置いている**のは、失敗時も `updateUI()`/`saveSettings()` を必ず実行するため。順序を入れ替えないこと。
- `applySettings` 末尾（約5180行付近）: `applyPendingSettings().then(updateUI)` に `.catch()` 追加。
- 背景: asyncコールバック内で投げっぱなしにしたPromiseの拒否は、外側の `try/catch` では捕捉されない。

**2. `_parseQueue`（列遅延ロードのキュー）の防御**
- `loadColumnsForFile` 内: `const prev = (_parseQueue.get(fileId) || Promise.resolve()).catch(() => {});`
  および cleanup チェーンに `.catch()` を追加。
- 背景: ジョブがrejectすると拒否済みPromiseがMapに残留し、以降そのファイルの列読み込みが**永久に失敗し続ける**バグがあった。

**3. 【バグ修正】time-unit-selectのリスナー累積**
- `.time-unit-select` への change リスナー登録を `renderCustomRAMList()` から `renderFileList()` 末尾へ移動。
- 背景: `renderCustomRAMList` はファイルリストのDOMを再構築せずに単独でも呼ばれるため、Custom RAM追加/削除のたびに**同じselect要素へリスナーが累積**し、Time単位切替で `setManualTimeUnit`（内部で全Custom RAM再計算）が複数回走っていた。
- **制約: `dom.fileList` 内の要素へのリスナー登録は必ず `renderFileList()` 内で行うこと**（innerHTML再構築とセットだから累積しない）。

**4. 設定のバージョンチェック組み込み**
- `applySettings(rawSettings)` 冒頭で `CSVSettings.migrateSettings()` を通すよう変更。
  起動時復元・JSONインポート・プリセット適用の**全経路がここを通る**ので検証はこの1箇所だけでよい。
- 未来バージョン（`_version > 3`）は読み込み拒否+`showWarning`。型が壊れたキーは個別に捨てて残りを活かす。
- **制約: 設定スキーマを変更したら `settings-utils.js` の `SETTINGS_VERSION` を上げ、`migrateSettings` に旧→新の変換を追加し、テストも更新すること。** `saveSettingsNow` / `buildSettingsForExport` の `_version` も一致させる。

**5. 保存失敗のユーザー通知**
- `saveSettingsNow` の catch: `showWarning` でトースト表示（`_storageWarnShown` フラグで多重表示防止、保存成功時にリセット）。
- `savePresets`: try/catch なしだったのを `showError` 付きで包んだ。

**6. saveSettings のdebounce化（重要な挙動変更）**
- 旧 `saveSettings()` の本体は **`saveSettingsNow()` にリネーム**。
  `saveSettings()` は500msのdebounceラッパーになった（呼び出し側 約18箇所は無変更）。
- `flushSettingsSave()`: 保留中の保存を即時実行。`pagehide` + `visibilitychange(hidden)` で自動flush。
- Clear Allハンドラ: `localStorage.removeItem` 直後に予約タイマーをキャンセル（しないと500ms後に空設定が書き戻される）。
- **制約: 「保存直後にlocalStorageを読み戻す」コードを書く場合は、先に `flushSettingsSave()` を呼ぶこと**（現状そういう箇所はない。`STORAGE_KEY` を読むのは起動時の `loadSettings` のみ）。
- いずれも function宣言（hoisting前提）。`const saveSettings = ...` に書き換えると定義位置より前のリスナー登録が壊れる。

**7. ホバー経路の最適化（重要な構造変更）**
- `renderChart` が `getActiveGroups()` の結果をモジュール変数 `_lastRenderedGroups` に保存し、
  `updatePerGridLabels()`（EChartsのtooltip formatterからマウス移動のたびに呼ばれる）は**スナップショットを参照するだけ**に変更。
- 背景: 旧実装は毎mousemoveで全シリーズ×全ポイントの `[time, value]` 配列を再構築していた（しかも構築した配列はラベル表示に未使用。値は `interpolate()` で別途補間している）。
- **制約: `updatePerGridLabels` 内で `getActiveGroups()` を呼び直さないこと。チャンネル選択・マージ・シフト等の状態を変えたら必ず `renderChart()` を通すこと**（通せばスナップショットは自動更新される）。

### 検証済み事項（2026-06-11時点）

- `node --check app.js` / 両テストファイル合格
- ブラウザ実機（NEDC_sample A+B読込）: チャート描画、ホバー値の正確性（ファイル間の微差まで確認）、Custom RAM両ファイル計算、リスナー累積が1回に修正されたこと、`_version: 99` 設定でのリロードが警告のみでクラッシュしないこと、debounce保存とflushの動作

### 今後の改善候補（今回は意図的に未実施）

1. `renderChart()`（約340行）の分割: グリッド計算 / 軸配置 / シリーズ構築に分離するとテスト可能になる
2. モーダル生成の共通化: `showOverlayAxisModal` / `showChartGroupModal` / `showDebugModal` / `showCustomRAMUnitModal` / `showChannelMapModal` がほぼ同じDOM構築を繰り返している
3. `showError` / `showWarning` のトースト生成共通化（色だけ違う重複コード）
4. マジックナンバーの集約（`BIT_WEIGHT = 0.33`、ズーム履歴上限50、サジェスト上限100など）
5. renderChart側の `mPts`/`sPts` 構築キャッシュ: **検討の結果見送り**。シフトドラッグ中はoffsetが毎フレーム変わってキャッシュミスし続けるため効果が薄く、無効化漏れのリスクだけ増える。やるなら効果を実測してから
6. app.js本体のテスト追加（現状テストがあるのは parser-utils / settings-utils のみ）
