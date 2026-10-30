// 設定データ(localStorage / JSONエクスポート)のバージョンチェックとマイグレーション。
// 純粋関数として切り出すことでNodeから単体テストできる(tests/settings-utils.test.js)。
// parser-utils.jsと同じUMDパターン: ブラウザでは root.CSVSettings、Nodeでは module.exports。
(function (root) {
    'use strict';

    // 現行の設定スキーマバージョン(app.jsのsaveSettingsが書き込む値と一致させること)
    const SETTINGS_VERSION = 7;

    // 配列であるべきキー(違う型が入っていたら該当キーだけ捨てる)
    const ARRAY_KEYS = ['fileInfos', 'selectedNames', 'customRAMs', 'chartGroups', 'bitManualOff', 'mergedGroups', 'customModes'];

    // 旧ドライビングインデックスのサイクルID読み替えマップ（v3以前 → v4）。
    // 単一情報源は drive-index-utils.js の DriveIndex.LEGACY_CYCLE_ID（現在は 'wltc3' → 'wltc3b_4' のみ）。
    // マップに無いIDは読み替えず素通しする（'mdc' は内蔵へ復帰したため読み替え不要）。
    // index.html では settings-utils.js が drive-index-utils.js より先に読み込まれるため、
    // モジュール初期化時ではなく migrateSettings 実行時に遅延参照する。
    function getLegacyCycleIdMap() {
        if (typeof module !== 'undefined' && module.exports) {
            return require('./drive-index-utils.js').LEGACY_CYCLE_ID;
        }
        return root.DriveIndex.LEGACY_CYCLE_ID;
    }
    // プレーンオブジェクトであるべきキー
    const OBJECT_KEYS = ['timeUnitOverrides', 'channelAliases', 'yRanges', 'fileColors', 'gridHeights', 'sidebarCollapsed', 'comparison', 'importSettings', 'inspection'];

    /**
     * 保存済み設定を現行スキーマに揃える。
     * @param {*} s パース済みの設定オブジェクト(JSON.parseの結果)
     * @returns {{ok: boolean, reason: string, settings: object|null}}
     *   ok=false は読み込みを中止すべきケース。
     *   reason: 'invalid'(壊れている) / 'newer'(未来の形式) / 'migrated'(旧形式を引き上げた) / 'current'(そのまま)
     */
    function migrateSettings(s) {
        // null・配列・非オブジェクトは設定として扱えない
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
            return { ok: false, reason: 'invalid', settings: null };
        }

        // _versionがない古いデータはv1とみなす
        const version = typeof s._version === 'number' ? s._version : 1;

        // 未来のバージョン: 中途半端に適用すると壊れるため読み込まない
        if (version > SETTINGS_VERSION) {
            return { ok: false, reason: 'newer', settings: null };
        }

        // 元のオブジェクトを変更しないようコピーしてから直す
        const out = { ...s };

        // 型の防御: 期待と違う型のキーは削除する(壊れたキーだけ捨てて残りは活かす)
        for (const k of ARRAY_KEYS) {
            if (out[k] !== undefined && !Array.isArray(out[k])) delete out[k];
        }
        for (const k of OBJECT_KEYS) {
            if (out[k] !== undefined && (typeof out[k] !== 'object' || out[k] === null || Array.isArray(out[k]))) {
                delete out[k];
            }
        }

        // v1/v2の旧形式(chartGroupsなし・mergedGroupsあり)は、app.js側の
        // restoreChartGroupsFromSettingsにmergedGroups用フォールバックがあるため変換不要

        // v3以前のドライビングインデックスのサイクルIDを現行IDへ読み替える。
        if (out.driveIndex && typeof out.driveIndex === 'object' && !Array.isArray(out.driveIndex)) {
            out.driveIndex = { ...out.driveIndex,
                calculationMethod: out.driveIndex.calculationMethod === 'legacy' ? 'legacy' : 'excel' };
            const legacyMap = getLegacyCycleIdMap();
            const cid = out.driveIndex.cycleId;
            if (cid != null && Object.prototype.hasOwnProperty.call(legacyMap, cid)) {
                out.driveIndex = { ...out.driveIndex, cycleId: legacyMap[cid] };
            }
        } else {
            out.driveIndex = { calculationMethod: 'excel' };
        }

        out._version = SETTINGS_VERSION;
        // v6: comparison workspace is opt-in data; legacy settings start with a clean workspace.
        if (version < 6 && !out.comparison) out.comparison = {};
        // Older versions had row-number controls only. Preserve deliberately
        // non-default row layouts; default 1/2 keeps the new unit-row detection.
        if (version < 7 && !out.importSettings) {
            const nameRow = Number(out.nameRowIdx ?? 1), unitRow = Number(out.unitRowIdx ?? 2);
            const customRows = Number.isInteger(nameRow) && nameRow > 0 && Number.isInteger(unitRow) && unitRow > 0
                && (nameRow !== 1 || unitRow !== 2);
            out.importSettings = { nameMode: customRows ? 'manual' : 'auto', unitMode: customRows ? 'manual' : 'auto',
                timeColumn: 'auto', delimiter: 'auto', reviewBeforeLoad: false };
        }

        return {
            ok: true,
            reason: version < SETTINGS_VERSION ? 'migrated' : 'current',
            settings: out,
        };
    }

    const api = {
        SETTINGS_VERSION,
        migrateSettings,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CSVSettings = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
