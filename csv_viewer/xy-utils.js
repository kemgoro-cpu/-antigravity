// XYプロット（F7）向けの純粋関数群。回帰直線・等高線マップ関連のロジックを
// DOM/state から切り離し、Nodeから単体テストできるようにする
// （tests/xy-utils.test.js）。settings-utils.js / parser-utils.js と同じ
// UMDパターン: ブラウザでは root.CSVXYUtils、Nodeでは module.exports。
(function (root) {
    'use strict';

    /**
     * 単回帰分析（最小二乗法）。NaNを含むペアはスキップする。
     * @param {number[]} xs
     * @param {number[]} ys
     * @returns {{slope:number, intercept:number, r:number, r2:number, n:number}|null}
     *   有効なペアが2未満、またはxが定数（傾きが不定）の場合はnull
     */
    function linearRegression(xs, ys) {
        if (!Array.isArray(xs) || !Array.isArray(ys)) return null;
        const n = Math.min(xs.length, ys.length);

        let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, count = 0;
        for (let i = 0; i < n; i++) {
            const x = xs[i], y = ys[i];
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
            count++;
        }
        if (count < 2) return null;

        const denomX = count * sxx - sx * sx;
        if (denomX === 0) return null; // xが定数 → 傾きが不定

        const slope = (count * sxy - sx * sy) / denomX;
        const intercept = (sy - slope * sx) / count;

        const denomY = count * syy - sy * sy;
        // yが定数のときは相関係数が定義できない（分母0）ため0扱いにする
        const r = denomY === 0 ? 0 : (count * sxy - sx * sy) / Math.sqrt(denomX * denomY);

        return { slope, intercept, r, r2: r * r, n: count };
    }

    // ─────────────────────────────────────────────────────────────
    // 等高線マップ（F7の「マップ読込」）: CSVの行列をパースして
    // ブレークポイント配列(xs, ys)とZグリッド(zz)に変換し、
    // marching squaresで等高線の線分を計算する。
    // ─────────────────────────────────────────────────────────────

    /** セル・文字列を数値に変換する（数値ならそのまま、パース不能はNaN） */
    function toNum(v) {
        if (typeof v === 'number') return v;
        if (v == null) return NaN;
        const s = String(v).trim();
        if (s === '') return NaN;
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : NaN;
    }

    /**
     * 配列が厳密に単調か判定する。
     * @returns {1|-1|0} 1=昇順, -1=降順, 0=単調でない（重複値含む）
     */
    function monotonicity(arr) {
        if (arr.length < 2) return 1;
        let asc = true, desc = true;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] <= arr[i - 1]) asc = false;
            if (arr[i] >= arr[i - 1]) desc = false;
        }
        if (asc) return 1;
        if (desc) return -1;
        return 0;
    }

    /** zzグリッド(2次元配列, NaN穴あり)からNaNを除く最小・最大値を求める */
    function zRangeOf(zz) {
        let zmin = Infinity, zmax = -Infinity;
        for (const row of zz) {
            for (const v of row) {
                if (Number.isFinite(v)) {
                    if (v < zmin) zmin = v;
                    if (v > zmax) zmax = v;
                }
            }
        }
        return { zmin, zmax };
    }

    /**
     * マトリクス形式（先頭行=X breakpoints、先頭列=Y breakpoints、コーナーセルは無視）を解析する。
     * @param {string[][]} clean 空行を除去済みの行列
     * @returns {{ok:boolean, xs?, ys?, zz?, zmin?, zmax?}}
     */
    function parseMatrixFormat(clean) {
        if (clean.length < 2 || clean[0].length < 2) return { ok: false };

        const xs = clean[0].slice(1).map(toNum);
        if (xs.some(v => !Number.isFinite(v))) return { ok: false };

        const ys = [];
        const zz = [];
        for (let i = 1; i < clean.length; i++) {
            const row = clean[i];
            const y = toNum(row[0]);
            if (!Number.isFinite(y)) return { ok: false };
            ys.push(y);
            const zRow = [];
            for (let j = 0; j < xs.length; j++) {
                const raw = row[j + 1];
                const z = (raw === undefined || raw === '') ? NaN : toNum(raw);
                zRow.push(Number.isFinite(z) ? z : NaN);
            }
            zz.push(zRow);
        }

        const xdir = monotonicity(xs);
        const ydir = monotonicity(ys);
        if (!xdir || !ydir) return { ok: false }; // 非単調breakpoints

        if (xdir < 0) { xs.reverse(); zz.forEach(row => row.reverse()); }
        if (ydir < 0) { ys.reverse(); zz.reverse(); }

        const { zmin, zmax } = zRangeOf(zz);
        if (zmin === Infinity) return { ok: false }; // 全セルNaN

        return { ok: true, xs, ys, zz, zmin, zmax, format: 'matrix' };
    }

    /**
     * ロング形式（x, y, z の3列。ヘッダー行は任意）を解析する。
     * 先頭行が数値化できなければヘッダーとみなして読み飛ばす。
     */
    function parseLongFormat(clean) {
        let dataRows = clean;
        const firstAsNum = clean[0].map(toNum);
        if (firstAsNum.some(v => !Number.isFinite(v))) dataRows = clean.slice(1);
        if (dataRows.length < 1) return { ok: false };

        const pts = [];
        for (const row of dataRows) {
            const x = toNum(row[0]), y = toNum(row[1]), z = toNum(row[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
            pts.push({ x, y, z });
        }

        const xs = [...new Set(pts.map(p => p.x))].sort((a, b) => a - b);
        const ys = [...new Set(pts.map(p => p.y))].sort((a, b) => a - b);
        if (xs.length < 2 || ys.length < 2) return { ok: false };

        const zz = ys.map(() => xs.map(() => NaN)); // 格子上に存在しない組み合わせ=穴(NaN)
        for (const p of pts) {
            const xi = xs.indexOf(p.x), yi = ys.indexOf(p.y);
            zz[yi][xi] = Number.isFinite(p.z) ? p.z : NaN;
        }

        const { zmin, zmax } = zRangeOf(zz);
        if (zmin === Infinity) return { ok: false };

        return { ok: true, xs, ys, zz, zmin, zmax, format: 'long' };
    }

    /**
     * Papa.parse済みの行列（配列の配列）から等高線マップを解析する。
     * マトリクス形式（先頭行=X breakpoints、先頭列=Y breakpoints）とロング形式
     * （x, y, z の3列、ヘッダー任意）を自動判別する。実務上、効率マップ等は
     * X breakpointsが3個以上あるのが通常なので「列数=3ならロング形式」と
     * 判定する（3列ちょうどの極小なマトリクスとは原理的に区別できないため、
     * 一般的なケースを優先する簡便な割り切り）。
     * @param {Array<Array<string|number>>} rows
     * @returns {{ok:boolean, xs?:number[], ys?:number[], zz?:number[][], zmin?:number, zmax?:number, format?:string}}
     */
    function parseContourMap(rows) {
        const clean = (rows || [])
            .map(r => (r || []).map(c => (c == null ? '' : String(c).trim())))
            .filter(r => r.some(c => c !== ''));
        if (clean.length < 2) return { ok: false };

        const numCols = Math.max(...clean.map(r => r.length));
        if (numCols === 3 && clean.every(r => r.length === 3)) {
            return parseLongFormat(clean);
        }
        return parseMatrixFormat(clean);
    }

    /**
     * [zmin, zmax]の範囲にちょうど良い等高線レベルを生成する（1/2/5 × 10^kの刻み）。
     * @param {number} zmin
     * @param {number} zmax
     * @param {number} [target=10] 目安とするレベル数
     * @returns {number[]} 昇順のレベル配列（範囲が不正なら空配列）
     */
    function niceLevels(zmin, zmax, target = 10) {
        if (!Number.isFinite(zmin) || !Number.isFinite(zmax) || zmin >= zmax) return [];
        const range = zmax - zmin;
        const roughStep = range / target;
        const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
        const candidates = [1, 2, 5, 10].map(m => m * mag);

        let step = candidates[0];
        let bestDiff = Infinity;
        for (const c of candidates) {
            const diff = Math.abs(range / c - target);
            if (diff < bestDiff) { bestDiff = diff; step = c; }
        }

        const start = Math.ceil(zmin / step) * step;
        const levels = [];
        for (let v = start; v <= zmax + 1e-9; v += step) {
            levels.push(Math.round(v / step) * step); // 浮動小数点誤差の丸め
        }
        return levels;
    }

    /** 2点(xA,yA,vA)-(xB,yB,vB)を結ぶ辺上でv=levelとなる点を線形補間で求める */
    function edgeCrossPoint(xA, yA, vA, xB, yB, vB, level) {
        if (vA === vB) return [xA, yA];
        const t = (level - vA) / (vB - vA);
        return [xA + t * (xB - xA), yA + t * (yB - yA)];
    }

    /**
     * marching squaresで等高線の線分を計算する（ポリライン連結はしない=線分の配列を返す）。
     * NaNを含むセルはスキップする。鞍点（4辺すべて交差）は中心の平均値で連結方向を決める。
     * @param {number[]} xs 昇順のXブレークポイント
     * @param {number[]} ys 昇順のYブレークポイント
     * @param {number[][]} zz zz[yi][xi]のZグリッド（NaN穴あり）
     * @param {number} level 等高線のレベル
     * @returns {Array<[[number,number],[number,number]]>} 線分の配列
     */
    function computeIsoSegments(xs, ys, zz, level) {
        const segments = [];
        if (!xs || !ys || !zz || xs.length < 2 || ys.length < 2) return segments;

        for (let j = 0; j < ys.length - 1; j++) {
            for (let i = 0; i < xs.length - 1; i++) {
                const v00 = zz[j][i],     v10 = zz[j][i + 1];
                const v01 = zz[j + 1][i], v11 = zz[j + 1][i + 1];
                if (![v00, v10, v01, v11].every(Number.isFinite)) continue; // NaNセルskip

                const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
                // 各角がlevel以上かどうか（境界=levelちょうどは「以上」側に倒す）
                const a00 = v00 >= level, a10 = v10 >= level, a01 = v01 >= level, a11 = v11 >= level;
                // セルの4辺を反時計回りに並べる: bottom→right→top→left
                const edges = [
                    { cross: a00 !== a10, pt: () => edgeCrossPoint(x0, y0, v00, x1, y0, v10, level) },
                    { cross: a10 !== a11, pt: () => edgeCrossPoint(x1, y0, v10, x1, y1, v11, level) },
                    { cross: a11 !== a01, pt: () => edgeCrossPoint(x1, y1, v11, x0, y1, v01, level) },
                    { cross: a01 !== a00, pt: () => edgeCrossPoint(x0, y1, v01, x0, y0, v00, level) },
                ];
                const crossed = edges.map((e, idx) => e.cross ? idx : -1).filter(idx => idx >= 0);

                if (crossed.length === 2) {
                    segments.push([edges[crossed[0]].pt(), edges[crossed[1]].pt()]);
                } else if (crossed.length === 4) {
                    // 鞍点: 対角2組のどちらを繋ぐかをセル中心値の平均で決める（標準的な曖昧性解消）
                    const center = (v00 + v10 + v01 + v11) / 4;
                    if (center >= level) {
                        segments.push([edges[0].pt(), edges[3].pt()]);
                        segments.push([edges[1].pt(), edges[2].pt()]);
                    } else {
                        segments.push([edges[0].pt(), edges[1].pt()]);
                        segments.push([edges[2].pt(), edges[3].pt()]);
                    }
                }
                // crossed.length === 0 → このセルに等高線なし
            }
        }
        return segments;
    }

    /** 昇順配列arrの中でvが属するセルの開始インデックス（[0, arr.length-2]にクランプ）を二分探索で求める */
    function findCellIndex(arr, v) {
        const n = arr.length;
        if (v <= arr[0]) return 0;
        if (v >= arr[n - 1]) return n - 2;
        let lo = 0, hi = n - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= v) lo = mid; else hi = mid;
        }
        return lo;
    }

    /**
     * 等高線マップ上の任意点(x,y)をZグリッドから双線形補間で読み取る（ツールチップ用）。
     * 範囲外、またはセルの4隅にNaNが含まれる場合はNaNを返す。
     */
    function bilinearZ(xs, ys, zz, x, y) {
        if (!xs || !ys || !xs.length || !ys.length) return NaN;
        if (x < xs[0] || x > xs[xs.length - 1] || y < ys[0] || y > ys[ys.length - 1]) return NaN;

        const i = findCellIndex(xs, x);
        const j = findCellIndex(ys, y);
        const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
        const v00 = zz[j][i], v10 = zz[j][i + 1], v01 = zz[j + 1][i], v11 = zz[j + 1][i + 1];
        if (![v00, v10, v01, v11].every(Number.isFinite)) return NaN;

        const tx = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
        const ty = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
        const vx0 = v00 + (v10 - v00) * tx;
        const vx1 = v01 + (v11 - v01) * tx;
        return vx0 + (vx1 - vx0) * ty;
    }

    const api = {
        linearRegression,
        parseContourMap,
        niceLevels,
        computeIsoSegments,
        bilinearZ,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CSVXYUtils = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
