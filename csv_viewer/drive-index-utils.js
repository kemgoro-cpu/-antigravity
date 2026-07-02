/**
 * drive-index-utils.js
 * 走行サイクル（モード走行）データの「ドライビングインデックス」（SAE J2951系）と
 * 燃費を計算する純粋関数群。DOM や app の状態に依存しない（＝単体テストしやすい）。
 *
 * parser-utils.jsと同じUMDパターン: ブラウザでは root.DriveIndex、Nodeでは module.exports。
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
(function (root) {
    'use strict';

    // 目標車速トレースデータ(drive-cycles-data.js)。
    // Nodeではrequire、ブラウザではグローバル参照（index.htmlでcycles→indexの順に読み込む）
    const DriveCycleData = (typeof module !== 'undefined' && module.exports)
        ? require('./drive-cycles-data.js')
        : (root.DriveCycleData || null);

    const DRIVE_INDEX_SAMPLE_HZ = 10;
    const DRIVE_INDEX_SAMPLE_DT = 1 / DRIVE_INDEX_SAMPLE_HZ;
    const INERTIA_FACTOR = 1.015;

    // ─────────────────────────────────────────────────────────────
    // 既知サイクル（内蔵モード）のレジストリ
    //   traceId  : drive-cycles-data.js (DriveCycleData) の目標車速トレースのキー
    //   trimEnd  : トレースの打ち切り時間[s]（WLTC 3フェーズ版を 4フェーズ版から導出するため）
    //   total    : 総時間[s]（モード判別の主キー）
    //   maxSpeed : 最大目標車速[km/h]（補助・表示用）
    //   phases   : フェーズ境界 [{ name, start, end }]（秒）
    //
    // WLTC Class 3 は 3a/3b で同じフェーズ区切り（Low/Extra-High は共通、Medium/High の
    // 車速波形のみクラス差）。3フェーズ版（日本国内型）は Extra-High を除いた Low+Medium+High。
    // ─────────────────────────────────────────────────────────────
    const WLTC_LOW    = { name: 'Low',        start: 0,    end: 589  };
    const WLTC_MED    = { name: 'Medium',     start: 589,  end: 1022 };
    const WLTC_HIGH   = { name: 'High',       start: 1022, end: 1477 };
    const WLTC_EXHIGH = { name: 'Extra-High', start: 1477, end: 1800 };
    const wltcPhases3 = () => [{ ...WLTC_LOW }, { ...WLTC_MED }, { ...WLTC_HIGH }];
    const wltcPhases4 = () => [{ ...WLTC_LOW }, { ...WLTC_MED }, { ...WLTC_HIGH }, { ...WLTC_EXHIGH }];

    const CYCLE_REGISTRY = [
        {
            id: 'nedc', name: 'NEDC', traceId: 'nedc', total: 1180, maxSpeed: 120,
            phases: [
                { name: 'Urban (UDC)',        start: 0,   end: 780  },
                { name: 'Extra-Urban (EUDC)', start: 780, end: 1180 },
            ],
        },
        // 判別時の既定優先のため、より一般的な 3b を先に置く（同一総時間の同点は先頭を採用）。
        {
            id: 'wltc3b_4', name: 'WLTC Class 3b (4フェーズ)', traceId: 'wltc_3b',
            total: 1800, maxSpeed: 131.3, phases: wltcPhases4(),
        },
        {
            id: 'wltc3b_3', name: 'WLTC Class 3b (3フェーズ)', traceId: 'wltc_3b', trimEnd: 1477,
            total: 1477, maxSpeed: 97.4, phases: wltcPhases3(),
        },
        {
            id: 'wltc3a_4', name: 'WLTC Class 3a (4フェーズ)', traceId: 'wltc_3a',
            total: 1800, maxSpeed: 131.3, phases: wltcPhases4(),
        },
        {
            id: 'wltc3a_3', name: 'WLTC Class 3a (3フェーズ)', traceId: 'wltc_3a', trimEnd: 1477,
            total: 1477, maxSpeed: 97.4, phases: wltcPhases3(),
        },
    ];

    // 旧サイクルIDの読み替えマップ（設定マイグレーション・後方互換用）。単一情報源はここ。
    // settings-utils.jsのマイグレーションもこのマップを参照する（v3以前 → v4）。
    //   'wltc3'（旧 WLTC 4-phase Class 3）→ 'wltc3b_4'。
    //   'mdc'（内蔵廃止。独自モードで扱う）→ null（保存設定のcycleIdを自動判別に戻す）。
    const LEGACY_CYCLE_ID = { wltc3: 'wltc3b_4', mdc: null };

    /**
     * 旧サイクルIDを現行IDへ読み替える（未知IDはそのまま返す）。
     * null読み替え（mdc等の廃止ID）は「現行IDが存在しない」ことを意味するため、
     * 実行時解決では素通しになる（呼び出し側のレジストリ照合でnullに落ちる）。
     */
    function resolveCycleId(id) {
        return (id && LEGACY_CYCLE_ID[id]) || id;
    }

    /**
     * サイクルID から目標車速トレース { time:[s], speed:[km/h] } を返す。
     * 内蔵サイクルは DriveCycleData（drive-cycles-data.js）から取得（trimEnd を適用）。
     * 独自モードは customModes 配列内の { id, trace:{time,speed} } を返す。
     * 見つからなければ null。
     * @param {string} cycleId
     * @param {Array}  [customModes] ユーザー定義モードの配列
     */
    function getCycleTrace(cycleId, customModes) {
        const id = resolveCycleId(cycleId);
        const c = CYCLE_REGISTRY.find(x => x.id === id);
        if (c && c.traceId) {
            return DriveCycleData ? DriveCycleData.trace(c.traceId, c.trimEnd) : null;
        }
        if (customModes && customModes.length) {
            const m = customModes.find(x => x.id === id);
            if (m && m.trace && Array.isArray(m.trace.time) && Array.isArray(m.trace.speed)) {
                return { time: m.trace.time.slice(), speed: m.trace.speed.slice() };
            }
        }
        return null;
    }

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

    /**
     * 実測車速を目標サイクルへ時間整合させる。
     * 計測データはモード前後に余分なデータ（開始準備・終了後）を含むため、目標トレースが
     * 実測のどこから始まるかを RMSE 最小化で探す。前後の余分データは窓外として無視される。
     *
     * @param {number[]} actualTime  実測の時間軸[s]
     * @param {number[]} actualSpeed 実測車速[km/h]
     * @param {number[]} targetTime  目標トレースの時間軸[s]（0..T 想定）
     * @param {number[]} targetSpeed 目標車速[km/h]
     * @param {object} [opts] { coarse, fine } 探索ステップ数
     * @returns {{ offset:number, rmse:number, start:number }}
     *   offset: targetTime に足すと実測時刻になる値（targetTimeMeasured = targetTime + offset）。
     *   start : サイクル開始に対応する実測時刻（= targetTime[0] + offset）。
     */
    function alignActualToCycle(actualTime, actualSpeed, targetTime, targetSpeed, opts) {
        opts = opts || {};
        const nT = targetTime.length, nA = actualTime.length;
        if (nT < 2 || nA < 2) return { offset: 0, rmse: Infinity, start: targetTime[0] || 0 };
        const T0 = targetTime[0], T1 = targetTime[nT - 1];
        const aT0 = actualTime[0], aT1 = actualTime[nA - 1];

        // 照合は約1Hz相当に間引いて行う（探索を高速化）
        const step = Math.max(1, Math.round(nT / 1800));
        const tPts = [], tVals = [];
        for (let i = 0; i < nT; i += step) { tPts.push(targetTime[i]); tVals.push(targetSpeed[i]); }

        // offset の探索範囲: 目標窓 [T0+offset, T1+offset] が実測内に収まる範囲
        const lo = aT0 - T0;
        let hi = aT1 - T1;
        if (hi < lo) hi = lo; // 実測がサイクルより短い→部分一致（範囲を1点に）

        function rmseAt(offset) {
            let sse = 0, n = 0;
            for (let i = 0; i < tPts.length; i++) {
                const m = tPts[i] + offset;            // 対応する実測時刻
                if (m < aT0 || m > aT1) continue;      // 範囲外はスキップ
                const d = interp1(actualTime, actualSpeed, m) - tVals[i];
                if (isFinite(d)) { sse += d * d; n++; }
            }
            // 重なりが少なすぎる候補は不利にする（端で少数点だけ一致するのを防ぐ）
            return n >= tPts.length * 0.5 ? Math.sqrt(sse / n) : Infinity;
        }

        const span = hi - lo;
        let bestOff = lo, bestRmse = rmseAt(lo);
        if (span > 0) {
            const COARSE = opts.coarse || 300;
            for (let s = 1; s <= COARSE; s++) {
                const off = lo + span * (s / COARSE);
                const r = rmseAt(off);
                if (r < bestRmse) { bestRmse = r; bestOff = off; }
            }
            // 細探索（粗ステップ幅の前後）
            const fineW = span / COARSE * 2;
            const FINE = opts.fine || 200;
            for (let s = 0; s <= FINE; s++) {
                const off = bestOff - fineW + (2 * fineW) * (s / FINE);
                if (off < lo - 1e-9 || off > hi + 1e-9) continue;
                const r = rmseAt(off);
                if (r < bestRmse) { bestRmse = r; bestOff = off; }
            }
        }
        return { offset: bestOff, rmse: bestRmse, start: T0 + bestOff };
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
    function detectCycle(timeArr, speedArr) {
        if (!timeArr || timeArr.length < 2) return null;
        const total = timeArr[timeArr.length - 1] - timeArr[0];
        let maxSpeed = 0;
        // speedArr（実測 or 目標車速）は省略可。あれば最高車速を補助情報として算出。
        if (speedArr) {
            for (let i = 0; i < speedArr.length; i++) {
                const v = speedArr[i];
                if (isFinite(v) && v > maxSpeed) maxSpeed = v;
            }
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
     *
     * 目標と実測は別々の時間軸を持てる（目標＝法規トレースの 0..N 秒、実測＝計測CSVの時間軸）。
     * 各窓 [start,end] で目標・実測・燃料をそれぞれ自前の時間軸から10Hzグリッドへ補間して比較する。
     * 全体窓は目標トレース（＝法規サイクル）の範囲を用いる。
     *
     * @param {object} opts
     *   target, actual : 速度配列[km/h]
     *   time           : 目標・実測共通の時間軸[s]（旧API。targetTime/actualTime省略時のフォールバック）
     *   targetTime     : 目標の時間軸[s]（省略時 time）
     *   actualTime     : 実測の時間軸[s]（省略時 time）
     *   fuelRate       : 実測Fuel_Rate配列[L/h]（省略可）
     *   fuelTime       : 燃料の時間軸[s]（省略時 actualTime→time）
     *   phases         : [{name,start,end}]（省略/空なら全体のみ）
     *   roadLoad       : {A,B,C,mass}（省略可。揃っていればER/EERを計算）
     * @returns {{ total, phases:[{name,...}] } | null}
     */
    function computeMetrics(opts) {
        const { time, target, actual, fuelRate, phases, roadLoad,
                targetTime, actualTime, fuelTime } = opts || {};
        const tTime = targetTime || time;
        const aTime = actualTime || time;
        const fTime = fuelTime || actualTime || time;
        if (!target || !actual || !tTime || !aTime || tTime.length < 2 || aTime.length < 2) return null;
        const rl = normalizeRoadLoad(roadLoad);

        function windowMetrics(start, end) {
            const tg = resampleTrace(tTime, target, start, end, DRIVE_INDEX_SAMPLE_HZ);
            const ac = resampleTrace(aTime, actual, start, end, DRIVE_INDEX_SAMPLE_HZ);
            const fu = fuelRate ? resampleTrace(fTime, fuelRate, start, end, DRIVE_INDEX_SAMPLE_HZ).values : null;
            return metricsForWindow(tg.values, ac.values, fu, rl, tg.dt);
        }

        // 全体窓は法規サイクル（目標トレース）の範囲。旧API（共通時間軸）では time と一致。
        const t0 = tTime[0], t1 = tTime[tTime.length - 1];
        const total = windowMetrics(t0, t1);
        const phaseResults = (phases || []).map(p => ({
            name: p.name,
            start: p.start, end: p.end,
            ...(windowMetrics(p.start, p.end) || {}),
        }));
        return { total, phases: phaseResults, hasRoadLoad: !!rl };
    }

    const api = {
        CYCLE_REGISTRY,
        LEGACY_CYCLE_ID,
        DRIVE_INDEX_SAMPLE_HZ,
        resampleTrace,
        resampleTo1Hz,
        resolveCycleId,
        getCycleTrace,
        alignActualToCycle,
        detectCycle,
        computeMetrics,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.DriveIndex = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
