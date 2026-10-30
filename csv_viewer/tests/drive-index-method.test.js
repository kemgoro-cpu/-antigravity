'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Settings = require('../settings-utils.js');
const Units = require('../unit-validation-utils.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, name);
    return source.slice(start, end + 2);
}

const modes = {
    mdc: { id: 'mdc', phases: [{ name: 'Low', start: 0, end: 451 }, { name: 'Medium', start: 451, end: 1101 }, { name: 'High', start: 1101, end: 1477 }] },
    wltc: { id: 'wltc', phases: [{ name: 'Low', start: 0, end: 589 }, { name: 'Medium', start: 589, end: 1022 }] },
};
const state = { driveIndex: { calculationMethod: 'excel', channels: {}, cycleId: 'mdc', phaseOverride: null,
    roadLoadByFile: {}, alignByFile: {}, results: [] }, files: {}, customModes: [], customRAMs: [] };
const context = vm.createContext({ state, driveModeById: id => modes[id],
    window: { UnitValidation: Units }, driveInputId: () => 0, getMainFileId: () => null, getSubFileIds: () => [],
    esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
});
for (const name of ['driveCalculationMethod', 'getDriveIndexDefaultPhases', 'getEffectivePhases', 'getDriveIndexInputSignature',
    'getDriveIndexResultState', 'diFmtPct', 'diFmtNum', 'buildDriveIndexTable', 'buildDriveIndexAllTables', 'buildDriveIndexReportHtml']) {
    vm.runInContext(functionSource(name), context);
}
const plain = value => JSON.parse(JSON.stringify(value));

assert.equal(context.driveCalculationMethod(), 'excel');
assert.equal(context.driveCalculationMethod('unrecognized'), 'excel');
assert.deepEqual(plain(context.getEffectivePhases('mdc')).map(p => p.end), [589, 1022, 1477]);
state.driveIndex.calculationMethod = 'legacy';
assert.deepEqual(plain(context.getEffectivePhases('mdc')).map(p => p.end), [451, 1101, 1477]);
assert.deepEqual(plain(context.getEffectivePhases('wltc')), modes.wltc.phases);
state.driveIndex.phaseOverride = [{ name: 'my range', start: 5, end: 1477 }];
assert.deepEqual(plain(context.getEffectivePhases('mdc')), state.driveIndex.phaseOverride);
state.driveIndex.phaseOverride = null;

// Changing only the method invalidates a calculated result; view-only state
// changes do not enter the calculation signature.
const complete = { rmsse: 1, iwr: 2, ascr: 3, dr: 4, er: 5, eer: 6,
    distanceKm: 2, fuelL: 0.1, fuelKmPerL: 20, fuelLper100km: 5, diagnostics: { ok: true, issues: [] } };
state.driveIndex.results = [{ result: { total: complete } }];
state.driveIndex.resultSignature = context.getDriveIndexInputSignature();
assert.equal(context.getDriveIndexResultState().status, 'current');
state.driveIndex.calculationMethod = 'excel';
assert.equal(context.getDriveIndexResultState().status, 'stale');
state.driveIndex.resultSignature = context.getDriveIndexInputSignature();
state.theme = 'light';
assert.equal(context.getDriveIndexResultState().status, 'current');

const invalid = { ...complete, rmsse: null, diagnostics: { ok: false, issues: [{ message: '実測車速に欠測があります。' }] } };
state.driveIndex.results = [{ result: { total: invalid } }];
state.driveIndex.validationSummary = '実測車速に欠測があります。';
assert.equal(context.getDriveIndexResultState().status, 'empty');
assert.match(context.getDriveIndexResultState().reason, /欠測/);
const html = context.buildDriveIndexTable({ calculationMethod: 'excel', total: invalid, phases: [] });
assert.match(html, /Excel方式（通常指標）/);
assert.match(html, /di-diagnostics/);
assert.match(html, /実測車速に欠測/);
assert.match(html, /距離（元波形）/);
assert.match(context.buildDriveIndexTable({ calculationMethod: 'legacy', total: complete }), /計算方式: 従来方式/);

const reportDi = { calculationMethod: 'legacy', results: [{ fileName: 'synthetic', role: 'main', result: { calculationMethod: 'excel', total: complete }, warning: '計算済み精度を使用します。' }] };
const currentReport = context.buildDriveIndexReportHtml(reportDi, { status: 'current' });
assert.match(currentReport, /Excel方式（通常指標）/);
assert.match(currentReport, /計算済み精度/);
assert.match(currentReport, /距離（元波形）/);
assert.match(currentReport, /<th>指標<\/th>/);
const staleReport = context.buildDriveIndexReportHtml(reportDi, { status: 'stale', reason: '計算方式を変更しました。' });
assert.match(staleReport, /未更新/);
assert.ok(!staleReport.includes('<th>指標</th>') && !staleReport.includes('Excel方式'), 'stale exports must not label an old result as the new method');
const emptyReport = context.buildDriveIndexReportHtml({ results: [{ reason: '欠測' }], validationSummary: '欠測' }, { status: 'empty', reason: '実測車速に欠測があります。' });
assert.match(emptyReport, /実測車速に欠測/);
assert.ok(!emptyReport.includes('<th>指標</th>'));

// Zero road-load coefficients must survive opening the editor and recomputing.
const filesHtml = context.buildDriveIndexAllTables([{ fullName: 'synthetic.csv', fileName: 'synthetic', role: 'main', result: null }],
    { 'synthetic.csv': { A: 0, B: 0, C: 0, mass: 1 } }, {});
for (const letter of ['a', 'b', 'c']) assert.match(filesHtml, new RegExp(`class="di-rl-${letter}" value="0"`));

// Old presets use the new default, explicit legacy choice survives, and
// migration never modifies the caller's nested Drive Index settings object.
const prior = { _version: Settings.SETTINGS_VERSION, driveIndex: { cycleId: 'mdc', channels: { actual: 'Speed' } } };
const migrated = Settings.migrateSettings(prior).settings;
assert.equal(migrated.driveIndex.calculationMethod, 'excel');
assert.equal(prior.driveIndex.calculationMethod, undefined);
assert.equal(migrated.driveIndex.channels.actual, 'Speed');
assert.equal(Settings.migrateSettings({ driveIndex: { calculationMethod: 'legacy' } }).settings.driveIndex.calculationMethod, 'legacy');
assert.equal(Settings.migrateSettings({ driveIndex: { calculationMethod: 'bad' } }).settings.driveIndex.calculationMethod, 'excel');
assert.equal(Settings.migrateSettings({}).settings.driveIndex.calculationMethod, 'excel');
console.log('Drive Index method tests passed (defaults, phases, manual ranges, freshness, diagnostics, zero coefficients, immutable settings migration)');
