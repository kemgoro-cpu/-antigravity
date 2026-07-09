# 引き継ぎ: メイン/サブ入れ替えでクロスファイルCustom RAMの線が消えるバグ

> このファイルは別セッションへの引き継ぎ用。新セッションはまずこれを読むこと。
> 作成日: 2026-06-21

## いま依頼されているタスク（新セッションでやること）

**症状**: メインデータとサブデータを「入れ替える」と、クロスファイルのCustom RAM
（例 `integral(Fuel_Rate - s1:Fuel_Rate)`）の**線が消える**。

→ **原因を特定し、対策を実装する**こと。

---

## ✅ 解決済み（2026-06-21 追記）

**根本原因**: `integral`（`app.js:499` 付近）が累積計算で、`out[i] = out[i-1] + (x[i-1]+x[i])/2*dt`
の形だったため、入力 `x` に1点でも `NaN` が混じると**それ以降が全部 NaN に伝播**していた。
クロスファイル参照 `getCrossRef`（`app.js:2645`）は「サブの時間範囲外」を `NaN` にするので、
入れ替えで評価基準の時間範囲が変わり、**新サブ側に残ったオフセットで新メインの先頭が範囲外**に
なると、序盤の NaN が積分全域へ伝播 → 線が丸ごと消える。入れ替え前は範囲が収まって NaN が
出ないため線が出る、という非対称が症状の正体。仮説3（offset起因）が当たり。
※ `setMainFile` は既に `recomputeCustomRAMs()`（cross-refロード込み）を呼んでおり、仮説2は対象外だった。

**再現の確証**: `tests/_swap_repro.js`（実データ NEDC_sample_A/B を使用）。
- offset 0（同一範囲）: NaN 0点、現状でもOK（＝素のリポ手順だけでは出ない場合あり）。
- 新サブAに offset=+3.0 残存: crossref範囲外NaN=先頭から30点 → **現状integralは11800/11801点NaN（線消滅）**、
  修正版は31点欠損のみ（線は出る）。

**対策（実装済み）**: `integral` を NaN 耐性に変更。累積を専用変数 `acc` で持ち回し、
区間の両端が有効なときだけ加算。欠損点は `out[i]=NaN`（描画から外す）にして `acc` は据え置き、
有効値が戻れば続きから積分を再開する。正常データでは挙動は完全に従来と同一（回帰なし）。
`node --check app.js` OK。

**残課題（任意）**: 入れ替えで2ファイル間のアライメント（offset）は引き継がれない
（`setMainFile` は role のみ変更）。線消滅は上記で解消するが、入れ替え後に位置合わせが
ずれる点は別途 offset の相対値を引き継ぐ改修で改善余地あり。今回は最小・低リスク優先で見送り。

---

## ✅ 追加対応（2026-06-21・ユーザー要望）

ユーザー要望「①オフセットを計算に反映、②入れ替えでオフセット量を引き継ぐ」に対応。

**前提（コード読解で判明）**: オフセット入力欄は**サブのみ**（メインは常に基準=offset 0）。
`getCrossRef` は計算時にサブの offset を使うが、オフセット変更ハンドラ（`app.js:2412`付近）と
Auto-align（`app.js:4144`付近）が `renderChart()` のみで `recomputeCustomRAMs()` を
呼んでいなかったため、後からオフセットを変えてもクロスファイルRAMの計算が古いままだった。

**実装**:
1. ヘルパー追加（`hasCrossFileCustomRAMs` / `applyOffsetChange`、`app.js:2627`付近）。
   `applyOffsetChange` はクロスファイルRAMがある時だけ `recomputeCustomRAMs()` し再描画。
2. **オフセット変更3経路を配線** — 手動入力(`app.js:2438`)、Auto-align(`app.js:4168`)、
   シフトモードのドラッグ確定(mouseup, `app.js:999`)。ドラッグ中は毎フレーム再計算せず、
   指を離した時だけ1回再計算する（描画負荷を増やさない）。
3. **入れ替えでオフセット引き継ぎ** — `setMainFile`(`app.js:2207`付近)で新メインの offset を
   基準(0)に取り直し、全ファイルの offset から差し引く（相対ズレを保持）。
   例: サブB offset=5 で B をメインにすると B:5→0, 旧メインA:0→-5。

**計算量**: 再計算はオフセットを変えた離散イベント時のみ（毎フレームではない）。
rebase は O(ファイル数)。**描画・実行時コストの増加なし。**

**数値検証**（`tests/_swap_repro.js`）:
- 要望1: offset 0/2/5/10s で積分最終値が -95.581/-95.534/-95.474/-88.994 と変化（計算へ反映）。
- 要望2: 入れ替え前 A-B積分=-95.474 と 入れ替え後(rebase) B-A積分=+95.474、和=0.000
  （完全な符号反転＝鏡像）でアライメント維持を確認。rebase無しだと和=0.106 で崩れる。

`node --check app.js` OK。ブラウザ動作確認は環境制約のため手動推奨（下記手順）。

---

## 直前のセッションで直したこと（背景・この新バグと密接に関連）

「カスタムラムを作った後、別チャンネルを表示すると線が消える」バグを修正済み（ユーザー確認済みで解消）。
入れた修正は `csv_viewer/app.js` の3点:

1. **Fix A-1**: `detectBitChannels`（`app.js:835` 付近）に `if (col.isCustom) continue;` を追加。
   Custom RAMをBit自動判定の対象外にした。
   （クロスファイル式のサブ側コピーが全ゼロに縮退 → Bit誤判定 → 名前基準でメイン側もBit軸
   `[-0.2,1.2]` に強制固定＋`clip:true` で実値がクリップされ線が消えていた）
