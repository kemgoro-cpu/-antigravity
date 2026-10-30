/* Isolated Edge + file:// regression; all imported values are synthetic. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = process.env.CSV_VIEWER_ROOT || path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    await context.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-trn-aligned-'));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const names = ['Time', 'Actual Speed', 'Engine RPM', 'LongChannelName', 'Next Sensor', 'Flag'];
    const units = ['sec', 'km/h', 'rpm', 'No Unit', 'N-m', 'No Unit'];
    assert.equal(names[3].length, 15, 'one padding space must remain after the long name');
    const header = cells => '|' + cells.map((cell, i) => (i ? cell : ' ' + cell).padEnd(16)).join('').slice(0, -1);
    const values = cells => cells.map(cell => String(cell).padStart(15) + ' ').join('').slice(0, -1);
    const text = ['| CASE #     1', header(names), header(units),
        values([0, 0.5, 500, 7, 8, 0]), values([0.1, -0.5, 500, 9, 10, 1]), values([0.2, 0.5, 500, 11, 12, 0]),
        '0.3\t\t500\t-1.25D-02\t14\t1'].join('\r\n');
    const fixture = path.join(output, 'synthetic-aligned.trn');
    fs.writeFileSync(fixture, text);

    async function settled() {
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 1
            && window.__csvViewerDebug.state.parseJobs.size === 0);
    }
    async function selectChannel(name) {
        await page.locator('#column-search').fill(name);
        await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        await page.waitForFunction(name => {
            const file = Object.values(window.__csvViewerDebug.state.files)[0];
            const column = file.columns.find(column => column.name === name);
            return column && !!file.colData[column.id];
        }, name);
    }
    async function snapshot() {
        return page.evaluate(() => {
            const file = Object.values(window.__csvViewerDebug.state.files)[0];
            return { time: [...file.timeData], sourceRows: [...file.sourceRowNumbers],
                names: file.columns.map(column => column.name), units: file.columns.map(column => column.unit),
                columns: file.columns.map(column => [...file.colData[column.id]]),
                nameRow: file.headerInfo.nameRow, unitRow: file.headerInfo.unitRow };
        });
    }
    function assertValues(result) {
        assert.deepEqual(result.time, [0, 0.1, 0.2, 0.3]);
        assert.deepEqual(result.sourceRows, [4, 5, 6, 7]);
        assert.deepEqual(result.names, names.slice(1));
        assert.deepEqual(result.units, units.slice(1));
        assert.equal(result.nameRow, 1); assert.equal(result.unitRow, 2);
        assert.deepEqual(result.columns[0].slice(0, 3), [0.5, -0.5, 0.5]);
        assert.ok(Number.isNaN(result.columns[0][3]), 'an explicit blank must not become the neighboring 500');
        assert.deepEqual(result.columns[1], [500, 500, 500, 500]);
        assert.deepEqual(result.columns[2].slice(0, 3), [7, 9, 11]);
        assert.ok(Math.abs(result.columns[2][3] + 0.0125) < 1e-8);
        assert.deepEqual(result.columns[3], [8, 10, 12, 14]);
        assert.deepEqual(result.columns[4], [0, 1, 0, 1]);
    }
    try {
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        await page.locator('#import-review-before-load').check();
        await page.locator('#file-input').setInputFiles(fixture);
        await page.locator('.import-preview-modal').waitFor();
        await page.waitForFunction(() => !document.getElementById('ip-confirm').disabled);
        assert.deepEqual(await page.locator('#import-preview-table tr.is-header td').allTextContents(), names);
        assert.deepEqual(await page.locator('#import-preview-table tr.is-unit td').allTextContents(), units);
        assert.equal(await page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files).length), 0);
        await page.locator('#ip-confirm').click();
        await settled();
        for (const name of names.slice(1)) await selectChannel(name);
        await page.locator('#column-search').fill('');
        const result = await snapshot();
        assertValues(result);
        await page.waitForFunction(() => window.__csvViewerDebug.state.chart.getOption().series.length >= 2);
        const chart = await page.evaluate(() => {
            const d = window.__csvViewerDebug, series = d.state.chart.getOption().series;
            return { values: series.filter(item => Array.isArray(item.data)).map(item => item.data.map(point => point[1])),
                png: d.getChartImageDataURL().startsWith('data:image/png;base64,') };
        });
        assert.ok(chart.values.some(values => values.length === 4 && values[0] === 0.5 && values[1] === -0.5 && values[2] === 0.5));
        assert.ok(chart.values.some(values => values.length === 4 && values.every(value => value === 500)));
        assert.ok(chart.png, 'the imported mapped values must render');
        await page.screenshot({ path: path.join(output, 'aligned-trn-chart.png') });
        await page.waitForTimeout(800);
        await page.reload();
        await settled();
        await page.waitForFunction(() => {
            const file = Object.values(window.__csvViewerDebug.state.files)[0];
            return file.columns.every(column => !!file.colData[column.id]);
        });
        assertValues(await snapshot());
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        console.log('Aligned TRN browser passed (preview, signed/blank/D-exponent mapping, chart, restore). Evidence:', output);
    } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
