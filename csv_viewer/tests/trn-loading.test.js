'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const U = require('../parser-utils.js');
const Papa = require('../lib/papaparse.min.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Exercise the actual two loading phases without starting the browser or using
// user files. Only UI/persistence side effects are replaced with no-op stubs.
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, name);
    return source.slice(start, end + 2);
}

function environment() {
    const errors = [];
    const noop = () => {};
    const context = vm.createContext({
        ...U, Papa, File: class SyntheticFile {},
        state: { files: {}, fileColors: {}, customRAMs: [], colorCtr: 0 },
        dom: { nameRow: {}, unitRow: {} },
        SERIES_COLORS: ['#2563eb'],
        _restoreOrderById: new Map(), _origFileById: new Map(),
        _nextSessionOrder: 0, _parseQueue: new Map(),
        detectHeaderRows: raw => U.detectHeaderRows(raw, 0, 1),
        showError: (title, detail) => errors.push({ title, detail }),
        showWarning: noop, finishParseJob: noop, updateParseJob: noop,
        createParseJob: () => ({}), autoNormalizeTimeScales: noop,
        updateParsePreview: noop, sessionSaveFile: noop,
        applyPendingSettings: async () => {}, applyDeferredCrossRAMs: async () => {},
        autoGenerateFuelRAMs: async () => {}, computeDriveIndex: async () => {},
        updateUI: noop, saveSettings: noop, resetHistoryBaseline: noop,
        detectBitChannels: noop, console: { log: noop, warn: noop },
    });
    for (const name of ['isTrnFile', 'describeHeaderParseIssue', 'onHeaderParsed', 'loadColumnsForFile']) {
        vm.runInContext(functionSource(name), context);
    }
    return { context, errors };
}

async function load(text, extension = 'trn') {
    const env = environment();
    const data = extension === 'trn' ? U.convertWhitespaceToTabs(text) : text;
    const delimiter = extension === 'trn' ? '\t' : ',';
    const raw = Papa.parse(data, { delimiter, header: false, skipEmptyLines: true }).data;
    env.context.onHeaderParsed('f', `synthetic.${extension}`, data, raw, delimiter, 'utf-8', 'auto', {}, {});
    await new Promise(resolve => setImmediate(resolve));
    const file = env.context.state.files.f;
    if (file) await env.context.loadColumnsForFile('f', ['Actual Speed', 'Engine RPM']);
    return { ...env, file };
}

const header = 'Time  Actual Speed  Engine RPM\ns     km/h          rpm\n';

