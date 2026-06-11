// layout-utils.js(フォントプリセット・グリッド高さ配分)の単体テスト。
// 実行: node tests/layout-utils.test.js
'use strict';

const assert = require('node:assert/strict');
const CSVLayout = require('../layout-utils.js');

const BASE = { topPx: 8, botPx: 68, gapPx: 6 };

// 自動フィット(rowHeightPx=null・上書きなし)が従来の重み配分と一致すること
function testAutoFitCompat() {
    const { heights, totalH } = CSVLayout.computeGridHeights({
        weights: [1, 1, 1],
        signatures: ['a', 'b', 'c'],
        overrides: {},
        rowHeightPx: null,
        containerH: 600,
        ...BASE,
    });
    // availH = 600 - 8 - 68 - 2*6 = 512 → 各 floor(512/3) = 170
    assert.deepEqual(heights, [170, 170, 170]);
    assert.equal(totalH, 600); // コンテナに収まる → totalHはコンテナ高さ
}

// rowHeightPx指定時: 各グリッド=基準×重み、合計がコンテナ超ならtotalHが伸びる
function testRowHeightPx() {
    const { heights, totalH } = CSVLayout.computeGridHeights({
        weights: [1, 1, 1, 1],
        signatures: ['a', 'b', 'c', 'd'],
        overrides: {},
        rowHeightPx: 200,
        containerH: 600,
        ...BASE,
    });
    assert.deepEqual(heights, [200, 200, 200, 200]);
    // 8 + 68 + 3*6 + 800 = 894 > 600
    assert.equal(totalH, 894);
}

// 個別上書きがrowHeightPxより優先されること
function testOverridePriority() {
    const { heights } = CSVLayout.computeGridHeights({
        weights: [1, 1],
        signatures: ['a', 'b'],
        overrides: { b: 300 },
        rowHeightPx: 100,
        containerH: 600,
        ...BASE,
    });
    assert.deepEqual(heights, [100, 300]);
}

// Bit重み(0.33)が基準高さに反映されること
function testBitWeight() {
    const { heights } = CSVLayout.computeGridHeights({
        weights: [1, 0.33],
        signatures: ['a', 'bit'],
        overrides: {},
        rowHeightPx: 200,
        containerH: 400,
        ...BASE,
    });
    assert.equal(heights[0], 200);
    assert.equal(heights[1], 66); // round(200*0.33)
}

// 最小/最大クランプ(手動指定時は40〜800px)
function testClamp() {
    const { heights } = CSVLayout.computeGridHeights({
        weights: [0.1, 1],
        signatures: ['a', 'b'],
        overrides: { b: 9999 },
        rowHeightPx: 100,
        containerH: 400,
        ...BASE,
    });
    assert.equal(heights[0], CSVLayout.MIN_GRID_H); // 100*0.1=10 → 40へ
    assert.equal(heights[1], CSVLayout.MAX_GRID_H); // 9999 → 800へ
}

// signatureがチャンネルの順序に依存しないこと
function testSignatureStable() {
    assert.equal(CSVLayout.gridSignature(['B', 'A']), CSVLayout.gridSignature(['A', 'B']));
    assert.equal(CSVLayout.gridSignature(['速度']), '速度');
}

// フォントプリセット: nameは常にlabelより大きく、サイズと派生レイアウトが単調増加
function testFontPresets() {
    const order = ['small', 'normal', 'large', 'xlarge'];
    let prevLabel = 0, prevGridLeft = 0;
    for (const scale of order) {
        const f = CSVLayout.getFontSizes(scale);
        assert.ok(f.name > f.label, `${scale}: nameはlabelより大きい`);
        assert.ok(f.label > prevLabel, `${scale}: labelが単調増加`);
        const d = CSVLayout.deriveLayout(f);
        assert.ok(d.gridLeft > prevGridLeft, `${scale}: gridLeftが単調増加`);
        assert.ok(d.nameGap > d.labelWidth, `${scale}: nameGapは数値ラベル幅より広い`);
        prevLabel = f.label;
        prevGridLeft = d.gridLeft;
    }
    // 未知のスケール名はnormal扱い
    assert.deepEqual(CSVLayout.getFontSizes('unknown'), CSVLayout.FONT_PRESETS.normal);
}

testAutoFitCompat();
testRowHeightPx();
testOverridePriority();
testBitWeight();
testClamp();
testSignatureStable();
testFontPresets();

console.log('layout-utils tests passed');
