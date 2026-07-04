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

console.log('xy-utils tests passed');