2. **Fix A-2**: `addCustomRAM`・`recomputeCustomRAMs` で `state.bitChannels.delete(name)` を追加（自己修復）。
3. **Fix B**: `addCustomRAMsToFile`（`app.js:2868` 付近）でクロスファイル参照(cross-ref)も
   サブファイルにロードするよう修正（他経路との非対称を解消）。

`node --check csv_viewer/app.js` で構文OK確認済み。

---

## 新バグの最有力な調査開始点

**`setMainFile(newMainId)` — `csv_viewer/app.js:2178`**（入れ替えの本体）。

この関数で確認すべきこと（未確認・新セッションで読むこと）:
- 入れ替え後に **`recomputeCustomRAMs()` を呼んでいるか**。呼んでいなければ Custom RAM が
  古い main 基準のまま残り、cross-ref が壊れる。
- 入れ替え後に **cross-ref のサブカラムを再ロードしているか**
  （`recomputeCustomRAMs` は cross-ref をロードするので、これを呼べば解決する可能性大）。
- **`offset`（ファイル時間オフセット）の扱い**。下記 getCrossRef がオフセットで範囲外判定するため、
  入れ替えでオフセット基準が変わると全要素 NaN になり線が消える。

## 仮説（優先度順）

1. **`s1:` は「追加順の位置参照」**であって特定ファイル参照ではない（`app.js:2605` getCrossRef:
   `idx = parseInt(fileKey.replace('s',''))-1` → `getSubFileIds()[idx]`）。
   入れ替えで sub の顔ぶれ・順序が変わると `s1` の指す先が変わり、計算前提が崩れる。
2. 入れ替え後に **cross-ref カラム未ロード**で `computeCustomExpr` が NaN 化（Fix B と同種の問題が
   setMainFile 経路にも残っている可能性）。
3. **offset の範囲外**（getCrossRef `app.js:2623-2631`: `tSub = td[i]-offset` が
   `subTd[0]..subTd[末尾]` 外なら NaN）。入れ替えで offset 基準が反転/ずれると全NaN。
4. 入れ替えで colId（main は `cr.id`、sub は `${cr.id}_${fid}`）が付け替わり、
   選択状態/チャートグループとの紐付けがずれる（ただし紐付けは「名前」基準なので可能性は低め）。

まず仮説2を疑い、`setMainFile` が `recomputeCustomRAMs()`（cross-ref ロード込み）を
呼んでいるか確認するのが最短。呼んでいなければ呼ぶ／同等のロードを足すのが第一候補。

---

## 関連コード位置（csv_viewer/app.js）

| 場所 | 行(目安) | 役割 |
|---|---|---|
| `setMainFile` | 2178 | メイン/サブ入れ替えの本体（**最重要**） |
| `computeCustomExpr` / `getCrossRef` | 2591 / 2605 | Custom式評価。cross-ref はオフセット補間。範囲外で NaN |
| `addCustomRAM` | 2638 | Custom作成。全ファイルに同名カラム追加 |
| `recomputeCustomRAMs` | 2803 | 全Custom再計算（通常参照＋cross-ref をロード） |
| `addCustomRAMsToFile` | 2868 | ファイル追加時にCustom追加（Fix B でcross-refロード追加済み） |
| `detectBitChannels` | 835 | Bit自動判定（Fix A-1 で Custom 除外済み） |
| `getActiveGroups` 内のガード | 4296付近 | `col.isCustom && col.isCrossFile` のサブ側描画スキップ（二重線対策） |
| Bit軸強制 | 4536-4537 | `assignedNames.every(... bitChannels.has)` で y軸 [-0.2,1.2] |

---

## 環境の重要な制約（新セッションも必読）

1. **ツール呼び出し漏れバグ（最重要）**: ツール呼び出しが時々「実行されず」
   `court` ＋ `<invoke ...>` という生テキストとして漏れる（「malformed and could not be parsed」）。
   約50%の頻度で、retry するとだいたい通る。**アプリ再起動で解消することがある**ので、
   新セッション開始前にユーザーへ Claude Code アプリの再起動を勧めると良い。
2. **文字コード**: 一部ファイルは UTF-8(BOMなし)。PowerShell コンソールで文字化け表示することがある（表示のみ）。
   読み取り/検索は `Get-Content -Encoding UTF8` / `Select-String` が比較的安定。
   `settings.json` は触らない（過去に0バイト破損を起こした）。
3. **preview MCP / ブラウザeval が応答停止**することがある。動作確認は手動推奨。
4. **Codex CLI（mcp__codex-cli__codex）は子プロセス終了で失敗**した実績あり（ping は通る）。

---

## 動作確認手順（修正後）

1. 一つ上の階層 `...\antigravity>` で `python -m http.server 8765 --directory csv_viewer`
   （`csv_viewer` の中にいるなら `--directory` は付けない）。`http://localhost:8765/` を開く。
2. `NEDC_sample_A.trn`（メイン）→ `NEDC_sample_B.trn`（サブ）を読み込む。
3. Custom RAM `integral(Fuel_Rate - s1:Fuel_Rate)` を作成 → 線が出る。
4. **メインとサブを入れ替える**（左メニューのファイル役割切替＝`setMainFile`）。
5. → Custom RAM の線が **消えないこと** を確認（本バグの解消条件）。
6. コンソールエラーが無いこと。投入した検証データ/設定は最後に消去。

---

## 保留中の別タスク（混同しないこと）

WLTC(Extra-Highなし) と MDC のサイクル判別修正は別件で**保留中**
（MDCとWLTC無EHが共に1477秒で長さ判別が衝突する論点が未決。ユーザーが「中止」と判断）。
本バグとは独立。新セッションでは依頼が無い限り触らない。
