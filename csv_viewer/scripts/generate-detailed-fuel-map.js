/* Deterministic, synthetic background map for display/contour exercises.
 * This is not measured engine data, a fit to real measurements, or an
 * interpolation of the existing small sample. No vehicle data is modified.
 * Run from any directory: node scripts/generate-detailed-fuel-map.js
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseMap } = require('../fuel-map-utils.js');

const output = path.resolve(__dirname, '../docs/samples/練習用_詳細燃費率ﾏｯﾌﾟ.csv');
const created = '2026-11-01';
const rows = [['rpm', 'Nm', 'g/kWh']];
let internalHoles = 0, boundaryHoles = 0;

for (let torque = 0; torque <= 240; torque += 2) {
    for (let rpm = 800; rpm <= 6000; rpm += 100) {
        const interiorHole = ((rpm - 3100) / 180) ** 2 + ((torque - 96) / 8) ** 2 <= 1;
        const boundaryHole = torque < 6 || torque > 240 - 0.000007 * (rpm - 3000) ** 2;
        if (boundaryHole) boundaryHoles++;
        else if (interiorHole) internalHoles++;
        // An invented smooth basin plus a local shoulder makes contour detail
        // visible. The mask is solely a missing-data demonstration, not a
        // measured torque limit or a prediction of zero-torque fuel economy.
        const fuel = 220 + 18 * ((rpm - 2400) / 1600) ** 2
            + 30 * ((torque - 130) / 100) ** 2
            + 150 / (torque / 12 + 1)
            + 22 * Math.exp(-(((rpm - 4200) / 650) ** 2) - ((torque - 175) / 35) ** 2);
        rows.push([String(rpm), String(torque), interiorHole || boundaryHole ? '' : fuel.toFixed(3)]);
    }
}

// Validate the same three-column map contract the viewer uses before writing.
const map = parseMap(rows, { format: 'long' });
assert.ok(map.ok, map.reason);
assert.equal(map.xs.length, 53);
assert.equal(map.ys.length, 121);
assert.equal(map.xs.length * map.ys.length, 6413);
assert.ok(map.xs.length * map.ys.length < 12000);
assert.equal(map.stats.eligible + map.stats.emptyCells, 6413);
assert.equal(map.stats.emptyCells, internalHoles + boundaryHoles);
assert.ok(map.zz.every(row => row.every(value => !Number.isFinite(value) || value > 0)));
assert.ok(Number.isNaN(map.zz[map.ys.indexOf(96)][map.xs.indexOf(3100)]));
assert.ok(Number.isFinite(map.zz[map.ys.indexOf(130)][map.xs.indexOf(2400)]));
const text = rows.map(row => row.join(',')).join('\n') + '\n';
fs.writeFileSync(output, text, 'utf8');
console.log(JSON.stringify({ output, created, synthetic: true, coordinates: 6413,
    rpm: { min: 800, max: 6000, step: 100, count: 53 },
    torque: { min: 0, max: 240, step: 2, count: 121 },
    valid: map.stats.eligible, blank: map.stats.emptyCells, internalHoles, boundaryHoles,
    min: map.zmin, max: map.zmax, bytes: Buffer.byteLength(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex') }, null, 2));
