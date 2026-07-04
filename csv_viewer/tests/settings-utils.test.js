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
        _version: CSVSettings.SETTINGS_VERSION,
        selectedNames: 'broken',   // 配列であるべき → 削除
        yRanges: [],               // オブジェクトであるべき → 削除
        channelAliases: { A: ['B'] }, // 正常 → 残る
        customModes: 'broken',        // 配列であるべき → 削除
        sidebarWidth: 320,            // 検証対象外のキー → そのまま
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'current');
    assert.equal(result.settings.selectedNames, undefined);
    assert.equal(result.settings.yRanges, undefined);
    assert.equal(result.settings.customModes, undefined);
    assert.deepEqual(result.settings.channelAliases, { A: ['B'] });
    assert.equal(result.settings.sidebarWidth, 320);
}

// v3以前のドライビングインデックスのサイクルIDが現行IDへ読み替えられること
function testDriveIndexCycleIdMigrated() {
    const r1 = CSVSettings.migrateSettings({ _version: 3, driveIndex: { cycleId: 'wltc3', channels: {} } });
    assert.equal(r1.ok, true);
    assert.equal(r1.settings.driveIndex.cycleId, 'wltc3b_4');   // 旧 WLTC 4-phase → 3b 4フェーズ
    assert.deepEqual(r1.settings.driveIndex.channels, {});      // 他のキーは保持

    const r2 = CSVSettings.migrateSettings({ _version: 3, driveIndex: { cycleId: 'mdc' } });
    assert.equal(r2.settings.driveIndex.cycleId, null);         // 内蔵廃止MDC → 自動判別

    // 現行IDはそのまま
    const r3 = CSVSettings.migrateSettings({ _version: CSVSettings.SETTINGS_VERSION, driveIndex: { cycleId: 'nedc' } });
    assert.equal(r3.settings.driveIndex.cycleId, 'nedc');
}

// 旧サイクルIDの読み替えが単一情報源(DriveIndex.LEGACY_CYCLE_ID)と一致すること。
// settings-utilsは同マップを直接参照する設計なので、このテストは参照配線の退行
// （二重定義への逆戻り・マップ変更漏れ）を検知する
function testLegacyCycleIdConsistency() {
    const DriveIndex = require('../drive-index-utils.js');
    const entries = Object.entries(DriveIndex.LEGACY_CYCLE_ID);
    assert.ok(entries.length > 0, 'LEGACY_CYCLE_IDが空');
    for (const [oldId, newId] of entries) {
        const r = CSVSettings.migrateSettings({ _version: 3, driveIndex: { cycleId: oldId } });
        assert.equal(r.ok, true);
        assert.equal(
            r.settings.driveIndex.cycleId, newId,
            `旧ID '${oldId}' は '${newId}' へ読み替えられるべき`
        );
    }
}

// 入力オブジェクトを破壊しないこと(コピーして返す)
function testInputNotMutated() {
    const input = { selectedNames: 'broken' };
    CSVSettings.migrateSettings(input);
    assert.equal(input.selectedNames, 'broken');
    assert.equal(input._version, undefined);
}

// サイドバー折りたたみ状態(sidebarCollapsed, v5で追加)のマイグレーション
function testSidebarCollapsedMigration() {
    // v4(sidebarCollapsedなし)は現行バージョンへ引き上げられること
    const fromV4 = CSVSettings.migrateSettings({ _version: 4, selectedNames: ['A'] });
    assert.equal(fromV4.ok, true);
    assert.equal(fromV4.reason, 'migrated');
    assert.equal(fromV4.settings._version, CSVSettings.SETTINGS_VERSION);

    // オブジェクトであるべきsidebarCollapsedが壊れた型なら削除されること
    const broken = CSVSettings.migrateSettings({
        _version: CSVSettings.SETTINGS_VERSION,
        sidebarCollapsed: 'broken',
    });
    assert.equal(broken.ok, true);
    assert.equal(broken.settings.sidebarCollapsed, undefined);

    // 正常なsidebarCollapsedはそのまま残ること
    const ok = CSVSettings.migrateSettings({
        _version: CSVSettings.SETTINGS_VERSION,
        sidebarCollapsed: { files: true, channels: false },
    });
    assert.equal(ok.reason, 'current');
    assert.deepEqual(ok.settings.sidebarCollapsed, { files: true, channels: false });
}

testInvalidInput();
testNewerVersionRejected();
testOldFormatMigrated();
testBrokenKeysDropped();
testDriveIndexCycleIdMigrated();
testLegacyCycleIdConsistency();
testInputNotMutated();
testSidebarCollapsedMigration();

console.log('settings-utils tests passed');
