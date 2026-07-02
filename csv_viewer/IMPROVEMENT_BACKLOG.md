# 改善バックログ（2026-07-02 コードレビュー結果）

CSV Chart Viewer 全体のコードレビューで洗い出した改善タスク集。
**実装を引き継ぐエージェント（人間・AI問わず）が、タスク単位で自己完結に着手できる**ことを目的に書いている。

## 実施状況（2026-07-02 実装完了）

全29タスクを7フェーズで実施した。詳細は CHANGELOG.md の 2026-07-02 エントリと各コミットを参照。
以下の本文は着手時点の記録として残す（行番号は実装前のもの）。

| 状況 | タスク | コミット |
|---|---|---|
| ✅ 完了 | B1, B2, B3, B4, B5, B6, S1 | `1f41be9` |
| ✅ 完了 | S2, S4, U1, U2, U3, M3 | `5b152e4` |
| ✅ 完了 | S3, M2 | `960f35a` |
| ✅ 完了 | PF2, PF3, PF4 | `968e83f` |
| ✅ 完了 | M4, U4, U6（U5はポリシー文書化で代替） | `90eb86c` |
| ✅ 完了 | M6, M7, M8 | `0973dd1` |
| ✅ 完了 | M1, M9, M5 | `ff0f928` / `1f41be9` |
| ⏸ 見送り | PF1 — 実測でrender時間の1.7%(2.4ms/140.3ms)。効果に対しキャッシュ無効化リスクが過大 | — |
| ⏸ 縮小実施 | U5 — 全文字列のカタログ集約は見送り。言語ポリシーをREADMEに明文化し、英語混じりのトースト2件を日本語へ統一 | `90eb86c` |

## 着手前に必ず読むこと

1. **[README.md](README.md)** — アプリ概要と機能一覧
2. **[CHANGELOG.md](CHANGELOG.md) の「守るべき制約」** — 特に以下は違反するとリグレッションになる:
   - 状態を変える操作を追加したら必ず `saveSettings()` を呼ぶ（永続化とUndo記録の両方を担う）
   - 設定項目の追加は `collectSettings()` に対して行う。見た目だけの設定は `history-utils.js` の `VISUAL_ONLY_KEYS` にも追加
   - 設定スキーマ変更時は `settings-utils.js` の `SETTINGS_VERSION` +マイグレーション+テストをセットで更新
   - dataZoomを操作する `dispatchAction` は必ず `dataZoomIndex` で対象を明示
   - `dom.fileList` 内の要素へのリスナー登録は必ず `renderFileList()` 内で行う
   - `updatePerGridLabels` 内で `getActiveGroups()` を呼び直さない
   - ツールチップ表示中の `chart.resize()` は事前に `hideTip` をdispatch

## 実行・検証方法

- 起動: `index.html` をブラウザで開く（サーバー不要。プレビュー用に `python -m http.server 8765 --directory csv_viewer` も可）
- 動作確認用データ: 同梱の `NEDC_sample_A.trn` / `B` / `C`
- 単体テスト: `node tests/<name>.test.js`（全5本）
- 構文チェック: `node --check <file>.js`

**ベースライン（2026-07-02時点）**: 全5テスト（parser / settings / history / layout / drive-index）パス。
タスク完了時は必ず全テスト再実行+関係する実機動作確認をすること。

## 優先度の意味

| 優先度 | 意味 |
|---|---|
| P1 | バグ。特定の操作でアプリの動作が壊れる |
| P2 | セキュリティ / 堅牢性。悪意ある入力や異常系で問題になる |
| P3 | パフォーマンス。大容量データで体感に影響 |
| P4 | 保守性。機能追加の障害になっている構造問題 |
| P5 | UX / アクセシビリティ |

行番号は 2026-07-02 時点のもの。着手時にずれていたら周辺を検索して特定すること。

---

## P1: バグ

### B1: 複数ファイル同時ドロップで両方が Main になる競合

