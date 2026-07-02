// chart-options-utils.js(renderChartのEChartsオプション構築ヘルパー)の単体テスト。
// 実行: node tests/chart-options-utils.test.js
'use strict';

const assert = require('node:assert/strict');
const CO = require('../chart-options-utils.js');
const C = CO.CONSTANTS;

const THEME = {
    text: '#f0f0f0', dim: '#a0a5b1', border: 'rgba(255,255,255,0.08)',
    accent: '#6366f1', grid: 'rgba(255,255,255,0.05)', axis: 'rgba(255,255,255,0.15)',
};

// 定数が旧app.js定義から変わっていないこと（値の変更はリグレッション）
function testConstants() {
    assert.equal(C.BIT_WEIGHT, 0.33);
    assert.equal(C.ZOOM_GAP, 12);
    assert.equal(C.NARROW_PLOT_WARN_PX, 260);
    assert.equal(C.SERIES_PROGRESSIVE, 400);
    assert.equal(C.SERIES_PROGRESSIVE_THRESHOLD, 3000);
    assert.equal(C.MARKER_SYMBOL_SIZE, 4);
    assert.equal(C.MARK_AREA_FAR_SCALE, 100);
    assert.equal(C.MARK_AREA_FAR_OFFSET, 1e9);
}

// グリッド重み: Bit混在グリッドは1.0、全チャンネルBitのグリッドだけBIT_WEIGHT
function testGridWeights() {
    const bits = new Set(['Flag_A', 'Flag_B']);
    const weights = CO.computeGridWeights(
        [['Speed'], ['Flag_A'], ['Flag_A', 'Flag_B'], ['Flag_A', 'Speed']], bits);
    assert.deepEqual(weights, [1.0, C.BIT_WEIGHT, C.BIT_WEIGHT, 1.0]);
    // 空リスト
    assert.deepEqual(CO.computeGridWeights([], bits), []);
}

// X全体レンジ: オフセット込みの最小/最大。ファイル無しは {0,1}
function testGlobalXRange() {
    const r = CO.computeGlobalXRange([
        { first: 0, last: 1180, offset: 0 },
        { first: 0, last: 1180, offset: -3.5 },
    ]);
    assert.deepEqual(r, { min: -3.5, max: 1180 });
    assert.deepEqual(CO.computeGlobalXRange([]), { min: 0, max: 1 });
    // offset未指定(undefined)は0扱い
    assert.deepEqual(CO.computeGlobalXRange([{ first: 2, last: 5 }]), { min: 2, max: 5 });
}

// 軸スロット配置: 1軸=左1、2軸=左1右1、4軸=左2右2 で左右マージンが増える
function testGroupLayouts() {
    const opts = { gridLeft: 70, gridRight: 38, axisGap: 60 };
    const [one, two, four] = CO.computeGroupLayouts([1, 2, 4], opts);
    // 1軸: 左に追加軸なし、右はズームスライダー1本分
    assert.deepEqual(one, { left: 70, right: 68 + 1 * C.ZOOM_GAP, axisCount: 1 });
    // 2軸: 左1右1 → 右に軸1本(offset 0)とズーム2本分
    assert.deepEqual(two, { left: 70, right: 68 + 2 * C.ZOOM_GAP, axisCount: 2 });
    // 4軸: 左2右2 → 左右とも axisGap 1本分ずつ広がる
    assert.deepEqual(four, { left: 70 + 60, right: 68 + 60 + 4 * C.ZOOM_GAP, axisCount: 4 });
    // gridRight が68より大きい場合はそちらが基準になる
    const [wide] = CO.computeGroupLayouts([1], { gridLeft: 70, gridRight: 90, axisGap: 60 });
    assert.equal(wide.right, 90 + C.ZOOM_GAP);
}

// X軸スライダーの左右位置 = 全グリッドの最大マージン
function testSliderBounds() {
    const b = CO.computeSliderBounds([
        { left: 70, right: 80 }, { left: 130, right: 128 },
    ]);
    assert.deepEqual(b, { left: 130, right: 128 });
}

// 狭幅警告キー: しきい値未満のときだけ「最大軸数:幅」形式
function testNarrowWarningKey() {
    assert.equal(CO.deriveNarrowWarningKey(259.6, [1, 4, 2]), '4:260');
    assert.equal(CO.deriveNarrowWarningKey(260, [1]), '');
    assert.equal(CO.deriveNarrowWarningKey(1000, [4]), '');
}

