# 変更履歴

開発を引き継ぐ人（人間・AIエージェント問わず）向けの正確な変更記録。
コミット単位の詳細は `git log` も参照のこと。

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
