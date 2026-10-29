/* Shared analysis scope. Original values and timestamps are never changed. */
(function (root) {
    'use strict';
    function clean(input) {
        const a = input && typeof input === 'object' ? input : {};
        const range = Array.isArray(a.range) && a.range.length === 2 && a.range.every(Number.isFinite)
            && a.range[1] >= a.range[0] ? [...a.range] : null;
        return { scope: ['visible', 'selection', 'all'].includes(a.scope) ? a.scope : 'visible',
            range, mainName: typeof a.mainName === 'string' ? a.mainName : '', rawTime: a.rawTime === true };
    }
    function resolve(input, visible, full) {
        const a = clean(input);
        const range = a.scope === 'selection' ? a.range : a.scope === 'all' ? full : visible || full;
        const names = { selection: '選択区間', visible: '表示範囲', all: '全体' };
        const timeLabel = a.rawTime ? '元の時刻' : '時間合わせ後';
        const valid = Array.isArray(range) && range.every(Number.isFinite);
        return { scope: a.scope, range: valid ? [...range] : null, rawTime: a.rawTime, timeLabel,
            label: `${names[a.scope]} ${valid ? range.map(x => Number(x.toPrecision(8))).join(' – ') + ' s' : '未選択'} · ${timeLabel}` };
    }
    function offset(file, rawTime) { return rawTime || file.role === 'main' ? 0 : file.offset || 0; }
    const extents = new WeakMap();
    function extent(file) {
        const times = file?.timeData;
        if (!times?.length) return null;
        const signature = `${times.length}:${times[0]}:${times[times.length - 1]}:${file.headerInfo?.timeScale}`;
        const saved = extents.get(times);
        if (saved?.signature === signature) return saved.range && [...saved.range];
        let lo = Infinity, hi = -Infinity;
        for (const t of times) if (Number.isFinite(t)) { if (t < lo) lo = t; if (t > hi) hi = t; }
        const range = lo <= hi ? [lo, hi] : null;
        extents.set(times, { signature, range });
        return range && [...range];
    }
    const api = { clean, resolve, offset, extent };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CSVAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