// X軸dataZoomペア: スライダー+insideの2本、全グリッドリンク、ズーム位置維持
function testXDataZooms() {
    const [slider, inside] = CO.buildXDataZooms({
        gridCount: 3, start: 20, end: 80, left: 70, right: 92,
        theme: THEME, sliderFontSize: 10, panEnabled: false,
    });
    assert.equal(slider.type, 'slider');
    assert.deepEqual(slider.xAxisIndex, [0, 1, 2]);
    assert.equal(slider.start, 20);
    assert.equal(slider.end, 80);
    assert.equal(slider.left, 70);
    assert.equal(slider.right, 92);
    assert.equal(slider.bottom, 8);
    assert.equal(slider.borderColor, THEME.border);
    assert.equal(slider.textStyle.fontSize, 10);
    assert.equal(inside.type, 'inside');
    assert.deepEqual(inside.xAxisIndex, [0, 1, 2]);
    assert.equal(inside.moveOnMouseMove, false); // シフトモード中はパン無効
    assert.equal(inside.zoomOnMouseWheel, true);
}

// Y軸ズームスライダー: 軸の順番に応じて右へZOOM_GAPずつずれる
function testYSliderZoom() {
    const z = CO.buildYSliderZoom({ yAxisIndex: 5, axisOrder: 2, top: '10.000%', height: '25.000%', yZoomRight: 6 });
    assert.deepEqual(z.yAxisIndex, [5]);
    assert.equal(z.right, 6 + 2 * C.ZOOM_GAP);
    assert.equal(z.top, '10.000%');
    assert.equal(z.height, '25.000%');
    assert.equal(z.width, 9);
    assert.equal(z.showDetail, false);
}

// 軸仕様の解決: 代表チャンネル・Y範囲パース・Bit固定レンジ・左右振り分け
function testComputeAxisSpec() {
    const base = { yRanges: {}, bitChannels: new Set(), axisGap: 60 };

    // 通常軸: Y範囲未設定 → min/maxなし、偶数番目=左
    const plain = CO.computeAxisSpec({ ...base, assignedNames: ['Speed'], preferredRepresentative: 'Speed', axisOrder: 0 });
    assert.equal(plain.representative, 'Speed');
    assert.equal(plain.hasYMin, false);
    assert.equal(plain.hasYMax, false);
    assert.equal(plain.position, 'left');
    assert.equal(plain.offset, 0);

    // Y範囲設定あり（文字列からパース）
    const ranged = CO.computeAxisSpec({
        ...base, yRanges: { Speed: { min: '10', max: '50' } },
        assignedNames: ['Speed'], preferredRepresentative: 'Speed', axisOrder: 1,
    });
    assert.equal(ranged.yMinParsed, 10);
    assert.equal(ranged.yMaxParsed, 50);
    assert.equal(ranged.hasYMin, true);
    assert.equal(ranged.hasYMax, true);
    assert.equal(ranged.position, 'right'); // 奇数番目=右
    assert.equal(ranged.offset, 0);

    // 代表チャンネルが割り当てに無い場合は先頭へフォールバック
    const fb = CO.computeAxisSpec({ ...base, assignedNames: ['A', 'B'], preferredRepresentative: 'Gone', axisOrder: 2 });
    assert.equal(fb.representative, 'A');
    assert.equal(fb.offset, 60); // 2番目の左軸はaxisGapぶんずれる

    // Bit軸はY範囲設定を無視して-0.2〜1.2固定
    const bit = CO.computeAxisSpec({
        ...base, yRanges: { Flag: { min: '-5', max: '5' } }, bitChannels: new Set(['Flag']),
        assignedNames: ['Flag'], preferredRepresentative: 'Flag', axisOrder: 0,
    });
    assert.equal(bit.yMinParsed, -0.2);
    assert.equal(bit.yMaxParsed, 1.2);

    // min片方のみ（maxは空文字→NaN）
    const minOnly = CO.computeAxisSpec({
        ...base, yRanges: { Speed: { min: '0', max: '' } },
        assignedNames: ['Speed'], preferredRepresentative: 'Speed', axisOrder: 0,
    });
    assert.equal(minOnly.hasYMin, true);
    assert.equal(minOnly.hasYMax, false);
}

// 数値フォーマッタ: X軸は整数/小数1桁、Y軸はM/k/小数/指数
function testFormatters() {
    assert.equal(CO.formatXAxisValue(300), '300');
    assert.equal(CO.formatXAxisValue(300.25), '300.3');
    assert.equal(CO.formatYAxisValue(0), '0');
    assert.equal(CO.formatYAxisValue(2500000), '2.5M');
    assert.equal(CO.formatYAxisValue(-1500), '-1.5k');
    assert.equal(CO.formatYAxisValue(12.34), '12.3');
    assert.equal(CO.formatYAxisValue(0.0567), '0.057');
    assert.equal(CO.formatYAxisValue(0.0012), '1.2e-3');
}

