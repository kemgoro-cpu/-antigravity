'use strict';
const assert = require('node:assert/strict');
const F = require('../fuel-map-utils.js');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const matrix = [
    ['rpm\\Nm', '3000', '1000', '2000'],
    ['100', '300', '200', ''],
    ['50', '250', '180', '220'],
];
const untouched = JSON.stringify(matrix);
let result = F.parseMap(matrix);
assert.equal(result.ok, true);
assert.equal(result.format, 'matrix');
assert.deepEqual(result.xs, [1000, 2000, 3000]);
assert.deepEqual(result.ys, [50, 100]);
assert.deepEqual(result.zz, [[180, 220, 250], [200, NaN, 300]]);
assert.deepEqual(result.counts, [[1, 1, 1], [1, 0, 1]]);
assert.deepEqual(result.xEdges, [500, 1500, 2500, 3500]);
assert.deepEqual(result.yEdges, [25, 75, 125]);
assert.equal(result.stats.eligible, 5);
assert.equal(result.stats.invalidValues, 1);
assert.equal(result.stats.emptyCells, 1);
assert.equal(JSON.stringify(matrix), untouched, 'sorting must not mutate the source map');
assert.deepEqual(result.unitHints, { x: 'rpm', y: 'Nm', z: null });
for (const [corner, expected] of [
    ['rpm / Nm', { x: 'rpm', y: 'Nm', z: null }],
    ['r/min / Nm', { x: 'r/min', y: 'Nm', z: null }],
    ['Engine Speed [rpm]\\Torque [lb-ft]', { x: 'rpm', y: 'lb-ft', z: null }],
    ['Engine_RPM\\Throttle', { x: null, y: 'Throttle', z: null }],
    ['rpm\\%', { x: 'rpm', y: '%', z: null }],
    ['Engine Speed\\Torque', { x: null, y: null, z: null }],
]) {
    const map = F.parseMap([[corner, 1000, 2000], [10, 200, 250]]);
    assert.equal(map.ok, true);
    assert.deepEqual(map.unitHints, expected);
}

// Full-token numeric parsing: malformed coordinates reject, malformed fuel-rate values become holes.
assert.equal(F.parseMap([['map', '1000rpm', 2000], [10, 200, 300]], { format: 'matrix' }).ok, false);
assert.equal(F.parseMap([['map', 1000, 2000], [10, 200], [20, 210, 220]]).ok, false);
assert.equal(F.parseMap([['map', 1000, 1000], [10, 200, 300]]).ok, false);
assert.equal(F.parseMap([['map', 1000, 2000], [10, 200, 300], [10, 200, 300]]).ok, false);
assert.equal(F.parseMap([['map', -1000, 2000], [10, 200, 300]]).ok, false);
result = F.parseMap([['map', 0, 1000, 2000, 3000, 4000], [0, '200x', '0x20', Infinity, 0, 200]]);
assert.deepEqual(result.zz[0], [NaN, NaN, NaN, NaN, 200]);
assert.equal(result.stats.invalidValues, 4);
assert.equal(F.parseMap([['map', 1000, 2000], [10, 0, -1]]).ok, false);
assert.equal(F.parseMap([['map', 1000, 2000], [10, 200, 300]], { maxCells: 1 }).ok, false);
assert.equal(F.parseMap(matrix, { maxRows: 2 }).ok, false);
assert.equal(F.parseMap(null).ok, false);
assert.equal(F.parseMap([[]]).ok, false);
assert.equal(F.parseMap(matrix, { format: 'unknown' }).ok, false);
assert.equal(F.parseMap(matrix, { maxCells: Infinity }).ok, false);