(async () => {
    const signed = await load(header + '0.0  0.5  500\n0.1 -0.5  500\n0.2  0.5  500');
    assert.deepEqual(signed.errors, []);
    assert.deepEqual(Array.from(signed.file.timeData), [0, 0.1, 0.2]);
    assert.deepEqual(Array.from(signed.file.colData.f_c1), [0.5, -0.5, 0.5]);
    assert.deepEqual(Array.from(signed.file.colData.f_c2), [500, 500, 500]);

    const empty = await load('Time\tActual Speed\tEngine RPM\ns\tkm/h\trpm\n0\t0.5\t500\n0.1\t\t500\n0.2\t-0.5\t');
    assert.deepEqual(empty.errors, []);
    assert.ok(Number.isNaN(empty.file.colData.f_c1[1]));
    assert.equal(empty.file.colData.f_c2[1], 500);
    assert.ok(Number.isNaN(empty.file.colData.f_c2[2]));
    assert.equal(empty.file.timeData.length, empty.file.colData.f_c1.length);

    const exponent = await load(header + '0 -1.25D-02 500\n0.1 -1.25E+02 500');
    assert.deepEqual(exponent.errors, []);
    assert.ok(Math.abs(exponent.file.colData.f_c1[0] + 0.0125) < 1e-8);
    assert.equal(exponent.file.colData.f_c1[1], -125);

    for (const bad of ['0.1 -0.5', '0.1 -0.5 500 999', '0.1 bad 500', '\t-0.5\t500']) {
        const invalid = await load(header + '0 0.5 500\n' + bad);
        assert.equal(invalid.file, undefined, bad);
        assert.equal(invalid.errors.length, 1, bad);
        assert.match(invalid.errors[0].detail, /4/);
    }

    // The lazy loader must also reject bad rows and settle its promise without
    // installing a partial column, even after a file was initially accepted.
    const stale = await load(header + '0 0.5 500\n0.1 -0.5 500');
    stale.file.colData = {};
    stale.file.file = U.convertWhitespaceToTabs(header + '0 0.5 500\n0.1 bad 500');
    await stale.context.loadColumnsForFile('f', ['Actual Speed']);
    assert.equal(stale.file.colData.f_c1, undefined);
    assert.equal(stale.errors.length, 1);
    assert.equal(stale.context._parseQueue.size, 0);

    const csv = await load('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,0.5,500\n0.1,-0.5,500\n0.2,,500', 'csv');
    assert.deepEqual(csv.errors, []);
    assert.equal(csv.file.colData.f_c1[1], -0.5);
    assert.ok(Number.isNaN(csv.file.colData.f_c1[2]));
    assert.equal(csv.file.colData.f_c2[2], 500);

    // Diagnostics use exactly the retained time rows and keep legacy parseFloat
    // values unchanged. Empty cells/literal NaN are different from invalid text.
    const quality = await load('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,0,500\nbad,ignore,500\n1, ,500\n2,NaN,500\n3,garbage,500\n4,Infinity,500\n5,12tail,500\n6,1e309,500\n7,,', 'csv');
    assert.deepEqual(quality.errors, []);
    assert.deepEqual(Array.from(quality.file.sourceRowNumbers), [3, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(JSON.parse(JSON.stringify(quality.file.importDiagnostics.invalidTimeDetails)), [{ sourceRow: 4, raw: 'bad' }]);
    assert.equal(quality.file.columnDiagnostics.f_c1.missingCount, 3);
    assert.equal(quality.file.columnDiagnostics.f_c1.invalidValueCount, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(quality.file.columnDiagnostics.f_c1.invalidValueRows)), [
        { index: 3, sourceRow: 7, raw: 'garbage' },
        { index: 4, sourceRow: 8, raw: 'Infinity' },
        { index: 6, sourceRow: 10, raw: '1e309' },
    ]);
    assert.equal(quality.file.colData.f_c1[5], 12, 'CSV numeric prefix behavior is preserved');
    assert.equal(quality.file.colData.f_c1[4], Infinity, 'diagnosis does not rewrite data');
    assert.equal(quality.file.columnDiagnostics.f_c2.missingCount, 1);
    assert.equal(quality.file.columnDiagnostics.f_c2.invalidValueCount, 0);
    const bounded = await load('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n' + Array.from({ length: 1002 }, (_, i) => `${i},${'x'.repeat(100)},500`).join('\n'), 'csv');
    assert.equal(bounded.file.columnDiagnostics.f_c1.invalidValueCount, 1002);
    assert.equal(bounded.file.columnDiagnostics.f_c1.invalidValueRows.length, 1000);
    assert.equal(bounded.file.columnDiagnostics.f_c1.invalidValueRows[0].raw.length, 80);
    assert.equal(bounded.file.columnDiagnostics.f_c1.invalidValueRows[999].sourceRow, 1002);
    const invalidTimes = await load('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,0,500\n,1,500\n' + Array.from({ length: 1001 }, () => `${'x'.repeat(100)},1,500`).join('\n'), 'csv');
    assert.equal(invalidTimes.file.importDiagnostics.invalidTimeCount, 1002);
    assert.equal(invalidTimes.file.importDiagnostics.invalidTimeDetails.length, 1000);
    assert.deepEqual(JSON.parse(JSON.stringify(invalidTimes.file.importDiagnostics.invalidTimeDetails[0])), { sourceRow: 4, raw: '' });
    assert.equal(invalidTimes.file.importDiagnostics.invalidTimeDetails[1].raw.length, 80);
    console.log('trn-loading tests passed (TRN, CSV, lazy loading, bounded source-row diagnostics)');
})().catch(error => { console.error(error); process.exitCode = 1; });