- **対象**: `app.js:1665-1666`（ロール判定）、`app.js:1715` 付近（`state.files` への挿入）
- **現状**:
  ```js
  const hasMain   = Object.values(state.files).some(f => f.role === 'main');
  const role      = hasMain ? 'sub' : 'main';
  ```
  この判定は `onHeaderParsed`（Phase 1 のプレビューパース完了時）で走るが、ファイルが `state.files` に入るのは Phase 2 のストリームパース完了後。パースは非同期なので、Main 不在の状態で2ファイルを同時ドロップすると両方が `hasMain=false` を見て両方 `role:'main'` になる。
- **影響**: `getMainFile()`（`app.js:1929`）は最初の1件を返すだけなので、2つ目の Main は選択もオーバーレイもできない死にファイルになる。
- **修正方針**: ロール決定を `state.files` への挿入時（Phase 2 の `complete` コールバック内）に遅延させるか、`handleFiles` / `parseCSV` の同期区間で「Main枠」を予約するカウンタを導入する。
- **完了条件**: Main 不在の状態で2ファイルを一括ドロップ → 1つが Main、もう1つが Sub になること。既存の単発読み込み・追加読み込みの挙動が変わらないこと。

### B2: `.trn` パースでスペースを含むチャンネル名が列ずれを起こす

- **対象**: `parser-utils.js:4-8`（`convertWhitespaceToTabs`）、利用側 `app.js:1525` 付近
- **現状**:
  ```js
  .map(line => line.replace(/\|/g, ' ').trim().replace(/\s+/g, '\t'))
  ```
  連続空白1個以上をすべてタブに変換するため、`Vehicle Speed` のような**単一スペースを含むチャンネル名が2列に分割**され、以降の全行がずれる。同梱サンプルは `Target_Speed` などアンダースコア名なので顕在化していない。
- **修正方針**: 実際の `.trn` フォーマット仕様を確認のうえ、区切りを「2個以上の連続空白またはタブ」（`/\s{2,}|\t/`）にする等、単一スペースが名前内で生き残る規則へ変更。`tests/parser-utils.test.js` にスペース入り名のケースを追加。
- **完了条件**: スペース入りチャンネル名を含む `.trn` が正しい列数でパースされ、既存サンプル3ファイルの読み込み結果が変わらないこと。

### B3: ドロップゾーン外へのD&Dでページ遷移し全状態が消える

- **対象**: `app.js:1380-1386`（`dom.dropZone` のみガード）。window レベルの `dragover`/`drop` ハンドラは存在しない
- **現状**: ファイルをドロップゾーン以外（チャート領域など）に落とすと、ブラウザのデフォルト動作でそのファイルへページ遷移し、読み込み済みデータが全部消える。
- **修正方針**: `window` に `dragover` / `drop` のリスナーを追加して `e.preventDefault()`。チャート領域へのドロップも読み込みとして受け付けるかは任意（最低限は遷移防止のみでよい）。
  ※ `app.js:5259` 付近に Arrange モード用のパネル `dragover` があるので干渉しないこと。
- **完了条件**: ドロップゾーン外にファイルを落としてもページ遷移しないこと。ドロップゾーンへのD&Dと Arrange モードのドラッグが従来どおり動くこと。

### B4: 並行パース中に共有DOM経由でヘッダー検出値が汚染される

- **対象**: `app.js:1621-1622`（検出値のDOM書き戻し）、`detectHeaderRows` 呼び出し周辺（`app.js:1571` 付近）
- **現状**:
  ```js
  dom.nameRow.value = nameRow + 1;
  if (unitRow >= 0) dom.unitRow.value = unitRow + 1;
  ```
  ヘッダー検出結果を共有のSettings入力欄に書き戻し、次のパースがその値を読む。複数ファイルを同時に読み込むと、ファイルBの検出がファイルAの書き戻し値に影響される。
- **修正方針**: パース処理チェーン内では行ヒントを関数引数/ジョブオブジェクトで受け渡し、DOMへの書き戻しは「UI表示の更新」としてだけ行う（読み取りに使わない）。
- **完了条件**: ヘッダー構成の異なる2ファイルを同時ドロップして、それぞれ正しいヘッダー行で読み込まれること。

### B5: `LEGACY_CYCLE_ID` が二重定義され、既に内容が食い違っている

