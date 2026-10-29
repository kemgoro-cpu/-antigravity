# CSV・科学グラフ・BI系の比較調査

調査日: 2026-10-30。対象は13製品。公式Web文書・公式リポジトリで機能を確認した調査であり、各製品をインストールして速度や使いやすさを実測した比較ではない。価格、契約条件、最新版の優劣は評価対象外。以下の「移植案」「優先」「難度」は本ビューアへの適合性からの提案・推定であり、実装済み機能ではない。

## 現行ビューアとの比較の前提

2026-10-30の `README.md`、`FEATURE_BACKLOG.md`、`IMPROVEMENT_BACKLOG.md`、`docs/MANUAL_IMPROVEMENTS.md` と関連ソースを参照した。

- テーマ切替、2点カーソル、しきい値イベント、自動復元、区間統計、CSV出力、XY、差分、HTMLレポート、お気に入りセットは既存。`FEATURE_BACKLOG.md` の本文には実装前の説明が残るが、冒頭の実施状況は全10件完了。これらを新機能として数えていない。
- 計算式、積分、微分、移動平均、遅延も既存（`app.js:537`、`app.js:910` 付近）。計算機能そのものより、条件・入力・依存関係を分かりやすくする余地がある。
- 複数ログ対応、対応付け、時間合わせプレビュー、比較数値、許容差超過への移動、条件付きメモ、比較テンプレートも既存。大量試験の集計、複数の解析画面の連動、CSVの汎用取り込みなどが差分となる。
- 単位行なしCSVは `parser-utils.js:106` の自動検出で名前行の直後を単位行にする。画面も `index.html:45` に単位行の「なし」がない。これは資料にも記載された具体的な改善優先箇所。
- CSV出力は `app.js:7315` の `exportVisibleCSV()` で基準ファイルと表示時間範囲を使用。XYは別モーダルで、点には `[x,y]` だけを格納する（`app.js:8068`）。時刻・元行番号を保持したXY→波形の選択連動は新規の設計が必要。
- 以下の案は、ビルド不要・ローカルファイル起動・オフライン処理を維持する方針で評価する。SaaSとの接続や実ログのアップロードを推奨するものではない。

## 製品別に確認した点と取り入れ方

