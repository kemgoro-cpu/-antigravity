const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// drive-cycles-data.js（window.DriveCycleData）と drive-index-utils.js（window.DriveIndex）を
// 同じコンテキストに読み込む。getCycleTrace は DriveCycleData を参照するため両方必要。
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'drive-cycles-data.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'drive-index-utils.js'), 'utf8'), context);

const DriveIndex = context.window.DriveIndex;
const DriveCycleData = context.window.DriveCycleData;

function approx(actual, expected, eps = 1e-9) {
    assert.ok(
        Math.abs(actual - expected) <= eps,
        `expected ${actual} to be within ${eps} of ${expected}`,
    );
}

// 速度配列[km/h]の総走行距離[km]（1Hz台形）
function distKm(speed) {
    let d = 0;
    for (let i = 0; i < speed.length - 1; i++) d += (speed[i] + speed[i + 1]) / 2;
    return d / 3600;
}

// ── resampleTrace（10Hzグリッド） ──
{
    const sampled = DriveIndex.resampleTrace([0, 1], [0, 10]);
    assert.strictEqual(DriveIndex.DRIVE_INDEX_SAMPLE_HZ, 10);
    assert.strictEqual(sampled.values.length, 11);
    approx(sampled.time[5], 0.5);
    approx(sampled.values[5], 5);
}

// ── レジストリ（4バリアント＋NEDC） ──
{
    const ids = DriveIndex.CYCLE_REGISTRY.map(c => c.id);
    for (const id of ['nedc', 'wltc3a_3', 'wltc3a_4', 'wltc3b_3', 'wltc3b_4']) {
        assert.ok(ids.includes(id), 'missing cycle id: ' + id);
    }
    const w4 = DriveIndex.CYCLE_REGISTRY.find(c => c.id === 'wltc3b_4');
    assert.strictEqual(w4.phases.length, 4);
    assert.strictEqual(JSON.stringify(w4.phases.map(p => [p.name, p.start, p.end])), JSON.stringify([
        ['Low', 0, 589],
        ['Medium', 589, 1022],
        ['High', 1022, 1477],
        ['Extra-High', 1477, 1800],
    ]));
    const w3 = DriveIndex.CYCLE_REGISTRY.find(c => c.id === 'wltc3b_3');
    assert.strictEqual(w3.phases.length, 3);  // Extra-High なし
    assert.strictEqual(w3.trimEnd, 1477);
}

// ── 旧IDの読み替え ──
{
    assert.strictEqual(DriveIndex.resolveCycleId('wltc3'), 'wltc3b_4');
    assert.strictEqual(DriveIndex.resolveCycleId('nedc'), 'nedc');
    assert.strictEqual(DriveIndex.resolveCycleId('wltc3b_4'), 'wltc3b_4');
}

// ── getCycleTrace: 内蔵トレースの取得と 3フェーズ打ち切り ──
{
    const t4 = DriveIndex.getCycleTrace('wltc3b_4');
    assert.strictEqual(t4.time.length, 1801);          // 0..1800 s
    assert.strictEqual(t4.time[t4.time.length - 1], 1800);

    const t3 = DriveIndex.getCycleTrace('wltc3b_3');
    assert.strictEqual(t3.time[t3.time.length - 1], 1477);  // trimEnd 1477
    assert.strictEqual(t3.time.length, 1478);
    approx(t3.speed[1000], t4.speed[1000]);            // 3フェーズは4フェーズの先頭1477秒と一致

    const ned = DriveIndex.getCycleTrace('nedc');
    assert.ok(ned.time.length >= 1180);
}

// ── getCycleTrace: カスタムモード（独自定義の時間-車速トレース）の取得 ──
{
    const customModes = [
        { id: 'cm_test1', name: 'MDC test', trace: { time: [0, 1, 2, 3], speed: [0, 10, 20, 0] } },
    ];
    // 内蔵レジストリを経由せず customModes から取得できる
    const t = DriveIndex.getCycleTrace('cm_test1', customModes);
    assert.ok(t);
    assert.deepStrictEqual(t.time, [0, 1, 2, 3]);
    assert.deepStrictEqual(t.speed, [0, 10, 20, 0]);

    // 未知のID（内蔵にもcustomModesにも無い）は null
    assert.strictEqual(DriveIndex.getCycleTrace('does_not_exist', customModes), null);
    assert.strictEqual(DriveIndex.getCycleTrace('cm_test1', []), null);          // customModesが空なら見つからない
    assert.strictEqual(DriveIndex.getCycleTrace('cm_test1', undefined), null);   // customModes省略時も安全にnull

    // 壊れたエントリ（trace形状が不正）は無視されnullを返す（例外を投げない）
    const broken = [{ id: 'cm_broken', name: 'X', trace: { time: [0, 1] } }]; // speed が無い
    assert.strictEqual(DriveIndex.getCycleTrace('cm_broken', broken), null);

    // 内蔵IDが優先され、customModesの同名IDでは上書きされない
    const shadow = [{ id: 'nedc', name: 'fake', trace: { time: [0, 1], speed: [0, 1] } }];
    const real = DriveIndex.getCycleTrace('nedc', shadow);
    assert.ok(real.time.length > 2); // 本物のNEDCトレース（2点のfakeではない）
}

