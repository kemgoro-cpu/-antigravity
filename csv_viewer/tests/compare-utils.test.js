'use strict';
const assert = require('node:assert/strict');
const C = require('../compare-utils');
const Settings = require('../settings-utils');
const a = { t: [0, 1, 2, 3], v: [0, 2, 4, 6] };
const b = { t: [-2, 0, 1], v: [0, 4, 6] };
assert.equal(C.valueAt(a.t, a.v, -1), NaN);
assert.equal(C.valueAt(a.t, a.v, 0.5), 1);
assert.equal(C.valueAt(a.t, a.v, 0.5, true), 0);
assert.equal(C.valueAt([0, 1, 2], [1, NaN, 3], 0.5), NaN);
// Decimal shifts must not turn a valid sample next to a blank into a missing value.
assert.equal(C.valueAt([0, .01, .02], [NaN, 7, 8], (7.01 - 7)), 7);
assert.equal(C.valueAt([0, .01, .02], [1, NaN, 8], (7.01 - 7)), NaN);
assert.equal(C.valueAt([0, .01, .02], [0, 1, 1], (7.01 - 7), true), 1);
assert.equal(C.valueAt([0, .01, .02], [0, 1, 1], .009, true), 0);
assert.equal(C.valueAt([0, 1e-16, 2e-16], [0, 1, 2], 0.5e-16), .5);
assert.equal(C.pointAt([[0, 1], [1, 3]], .5), 2);
assert.equal(C.pointAt([[0, 1], [1, 3]], .5, true), 1);
assert.equal(C.pointAt([[0, 1], [1, null]], .5), NaN);
assert.equal(C.pointAt([[0, 1], [1, 3]], 2), NaN);
assert.deepEqual(C.pointStats([[0, 1], [1, null], [2, 3], [3, Infinity]], 0, 3), { n: 2, min: 1, max: 3, mean: 2, rms: Math.sqrt(5), sigma: 1 });
let r = C.compare(a, b, 2, [0, 3], false, 1, true);
assert.equal(r.max, 0); assert.equal(r.n, 4); assert.equal(r.mean, 0); assert.equal(r.rms, 0);
assert.deepEqual(r.points, [[0, 0], [1, 0], [2, 0], [3, 0]]);
r = C.compare(a, { t: [0, 1, 2, 3], v: [0, 1, NaN, 2] }, 0, [1, 3], false, 2);
assert.equal(r.n, 2); assert.equal(r.missing, 1); assert.equal(r.max, 4); assert.equal(r.time, 3); assert.equal(r.mean, 2.5); assert.equal(r.exceeded, 1); assert.equal(r.ratio, 2);
r = C.compare(a, b, 100, [0, 3]); assert.equal(r.max, null); assert.equal(r.n, 0); assert.equal(r.missing, 4);
r = C.compare({ t: [0, 2, 4], v: [0, 1, 1] }, { t: [0, 1, 3, 4], v: [0, 1, 1, 1] }, 0, [0, 4], true);
assert.equal(r.mismatchDuration, 1); assert.equal(r.totalDuration, 4);
assert.equal(r.mainTransition.time, 2); assert.equal(r.subTransition.time, 1); assert.equal(r.transitionDelta, -1);

