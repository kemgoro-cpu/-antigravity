const assert = require('assert');

// 両ファイルともUMD（Nodeでは module.exports）なので素の require で読み込める。
// drive-index-utils.js は内部で drive-cycles-data.js を require する。
const DriveIndex = require('../drive-index-utils.js');
const DriveCycleData = require('../drive-cycles-data.js');

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
    for (const id of ['nedc', 'wltc3a_3', 'wltc3a_4', 'wltc3b_3', 'wltc3b_4', 'mdc']) {
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

// ── 目標車速チャンネル名（@MDC 等） ──
{
    // app.js の tokenizeExpr が識別子の区切りに使う文字。これが名前に混ざると式に書けない。
    const FORBIDDEN = /[\s+\-*/()^,<>=!&|]/;

    // 全内蔵モードが shortName を持ち、式に書ける文字だけで構成されていること
    const shorts = DriveIndex.CYCLE_REGISTRY.map(c => c.shortName);
    for (const c of DriveIndex.CYCLE_REGISTRY) {
        assert.ok(c.shortName, 'shortName が無い: ' + c.id);
        assert.ok(!FORBIDDEN.test(c.shortName), 'shortName に式パーサの区切り文字: ' + c.shortName);
    }
    // 短縮名が衝突すると別モードのチャンネルが同名になってしまう
    assert.strictEqual(new Set(shorts).size, shorts.length, 'shortName が重複している: ' + shorts);

    const byId = id => DriveIndex.CYCLE_REGISTRY.find(c => c.id === id);
    assert.strictEqual(DriveIndex.cycleChannelName(byId('mdc')), '@MDC');
    assert.strictEqual(DriveIndex.cycleChannelName(byId('nedc')), '@NEDC');
    assert.strictEqual(DriveIndex.cycleChannelName(byId('wltc3b_3')), '@WLTC3b_3');
    assert.strictEqual(DriveIndex.cycleChannelName(byId('wltc3a_4')), '@WLTC3a_4');

    // ユーザー定義モード: shortName が無いので name から区切り文字を除去する
    assert.strictEqual(DriveIndex.cycleChannelName({ id: 'cm_1', name: 'MDC (試作 2)' }), '@MDC試作2');
    assert.strictEqual(DriveIndex.cycleChannelName({ id: 'cm_2', name: 'A+B/C' }), '@ABC');
    // 既に @ が付いた名前でも二重にならない
    assert.strictEqual(DriveIndex.cycleChannelName({ id: 'cm_3', name: '@Already' }), '@Already');
    // 除去すると空になる名前は id にフォールバック
    assert.strictEqual(DriveIndex.cycleChannelName({ id: 'cm_4', name: '+ + +' }), '@cm_4');
    // mode が無ければ null（呼び出し側でガードできる）
    assert.strictEqual(DriveIndex.cycleChannelName(null), null);
}

// ── 旧IDの読み替え ──
{
    assert.strictEqual(DriveIndex.resolveCycleId('wltc3'), 'wltc3b_4');
    assert.strictEqual(DriveIndex.resolveCycleId('nedc'), 'nedc');
    assert.strictEqual(DriveIndex.resolveCycleId('wltc3b_4'), 'wltc3b_4');
    // 'mdc' は実データを得て内蔵へ復帰したので、読み替え対象から外れて素通しされる
    assert.strictEqual(DriveIndex.resolveCycleId('mdc'), 'mdc');
    assert.ok(!Object.prototype.hasOwnProperty.call(DriveIndex.LEGACY_CYCLE_ID, 'mdc'));
}

// ── drive-cycles-data.js も単体でrequireできること（UMD） ──
{
    assert.deepStrictEqual([...DriveCycleData.keys].sort(), ['mdc', 'nedc', 'wltc_3a', 'wltc_3b']);
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

// ── MDC: レジストリ定義 ──
{
    const mdc = DriveIndex.CYCLE_REGISTRY.find(c => c.id === 'mdc');
    assert.strictEqual(mdc.total, 1477);
    approx(mdc.maxSpeed, 105.8, 1e-6);
    assert.strictEqual(JSON.stringify(mdc.phases.map(p => [p.name, p.start, p.end])), JSON.stringify([
        ['Low', 0, 451],
        ['Medium', 451, 1101],
        ['High', 1101, 1477],
    ]));
}

// ── MDC: トレースと1Hzチェックサム（元資料「☆Final MDC.xlsx」記載値との照合） ──
// 車速データが1点でも壊れれば合計値がずれるので、データ破損の回帰検出はここが最も効く。
{
    const t = DriveIndex.getCycleTrace('mdc');
    assert.strictEqual(t.time.length, 1478);                 // 0..1477 s
    assert.strictEqual(t.time[t.time.length - 1], 1477);

    let max = 0;
    for (const v of t.speed) if (v > max) max = v;
    approx(max, 105.8, 1e-6);
    assert.ok(Math.abs(distKm(t.speed) - 15.312) < 0.005, 'MDC 総距離 ≈ 15.312km, got ' + distKm(t.speed));

    // フェーズ内の車速単純和（＝元資料の 1Hz checksums）。合計はフェーズ点数 451/650/377。
    const sum = (from, to) => t.speed.slice(from, to).reduce((a, b) => a + b, 0);
    approx(sum(0, 451),    8830.5,  1e-6);   // Low    (0..450)
    approx(sum(451, 1101), 23879.1, 1e-6);   // Medium (451..1100)
    approx(sum(1101, 1478), 22414.2, 1e-6);  // High   (1101..1477)
    approx(sum(0, 1478),   55123.8, 1e-6);   // Total
}

// ── detectCycle: MDC と WLTC 3フェーズ版（どちらも1477秒）のタイブレーク ──
// 総時間だけでは同点になるため、最高車速で選び分けられることを確認する。
{
    const time = Array.from({ length: 1478 }, (_, i) => i);
    // 最高車速だけを立てた速度配列（判別は最高車速しか見ないので、これで十分）
    const speedWithMax = (v) => { const s = new Array(1478).fill(0); s[700] = v; return s; };

    // MDC の最高車速なら MDC に確定する（WLTC 3フェーズ版に化けない＝本改修の主目的）
    const asMdc = DriveIndex.detectCycle(time, speedWithMax(105.8));
    assert.strictEqual(asMdc.id, 'mdc');
    assert.strictEqual(asMdc.ambiguous, false);

    // WLTC の最高車速なら MDC は外れる。ただし 3a と 3b は最高車速が同値で区別できないため
    // ambiguous のまま（呼び出し側が波形照合で 3a/3b を選び分ける）。暫定値はレジストリ先頭の 3b。
    const asWltc = DriveIndex.detectCycle(time, speedWithMax(97.4));
    assert.strictEqual(asWltc.id, 'wltc3b_3');
    assert.strictEqual(asWltc.ambiguous, true);

    // 車速を渡さない＝決め手が無いので ambiguous。同点候補は全部返る（呼び出し側が波形照合へ回す）
    const amb = DriveIndex.detectCycle(time, null);
    assert.strictEqual(amb.ambiguous, true);
    for (const id of ['wltc3b_3', 'wltc3a_3', 'mdc']) {
        assert.ok(amb.candidates.includes(id), 'candidates に ' + id + ' が無い');
    }

    // 中間の車速（どちらとも決め切れない）も ambiguous になること
    assert.strictEqual(DriveIndex.detectCycle(time, speedWithMax(101.6)).ambiguous, true);

    // 総時間が一意に決まるサイクルは同点にならず ambiguous にならない（従来動作の維持）
    const nedcTime = Array.from({ length: 1181 }, (_, i) => i);
    const nedcDet = DriveIndex.detectCycle(nedcTime, null);
    assert.strictEqual(nedcDet.id, 'nedc');
    assert.strictEqual(nedcDet.ambiguous, false);
    assert.deepStrictEqual(nedcDet.candidates, ['nedc']);

    // 既知サイクルから遠い長さは従来どおり未判別
    const odd = DriveIndex.detectCycle([0, 500], null);
    assert.strictEqual(odd.id, null);
    assert.strictEqual(odd.ambiguous, false);
    assert.strictEqual(odd.speedMismatch, false);
}

// ── detectCycle: 車速レンジが候補と食い違うときは長さ判別を信用しない（speedMismatch） ──
// 実測ログは前後に余分データを含むことが多く、その分だけ総時間が伸びて無関係なサイクルの
// 許容差±5%に迷い込む。前後120秒付きMDC(1717秒)が WLTC 4フェーズ版(1800秒)に一致する例。
{
    const mdc = DriveIndex.getCycleTrace('mdc');
    const PAD = 120;
    const n = mdc.speed.length + PAD * 2;
    const time = Array.from({ length: n }, (_, i) => i);
    const speed = Array.from({ length: n }, (_, i) => {
        const k = i - PAD;
        return (k >= 0 && k < mdc.speed.length) ? mdc.speed[k] : 0;
    });

    const det = DriveIndex.detectCycle(time, speed);
    assert.strictEqual(det.total, 1717);
    assert.strictEqual(det.id, 'wltc3b_4');        // 長さだけ見ると WLTC 4フェーズ版に化ける
    approx(det.maxSpeed, 105.8, 1e-6);             // しかし実測の最高車速は 105.8（候補は131.3）
    assert.strictEqual(det.speedMismatch, true);   // → 長さ判別は信用できないと伝える

    // 車速がちゃんと候補と合っているケースでは立たないこと（誤検知しない）
    const nedcTrace = DriveIndex.getCycleTrace('nedc');
    const nedcDet = DriveIndex.detectCycle(nedcTrace.time, nedcTrace.speed);
    assert.strictEqual(nedcDet.id, 'nedc');
    assert.strictEqual(nedcDet.speedMismatch, false);

    const mdcDet = DriveIndex.detectCycle(mdc.time, mdc.speed);
    assert.strictEqual(mdcDet.id, 'mdc');
    assert.strictEqual(mdcDet.speedMismatch, false);
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
