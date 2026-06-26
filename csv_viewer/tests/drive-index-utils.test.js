const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'drive-index-utils.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(code, context);

const DriveIndex = context.window.DriveIndex;

function approx(actual, expected, eps = 1e-9) {
    assert.ok(
        Math.abs(actual - expected) <= eps,
        `expected ${actual} to be within ${eps} of ${expected}`,
    );
}

{
    const sampled = DriveIndex.resampleTrace([0, 1], [0, 10]);
    assert.strictEqual(DriveIndex.DRIVE_INDEX_SAMPLE_HZ, 10);
    assert.strictEqual(sampled.values.length, 11);
    approx(sampled.time[5], 0.5);
    approx(sampled.values[5], 5);
}

{
    const wltc = DriveIndex.CYCLE_REGISTRY.find(c => c.id === 'wltc3');
    assert.ok(wltc);
    assert.strictEqual(wltc.name, 'WLTC 4-phase (Class 3)');
    assert.strictEqual(JSON.stringify(wltc.phases.map(p => [p.name, p.start, p.end])), JSON.stringify([
        ['Low', 0, 589],
        ['Medium', 589, 1022],
        ['High', 1022, 1477],
        ['Extra-High', 1477, 1800],
    ]));
}

{
    const result = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 10],
    }).total;

    approx(result.rmsse, 0);
    approx(result.iwr, 0);
    approx(result.ascr, 0);
    approx(result.dr, 0);
}

{
    // 実測=目標の2倍（線形ランプ）。前処理・中心差分・右端矩形は線形性を保つので
    //   距離は2倍 → DR=100%、絶対加速度も2倍 → ASCR=100%、慣性仕事は4倍 → IWR=300%。
    const result = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],
    }).total;

    approx(result.ascr, 100, 1e-9);
    approx(result.iwr, 300, 1e-9);
    approx(result.dr, 100, 1e-9);
}

{
    // WOT（アクセル開度AP≧95%）の点は実測側の積算に目標寄与を使う → 実測が目標と違っても指標は0。
    const wotAll = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],
        ap: [100, 100], // 全点WOT
    }).total;
    approx(wotAll.iwr, 0, 1e-9);
    approx(wotAll.ascr, 0, 1e-9);
    approx(wotAll.dr, 0, 1e-9);

    // しきい値未満（94%）はWOTにならない → 通常通り差が出る。
    const notWot = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],
        ap: [94, 94],
    }).total;
    approx(notWot.iwr, 300, 1e-9);

    // GEAR=99でも同様（WOTとORで判定）。
    const gear99 = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],
        gear: [99, 99],
    }).total;
    approx(gear99.iwr, 0, 1e-9);
}

{
    // RMSSEは WOTでなく かつ GEAR=0 の点だけ集計。定常オフセット5km/hで確認。
    const base = { time: [0, 1], target: [10, 10], actual: [15, 15] };
    const counted = DriveIndex.computeMetrics({ ...base, ap: [0, 0], gear: [0, 0] }).total;
    approx(counted.rmsse, 5, 1e-9);

    // 全点WOT（AP=100）は除外 → 集計点ゼロ → rmsse=null。
    const excludedWot = DriveIndex.computeMetrics({ ...base, ap: [100, 100], gear: [0, 0] }).total;
    assert.strictEqual(excludedWot.rmsse, null);

    // GEARが0以外（99でなくても）も除外対象。
    const excludedGear = DriveIndex.computeMetrics({ ...base, ap: [0, 0], gear: [3, 3] }).total;
    assert.strictEqual(excludedGear.rmsse, null);

    // apThresholdは変更可能（90%しきい→AP=92でWOT扱い）。
    const customThr = DriveIndex.computeMetrics({ ...base, ap: [92, 92], apThreshold: 90 }).total;
    assert.strictEqual(customThr.rmsse, null);
}

{
    // 前処理: 0.03m/s(=0.108km/h)未満はゼロ化。0.05km/hは全点ゼロ、10km/hは保持。
    const tiny = DriveIndex.preprocessSpeed([0.05, 0.05, 0.05, 0.05, 0.05]);
    assert.ok(tiny.every(v => v === 0));
    const big = DriveIndex.preprocessSpeed([10, 10, 10, 10, 10]);
    assert.ok(big.every(v => v === 10));

    // 端2点は平均せず元値のまま（縮小窓平均にしない）。
    const edge = DriveIndex.preprocessSpeed([100, 0, 0, 0, 0, 0, 0]);
    approx(edge[0], 100, 1e-9);   // 先頭は元値
    assert.ok(edge[2] !== 0);     // 内側は平滑化で値が入る
}

{
    // 中心差分加速度: 端点は0、内側は (v[i+1]-v[i-1])/(2dt)。
    const a = DriveIndex.centralAccel([0, 1, 2, 3], 1);
    approx(a[0], 0, 1e-12);
    approx(a[1], 1, 1e-12);
    approx(a[2], 1, 1e-12);
    approx(a[3], 0, 1e-12);
}

{
    const result = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],
        roadLoad: { A: 100, B: 0, C: 0, mass: 1000 },
    }).total;
    const expectedEer = (1 - (1 + result.dr / 100) / (1 + result.er / 100)) * 100;

    approx(result.eer, expectedEer, 1e-9);
}

{
    const wltc = DriveIndex.CYCLE_REGISTRY.find(c => c.id === 'wltc3');
    const result = DriveIndex.computeMetrics({
        time: [0, 1800],
        target: [10, 10],
        actual: [10, 10],
        fuelRate: [36, 36],
        phases: wltc.phases,
    });

    assert.strictEqual(result.phases.length, 4);
    approx(result.total.fuelL, 18, 1e-9);
    approx(result.phases[0].fuelL, 5.89, 1e-9);
    approx(result.phases[1].fuelL, 4.33, 1e-9);
    approx(result.phases[2].fuelL, 4.55, 1e-9);
    approx(result.phases[3].fuelL, 3.23, 1e-9);
}

console.log('drive-index-utils tests passed');