// Runs follow actual baseline samples: equality, either missing signal, and ordinary
// nonexceedances separate them. A tied absolute maximum keeps its first timestamp.
const runTimes = [-1, 0, .25, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const runMain = { t: runTimes, v: [8, 2, -4, 4, 1, 3, NaN, 5, 6, 0, 2, 7] };
const runSub = { t: runTimes, v: [0, 0, 0, 0, 0, 0, 0, 0, NaN, 0, 0, 0] };
const runResult = C.compare(runMain, runSub, 0, [0, 8.5], false, 1, true);
assert.deepEqual(runResult.exceedanceIntervals, [
    { t0: 0, t1: 1, count: 3, max: 4, time: .25 },
    { t0: 3, t1: 3, count: 1, max: 3, time: 3 },
    { t0: 5, t1: 5, count: 1, max: 5, time: 5 },
    { t0: 8, t1: 8, count: 1, max: 2, time: 8 },
]);
const { exceedanceIntervals, ...unchangedMetrics } = runResult;
assert.deepEqual(unchangedMetrics, {
    n: 8, missing: 2, max: 5, time: 5, mean: 13 / 8, rms: Math.sqrt(75 / 8),
    mainTransition: null, subTransition: null, transitionDelta: null,
    mismatchDuration: null, totalDuration: 0, exceeded: 6, ratio: 5,
    points: [[0, 2], [.25, -4], [1, 4], [2, 1], [3, 3], [4, null], [5, 5], [6, null], [7, 0], [8, 2]],
});
assert.equal(exceedanceIntervals.reduce((sum, interval) => sum + interval.count, 0), runResult.exceeded);
assert.deepEqual(C.compare(runMain, runSub, 0, [.1, 1], false, 1).exceedanceIntervals,
    [{ t0: .25, t1: 1, count: 2, max: 4, time: .25 }]);
assert.deepEqual(C.compare(runMain, runSub, 0, [.1, .9], false, 1).exceedanceIntervals,
    [{ t0: .25, t1: .25, count: 1, max: 4, time: .25 }]);
for (const tolerance of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.deepEqual(C.compare(runMain, runSub, 0, [0, 9], false, tolerance).exceedanceIntervals, []);
}

// Shifted comparison uses linear interpolation for analog signals and preceding
// values for Bit signals, while interval timestamps remain in the baseline clock.
const shiftedMain = { t: [10, 11, 12, 13, 14], v: [0, 0, 0, 0, 0] };
const shiftedSub = { t: [0, 2, 4], v: [0, 4, 0] };
assert.deepEqual(C.compare(shiftedMain, shiftedSub, 10, [10, 14], false, 1).exceedanceIntervals,
    [{ t0: 11, t1: 13, count: 3, max: 4, time: 12 }]);
const bitRun = C.compare(shiftedMain, shiftedSub, 10, [10, 14], true, 1);
assert.deepEqual(bitRun.exceedanceIntervals, [{ t0: 12, t1: 13, count: 2, max: 4, time: 12 }]);
assert.equal(bitRun.mismatchDuration, 2); assert.equal(bitRun.totalDuration, 4);

assert.equal(C.alignmentScore(a, b, 2, [0, 3]).rms, 0);
assert.equal(C.alignmentScore(a, b, 100, [0, 3]).rms, Infinity);
assert.equal(C.sameUnit(' km/h ', 'km/h'), true); assert.equal(C.sameUnit('m/s', 'km/h'), false);
const old = { _version: 5, selectedNames: ['車速'] }; const migrated = Settings.migrateSettings(old);
assert.equal(migrated.settings._version, 6); assert.deepEqual(migrated.settings.comparison, {}); assert.equal(old.comparison, undefined);
assert.equal(Settings.migrateSettings({ _version: 7 }).ok, false);
const cleaned = C.cleanSettings({ view: 'broken', labels: { 'ﾃｽﾄ.csv': '試験前' }, tolerances: { speed: -1, rpm: 2 }, notes: [{ text: 'bad', t0: 5, t1: 1 }], matches: { sub: { speed: '', rpm: 'Engine_RPM' } } });
assert.equal(cleaned.view, 'overlay'); assert.equal(cleaned.labels['ﾃｽﾄ.csv'], '試験前'); assert.deepEqual(cleaned.tolerances, { rpm: 2 }); assert.deepEqual(cleaned.notes, []); assert.equal(cleaned.matches.sub.speed, '');
const untrusted = C.cleanSettings(JSON.parse('{"labels":{"__proto__":"safe"},"matches":{"__proto__":{"x":"y"}}}'));
assert.equal({}.x, undefined); assert.equal(Object.getPrototypeOf(untrusted.labels), Object.prototype);
assert.equal(C.candidates({ name: 'Vehicle_Speed', unit: 'km/h' }, [{ name: 'Voltage', unit: 'V' }, { name: 'Vehicle Speed', unit: 'km/h' }])[0].col.name, 'Vehicle Speed');
console.log('compare-utils tests passed');
