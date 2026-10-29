'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const file = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

async function openInspector(page, tab) {
    if (!await page.locator('#data-inspector').isVisible()) await page.locator('#inspector-open').click();
    await page.locator('#inspector-tab-' + tab).click();
    if (tab === 'stats') await page.locator('#inspector-statistics').waitFor();
}

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const errors = [];
    async function open(legacySettings) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
        if (legacySettings) await context.addInitScript(settings => localStorage.setItem('csvViewer_settings', JSON.stringify(settings)), legacySettings);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url); await page.waitForFunction(() => !!window.__csvViewerDebug);
        return { context, page };
    }
    const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const loaded = (page, count) => page.waitForFunction(count => Object.keys(window.__csvViewerDebug.state.files).length === count && !window.__csvViewerDebug.state.parseJobs.size, count);
    async function select(page, name) {
        await page.locator('#column-search').fill(name);
        await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        await settled(page);
    }
    try {
        const normal = await open(), page = normal.page;
        await page.locator('#file-input').setInputFiles(['基準_ﾛｸﾞ.csv', '比較_ﾛｸﾞ.csv'].map(name => path.join(root, 'docs/samples', name)));
        await loaded(page, 2); await select(page, 'Speed');
        await page.evaluate(() => window.__csvViewerDebug.selectAnalysisRange([10, 30])); await settled(page);
        await page.locator('#analysis-scope').selectOption('all'); await settled(page);
        await page.locator('[data-range-action="compare"]').click();
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 1);
        assert.equal(await page.locator('#analysis-scope').inputValue(), 'selection', 'Selection-bar compare must use its labelled interval');
        assert.match(await page.locator('#compare-results-status').innerText(), /10–30/);
        await page.locator('#analysis-scope').selectOption('all'); await settled(page);
        await page.locator('[data-range-action="note"]').click();
        assert.equal(await page.locator('#analysis-scope').inputValue(), 'selection', 'Selection-bar note must use its labelled interval');

        await page.evaluate(() => window.__csvViewerDebug.selectAnalysisRange([10, 10])); await settled(page);
        const download = page.waitForEvent('download');
        await page.evaluate(() => window.__csvViewerDebug.exportReportHTML());
        const report = fs.readFileSync(await (await download).path(), 'utf8');
        assert.match(report, /選択区間 10 – 10 s/);
        assert.match(report, /選択時刻の前後も含みます/);
        const visible = await page.evaluate(() => window.__csvViewerDebug.getVisibleXRange());
        assert.ok(visible[0] < 10 && visible[1] > 10 && visible[1] - visible[0] < 5, 'Single-point image must show nearby context');
        assert.deepEqual(await page.evaluate(() => window.__csvViewerDebug.getAnalysisContext().range), [10, 10]);

        // Valid interval with no source records: no fabricated zero statistic or CSV.
        await page.evaluate(() => window.__csvViewerDebug.selectAnalysisRange([10.1, 10.2])); await settled(page);
        await openInspector(page, 'stats');
        assert.equal(await page.locator('#inspector-statistics tbody tr').count(), 0);
        await page.evaluate(() => window.__csvViewerDebug.showXYPlotModal());
        await page.waitForFunction(() => document.querySelector('#xy-data-count').textContent.includes('有効 0 点'));
        assert.deepEqual(await page.evaluate(() => echarts.getInstanceByDom(document.querySelector('#xy-chart')).getOption().series.map(s => s.data.length)), [0, 0]);
        await page.locator('.xy-modal .modal-close-btn').click();
        let unexpectedDownload = false;
        const markDownload = () => { unexpectedDownload = true; }; page.on('download', markDownload);
        await page.evaluate(() => window.__csvViewerDebug.exportVisibleCSV()); await settled(page);
        assert.equal(unexpectedDownload, false); page.off('download', markDownload);
        assert.match(await page.locator('body').innerText(), /区間内にデータ点がありません/);
        await normal.context.close();

        const legacy = await open({ _version: 6, nameRowIdx: '2', unitRowIdx: '4', encodingMode: 'utf-8' });
        assert.equal(await legacy.page.locator('#import-name-mode').inputValue(), 'manual');
        assert.equal(await legacy.page.locator('#import-unit-mode').inputValue(), 'manual');
        await legacy.page.locator('#file-input').setInputFiles(file('legacy.csv', 'metadata,value\nTick,Pressure\nCalibration,run A\ns,kPa\n0,10\n1,20\n'));
        await loaded(legacy.page, 1); await select(legacy.page, 'Pressure');
        assert.deepEqual(await legacy.page.evaluate(() => {
            const f = Object.values(window.__csvViewerDebug.state.files)[0], c = f.columns.find(c => c.name === 'Pressure');
            return { nameRow: f.headerInfo.nameRow, unitRow: f.headerInfo.unitRow, unit: c.unit, time: Array.from(f.timeData), values: Array.from(f.colData[c.id]) };
        }), { nameRow: 1, unitRow: 3, unit: 'kPa', time: [0, 1], values: [10, 20] });
        await legacy.context.close();

        const reset = await open(), reversed = reset.page;
        const resetCsv = 'Time,Pressure\ns,kPa\n0,0\n10,100\n1,10\n2,20\n';
        await reversed.locator('#file-input').setInputFiles([file('reset-main.csv', resetCsv), file('reset-sub.csv', resetCsv)]);
        await loaded(reversed, 2); await select(reversed, 'Pressure');
        await reversed.evaluate(() => window.__csvViewerDebug.selectAnalysisRange([0, 2])); await settled(reversed);
        await openInspector(reversed, 'stats');
        const statsRows = await reversed.locator('#inspector-statistics tbody tr').allTextContents();
        assert.equal(statsRows.length, 2);
        for (const text of statsRows) assert.match(text, /3\s*$/);
        await reversed.locator('[data-pane="results"]').click(); await reversed.locator('#compare-calculate').click();
        await reversed.waitForFunction(() => document.querySelectorAll('.compare-result').length === 1);
        assert.match(await reversed.locator('.compare-result').innerText(), /時刻が逆転.*未評価/);
        const source = await reversed.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(f => Array.from(f.timeData)));
        assert.deepEqual(source, [[0, 10, 1, 2], [0, 10, 1, 2]], 'Validation must retain original timestamp order');
        await reset.context.close();
        assert.deepEqual(errors, []);
        console.log('Analysis regression browser passed: selection actions, single-point report, empty scope, v6 manual rows, clock-reset statistics and comparison');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