// ── 3a と 3b: Low/Extra-High 共通、Medium/High 差分 ──
{
    const a = DriveIndex.getCycleTrace('wltc3a_4');
    const b = DriveIndex.getCycleTrace('wltc3b_4');
    for (const i of [0, 100, 300, 588, 1477, 1600, 1800]) approx(a.speed[i], b.speed[i]); // Low / Extra-High 共通
    let diff = false;
    for (let i = 589; i < 1477; i++) if (a.speed[i] !== b.speed[i]) { diff = true; break; }
    assert.ok(diff, '3a と 3b は Medium/High で異なるべき');
}

// ── トレース検証値（法規値との照合） ──
{
    const b = DriveIndex.getCycleTrace('wltc3b_4');
    let max = 0;
    for (const v of b.speed) if (v > max) max = v;
    approx(max, 131.3, 1e-6);                          // 最高車速 131.3 km/h
    assert.ok(Math.abs(distKm(b.speed) - 23.27) < 0.05, 'WLTC 3b 総距離 ≈ 23.27km, got ' + distKm(b.speed));

    const ned = DriveIndex.getCycleTrace('nedc');
    let nmax = 0;
    for (const v of ned.speed) if (v > nmax) nmax = v;
    approx(nmax, 120, 1e-6);                           // NEDC 最高車速 120 km/h
    assert.ok(Math.abs(distKm(ned.speed) - 11.0) < 0.1, 'NEDC 総距離 ≈ 11km, got ' + distKm(ned.speed));
}

// ── 指標の基本計算（共通時間軸・後方互換） ──
{
    const result = DriveIndex.computeMetrics({
        time: [0, 1], target: [0, 10], actual: [0, 10],
    }).total;
    approx(result.rmsse, 0);
    approx(result.iwr, 0);
    approx(result.ascr, 0);
    approx(result.dr, 0);
}

{
    const result = DriveIndex.computeMetrics({
        time: [0, 1], target: [0, 10], actual: [0, 20],
    }).total;
    approx(result.ascr, 100, 1e-9);
    approx(result.iwr, 300, 1e-9);
}

{
    const result = DriveIndex.computeMetrics({
        time: [0, 1], target: [0, 10], actual: [0, 20],
        roadLoad: { A: 100, B: 0, C: 0, mass: 1000 },
    }).total;
    const expectedEer = (1 - (1 + result.dr / 100) / (1 + result.er / 100)) * 100;
    approx(result.eer, expectedEer, 1e-9);
}

// ── 目標と実測で別々の時間軸（モードトレース＝目標、計測＝実測）でも整合する ──
{
    // 目標は 1Hz の v=10t、実測は 0.5s 刻みの同じ直線 → 10Hz補間後は一致し rmsse=0
    const result = DriveIndex.computeMetrics({
        targetTime: [0, 1, 2], target: [0, 10, 20],
        actualTime: [0, 0.5, 1, 1.5, 2], actual: [0, 5, 10, 15, 20],
    }).total;
    approx(result.rmsse, 0, 1e-9);
    approx(result.dr, 0, 1e-9);
}

// ── 時間整合: モード前後に余分データがあっても開始位置を検出できる ──
{
    // 目標: 0..4秒の山型。実測: 前に5秒・後ろに5秒のアイドル(0)を付けて埋め込む。
    const targetTime = [0, 1, 2, 3, 4], targetSpeed = [0, 10, 20, 10, 0];
    const mt = [], ms = [];
    for (let t = 0; t <= 14; t++) { mt.push(t); ms.push((t >= 5 && t <= 9) ? targetSpeed[t - 5] : 0); }

    const al = DriveIndex.alignActualToCycle(mt, ms, targetTime, targetSpeed);
    approx(al.start, 5, 1e-6);       // サイクル開始＝実測5秒を検出
    approx(al.rmse, 0, 1e-6);        // 完全一致

    // 整合結果で目標を実測時間軸へ写像 → 余分データは窓外で無視され rmsse≈0
    const ttM = targetTime.map(t => al.offset + t);
    const r = DriveIndex.computeMetrics({ targetTime: ttM, target: targetSpeed, actualTime: mt, actual: ms }).total;
    approx(r.rmsse, 0, 1e-6);
}

// ── フェーズ別計算（燃費）: wltc3b_4 の4フェーズ ──
{
    const wltc = DriveIndex.CYCLE_REGISTRY.find(c => c.id === 'wltc3b_4');
    const result = DriveIndex.computeMetrics({
        time: [0, 1800],
        target: [10, 10],
        actual: [10, 10],
        fuelRate: [36, 36],
        phases: wltc.phases,
    });
    assert.strictEqual(result.phases.length, 4);
    approx(result.total.fuelL, 18, 1e-9);
    approx(result.phases[0].fuelL, 5.89, 1e-9);  // Low 589s
    approx(result.phases[1].fuelL, 4.33, 1e-9);  // Medium 433s
    approx(result.phases[2].fuelL, 4.55, 1e-9);  // High 455s
    approx(result.phases[3].fuelL, 3.23, 1e-9);  // Extra-High 323s
}

console.log('drive-index-utils tests passed');
