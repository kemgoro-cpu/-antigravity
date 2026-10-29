# CSV Chart Viewer改善調査：計測・車両・科学波形アプリ

調査日：2026-10-30（日本時間）。担当範囲：12製品、32候補。各社公式製品ページ、公式マニュアル、開発元リポジトリによる文書調査であり、比較製品を実機操作した結果ではない。性能値・料金・ライセンスの適用範囲は比較していない。以下の「反映案」「優先度」「負担」は現行ビューアを踏まえた提案・評価であり、比較製品の仕様そのものではない。

## 現状との差分

現行のREADME、FEATURE_BACKLOG、MANUAL_IMPROVEMENTSと、app.js・compare-utils.jsを確認した。次の機能は既にあるため「新機能」として再提案しない。

- CSV/TRNの複数読込、チャンネル検索・日本語別名、チャンネル対応付け、お気に入り。
- 手動・自動時間合わせ、重ね合わせ・上下比較・差分、最大差・平均差・RMS差、欠損数。
- 許容差超過の帯・単発線・前後移動（2026-10-29のREADMEに記載）。
- 2点カーソル、区間選択、区間統計、式によるイベント検出。
- Custom RAMの積分・微分・点数窓の移動平均・遅延（app.js:537、553–555ほか）。
- XY散布図、Drive Index、目標車速重ね合わせ、CSV/画像/HTMLレポート。
- セッション自動復元、メモに条件と画像を保存、比較テンプレート、Undo/Redo、テーマ切替。

現行READMEは平均差・RMS差を「有効サンプルの等重み平均」、許容差帯を「実在する超過サンプルの最初〜最後」と明記している。したがって時間重み平均・超過継続時間などを加える際は、既存の数値の意味を変更せず、別の指標として定義する。XY・CSVと比較・メモの対象区間の違い、単位行なしCSV、復元状態、Drive Index入力単位の課題は既存のMANUAL_IMPROVEMENTSにあり、関連する提案は新発見ではなく既存課題の補強となる。

## 12製品の確認結果

