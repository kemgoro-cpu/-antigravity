'use strict';

const assert = require('node:assert/strict');
const DriveIndex = require('../drive-index-utils.js');

function approx(actual, expected, tolerance = 1e-10) {
    assert.ok(Number.isFinite(actual), `expected a finite value, received ${actual}`);
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`);
}

const metrics = ['rmsse', 'iwr', 'ascr', 'dr', 'er', 'eer'];
const roadLoad = { A: 10, B: 0, C: 0, mass: 1 };

function assertUnavailable(result, expectedCode) {
    assert.ok(result && result.total, 'invalid input retains a diagnosable result');
    for (const metric of metrics) assert.equal(result.total[metric], null, metric);
    const diagnostics = result.total.diagnostics || result.diagnostics;
    assert.ok(diagnostics && !diagnostics.ok && diagnostics.issues.length);
    if (expectedCode) assert.ok(diagnostics.issues.some(issue => issue.code === expectedCode), expectedCode);
}

// Three samples keep both averaging passes unchanged, so every term can be
// checked by hand. Speeds in m/s are [0,1,2] and [0,2,4]; the only nonzero
// central acceleration is 10 and 20 m/s² at the middle sample. Right-end
// distances are .3 and .6 m, positive inertial work is 1.015 and 4.06 J,
// and engine work is (10+10.15)*.1+10*.2 = 4.015 J versus 10.06 J.
{
    const time = Object.freeze([0, 0.1, 0.2]);
    const target = Object.freeze([0, 3.6, 7.2]);
    const actual = Object.freeze([0, 7.2, 14.4]);
    const input = { time, target, actual, roadLoad };
    const calculation = DriveIndex.computeMetrics(input);
    assert.equal(calculation.calculationMethod, 'excel');
    const result = calculation.total;
    const er = (10.06 - 4.015) / 4.015 * 100;
    approx(result.rmsse, Math.sqrt((3.6 ** 2 + 7.2 ** 2) / 3));
    approx(result.iwr, 300);
    approx(result.ascr, 100);
    approx(result.dr, 100);
    approx(result.er, er);
    approx(result.eer, (1 - 2 / (10.06 / 4.015)) * 100);
    approx(result.indexDistanceKm, 0.0006);
    approx(result.targetIndexDistanceKm, 0.0003);
    approx(result.distanceKm, 0.0004, 1e-12);
    assert.deepEqual(target, [0, 3.6, 7.2]);
    assert.deepEqual(actual, [0, 7.2, 14.4]);

    const explicit = DriveIndex.computeMetrics({ ...input, calculationMethod: 'excel' });
    for (const metric of metrics) approx(explicit.total[metric], result[metric]);
    const legacy = DriveIndex.computeMetrics({ ...input, calculationMethod: 'legacy' });
    assert.equal(legacy.calculationMethod, 'legacy');
    assert.ok(Math.abs(legacy.total.er - er) > 1, 'the explicit legacy path remains a separate calculation');
}

// Moving an identical record off the global 0.1-second ticks must not drop
// either endpoint or alter any rating. The Excel grid belongs to its window.
{
    const target = [0, 3.6, 7.2], actual = [0, 7.2, 14.4];
    const base = DriveIndex.computeMetrics({ time: [0, 0.1, 0.2], target, actual, roadLoad }).total;
    for (const offset of [0.05, 1.05]) {
        const shifted = DriveIndex.computeMetrics({ time: [offset, offset + 0.1, offset + 0.2], target, actual, roadLoad }).total;
        assert.equal(shifted.diagnostics.samples, 3);
        for (const metric of [...metrics, 'indexDistanceKm', 'targetIndexDistanceKm']) approx(shifted[metric], base[metric]);
    }
}

// A fractional phase begins at its own first sample, not the next global tick.
// Its interpolated m/s values are [.5,1.5,2.5] and [1,3,5].
{
    const result = DriveIndex.computeMetrics({ time: [0, 0.1, 0.2, 0.3],
        target: [0, 3.6, 7.2, 10.8], actual: [0, 7.2, 14.4, 21.6], roadLoad,
        phases: [{ name: 'Fractional', start: 0.05, end: 0.25 }] }).phases[0];
    assert.equal(result.diagnostics.samples, 3);
    approx(result.rmsse, Math.sqrt((1.8 ** 2 + 5.4 ** 2 + 9 ** 2) / 3));
    approx(result.iwr, 300); approx(result.ascr, 100); approx(result.dr, 100);
    const er = (14.09 / 5.5225 - 1) * 100;
    approx(result.er, er);
    approx(result.eer, (1 - 2 / (14.09 / 5.5225)) * 100);
    approx(result.indexDistanceKm, 0.0008);
    approx(result.targetIndexDistanceKm, 0.0004);
}

// A 25 m/s impulse becomes [0,0,3,4,5,4,3,0,0] after two five-point passes.
// These fixed expected numbers distinguish one pass, two passes and filtering
// the whole trace before slicing a phase. A phase is filtered independently.
{
    const time = Array.from({ length: 9 }, (_, i) => i / 10);
    const target = Array(9).fill(3.6);
    const actual = [0, 0, 0, 0, 90, 0, 0, 0, 0];
    const copy = actual.slice();
    const result = DriveIndex.computeMetrics({
        time, target, actual, roadLoad,
        phases: [{ name: 'Middle', start: 0.2, end: 0.6 }],
    });
    approx(result.total.rmsse, 3.6 * Math.sqrt(46 / 9));
    approx(result.phases[0].rmsse, 3.6 * Math.sqrt(4 / 5));
    assert.deepEqual(actual, copy, 'filtering must not rewrite source or chart data');

    // Preserving the first two/last two samples on BOTH passes produces
    // [25,0,6,1,1,0,0,0,0], rather than padding or shortening the trace.
    const atEdge = DriveIndex.computeMetrics({ time, target, actual: [90, 0, 0, 0, 0, 0, 0, 0, 0] });
    approx(atEdge.total.rmsse, 3.6 * Math.sqrt(606 / 9));
}

// The workbook's corrected threshold treats 0.03 m/s and all negative speeds
// as zero, while retaining a value above it. This is computation-only cleanup.
{
    const time = [0, 0.1, 0.2], target = [3.6, 3.6, 3.6];
    const negative = [-3.6, -3.6, -3.6];
    const below = DriveIndex.computeMetrics({ time, target, actual: negative, roadLoad }).total;
    approx(below.rmsse, 3.6);
    approx(below.dr, -100);
    approx(below.er, -100);
    assert.equal(below.eer, null, 'zero actual energy makes EER unavailable');
    assert.deepEqual(negative, [-3.6, -3.6, -3.6]);

    const boundary = DriveIndex.computeMetrics({ time, target, actual: [0.108, 0.108, 0.108] }).total;
    approx(boundary.rmsse, 3.6);
    approx(boundary.dr, -100);
    const retained = DriveIndex.computeMetrics({ time, target, actual: Array(3).fill(0.0301 * 3.6) }).total;
    approx(retained.rmsse, (1 - 0.0301) * 3.6);
    approx(retained.dr, (0.0301 - 1) * 100);
}

// Equal constant traces have valid zero RMS/DR, but no acceleration or
// inertial-work denominator. Do not manufacture a zero rating for those ratios.
{
    const same = DriveIndex.computeMetrics({ time: [0, 0.1, 0.2], target: [36, 36, 36], actual: [36, 36, 36] }).total;
    approx(same.rmsse, 0);
    approx(same.dr, 0);
    assert.equal(same.iwr, null);
    assert.equal(same.ascr, null);
    assert.equal(same.er, null);
    assert.equal(same.eer, null);
}

// A missing speed must not be silently omitted from the denominator or work
// sums. The Excel window must explicitly report that all six ratings are absent.
{
    const missing = DriveIndex.computeMetrics({
        time: [0, 0.1, 0.2], target: [0, 3.6, 7.2], actual: [0, NaN, 7.2], roadLoad,
    });
    assertUnavailable(missing, 'MISSING_SPEED');
}

// Finite input at a slower sampling rate remains valid. A linear 1 Hz trace
// and its explicit 10 Hz representation must produce the same six ratings.
{
    const coarse = DriveIndex.computeMetrics({ time: [0, 1, 2], target: [0, 36, 72], actual: [0, 36, 72], roadLoad });
    const time = Array.from({ length: 21 }, (_, i) => i / 10);
    const speed = time.map(t => 36 * t);
    const dense = DriveIndex.computeMetrics({ time, target: speed, actual: speed, roadLoad });
    assert.equal(coarse.total.diagnostics.ok, true);
    assert.equal(coarse.total.diagnostics.samples, 21);
    for (const metric of metrics) {
        approx(coarse.total[metric], 0);
        approx(coarse.total[metric], dense.total[metric]);
    }
}

// Missing coverage and malformed axes/lengths are unavailable, rather than
// endpoint extrapolation or a partly evaluated healthy result. Invalid axis
// checks must happen before a resampling loop sees Infinity.
{
    const valid = { time: [0, 0.1, 0.2], target: [0, 3.6, 7.2], actual: [0, 3.6, 7.2], roadLoad };
    assertUnavailable(DriveIndex.computeMetrics({ ...valid, actualTime: [0.1, 0.15, 0.2] }), 'WINDOW_COVERAGE');
    assertUnavailable(DriveIndex.computeMetrics({ ...valid, actual: [0, 7.2] }), 'SOURCE_LENGTH');
    for (const time of [[0, 0, 0.2], [0, 0.2, 0.1], [0, 0.1, Infinity], [0, NaN, 0.2]]) {
        assertUnavailable(DriveIndex.computeMetrics({ ...valid, time }), 'TIME_ORDER');
    }
    // This absent source sample falls between the 10 Hz output timestamps.
    // Checking only the resampled values would silently overlook it.
    assertUnavailable(DriveIndex.computeMetrics({ ...valid,
        actualTime: [0, 0.05, 0.1, 0.2], actual: [0, NaN, 3.6, 7.2],
    }), 'MISSING_SPEED');
    for (const [start, end] of [[0.01, 0.02], [0, 0.05]]) {
        const short = DriveIndex.computeMetrics({ ...valid, phases: [{ name: 'Short', start, end }] });
        assertUnavailable({ total: short.phases[0] }, 'INSUFFICIENT_SAMPLES');
    }
}

// An unusually large interval is an explicit warning, not an invented sample
// or blanket rejection: finite linear interpolation still yields zero mismatch.
{
    const time = [0, 0.1, 0.2, 0.3, 2], speed = time.map(t => t * 3.6);
    const result = DriveIndex.computeMetrics({ time, target: speed, actual: speed, roadLoad }).total;
    assert.equal(result.diagnostics.ok, true);
    assert.ok(result.diagnostics.issues.some(issue => issue.code === 'LARGE_GAP' && issue.severity === 'warning'));
    approx(result.rmsse, 0);
    approx(result.dr, 0);
}

// Preserve a recorded value at an existing decimal timestamp. Interpolating
// 0.30000000000000004 between 0.3 and 0.4 can otherwise move this value just
// across the workbook's zero threshold and turn a nonzero sample into a stop.
{
    const recorded = 0.1080000000000004;
    const speedMs = recorded / 3.6;
    assert.ok(speedMs > 3.00000000000001e-2);
    const result = DriveIndex.computeMetrics({ time: [0.3, 0.4, 0.5],
        target: [3.6, 3.6, 3.6], actual: [recorded, 0, 0] }).total;
    approx(result.rmsse, 3.6 * Math.sqrt(((1 - speedMs) ** 2 + 2) / 3));
}

// Filtering/clamping affects only index ratings. Signed source distance and
// fuel volume/economy retain the prior trapezoid/left-sample fuel calculation.
{
    const actual = Object.freeze([-3.6, 7.2, 14.4]);
    const fuelRate = Object.freeze([36, 72, 999]);
    const input = { time: [0, 0.1, 0.2], target: [0, 3.6, 7.2], actual, fuelRate };
    const excel = DriveIndex.computeMetrics(input).total;
    const legacy = DriveIndex.computeMetrics({ ...input, calculationMethod: 'legacy' }).total;
    approx(excel.distanceKm, 0.00035, 1e-12);
    approx(excel.indexDistanceKm, 0.0006, 1e-12);
    approx(excel.fuelL, 0.003, 1e-12);
    for (const key of ['distanceKm', 'fuelL', 'fuelKmPerL', 'fuelLper100km']) approx(excel[key], legacy[key]);
    assert.deepEqual(actual, [-3.6, 7.2, 14.4]);
    assert.deepEqual(fuelRate, [36, 72, 999]);
}

// Finite accumulated work can still overflow when divided by a very small
// target. Do not present a partial healthy rating in that case.
{
    const result = DriveIndex.computeMetrics({ time: [0, 0.1, 0.2],
        target: [0.10800000000001, 0.108000000000011, 0.108000000000012],
        actual: [1e150, 2e150, 3e150], roadLoad: { A: 0, B: 0, C: 0, mass: 1 } }).total;
    assert.equal(result.diagnostics.ok, false);
    assert.ok(result.diagnostics.issues.some(issue => issue.code === 'NUMERIC_RANGE'));
    for (const metric of ['rmsse', 'iwr', 'ascr', 'dr', 'er', 'eer']) assert.equal(result[metric], null);
}

console.log('drive-index-excel tests passed (independent arithmetic, filtering, edges, threshold, phases, immutable sources, sampling, diagnostics, raw fuel)');
