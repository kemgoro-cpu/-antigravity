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
    console.log('trn-loading tests passed (signed speed, blanks, exponents, rejection, lazy loading, CSV)');
})().catch(error => { console.error(error); process.exitCode = 1; });