| 製品 | 公式情報で確認した特徴 | このビューアへの反映案と優先度 | 適用時の注意 |
|---|---|---|---|
| PlotJuggler | 記録・ライブデータ、複数記録比較、変換、タブとドッキング配置の再利用。開発元は現在PlotJuggler組織へ移動。[公式リポジトリ](https://github.com/PlotJuggler/PlotJuggler) | 「全体」「燃費」「変速」「温度」等の解析ページを同一セッションに保存。高 | 現状のプリセットはある。追加の価値は複数ページを保持しつつ即座に往復できる点。 |
| Vector CANape | ECU計測・適合に加え、データ解析からレポート自動生成までを提供。[製品ページ](https://www.vector.com/en/product/canape/) | 解析条件をまとめた実行手順をワンクリック再実行。中 | ECU書込み・通信・フラッシュ機能の移植は本ビューアの用途外。 |
| Vector vSignalyzer | 条件によるデータマイニング、自動評価・帳票化、ローカルMDF検索、異名信号のThesaurus。[製品ページ](https://www.vector.com/en/product/vsignalyzer/) | 複数ログの試験評価一覧、共有する信号辞書。高 | 名前対応は既存。辞書に単位・意味・適用履歴を加える差分が必要。 |
| ETAS MDA | 波形、表、イベント、統計等を同じ時刻で同期。レイヤーで複数画面を整理。[製品ページ](https://www.etas.com/ww/en/products-services/data-acquisition-processing-tools/software-products/measure-data-analyzer-mda/) | 波形と同期する生データ表、状態変化一覧、解析ページ。高 | 数値表では補間値と観測値を区別。既存のParse Previewとは用途が異なる。 |
| NI DIAdem | メタデータ検索、混在データ同期、標準化した解析・帳票の自動化。[公式概要](https://www.ni.com/en/shop/data-acquisition-and-control/application-software-for-data-acquisition-and-control-category/what-is-diadem.html) | 試験番号・車両・条件でログを選び、共通の評価表を一括生成。高 | サーバー不要のローカル索引から始める。実際のフォルダーアクセス方法は別途設計。 |
| imc FAMOS | 単位・サンプリングの変換、周期イベント処理、多様な図、マクロ処理。[製品ページ](https://www.imc-tm.com/products/measurement-software/imc-famos) | 単位付き変換プレビュー、繰り返し動作の整列比較。高 | 元データは保持。異なる物理量を単位文字列だけで同一視しない。 |
| DewesoftX | 録画再生、オフライン再計算、区間選択、イベント、同期動画。[公式講座](https://dewesoft.com/academy/online/connect/dewesoftx-post-processing) | イベント前後を切り出して再生、再計算範囲を明示。中 | 本ビューアのオフライン前提を維持。動画はある場合のみ有用。 |
| asammdf GUI | Plot/Numeric/Tabular、メタデータ、raw/scaled、補間方法、複数ファイル処理。[公式GUI文書](https://asammdf.readthedocs.io/en/latest/gui.html) | 生値表、サンプル単位移動、信号型と補間方式の明示。高 | MDF読込そのものはPython/変換器等の追加が必要になり、ブラウザのみの軽量性と要調整。 |
| MATLAB Signal Analyzer | 時間・周波数・時間周波数の同時表示と、前処理・欠損処理。[公式アプリ文書](https://www.mathworks.com/help/signal/ref/signalanalyzer-app.html) | FFT/スペクトログラム、前処理の原波形比較プレビュー。中 | 不等間隔・欠損・窓・単位を明示しないFFTは誤読しやすい。欠損を自動補完しない。 |
| Saleae Logic 2 | 区間測定、単独/対のタイミングマーカー、名前・色・ノート。[公式操作文書](https://new.saleae.com/support/logic-software/viewing-and-analyzing-data/measurements-timing-markers) | 複数マーカーと複数測定区間を同時保持、一覧から復帰。高 | メモと2点計測は既存。複数のA/Bペアを残せることを追加価値にする。 |
| sigrok PulseView | 高速波形表示、トレース群、デコーダーによる意味付き注釈。[公式概要](https://sigrok.org/wiki/Pulseview)、[開発元のデコーダー文書](https://github.com/sigrokproject/pulseview/blob/master/manual/decoders.txt) | 0/1だけでなくギア・制御モード等の状態帯を意味付き表示。高 | 生バスのデコードは別機能。CSV内の既存状態列を辞書で表示するところから始める。 |
| PicoScope | 許容マスク超過の表示・カウント、繰り返し波形の残像で稀な異常を可視化。[マスク](https://www.picotech.com/library/knowledge-bases/oscilloscopes/mask-limit-testing)、[残像表示](https://www.picotech.com/library/knowledge-bases/oscilloscopes/digital-persistence-modes) | 時刻依存の許容帯、繰り返しイベントの密度/重ね合わせ。中〜高 | 通常の固定許容差は既存。時間と値の許容範囲、繰り返しイベントを増分とする。 |

## 32の反映候補

優先度は本担当内の目安。「高」は繰り返し使う基本作業の効率化、「中」は使うデータ次第で大きい効果、「低」は用途または実装範囲が広がるもの。負担は小/中/大の相対評価であり、工数見積りではない。外部機能をそのまま移植すると断定せず、参照した操作原理からの提案として記載する。

| ID | 反映案 | 日常作業での効果・現状からの差分 | 優先 / 負担 | 参考 |
|---|---|---|---|---|
| E01 | 波形と同期する生データ表 | カーソル時刻周辺の前後10〜100行を表示。行選択で波形へ、波形から該当行へ移動。欠損・元時刻・補間有無を確認できる。Parse Previewの拡張とは分ける。 | 高 / 中 | [MDA](https://www.etas.com/ww/en/products-services/data-acquisition-processing-tools/software-products/measure-data-analyzer-mda/) |
| E02 | サンプル単位の左右移動 | 矢印で観測点へ移動し、短いスパイクや1点だけの異常を読み取る。複数ファイルでは移動基準を明示。 | 高 / 小 | [asammdf](https://asammdf.readthedocs.io/en/latest/gui.html) |
| E03 | 時刻・欠損の品質レーン | 時刻逆転、重複、長い欠測、Δtの異常を全体ナビゲーターに表示。異常を物理現象と混同しにくくする。既存エラー通知を全体俯瞰へ広げる。 | 高 / 中 | [PlotJugglerのΔt変換追加](https://github.com/rticommunity/plotjuggler/blob/main/CHANGELOG.rst)、[DIAdem欠損処理](https://www.ni.com/docs/rw-RW/bundle/diadem/page/genmaths/genmaths/calc_channelfunctions.htm) |
| E04 | 信号プロパティカード | 名前・別名・物理量・単位・有効数・欠損数・サンプル間隔・最小最大・由来・変換式を1か所に表示。 | 高 / 小〜中 | [MDA](https://www.etas.com/ww/en/products-services/data-acquisition-processing-tools/software-products/measure-data-analyzer-mda/) |
| E05 | 多値状態の帯表示 | `Gear=1/2/3`、制御状態等を文字と色の帯にする。0/1 Bit表示に加え、状態遷移一覧と滞在時間へつなげる。 | 高 / 中 | [MDAイベント一覧](https://docs.etas.com/mda/docs/V8.8/EN/Content/Topics/4_AnalysisPreparation/MDA_TASK_UsingEventList.htm)、[PulseView](https://github.com/sigrokproject/pulseview/blob/master/manual/decoders.txt) |
| E06 | 確認付き単位換算 | km/h↔m/s、kPa↔MPaなど、比較前に変換式・前後の数値を提示して適用。元の値は保持する。現状の単位不一致除外を改善。 | 高 / 中 | [FAMOS](https://www.imc-tm.com/products/measurement-software/imc-famos) |
| E07 | 共有信号辞書 | 対応名だけでなく単位・意味・状態名・代表式をまとめてJSON共有。単位不一致や曖昧候補は自動決定しない。 | 高 / 中 | [vSignalyzer](https://www.vector.com/en/product/vsignalyzer/) |
| E08 | 同一セッション内の解析ページ | 「全体」「燃費」「変速」「温度」をタブで保持。各々のチャンネル・配置・区間を保存し、素早く切替。 | 高 / 中〜大 | [PlotJuggler](https://github.com/PlotJuggler/PlotJuggler) |
| E09 | イベント起点の整列比較 | 1つのログ内の複数の変速・始動を検出し、各開始を0秒として前後を重ねる。ファイル単位の時間合わせとは別。 | 高 / 中〜大 | [FAMOS](https://www.imc-tm.com/products/measurement-software/imc-famos) |
| E10 | 試験ごとの評価一覧 | 複数ファイルへ同じテンプレートを適用し、最大差・RMS・判定・欠損を行単位で表示。異常行から波形へ移動。 | 高 / 大 | [vSignalyzer](https://www.vector.com/en/product/vsignalyzer/) |
| E11 | ノイズに強いイベント条件 | 最低継続時間、再検出禁止時間、再アームしきい値、前後余白を追加。現状の論理式に時間条件を加える。 | 高 / 中 | [Dewesoftトリガー](https://manual.dewesoft.com/x/setupmodule/modules/general/storing/triggersetup) |
| E12 | 時刻依存・非対称の許容帯 | 固定の絶対差だけでなく、基準波形に対する上限/下限を指定。始動直後のみ別基準などを明示。 | 高 / 中〜大 | [PicoScopeマスク](https://www.picotech.com/library/knowledge-bases/oscilloscopes/mask-limit-testing) |
| E13 | 複数マーカーと計測ペア | 「開始」「応答」「収束」などの点と複数の測定ペアを残し、色・名前を付ける。既存の一組の2点カーソルを拡張。 | 高 / 中 | [Saleae](https://new.saleae.com/support/logic-software/viewing-and-analyzing-data/measurements-timing-markers) |
| E14 | 名前付き区間の比較表 | アイドル、加速、定速など複数区間の同じ統計を横並びにする。メモから各区間を個別に開き直す操作を減らす。 | 高 / 中 | [Saleaeの測定注釈](https://new.saleae.com/support/logic-software/viewing-and-analyzing-data/what-annotations-are-supported) |
| E15 | ヒストグラム・滞在時間分布 | 平均で埋もれる分布や「高温域に何秒いたか」を表示。サンプル数分布と時間分布を別選択にする。 | 中 / 中 | [FAMOS変更履歴](https://www.imc-tm.com/products/measurement-software/imc-famos/version-history)、[Time-at-level](https://www.imc-tm.ch/fileadmin/Public/Products/Measurement_Software/imc_FAMOS/2024/imc_FAMOS_WhatsNew.pdf) |
| E16 | 時間重みの平均/RMSを追加 | 不等間隔ログではサンプル平均と時間平均が異なる。現在値を保持したまま計算法ラベル付きで別指標を提供。 | 高 / 中 | [FAMOS Time-at-levelを参考にした独自提案](https://www.imc-tm.ch/fileadmin/Public/Products/Measurement_Software/imc_FAMOS/2024/imc_FAMOS_WhatsNew.pdf) |
| E17 | 多回試験のばらつき帯 | E09の整列後、全波形/最小最大帯/中央値帯を切替。帯の外に出た波形を元試験へ追跡する。 | 中 / 大 | [PicoScope波形重ね合わせ](https://www.picotech.com/library/knowledge-bases/oscilloscopes/waveform-buffer-overlay) |
| E18 | 対数Y軸 | 桁が大きく異なる正値信号に対数軸を選べる。ゼロ・負値の扱いは警告する。 | 中 / 小〜中 | [FAMOS](https://www.imc-tm.com/products/measurement-software/imc-famos) |
| E19 | 選択区間のFFT | 気になる振動区間の周波数成分を確認。窓関数・サンプル間隔・周波数分解能・縦軸単位を表示。 | 中 / 中〜大 | [Signal Analyzer](https://www.mathworks.com/help/signal/ref/signalanalyzer-app.html) |
| E20 | スペクトログラム | 時間に伴う周波数成分の移動を表示し、波形区間と連動。回転数変化時の異音等で効果がある。 | 中 / 大 | [Signal Analyzer](https://www.mathworks.com/help/signal/ref/signalanalyzer-app.html) |
| E21 | 前処理の比較プレビュー | 既存の移動平均等を入力支援し、原波形と処理後を同時表示。追加フィルターは別途選定する。適用式を必ず残す。 | 高 / 中 | [Signal Analyzer](https://www.mathworks.com/help/signal/ref/signalanalyzer-app.html) |
| E22 | 再サンプリングを指定して出力 | 共通時間格子のCSVを作る。線形/直前保持・欠損・外挿禁止を選び、元の出力とは区別。 | 中 / 中 | [DIAdem再サンプリング](https://knowledge.ni.com/KnowledgeArticleDetails?id=kA03q000000YHksCAG) |
| E23 | カーソル連動の数値カード | 特定時刻の温度・燃費・トルク等を大きく表示。通常のツールチップを常設パネルにする。 | 中 / 小〜中 | [MDA](https://www.etas.com/ww/en/products-services/data-acquisition-processing-tools/software-products/measure-data-analyzer-mda/) |
| E24 | XYを第三の信号で着色 | 回転数×トルクを温度や時刻で着色。散布図で選んだ点の時間帯を波形に反映する。既存XYを深化。 | 中 / 中〜大 | [MDAの第三信号によるGPS色分けからの応用提案](https://www.etas.com/ww/en/products-services/data-acquisition-processing-tools/software-products/measure-data-analyzer-mda/) |
| E25 | スパイクを保つ俯瞰描画 | LTTBと別に、画素区間の最小/最大帯を表示して短い突出を見落としにくくする。計算は引き続き元データ。 | 高 / 中〜大 | [PulseViewの多段階波形表示からの応用提案](https://sigrok.org/wiki/Pulseview) |
| E26 | 動画・波形の同期再生 | 試験動画とグラフを同時に送り、事象の状況を確認。倍速・区間ループ・時刻オフセットを設ける。 | 低〜中 / 大 | [Dewesoft後処理](https://dewesoft.com/academy/online/connect/dewesoftx-post-processing) |
| E27 | GPS軌跡と波形の連動 | 緯度経度がある場合に位置から区間へ、波形から位置へ移動。色で車速や温度を示す。 | 低〜中 / 大 | [MDA](https://www.etas.com/ww/en/products-services/data-acquisition-processing-tools/software-products/measure-data-analyzer-mda/) |
| E28 | MDF/MF4取込経路 | 必要ならローカル変換器を介してチャンネル・単位・メタデータを保持。ブラウザ単体機能との境界を明示。 | 中 / 大 | [asammdf](https://asammdf.readthedocs.io/en/latest/gui.html) |
| E29 | 分割ログの連結 | 同じ計測の連番ファイルを1本として表示。重複・欠測・出典ファイル境界を残す。 | 中 / 中〜大 | [asammdfバッチ処理](https://asammdf.readthedocs.io/en/latest/gui.html#batch-processing) |
| E30 | 解析手順の再実行 | 読込→対応→計算→区間→評価→レポートをレシピとして保存。現状の見た目・設定テンプレートから処理へ拡張。 | 高 / 大 | [CANape](https://www.vector.com/en/product/canape/)、[DIAdem](https://www.ni.com/en/shop/data-acquisition-and-control/application-software-for-data-acquisition-and-control-category/what-is-diadem.html) |
| E31 | レポートレイアウトの再利用 | 表紙・試験条件・評価一覧・波形・注記の順をテンプレートにし、新しいログで更新。現状のHTML出力を構成可能にする。 | 中 / 中 | [DIAdem](https://www.ni.com/en/shop/data-acquisition-and-control/application-software-for-data-acquisition-and-control-category/what-is-diadem.html) |
| E32 | 信号型と補間規則の指定 | アナログ、Bit、列挙状態、累積値などを明示し、描画・比較・出力に一貫して使う。現在の0/1自動検出に依存しすぎない。 | 高 / 中 | [asammdf補間設定](https://asammdf.readthedocs.io/en/latest/gui.html) |

## 本担当の推薦順

1. E01 生データ表 + E02 サンプル移動：波形で疑問を持った瞬間に正確な数値へ到達できる。利用頻度が高く、現状の比較機能とも直結する。
2. E03 品質レーン + E04 プロパティ：比較前提の誤りを早く発見する。先頭データ消失等の既存読込課題の修正と組み合わせる。
3. E06 単位換算 + E07 辞書 + E32 信号型：異なる装置のログを毎回手修正する手間を減らす。ただし自動決定の範囲を限定する。
4. E08 解析ページ：既存の多機能を少ない切替で使えるようにする。機能追加に伴う画面混雑も抑える。
5. E11 時間条件付きイベント + E09 イベント整列：繰り返し試験を効率よく調べられる。イベント検出そのものの再実装ではない。
6. E13 複数マーカー + E14 区間比較：複数箇所を行き来する調査と、報告の下準備を短縮する。
7. E10 複数試験の評価一覧 + E30 解析レシピ：効果は大きいが、信号辞書・欠損/単位判定・計算対象区間の整備に依存する。
8. E12 可変許容帯：現在の固定許容差を応用できる。判定根拠を保存する設計が必要。
9. E25 スパイク保持：実際の大容量ログでLTTBとの見え方・速度を測定してから優先順位を確定する。
10. E19 FFT + E20 スペクトログラム：NVH・周期現象なら有効だが、一般的なCSV比較の最初の改善としては上記より後。

## 実装判断の前に残る確認

- 各製品の現行機能を全て実機確認したわけではない。特にPicoScopeの波形バッファ重ね合わせの資料はEarly Accessと明記されており、安定版への搭載は断定しない。
- PlotJugglerの現行公式リポジトリは4系。Δt変換の追加根拠は3系の開発履歴なので、4系の同一UI・同一搭載を断定せず設計参考として扱う。
- asammdfの文書には新旧ショートカット記述が混在する箇所がある。機能の参考に限定し、キー割当のそのままのコピーは勧めない。
- Saleaeの注釈概要と詳細操作ページはノートの扱いに記述差がある。本提案は詳細操作ページで確認できた測定・マーカーを根拠とする。
- 比較製品の巨大ファイル性能を、このブラウザアプリでも実現できるとは断定しない。E25等はローカルの合成ログでスパイク保持・操作時間・メモリ量を測定する。
- 追加機能は元データ、元時刻、TargetSpeedを変更しない。再サンプリング・単位変換・フィルターは派生データとして元と区別する。
- 欠損、未対応、単位不一致、対象点なしを合格やゼロとして扱わない。時間重み・状態滞在時間・可変許容帯は境界規則を定義してから実装する。
