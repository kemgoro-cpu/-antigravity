// xy-utils.js（XYプロット向けの回帰・等高線マップ純粋関数）の単体テスト。
// 実行: node tests/xy-utils.test.js
'use strict';

const assert = require('node:assert/strict');
const CSVXYUtils = require('../xy-utils.js');

// 完全な正の相関: y = 2x + 1 → slope=2, intercept=1, r=1
function testLinearRegressionPerfectPositive() {
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map(x => 2 * x + 1);
    const result = CSVXYUtils.linearRegression(xs, ys);
    assert.ok(result);
    assert.ok(Math.abs(result.slope - 2) < 1e-9);
    assert.ok(Math.abs(result.intercept - 1) < 1e-9);
    assert.ok(Math.abs(result.r - 1) < 1e-9);
    assert.ok(Math.abs(result.r2 - 1) < 1e-9);
    assert.equal(result.n, 5);
}

// 完全な負の相関: y = -x + 10 → r=-1
function testLinearRegressionPerfectNegative() {
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map(x => -x + 10);
    const result = CSVXYUtils.linearRegression(xs, ys);
    assert.ok(result);
    assert.ok(Math.abs(result.slope - (-1)) < 1e-9);
    assert.ok(Math.abs(result.r - (-1)) < 1e-9);
}

// NaNを含むペアはスキップされ、有効なペアだけで回帰されること
function testLinearRegressionSkipsNaN() {
    const xs = [0, 1, NaN, 3, 4];
    const ys = [1, 3, 999, 7, 9]; // y = 2x+1（NaN行のyは無関係な値）
    const result = CSVXYUtils.linearRegression(xs, ys);
    assert.ok(result);
    assert.equal(result.n, 4); // 5組中1組（NaN）を除いた4組
    assert.ok(Math.abs(result.slope - 2) < 1e-9);
    assert.ok(Math.abs(result.intercept - 1) < 1e-9);
}

// xが定数（すべて同じ値）のときは傾きが不定なのでnullを返すこと
function testLinearRegressionConstantXReturnsNull() {
    const xs = [5, 5, 5, 5];
    const ys = [1, 2, 3, 4];
    assert.equal(CSVXYUtils.linearRegression(xs, ys), null);
}

// 有効なペアが2未満のときはnullを返すこと
function testLinearRegressionTooFewPointsReturnsNull() {
    assert.equal(CSVXYUtils.linearRegression([1], [2]), null);
    assert.equal(CSVXYUtils.linearRegression([], []), null);
    // NaN除去後に1組しか残らない場合もnull
    assert.equal(CSVXYUtils.linearRegression([1, NaN], [2, 3]), null);
}

testLinearRegressionPerfectPositive();
testLinearRegressionPerfectNegative();
testLinearRegressionSkipsNaN();
testLinearRegressionConstantXReturnsNull();
testLinearRegressionTooFewPointsReturnsNull();

// ─────────────────────────────────────────────────────────────
// parseContourMap
// ─────────────────────────────────────────────────────────────

// マトリクス形式（コーナーラベル付き）: 先頭行=X breakpoints、先頭列=Y breakpoints
function testParseContourMapMatrix() {
    const rows = [
        ['map',  1000, 2000, 3000, 4000],
        [1000,   10,   20,   30,   40],
        [2000,   15,   25,   35,   45],
        [3000,   20,   30,   40,   50],
    ];
    const r = CSVXYUtils.parseContourMap(rows);
    assert.ok(r.ok);
    assert.equal(r.format, 'matrix');
    assert.deepEqual(r.xs, [1000, 2000, 3000, 4000]);
    assert.deepEqual(r.ys, [1000, 2000, 3000]);
    assert.deepEqual(r.zz, [[10, 20, 30, 40], [15, 25, 35, 45], [20, 30, 40, 50]]);
    assert.equal(r.zmin, 10);
    assert.equal(r.zmax, 50);
}

