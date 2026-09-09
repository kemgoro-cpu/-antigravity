/* Comparison math: uses original samples, never rendered/sampled chart data. */
(function (root) {
    'use strict';
    const finite = Number.isFinite;
    const object = x => x && typeof x === 'object' && !Array.isArray(x);
    function cleanSettings(input) {
        const s = object(input) ? input : {};
        const out = { view: ['overlay', 'stack', 'diff'].includes(s.view) ? s.view : 'overlay',
            labels: {}, matches: {}, searchAliases: {}, tolerances: {}, notes: [], align: {} };
        for (const k of ['labels', 'searchAliases']) {
            for (const [name, value] of Object.entries(object(s[k]) ? s[k] : {})) {
                if (typeof value === 'string') Object.defineProperty(out[k], name, { value: value.slice(0, 300), enumerable: true, writable: true, configurable: true });
            }
        }
        for (const [file, map] of Object.entries(object(s.matches) ? s.matches : {})) {
            if (!object(map)) continue;
            const entries = Object.entries(map).filter(([, v]) => typeof v === 'string');
            Object.defineProperty(out.matches, file, { value: Object.fromEntries(entries), enumerable: true, writable: true, configurable: true });
        }
        for (const [name, n] of Object.entries(object(s.tolerances) ? s.tolerances : {})) {
            if (finite(n) && n > 0) Object.defineProperty(out.tolerances, name, { value: n, enumerable: true, writable: true, configurable: true });
        }
        for (const [file, a] of Object.entries(object(s.align) ? s.align : {})) {
            if (!object(a)) continue;
            Object.defineProperty(out.align, file, { value: {
                channel: typeof a.channel === 'string' ? a.channel : '',
                range: finite(a.range) && a.range > 0 ? a.range : 30,
                scope: a.scope === 'visible' ? 'visible' : 'all',
                offset: finite(a.offset) ? a.offset : 0,
                method: a.method === 'manual' ? 'manual' : 'auto',
            }, enumerable: true, writable: true, configurable: true });
        }
        out.notes = (Array.isArray(s.notes) ? s.notes : []).filter(n => object(n) && typeof n.text === 'string' && finite(n.t0) && finite(n.t1) && n.t1 >= n.t0)
            .slice(0, 20).map(n => ({ id: String(n.id || ''), text: n.text.slice(0, 2000), t0: n.t0, t1: n.t1,
                created: String(n.created || ''), channels: (Array.isArray(n.channels) ? n.channels : []).filter(x => typeof x === 'string'),
                files: (Array.isArray(n.files) ? n.files : []).filter(f => object(f) && typeof f.name === 'string').map(f => ({ name: f.name, label: String(f.label || f.name), role: f.role === 'main' ? 'main' : 'sub', offset: finite(f.offset) ? f.offset : 0 })),
                image: typeof n.image === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(n.image) && n.image.length < 400000 ? n.image : '',
                context: object(n.context) ? JSON.parse(JSON.stringify(n.context)) : {},
                results: Array.isArray(n.results) ? n.results.slice(0, 500) : [] }));
        return out;
    }
    function lowerBound(t, x) {
        let lo = 0, hi = t.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; }
        return lo;
    }
    // No extrapolation, no interpolation through missing values; digital signals use zero-order hold.
    function valueAt(t, v, x, digital = false) {
        if (!t?.length || !v || x < t[0] || x > t[t.length - 1]) return NaN;
        const i = lowerBound(t, x);
        if (t[i] === x) return finite(v[i]) ? v[i] : NaN;
        if (!i || i >= t.length || !finite(v[i - 1]) || !finite(v[i])) return NaN;
        if (digital) return v[i - 1];
        return v[i - 1] + (v[i] - v[i - 1]) * (x - t[i - 1]) / (t[i] - t[i - 1]);
    }
    const sameUnit = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    function firstTransition(sig, offset, start, end) {
        for (let i = Math.max(1, lowerBound(sig.t, start - offset)); i < sig.t.length && sig.t[i] + offset <= end; i++) {
            if (finite(sig.v[i]) && finite(sig.v[i - 1]) && sig.v[i] !== sig.v[i - 1]) return { time: sig.t[i] + offset, from: sig.v[i - 1], to: sig.v[i] };
        }
        return null;
    }
    function compare(a, b, offset, range, digital = false, tolerance = null, withPoints = false) {
        let n = 0, missing = 0, sum = 0, sq = 0, max = -1, time = null, mismatchDuration = 0, totalDuration = 0, exceeded = 0;
        const points = [];
        const start = range?.[0] ?? -Infinity, end = range?.[1] ?? Infinity;
        for (let i = lowerBound(a.t, start); i < a.t.length && a.t[i] <= end; i++) {
            const t = a.t[i], x = a.v[i], y = valueAt(b.t, b.v, t - offset, digital);
            if (!finite(x) || !finite(y)) { missing++; if (withPoints) points.push([t, null]); continue; }
            const d = x - y, abs = Math.abs(d);
            n++; sum += d; sq += d * d;
            if (abs > max) { max = abs; time = t; }
            if (finite(tolerance) && abs > tolerance) exceeded++;
            if (withPoints) points.push([t, d]);
        }
        // Integrate digital disagreement on the union of transition times (unequal sample rates).
        if (digital) {
            const lo = Math.max(start, a.t[0], b.t[0] + offset), hi = Math.min(end, a.t[a.t.length - 1], b.t[b.t.length - 1] + offset);
            if (hi > lo) {
                const times = [...new Set([lo, hi, ...Array.from(a.t).filter(t => t > lo && t < hi), ...Array.from(b.t, t => t + offset).filter(t => t > lo && t < hi)])].sort((x, y) => x - y);
                for (let i = 0; i < times.length - 1; i++) {
                    const x = valueAt(a.t, a.v, times[i], true), y = valueAt(b.t, b.v, times[i] - offset, true), dt = times[i + 1] - times[i];
                    if (!finite(x) || !finite(y)) continue;
                    totalDuration += dt; if (x !== y) mismatchDuration += dt;
                }
            }
        }
        const mainTransition = digital ? firstTransition(a, 0, start, end) : null;
        const subTransition = digital ? firstTransition(b, offset, start, end) : null;
        const transitionDelta = mainTransition && subTransition && mainTransition.from === subTransition.from && mainTransition.to === subTransition.to ? subTransition.time - mainTransition.time : null;
        return { n, missing, max: n ? max : null, time, mean: n ? sum / n : null, rms: n ? Math.sqrt(sq / n) : null, mainTransition, subTransition, transitionDelta,
            mismatchDuration: digital ? mismatchDuration : null, totalDuration, exceeded, ratio: n && finite(tolerance) && tolerance > 0 ? max / tolerance : null, points };
    }
    function alignmentScore(a, b, offset, range) {
        const begin = lowerBound(a.t, range[0]), end = lowerBound(a.t, range[1]);
        const step = Math.max(1, Math.ceil((end - begin + 1) / 1200));
        let n = 0, count = 0, sq = 0;
        for (let i = begin; i < a.t.length && a.t[i] <= range[1]; i += step) {
            if (!finite(a.v[i])) continue;
            count++;
            const v = valueAt(b.t, b.v, a.t[i] - offset);
            if (finite(v)) { n++; sq += (a.v[i] - v) ** 2; }
        }
        return { rms: n >= 3 && n >= count * 0.6 ? Math.sqrt(sq / n) : Infinity, n, coverage: count ? n / count : 0 };
    }
    function candidates(main, columns) {
        const key = x => x.toLowerCase().replace(/[\s_\-]/g, '');
        const needle = key(main.name);
        return columns.map(c => ({ col: c, score: (c.name === main.name ? 100 : key(c.name) === needle ? 80 : needle.length > 2 && (key(c.name).includes(needle) || needle.includes(key(c.name))) ? 30 : 0) + (sameUnit(c.unit, main.unit) ? 15 : 0) }))
            .sort((a, b) => b.score - a.score || a.col.name.localeCompare(b.col.name));
    }
    function pointAt(points, t, digital = false) {
        if (!points.length || t < points[0][0] || t > points[points.length - 1][0]) return NaN;
        let lo = 0, hi = points.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid][0] < t) lo = mid + 1; else hi = mid; }
        const b = points[lo]; if (b?.[0] === t) return finite(b[1]) ? b[1] : NaN;
        const a = points[lo - 1]; if (!a || !b || !finite(a[1]) || !finite(b[1])) return NaN;
        return digital ? a[1] : a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    }
    function pointStats(points, t0, t1) {
        let lo = 0, hi = points.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid][0] < t0) lo = mid + 1; else hi = mid; }
        let min = Infinity, max = -Infinity, mean = 0, m2 = 0, sq = 0, n = 0;
        for (let i = lo; i < points.length && points[i][0] <= t1; i++) {
            const v = points[i][1]; if (!finite(v)) continue;
            n++; min = Math.min(min, v); max = Math.max(max, v); const d = v - mean; mean += d / n; m2 += d * (v - mean); sq += v * v;
        }
        return n ? { n, min, max, mean, rms: Math.sqrt(sq / n), sigma: Math.sqrt(Math.max(0, m2 / n)) } : null;
    }
    const api = { cleanSettings, lowerBound, valueAt, sameUnit, compare, alignmentScore, candidates, pointAt, pointStats };
    if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CSVCompare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
