'use strict';
const assert = require('node:assert/strict');
const Papa = require('../lib/papaparse.min.js');
const utils = require('../parser-utils.js');

function read(text, opts = {}, trn = false) {
    const normalized = utils.normalizeImportOptions(opts);
    const result = Papa.parse(trn ? utils.convertWhitespaceToTabs(text) : text, {
        delimiter: trn ? '\t' : normalized.delimiter === 'auto' ? '' : normalized.delimiter,
        skipEmptyLines: true, dynamicTyping: false,
    });
    const layout = utils.resolveImportLayout(result.data, normalized);
    assert.equal(layout.error, '', JSON.stringify({ opts, layout }));
    const numeric = trn ? utils.toTrnNumber : utils.toNumber;
    const rows = result.data.slice(layout.dataStart).filter(row => Number.isFinite(numeric(row[layout.timeIdx])));
    return { layout, rows, raw: result.data };
}

// Regression: the 0-second sample must never become a unit row.
for (const text of ['Time,Speed\n0,1\n1,2\n2,3', 'Time,Speed\r\n0,1\r\n1,2\r\n2,3\r\n']) {
    const result = read(text);
    assert.equal(result.layout.unitRow, -1);
    assert.deepEqual(result.rows, [['0', '1'], ['1', '2'], ['2', '3']]);
}
assert.deepEqual(read('Time,Speed\ns,km/h\n0,1\n1,2\n2,3').rows, [['0', '1'], ['1', '2'], ['2', '3']]);
assert.equal(read('Time,Speed\n,\n0,1\n1,2').layout.unitRow, 1, 'explicit empty unit row remains valid');
assert.equal(read('Time,Flag\ns,1\n0,1\n1,0').layout.unitRow, 1, 'dimensionless units are retained');
assert.equal(read('Time,Speed\nNaN,1\n1,2').layout.unitRow, -1, 'invalid first time is data, not units');
assert.equal(read('Time,Speed\n,1\n1,2').layout.unitRow, -1, 'missing first time is data, not units');

const metadata = 'Time metadata,description\nTimestamp,Pressure\nms,kPa\n0,10\n500,12';
const manual = read(metadata, { nameMode: 'manual', nameRow: 1, unitMode: 'manual', unitRow: 2, timeColumn: 0 });
assert.equal(manual.layout.nameRow, 1);
assert.deepEqual(manual.rows, [['0', '10'], ['500', '12']]);
const lastTime = read('Speed,Tick\n1,0\n2,0.5\n3,1', { timeColumn: 1, unitMode: 'none' });
assert.equal(lastTime.layout.timeIdx, 1);
assert.equal(lastTime.rows.length, 3);
assert.equal(lastTime.rows[0][1], '0');

for (const delimiter of [',', '\t', ';', '|']) {
    const text = [['Time', 'Vehicle Speed'], ['s', 'km/h'], ['0', '1.25'], ['1', '-2.5']].map(row => row.join(delimiter)).join('\n');
    const result = read(text, { delimiter });
    assert.deepEqual(result.rows, [['0', '1.25'], ['1', '-2.5']]);
}
const quoted = read('Time,"Speed, actual"\ns,km/h\n0,10\n1,20');
assert.deepEqual(quoted.raw[0], ['Time', 'Speed, actual']);
assert.equal(quoted.rows.length, 2);

const trn = '| Time | Actual Speed |\n| s | km/h |\n0.0  1.5\n0.1 -0.5\n0.2  3.5';
assert.equal(read(trn, {}, true).rows.length, 3);
assert.equal(read('Time  Actual Speed\n0.0  1.5\n0.1 -0.5', {}, true).layout.unitRow, -1);
assert.deepEqual(read(trn, {}, true).rows.at(-1), ['0.2', '3.5']);

const raw = [['Time', 'Speed'], ['s', 'km/h'], ['0', '1']];
assert.match(utils.resolveImportLayout(raw, { timeColumn: 2 }).error, /時間列/);
assert.match(utils.resolveImportLayout(raw, { nameMode: 'manual', nameRow: 20 }).error, /名前行/);
assert.match(utils.resolveImportLayout(raw, { unitMode: 'manual', unitRow: 0 }).error, /単位行/);
assert.match(utils.resolveImportLayout([['Time', 'Speed']], {}).error, /データ開始/);
assert.ok(utils.resolveImportLayout([['Time', 'Speed'], ['0', '1'], ['1', '2']], { unitMode: 'manual', unitRow: 1 }).warnings.length);
assert.deepEqual(utils.detectHeaderRows([['Time', 'Speed'], ['0', '1']], 0, -1), { nameRow: 0, unitRow: -1 });
assert.equal(utils.normalizeImportOptions({ nameMode: 'bad', timeColumn: -2, delimiter: 'bad', encodingMode: 'bad' }).delimiter, 'auto');
console.log('import layout regressions passed');
