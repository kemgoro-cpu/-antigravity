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

    const api = {
        linearRegression,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CSVXYUtils = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
