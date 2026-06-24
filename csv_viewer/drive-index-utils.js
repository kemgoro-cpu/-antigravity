/**
 * drive-index-utils.js
 * 走行サイクル（モード走行）データの「ドライビングインデックス」（SAE J2951系）と
 * 燃費を計算する純粋関数群。DOM や app の状態に依存しない（＝単体テストしやすい）。
 *
 * window.DriveIndex として公開する。
 *
 * 指標（実測トレース v / 目標トレース u を比較）:
 *   - RMSSE : 速度誤差のRMS [km/h]
 *   - IWR   : 慣性仕事の目標比偏差 [%]
 *   - ASCR  : 絶対速度変化の目標比偏差 [%]（絶対加速度の時間積分）
 *   - DR    : 走行距離の目標比偏差 [%]
 *   - ER/EER: エネルギー/エネルギー経済の目標比偏差 [%]（走行抵抗A/B/Cと質量がある時のみ）
 *   - 燃費  : Fuel_Rate積算 ÷ 走行距離（km/L, L/100km）
 *
 * 注: SAE J2951 / WLTP の公開手順に合わせ、目標・実測を10Hzグリッドに線形補間してから計算する。
 */
(function () {
    'use strict';

    const DRIVE_INDEX_SAMPLE_HZ = 10;
    const DRIVE_INDEX_SAMPLE_DT = 1 / DRIVE_INDEX_SAMPLE_HZ;
    const INERTIA_FACTOR = 1.015;

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
     * 指定Hzの等間隔グリッドに線形補間した値配列を返す。
     * @param {number} [startSec] 範囲開始（省略時は先頭時刻）
     * @param {number} [endSec]   範囲終了（省略時は末尾時刻）
     * @param {number} [hz]       サンプリング周波数
     * @returns {{ time:number[], values:number[], hz:number, dt:number }}
     */
    function resampleTrace(timeArr, valArr, startSec, endSec, hz = DRIVE_INDEX_SAMPLE_HZ) {
        const t0 = startSec != null ? startSec : timeArr[0];
        const t1 = endSec   != null ? endSec   : timeArr[timeArr.length - 1];
        const dt = 1 / hz;
        const time = [], values = [];
        const k0 = Math.ceil(t0 * hz - 1e-9);
        const k1 = Math.floor(t1 * hz + 1e-9);
        for (let k = k0; k <= k1; k++) {
            const t = k * dt;
            time.push(t);
            values.push(interp1(timeArr, valArr, t));
        }
        return { time, values, hz, dt };
    }

    /** 後方互換用。標準計算には使わない。 */
    function resampleTo1Hz(timeArr, valArr, startSec, endSec) {
        return resampleTrace(timeArr, valArr, startSec, endSec, 1);
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
     * target/actual/fuel は同じ10Hzグリッドの配列（速度km/h、燃料L/h）。
     */
    function metricsForWindow(target, actual, fuel, roadLoad, dt = DRIVE_INDEX_SAMPLE_DT) {
        const N = Math.min(target.length, actual.length);
        if (N < 2) return null;
        const KMH2MS = 1 / 3.6;

        // ── RMSSE（速度誤差のRMS） ──
        let sse = 0, cnt = 0;
        for (let i = 0; i < N; i++) {
            const d = actual[i] - target[i];
            if (isFinite(d)) { sse += d * d; cnt++; }
        }
        const rmsse = cnt > 0 ? Math.sqrt(sse / cnt) : null;

        // 1トレース分の 慣性仕事(IW)・絶対速度変化(ASC)・距離・牽引エネルギー を計算
        const hasRL = !!roadLoad;
        const etw = hasRL && isFinite(roadLoad.mass) ? roadLoad.mass : 1;
        function traceWork(speedKmh) {
            let iw = 0, asc = 0, dist = 0, energy = 0;
            for (let i = 0; i < N - 1; i++) {
                const v0 = speedKmh[i]     * KMH2MS;
                const v1 = speedKmh[i + 1] * KMH2MS;
                if (!isFinite(v0) || !isFinite(v1)) continue;
                const a = (v1 - v0) / dt;              // 加速度[m/s^2]
                const dd = (v0 + v1) / 2 * dt;         // 距離増分[m]（台形）
                dist += dd;

                const inertialWork = INERTIA_FACTOR * etw * a * dd;
                if (inertialWork > 0) iw += inertialWork;
                asc += Math.abs(a) * dt;

                if (hasRL) {
                    const V = speedKmh[i];              // 走行抵抗はkm/hで係数定義される慣例
                    const F = (roadLoad.A + roadLoad.B * V + roadLoad.C * V * V)
                            + INERTIA_FACTOR * roadLoad.mass * a;
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
            if (er != null && dr != null && (1 + er / 100) !== 0) {
                eer = (1 - (1 + dr / 100) / (1 + er / 100)) * 100;
            }
        }

        // ── 燃費（実測速度ベースの走行距離を使う） ──
        const distanceKm = wv.dist / 1000;
        let fuelL = null, fuelKmPerL = null, fuelLper100km = null;
        if (fuel) {
            let vol = 0;
            for (let i = 0; i < N - 1; i++) {
                const fr = fuel[i];
                if (isFinite(fr)) vol += (fr / 3600) * dt; // L/h → L
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
            const tg = resampleTrace(time, target, start, end, DRIVE_INDEX_SAMPLE_HZ);
            const ac = resampleTrace(time, actual, start, end, DRIVE_INDEX_SAMPLE_HZ);
            const fu = fuelRate ? resampleTrace(time, fuelRate, start, end, DRIVE_INDEX_SAMPLE_HZ).values : null;
            return metricsForWindow(tg.values, ac.values, fu, rl, tg.dt);
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
        DRIVE_INDEX_SAMPLE_HZ,
        resampleTrace,
        resampleTo1Hz,
        detectCycle,
        computeMetrics,
    };
})();