- **対象**: `settings-utils.js:16` と `drive-index-utils.js:72`
- **現状**:
  ```js
  // settings-utils.js
  const LEGACY_CYCLE_ID = { wltc3: 'wltc3b_4', mdc: null };
  // drive-index-utils.js
  const LEGACY_CYCLE_ID = { wltc3: 'wltc3b_4' };   // mdc なし
  ```
  同名の旧ID変換マップが2箇所にあり、`mdc` の扱いが既に不一致。今後の変更で無言のまま発散する。
- **修正方針**: `drive-index-utils.js` 側を単一情報源にし（`window.DriveIndex.LEGACY_CYCLE_ID` として公開済み: `drive-index-utils.js:381`）、`settings-utils.js` から参照する——ただし settings-utils は Node 単体テスト可能な純粋関数という設計なので、依存を持ち込めない場合は「両者の整合を検証するテスト」を追加して発散を検知する方式でもよい。`mdc: null`（削除扱い）と `mdc` 素通しのどちらが正か仕様を確認して統一。
- **完了条件**: マップが1箇所になる、または両者の整合テストが追加される。settings / drive-index の既存テストがパス。

### B6: `applySettings` が `yRanges` / `fileColors` を参照代入している

- **対象**: `app.js:6462` と `app.js:6470`
- **現状**:
  ```js
  if (s.yRanges) state.yRanges = s.yRanges;
  if (s.fileColors) state.fileColors = s.fileColors;
  ```
  兄弟キー（`gridHeights` 等、`app.js:6442-6444`）はスプレッドコピーしているのに、この2つはインポートJSON由来のオブジェクトをそのまま `state` に載せている。以後の編集が設定オブジェクトと同一実体を書き換えるうえ、値の形式検証もない。
- **修正方針**: `{ ...s.yRanges }` 形式のシャローコピーに統一。あわせて S1（色形式の検証）を同時に実施すると効率的。
- **完了条件**: 設定JSONインポート → Y範囲・ファイル色の変更 → 再インポートで汚染がないこと。Undo/Redo（履歴スナップショットとの実体共有がなくなること）が正常動作。

---

## P2: セキュリティ / 堅牢性

### S1: `fColor` が未エスケープ・未検証で style 属性に補間される

- **対象**: `app.js:2379`（style属性）、`app.js:2382`（value属性）。供給源は `applySettings`（`app.js:6470`、B6参照）
- **現状**:
  ```js
  style="background:${fColor};color:#fff;border-color:${fColor};"
  ```
  `fColor` は設定JSONインポートで任意文字列を注入でき、`esc()` も形式検証も通らない唯一の補間箇所（同関数内の他の文字列はすべて `esc()` 済み）。属性コンテキストを破壊できる。
- **修正方針**: インポート/読込時（`applySettings`）に `/^#[0-9a-f]{6}$/i` で検証し、不正値はデフォルト色へフォールバック。出力側でも `esc()` を通す。
- **完了条件**: 細工した設定JSON（`fileColors` に `"><img ...` 等）を読み込んでもDOMが壊れず警告のみになること。

### S2: `esc()` がシングルクォートをエスケープしない

- **対象**: `app.js:200-206`
- **現状**: `& < > "` のみ変換。現状は補間先が全部ダブルクォート属性なので実害はないが、将来シングルクォート属性にユーザー文字列を入れた瞬間に注入可能になる。
- **修正方針**: `.replace(/'/g, '&#39;')` を追加。
- **完了条件**: チャンネル名・ファイル名に `'` を含むデータで表示が崩れないこと（既存動作維持）。

### S3: インライン `onclick` の排除（CSP対応の下準備）

- **対象**: `index.html:28`（Browse Filesボタン）、`app.js:2592` / `app.js:4123` / `app.js:5780`（innerHTML内の `onclick="this.closest('#app-modal-overlay').remove()"` 等）
- **現状**: CSP（`script-src` に `unsafe-inline` なし）を導入するとこれらが全滅する。インラインハンドラはこの4箇所のみ。
- **修正方針**: `addEventListener` へ移行。モーダル閉じるボタンは M2（モーダル共通化）で `createModal` ヘルパーに閉じ処理を持たせると一石二鳥。
- **完了条件**: Browse Files とモーダルの閉じるボタンが従来どおり動作。`grep -n 'onclick=' app.js index.html` が0件。

