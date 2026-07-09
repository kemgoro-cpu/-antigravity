/**
 * chart-options-utils.js — renderChart用のEChartsオプション構築ヘルパー（純粋関数群）
 *
 * renderChart（app.js）から「プレーンなデータを受け取りプレーンなデータを返す」
 * 部分だけを切り出したもの。state / dom / document / echarts には一切触れない。
 * これによりNode単体テスト（tests/chart-options-utils.test.js）が可能になっている。
 *
 * ブラウザ: グローバル `CSVChartOptions` / Node: `module.exports`（parser-utils.jsと同じUMD）
 */
(function (root) {
    'use strict';

    // ── チューニング用定数（挙動を調整するときはここを変える） ──────────
    // renderChart系の定数はこのファイルが単一情報源。app.jsからは
    // CSVChartOptions.CONSTANTS 経由で参照する（値は旧app.js定義のまま）
    const CONSTANTS = {
        // Bitチャンネルのグリッド高さの重み（通常グリッド = 1.0 に対する比率）
        BIT_WEIGHT: 0.33,
        // Y軸ズームスライダー1本あたりの水平方向の占有幅(px)
        ZOOM_GAP: 12,
        // プロット幅がこの値(px)を下回ったら「Y軸が多すぎる」警告を出す
        NARROW_PLOT_WARN_PX: 260,
        // EChartsのプログレッシブ描画: 1フレームで描く点数 / 有効になるデータ点数のしきい値
        SERIES_PROGRESSIVE: 400,
        SERIES_PROGRESSIVE_THRESHOLD: 3000,
        // データ点マーカー（Show Markers ON時の丸印）のサイズ(px)
        MARKER_SYMBOL_SIZE: 4,
        // markAreaでY範囲外の帯をグリッド端まで塗るための「事実上無限遠」の係数とオフセット
        // （EChartsのmarkAreaはInfinityを受け付けないため十分大きい値で代用する）
        MARK_AREA_FAR_SCALE: 100,
        MARK_AREA_FAR_OFFSET: 1e9,
    };

    /**
     * 各グリッドの高さ重みを計算する（Bit = BIT_WEIGHT, 通常 = 1.0）。
     * マージグリッドは全チャンネルがBitのときだけ狭くする。
     * @param {string[][]} mergedNamesList グリッド順の「マージ済みチャンネル名リスト」の配列
     * @param {Set<string>} bitChannels Bitモードのチャンネル名集合
     * @returns {number[]} グリッドごとの重み
     */
    function computeGridWeights(mergedNamesList, bitChannels) {
        return mergedNamesList.map(names => {
            const allBit = names.every(n => bitChannels.has(n));
            return allBit ? CONSTANTS.BIT_WEIGHT : 1.0;
        });
    }

    /**
     * 全ファイル（オフセット込み）を跨いだX軸（時間）の全体レンジを求める。
     * @param {{first:number, last:number, offset:number}[]} spans
     *        ファイルごとの先頭/末尾時刻とオフセット（timeDataが空のファイルは渡さない）
     * @returns {{min:number, max:number}} 有効なファイルが無ければ {min:0, max:1}
     */
    function computeGlobalXRange(spans) {
        let min = Infinity, max = -Infinity;
        for (const s of spans) {
            const off = s.offset || 0;
            const lo = s.first + off;
            const hi = s.last + off;
            if (lo < min) min = lo;
            if (hi > max) max = hi;
        }
        if (!isFinite(min)) { min = 0; max = 1; }
        return { min, max };
    }

    /**
     * グリッドごとの左右マージン（Y軸スロット配置）を計算する。
     * Y軸は偶数番目=左 / 奇数番目=右に振り分けられるため、
     * 左右それぞれの軸本数分だけ AXIS_GAP を、右側はY軸ズームスライダー分の
     * ZOOM_GAP も加算する。
     * @param {number[]} axisCounts グリッド順の軸本数（最低1として渡す）
     * @param {{gridLeft:number, gridRight:number, axisGap:number}} opts
     *        gridLeft/gridRight はレイアウト基準値、axisGap はフォント連動の軸間隔
     * @returns {{left:number, right:number, axisCount:number}[]}
     */
    function computeGroupLayouts(axisCounts, opts) {
        return axisCounts.map(axisCount => {
            const leftCount = Math.ceil(axisCount / 2);
            const rightCount = Math.floor(axisCount / 2);
            return {
                left: opts.gridLeft + Math.max(0, leftCount - 1) * opts.axisGap,
                // 右側はズームスライダー領域の最低幅68pxを確保する
                right: Math.max(opts.gridRight, 68) + Math.max(0, rightCount - 1) * opts.axisGap + axisCount * CONSTANTS.ZOOM_GAP,
                axisCount,
            };
        });
    }

    /**
     * X軸スライダーの左右位置 = 全グリッドの最大マージン。
     * @param {{left:number, right:number}[]} groupLayouts computeGroupLayoutsの結果
     * @returns {{left:number, right:number}}
     */
    function computeSliderBounds(groupLayouts) {
        return {
            left: Math.max(...groupLayouts.map(layout => layout.left)),
            right: Math.max(...groupLayouts.map(layout => layout.right)),
        };
    }

    /**
     * 「Y軸が多くて描画領域が狭い」警告のキーを導出する。
     * 同じ状況（最大軸本数×プロット幅）での連続警告を抑止するために使う。
     * @param {number} plotWidth プロット幅(px) = チャート幅 - 左右マージン
     * @param {number[]} axisCounts グリッドごとの軸本数
     * @returns {string} 警告不要なら ''（空文字）
     */
    function deriveNarrowWarningKey(plotWidth, axisCounts) {
        return plotWidth < CONSTANTS.NARROW_PLOT_WARN_PX
            ? `${Math.max(...axisCounts)}:${Math.round(plotWidth)}`
            : '';
    }

    /**
     * X軸dataZoomペア（下部スライダー + inside ホイールズーム）を構築する。
     * @param {object} p
     * @param {number} p.gridCount グリッド数（全グリッドをリンクする）
     * @param {number} p.start ズーム開始(%) / @param {number} p.end ズーム終了(%)
     * @param {number} p.left / @param {number} p.right スライダーの左右位置(px)
     * @param {{border:string, accent:string, dim:string}} p.theme テーマ色
     * @param {number} p.sliderFontSize スライダー数値のフォントサイズ
     * @param {boolean} p.panEnabled ドラッグパン可否（シフト/Arrangeモード中はfalse）
     * @returns {object[]} [スライダー, inside] の2要素
     */
    function buildXDataZooms(p) {
        const xAxisIndex = [];
        for (let i = 0; i < p.gridCount; i++) xAxisIndex.push(i);
        return [
            {
                type: 'slider',
                xAxisIndex,
                start: p.start, end: p.end,
                bottom: 8, height: 28,
                left: p.left, right: p.right,
                borderColor: p.theme.border,
                backgroundColor: 'rgba(255,255,255,0.03)',
                fillerColor: 'rgba(99,102,241,0.18)',
                handleStyle: { color: p.theme.accent, borderColor: p.theme.accent },
                textStyle: { color: p.theme.dim, fontSize: p.sliderFontSize },
                dataBackground: {
                    lineStyle: { color: 'rgba(99,102,241,0.4)', width: 1 },
                    areaStyle: { color: 'rgba(99,102,241,0.07)' },
                },
            },
            {
                type: 'inside',
                xAxisIndex: xAxisIndex.slice(),
                start: p.start, end: p.end,
                zoomOnMouseWheel: true,
                moveOnMouseMove: p.panEnabled,
                moveOnMouseWheel: false,
            },
        ];
    }

    /**
     * Y軸1本ぶんの縦ズームスライダーを構築する。
     * @param {object} p
     * @param {number} p.yAxisIndex 対象Y軸のインデックス
     * @param {number} p.axisOrder グループ内での軸の順番（右方向へZOOM_GAPずつずらす）
     * @param {string} p.top グリッド上端（%文字列） / @param {string} p.height グリッド高さ（%文字列）
     * @param {number} p.yZoomRight 右端からの基準オフセット(px)
     * @returns {object} dataZoomオプション
     */
    function buildYSliderZoom(p) {
        return {
            type: 'slider', yAxisIndex: [p.yAxisIndex],
            start: 0, end: 100,
            right: p.yZoomRight + p.axisOrder * CONSTANTS.ZOOM_GAP, top: p.top,
            height: p.height, width: 9,
            borderColor: 'transparent',
            backgroundColor: 'rgba(255,255,255,0.04)',
            fillerColor: 'rgba(255,255,255,0.1)',
            handleStyle: { color: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.2)' },
            showDetail: false, showDataShadow: false,
            textStyle: { color: 'transparent', fontSize: 0 },
        };
    }

    /**
     * 軸1本の表示仕様（代表チャンネル・Y範囲・左右位置）を解決する。
     * @param {object} p
     * @param {string[]} p.assignedNames この軸に割り当てられたチャンネル名（1つ以上）
     * @param {string} p.preferredRepresentative 軸定義上の代表チャンネル名
     * @param {object} p.yRanges チャンネル名 → { min, max }（文字列。state.yRanges）
     * @param {Set<string>} p.bitChannels Bitモードのチャンネル名集合
     * @param {number} p.axisOrder グループ内での軸の順番
     * @param {number} p.axisGap 軸同士の水平間隔(px)
     * @returns {{representative:string, yMinParsed:number, yMaxParsed:number,
     *            hasYMin:boolean, hasYMax:boolean, position:'left'|'right', offset:number}}
     */
    function computeAxisSpec(p) {
        const representative = p.assignedNames.includes(p.preferredRepresentative)
            ? p.preferredRepresentative
            : p.assignedNames[0];
        const rangeSpec = p.yRanges[representative] ?? {};
        // Bit軸は0/1の矩形波が見やすいよう固定レンジ（上下に0.2の余白）
        const axisIsBit = p.assignedNames.every(name => p.bitChannels.has(name));
        const yMinParsed = axisIsBit ? -0.2 : parseFloat(rangeSpec.min);
        const yMaxParsed = axisIsBit ? 1.2 : parseFloat(rangeSpec.max);
        return {
            representative,
            yMinParsed,
            yMaxParsed,
            hasYMin: !isNaN(yMinParsed),
            hasYMax: !isNaN(yMaxParsed),
            position: p.axisOrder % 2 === 0 ? 'left' : 'right',
            offset: Math.floor(p.axisOrder / 2) * p.axisGap,
        };
    }

    /** X軸数値ラベルのフォーマッタ（整数はそのまま、小数は1桁） */
    function formatXAxisValue(v) {
        return v % 1 === 0 ? v.toString() : v.toFixed(1);
    }

    /** Y軸数値ラベルのフォーマッタ（M/k短縮・小数・指数の使い分け） */
    function formatYAxisValue(v) {
        if (v === 0) return '0';
        const a = Math.abs(v);
        if (a >= 1e6)  return (v / 1e6).toFixed(1) + 'M';
        if (a >= 1e3)  return (v / 1e3).toFixed(1) + 'k';
        if (a >= 1)    return v.toFixed(1);
        if (a >= 0.01) return v.toPrecision(2);
        return v.toExponential(1);
    }

    /**
     * グリッド1つぶんのX軸オプションを構築する。
     * @param {object} p
     * @param {number} p.gridIndex グリッドインデックス
     * @param {boolean} p.isLast 最下段のグリッドか（ラベル・目盛りは最下段のみ表示）
     * @param {number} p.min / @param {number} p.max X軸の全体レンジ
     * @param {number} p.fontSize 数値ラベルのフォントサイズ
     * @param {{dim:string, axis:string, grid:string}} p.theme テーマ色
     * @returns {object} xAxisオプション
     */
    function buildXAxisOption(p) {
        return {
            gridIndex: p.gridIndex,
            type: 'value',
            axisLabel: {
                show: p.isLast,
                color: p.theme.dim, fontSize: p.fontSize,
                formatter: formatXAxisValue,
            },
            axisTick:  { show: p.isLast, lineStyle: { color: p.theme.axis } },
            axisLine:  { show: true, lineStyle: { color: p.theme.axis } },
            splitLine: { show: true, lineStyle: { color: p.theme.grid } },
            min: p.min, max: p.max,
        };
    }

    /**
     * Y軸1本のオプションを構築する。
     * @param {object} p
     * @param {number} p.gridIndex グリッドインデックス
     * @param {object} p.axisSpec computeAxisSpecの結果
     * @param {string[]} p.assignedNames この軸のチャンネル名（軸名は ' / ' 結合）
     * @param {string} p.units 表示単位（無ければ空文字）
     * @param {number} p.axisOrder グループ内での軸の順番（splitLineは先頭軸のみ）
     * @param {number} p.nameGap 軸名と数値ラベルの間隔
     * @param {number} p.nameFontSize 軸名フォントサイズ / @param {number} p.labelFontSize 数値フォントサイズ
     * @param {number} p.labelWidth 数値ラベルの最大幅
     * @param {number} p.nameTruncateMaxWidth 軸名の省略幅（グリッド高さ連動）
     * @param {{dim:string, axis:string, grid:string}} p.theme テーマ色
     * @returns {object} yAxisオプション
     */
    function buildYAxisOption(p) {
        const { yMinParsed, yMaxParsed, hasYMin, hasYMax, position, offset } = p.axisSpec;
        const yLabelName = p.assignedNames.join(' / ');
        const yLabel = p.units ? `${yLabelName}  (${p.units})` : yLabelName;
        return {
            gridIndex: p.gridIndex,
            type: 'value',
            position,
            offset,
            name: yLabel,
            nameLocation: 'middle',
            nameGap: p.nameGap,
            nameTextStyle: { color: p.theme.dim, fontSize: p.nameFontSize, fontWeight: 500 },
            // 軸名(回転表示)がグリッド高さを超えると上下のチャートのラベルと
            // 重なるため、収まらない分は「…」で自動的に切り詰める(ECharts 5.5組み込み)
            nameTruncate: { maxWidth: p.nameTruncateMaxWidth, ellipsis: '…' },
            min: hasYMin ? yMinParsed : undefined,
            max: hasYMax ? yMaxParsed : undefined,
            scale: !hasYMin && !hasYMax,
            axisLabel: { color: p.theme.dim, fontSize: p.labelFontSize, width: p.labelWidth, overflow: 'truncate', formatter: formatYAxisValue },
            axisPointer: { show: false },
            axisTick: { lineStyle: { color: p.theme.axis } },
            axisLine: { show: true, lineStyle: { color: p.theme.axis } },
            splitLine: { show: p.axisOrder === 0, lineStyle: { color: p.theme.grid } },
        };
    }

    /**
     * Y範囲外を示す帯（markArea）を構築する。
     * 上限超過側・下限未満側それぞれをグリッド端まで塗る
     * （MARK_AREA_FAR_* による「事実上無限遠」でEChartsのInfinity非対応を回避）。
     * @param {{hasYMin:boolean, hasYMax:boolean, yMinParsed:number, yMaxParsed:number}} axisSpec
     * @returns {object|undefined} min/maxどちらも無ければ undefined
     */
    function buildMarkArea(axisSpec) {
        const { hasYMin, hasYMax, yMinParsed, yMaxParsed } = axisSpec;
        if (!hasYMin && !hasYMax) return undefined;
        return {
            silent: true,
            data: [
                ...(hasYMax ? [[{ yAxis: yMaxParsed }, { yAxis: yMaxParsed * CONSTANTS.MARK_AREA_FAR_SCALE + CONSTANTS.MARK_AREA_FAR_OFFSET }]] : []),
                ...(hasYMin ? [[{ yAxis: -(Math.abs(yMinParsed) * CONSTANTS.MARK_AREA_FAR_SCALE + CONSTANTS.MARK_AREA_FAR_OFFSET) }, { yAxis: yMinParsed }]] : []),
            ],
            itemStyle: { color: 'rgba(255,80,50,0.07)' },
        };
    }

    /**
     * Y範囲の境界線（markLine）を構築する。
     * @param {{hasYMin:boolean, hasYMax:boolean, yMinParsed:number, yMaxParsed:number}} axisSpec
     * @param {number} labelFontSize 軸数値ラベルのフォントサイズ（境界ラベルは-1して表示）
     * @returns {object|undefined} min/maxどちらも無ければ undefined
     */
    function buildMarkLine(axisSpec, labelFontSize) {
        const { hasYMin, hasYMax, yMinParsed, yMaxParsed } = axisSpec;
        if (!hasYMin && !hasYMax) return undefined;
        return {
            silent: true,
            symbol: 'none',
            data: [
                ...(hasYMax ? [{ yAxis: yMaxParsed, lineStyle: { color: 'rgba(255,120,60,0.6)', type: 'dashed', width: 1 }, label: { formatter: `▲ ${yMaxParsed}`, fontSize: labelFontSize - 1, color: 'rgba(255,120,60,0.8)', position: 'insideStartTop' } }] : []),
                ...(hasYMin ? [{ yAxis: yMinParsed, lineStyle: { color: 'rgba(255,120,60,0.6)', type: 'dashed', width: 1 }, label: { formatter: `▼ ${yMinParsed}`, fontSize: labelFontSize - 1, color: 'rgba(255,120,60,0.8)', position: 'insideStartBottom' } }] : []),
            ],
        };
    }

    /**
     * 1シリーズ（メイン実線 or サブ破線）のオプションを構築する。
     * markArea / markLine はY範囲が設定された軸の「最初のシリーズ」にだけ付ける
     * （重複描画で帯が濃くなるのを防ぐ）。
     * @param {{id:string, label:string, color:string, dash:boolean, data:Array}} s
     *        getActiveGroupsが構築したシリーズ記述子
     * @param {object} p
     * @param {number} p.xAxisIndex / @param {number} p.yAxisIndex 対象軸
     * @param {boolean} p.isFirstForAxis この軸の最初のシリーズか
     * @param {object} p.axisSpec computeAxisSpecの結果
     * @param {boolean} p.showMarkers データ点マーカー表示
     * @param {string|false} p.sampling サンプリングモード（'' はfalse化して渡す）
     * @param {number} p.lineWidth 線の太さ
     * @param {number} p.labelFontSize 軸数値ラベルのフォントサイズ（markLineラベル用）
     * @returns {object} seriesオプション
     */
    function buildSeriesOption(s, p) {
        const { hasYMin, hasYMax } = p.axisSpec;
        const showBand = p.isFirstForAxis && (hasYMin || hasYMax);
        const markArea = showBand ? buildMarkArea(p.axisSpec) : undefined;
        const markLine = showBand ? buildMarkLine(p.axisSpec, p.labelFontSize) : undefined;
        return {
            id:         s.id,
            name:       s.label,
            type:       'line',
            xAxisIndex: p.xAxisIndex,
            yAxisIndex: p.yAxisIndex,
            data:       s.data,
            showSymbol: p.showMarkers,
            symbolSize: CONSTANTS.MARKER_SYMBOL_SIZE,
            sampling:   p.sampling,
            progressive: CONSTANTS.SERIES_PROGRESSIVE,
            progressiveThreshold: CONSTANTS.SERIES_PROGRESSIVE_THRESHOLD,
            clip:       true,
            lineStyle:  { width: p.lineWidth, color: s.color, type: s.dash ? [6, 4] : 'solid' },
            itemStyle:  { color: s.color },
            emphasis:   { disabled: true },
            ...(markArea ? { markArea } : {}),
            ...(markLine ? { markLine } : {}),
        };
    }

    /**
     * 全グリッド共通の静的チャートオプション（グリッド・軸・シリーズ以外）を構築する。
     * tooltip.formatter はモジュール状態（ホバーラベル更新・フォント設定）に
     * 依存するため含まない — 呼び出し側（renderChart）が注入する。
     * @param {object} [p] テーマ色の上書き（省略時はダークテーマの既定値）
     * @param {{crosshair?:string, tooltipBg?:string, tooltipBorder?:string}} [p.theme]
     * @returns {object} setOptionに展開するベースオプション
     */
    function buildBaseChartOption(p) {
        const t = (p && p.theme) || {};
        const crosshair     = t.crosshair     || 'rgba(255,255,255,0.35)';
        const tooltipBg     = t.tooltipBg     || 'rgba(12,14,20,0.45)';
        const tooltipBorder = t.tooltipBorder || 'rgba(255,255,255,0.08)';
        return {
            animation:       false,
            backgroundColor: 'transparent',
            legend:          { show: false },  // sidebar acts as legend

            // Global axis pointer — links vertical crosshair across ALL grids
            axisPointer: {
                link:  [{ xAxisIndex: 'all' }],
                label: { show: false },
                triggerOn: 'mousemove',
            },

            tooltip: {
                show: true,
                trigger: 'axis',
                axisPointer: {
                    type: 'line',
                    lineStyle: { color: crosshair, type: 'solid', width: 1 },
                    animation: false,
                    snap: true,
                },
                backgroundColor: tooltipBg,
                extraCssText: [
                    'backdrop-filter:blur(8px)',
                    '-webkit-backdrop-filter:blur(8px)',
                    `border:1px solid ${tooltipBorder}`,
                    'border-radius:6px',
                    'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
                    'padding:4px 8px',
                    'pointer-events:none',
                ].join(';'),
                confine: true,
            },

            brush: {
                xAxisIndex: 'all', brushLink: 'all', toolbox: [],
                throttleType: 'debounce', throttleDelay: 80,
                outOfBrush: { colorAlpha: 0.05 },
            },
        };
    }

    const api = {
        CONSTANTS,
        buildBaseChartOption,
        computeGridWeights,
        computeGlobalXRange,
        computeGroupLayouts,
        computeSliderBounds,
        deriveNarrowWarningKey,
        buildXDataZooms,
        buildYSliderZoom,
        computeAxisSpec,
        formatXAxisValue,
        formatYAxisValue,
        buildXAxisOption,
        buildYAxisOption,
        buildMarkArea,
        buildMarkLine,
        buildSeriesOption,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CSVChartOptions = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
