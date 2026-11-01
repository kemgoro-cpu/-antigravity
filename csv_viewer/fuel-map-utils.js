/* Pure, bounded fuel-map aggregation and XY sample selection. Source arrays are never changed. */
(function (root) {
    'use strict';
    const DEFAULTS = Object.freeze({ maxCells: 40000, maxRows: 100000, maxPoints: 10000, rpmStep: 400, torqueStep: 3 });
    const fail = reason => ({ ok: false, reason });
    const arrayLike = value => Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number');
    const blank = value => value == null || (typeof value === 'string' && value.trim() === '');
    function number(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
        if (typeof value !== 'string') return NaN;
        const text = value.trim();
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return NaN;
        const out = Number(text);
        return Number.isFinite(out) ? out : NaN;
    }
    function positiveInteger(value, fallback, maximum, name) {
        if (value === undefined) return fallback;
        if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name}は1〜${maximum}の整数で指定してください。`);
        return value;
    }
    function classifyUnit(unit) {
        const text = String(unit ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '').replace(/[·⋅・]/g, '*');
        if (['rpm', 'r/min', 'rev/min', '1/min', 'min^-1', 'min-1'].includes(text)) return 'rpm';
        if (['nm', 'n*m', 'n-m'].includes(text)) return 'torque';
        if (['g/kwh', 'g/kw-h', 'g/(kw*h)', 'g/kw/h', 'g/(kwh)'].includes(text)) return 'sfc';
        return null;
    }
    const compatibleUnit = (unit, kind) => ['rpm', 'torque', 'sfc'].includes(kind) && classifyUnit(unit) === kind;
    function headerUnit(value) {
        const match = String(value ?? '').match(/[\[(]([^\])]+)[\])]\s*$/);
        return match ? match[1].trim() : null;
    }
    function declaredAxisUnit(label) {
        const explicit = headerUnit(label);
        if (explicit) return explicit;
        const text = String(label ?? '').normalize('NFKC').trim();
        if (classifyUnit(text)) return text;
        // These are explicit, incompatible units/axis labels, not guesses for
        // arbitrary names such as "Torque". A user's unit acknowledgement must
        // not silently turn a documented throttle/lb-ft map into a Nm map.
        if (/^(?:lb[- *·]?ft|lbf[- *·]?ft|ft[- *·]?lb|ft[- *·]?lbf|kgf?[- *·]?m|rad\/s|rps|hz|%|percent|deg|degrees|throttle(?:[_ ]?(?:position|angle))?|スロットル(?:開度)?|開度)$/i.test(text)) return text;
        return null;
    }
    function matrixUnitHints(corner) {
        const text = String(corner ?? '').normalize('NFKC').trim();
        // Backslash denotes X\\Y. A slash separator must have surrounding
        // whitespace so a unit such as r/min is not split into two axes.
        let parts = text.includes('\\') ? text.split('\\') : text.split(/\s+\/\s+/);
        if (parts.length !== 2) parts = text.split(/\s*\|\s*/);
        return parts.length === 2 ? { x: declaredAxisUnit(parts[0]), y: declaredAxisUnit(parts[1]), z: null }
            : { x: null, y: null, z: null };
    }
    const headerName = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\[(].*$/, '').replace(/[\s_-]/g, '');
    const headerSets = [
        new Set(['x', 'rpm', 'ne', 'enginespeed', 'enginerpm', 'sfcne', '回転数', 'エンジン回転数']),
        new Set(['y', 'torque', 'te', 'enginetorque', 'sfcte', 'トルク', 'エンジントルク']),
        new Set(['z', 'sfc', 'bsfc', 'sfcgkwh', 'fuelconsumptionrate', '燃費率', '燃料消費率']),
    ];
    const isHeader = row => row.length === 3 && row.every((cell, index) => headerSets[index].has(headerName(cell)));
    const isUnits = row => row.length === 3 && row.every((cell, index) => compatibleUnit(cell, ['rpm', 'torque', 'sfc'][index]));
    function cellBudget(nx, ny, maxCells) {
        if (!Number.isSafeInteger(nx) || !Number.isSafeInteger(ny) || nx < 1 || ny < 1 || nx > maxCells || ny > maxCells || nx * ny > maxCells) {
            throw new Error(`マップの格子数 ${nx} × ${ny} が上限 ${maxCells.toLocaleString('ja-JP')} セルを超えます。軸の値・単位・格子幅を確認してください。`);
        }
    }
    function midpointEdges(axis) {
        if (axis.length === 1) {
            const span = Math.max(Math.abs(axis[0]) * 0.05, 0.5);
            return [Math.max(0, axis[0] - span), axis[0] + span];
        }
        const edges = [Math.max(0, axis[0] - (axis[1] - axis[0]) / 2)];
        for (let i = 1; i < axis.length; i++) edges.push(axis[i - 1] + (axis[i] - axis[i - 1]) / 2);
        edges.push(axis[axis.length - 1] + (axis[axis.length - 1] - axis[axis.length - 2]) / 2);
        return edges;
    }
    function grid(xs, ys, stats, format, xEdges = midpointEdges(xs), yEdges = midpointEdges(ys)) {
        if (![...xEdges, ...yEdges].every(Number.isFinite)) throw new Error('マップのセル境界が有限値になりません。軸の桁・単位を確認してください。');
        return { ok: true, xs, ys, zz: ys.map(() => xs.map(() => NaN)), counts: ys.map(() => xs.map(() => 0)),
            xEdges, yEdges, zmin: Infinity, zmax: -Infinity, format, stats,
            unitHints: { x: null, y: null, z: null }, header: [] };
    }
    function statistics(inputRows) {
        return { inputRows, eligible: 0, excluded: 0, invalidCoordinates: 0, invalidValues: 0, duplicatePoints: 0, emptyCells: 0 };
    }
    function add(map, xi, yi, z) {
        const count = ++map.counts[yi][xi];
        // Online positive-value mean avoids overflowing a sum of large, finite inputs.
        map.zz[yi][xi] = count === 1 ? z : map.zz[yi][xi] + (z - map.zz[yi][xi]) / count;
        map.stats.eligible++;
        if (count > 1) map.stats.duplicatePoints++;
    }
    function finish(map) {
        for (const row of map.zz) for (const z of row) {
            if (Number.isFinite(z)) { map.zmin = Math.min(map.zmin, z); map.zmax = Math.max(map.zmax, z); }
            else map.stats.emptyCells++;
        }
        map.stats.excluded = map.stats.invalidCoordinates + map.stats.invalidValues;
        return map.stats.eligible ? map : fail('燃費率マップに有効な値がありません。回転数・トルクは0以上、燃費率は正の有限値が必要です。');
    }
    function parseMatrix(rows, maxCells) {
        if (rows.length < 2 || rows[0].length < 2) throw new Error('行列形式は、先頭行に回転数、先頭列にトルク、その内側に燃費率を置いてください。');
        const width = rows[0].length;
        if (rows.some(row => row.length !== width)) throw new Error('行列形式の列数が一致しません。空欄セルの区切りも残してください。');
        cellBudget(width - 1, rows.length - 1, maxCells);
        const originalX = rows[0].slice(1).map(number), originalY = rows.slice(1).map(row => number(row[0]));
        if (![...originalX, ...originalY].every(value => Number.isFinite(value) && value >= 0)) throw new Error('マップの回転数・トルク軸は0以上の数値で指定してください。');
        if (new Set(originalX).size !== originalX.length || new Set(originalY).size !== originalY.length) throw new Error('行列形式の軸に同じ値が重複しています。');
        const xs = [...originalX].sort((a, b) => a - b), ys = [...originalY].sort((a, b) => a - b);
        const xIndex = new Map(xs.map((x, i) => [x, i])), yIndex = new Map(ys.map((y, i) => [y, i]));
        const result = grid(xs, ys, statistics((rows.length - 1) * (width - 1)), 'matrix');
        result.header = rows[0].map(String);
        result.unitHints = matrixUnitHints(rows[0][0]);
        for (let y = 1; y < rows.length; y++) for (let x = 1; x < width; x++) {
            const z = number(rows[y][x]);
            if (Number.isFinite(z) && z > 0) add(result, xIndex.get(originalX[x - 1]), yIndex.get(originalY[y - 1]), z);
            else result.stats.invalidValues++;
        }
        return finish(result);
    }
    function parseLong(rows, maxCells) {
        if (rows.some(row => row.length !== 3)) throw new Error('3列形式は回転数・トルク・燃費率の3列で指定してください。');
        let first = 0;
        const header = isHeader(rows[0]) ? rows[first++].map(String) : [];
        const unitHints = header.length ? { x: headerUnit(header[0]), y: headerUnit(header[1]), z: headerUnit(header[2]) } : { x: null, y: null, z: null };
        if (first < rows.length && isUnits(rows[first])) {
            const units = rows[first++];
            for (const [i, name] of ['x', 'y', 'z'].entries()) {
                if (unitHints[name] && classifyUnit(unitHints[name]) !== classifyUnit(units[i])) throw new Error('見出しと単位行の単位が一致しません。');
                unitHints[name] = String(units[i]);
            }
        }
        if (first === rows.length) throw new Error('マップにデータ行がありません。');
        const xValues = new Set(), yValues = new Set();
        for (let i = first; i < rows.length; i++) {
            const x = number(rows[i][0]), y = number(rows[i][1]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error(`マップのデータ${i - first + 1}行目の回転数・トルクは0以上の数値で指定してください。`);
            xValues.add(x); yValues.add(y);
            cellBudget(xValues.size, yValues.size, maxCells);
        }
        const xs = [...xValues].sort((a, b) => a - b), ys = [...yValues].sort((a, b) => a - b);
        const xIndex = new Map(xs.map((x, i) => [x, i])), yIndex = new Map(ys.map((y, i) => [y, i]));
        const result = grid(xs, ys, statistics(rows.length - first), 'long');
        result.header = header; result.unitHints = unitHints;
        for (let i = first; i < rows.length; i++) {
            const z = number(rows[i][2]);
            if (Number.isFinite(z) && z > 0) add(result, xIndex.get(number(rows[i][0])), yIndex.get(number(rows[i][1])), z);
            else result.stats.invalidValues++;
        }
        return finish(result);
    }
    /** External map data; empty/nonpositive/invalid fuel-rate cells remain holes. No extrapolation or filling. */
    function parseMap(rows, options = {}) {
        try {
            if (!options || typeof options !== 'object') throw new Error('マップ設定が不正です。');
            const maxCells = positiveInteger(options.maxCells, DEFAULTS.maxCells, 1000000, '格子上限');
            const maxRows = positiveInteger(options.maxRows, DEFAULTS.maxRows, 1000000, '読込行数上限');
            if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) throw new Error('マップはCSVの行・列配列で指定してください。');
            if (rows.length > maxRows) throw new Error(`マップが読込行数上限 ${maxRows.toLocaleString('ja-JP')} 行を超えます。`);
            const clean = rows.filter(row => row.some(value => !blank(value)));
            if (!clean.length) throw new Error('マップのデータがありません。');
            let format = options.format || 'auto';
            if (!['auto', 'matrix', 'long'].includes(format)) throw new Error('マップ形式を自動・行列・3列から選んでください。');
            if (format === 'auto') {
                if (isHeader(clean[0]) || isUnits(clean[0])) format = 'long';
                else if (clean[0].length !== 3 || !Number.isFinite(number(clean[0][0]))) format = 'matrix';
                else throw new Error('数値だけの3列は行列形式と区別できません。「3列」または「行列」を指定してください。');
            }
            return format === 'matrix' ? parseMatrix(clean, maxCells) : parseLong(clean, maxCells);
        } catch (error) { return fail(error.message); }
    }
    /** GT-style SFC coordinate bins, using every eligible sample before any display sampling. */
    function fromSamples(x, y, z, options = {}) {
        try {
            if (!arrayLike(x) || !arrayLike(y) || !arrayLike(z) || x.length !== y.length || x.length !== z.length) throw new Error('燃費率マップの3信号の点数が一致しません。');
            if (!options || typeof options !== 'object') throw new Error('マップ設定が不正です。');
            const maxCells = positiveInteger(options.maxCells, DEFAULTS.maxCells, 1000000, '格子上限');
            const dx = options.rpmStep === undefined ? DEFAULTS.rpmStep : options.rpmStep;
            const dy = options.torqueStep === undefined ? DEFAULTS.torqueStep : options.torqueStep;
            if (![dx, dy].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new Error('格子幅は正の有限値で指定してください。');
            const stats = statistics(x.length);
            let xmax = 0, ymax = 0, eligible = 0;
            for (let i = 0; i < x.length; i++) {
                if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || x[i] < 0 || y[i] < 0) { stats.invalidCoordinates++; continue; }
                if (!Number.isFinite(z[i]) || z[i] <= 0) { stats.invalidValues++; continue; }
                xmax = Math.max(xmax, x[i]); ymax = Math.max(ymax, y[i]); eligible++;
            }
            if (!eligible) throw new Error('燃費率マップに有効な値がありません。回転数・トルクは0以上、燃費率は正の有限値が必要です。');
            const nx = Math.max(1, Math.ceil(xmax / dx)) + 1, ny = Math.max(1, Math.ceil(ymax / dy)) + 1;
            cellBudget(nx, ny, maxCells);
            if (!Number.isFinite((nx - 0.5) * dx) || !Number.isFinite((ny - 0.5) * dy)) throw new Error('マップのセル境界が有限値になりません。');
            const xs = Array.from({ length: nx }, (_, i) => i * dx), ys = Array.from({ length: ny }, (_, i) => i * dy);
            const edges = (size, span) => Array.from({ length: size + 1 }, (_, i) => i ? (i - 0.5) * span : 0);
            const result = grid(xs, ys, stats, 'samples', edges(nx, dx), edges(ny, dy));
            result.unitHints = { x: 'rpm', y: 'Nm', z: 'g/kWh' };
            for (let i = 0; i < x.length; i++) {
                if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || x[i] < 0 || y[i] < 0 || !Number.isFinite(z[i]) || z[i] <= 0) continue;
                add(result, Math.min(nx - 1, Math.floor(x[i] / dx + 0.5)), Math.min(ny - 1, Math.floor(y[i] / dy + 0.5)), z[i]);
            }
            return finish(result);
        } catch (error) { return fail(error.message); }
    }
    function pointOptions(options = {}) {
        if (!options || typeof options !== 'object') throw new Error('点の選択設定が不正です。');
        const offset = options.offset === undefined ? 0 : options.offset;
        if (typeof offset !== 'number' || !Number.isFinite(offset)) throw new Error('時間差は有限の数値で指定してください。');
        let range = options.range === undefined || options.range === null ? [-Infinity, Infinity] : options.range;
        if (!Array.isArray(range) || range.length !== 2 || range.some(value => typeof value !== 'number' || Number.isNaN(value)) || range[0] > range[1]) throw new Error('解析対象の時間範囲が不正です。');
        const maxPoints = positiveInteger(options.maxPoints, DEFAULTS.maxPoints, 1000000, '描画点数上限');
        return { offset, range, maxPoints, nonnegative: options.nonnegative === true };
    }
    function matchingArrays(time, x, y, z) {
        return arrayLike(time) && arrayLike(x) && arrayLike(y) && (z == null || arrayLike(z))
            && time.length === x.length && time.length === y.length && (z == null || time.length === z.length);
    }
    function validPoint(x, y, z, i, nonnegative) {
        return Number.isFinite(x[i]) && Number.isFinite(y[i]) && (!nonnegative || (x[i] >= 0 && y[i] >= 0)) && (z == null || Number.isFinite(z[i]));
    }
    const record = (time, x, y, z, index, offset) => ({ x: x[index], y: y[index], z: z == null ? null : z[index], index, time: time[index], displayTime: time[index] + offset });
    /** Two passes over raw arrays, retaining at most maxPoints records. Counts and color limits use all eligible samples. */
    function pickPoints(time, x, y, z = null, options = {}) {
        try {
            if (!matchingArrays(time, x, y, z)) throw new Error('時刻とXY・色信号の点数が一致しません。');
            const { offset, range, maxPoints, nonnegative } = pointOptions(options);
            let totalCount = 0, rangeCount = 0, excludedCount = 0, invalidTimeCount = 0;
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
            for (let i = 0; i < time.length; i++) {
                const t = time[i] + offset;
                if (!Number.isFinite(time[i]) || !Number.isFinite(t)) { invalidTimeCount++; continue; }
                if (t < range[0] || t > range[1]) continue;
                rangeCount++;
                if (!validPoint(x, y, z, i, nonnegative)) { excludedCount++; continue; }
                totalCount++; xmin = Math.min(xmin, x[i]); xmax = Math.max(xmax, x[i]); ymin = Math.min(ymin, y[i]); ymax = Math.max(ymax, y[i]);
                if (z != null) { zmin = Math.min(zmin, z[i]); zmax = Math.max(zmax, z[i]); }
            }
            const displayCount = Math.min(totalCount, maxPoints), points = [];
            let ordinal = 0, next = 0;
            const wanted = position => displayCount <= 1 ? 0 : Math.round(position * (totalCount - 1) / (displayCount - 1));
            for (let i = 0; i < time.length && next < displayCount; i++) {
                const t = time[i] + offset;
                if (!Number.isFinite(time[i]) || !Number.isFinite(t) || t < range[0] || t > range[1] || !validPoint(x, y, z, i, nonnegative)) continue;
                if (ordinal === wanted(next)) { points.push(record(time, x, y, z, i, offset)); next++; }
                ordinal++;
            }
            return { ok: true, points, totalCount, displayCount, excludedCount, invalidTimeCount, rangeCount, truncated: totalCount > displayCount,
                xmin: totalCount ? xmin : null, xmax: totalCount ? xmax : null, ymin: totalCount ? ymin : null, ymax: totalCount ? ymax : null,
                zmin: z != null && totalCount ? zmin : null, zmax: z != null && totalCount ? zmax : null };
        } catch (error) { return fail(error.message); }
    }
    function prepareTime(time) {
        if (!arrayLike(time) || !time.length) return fail('時刻データがありません。');
        for (let i = 0; i < time.length; i++) {
            if (!Number.isFinite(time[i])) return fail('時刻に欠損・非有限値があるためカーソル連動できません。');
            if (i && time[i] <= time[i - 1]) return fail('時刻が重複または逆転しているためカーソル連動できません。');
        }
        return { ok: true, time, first: time[0], last: time[time.length - 1] };
    }
    function lowerBound(time, value, upper = false) {
        let lo = 0, hi = time.length;
        while (lo < hi) { const mid = lo + ((hi - lo) >>> 1); if (time[mid] < value || (upper && time[mid] === value)) lo = mid + 1; else hi = mid; }
        return lo;
    }
    /** Never interpolate a sample, extrapolate beyond the log, or skip an invalid nearest sample to invent a valid one. */
    function nearestPoint(prepared, x, y, z = null, displayTime, options = {}) {
        try {
            if (!prepared?.ok) return fail(prepared?.reason || '時刻の検証が必要です。');
            const time = prepared.time;
            if (!matchingArrays(time, x, y, z)) throw new Error('時刻とXY・色信号の点数が一致しません。');
            const { offset, range, nonnegative } = pointOptions(options);
            const local = displayTime - offset;
            if (!Number.isFinite(displayTime) || !Number.isFinite(local) || displayTime < range[0] || displayTime > range[1] || local < prepared.first || local > prepared.last) return { ok: true, point: null };
            const start = lowerBound(time, range[0] - offset), end = lowerBound(time, range[1] - offset, true);
            if (start === end) return { ok: true, point: null };
            const right = Math.min(end - 1, Math.max(start, lowerBound(time, local))), left = Math.max(start, right - 1);
            const index = Math.abs(time[left] - local) <= Math.abs(time[right] - local) ? left : right;
            return { ok: true, point: validPoint(x, y, z, index, nonnegative) ? record(time, x, y, z, index, offset) : null };
        } catch (error) { return fail(error.message); }
    }
    const api = { DEFAULTS, parseMap, fromSamples, pickPoints, classifyUnit, compatibleUnit, prepareTime, nearestPoint };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CSVFuelMap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