### S4: Custom RAM 式評価の軽微な防御追加

- **対象**: `app.js:244`（`tokenizeExpr`）、`app.js:291`（`parseExprToAST`）、`app.js:398`（`evaluateAST`）、`app.js:542` / `app.js:558`（`mavg` / `delay`）
- **現状**: eval / new Function 不使用の自前パーサで**設計として安全**（この点は維持すること）。残る問題は (1) `mavg`/`delay` が `argNodes[1]` を存在チェックなしで読む（`undefined`→`NaN` で無害だが雑）、(2) 再帰下降パーサなので `((((...))))` のような異常に深い式でスタックオーバーフローし得る。
- **修正方針**: 引数個数チェックでユーザー向けエラーメッセージを出す。パース時にネスト深度カウンタ（上限例: 200）を入れて超過時はエラー扱い。
- **完了条件**: `mavg(RPM)`（引数不足）と深いネスト式が、クラッシュせずエラー表示になること。既存の式サンプル（README記載）が動作。

---

## P3: パフォーマンス

### PF1: `getActiveGroups` が再描画のたびに全データ点配列を再構築

- **対象**: `app.js:4782-4783`（Main側）、`app.js:4817-4818`（Sub側）
- **現状**: ズーム・Undo・色変更など `renderChart()` が走るたびに、全チャンネル×全ファイル分の `[t, v]` ペア配列を新規アロケートしている。大容量データではGC圧が大きい。
- **修正方針**: `(colId, offset)` をキーに点配列をキャッシュし、データ/オフセット変更時のみ無効化。**注意**: CHANGELOG「今後の改善候補 5」に「シフトドラッグ中はキャッシュミスし続けるので効果を実測してから」という見送り判断が記録済み。**着手前に大きめデータで実測し、効果が出る設計（例: ドラッグ中はキャッシュ迂回）を確認してから実装すること。**
- **完了条件**: 実測でrender時間 or GC頻度の改善を確認。シフトドラッグ・Undo/Redo・Channel Map重ね描画の表示が完全一致。

### PF2: mousemove ごとの `updatePerGridLabels` 内で線形検索

- **対象**: `app.js:5349`（`mainFile.columns.find(...)`）、`app.js:5358`（`getSubFileIds()`）
- **現状**: ツールチップ formatter からマウス移動のたびに呼ばれるパスで、チャンネルごとに `columns.find` と `getSubFileIds()` を再計算している。
- **修正方針**: `renderChart` 時に `name → column` の Map とサブファイルIDリストを `_lastRenderedGroups` と同様のスナップショットとして保存し、ホバー時は参照のみにする（CHANGELOG記載の `_lastRenderedGroups` 方式の拡張）。
- **完了条件**: ホバー値の表示が従来と完全一致（ファイル間の微差含む）。チャンネル数が多いデータでホバーが軽くなること。

### PF3: チャンネル検索が1キーストロークごとに全リスト再構築

- **対象**: `app.js:4130`（`dom.colSearch.addEventListener('input', renderColumnList)`）
- **現状**: `renderColumnList` はリスト全体のDOMを作り直す。チャンネル数が多いと入力がもたつく。
- **修正方針**: 入力を150ms程度でdebounce（`saveSettings` のdebounce実装 `app.js:6190` 付近が参考になる）。さらに必要なら再構築ではなく既存要素の show/hide 切り替えに変更。
- **完了条件**: 検索の絞り込み結果が従来と同一。連続タイプでカクつかないこと。

### PF4: window resize が未スロットル

- **対象**: `app.js:937`
- **現状**: `window.addEventListener('resize', () => state.chart.resize());` が同期で毎イベント発火。
- **修正方針**: rAFスロットル（フレームに1回）にする。**注意**: CHANGELOG記載の制約「resize前に `hideTip` をdispatch」を踏襲すること。
- **完了条件**: ウィンドウリサイズでチャートが追従し、ツールチップ表示中のリサイズでコンソールエラーが出ないこと。

---

## P4: 保守性

> M1〜M4 は CHANGELOG「今後の改善候補」既載。今回のレビューで**現在も有効**と検証済み。

### M1: `renderChart`（約377行）の分割