// X軸オプション: 最下段だけラベル・目盛りを表示
function testXAxisOption() {
    const last = CO.buildXAxisOption({ gridIndex: 2, isLast: true, min: 0, max: 1180, fontSize: 10, theme: THEME });
    assert.equal(last.gridIndex, 2);
    assert.equal(last.type, 'value');
    assert.equal(last.axisLabel.show, true);
    assert.equal(last.axisTick.show, true);
    assert.equal(last.min, 0);
    assert.equal(last.max, 1180);
    assert.equal(last.axisLabel.formatter(1.25), '1.3');
    const mid = CO.buildXAxisOption({ gridIndex: 0, isLast: false, min: 0, max: 1, fontSize: 10, theme: THEME });
    assert.equal(mid.axisLabel.show, false);
    assert.equal(mid.axisTick.show, false);
    assert.equal(mid.splitLine.show, true);
}

// Y軸オプション: 軸名の結合・単位表記・min/max・scale・splitLineは先頭軸のみ
function testYAxisOption() {
    const spec = { yMinParsed: 10, yMaxParsed: 50, hasYMin: true, hasYMax: true, position: 'left', offset: 0 };
    const y = CO.buildYAxisOption({
        gridIndex: 1, axisSpec: spec, assignedNames: ['Speed', 'Target'], units: 'km/h',
        axisOrder: 0, nameGap: 44, nameFontSize: 13, labelFontSize: 10, labelWidth: 40,
        nameTruncateMaxWidth: 162, theme: THEME,
    });
    assert.equal(y.name, 'Speed / Target  (km/h)');
    assert.equal(y.min, 10);
    assert.equal(y.max, 50);
    assert.equal(y.scale, false);
    assert.equal(y.position, 'left');
    assert.equal(y.splitLine.show, true);
    assert.deepEqual(y.nameTruncate, { maxWidth: 162, ellipsis: '…' });

    // Y範囲なし・単位なし・2本目の軸
    const spec2 = { yMinParsed: NaN, yMaxParsed: NaN, hasYMin: false, hasYMax: false, position: 'right', offset: 60 };
    const y2 = CO.buildYAxisOption({
        gridIndex: 0, axisSpec: spec2, assignedNames: ['RPM'], units: '',
        axisOrder: 1, nameGap: 44, nameFontSize: 13, labelFontSize: 10, labelWidth: 40,
        nameTruncateMaxWidth: 100, theme: THEME,
    });
    assert.equal(y2.name, 'RPM');
    assert.equal(y2.min, undefined);
    assert.equal(y2.max, undefined);
    assert.equal(y2.scale, true);
    assert.equal(y2.offset, 60);
    assert.equal(y2.splitLine.show, false);
}

// markArea: max側のみ / min側のみ / 両方 / なし
function testMarkArea() {
    const far = (v) => v * C.MARK_AREA_FAR_SCALE + C.MARK_AREA_FAR_OFFSET;

    const both = CO.buildMarkArea({ hasYMin: true, hasYMax: true, yMinParsed: 10, yMaxParsed: 50 });
    assert.equal(both.data.length, 2);
    assert.deepEqual(both.data[0], [{ yAxis: 50 }, { yAxis: far(50) }]);
    assert.deepEqual(both.data[1], [{ yAxis: -far(10) }, { yAxis: 10 }]);
    assert.equal(both.silent, true);

    const maxOnly = CO.buildMarkArea({ hasYMin: false, hasYMax: true, yMinParsed: NaN, yMaxParsed: 100 });
    assert.equal(maxOnly.data.length, 1);
    assert.deepEqual(maxOnly.data[0], [{ yAxis: 100 }, { yAxis: far(100) }]);

    const minOnly = CO.buildMarkArea({ hasYMin: true, hasYMax: false, yMinParsed: -20, yMaxParsed: NaN });
    assert.equal(minOnly.data.length, 1);
    // 負のminでも絶対値で「無限遠」を計算する
    assert.deepEqual(minOnly.data[0], [{ yAxis: -far(20) }, { yAxis: -20 }]);

    assert.equal(CO.buildMarkArea({ hasYMin: false, hasYMax: false }), undefined);
}

// markLine: 境界線とラベル（▲max ▼min、フォントは数値ラベル-1）
function testMarkLine() {
    const ml = CO.buildMarkLine({ hasYMin: true, hasYMax: true, yMinParsed: 10, yMaxParsed: 50 }, 10);
    assert.equal(ml.data.length, 2);
    assert.equal(ml.data[0].yAxis, 50);
    assert.equal(ml.data[0].label.formatter, '▲ 50');
    assert.equal(ml.data[0].label.fontSize, 9);
    assert.equal(ml.data[1].yAxis, 10);
    assert.equal(ml.data[1].label.formatter, '▼ 10');
    assert.equal(ml.symbol, 'none');

    const maxOnly = CO.buildMarkLine({ hasYMin: false, hasYMax: true, yMinParsed: NaN, yMaxParsed: 5 }, 12);
    assert.equal(maxOnly.data.length, 1);
    assert.equal(maxOnly.data[0].label.formatter, '▲ 5');

    assert.equal(CO.buildMarkLine({ hasYMin: false, hasYMax: false }, 10), undefined);
}

