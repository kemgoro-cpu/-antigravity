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
    const result = DriveIndex.computeMetrics({
        time: [0, 1],
        target: [0, 10],
        actual: [0, 20],
    }).total;

    approx(result.ascr, 100, 1e-9);
    approx(result.iwr, 300, 1e-9);
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