- **対象**: `app.js:4849-5226`
- **現状**: グリッド計算・軸配置・シリーズ構築・dataZoom構築・`setOption`・領域ブックキーピングが1関数に同居。app.js 本体にテストがない最大の原因。
- **修正方針**: 「グリッドレイアウト計算」「軸オプション構築」「シリーズオプション構築」の純粋関数を切り出す（`layout-utils.js` と同じUMDパターンで別ファイル化すればNodeテスト可能）。`setOption` 呼び出しと状態更新だけを `renderChart` に残す。
- **完了条件**: 切り出した純粋関数にNodeテストが付くこと。実機で描画・ズーム・マージ・Arrange・フォントサイズ変更が従来どおり。

### M2: モーダル生成9箇所の共通化

- **対象**: `app.js:1070, 1315, 2582, 3057, 3518, 4113, 4342, 4563, 5771` 付近
- **現状**: オーバーレイ生成+`setupModalA11y` 呼び出しがほぼ同型で9回繰り返され、しかも `overlay.className = 'app-modal-overlay'` 方式と `style.cssText` 直書き方式の**2系統が混在**している。
- **修正方針**: `createModal(contentHtml, opts)` ヘルパー（`{overlay, modal, close}` を返す）を1つ作り、全モーダルを移行。スタイルはクラス方式に統一。S3の閉じボタン処理もここに集約。
- **完了条件**: 全モーダル（Debug / Overlay軸 / ChartGroup / RAM単位 / Channel Map / Drive Index 等）の開閉・Escape・フォーカストラップが従来どおり。

### M3: トースト3関数の共通化

- **対象**: `app.js:9`（showError）、`app.js:35`（showWarning）、`app.js:6056`（showExportToast）
- **現状**: コンテナ生成+トースト構築+自動消去のロジックが約90%重複（色とタイムアウトだけ違う）。
- **修正方針**: `showToast(kind, message, detail, ttl)` に一本化し、3関数は薄いラッパーとして残す（呼び出し側は無変更でよい）。U1（aria-live / 上限）と同時に実施すると効率的。
- **完了条件**: エラー/警告/エクスポート完了の各トーストが従来の色・表示時間で出ること。

### M4: マジックナンバーの集約

- **対象**: 例として `BIT_WEIGHT = 0.33`（`app.js:4894`）、`ZOOM_GAP = 12`（`app.js:4945`）、狭幅しきい値 `260`（`app.js:4959`）、`progressive: 400` / `progressiveThreshold: 3000`（`app.js:5131-5132`）、トーストの `15000/9000/3000`ms、履歴上限50（history-utils.js）、markArea境界の `*100 + 1e9` センチネル（`app.js:5106-5107`）
- **修正方針**: レイアウト定数 `L`（`app.js:630` 付近）に倣い、意味のある名前を付けてファイル冒頭の定数群へ集約。値は変更しない。
- **完了条件**: 挙動不変（値の変更をしないこと）。`node --check app.js` パス。

### M5: drive系2ファイルのUMD統一

- **対象**: `drive-index-utils.js:379`（`window.DriveIndex = {...}`）、`drive-cycles-data.js:55`
- **現状**: 他の4ユーティリティは `(function(root){...})(globalThis)` のUMDパターンなのに、この2つだけ `window` 直付け。そのため `tests/drive-index-utils.test.js:8-14` だけ `vm.createContext` で偽windowを作る特殊なboilerplateが必要になっている。
- **修正方針**: 他ユーティリティと同じUMDラッパーに変換し、テストを素の `require` に書き換える。読み込み順（`index.html:216-217`、cycles→index の依存順）は維持。
- **完了条件**: 全5テストがパス、drive-indexテストからvm boilerplateが消える。ブラウザでDrive Index機能が従来どおり動作。

### M6: `package.json` + `npm test` の追加

- **対象**: リポジトリに `package.json` が存在しない。テストは5本を個別実行するしかなく、集約exit codeもない。さらに README のテスト一覧（`README.md:134-137`）から `drive-index-utils.test.js` が漏れている
- **修正方針**: 最小の `package.json` を追加し、`"test"` スクリプトで `tests/*.test.js` を順次実行して失敗時に非0で終了させる（Node組み込みの `node --test` へ寄せる場合はテストファイルの書き換え規模に注意。シェルループで十分）。README のコマンド記載を `npm test` に更新。
- **完了条件**: `npm test` 1コマンドで5本全部が走り、1本でも失敗すれば非0終了すること。

