// history-utils.js(Undo/Redo統合履歴)の単体テスト。
// 実行: node tests/history-utils.test.js
'use strict';

const assert = require('node:assert/strict');
const CSVHistory = require('../history-utils.js');

// テスト用のエントリを手軽に作るヘルパー
function entry(settings, zoom, ts = 0, coalesceKey = null) {
    return CSVHistory.makeEntry(settings, zoom, ts, coalesceKey);
}

const Z = { start: 0, end: 100 }; // 全範囲ズーム

// push→undo→redoの基本往復とcanUndo/canRedoの境界
function testBasicUndoRedo() {
    const h = CSVHistory.createHistory();
    assert.equal(CSVHistory.canUndo(h), false);
    assert.equal(CSVHistory.undo(h), null);

    assert.equal(CSVHistory.push(h, entry({ a: 1 }, Z, 1)), 'pushed'); // 起点
    assert.equal(CSVHistory.canUndo(h), false); // 起点だけではUndoできない
    assert.equal(CSVHistory.push(h, entry({ a: 2 }, Z, 2)), 'pushed');
    assert.equal(CSVHistory.canUndo(h), true);
    assert.equal(CSVHistory.canRedo(h), false);

    const back = CSVHistory.undo(h);
    assert.deepEqual(back.settings, { a: 1 });
    assert.equal(CSVHistory.canUndo(h), false);
    assert.equal(CSVHistory.canRedo(h), true);

    const fwd = CSVHistory.redo(h);
    assert.deepEqual(fwd.settings, { a: 2 });
    assert.equal(CSVHistory.canRedo(h), false);
    assert.equal(CSVHistory.redo(h), null);
}

// 設定もズームも同じなら積まれないこと(sidebarWidthだけの違いは無視される=normalize検証)
function testSkipDuplicates() {
    const h = CSVHistory.createHistory();
    CSVHistory.push(h, entry({ a: 1, sidebarWidth: 300 }, Z, 1));
    // sidebarWidthだけ違う → 履歴的には同一とみなしskipped
    assert.equal(CSVHistory.push(h, entry({ a: 1, sidebarWidth: 999 }, Z, 2)), 'skipped');
    // 完全に同じ → skipped
    assert.equal(CSVHistory.push(h, entry({ a: 1 }, Z, 3)), 'skipped');
    assert.equal(h.entries.length, 1);
}

// ズーム差の境界: ZOOM_EPS未満はskipped、以上はpushed
function testZoomEps() {
    const h = CSVHistory.createHistory();
    CSVHistory.push(h, entry({ a: 1 }, { start: 10, end: 90 }, 1));
    assert.equal(CSVHistory.push(h, entry({ a: 1 }, { start: 10.0005, end: 90 }, 2)), 'skipped');
    assert.equal(CSVHistory.push(h, entry({ a: 1 }, { start: 15, end: 90 }, 3)), 'pushed');
    assert.equal(h.entries.length, 2);
}

// Undoで戻った後に新しい操作をしたら、Redo側の履歴が切り捨てられること
function testRedoTruncation() {
    const h = CSVHistory.createHistory();
    CSVHistory.push(h, entry({ a: 1 }, Z, 1));
    CSVHistory.push(h, entry({ a: 2 }, Z, 2));
    CSVHistory.push(h, entry({ a: 3 }, Z, 3));
    CSVHistory.undo(h); // a:2 へ
    CSVHistory.undo(h); // a:1 へ
    assert.equal(CSVHistory.push(h, entry({ a: 99 }, Z, 4)), 'pushed');
    assert.equal(h.entries.length, 2); // a:1, a:99(a:2, a:3は消えた)
    assert.equal(CSVHistory.canRedo(h), false);
    assert.deepEqual(h.entries[1].settings, { a: 99 });
}

// coalesce: 同じキーかつCOALESCE_MS以内なら直前を置換、キーnullや時間超過は通常push
function testCoalesce() {
    const h = CSVHistory.createHistory();
    CSVHistory.push(h, entry({ color: 'red' }, Z, 1000));
    // 同キー・1000ms以内 → 置換
    assert.equal(CSVHistory.push(h, entry({ color: 'blue' }, Z, 1500, 'fileColor:f1')), 'pushed');
    assert.equal(CSVHistory.push(h, entry({ color: 'green' }, Z, 1900, 'fileColor:f1')), 'coalesced');
    assert.equal(h.entries.length, 2);
    assert.deepEqual(h.entries[1].settings, { color: 'green' });
    // 時間超過(COALESCE_MS以上経過) → 通常push
    assert.equal(CSVHistory.push(h, entry({ color: 'black' }, Z, 1900 + CSVHistory.COALESCE_MS, 'fileColor:f1')), 'pushed');
    // キーnull → 通常push
    assert.equal(CSVHistory.push(h, entry({ color: 'white' }, Z, 3000, null)), 'pushed');
    assert.equal(h.entries.length, 4);
}

// 上限超過で最古が捨てられ、idxが整合すること
function testMaxLimit() {
    const h = CSVHistory.createHistory(3);
    CSVHistory.push(h, entry({ a: 1 }, Z, 1));
    CSVHistory.push(h, entry({ a: 2 }, Z, 2));
    CSVHistory.push(h, entry({ a: 3 }, Z, 3));
    CSVHistory.push(h, entry({ a: 4 }, Z, 4));
    assert.equal(h.entries.length, 3);
    assert.deepEqual(h.entries[0].settings, { a: 2 }); // a:1が捨てられた
    assert.equal(h.idx, 2); // 末尾を指している
    assert.deepEqual(h.entries[h.idx].settings, { a: 4 });
}

// normalizeSettings / makeEntry が入力オブジェクトを破壊しないこと
function testInputNotMutated() {
    const input = { a: 1, sidebarWidth: 300 };
    const zoom = { start: 0, end: 100 };
    CSVHistory.makeEntry(input, zoom, 1);
    assert.deepEqual(input, { a: 1, sidebarWidth: 300 });
    assert.deepEqual(zoom, { start: 0, end: 100 });
    const normalized = CSVHistory.normalizeSettings(input);
    assert.equal(normalized.sidebarWidth, undefined);
    assert.equal(input.sidebarWidth, 300);
}

// エントリのsettingsが入力からdeep copyされていること
// (ネストしたオブジェクトを後から書き換えても過去のエントリが変わらない)
function testDeepCopyIsolation() {
    const live = { yRanges: { ChA: { min: 0, max: 10 } } };
    const e = entry(live, Z, 1);
    live.yRanges.ChA.min = -999; // アプリ側でstateが書き換わったと想定
    assert.equal(e.settings.yRanges.ChA.min, 0); // 履歴エントリは影響を受けない
}

// reset で空に戻ること
function testReset() {
    const h = CSVHistory.createHistory();
    CSVHistory.push(h, entry({ a: 1 }, Z, 1));
    CSVHistory.push(h, entry({ a: 2 }, Z, 2));
    CSVHistory.reset(h);
    assert.equal(h.entries.length, 0);
    assert.equal(h.idx, -1);
    assert.equal(CSVHistory.canUndo(h), false);
    assert.equal(CSVHistory.canRedo(h), false);
}

testBasicUndoRedo();
testSkipDuplicates();
testZoomEps();
testRedoTruncation();
testCoalesce();
testMaxLimit();
testInputNotMutated();
testDeepCopyIsolation();
testReset();

console.log('history-utils tests passed');
