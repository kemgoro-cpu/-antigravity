# 時系列・探索・大規模データUIの比較調査

調査日: 2026-10-30。担当範囲: 12製品、30の改善候補。公式ドキュメントを現在参照して整理した資料調査であり、競合製品のインストール、実機試用、性能測定、料金比較は実施していない。以下の「反映案」「効果」「難度」は当ビューアに対する提案・見積もりであり、競合の機能保証や実装済み事項ではない。外部サービスへ計測ログを送っていない。

## 現状の読み取りと重複の除外

現行の `README.md`、`FEATURE_BACKLOG.md`、`docs/MANUAL_IMPROVEMENTS.md`、関連ソースを確認した。次の機能は既存なので、新規機能として数えない。

- 複数CSV/TRN、時間合わせのプレビュー、単位不一致の除外、差分カーブ、許容差超過の帯と前後移動。
- 表示区間・選択区間の統計、2点カーソル、カーソル位置の比較値表、しきい値イベント、XY表示。
- チャンネル検索と別名、お気に入りセット、配置テンプレート、Undo/Redo。
- メモと画像、保存時の比較条件、区間リンク、HTMLレポート、CSV出力。
- オフライン動作、LTTBによる描画軽量化、IndexedDBの自動復元。

したがって「データ表」はカーソル位置の値表を追加する意味ではなく、**複数の元サンプル行を閲覧し、元時刻・補間値・欠損を追える表**を意味する。「状態表示」は既存Bit表示を、**多値の状態名と色を持つ帯**へ拡張する意味である。機能の不存在を網羅的に証明した監査ではないため、着手前に親調査のコード確認と突き合わせる。

## 12製品で確認できた参考機能