### M7: README / ドキュメントの実態同期

- **対象**: `README.md:10-20`（ファイルツリー）、`README.md:133-147`（テスト・構文チェック一覧）、`README.md:152-159`（ライブラリ表）
- **現状**: `drive-index-utils.js` / `drive-cycles-data.js` / `generate_nedc.js` / `layout-utils.js`（構文チェック側）がツリーや一覧から漏れている。同梱ライブラリのバージョンがどこにも記録されていない（CHANGELOGに「ECharts 5.5」の言及があるのみ）。
- **修正方針**: ツリー・テスト一覧・checkリストに漏れ分を追加。ECharts / PapaParse のバージョンを確認（minファイル冒頭のバナーコメントで確認可能）してライブラリ表に併記。
- **完了条件**: README記載のコマンドを全部実行して通ること。ツリーが `ls` の実態と一致。

### M8: `generate_nedc.js` の整理とシード付き乱数化

- **対象**: `generate_nedc.js`（Node専用の開発スクリプト。アプリからは未参照）。`Math.random()` 使用箇所: `generate_nedc.js:92, 105, 129, 140` ほか
- **現状**: アプリ本体と同じディレクトリに置かれ、再実行のたびに異なる `NEDC_sample_*.trn`（計約2.5MB、コミット済み）を出力する。フィクスチャが再現不能。
- **修正方針**: `scripts/`（または `tools/`）へ移動し、シード付きPRNG（mulberry32等の数行実装で十分）に置き換えて出力を決定的にする。README開発メモに使い方を記載。
- **完了条件**: 同じシードで2回実行した出力が一致すること。生成した `.trn` がアプリで従来どおり読めること。

### M9: app.js 本体のテスト基盤（IIFE化）

- **対象**: `app.js` 全体（現状すべての関数・`let` がグローバルスコープ）
- **現状**: モジュール境界がなくテスト不能。`_pendingSettings` などの内部状態も `window` に露出。
- **修正方針**: 全体をIIFEで包み、テストに必要な純粋関数（式パーサ群 `tokenizeExpr`/`parseExprToAST`/`evaluateAST` が第一候補）だけを明示的に公開する。M1の renderChart 分割と組み合わせて段階的に。**大工事なので他タスク完了後に実施推奨。**
- **完了条件**: `node --check app.js` パス、実機全機能動作、式パーサへのNodeテスト追加。

---

## P5: UX / アクセシビリティ

### U1: トーストのaria-live対応と表示上限

- **対象**: `app.js:15-20, 38-43, 57-62`（コンテナ生成）、`appendChild` 箇所 `app.js:29, 51, 6069`
- **現状**: (1) コンテナに `role` / `aria-live` がなくスクリーンリーダーに通知されない。(2) 上限なしで積み上がる（不正ファイルを多数ドロップすると画面右上が埋まる）。
- **修正方針**: コンテナに `role="status"` + `aria-live="polite"`（エラーは `assertive` でも可）。表示数上限（例: 5件）を設け、超過時は最古を除去。M3（トースト共通化）と同時実施を推奨。
- **完了条件**: 未対応拡張子のファイルを10個一括ドロップしてもトーストが上限件数で収まること。

### U2: `prefers-reduced-motion` 対応

- **対象**: `styles.css:6-9`（`slideIn`）、適用箇所 `app.js:24, 47, 6065`
- **修正方針**: アニメーションを `@media (prefers-reduced-motion: no-preference)` ガード内に移す。
- **完了条件**: OSの「視覚効果を減らす」設定でトーストが瞬時表示になること。

### U3: Settings欄の `<label>` と入力の関連付け

- **対象**: `index.html:39-42`（Name Row / Unit Row）。同様のパターンが他にもないか確認（`#line-width-range` / `#show-markers-chk` は `index.html:162, 166` 付近で `aria-label` 不在）
- **修正方針**: `for="name-row-idx"` 等を追加。rangeとcheckboxには他のselect（`index.html:44` 等）と同様の `aria-label` を付ける。
- **完了条件**: 各入力にアクセシブルネームが付くこと（ブラウザのアクセシビリティツリーで確認）。

