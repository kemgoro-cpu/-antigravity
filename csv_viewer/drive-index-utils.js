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
 * 注: 一般的な理論式ではなく「既存の社内Excel計算と数値一致する」ことを目的とする。
 *     目標・実測を10Hzグリッドに線形補間 → 各々を独立に前処理（5点移動平均×2 → 0.03m/s未満ゼロ化）
 *     → 中心差分加速度（端点0）・右端矩形距離（v[i+1]·dt）で点ごとに積算する。
 *     WOT（アクセル開度AP≧95%）またはGEAR=99の点は実測側の積算に目標側の寄与を用い、
 *     RMSSEは WOTでなく かつ GEAR=0 の点のみ集計する。
 */
(function () {
    'use strict';

    const DRIVE_INDEX_SAMPLE_HZ = 10;
    const DRIVE_INDEX_SAMPLE_DT = 1 / DRIVE_INDEX_SAMPLE_HZ;
    const INERTIA_FACTOR = 1.015;
    const WOT_AP_THRESHOLD = 95; // アクセル開度[%]がこの値以上の点をWOT（全開）とみなす

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
            id: 'wltc3', name: 'WLTC 4-phase (Class 3)', total: 1800, maxSpeed: 131.3,
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

    // ─────────────────────────────────────────────────────────────
    // 前処理（社内Excel手順に一致させる）
    //   1) 5点移動平均を2回かける（端処理: 先頭2点・末尾2点は元値のまま。縮小窓平均はしない）
    //   2) 0.03 m/s 未満をゼロにする（速度はkm/h保持、判定だけm/s換算）
    // ─────────────────────────────────────────────────────────────
    const ZERO_SPEED_KMH = 0.03 * 3.6; // 0.03 m/s = 0.108 km/h

    /** 5点移動平均（端2点は元値のまま）。 */
    function movingAvg5(arr) {
        const n = arr.length;
        const out = arr.slice();
        for (let i = 2; i < n - 2; i++) {
            out[i] = (arr[i - 2] + arr[i - 1] + arr[i] + arr[i + 1] + arr[i + 2]) / 5;
        }
        return out;
    }

    /** 速度トレースの前処理（5点移動平均×2 → 0.03m/s未満ゼロ化）。入力・出力ともkm/h。 */
    function preprocessSpeed(speedKmh) {
        const sm = movingAvg5(movingAvg5(speedKmh));
        return sm.map(v => (isFinite(v) && Math.abs(v) < ZERO_SPEED_KMH ? 0 : v));
    }

    /** 中心差分による加速度（端点は0）。速度はkm/h、加速度は (km/h)/s 単位（比率指標では単位は相殺）。 */
    function centralAccel(speedKmh, dt) {
        const n = speedKmh.length;
        const a = new Array(n).fill(0);
        for (let i = 1; i < n - 1; i++) {
            a[i] = (speedKmh[i + 1] - speedKmh[i - 1]) / (2 * dt);
        }
        return a;
    }

    /**
     * 1トレース分の「点ごとの寄与」を計算する。
     *   dist[i]   : 右端矩形の距離増分 v[i+1]·dt（区間 i→i+1 の右端速度）
     *   iw[i]     : 正の慣性仕事 1.015·mass·a[i]·dist[i]（負は0）
     *   asc[i]    : |a[i]|·dt（絶対速度変化）
     *   energy[i] : 正の牽引仕事 (A+B·V+C·V² + 1.015·mass·a)·dist[i]（負は0、走行抵抗がある時のみ）
     */
    function pointContrib(speedKmh, accel, mass, roadLoad, dt) {
        const n = speedKmh.length;
        const iw = new Array(n), asc = new Array(n), dist = new Array(n), energy = new Array(n);
        for (let i = 0; i < n; i++) {
            const v = speedKmh[i], a = accel[i];
            // 右端矩形: 区間 i→i+1 の右端速度 v[i+1] を使う（社内Excel一致。末尾点は0）
            const vNext = (i + 1 < n) ? speedKmh[i + 1] : 0;
            const dd = vNext * dt;
            dist[i] = isFinite(dd) ? dd : 0;
            const w = INERTIA_FACTOR * mass * a * dist[i];
            iw[i] = isFinite(w) && w > 0 ? w : 0;
            asc[i] = isFinite(a) ? Math.abs(a) * dt : 0;
            if (roadLoad) {
                const F = (roadLoad.A + roadLoad.B * v + roadLoad.C * v * v)
                        + INERTIA_FACTOR * roadLoad.mass * a;
                const e = F * dist[i];
                energy[i] = isFinite(e) && F > 0 ? e : 0;
            } else {
                energy[i] = 0;
            }
        }
        return { iw, asc, dist, energy };
    }

    /** ソース系列を最近傍でグリッド時刻へ載せ替える（フラグ列の補間に使う）。 */
    function resampleNearest(timeArr, valArr, gridTime) {
        const n = timeArr.length;
        const out = new Array(gridTime.length);
        let j = 0;
        for (let i = 0; i < gridTime.length; i++) {
            const t = gridTime[i];
            while (j < n - 1 && timeArr[j + 1] <= t) j++;
            let v = valArr[j];
            if (j + 1 < n && Math.abs(timeArr[j + 1] - t) < Math.abs(t - timeArr[j])) v = valArr[j + 1];
            out[i] = v;
        }
        return out;
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
     *
     * 社内Excel手順への一致を最優先する:
     *   - 目標・実測を10Hzグリッドに補間後、各々を独立に前処理（5点移動平均×2→0.03m/s未満ゼロ）
     *   - 加速度は前処理後速度の中心差分（端点0）、距離増分は右端矩形 v[i+1]·dt
     *   - 慣性仕事/牽引仕事/絶対速度変化は点ごとに算出
     *   - WOT（アクセル開度AP≧95%）またはGEAR=99の点では、実測側の積算に実測値ではなく
     *     目標値の寄与を使う（＝事前置換せず、最後の積算でのみ Wid↔Wit を切り替える）
     *   - RMSSEは前処理後km/h差のRMS。ただし WOTでなく かつ GEAR=0 の点だけを集計対象にする
     *
     * @param {object} opts
     *   time, target, actual : 同じ時間軸の配列（actual/targetは速度km/h）
     *   fuelRate             : 実測Fuel_Rate配列[L/h]（省略可）
     *   ap                   : アクセル開度[%]配列（同じ時間軸。≧apThresholdの点をWOTとみなす。省略可）
     *   apThreshold          : WOT判定しきい値[%]（既定95）
     *   gear                 : GEARフラグ配列（同じ時間軸、99で目標側に切替・0以外はRMSSE除外。省略可）
     *   phases               : [{name,start,end}]（省略/空なら全体のみ）
     *   roadLoad             : {A,B,C,mass}（省略可。揃っていればER/EERを計算）
     * @returns {{ total, phases:[{name,...}] } | null}
     */
    function computeMetrics(opts) {
        const { time, target, actual, fuelRate, phases, roadLoad, ap, apThreshold, gear } = opts || {};
        if (!time || !target || !actual || time.length < 2) return null;
        const rl = normalizeRoadLoad(roadLoad);
        const dt = DRIVE_INDEX_SAMPLE_DT;
        const t0 = time[0], t1 = time[time.length - 1];

        // 全トレースを10Hzグリッドへ補間（前処理・端処理はトレース全体で一度だけ行う）
        const grid    = resampleTrace(time, target, t0, t1, DRIVE_INDEX_SAMPLE_HZ);
        const gtime   = grid.time;
        const tgtRaw  = grid.values;
        const actRaw  = resampleTrace(time, actual, t0, t1, DRIVE_INDEX_SAMPLE_HZ).values;
        const fuelG   = fuelRate ? resampleTrace(time, fuelRate, t0, t1, DRIVE_INDEX_SAMPLE_HZ).values : null;
        const apG     = ap   ? resampleTrace(time, ap, t0, t1, DRIVE_INDEX_SAMPLE_HZ).values : null; // アクセル開度%（線形補間）
        const gearG   = gear ? resampleNearest(time, gear, gtime) : null;                            // GEARフラグ（最近傍）
        const thr     = isFinite(apThreshold) ? apThreshold : WOT_AP_THRESHOLD;
        const N = gtime.length;

        // 目標・実測を別々に前処理
        const tgt = preprocessSpeed(tgtRaw);
        const act = preprocessSpeed(actRaw);

        // 前処理後速度からの中心差分加速度（端点0）
        const aTgt = centralAccel(tgt, dt);
        const aAct = centralAccel(act, dt);

        // 点ごとの寄与（目標/実測）
        const mass = rl && isFinite(rl.mass) ? rl.mass : 1;
        const cTgt = pointContrib(tgt, aTgt, mass, rl, dt);
        const cAct = pointContrib(act, aAct, mass, rl, dt);

        // WOT判定（AP≧しきい値）/ 99判定（目標側へ切替）/ RMSSE集計対象（WOTでなく かつ GEAR=0）
        const use99 = new Array(N), counted = new Array(N);
        for (let i = 0; i < N; i++) {
            const wotActive = apG ? apG[i] >= thr : false; // アクセル開度95%以上をWOTとみなす
            const g = gearG ? gearG[i] : 0;
            use99[i]   = wotActive || (g === 99);
            counted[i] = !wotActive && (g === 0);
        }

        function windowMetrics(start, end) {
            const lo = Math.max(0,     Math.ceil((start - gtime[0]) / dt - 1e-9));
            const hi = Math.min(N - 1, Math.floor((end - gtime[0]) / dt + 1e-9));
            if (hi - lo < 1) return null;

            // ── 指標（目標/実測の積算、99点は実測側を目標寄与に置換）──
            let drvIw = 0, tgtIw = 0, drvAsc = 0, tgtAsc = 0,
                drvDist = 0, tgtDist = 0, drvEn = 0, tgtEn = 0;
            // ── RMSSE（WOT=0 かつ GEAR=0 の点のみ）──
            let sse = 0, cnt = 0;
            // ── 燃費用の実測物理距離[m] ──
            let physDistM = 0;
            for (let i = lo; i <= hi; i++) {
                const drv = use99[i] ? cTgt : cAct; // 99点は実測側も目標寄与を使う
                drvIw   += drv.iw[i];   tgtIw   += cTgt.iw[i];
                drvAsc  += drv.asc[i];  tgtAsc  += cTgt.asc[i];
                drvDist += drv.dist[i]; tgtDist += cTgt.dist[i];
                drvEn   += drv.energy[i]; tgtEn += cTgt.energy[i];

                if (counted[i]) {
                    const d = act[i] - tgt[i];
                    if (isFinite(d)) { sse += d * d; cnt++; }
                }
                physDistM += cAct.dist[i] / 3.6; // 右端矩形距離(km/h·s)をm/s·s=mへ（指標と同じ距離定義）
            }

            const rmsse = cnt > 0 ? Math.sqrt(sse / cnt) : null;
            const iwr   = pctDiff(drvIw,   tgtIw);
            const ascr  = pctDiff(drvAsc,  tgtAsc);
            const dr    = pctDiff(drvDist, tgtDist);

            let er = null, eer = null;
            if (rl && tgtEn > 0) {
                er = pctDiff(drvEn, tgtEn);
                if (er != null && dr != null && (1 + er / 100) !== 0) {
                    eer = (1 - (1 + dr / 100) / (1 + er / 100)) * 100;
                }
            }

            // ── 燃費（実測速度ベースの走行距離を使う）──
            const distanceKm = physDistM / 1000;
            let fuelL = null, fuelKmPerL = null, fuelLper100km = null;
            if (fuelG) {
                let vol = 0;
                for (let i = lo; i < hi; i++) {
                    const fr = fuelG[i];
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
        preprocessSpeed,
        centralAccel,
        detectCycle,
        computeMetrics,
    };
})();
