/**
 * drive-index-utils.js
 * 走行サイクル（モード走行）データの「ドライビングインデックス」（SAE J2951系）と
 * 燃費を計算する純粋関数群。DOM や app の状態に依存しない（＝単体テストしやすい）。
 *
 * window.DriveIndex として公開する。
 *
 * 指標（実測トレース v / 目標トレース u を比較）:
 *   - RMSSE : 速度誤差のRMS [km/h]
 *   - IWR   : 慣性仕事の目標比偏差 [%]（正の運動エネルギー増分の総和）
 *   - ASCR  : 絶対速度変化の目標比偏差 [%]（運動エネルギー増分の絶対値総和）
 *   - DR    : 走行距離の目標比偏差 [%]
 *   - ER/EER: エネルギー/エネルギー経済の目標比偏差 [%]（走行抵抗A/B/Cと質量がある時のみ）
 *   - 燃費  : Fuel_Rate積算 ÷ 走行距離（km/L, L/100km）
 *
 * 注: J2951 は 1Hz 基準なので、目標・実測を1秒グリッドに再サンプルしてから計算する。
 */
(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // 既知サイクルのレジストリ
    //   total    : 総時間[s]（モード判別の主キー）
    //   maxSpeed : 最大目標車速[km/h]（補助・表示用）
    //   phases   : フェーズ境界 [{ name, start, end }]（秒）
    // ─────────────────────────────────────────────────────────────
    const CYCLE_REGISTRY = [
        {
            id: 'nedc', name: 'NEDC', total: 1180, maxSpeed: 120,
            phases: [
                { name: 'Urban (UDC)',        start: 0,   end: 780  },
                { name: 'Extra-Urban (EUDC)', start: 780, end: 1180 },
            ],
        },
        {
            id: 'wltc3', name: 'WLTC Class 3', total: 1800, maxSpeed: 131.3,
            phases: [
                { name: 'Low',        start: 0,    end: 589  },
                { name: 'Medium',     start: 589,  end: 1022 },
                { name: 'High',       start: 1022, end: 1477 },
                { name: 'Extra-High', start: 1477, end: 1800 },
            ],
        },
        {
            id: 'mdc', name: 'MDC (Malaysia)', total: 1500, maxSpeed: 112,
            // マレーシアMDCは公的に一意なフェーズ境界が定まっていないため暫定（全体のみ）。
            // 実際の境界はモーダル上でユーザーが編集できる。
            phases: [
                { name: 'Total', start: 0, end: 1500 },
            ],
        },
    ];

    /** 線形補間（二分探索）。timeArr は昇順前提。範囲外は端値でクランプ。 */
    function interp1(timeArr, valArr, t) {
        const n = timeArr.length;
        if (n === 0) return NaN;
        if (t <= timeArr[0]) return valArr[0];
        if (t >= timeArr[n - 1]) return valArr[n - 1];
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (timeArr[mid] <= t) lo = mid; else hi = mid;
        }
        const t0 = timeArr[lo], t1 = timeArr[hi];
        const span = t1 - t0;
        if (span === 0) return valArr[lo];
        return valArr[lo] + (valArr[hi] - valArr[lo]) * ((t - t0) / span);
    }

    /**
     * 1秒グリッドに再サンプルした値配列を返す。
     * @param {number} [startSec] 範囲開始（省略時は先頭時刻）
     * @param {number} [endSec]   範囲終了（省略時は末尾時刻）
     * @returns {{ time:number[], values:number[] }}
     */
    function resampleTo1Hz(timeArr, valArr, startSec, endSec) {
        const t0 = startSec != null ? startSec : timeArr[0];
        const t1 = endSec   != null ? endSec   : timeArr[timeArr.length - 1];
        const time = [], values = [];
        for (let t = Math.ceil(t0); t <= Math.floor(t1); t++) {
            time.push(t);
            values.push(interp1(timeArr, valArr, t));
        }
        return { time, values };
    }

    /** 走行抵抗の入力を数値化。A/B/C/mass が全て有効数値ならオブジェクト、不足ならnull。 */
    function normalizeRoadLoad(rl) {
        if (!rl) return null;
        const A = parseFloat(rl.A), B = parseFloat(rl.B), C = parseFloat(rl.C), mass = parseFloat(rl.mass);
        if ([A, B, C, mass].every(x => isFinite(x))) return { A, B, C, mass };
        return null;
    }

    /** 目標比偏差 [%]。基準bが0や非数なら null。 */
    function pctDiff(a, b) {
        return (isFinite(a) && isFinite(b) && b !== 0) ? (a - b) / b * 100 : null;
    }

    /**
     * 1つの時間窓（フェーズ）について指標を計算する。
     * target/actual/fuel は同じ1秒グリッドの配列（速度km/h、燃料L/h）。
     */
    function metricsForWindow(target, actual, fuel, roadLoad) {
        const N = Math.min(target.length, actual.length);
        if (N < 2) return null;
        const KMH2MS = 1 / 3.6;
        const dt = 1; // 1秒グリッドなので区間幅は1s

        // ── RMSSE（速度誤差のRMS） ──
        let sse = 0, cnt = 0;
        for (let i = 0; i < N; i++) {
            const d = actual[i] - target[i];
            if (isFinite(d)) { sse += d * d; cnt++; }
        }
        const rmsse = cnt > 0 ? Math.sqrt(sse / cnt) : null;

        // 1トレース分の 慣性仕事(IW)・絶対速度変化(ASC)・距離・牽引エネルギー を計算
        const hasRL = !!roadLoad;
        function traceWork(speedKmh) {
            let iw = 0, asc = 0, dist = 0, energy = 0;
            for (let i = 0; i < N - 1; i++) {
                const v0 = speedKmh[i]     * KMH2MS;
                const v1 = speedKmh[i + 1] * KMH2MS;
                if (!isFinite(v0) || !isFinite(v1)) continue;
                const dKE = 0.5 * (v1 * v1 - v0 * v0); // 単位質量あたり運動エネルギー増分[J/kg]
                if (dKE > 0) iw += dKE;                // 正値のみ（加速の仕事）
                asc += Math.abs(dKE);                  // 絶対値（加減速とも）
                const dd = (v0 + v1) / 2 * dt;         // 距離増分[m]（台形）
                dist += dd;
                if (hasRL) {
                    const a = (v1 - v0) / dt;           // 加速度[m/s^2]
                    const V = speedKmh[i];              // 走行抵抗はkm/hで係数定義される慣例
                    const F = (roadLoad.A + roadLoad.B * V + roadLoad.C * V * V) + roadLoad.mass * a;
                    if (F > 0) energy += F * dd;        // 正の牽引仕事のみ[J]
                }
            }
            return { iw, asc, dist, energy };
        }
        const wv = traceWork(actual); // 実測（driven）
        const wu = traceWork(target); // 目標（target）

        const iwr  = pctDiff(wv.iw,   wu.iw);
        const ascr = pctDiff(wv.asc,  wu.asc);
        const dr   = pctDiff(wv.dist, wu.dist);

        let er = null, eer = null;
        if (hasRL && wu.energy > 0) {
            er = pctDiff(wv.energy, wu.energy);
            const econV = wv.energy > 0 ? wv.dist / wv.energy : null; // 距離/エネルギー
            const econU = wu.energy > 0 ? wu.dist / wu.energy : null;
            if (econV != null && econU != null) eer = pctDiff(econV, econU);
        }

        // ── 燃費（実測速度ベースの走行距離を使う） ──
        const distanceKm = wv.dist / 1000;
        let fuelL = null, fuelKmPerL = null, fuelLper100km = null;
        if (fuel) {
            let vol = 0;
            for (let i = 0; i < N - 1; i++) {
                const fr = fuel[i];
                if (isFinite(fr)) vol += (fr / 3600) * dt; // L/h → L（1s分）
            }
            fuelL = vol;
            if (vol > 0 && distanceKm > 0) {
                fuelKmPerL    = distanceKm / vol;
                fuelLper100km = vol / distanceKm * 100;
            }
        }

        return { rmsse, iwr, ascr, dr, er, eer, distanceKm, fuelL, fuelKmPerL, fuelLper100km };
    }

    /**
     * 目標車速トレースの総時間から既知サイクルを判別する。
     * @returns {{ id, name, phases, confidence, total, maxSpeed }}
     *   未判別時は id=null / phases=[] を返す（呼び出し側は全体のみ表示する）。
     */
    function detectCycle(timeArr, targetSpeedArr) {
        if (!timeArr || timeArr.length < 2) return null;
        const total = timeArr[timeArr.length - 1] - timeArr[0];
        let maxSpeed = 0;
        for (let i = 0; i < targetSpeedArr.length; i++) {
            const v = targetSpeedArr[i];
            if (isFinite(v) && v > maxSpeed) maxSpeed = v;
        }
        // 総時間が最も近い候補を選ぶ（許容差±5%以内なら採用）
        let best = null, bestErr = Infinity;
        for (const c of CYCLE_REGISTRY) {
            const err = Math.abs(total - c.total) / c.total;
            if (err < bestErr) { bestErr = err; best = c; }
        }
        if (!best || bestErr > 0.05) {
            return { id: null, name: '未判別', phases: [], confidence: 0, total, maxSpeed };
        }
        return {
            id: best.id, name: best.name,
            phases: best.phases.map(p => ({ ...p })),
            confidence: 1 - bestErr, total, maxSpeed,
        };
    }

    /**
     * 指標と燃費を「全体＋フェーズ別」で計算する。
     * @param {object} opts
     *   time, target, actual : 同じ時間軸の配列（actual/targetは速度km/h）
     *   fuelRate             : 実測Fuel_Rate配列[L/h]（省略可）
     *   phases               : [{name,start,end}]（省略/空なら全体のみ）
     *   roadLoad             : {A,B,C,mass}（省略可。揃っていればER/EERを計算）
     * @returns {{ total, phases:[{name,...}] } | null}
     */
    function computeMetrics(opts) {
        const { time, target, actual, fuelRate, phases, roadLoad } = opts || {};
        if (!time || !target || !actual || time.length < 2) return null;
        const rl = normalizeRoadLoad(roadLoad);

        function windowMetrics(start, end) {
            const tg = resampleTo1Hz(time, target, start, end).values;
            const ac = resampleTo1Hz(time, actual, start, end).values;
            const fu = fuelRate ? resampleTo1Hz(time, fuelRate, start, end).values : null;
            return metricsForWindow(tg, ac, fu, rl);
        }

        const t0 = time[0], t1 = time[time.length - 1];
        const total = windowMetrics(t0, t1);
        const phaseResults = (phases || []).map(p => ({
            name: p.name,
            start: p.start, end: p.end,
            ...(windowMetrics(p.start, p.end) || {}),
        }));
        return { total, phases: phaseResults, hasRoadLoad: !!rl };
    }

    window.DriveIndex = {
        CYCLE_REGISTRY,
        resampleTo1Hz,
        detectCycle,
        computeMetrics,
    };
})();