### U4: テーマ色のCSS/JS二重管理の解消

- **対象**: `app.js:619` 付近（「EChartsはCSS変数を解釈しない」コメント以下のハードコード群）、`app.js:5974`（PNG背景 `#0f1115` = `--bg-main` の複製）
- **現状**: ダークテーマ固定自体は仕様として許容範囲だが、色値がCSSとJSに二重で存在し、テーマ調整時にドリフトする。
- **修正方針**: 起動時に `getComputedStyle(document.documentElement).getPropertyValue('--bg-main')` 等でCSS変数を読み取ってJS側の定数を組み立てる。将来ライトテーマを足す場合もこの一元化が前提になる。
- **完了条件**: `styles.css` の `--bg-main` を変えるとチャート背景・PNG出力背景が追従すること。

### U5: UI文言の整理（日英混在）

- **対象**: ツールバーは英語（`index.html:109-188`: Clear All / Box Zoom / Save PNG 等）、トースト・モーダル・validationは日本語（`app.js:1399, 1660, 2367` 等多数）
- **現状**: 同一画面で日英が混在。文字列がコード全体に散在しており、統一・翻訳のどちらをやるにもまず集約が必要。
- **修正方針**: まず文字列をキー付きカタログ（例: `messages.js`）へ集約し、主要言語を日本語に統一（ツールバーの英語ラベルは慣習として残す判断も可 — その場合も「どちらに寄せるか」の基準をREADMEに明記する）。フル i18n 機構は要件が出るまで不要。
- **完了条件**: ユーザー向け文字列がカタログ1箇所に集まり、表示が意図どおりであること。

### U6: プリセット容量の保護

- **対象**: `app.js:6271-6289`（`buildPresetSettings`）、`app.js:6301-6309`（`savePresets`）
- **現状**: プリセットは件数・サイズ無制限で、チャンネル数に比例して肥大化する。localStorage quota（約5MB）超過時はトースト警告のみで保存が黙って失われる。
- **修正方針**: 保存時にシリアライズサイズを見て警告付きで拒否 or 古いプリセットの整理を促す。件数上限（例: 20件）も検討。
- **完了条件**: 大量チャンネルデータでプリセットを連続保存しても、失敗が明確にユーザーへ伝わること。

---

## レビューで確認した「問題なし」事項（再調査不要）

- **Custom RAM式評価は injection-safe**: eval / new Function 不使用。ホワイトリスト方式の関数ディスパッチ（`app.js:462-573`）。この設計を維持すること
- **XSS対策はほぼ徹底**: `esc()` が全 `innerHTML` 補間箇所に適用済み（唯一の例外がS1の `fColor`）
- **localStorage quota処理は良好**: `saveSettingsNow` / `savePresets` / 各ローダーとも try/catch + トースト通知あり
- **モーダルのa11y基盤は良好**: `setupModalA11y`（`app.js:77`）が role/フォーカストラップ/Esc/フォーカス復帰を実装済み
- **script読み込み順は正しい**: libs → utils（cycles→drive-indexの依存順含む）→ app.js（`index.html:210-218`）
- **`_pendingSettings` のライフサイクルは正常**: `applyPendingSettings` 末尾（`app.js:6654`）でクリア済み。Mainファイル未読込時に保留し続けるのは意図した設計
- **`drive-index-utils.js` / `drive-cycles-data.js` はデッドコードではない**: app.js から約20箇所参照される現役機能

## 実施順序の推奨

1. **M6（npm test）+ M7（README同期）** — 以降の全タスクの検証基盤。低リスク
2. **P1バグ群（B1〜B6）** — B6とS1、B5とM5は同時実施が効率的
3. **P2（S2〜S4）+ U1〜U3** — 小粒で独立、並行可能
4. **M2 + M3 + S3** — モーダル/トースト共通化はセットで
5. **PF2〜PF4** — 低リスクな性能改善（PF1は実測が前提条件）
6. **M1 → M9** — 構造改善は最後に。M4はいつでも可
