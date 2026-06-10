// settings-utils.js(設定マイグレーション)の単体テスト。
// 実行: node tests/settings-utils.test.js
'use strict';

const assert = require('node:assert/strict');
const CSVSettings = require('../settings-utils.js');

// null・非オブジェクト・配列は ok:false で弾かれること
function testInvalidInput() {
    assert.deepEqual(CSVSettings.migrateSettings(null), { ok: false, reason: 'invalid', settings: null });
    assert.deepEqual(CSVSettings.migrateSettings('broken'), { ok: false, reason: 'invalid', settings: null });
    assert.deepEqual(CSVSettings.migrateSettings([1, 2]), { ok: false, reason: 'invalid', settings: null });
}

// 未来のバージョンは中途半端に適用せず読み込み拒否すること
function testNewerVersionRejected() {
    const result = CSVSettings.migrateSettings({ _version: 99, selectedNames: ['A'] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'newer');
    assert.equal(result.settings, null);
}

// _versionなしの旧形式(v1相当)は現行バージョンへ引き上げられること
function testOldFormatMigrated() {
    const result = CSVSettings.migrateSettings({
        mergedGroups: [['ChA', 'ChB']],
        selectedNames: ['ChA'],
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'migrated');
    assert.equal(result.settings._version, CSVSettings.SETTINGS_VERSION);
    // 旧形式のmergedGroupsはapp.js側のフォールバックが処理するためそのまま残ること
    assert.deepEqual(result.settings.mergedGroups, [['ChA', 'ChB']]);
}

// 型が壊れたキーだけ削除され、正常なキーは残ること
function testBrokenKeysDropped() {
    const result = CSVSettings.migrateSettings({
        _version: 3,
        selectedNames: 'broken',   // 配列であるべき → 削除
        yRanges: [],               // オブジェクトであるべき → 削除
        channelAliases: { A: ['B'] }, // 正常 → 残る
        sidebarWidth: 320,            // 検証対象外のキー → そのまま
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'current');
    assert.equal(result.settings.selectedNames, undefined);
    assert.equal(result.settings.yRanges, undefined);
    assert.deepEqual(result.settings.channelAliases, { A: ['B'] });
    assert.equal(result.settings.sidebarWidth, 320);
}

// 入力オブジェクトを破壊しないこと(コピーして返す)
function testInputNotMutated() {
    const input = { selectedNames: 'broken' };
    CSVSettings.migrateSettings(input);
    assert.equal(input.selectedNames, 'broken');
    assert.equal(input._version, undefined);
}

testInvalidInput();
testNewerVersionRejected();
testOldFormatMigrated();
testBrokenKeysDropped();
testInputNotMutated();

console.log('settings-utils tests passed');