| 製品 | 公式情報で確認した参考機能 | 本ビューアへ取り入れる具体案 | 適合性・注意 |
|---|---|---|---|
| **Excel / Power Query** | CSVの区切り・文字コード・型判定をプレビューで指定。列品質・分布・プロファイル表示。[CSVコネクタ](https://learn.microsoft.com/en-us/power-query/connectors/text-csv)、[列品質](https://learn.microsoft.com/en-us/power-query/data-profiling-tools)、[Excelからの取り込み](https://support.microsoft.com/en-us/excel/import-data-from-data-sources-power-query) | 「名前行・単位行なし・時間列・先頭数行」を読み込み確定前に確認。読込後は欠損数・無効値・時間逆転を一か所に表示 | **最優先**。既存のParse Previewの拡張。サンプル検査と全件検査を区別する。Power Queryのプロファイル自体も既定では先頭1,000行なので、全件確認済みと誤認させない設計が参考になる |
| **Origin / OriginPro** | インポート条件保存、メタデータ抽出、解析テンプレート、複数データへの一括処理と結果表、パラメータ変更後の再計算。[繰り返し作業](https://www.originlab.com/index.aspx?go=Products/Origin/HandlingRepetitiveTasks) | 既存比較テンプレートに「複数試験へ適用→評価結果一覧→失敗した試験だけ波形確認」を追加。計測条件を結果表の列にする | **高**。本ビューアの強い比較機能を大量ログへ広げる。新しいログの時間差を再計算する既存ルールを維持する |
| **Tableau** | あるビューの選択から他のビューを絞り込む／強調するアクション。[ビュー間フィルタ](https://help.tableau.com/current/pro/desktop/en-us/actions_dashboards.htm)、[強調表示](https://help.tableau.com/current/pro/desktop/en-us/actions_highlight.htm) | XYで気になる点群を選ぶと、時系列の該当時刻と生データ表を同時強調。ヒストグラムの高負荷域選択から、その発生区間へ進む | **高**。今のXYは別モーダルなので、まず点→時刻ジャンプから段階導入する。時間区間と値による選択を混同しない |
| **Power BI** | ブックマークにフィルタ・表示・対象ビジュアルを個別指定でき、順番に提示できる。[ブックマーク](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-bookmarks) | 「配置だけ戻す」「比較条件も戻す」を選べる保存・適用画面。メモを並べ替えて会議用の順番に再生する | **高**。メモの状態復元は既存なので、保存機能の追加ではなく復元範囲の可視化と選択が差分。古い数値を再計算済みと扱わない |
| **LabPlot** | 読み込みフィルタ、プロジェクト内のフォルダ、表ヘッダーの小型グラフ、ヒストグラム／箱ひげ、色覚に配慮した配色、SVG等の出力。[公式機能一覧](https://labplot.org/pages/features/) | 計測器別の読込プロファイル、チャンネル一覧の小型波形、区間分布比較、印刷・資料向けの線種と色のプリセット | **高〜中**。大量チャンネルの小型波形を全列一度に読むと遅延読み込みの利点を失う。表示候補や検索結果に限定する |
| **Veusz** | XYの色・サイズ・誤差棒、関数で関連付ける軸、重ねた図や複数図、PDF/SVG/EMF出力。[機能一覧](https://veusz.github.io/features/)、[マニュアル](https://veusz.github.io/docs/manual/) | XYの色を温度・時間・運転状態に割り当てる。換算関係を明示した第二軸。資料に貼って拡大できるSVG出力 | **中**。色による第3変数は車両ログと相性がよい。第二軸は見かけの相関を作らないよう既知の換算関係のみに制限する案 |
| **RAWGraphs** | 表データ・コピー貼り付け入力、ブラウザ内の処理、編集可能なSVG、独自図形への拡張。[公式リポジトリの説明](https://github.com/rawgraphs/rawgraphs-app) | Excelで選んだ数列を貼り付けて一時比較。出力をSVGにして後段の資料編集につなぐ | **中**。本ビューアも既にローカル処理なので、それ自体は新規差分ではない。貼り付け時も名前／単位／先頭行の確認を共通化する |
| **Datawrapper** | 注釈・強調、色の識別性チェック、キーボード操作、代替テキスト、PDF/SVG出力。[機能](https://www.datawrapper.de/features)、[アクセシビリティ](https://www.datawrapper.de/accessibility) | メモからグラフ上の矢印・ラベルを付ける。比較色と線種の識別チェック。レポートに対象区間・単位・条件を記した読み上げ可能な要約表 | **高〜中**。メモと画像出力は既存。新規部分は注釈のグラフ内配置・色だけに依存しない識別・出力品質の確認 |
| **DataGraph** | データ条件によるマスク、描画グループ単位のマスク、HideとExcludeを分けた軸範囲の扱い。[公式Getting Started Guide](https://www.visualdatatools.com/DataGraph/DRAFT-Getting-Started-Guide.pdf)、[公式Manual](https://www.visualdatatools.com/DataGraph/Manual.pdf) | 「エンジン暖機後かつ車速>0」のデータだけ統計・XYに用いる。非表示と解析対象外を別操作にして、軸範囲を固定したまま一系列を注目表示 | **高〜中**。しきい値イベントは既存だが、任意の条件を解析全体の共通マスクにする点が差分。公式PDFの検索索引で該当節を確認、全文の取得は失敗したため詳細UIは未確認 |
| **Orange Data Mining** | 散布図の選択データ出力、色・形・サイズの属性設定、選択点だけのラベル、回帰線、元データの行IDによる照合。[Scatter Plot](https://orangedatamining.com/widget-catalog/visualize/scatterplot/)、[Select by Data Index](https://orangedatamining.com/widget-catalog/transform/select-by-data-index/) | XYで選んだ外れ値の元時刻・元CSV行を一覧化し、波形へ戻る。選択した点だけラベルを出し、注目箇所を見失わない | **高**。描画用間引き後にも元行IDを保持する必要がある。Orangeのランダムなジッターは計測値の位置を動かすため採用候補にしない |
| **gnuplot** | 複数パネル配置、データに対する関数フィット、誤差を用いた重み付き処理。[multiplot](https://gnuplot.info/docs_6.1/loc14384.html)、[fit](https://www.gnuplot.info/docs/loc7134.html)、[分布・平滑化](https://gnuplot.info/docs/loc9103.html) | 上に時間波形、下にXYと分布を置く解析シート。XYへ回帰式と残差表示を追加。選択区間だけフィットする | **中**。単に見栄えをよくする曲線補間は解析結果と区別する。最小二乗で説明できない非線形・履歴依存の関係がある |
| **KNIME Analytics Platform** | 処理を再利用可能なコンポーネントにまとめ、入力を設定画面へ出し、実行状態を表示する。[公式ガイド](https://docs.knime.com/ap/latest/analytics_platform_components_guide/) | 「読込→時間合わせ→条件抽出→統計→レポート」のレシピを保存。各段階に未実行・完了・条件変更後を表示する | **中**。ノード編集環境の丸ごと導入は大きすぎる。既存の比較タブに状態と処理履歴を足す小さい導入が適切 |
| **SciDAVis** | データ表・図・メモのプロジェクト整理、FFT／フィルタ、線形・非線形フィット、SVG/PDF出力。[公式機能概要](https://scidavis.sourceforge.net/about/node3.html)、[公式リポジトリ](https://github.com/SciDAVis/scidavis) | 一つの試験に時系列・XY・解析結果・メモをまとめた解析シートを保存。振動用途が明確ならFFTを追加 | **中〜低**。参照した機能概要は2017年表記。最新のUIや対応環境の根拠には使用しない。公式に紐付くSourceForge/GitHubを採用し、同名の別サイトは根拠にしない |

## 統合用の改善候補 30件

優先度Aは日常的な誤判断防止または明確な手数削減、Bは分析範囲・説明力の拡張、Cは特定用途向け。難度は相対評価であり日数の見積もりではない。既存機能の拡張はその差分を記載した。

| ID | 候補と既存機能からの差分 | 参考 | 優先 / 難度 | 利用例・設計上の注意 |
|---|---|---|---|---|
| CB01 | 読込確定前のCSVウィザード。単位行「なし」を含める | [Power Query](https://learn.microsoft.com/en-us/power-query/connectors/text-csv) | A / 中 | `Time,Speed` の次に来る最初の数値行を失わない。元ログを編集せず取り込める |
| CB02 | 読み込み形式を計測器・ファイル種別別に保存 | [Origin](https://www.originlab.com/index.aspx?go=Products/Origin/HandlingRepetitiveTasks) | A / 小〜中 | ヘッダー行・区切り・時間列・文字コードを毎回入力しない。比較テンプレートとは別に適用範囲を示す |
| CB03 | チャンネル別のデータ品質ダッシュボード | [Power Query](https://learn.microsoft.com/en-us/power-query/data-profiling-tools) | A / 中 | 欠損、無効値、時間逆転、重複時刻、長い欠測区間を確認。先頭だけの検査なら「全件確認」表示にしない |
| CB04 | 波形と生データ表の連動表示 | [Tableau](https://help.tableau.com/current/pro/desktop/en-us/actions_dashboards.htm) | A / 中 | カーソル位置の元行・時刻・値を表で確認しコピー。表は仮想スクロールで全件DOM化を避ける |
| CB05 | XYの選択点から元の時系列へ戻る | [Orange](https://orangedatamining.com/widget-catalog/transform/select-by-data-index/) | A / 中〜大 | 燃料流量の外れ値を選び、その瞬間の車速・回転数を調べる。間引き点と元行IDを対応させる |
| CB06 | 複数試験の一括比較と結果マトリクス | [Origin](https://www.originlab.com/index.aspx?go=Products/Origin/HandlingRepetitiveTasks) | A / 大 | 試験×チャンネルの誤差・欠損・許容差超過を一覧化。時間合わせ不能は合格にせず要確認へ |
| CB07 | 保存・適用時に「表示だけ／解析条件込み」を選択 | [Power BI](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-bookmarks) | A / 中 | 配置を変えたいだけなのにメモや条件が変わることを防ぐ。現在のプリセット／比較テンプレート／メモの差を統合表示 |
| CB08 | 運転条件による共通データマスク | [DataGraph](https://www.visualdatatools.com/DataGraph/Manual.pdf) | A / 中〜大 | 暖機後・停止中・ギア段別などをXYと統計に共通適用。除外点を削除せず、除外数と条件を残す |
| CB09 | 「隠す」と「解析から除外」を区別する操作 | [DataGraph](https://www.visualdatatools.com/DataGraph/Manual.pdf) | A / 中 | 軸を固定して一時的に一系列だけ注目する。表示変更だけで評価母集団を変えない |
| CB10 | 全解析で対象範囲を共通選択 | [Tableauのビュー連動](https://help.tableau.com/current/pro/desktop/en-us/actions_dashboards.htm) | A / 中 | 選択区間・表示範囲・全期間を比較／XY／CSVで統一。現行マニュアルの既知課題へ直接対応 |
| CB11 | 処理状態を段階ごとに表示 | [KNIME](https://docs.knime.com/ap/latest/analytics_platform_components_guide/) | A / 中 | 単位・時間差・条件変更後に「計算結果は未更新」を表示。比較側の既存無効化を他解析へ展開 |
| CB12 | グラフ内に注目点の矢印・短い説明を配置 | [Datawrapper](https://www.datawrapper.de/features) | B / 中 | メモ本文だけでなく波形上で原因候補を示す。ズームや出力時に注記位置が時刻へ追従する |
| CB13 | SVG等のベクター出力 | [Veusz](https://veusz.github.io/features/) | B / 中 | PowerPointや報告書で拡大しても軸文字が読める。大規模波形はパス数・ファイル容量を確認 |
| CB14 | 資料向け出力プリセット | [Datawrapper](https://www.datawrapper.de/features) | B / 小〜中 | 横長スライド／A4、背景・文字・余白・凡例を出力時に設定。画面表示設定を変えず再利用 |
| CB15 | 色覚と白黒印刷を考慮した色＋線種 | [Datawrapper](https://www.datawrapper.de/accessibility) | B / 小〜中 | 多数の比較ファイルを色だけで識別しない。既存Main実線/Sub破線に加えてファイル間の識別を支える |
| CB16 | レポートの説明テキストと数値表 | [Datawrapper](https://www.datawrapper.de/accessibility) | B / 小〜中 | 画像を読めない環境でも対象ログ・区間・単位・数値を確認。数値の自動解釈は断定しない |
| CB17 | チャンネル一覧の小型波形・最小最大値 | [LabPlot](https://labplot.org/pages/features/) | B / 中 | 名称だけでは分からない信号を見分ける。検索結果や表示候補だけ計算して読込負担を抑える |
| CB18 | ヒストグラムと箱ひげの区間・ログ間比較 | [LabPlot](https://labplot.org/pages/features/) | B / 中 | 平均差は同じでもばらつきや高負荷域の出現頻度が異なる試験を見分ける |
| CB19 | 分布から該当する時刻を逆引き | [Tableau](https://help.tableau.com/current/pro/desktop/en-us/actions_dashboards.htm) | B / 中〜大 | 高回転側のビンを選んで発生区間を確認。CB05と共通の行ID基盤を使用 |
| CB20 | XYの色に時間・第3信号・運転状態を指定 | [Orange](https://orangedatamining.com/widget-catalog/visualize/scatterplot/) | B / 中 | 同じ車速でも温度別に燃料が違うことを確認。色の意味とカラーバーを必ず表示 |
| CB21 | XYの選択点だけラベル表示 | [Orange](https://orangedatamining.com/widget-catalog/visualize/scatterplot/) | B / 小〜中 | 特異点の時刻と値を表示し、全点ラベルによる混雑を避ける |
| CB22 | XYの回帰式・残差を併記 | [gnuplot](https://www.gnuplot.info/docs/loc7134.html) | B / 中 | センサー間の傾き・オフセットを調べる。単一の相関係数を因果関係の証明に使わない |
| CB23 | 注目区間のブックマークを並べて順番に提示 | [Power BI](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-bookmarks) | B / 小〜中 | メモ一覧を会議の説明順に並べ、前へ／次へでレビュー。既存のメモ状態復元を利用 |
| CB24 | 試験ごとのレポートを一括生成 | [Origin](https://www.originlab.com/index.aspx?go=Products/Origin/HandlingRepetitiveTasks) | B / 大 | 同じ書式で20試験を出力。実行時の条件と元ファイル識別をレポートへ残す |
| CB25 | ファイル名やヘッダーから計測条件を取り込む | [Origin](https://www.originlab.com/index.aspx?go=Products/Origin/HandlingRepetitiveTasks) | B / 中 | 試験日・機種・温度を結果マトリクスの列にする。抽出候補を確認して確定する |
| CB26 | Excel等から表を貼り付けて一時表示 | [RAWGraphs](https://github.com/rawgraphs/rawgraphs-app) | B / 小〜中 | 数列だけの簡単な確認でCSV保存を省く。名前・単位行のプレビューはCB01と共通化 |
| CB27 | 絶対日時を明示的に読む時間軸 | [Veusz](https://veusz.github.io/features/) | B / 中 | `2026-10-30 09:00:00` を計測経過秒と切替表示。タイムゾーンと日付形式を確認し、勝手に地域推定しない |
| CB28 | 時系列・XY・分布を配置した解析シート | [gnuplot](https://gnuplot.info/docs_6.1/loc14384.html) | B / 大 | 一つの試験に複数の見方を保存。縦の時系列段だけを増やす機能とは区別する |
| CB29 | 解析レシピの保存と依存関係表示 | [KNIME](https://docs.knime.com/ap/latest/analytics_platform_components_guide/) | B / 大 | 入力チャンネル変更でどの計算結果が無効になるかを示す。まず処理一覧で始め、ノードエディターは後回し |
| CB30 | FFT・周波数フィルタの追加 | [SciDAVis](https://scidavis.sourceforge.net/about/node3.html) | C / 大 | 振動・脈動を調べる用途がある場合のみ。等間隔サンプル、欠損、窓関数、周波数軸と振幅の定義を検証する |

## この担当範囲での推奨順

1. **CB01＋CB03＋CB02: 読み込みで信頼できる状態を作る。** 単位行なし対応を最初に実施し、その画面を読込設定・品質確認・プロファイルへ広げる。現在明示された制約へ直接対応する。
2. **CB10＋CB04＋CB05: 同じデータを波形・XY・表で往復できるようにする。** 共通の対象範囲と元行IDを先に設計し、点→時刻ジャンプを最小実装にする。
3. **CB07＋CB11: 設定変更と復元の意味を分かるようにする。** 強力な既存機能があるため、「何が変わるか」「今の結果が更新済みか」の改善効果が大きい。
4. **CB06＋CB25＋CB24: 比較を大量試験へ広げる。** 最初は一つの基準対複数ログを順次処理し、結果表から単一比較へ戻る方式にする。
5. **CB08＋CB18＋CB20: 運転条件別に比較できるようにする。** 統計の母集団とマスク条件を常時表示する。均等サンプル平均と時間重み付きの結果は明確に区別する。
6. **CB12〜CB16＋CB23: 説明・報告に使いやすくする。** 既存HTMLレポート・メモを土台にするので、独立した新しい保存方式を増やしすぎない。

## 今回は下位に置くもの

- 3Dグラフの大量追加: 本ビューアの時系列比較では、XY＋色＋条件絞り込みの方が読み取りやすいケースが多いという設計判断。3Dを必要とする具体的な用途が出てから検討。
- 自動で波形を平滑化／外れ値削除する機能: 既存の計算チャンネルで元データと処理結果を区別できる。元ログを変えず、除外理由を記録するマスクを優先。
- BI製品のクラウド共有やノード環境をそのまま複製: 本アプリのオフライン・手軽さから外れ、保守範囲が広がる。操作上の良い点だけを取り入れる。
- 根拠不明な「AIで異常判定」: まず欠損・単位・許容差・比較条件を確実に説明できる基盤が必要。今回の上位候補には含めない。

## 調査上の限界

- 市販製品の全機能を網羅したものではない。選んだ機能について公式文書を確認した。
- DataGraphは公式PDFの検索索引に出た該当節で確認し、全文取得に失敗した。SciDAVisの概要は2017年の資料で、現行版の実機挙動は未確認。
- 類似製品のベンチマーク、ライセンス・料金、社内利用条件の比較は実施していない。
- 大容量ログでの応答性、実装工数、ユーザーの使用頻度は未測定。順位はCSV/TRN比較作業を主用途とした相対評価で、実装計画時に調整する。
- 製品コード・実ログは変更していない。外部サービスへのログ投入も行っていない。

## 統合レポート作成時の追加照合

- Veuszの[読込マニュアル](https://veusz.github.io/docs/manual/datasets.html)で、外部ファイルへのリンクを保持して再読込する方式と、リンクを外して文書内へデータを保存する方式を確認。解析プロジェクトの持ち運び・元ログ再読込の参考となる。ただしログのハッシュやアプリ版を含む来歴記録は、これだけでは製品の既存機能と断定できない。
- Originの[Convert関数](https://docs.originlab.com/labtalk/ref/convert-func/)で明示的な単位換算を確認。自動で適切な物理量を選んでくれるとまでは解釈しない。
- Originの[Average/Merge Multiple Curves](https://docs.originlab.com/origin-help/math-avecurve/)は複数曲線の平均、標準偏差、最小最大、点数などを出力する。複数試験の中央値・百分位帯は、本ビューア向けの独自拡張案として区別する。
- Orangeの[Outliers](https://orangedatamining.com/widget-catalog/unsupervised/outliers/)でLOF・Isolation Forest等の外れ値候補検出を確認。これを時間波形の類似区間検索・変化点検出まで実装済みだと拡張解釈しない。
- Power BIのブックマークは「復元範囲を明示して選ぶ」設計の参考。ブラウザのIndexedDB保存成功・失敗の常設表示を備える根拠とはしない。