// ロング形式（ヘッダーあり）: x, y, z の3列
function testParseContourMapLongWithHeader() {
    const rows = [['x', 'y', 'z'], [0, 0, 1], [0, 1, 2], [1, 0, 3], [1, 1, 4]];
    const r = CSVXYUtils.parseContourMap(rows);
    assert.ok(r.ok);
    assert.equal(r.format, 'long');
    assert.deepEqual(r.xs, [0, 1]);
    assert.deepEqual(r.ys, [0, 1]);
    assert.deepEqual(r.zz, [[1, 3], [2, 4]]); // zz[yi][xi]
}

// ロング形式（ヘッダーなし）: 先頭行も数値データとして扱われること
function testParseContourMapLongWithoutHeader() {
    const rows = [[0, 0, 1], [0, 1, 2], [1, 0, 3], [1, 1, 4]];
    const r = CSVXYUtils.parseContourMap(rows);
    assert.ok(r.ok);
    assert.equal(r.format, 'long');
    assert.deepEqual(r.zz, [[1, 3], [2, 4]]);
}

// 欠損セルはNaNになること（マトリクス形式の空セル）
function testParseContourMapHoleBecomesNaN() {
    const rows = [
        ['map', 1, 2, 3],
        [1,     10, '', 30],
        [2,     40, 50, 60],
    ];
    const r = CSVXYUtils.parseContourMap(rows);
    assert.ok(r.ok);
    assert.ok(Number.isNaN(r.zz[0][1]));
    assert.equal(r.zmin, 10);
    assert.equal(r.zmax, 60);
}

