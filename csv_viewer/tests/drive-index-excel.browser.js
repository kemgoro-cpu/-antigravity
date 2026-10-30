/* Isolated Edge regression; imported files contain only generated test values. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = process.env.CSV_VIEWER_ROOT || path.resolve(__dirname, '..');
const DriveIndex = require(path.join(root, 'drive-index-utils.js'));
const metrics = ['rmsse', 'iwr', 'ascr', 'dr', 'er', 'eer'];
const modeId = 'synthetic-browser-mode';
const time = Array.from({ length: 301 }, (_, i) => i / 10);
const target = time.map(t => t < 7 || t > 27 ? 0 : t < 14 ? (t - 7) * 3.2 : t < 20 ? 22.4 : (27 - t) * 3.2);
const actual = time.map((t, i) => i < 10 ? -0.15 : target[i] > 0
    ? target[i] + 0.2 * Math.sin(t * 2.7) : 0.10800000000000001);
const fuel = time.map(t => 1 + 0.3 * Math.sin(t / 5));
const phases = [{ name: 'First', start: 0, end: 15 }, { name: 'Second', start: 15, end: 30 }];
const roadLoad = { A: 5, B: 0, C: 0.001, mass: 1000 };
const quantize = values => values.map(Math.fround);
const expected = (method, windows = phases, damaged = false) => DriveIndex.computeMetrics({
    time, target: method === 'excel' ? target : quantize(target),
    actual: (method === 'excel' ? actual : quantize(actual)).map((value, i) => damaged && i === 120 ? NaN : value),
    fuelRate: method === 'excel' ? fuel : quantize(fuel), phases: windows, roadLoad, calculationMethod: method,
});
function assertMetrics(result, reference) {
    for (const metric of metrics) {
        assert.equal(Number.isFinite(result.total[metric]), true, `${metric} must be finite`);
        assert.ok(Math.abs(result.total[metric] - reference.total[metric]) <= 1e-9, `${metric}: app and source-precision core agree`);
    }
    assert.equal(result.phases.length, reference.phases.length);
    result.phases.forEach((phase, i) => {
        assert.equal(phase.start, reference.phases[i].start); assert.equal(phase.end, reference.phases[i].end);
        for (const metric of metrics) {
            const value = reference.phases[i][metric];
            if (value == null) assert.equal(phase[metric], null, `${phase.name} ${metric}`);
            else assert.ok(Math.abs(phase[metric] - value) <= 1e-9, `${phase.name} ${metric}`);
        }
    });
}

(async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-drive-index-excel-'));
    function writeFixture(name, damaged = false) {
        const rows = ['Time,Target_Speed,Actual_Speed,Fuel_Rate', 's,km/h,km/h,L/h',
            ...time.map((t, i) => `${t},${target[i]},${damaged && i === 120 ? '' : actual[i]},${fuel[i]}`)];
        const file = path.join(output, name); fs.writeFileSync(file, rows.join('\n')); return file;
    }
    const goodFile = writeFixture('synthetic-driving-index.csv');
    const missingFile = writeFixture('synthetic-missing-speed.csv', true);
    // This fixture distinguishes original decimal input from displayed Float32:
    // 0.108 km/h is at the Excel zero-speed cutoff, but its Float32 value is above it.
    const float32Reference = DriveIndex.computeMetrics({ time, target: quantize(target), actual: quantize(actual),
        fuelRate: quantize(fuel), phases, roadLoad, calculationMethod: 'excel' });
    assert.ok(Math.abs(expected('excel').total.rmsse - float32Reference.total.rmsse) > 1e-7,
        'the source-precision regression must fail if Drive Index reuses displayed Float32 speeds');

    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const errors = [], requests = [];
    async function open(file) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
        await context.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
        const page = await context.newPage(); page.setDefaultTimeout(30000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        assert.equal(await page.evaluate(() => window.__csvViewerDebug.state.driveIndex.calculationMethod), 'excel');
        await page.locator('#file-input').setInputFiles(file);
        await settled(page);
        return { context, page };
    }
    async function settled(page) {
        await page.waitForFunction(() => {
            const d = window.__csvViewerDebug;
            return Object.keys(d.state.files).length === 1 && d.state.parseJobs.size === 0 && !d.state.driveIndex.calculating;
        });
    }
    async function configure(page) {
        await page.evaluate(async ({ modeId, time, target, phases, roadLoad }) => {
            const d = window.__csvViewerDebug, file = Object.values(d.state.files)[0], di = d.state.driveIndex;
            d.state.customModes = [{ id: modeId, name: 'Synthetic mode', trace: { time, speed: target }, phases }];
            di.calculationMethod = 'excel'; di.cycleId = modeId; di.autoAlign = false; di.phaseOverride = null;
            di.channels = { target: 'Target_Speed', actual: 'Actual_Speed', fuel: 'Fuel_Rate' };
            di.roadLoadByFile[file.name] = roadLoad;
            await d.computeDriveIndex({ autoDetect: false });
        }, { modeId, time, target, phases, roadLoad });
    }
    async function displayColumns(page) {
        for (const name of ['Target_Speed', 'Actual_Speed', 'Fuel_Rate']) {
            await page.locator('#column-search').fill(name);
            await page.locator(`[data-channel="${name}"] .col-item-top`).click();
            await page.waitForFunction(name => {
                const file = Object.values(window.__csvViewerDebug.state.files)[0];
                const col = file.columns.find(col => col.name === name);
                return col && !!file.colData[col.id];
            }, name);
        }
        await page.locator('#column-search').fill('');
    }
    async function snapshot(page) {
        return page.evaluate(() => {
            const d = window.__csvViewerDebug, file = Object.values(d.state.files)[0];
            const columns = ['Target_Speed', 'Actual_Speed', 'Fuel_Rate'].map(name => {
                const col = file.columns.find(col => col.name === name), values = file.colData[col.id];
                return { name, type: values.constructor.name, values: [...values] };
            });
            return { method: d.state.driveIndex.calculationMethod, entry: d.state.driveIndex.results[0],
                status: d.getDriveIndexResultState().status, time: [...file.timeData], columns };
        });
    }
    async function openDrive(page) {
        if (!(await page.locator('#drive-index-btn').isVisible())) await page.getByText('解析ツール ▾', { exact: true }).click();
        await page.locator('#drive-index-btn').click();
    }
    async function recompute(page) {
        await page.locator('.di-recompute').click();
        await page.waitForFunction(() => !window.__csvViewerDebug.state.driveIndex.calculating
            && !document.querySelector('.di-recompute').disabled);
    }
    function assertWaveUnchanged(snapshot, original) {
        assert.deepEqual(snapshot.time, time);
        snapshot.columns.forEach((col, i) => {
            assert.equal(col.type, 'Float32Array');
            assert.deepEqual(col.values, original[i], `${col.name} displayed data must be unchanged`);
        });
        assert.ok(snapshot.columns[1].values.some(value => value < 0), 'the waveform must retain negative speed');
    }
    try {
        const first = await open(goodFile);
        try {
            await displayColumns(first.page);
            const original = [quantize(target), quantize(actual), quantize(fuel)];
            await configure(first.page);
            const excel = await snapshot(first.page);
            assert.equal(excel.status, 'current'); assert.equal(excel.method, 'excel');
            assertMetrics(excel.entry.result, expected('excel')); assertWaveUnchanged(excel, original);
            await openDrive(first.page);
            assert.equal(await first.page.locator('.di-method').inputValue(), 'excel');
            assert.equal(await first.page.locator('.di-rl-b').inputValue(), '0', 'zero road-load coefficient must survive rendering');
            assert.match(await first.page.locator('.di-calculation-note').first().innerText(), /Excel/);
            await first.page.locator('.di-method').selectOption('legacy');
            assert.equal(await first.page.locator('.di-result-status').getAttribute('data-status'), 'stale');
            assert.equal(await first.page.locator('.di-table:visible').count(), 0);
            await recompute(first.page);
            const legacy = await snapshot(first.page);
            assert.equal(legacy.method, 'legacy'); assert.equal(legacy.status, 'current');
            assertMetrics(legacy.entry.result, expected('legacy')); assertWaveUnchanged(legacy, original);
            assert.equal(await first.page.locator('.di-rl-b').inputValue(), '0');
            await first.page.locator('.di-close').click();
            await first.page.waitForTimeout(800);
            await first.page.reload(); await settled(first.page);
            await first.page.waitForFunction(() => window.__csvViewerDebug.getDriveIndexResultState().status === 'current');
            const restored = await snapshot(first.page);
            assert.equal(restored.method, 'legacy'); assertMetrics(restored.entry.result, expected('legacy'));
            assertWaveUnchanged(restored, original);
            await openDrive(first.page);
            await first.page.locator('.di-method').selectOption('excel'); await recompute(first.page);
            assertMetrics((await snapshot(first.page)).entry.result, expected('excel'));
            await first.page.locator('.di-cycle').selectOption('mdc');
            assert.deepEqual(await first.page.locator('.di-p-end').evaluateAll(els => els.map(el => Number(el.value))), [589, 1022, 1477]);
            await first.page.locator('.di-method').selectOption('legacy');
            assert.deepEqual(await first.page.locator('.di-p-end').evaluateAll(els => els.map(el => Number(el.value))), [451, 1101, 1477]);
            await first.page.locator('.di-cycle').selectOption(modeId);
            await first.page.locator('.di-method').selectOption('excel');
            await first.page.locator('.di-p-end').nth(0).fill('13');
            await first.page.locator('.di-p-start').nth(1).fill('13');
            await recompute(first.page);
            const editedPhases = [{ name: 'First', start: 0, end: 13 }, { name: 'Second', start: 13, end: 30 }];
            assertMetrics((await snapshot(first.page)).entry.result, expected('excel', editedPhases));
            await first.page.screenshot({ path: path.join(output, 'excel-method.png') });
        } finally { await first.context.close(); }

        const second = await open(missingFile);
        try {
            await displayColumns(second.page); await configure(second.page);
            const missing = await snapshot(second.page);
            for (const metric of metrics) assert.equal(missing.entry.result.total[metric], null, `${metric} must be unavailable with missing speed`);
            assert.equal(missing.status, 'empty');
            await openDrive(second.page);
            assert.equal(await second.page.locator('.di-table:visible').count(), 0, 'incomplete input must not show valid-looking numeric results');
            assert.ok((await second.page.locator('.di-diagnostics').innerText()).trim().length > 10, 'the missing-data reason must remain visible');
            assert.ok(Number.isNaN(missing.columns[1].values[120]), 'missing waveform samples must remain missing');
            await second.page.screenshot({ path: path.join(output, 'missing-speed.png') });
        } finally { await second.context.close(); }
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        console.log('Excel Driving Index browser passed (source precision, immutable waves, zero coefficient, method switch/restore, phase defaults/edits, missing-data diagnostics). Evidence:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