const long = [
    ['sfc_ne', 'sfc_te', 'sfc_g_kwh'], ['rpm', 'Nm', 'g/kWh'],
    ['1000', '20', '200'], ['1000', '20', '400'], ['2000', '40', '300'], ['2000', '20', ''],
];
result = F.parseMap(long);
assert.equal(result.ok, true);
assert.equal(result.format, 'long');
assert.deepEqual(result.unitHints, { x: 'rpm', y: 'Nm', z: 'g/kWh' });
assert.deepEqual(result.zz, [[300, NaN], [NaN, 300]]);
assert.deepEqual(result.counts, [[2, 0], [0, 1]]);
assert.equal(result.stats.eligible, 3);
assert.equal(result.stats.duplicatePoints, 1);
assert.equal(result.stats.invalidValues, 1);
assert.equal(result.stats.emptyCells, 2);
assert.equal(result.stats.inputRows, 4);
assert.equal(F.parseMap([['unrecognized', 'bad', 'header'], [1000, 10, 250]], { format: 'long' }).ok, false, 'do not blindly skip malformed first data');
assert.equal(F.parseMap([['x', 'y', 'z'], ['rpm', 'lbft', 'g/kWh'], [1000, 10, 250]]).ok, false, 'unknown units are not silently skipped');
assert.equal(F.parseMap([['x', 'y', 'z'], [1000, 10, 250], ['bad', 20, 260]]).ok, false);
assert.equal(F.parseMap([['x', 'y', 'z'], [1000, 10, 250], [2000, 20, 260, 'extra']]).ok, false);
assert.equal(F.parseMap([[0, 0, 200], [1000, 10, 250]]).ok, false, 'numeric 3-column input needs explicit format');
assert.equal(F.parseMap([[0, 0, 200], [1000, 10, 250]], { format: 'long' }).ok, true);
assert.equal(F.parseMap([[0, 1000, 2000], [10, 200, 250]], { format: 'matrix' }).ok, true);
assert.equal(F.parseMap([['x', 'y', 'z'], ['rpm', 'Nm', 'g/kWh']]).ok, false);
result = F.parseMap([['Engine_Speed [r/min]', 'Engine_Torque [N*m]', 'BSFC [g/kWh]'], [1000, 20, 250]]);
assert.equal(result.ok, true);
assert.deepEqual(result.unitHints, { x: 'r/min', y: 'N*m', z: 'g/kWh' });
assert.equal(F.parseMap([['x [rad/s]', 'y [Nm]', 'z [g/kWh]'], ['rpm', 'Nm', 'g/kWh'], [1000, 10, 250]]).ok, false);
const tooDense = [['x', 'y', 'z'], ...Array.from({ length: 201 }, (_, i) => [i * 400, i * 3, 250])];
assert.equal(F.parseMap(tooDense).ok, false, 'reject the coordinate Cartesian product before dense allocation');
assert.match(F.parseMap(tooDense).reason, /40,000/);
result = F.parseMap([['x', 'y', 'z'], [1000, 10, 1e308], [1000, 10, 1e308]]);
assert.equal(result.zz[0][0], 1e308, 'averaging must not overflow finite positive samples');

// GT-style bins have centers at multiples of step and mid-point edges, including the 0 coordinate.
const sx = new Float64Array([0, 199, 200, 400, 800, 1000, -1, NaN, 100, 100]);
const sy = new Float64Array([0, 1.49, 1.5, 3, 6, 7.5, 3, 3, 3, 3]);
const sz = new Float64Array([200, 400, 240, 280, 300, 360, 250, 260, 0, Infinity]);
const originals = [Array.from(sx), Array.from(sy), Array.from(sz)];
result = F.fromSamples(sx, sy, sz);
assert.equal(result.ok, true);
assert.deepEqual(result.xs, [0, 400, 800, 1200]);
assert.deepEqual(result.ys, [0, 3, 6, 9]);
assert.deepEqual(result.xEdges, [0, 200, 600, 1000, 1400]);
assert.deepEqual(result.yEdges, [0, 1.5, 4.5, 7.5, 10.5]);
assert.equal(result.zz[0][0], 300);
assert.equal(result.zz[1][1], 260);
assert.equal(result.zz[2][2], 300);
assert.equal(result.zz[3][3], 360);
assert.equal(result.stats.inputRows, 10);
assert.equal(result.stats.eligible, 6);
assert.equal(result.stats.excluded, 4);
assert.equal(result.stats.invalidCoordinates, 2);
assert.equal(result.stats.invalidValues, 2);
assert.equal(result.stats.duplicatePoints, 2);
assert.equal(result.counts.flat().reduce((a, b) => a + b, 0), 6);
assert.deepEqual([Array.from(sx), Array.from(sy), Array.from(sz)], originals);
assert.equal(F.fromSamples([1e308], [3], [200]).ok, false, 'reject grid overflow before allocation');
assert.equal(F.fromSamples([1000], [30], [200], { maxCells: 2 }).ok, false);
assert.equal(F.fromSamples([1000], [30], [200], { rpmStep: 0 }).ok, false);
assert.equal(F.fromSamples([1000], [30], [200], { torqueStep: -1 }).ok, false);
assert.equal(F.fromSamples([1000], [30], [200], { rpmStep: '400' }).ok, false);
assert.equal(F.fromSamples([1000], [], [200]).ok, false);
assert.equal(F.fromSamples([1000], [30], [0]).ok, false);

assert.equal(F.classifyUnit('rpm'), 'rpm');
assert.equal(F.classifyUnit('r/min'), 'rpm');
assert.equal(F.classifyUnit('N·m'), 'torque');
assert.equal(F.classifyUnit('g/(kW*h)'), 'sfc');
assert.equal(F.classifyUnit('g/kW-h'), 'sfc', 'real GT TRN unit spelling is the same g/kWh unit, without conversion');
assert.equal(F.classifyUnit('L/h'), null);
assert.equal(F.classifyUnit('%'), null);
assert.equal(F.classifyUnit('rad/s'), null);
assert.equal(F.compatibleUnit('Nm', 'torque'), true);
assert.equal(F.compatibleUnit('Nm', 'rpm'), false);
assert.equal(F.compatibleUnit('unknown', null), false);