| 製品 | 公式資料で確認した機能 | 当ビューアへの反映案 | 適合性・注意 |
|---|---|---|---|
| Grafana | 状態を時系列の帯として表示し、値の名前・色を対応付け。nullによる空白も扱う。変換処理の順序、個別無効化、入出力確認。注釈のタグ絞り込み。[状態](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/state-timeline/) / [変換](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/transform-data/) / [注釈](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/annotations/) | ギヤや運転モードの帯、計算処理のプレビュー、メモのタグ・一覧 | 高。常時サーバーやクラウド監視を導入する必要はない。欠損を前後とつないで正常扱いしない |
| Chronograf | ダッシュボードの変数を選ぶだけで複数グラフの問い合わせ・タイトルを変更。時間範囲などをURL条件で保持。[変数](https://docs.influxdata.com/chronograf/v1/guides/dashboard-template-variables/) | テンプレートの「試験番号・チャンネル接頭辞・規定値」をパラメーター化 | 中。既存テンプレートと統合。SQL/Fluxを利用者に要求しない |
| Kibana Discover | 元レコード検索、フィルター、フィールド統計、横並び比較、検索条件の保存。分布・頻出値・値の種類を確認。[Discover](https://www.elastic.co/docs/explore-analyze/discover) / [フィールド統計](https://www.elastic.co/docs/explore-analyze/discover/show-field-statistics) | 元データ表、チャンネルのデータ品質カード、保存可能な条件検索 | 高。収集サーバーを模倣するより、手元CSVの診断と探索に限定 |
| Apache Superset | ダッシュボードの相互フィルター、適用フィルターの可視化。対象に適用できない条件を明示する仕組みも記載。[ダッシュボード](https://superset.apache.org/docs/using-superset/creating-your-first-dashboard/) | 条件チップを常時表示し、選択条件がどのグラフ・集計に適用されるかを明確化 | 高。semantic view関連は実験的機能の記載がある。特定実装の完全模倣でなく操作思想を参考にする |
| Metabase | グラフ・セルからフィルター、元レコード表示、ドリルスルー。元の質問を上書きせず新しい探索を作る。[操作](https://www.metabase.com/docs/latest/dashboards/interactive) / [ドリルスルー](https://www.metabase.com/docs/latest/questions/visualizations/drill-through) | 超過集計→該当区間→元サンプルへ掘り下げ、元の比較範囲へ戻る | 高。現状にも超過ジャンプはあるので、追加分は複数区間一覧と元行確認 |
| Perfetto | ブラウザ上の多トラック時間軸、重要トラックの固定、コマンドパレット、隣接イベント移動、起動コマンド・マクロ。大容量ではローカルネイティブ処理の分離も可能。[UI](https://perfetto.dev/docs/visualization/perfetto-ui) / [マクロ](https://perfetto.dev/docs/visualization/ui-automation) / [大容量](https://perfetto.dev/docs/visualization/large-traces) | 基準車速の固定、機能検索、定型解析レシピ。大容量処理の段階的分離 | 高。まずブラウザのみで改善。別プロセスは配布・起動の簡便さとトレードオフ |
| Foxglove | 多値・列挙値のState Transitions、他のプロットとのズーム同期、クリック時刻移動、再生操作、全パネルで使う変数、問題一覧。[状態](https://docs.foxglove.dev/docs/visualization/panels/state-transitions) / [再生](https://docs.foxglove.dev/docs/visualization/playback) / [変数](https://docs.foxglove.dev/docs/visualization/variables) / [画面](https://docs.foxglove.dev/docs/visualization) | 多状態帯、繰り返し再生、共通パラメーター、読み込み・計算の問題一覧 | 高。ロボット向けデータ形式や有料機能の導入を前提にしない |
| Rerun | 複数ビューを共通タイムラインで制御。再生・停止・コマ送り・区間ループ、記録にある時間の不連続を表示。[概要](https://rerun.io/docs/reference/viewer/overview) / [時間軸](https://rerun.io/docs/reference/viewer/timeline) | 時系列・XY・状態表を同じ選択時刻で連動。欠測区間を明示した再生 | 中。再生は解析条件や元時間を変えない表示操作とする。自動的な空白時間省略は誤解を招くため既定にはしない |
| Perspective | ブラウザ内WebAssemblyで集計・フィルター・ピボット。大規模表示では可視範囲のセルのみ描画、列形式データ、Worker側の処理。[概要](https://perspective-dev.github.io/) / [View](https://perspective-dev.github.io/guide/explanation/view.html) / [大規模データ](https://perspective-dev.github.io/guide/use_cases/large_datasets.html) | 仮想スクロールの元データ表、状態別集計、データ処理とUIの分離 | 中〜高。ライブラリ全面置換は不要。file://でのWorker/WASM対応と配布容量を先に試作評価する |
| Datasette | カテゴリーごとの件数を並べて絞り込むfacet。絞り込み候補を軽量に提案する仕組み。[facets](https://docs.datasette.io/en/stable/facets.html) | ギヤ・走行状態・ファイル種別などを件数付きで絞り込み。「ギヤ3のみ」の区間を探索 | 高。単なる行数を滞在時間として表示しない。時間集計には実タイムスタンプが必要 |
| ParaView | チャート・散布図・表の選択が他ビューに連動。条件によるFind Dataと、選択集合の抽出・時間変化表示。[選択](https://docs.paraview.org/en/latest/UsersGuide/selectingData.html) | XYの外れ点選択→元の時系列位置をハイライト→前後波形を表示 | 高。3D機能は不要。現状のXYに選択連動を追加する |
| VisiData | 値別の頻度表、ヒストグラム、グループ統計、元行への掘り下げ、null/errorを別群で表示。操作ログを保存・再実行。[頻度表](https://www.visidata.org/docs/freq/) / [保存形式](https://www.visidata.org/docs/internal_formats/) | 頻度と欠損の概要、状態別集計、定型作業のレシピ | 中。ターミナル操作を移植せず、表と連動する考え方を採用 |

Perspective旧サイト `perspective.finos.org` は本調査では取得失敗したため、検索で見つかった現行プロジェクトサイトを開いて確認した。製品名や旧所属から、現時点の運営主体・サポート条件を断定しない。

## 優先順位付き改善候補30件

P1=日常のログ確認に直接効く、P2=特定の分析を速める、P3=要望・大容量実測後。難度は小/中/大の相対評価であり、工数や納期の約束ではない。同順位帯では、既存機能を拡張できるものを先にした。

| 順位 | 候補と具体的な操作 | 既存との差分 | 優先度 / 難度 | 参考元・注意 |
|---:|---|---|---|---|
| 1 | **波形と連動する元データ表**。クリック時刻の前後数十行を開き、行を選ぶと波形も強調 | カーソル1時点の比較値表から、複数の元行を見られるようにする | P1 / 中 | [ParaView](https://docs.paraview.org/en/latest/UsersGuide/selectingData.html)、[Kibana](https://www.elastic.co/docs/explore-analyze/discover)。表示時刻・元時刻・生値/補間値を分離 |
| 2 | **読み込み後のデータ診断カード**。欠損率・重複時刻・時刻逆転・サンプル間隔のばらつきを表示し該当場所へ移動 | parseエラー通知・比較時の欠損数を、全体の診断へ拡張 | P1 / 中 | [Kibana統計](https://www.elastic.co/docs/explore-analyze/discover/show-field-statistics)から発展。時刻診断の具体項目は当方提案 |
| 3 | **多状態タイムライン**。0/1以外のギヤ、モード、状態コードを名前と色の帯にする | Bitの上下表示から、3値以上と状態名に対応 | P1 / 中 | [Foxglove](https://docs.foxglove.dev/docs/visualization/panels/state-transitions)、[Grafana](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/state-timeline/)。値→状態名辞書を保存 |
| 4 | **複数条件による区間検索**。「車速>80 かつ 水温>90」の区間一覧から前後へ移動 | 単一のしきい値イベントを、条件グループと保存検索へ拡張 | P1 / 中 | [Metabase](https://www.metabase.com/docs/latest/questions/visualizations/drill-through)、[Datasette](https://docs.datasette.io/en/stable/facets.html)。条件式の単位を表示 |
| 5 | **重要チャンネルの固定表示**。車速や基準信号だけ上段に固定し他の段をスクロール | 表示順変更・お気に入りに、スクロール固定を追加 | P1 / 小〜中 | [Perfetto](https://perfetto.dev/docs/visualization/perfetto-ui)。固定と並べ替えの状態を分離 |
| 6 | **コマンドパレット**。「画像」「欠損」「比較」などの語から機能を探して実行 | Ctrl+Kは既にチャンネル検索。機能検索は別入口・別ショートカットにする | P1 / 小〜中 | [Perfetto](https://perfetto.dev/docs/visualization/perfetto-ui)、[Rerun](https://rerun.io/docs/reference/viewer/overview)。既存キー割当を奪わない |
| 7 | **現在の解析条件を一行で表示**。対象区間、比較ファイル、時間差、フィルターをチップ表示 | 条件が複数タブに散らばる状態から、全体に見える要約へ | P1 / 小〜中 | [Superset](https://superset.apache.org/docs/using-superset/creating-your-first-dashboard/)。表示範囲と評価範囲の違いを明示 |
| 8 | **XYの点選択と時系列を連動**。外れ点を囲って、発生時刻へジャンプ | XY表示は既存。追加分は相互選択と行の追跡 | P1 / 中 | [ParaView](https://docs.paraview.org/en/latest/UsersGuide/selectingData.html)。間引き点だけに選択を限定しない |
| 9 | **状態ごとの滞在時間・切替回数**。「ギヤ3で42秒」などを帯と表で往復 | Bit不一致時間とは別に、単一ログの状態集計を追加 | P1 / 中 | [Grafana状態帯](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/state-timeline/)と[VisiData群別集計](https://www.visidata.org/docs/freq/)から発展。時間重みの方法は独自仕様として定義 |
| 10 | **メモのタグと検索**。「異常」「要確認」「解決済み」等の絞り込みと未確認件数 | 画像・区間リンク付きメモは既存。分類と検索を追加 | P1 / 小 | [Grafana注釈](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/annotations/)。タグはユーザー定義。判断を自動確定しない |
| 11 | **チャンネルの分布プレビュー**。一覧から小ヒストグラム・欠損率・頻出値を確認 | 既存min/max/平均統計に分布形状を加える | P2 / 中 | [Kibanaフィールド統計](https://www.elastic.co/docs/explore-analyze/discover/show-field-statistics)。全件集計/サンプル推定を表示 |
| 12 | **ヒストグラムから該当時間帯を選択**。「高温側の棒」を選ぶと元波形を強調 | グラフ種類の追加と元行への掘り下げをセットにする | P2 / 中 | [VisiData](https://www.visidata.org/docs/freq/)、[ParaView](https://docs.paraview.org/en/latest/UsersGuide/selectingData.html)。離れた区間を一続きに扱わない |
| 13 | **問題一覧パネル**。読み込み、式評価、対応漏れ、保存失敗を後から確認・解決 | 一時トーストや比較欄の理由表示を一覧に集約 | P1 / 小〜中 | [Foxglove Problems](https://docs.foxglove.dev/docs/visualization)。同じ問題の重複と古い解決済みを整理 |
| 14 | **計算の入力・出力プレビュー**。式を変えた前後を表と小波形で確認して適用 | Custom RAMの式入力に、途中段階の検査を加える | P2 / 中 | [Grafana変換](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/transform-data/)。既存の安全な式パーサを維持 |
| 15 | **計算処理の一時無効化**。平滑化や単位換算の有無を切り替え、依存関係も表示 | 式の削除・再入力を減らす | P2 / 中 | [Grafana変換](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/transform-data/)。下流計算・比較の古い結果を無効化 |
| 16 | **テンプレートの共通パラメーター**。試験番号、信号接頭辞、規定値を一箇所で指定 | 静的な配置・式・対応テンプレートをパラメーター化 | P2 / 中 | [Chronograf](https://docs.influxdata.com/chronograf/v1/guides/dashboard-template-variables/)、[Foxglove変数](https://docs.foxglove.dev/docs/visualization/variables)。自動の信号置換は適用前に確認表示 |
| 17 | **目的別の複数ワークスペース**。「全体」「温度」「駆動系」をタブで切替 | プリセット適用とは別に、複数の配置・選択区間を同時保持 | P2 / 中〜大 | [Perfettoマクロ](https://perfetto.dev/docs/visualization/ui-automation)、[Foxgloveレイアウト](https://docs.foxglove.dev/docs/notebook/layouts)。データ配列は複製せず共有 |
| 18 | **区間ループ再生・コマ送り**。異常前後の変化を低速で反復 | 静的カーソルから、時刻を動かす閲覧へ | P2 / 中 | [Rerun](https://rerun.io/docs/reference/viewer/timeline)、[Foxglove](https://docs.foxglove.dev/docs/visualization/playback)。再生倍率と実時間を混同させない |
| 19 | **再生時の追従窓**。現在時刻の前後5秒などを見続ける | 既存ズームに、幅固定の時刻追従を追加 | P2 / 中 | [Foxglove状態パネル](https://docs.foxglove.dev/docs/visualization/panels/state-transitions)。手動操作時は追従解除を明示 |
| 20 | **元データ表の仮想スクロール**。大きいCSVでも可視行だけを描画 | 順位1の実装基盤。全行DOMの追加を避ける | P1の依存 / 中 | [Perspective](https://perspective-dev.github.io/guide/use_cases/large_datasets.html)。性能改善量は要実測 |
| 21 | **値の種類を件数付きで絞り込み**。「ギヤ=3」「モード=冷機」などを候補から選ぶ | チャンネル名の検索とは異なる、データ値に対する検索 | P2 / 中 | [Datasette](https://docs.datasette.io/en/stable/facets.html)。連続値を無制限に候補化しない |
| 22 | **状態別の統計・比較表**。ギヤや運転モードごとに温度、誤差、最大値を集計 | 時間区間だけの統計から、条件群別の比較へ | P2 / 中 | [Perspective View](https://perspective-dev.github.io/guide/explanation/view.html)、[VisiData](https://www.visidata.org/docs/freq/)。有効点と欠損を併記 |
| 23 | **定型解析レシピ**。同じチャンネル選択→条件検索→統計→レポートを再実行 | 保存テンプレートは状態再現。こちらは操作手順の再実行 | P2 / 大 | [Perfetto](https://perfetto.dev/docs/visualization/ui-automation)、[VisiData保存形式](https://www.visidata.org/docs/internal_formats/)。任意JSの実行機能にはしない |
| 24 | **しきい値条件・処理レシピの実行前検査**。不足チャンネル、単位不一致、空の対象を一括表示 | テンプレート適用後の不足通知から、実行前一覧へ | P2 / 中 | [Superset](https://superset.apache.org/docs/using-superset/creating-your-first-dashboard/)の非適合条件表示から発展。部分適用を成功扱いしない |
| 25 | **イベント密度の全体俯瞰**。全体ナビゲーター上に区間ごとのイベント数や欠損を重ねる | ナビゲーター自体は既存。どこを詳しく見るべきかを追加 | P2 / 中 | [Rerunタイムライン](https://rerun.io/docs/reference/viewer/timeline)のイベント俯瞰から発展。集約値と実イベントを切り分ける |
| 26 | **時間の不連続を可視化**。長いサンプル空白に切れ目マークと実際の空白長を表示 | NaNをまたがない描画とは別に、時刻間隔の空白も説明 | P1 / 中 | [Rerun](https://rerun.io/docs/reference/viewer/timeline)。時間軸は既定で圧縮しない |
| 27 | **描画用データと数値計算用データの状態表示**。現在の描画点数と元点数、集計方式を示す | 計算が元データ基準である仕様をUIでも見えるようにする | P2 / 小 | [Chronograf](https://docs.influxdata.com/chronograf/v1/guides/dashboard-template-variables/)の表示幅に応じた集約を参考。機能は独自提案 |
| 28 | **処理時間・メモリ・保存状況の診断**。大容量時に何で待っているか、保存対象かを可視化 | 読み込み進捗から、読み込み後と自動保存の状態へ拡張 | P1 / 小〜中 | [Foxglove画面](https://docs.foxglove.dev/docs/visualization)、[Perfetto大容量](https://perfetto.dev/docs/visualization/large-traces)。自動保存状態は現行改善メモでも高優先 |
| 29 | **解析済み列のキャッシュ**。同じログを再度開く際の文字列パースを削減 | ファイルBlobの保存だけでなく、解析結果を再利用する案 | P3 / 大 | [Perfetto大容量](https://perfetto.dev/docs/visualization/large-traces)。ファイル内容と解析設定、アプリ版で整合性を確認。効果は未測定 |
| 30 | **大容量処理の段階的Worker/列指向化**。必要なチャンネルや区間だけをUIへ渡す | LTTB描画高速化とは別に、解析・データ受渡しの負荷を減らす | P3 / 大 | [Perspective](https://perspective-dev.github.io/guide/use_cases/large_datasets.html)。全面置換せず実測でボトルネックから着手 |

## 最初の実装候補として特に推す5件

1. **元データ表との連動**: 波形の違和感を、CSVを別アプリで開き直さずに確かめられる。最小版は「カーソル周辺の元サンプル20〜100行」と「元時刻/表示時刻」だけでも有効。
2. **データ診断と問題一覧**: 誤読・欠損・保存失敗が解析後まで残って見える。既存の一時通知を活用でき、結果への信頼に直結する。
3. **多状態帯と状態別時間**: 自動車計測ではギヤ・燃料カット・運転モードを連続値とは違う形で把握できる。時間重みと欠損の扱いは先に仕様化する。
4. **条件検索→区間一覧→波形/元行へ**: 「どこに異常があるか」を目視の総当たりから変えられる。最小版はAND条件と区間一覧、前後移動。
5. **固定トラックとコマンドパレット**: 日々の操作を短くできる。数値処理を変えずに改善しやすい。

## 後回しにするもの

- クラウド監視、ユーザー管理、通知配信、データ収集サーバー: 今の強みであるオフライン・配布容易性から外れる。複数人運用の具体要件が出てから。
- 3D、映像・地図同期: Foxglove/Rerun/ParaViewの強みだが、対応するデータ源がない現時点では優先しない。
- ライブラリ全面置換やネイティブ補助プロセス: 上限サイズ・待ち時間の実測なしに導入すると保守負担だけが増える。
- 自然言語AIが自動で解析条件を確定する機能: 説明や候補作成は考えられるが、単位・区間・欠損を検証できる基本UIを先にする。

## 受入確認で守ること

- 元のTimeと信号値を変更せず、表示変換・補間・集計を明確に区別する。
- 生データ表・区間抽出・統計は描画間引きではなく元サンプルから計算する。
- 既存の差分は「基準−比較」、Bit遷移の時間差は「比較−基準」という定義を変えない。
- 不規則時刻の滞在時間・積分は実際の時刻差で計算し、欠損と正常状態を分ける。
- 新しい状態は保存、復元、Undo/Redo、比較条件変更時の結果無効化まで含める。
- file://、オフライン、UTF-8/Shift_JIS、半角カタカナのパスを維持する。

## 調査の限界

12製品の公式資料から操作と設計の参考点を抽出した。性能優劣や料金優劣のランキングではない。自動車ログとの適合性と実装難度は現行構成からの推定。Perspectiveの大規模性能、各製品の新しい機能やエディション条件、ブラウザメモリ上限の数値は今回当ビューアで検証しておらず、達成可能な保証値として用いない。