// ゴミデータ（数値化できない）はok:falseになること
function testParseContourMapGarbageReturnsNotOk() {
    const rows = [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']];
    const r = CSVXYUtils.parseContourMap(rows);
    assert.equal(r.ok, false);
}

// breakpointsが非単調（昇順でも降順でもない）ならok:falseになること
function testParseContourMapNonMonotonicReturnsNotOk() {
    const rows = [
        ['map', 1, 3, 2], // Xが1→3→2で非単調
        [1, 10, 20, 30],
        [2, 40, 50, 60],
    ];
    const r = CSVXYUtils.parseContourMap(rows);
    assert.equal(r.ok, false);
}

testParseContourMapMatrix();
testParseContourMapLongWithHeader();
testParseContourMapLongWithoutHeader();
testParseContourMapHoleBecomesNaN();
testParseContourMapGarbageReturnsNotOk();
testParseContourMapNonMonotonicReturnsNotOk();

// ─────────────────────────────────────────────────────────────
// niceLevels
// ─────────────────────────────────────────────────────────────

function testNiceLevelsRangeAndStep() {
    const levels = CSVXYUtils.niceLevels(0, 97, 10);
    assert.ok(levels.length > 0);
    // 全レベルが範囲内
    for (const v of levels) {
        assert.ok(v >= 0 - 1e-9 && v <= 97 + 1e-9);
    }
    // 刻みが1/2/5×10^kのいずれかで、全区間一定
    const step = levels.length > 1 ? levels[1] - levels[0] : null;
    if (step !== null) {
        for (let i = 1; i < levels.length; i++) {
            assert.ok(Math.abs((levels[i] - levels[i - 1]) - step) < 1e-9);
        }
        const mag = Math.pow(10, Math.floor(Math.log10(step)));
        const mantissa = Math.round(step / mag);
        assert.ok([1, 2, 5, 10].includes(mantissa));
    }
    // 個数がtarget(10)の近傍であること
    assert.ok(levels.length >= 5 && levels.length <= 15);
}

// 範囲が不正（zmin>=zmaxや非有限）なら空配列
function testNiceLevelsInvalidRange() {
    assert.deepEqual(CSVXYUtils.niceLevels(5, 5, 10), []);
    assert.deepEqual(CSVXYUtils.niceLevels(10, 5, 10), []);
    assert.deepEqual(CSVXYUtils.niceLevels(NaN, 10, 10), []);
}

testNiceLevelsRangeAndStep();
testNiceLevelsInvalidRange();

// ─────────────────────────────────────────────────────────────
// computeIsoSegments
// ─────────────────────────────────────────────────────────────

// 2×2の基本交差ケース: zがyだけに依存する単純な格子で、level=5の等高線がy=0.5の水平線になること
function testComputeIsoSegmentsBasicCase() {
    const xs = [0, 1], ys = [0, 1];
    const zz = [[0, 0], [10, 10]]; // zz[0]=y=0行(z=0), zz[1]=y=1行(z=10)
    const segs = CSVXYUtils.computeIsoSegments(xs, ys, zz, 5);
    assert.equal(segs.length, 1);
    const [p1, p2] = segs[0];
    assert.ok(Math.abs(p1[1] - 0.5) < 1e-9);
    assert.ok(Math.abs(p2[1] - 0.5) < 1e-9);
    const xsOfSeg = [p1[0], p2[0]].sort((a, b) => a - b);
    assert.ok(Math.abs(xsOfSeg[0] - 0) < 1e-9);
    assert.ok(Math.abs(xsOfSeg[1] - 1) < 1e-9);
}

// 放射状バンプグリッド: 全線分の全端点で、bilinearZによる読み値がlevelと一致すること（±1e-9）
function testComputeIsoSegmentsRadialBumpEndpointsMatchLevel() {
    const xs = [-2, -1, 0, 1, 2];
    const ys = [-2, -1, 0, 1, 2];
    const zz = ys.map(y => xs.map(x => 10 - (x * x + y * y))); // 中心が高い放射状の山
    const level = 8;
    const segs = CSVXYUtils.computeIsoSegments(xs, ys, zz, level);
    assert.ok(segs.length > 0);
    for (const [p1, p2] of segs) {
        for (const [x, y] of [p1, p2]) {
            const z = CSVXYUtils.bilinearZ(xs, ys, zz, x, y);
            assert.ok(Math.abs(z - level) < 1e-9, `endpoint (${x},${y}) -> z=${z}, expected ${level}`);
        }
    }
}

// NaNを含むセルは線分を生成しないこと
function testComputeIsoSegmentsNaNCellSkipped() {
    const xs = [0, 1], ys = [0, 1];
    const zz = [[0, NaN], [10, 10]];
    const segs = CSVXYUtils.computeIsoSegments(xs, ys, zz, 5);
    assert.equal(segs.length, 0);
}

// データ範囲外のlevelは空配列になること
function testComputeIsoSegmentsOutOfRangeLevel() {
    const xs = [0, 1], ys = [0, 1];
    const zz = [[0, 0], [10, 10]];
    assert.deepEqual(CSVXYUtils.computeIsoSegments(xs, ys, zz, 100), []);
    assert.deepEqual(CSVXYUtils.computeIsoSegments(xs, ys, zz, -100), []);
}

testComputeIsoSegmentsBasicCase();
testComputeIsoSegmentsRadialBumpEndpointsMatchLevel();
testComputeIsoSegmentsNaNCellSkipped();
testComputeIsoSegmentsOutOfRangeLevel();

// ─────────────────────────────────────────────────────────────
// bilinearZ
// ─────────────────────────────────────────────────────────────

function testBilinearZ() {
    const xs = [0, 2], ys = [0, 2];
    const zz = [[0, 4], [8, 12]]; // z = 2x + 4y（厳密に双線形）
    assert.ok(Math.abs(CSVXYUtils.bilinearZ(xs, ys, zz, 1, 1) - 6) < 1e-9);
    assert.ok(Math.abs(CSVXYUtils.bilinearZ(xs, ys, zz, 0, 0) - 0) < 1e-9);
    assert.ok(Number.isNaN(CSVXYUtils.bilinearZ(xs, ys, zz, -1, 0))); // 範囲外
    assert.ok(Number.isNaN(CSVXYUtils.bilinearZ(xs, ys, zz, 5, 5))); // 範囲外

    const zzWithHole = [[0, 4], [NaN, 12]];
    assert.ok(Number.isNaN(CSVXYUtils.bilinearZ(xs, ys, zzWithHole, 1, 1))); // 隅にNaN
}

testBilinearZ();

// Detailed contours preserve the entire value range and original gap topology.
function testPrepareContoursLevelsAndLimits() {
    const map = { xs: [0, 1], ys: [0, 1], zz: [[230, 230], [247, 247]] };
    const original = structuredClone(map);
    const exact = CSVXYUtils.prepareContours(map, { min: 230, max: 247, step: 2 });
    assert.equal(exact.ok, true);
    assert.deepEqual(exact.levels.map(level => level.value), [230, 232, 234, 236, 238, 240, 242, 244, 246], 'The high-value contour must not be silently sliced off');
    assert.equal(exact.adjusted, false);
    assert.equal(exact.step, 2);
    assert.equal(exact.segmentCount, 8);
    assert.deepEqual(map, original, 'Contour preparation must not modify source axes or values');

    const capped = CSVXYUtils.prepareContours(map, { min: 230, max: 247, step: 0.01, maxLevels: 8 });
    assert.equal(capped.ok, true);
    assert.equal(capped.adjusted, true);
    assert.ok(capped.levels.length <= 8);
    assert.ok(Math.abs(capped.step / 0.01 - Math.round(capped.step / 0.01)) < 1e-9, 'Adjusted interval remains an integer multiple of the requested interval');
    assert.ok(capped.levels[0].value - 230 < capped.step + 1e-9);
    assert.ok(247 - capped.levels.at(-1).value < capped.step + 1e-9, 'The sparse levels cover the high-value end too');
    assert.match(capped.reason, /調整/);

    const gridLimit = CSVXYUtils.prepareContours(map, { step: 2, maxCells: 3 });
    assert.equal(gridLimit.ok, false); assert.deepEqual(gridLimit.levels, []); assert.match(gridLimit.reason, /格子/);
    const segmentLimit = CSVXYUtils.prepareContours(map, { step: 2, maxSegments: 3 });
    assert.equal(segmentLimit.ok, false); assert.deepEqual(segmentLimit.levels, []); assert.equal(segmentLimit.segmentCount, 0); assert.match(segmentLimit.reason, /線分/);
    for (const step of [0, -1, NaN, Infinity]) {
        const invalid = CSVXYUtils.prepareContours(map, { step });
        assert.equal(invalid.ok, false); assert.deepEqual(invalid.levels, []); assert.match(invalid.reason, /間隔/);
    }
    for (const options of [{ min: 250, max: 230 }, { min: NaN }, { max: Infinity }, { maxLevels: 1 }, { maxSegments: 1.5 }, { maxCells: -1 }]) {
        assert.equal(CSVXYUtils.prepareContours(map, { step: 2, ...options }).ok, false);
    }
    assert.equal(CSVXYUtils.prepareContours({ ...map, xs: [1, 1] }, { step: 2 }).ok, false);
    assert.equal(CSVXYUtils.prepareContours({ ...map, zz: [[230], [247, 247]] }, { step: 2 }).ok, false);
    assert.equal(CSVXYUtils.prepareContours(map, { step: Number.MIN_VALUE }).ok, false, 'An extreme interval must fail without allocating or looping indefinitely');
}

function testPrepareContoursEmptyAndConstant() {
    const constant = { xs: [0, 1], ys: [0, 1], zz: [[250, 250], [250, 250]] };
    const result = CSVXYUtils.prepareContours(constant, { min: 200, max: 300, step: 5 });
    assert.equal(result.ok, true); assert.equal(result.segmentCount, 0); assert.deepEqual(result.levels, []); assert.match(result.reason, /一定値/);
    const limited = CSVXYUtils.prepareContours({ ...constant, zz: [[200, 200], [300, 300]] }, { min: 250, max: 250, step: 5 });
    assert.equal(limited.ok, true); assert.equal(limited.segmentCount, 0); assert.match(limited.reason, /一定値/);
    const singleAxis = CSVXYUtils.prepareContours({ xs: [0], ys: [0, 1], zz: [[200], [300]] }, { step: 5 });
    assert.equal(singleAxis.ok, true); assert.equal(singleAxis.segmentCount, 0); assert.match(singleAxis.reason, /2点/);
    const unavailable = CSVXYUtils.prepareContours({ ...constant, zz: [[200, NaN], [300, 300]] }, { step: 5 });
    assert.equal(unavailable.ok, true); assert.equal(unavailable.segmentCount, 0); assert.match(unavailable.reason, /欠損/);
    const outside = CSVXYUtils.prepareContours({ ...constant, zz: [[200, 200], [300, 300]] }, { min: 400, max: 500, step: 5 });
    assert.equal(outside.ok, true); assert.equal(outside.segmentCount, 0); assert.match(outside.reason, /描ける等高線がありません/);
}

function testContourPathTopology() {
    const chainMap = { xs: [0.1, 1.1], ys: [0.1, 1.1, 2.1], zz: [[0, 10], [1, 9], [2, 8]] };
    const segments = CSVXYUtils.computeIsoSegments(chainMap.xs, chainMap.ys, chainMap.zz, 2.7);
    const paths = CSVXYUtils.joinIsoSegments(segments);
    assert.equal(paths.length, 1, 'Opposite visits to a shared grid edge have identical intersection coordinates');
    assert.equal(paths[0].length, 3);
    assert.equal(paths[0][1][1], 1.1);
    assert.ok(Math.abs(CSVXYUtils.bilinearZ(chainMap.xs, chainMap.ys, chainMap.zz, ...paths[0][1]) - 2.7) < 1e-12);

    const holeMap = { xs: [0, 1, 2, 3, 4], ys: [0, 1], zz: [[0, 0, NaN, 0, 0], [10, 10, NaN, 10, 10]] };
    const hole = CSVXYUtils.prepareContours(holeMap, { step: 5 });
    const middle = hole.levels.find(level => level.value === 5);
    assert.equal(middle.paths.length, 2);
    assert.deepEqual(middle.paths.map(path => path.map(point => point[0]).sort()).sort(), [[0, 1], [3, 4]], 'Paths do not bridge the missing column');

    const ring = [[[1, 0], [0, 1]], [[0, -1], [1, 0]], [[-1, 0], [0, -1]], [[0, 1], [-1, 0]]];
    const original = structuredClone(ring);
    const closed = CSVXYUtils.joinIsoSegments(ring);
    assert.equal(closed.length, 1); assert.equal(closed[0].length, 5); assert.deepEqual(closed[0][0], closed[0].at(-1));
    assert.deepEqual(ring, original);
    assert.equal(CSVXYUtils.joinIsoSegments([[[0, 0], [1, 0]], [[1 + 1e-12, 0], [2, 0]]]).length, 2, 'A small real gap must not be rounded away');

    const saddle = CSVXYUtils.computeIsoSegments([0, 1], [0, 1], [[0, 10], [10, 0]], 5);
    assert.equal(CSVXYUtils.joinIsoSegments(saddle).length, 2, 'Saddle branches must not be joined through their interior');
    const branch = CSVXYUtils.joinIsoSegments([[[0, 0], [1, 0]], [[1, 0], [2, 1]], [[1, 0], [2, -1]]]);
    assert.equal(branch.length, 3, 'An ambiguous vertex splits paths rather than choosing a branch');
    assert.ok(branch.every(path => path.length === 2));
    assert.deepEqual(CSVXYUtils.joinIsoSegments([[[0, 0], [0, 0]]]), [], 'A zero-length point is not a contour line');
}

testPrepareContoursLevelsAndLimits();
testPrepareContoursEmptyAndConstant();
testContourPathTopology();

console.log('xy-utils tests passed');