// シリーズオプション: メイン実線/サブ破線、markArea/markLineは軸の最初のシリーズのみ
function testSeriesOption() {
    const data = [[0, 1], [1, 2]];
    const spec = { yMinParsed: 10, yMaxParsed: 50, hasYMin: true, hasYMax: true, position: 'left', offset: 0 };
    const main = CO.buildSeriesOption(
        { id: 'c1', label: 'Speed [A]', color: '#60a5fa', dash: false, data, channelName: 'Speed', axisId: 'ax1' },
        { xAxisIndex: 0, yAxisIndex: 0, isFirstForAxis: true, axisSpec: spec,
          showMarkers: false, sampling: false, lineWidth: 1, labelFontSize: 10 });
    assert.equal(main.id, 'c1');
    assert.equal(main.name, 'Speed [A]');
    assert.equal(main.type, 'line');
    assert.equal(main.lineStyle.type, 'solid');
    assert.equal(main.lineStyle.width, 1);
    assert.equal(main.itemStyle.color, '#60a5fa');
    assert.equal(main.showSymbol, false);
    assert.equal(main.symbolSize, C.MARKER_SYMBOL_SIZE);
    assert.equal(main.progressive, C.SERIES_PROGRESSIVE);
    assert.equal(main.progressiveThreshold, C.SERIES_PROGRESSIVE_THRESHOLD);
    assert.equal(main.clip, true);
    assert.equal(main.emphasis.disabled, true);
    assert.ok(main.markArea, '最初のシリーズにはmarkAreaが付く');
    assert.ok(main.markLine, '最初のシリーズにはmarkLineが付く');
    assert.equal(main.data, data); // データ配列は参照のまま（コピーしない）

    // 同じ軸の2本目（サブ破線）にはmarkArea/markLineが付かない
    const sub = CO.buildSeriesOption(
        { id: 'c2', label: 'Speed [B]', color: '#f87171', dash: true, data, channelName: 'Speed', axisId: 'ax1' },
        { xAxisIndex: 0, yAxisIndex: 0, isFirstForAxis: false, axisSpec: spec,
          showMarkers: true, sampling: 'lttb', lineWidth: 2.5, labelFontSize: 10 });
    assert.deepEqual(sub.lineStyle.type, [6, 4]);
    assert.equal(sub.lineStyle.width, 2.5);
    assert.equal(sub.showSymbol, true);
    assert.equal(sub.sampling, 'lttb');
    assert.equal('markArea' in sub, false);
    assert.equal('markLine' in sub, false);

    // Y範囲なしなら最初のシリーズでもmarkArea/markLineなし
    const plainSpec = { yMinParsed: NaN, yMaxParsed: NaN, hasYMin: false, hasYMax: false, position: 'left', offset: 0 };
    const plain = CO.buildSeriesOption(
        { id: 'c3', label: 'X', color: '#fff', dash: false, data, channelName: 'X', axisId: 'ax2' },
        { xAxisIndex: 1, yAxisIndex: 1, isFirstForAxis: true, axisSpec: plainSpec,
          showMarkers: false, sampling: false, lineWidth: 1, labelFontSize: 10 });
    assert.equal('markArea' in plain, false);
    assert.equal('markLine' in plain, false);
}

// ベースオプション: 静的なチャート共通設定。formatterは含まない（呼び出し側が注入）
function testBaseChartOption() {
    const base = CO.buildBaseChartOption();
    assert.equal(base.animation, false);
    assert.equal(base.backgroundColor, 'transparent');
    assert.equal(base.legend.show, false);
    assert.deepEqual(base.axisPointer.link, [{ xAxisIndex: 'all' }]);
    assert.equal(base.tooltip.trigger, 'axis');
    assert.equal(base.tooltip.confine, true);
    assert.equal('formatter' in base.tooltip, false);
    assert.equal(base.brush.brushLink, 'all');
    assert.equal(base.brush.throttleDelay, 80);
    // 呼び出しごとに新しいオブジェクト（呼び出し側のformatter注入が漏れない）
    assert.notEqual(CO.buildBaseChartOption().tooltip, base.tooltip);
}

testConstants();
testBaseChartOption();
testGridWeights();
testGlobalXRange();
testGroupLayouts();
testSliderBounds();
testNarrowWarningKey();
testXDataZooms();
testYSliderZoom();
testComputeAxisSpec();
testFormatters();
testXAxisOption();
testYAxisOption();
testMarkArea();
testMarkLine();
testSeriesOption();

console.log('chart-options-utils tests passed');
