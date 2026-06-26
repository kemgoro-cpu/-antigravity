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

// ── resampleTrace: 既定10Hz、線形補間 ──
{
    const sampled = DriveIndex.resampleTrace([0, 1], [0, 10]);
    assert.strictEqual(DriveIndex.DRIVE_INDEX_SAMPLE_HZ, 10);
    assert.strictEqual(sampled.values.length, 11);
    approx(sampled.time[5], 0.5);
    approx(sampled.values[5], 5);
}

// ── movingAverage5: 先頭2点・末尾2点は素通し、内部のみ5点平均 ──
{
    const flat = DriveIndex.movingAverage5([1, 1, 1, 1, 1]);
    flat.forEach(v => approx(v, 1));

    // n=7。i=0,1,5,6 は素通し、i=2..4 のみ平均
    const m = DriveIndex.movingAverage5([0, 0, 0, 0, 0, 0, 70]);
    approx(m[0], 0);   // 素通し
    approx(m[1], 0);   // 素通し
    approx(m[2], 0);   // mean(idx0..4)=0
    approx(m[3], 0);   // mean(idx1..5)=0
    approx(m[4], 14);  // mean(idx2..6)=mean(0,0,0,0,70)
    approx(m[5], 0);   // 素通し
    approx(m[6], 70);  // 素通し（末尾）

    // 線形ランプは移動平均で不変（内部は中心対称、端は素通し）
    const lin = DriveIndex.movingAverage5([0, 1, 2, 3, 4, 5, 6]);
    lin.forEach((v, i) => approx(v, i));
}

// ── inertialWork: 不変条件 ──
{
    // 定速（加速度ゼロ）→ 慣性仕事ゼロ
    const flat = new Array(20).fill(50);
    approx(DriveIndex.inertialWork(flat, 0.1, 1), 0);

    // 全区間 0.03 m/s 未満（=0.108 km/h 未満）→ ゼロ化されて慣性仕事ゼロ
    const tiny = [0, 0.02, 0.04, 0.06, 0.08, 0.1]; // km/h, すべて 0.03 m/s 未満
    approx(DriveIndex.inertialWork(tiny, 0.1, 1), 0);

    // 加速トレースは正の慣性仕事を生む
    const ramp = [];
    for (let i = 0; i < 50; i++) ramp.push(i); // 0→49 km/h
    assert.ok(DriveIndex.inertialWork(ramp, 0.1, 1) > 0);
}

// ── 目標＝実測なら全指標ゼロ ──
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

// ── ASCR / IWR の向き（実測が目標より速い）──
{
    const result = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],
    }).total;

    approx(result.ascr, 100, 1e-9); // |Δv| が2倍 → +100%
    assert.ok(result.iwr > 0);      // 実測の方が慣性仕事が大きい
}

// ── WOT(アクセル開度≥95%)区間は目標車速を使う → 全区間WOTならIWR=0 ──
{
    const result = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],            // 実測は目標と違うが…
        throttle: [100, 100],       // 全区間WOT
    }).total;

    // WOT区間は目標車速で計算するので、実測の慣性仕事は目標と一致 → IWR=0
    approx(result.iwr, 0, 1e-9);
    // ASCRはWOT置換の対象外なので従来どおり差が出る
    approx(result.ascr, 100, 1e-9);
}

// ── EER は ER・DR から導出（J2951の関係式） ──
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

console.log('drive-index-utils tests passed');
