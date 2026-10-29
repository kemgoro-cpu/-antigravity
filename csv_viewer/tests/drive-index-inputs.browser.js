/* Isolated file:// browser coverage for unit contracts and stale Drive Index results. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const root = path.resolve(__dirname, '..');
    const openDrive = async () => {
        if (!(await page.locator('#drive-index-btn').isVisible())) await page.getByText('解析ツール ▾', { exact: true }).click();
        await page.locator('#drive-index-btn').click();
    };
    const recompute = async () => {
        await page.locator('.di-recompute').click();
        await page.waitForFunction(() => !window.__csvViewerDebug.state.driveIndex.calculating && !document.querySelector('.di-recompute').disabled);
    };
    try {
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        await page.locator('#file-input').setInputFiles(path.join(root, 'NEDC_sample_A.trn'));
        await page.waitForFunction(() => {
            const d = window.__csvViewerDebug;
            return Object.keys(d.state.files).length === 1 && d.state.parseJobs.size === 0 && !d.state.driveIndex.calculating && d.state.driveIndex.lastResult;
        }, { timeout: 30000 });
        const baseline = await page.evaluate(() => {
            const d = window.__csvViewerDebug;
            const f = Object.values(d.state.files)[0];
            return { result: d.state.driveIndex.results[0].result, time: Array.from(f.timeData.slice(0, 10)), status: d.getDriveIndexResultState().status };
        });
        assert.equal(baseline.status, 'current', 'Standard s/km/h/L/h TRN must remain evaluable');
        if (process.env.DRIVE_INDEX_BASELINE_DIR) {
            const oldContext = await browser.newContext();
            try {
                const oldPage = await oldContext.newPage();
                await oldPage.goto(pathToFileURL(path.join(process.env.DRIVE_INDEX_BASELINE_DIR, 'index.html')).href);
                await oldPage.waitForFunction(() => !!window.__csvViewerDebug);
                await oldPage.locator('#file-input').setInputFiles(path.join(root, 'NEDC_sample_A.trn'));
                await oldPage.waitForFunction(() => window.__csvViewerDebug.state.driveIndex.lastResult);
                const oldResult = await oldPage.evaluate(() => window.__csvViewerDebug.state.driveIndex.results[0].result);
                assert.deepEqual(baseline.result, oldResult, 'All metrics must match the committed pre-change application');
                console.log('NEDC metrics exactly match the committed pre-change baseline');
            } finally { await oldContext.close(); }
        }
        await openDrive();
        assert.match(await page.locator('.di-unit-status').innerText(), /実測車速: km\/h ✓/);
        assert.equal(await page.locator('.di-result-status').getAttribute('data-status'), 'current');
        await page.locator('.di-ch-actual').selectOption('Throttle');
        assert.equal(await page.locator('.di-result-status').getAttribute('data-status'), 'stale');
        assert.equal(await page.locator('.di-table:visible').count(), 0, 'Old numeric tables must disappear as soon as an input changes');
        await recompute();
        assert.equal(await page.locator('.di-result-status').getAttribute('data-status'), 'empty');
        assert.match(await page.locator('.di-unit-status').innerText(), /必要単位は km\/h/);

        await page.locator('.di-ch-actual').selectOption('Actual_Speed');
        await recompute();
        assert.equal(await page.locator('.di-result-status').getAttribute('data-status'), 'current');
        const restored = await page.evaluate(() => window.__csvViewerDebug.state.driveIndex.results[0].result);
        assert.deepEqual(restored, baseline.result, 'Validated original units must preserve every existing metric');

        await page.locator('.di-ch-fuel').selectOption('Engine_RPM');
        await recompute();
        const fuelBlocked = await page.evaluate(() => window.__csvViewerDebug.state.driveIndex.results[0]);
        assert.ok(fuelBlocked.result, 'Bad optional fuel units must not disable valid drive quality');
        assert.equal(fuelBlocked.result.total.fuelL, null);
        assert.equal(fuelBlocked.result.total.rmsse, baseline.result.total.rmsse);
        assert.match(fuelBlocked.warning, /燃費は未評価/);

        await page.locator('.di-ch-fuel').selectOption('Fuel_Rate');
        await recompute();
        await page.locator('.di-close').click();
        await page.evaluate(async () => {
            const d = window.__csvViewerDebug;
            await d.addCustomRAM('ConfirmedSpeed', 'Actual_Speed', 'km/h');
        });
        await openDrive();
        assert.match(await page.locator('.di-ch-actual').innerText(), /@ConfirmedSpeed \[km\/h\]（計算）/);
        await page.locator('.di-ch-actual').selectOption('@ConfirmedSpeed');
        await recompute();
        assert.equal(await page.locator('.di-result-status').getAttribute('data-status'), 'current');
        await page.locator('.di-close').click();
        await page.evaluate(async () => {
            const d = window.__csvViewerDebug;
            const ram = d.state.customRAMs.find(c => c.name === '@ConfirmedSpeed');
            await d.editCustomRAM(ram.id, 'Actual_Speed * 2', 'km/h');
        });
        assert.equal(await page.evaluate(() => window.__csvViewerDebug.getDriveIndexResultState().status), 'stale', 'Changed formulas must invalidate prior results');
        const staleDownload = page.waitForEvent('download');
        await page.evaluate(() => window.__csvViewerDebug.exportReportHTML());
        const staleReport = fs.readFileSync(await (await staleDownload).path(), 'utf8');
        assert.match(staleReport, /未更新：/);
        assert.ok(!staleReport.includes('<th>指標</th>'), 'A stale report must omit the old Drive Index metrics table');

        await page.evaluate(async () => {
            const d = window.__csvViewerDebug;
            const f = Object.values(d.state.files)[0];
            d.state.driveIndex.channels.actual = 'Actual_Speed';
            f.columns.find(c => c.name === 'Actual_Speed').unit = '';
            await d.computeDriveIndex({ autoDetect: false });
        });
        assert.equal(await page.evaluate(() => window.__csvViewerDebug.getDriveIndexResultState().status), 'empty', 'Missing speed units must not produce a normal evaluation');
        await page.evaluate(async () => {
            const d = window.__csvViewerDebug;
            const f = Object.values(d.state.files)[0];
            f.columns.find(c => c.name === 'Actual_Speed').unit = 'km/h';
            f.headerInfo.timeScaleSource = 'auto';
            await d.computeDriveIndex({ autoDetect: false });
        });
        assert.equal(await page.evaluate(() => window.__csvViewerDebug.getDriveIndexResultState().status), 'empty', 'Guessed time units need explicit confirmation');
        await openDrive();
        await page.locator('[data-di-time-unit="s"]').click();
        await recompute();
        assert.equal(await page.locator('.di-result-status').getAttribute('data-status'), 'current');
        const final = await page.evaluate(() => {
            const d = window.__csvViewerDebug;
            return { time: Array.from(Object.values(d.state.files)[0].timeData.slice(0, 10)), result: d.state.driveIndex.results[0].result };
        });
        assert.deepEqual(final.time, baseline.time, 'Confirming an already-second timebase must not change values');
        assert.deepEqual(final.result, baseline.result);
        await page.locator('.di-close').click();
        const normalDownload = page.waitForEvent('download');
        await page.evaluate(() => window.__csvViewerDebug.exportReportHTML());
        const normalReport = fs.readFileSync(await (await normalDownload).path(), 'utf8');
        const reportedRms = await page.evaluate(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const row = [...doc.querySelectorAll('tr')].find(r => r.firstElementChild?.textContent === 'RMSSE [km/h]');
            return row?.children[1]?.textContent;
        }, normalReport);
        assert.ok(reportedRms && reportedRms !== '—', 'Current report must include the result.total metric value');
        assert.ok(Math.abs(Number(reportedRms.replace(/,/g, '')) - final.result.total.rmsse) < 0.01);
        assert.deepEqual(errors, []);
        console.log('Drive Index input browser contracts passed: valid TRN, stale UI, wrong/unknown units, optional fuel, Custom RAM, time confirmation');
    } finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