// Sampling uses full original rows for counts and color extrema, and retains the exact row/time identity.
const time = new Float64Array([0, 0.1, 0.4, 1, 1.2, 3, 3.1]);
const x = new Float64Array([100, 101, 102, 103, 104, 105, 106]);
const y = new Float64Array([-1, 1, 2, NaN, 4, 5, 6]);
const color = new Float64Array([10, 20, 999, 40, 50, 60, 70]);
result = F.pickPoints(time, x, y, color, { offset: 2, range: [2, 5.1], maxPoints: 3 });
assert.equal(result.ok, true);
assert.equal(result.rangeCount, 7);
assert.equal(result.totalCount, 6);
assert.equal(result.displayCount, 3);
assert.equal(result.excludedCount, 1);
assert.equal(result.truncated, true);
assert.deepEqual(result.points.map(p => p.index), [0, 4, 6]);
assert.deepEqual(result.points[1], { x: 104, y: 4, z: 50, index: 4, time: 1.2, displayTime: 3.2 });
assert.equal(result.zmax, 999, 'color limits must include unsampled eligible points');
assert.equal(result.ymin, -1, 'generic XY keeps negative values');
result = F.pickPoints(time, x, y, null, { nonnegative: true, range: [0, 3.1], maxPoints: 20 });
assert.equal(result.totalCount, 5);
assert.equal(result.excludedCount, 2);
assert.equal(result.points[0].index, 1);
assert.equal(result.points[0].z, null);
assert.equal(result.zmin, null);
assert.equal(F.pickPoints(time, [], y).ok, false);
assert.equal(F.pickPoints(time, x, y, null, { range: [3, 1] }).ok, false);
assert.equal(F.pickPoints(time, x, y, null, { offset: Infinity }).ok, false);
assert.equal(F.pickPoints(time, x, y, null, { maxPoints: 0 }).ok, false);
assert.equal(F.pickPoints(time, x, y, null, { range: [10, 20] }).totalCount, 0);
assert.equal(F.pickPoints([NaN, 1], [10, 20], [1, 2]).invalidTimeCount, 1);
result = F.pickPoints([0, 1, 2], [10, 20, 30], [1, 2, 3], null, { maxPoints: 1 });
assert.deepEqual(result.points.map(p => p.index), [0]);
const bigTime = Float64Array.from({ length: 100001 }, (_, i) => i / 10);
const bigX = Float64Array.from({ length: bigTime.length }, (_, i) => i % 3000);
const bigY = new Float64Array(bigTime.length).fill(20);
result = F.pickPoints(bigTime, bigX, bigY, null, { maxPoints: 1000 });
assert.equal(result.totalCount, 100001);
assert.equal(result.points.length, 1000);
assert.equal(result.points[0].index, 0);
assert.equal(result.points.at(-1).index, 100000);
assert.equal(new Set(result.points.map(p => p.index)).size, 1000);

// Hover validates time once and then binary-searches the nearest original sample; it never fills missing XY.
const prepared = F.prepareTime(time);
assert.equal(prepared.ok, true);
assert.equal(prepared.time, time);
assert.equal(F.prepareTime([0, 1, 1]).ok, false);
assert.equal(F.prepareTime([0, 2, 1]).ok, false);
assert.equal(F.prepareTime([0, NaN, 2]).ok, false);
assert.equal(F.prepareTime([]).ok, false);
result = F.nearestPoint(prepared, x, y, color, 2.4, { offset: 2, range: [2, 5.1] });
assert.equal(result.point.index, 2);
assert.equal(result.point.time, 0.4);
close(result.point.displayTime, 2.4);
assert.equal(F.nearestPoint(prepared, x, y, null, 1).point, null, 'do not replace the invalid nearest point');
assert.equal(F.nearestPoint(prepared, x, y, null, -0.01).point, null, 'no extrapolation before log');
assert.equal(F.nearestPoint(prepared, x, y, null, 3.11).point, null, 'no extrapolation after log');
assert.equal(F.nearestPoint(prepared, x, y, null, 0, { nonnegative: true }).point, null);
assert.equal(F.nearestPoint(prepared, x, y, null, 0.1, { range: [0.2, 3] }).point, null);
assert.equal(F.nearestPoint(prepared, x, y, null, 0.3, { range: [0.2, 0.35] }).point, null, 'no observed samples inside scope');
assert.equal(F.nearestPoint(prepared, x, y, null, 0.25, { range: [0.2, 0.5] }).point.index, 2);
assert.equal(F.nearestPoint(F.prepareTime([0, 0]), [1, 2], [3, 4], null, 0).ok, false);
assert.equal(F.nearestPoint(prepared, [], y, null, 1).ok, false);
assert.deepEqual(Array.from(time), [0, 0.1, 0.4, 1, 1.2, 3, 3.1]);

console.log('fuel-map-utils: strict maps, all-sample means, bounds, original-point identity and cursor tests passed');
