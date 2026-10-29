/* Drive Index input contracts. Validation only: never converts or changes samples. */
(function (root) {
    'use strict';
    const expected = { speed: 'km/h', fuel: 'L/h', time: 's' };
    function normalizeUnit(unit) {
        return String(unit == null ? '' : unit).normalize('NFKC').trim().toLowerCase()
            .replace(/ℓ/g, 'l').replace(/\s+/g, '').replace(/^\[(.*)\]$/, '$1');
    }
    function checkUnit(kind, unit) {
        const value = normalizeUnit(unit);
        const aliases = {
            speed: ['km/h', 'km/hr', 'km/hour', 'kmh', 'kph'],
            fuel: ['l/h', 'l/hr', 'l/hour', 'lph'],
            time: ['s', 'sec', 'secs', 'second', 'seconds', '秒'],
        };
        const ok = !!aliases[kind]?.includes(value);
        const unknown = !value || ['-', '—', '不明', 'なし', 'n/a'].includes(value);
        return { ok, status: ok ? 'valid' : unknown ? 'unknown' : 'mismatch', expected: expected[kind], unit: String(unit || '') };
    }
    function checkTime(metadata) {
        const h = metadata || {};
        const source = h.timeScaleSource;
        const unit = normalizeUnit(h.timeScaleUnit || h.timeUnit);
        const scale = Number(h.timeScale);
        const explicit = ['unit', 'header', 'manual'].includes(source);
        const seconds = checkUnit('time', unit).ok && scale === 1;
        const milliseconds = ['ms', 'msec', 'msecs', 'millisecond', 'milliseconds', 'ミリ秒'].includes(unit) && scale === 0.001;
        return {
            ok: explicit && (seconds || milliseconds),
            status: explicit && (seconds || milliseconds) ? 'valid' : !explicit ? 'unknown' : 'mismatch',
            expected: 's', unit: h.timeScaleUnit || h.timeUnit || '', source,
        };
    }
    function validateDriveInputs({ actualUnit, targetUnit, useModeTrace = true, fuelUnit, hasFuel = false, timeMetadata } = {}) {
        const checks = [
            { field: 'time', label: '時間', ...checkTime(timeMetadata) },
            { field: 'actual', label: '実測車速', ...checkUnit('speed', actualUnit) },
        ];
        if (!useModeTrace) checks.push({ field: 'target', label: '目標車速', ...checkUnit('speed', targetUnit) });
        if (hasFuel) checks.push({ field: 'fuel', label: '燃料流量', ...checkUnit('fuel', fuelUnit) });
        const issues = checks.filter(c => !c.ok).map(c => ({
            ...c,
            message: c.field === 'time'
                ? `時間単位が${c.status === 'unknown' ? '未確認' : '未対応'}です。元の単位を s / ms で指定してください（計算は秒基準）。`
                : `${c.label}の単位${c.unit ? `「${c.unit}」` : '（未記載）'}は${c.status === 'unknown' ? '未確認' : '未対応'}です。必要単位は ${c.expected} です。`,
        }));
        return { ok: !issues.some(c => c.field !== 'fuel'), fuelAllowed: hasFuel && !issues.some(c => c.field === 'fuel'), checks, issues };
    }
    function resultState(di, currentSignature) {
        if (di?.calculating) return { status: 'stale', reason: '計算中です。完了するまで前回の値は使用しません。' };
        if (di?.draftDirty) return { status: 'stale', reason: '入力条件が変更されています。「再計算」で結果を更新してください。' };
        if (di?.resultSignature && di.resultSignature !== currentSignature) return { status: 'stale', reason: 'データ・単位・解析条件が変更されています。「再計算」で結果を更新してください。' };
        if (!di?.resultSignature || !(di.results || []).some(r => r.result)) return { status: 'empty', reason: di?.validationSummary || '未評価です。必要単位と対象チャンネルを確認して再計算してください。' };
        return { status: 'current', reason: '現在の条件で更新済みです。燃料の単位が未確認の場合、燃費は未評価です。' };
    }
    const api = { normalizeUnit, checkUnit, checkTime, validateDriveInputs, resultState };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.UnitValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
