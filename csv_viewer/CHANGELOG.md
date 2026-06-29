# 変更履歴

開発を引き継ぐ人（人間・AIエージェント問わず）向けの正確な変更記録。
コミット単位の詳細は `git log` も参照のこと。

## 2026-06-29: 描画ON/OFFトグル・走行サイクルの初回再判定（Claude Code実施）

### 機能

1. **描画ON/OFFトグル**（ツールバー「描画 ON / 描画 OFF」ボタン）
   - データ・チャンネル選択を保持したままチャート描画だけを消せる。比較作業で
     データを読み込み直す手間をなくすための機能
   - `state.renderEnabled`（既定 `true`、永続化しない）。`renderChart()` 冒頭で
     OFF なら `chart.clear()` してオーバーレイ（「描画OFF — データは保持されています」）を
     表示し早期 return。ON に戻すと現在の選択で即再描画
2. **走行サイクルの初回再判定**
   - `di.cycleId` は localStorage に保存されるため、前回 MDC で終了→再起動して
     NEDC データを読んでも MDC のままになっていた問題を修正
   - `state.driveIndex.autoDetectedOnce`（永続化しない）を追加。`computeDriveIndex()` で
     セッション内の初回メインファイル判別時、判別できたら保存値を上書きして判別結果を採用。
     以降の手動サイクル選択は従来通り尊重される。Clear All でフラグをリセット

### 変更ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | ツールバーに `#render-toggle-btn` を追加 |
| `app.js` | `renderEnabled`/`autoDetectedOnce` 状態、`renderChart` ガードとオーバーレイ、トグル関数、サイクル初回再判定、計算後の保存 |

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
