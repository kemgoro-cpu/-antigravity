/* Exceedance status, plot markers, and navigation on the real comparison UI. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    // Native scrollbars expose layout errors hidden by Playwright's headless default.
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => {
        window.__toleranceTestErrors = [];
        window.addEventListener('error', event => window.__toleranceTestErrors.push(event.message));
    });
    const page = await context.newPage(), pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-tolerance-ﾃｽﾄ-'));
    const labels = { main: '基準 ﾛｸﾞ', b: '比較 B ﾛｸﾞ', c: '比較 C ﾛｸﾞ' };
    const names = { main: '基準ﾛｸﾞ.csv', b: '比較ﾛｸﾞ_B.csv', c: '比較ﾛｸﾞ_C.csv' };
    const bDifferences = [0, 1, 3, 4, null, 0, 5, 0, -3, -3, 0];
    const cDifferences = [0, 2, 0, 0, 0, 2, 0, 0, 0, null, 2];
    const sample = (name, kind) => {
        const rows = [kind === 'c' ? 'Time,Pressure,Temp' : 'Time,Pressure,Empty,Temp', kind === 'c' ? 's,kPa,V' : 's,kPa,kPa,degC'];
        for (let time = 0; time <= 10; time++) {
            const difference = kind === 'b' ? bDifferences[time] : kind === 'c' ? cDifferences[time] : 0;
            const pressure = difference == null ? '' : 10 + difference;
            rows.push(kind === 'c' ? `${time},${pressure},20` : `${time},${pressure},${kind === 'b' ? '' : 20},20`);
        }
        return { name, mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) };
    };
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const card = (channel, fileLabel) => page.locator('.compare-result').filter({ has: page.locator('.compare-result-title', { hasText: channel }) }).filter({ hasText: fileLabel });
    const resultCount = () => page.locator('.compare-result').count();
    const ready = async () => {
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 6 && !document.getElementById('compare-calculate').disabled && document.getElementById('compare-results-list').getAttribute('aria-busy') === 'false');
        await settle(); // Plot markers are committed on the frame following result rows.
    };
    const waitStatus = (channel, fileLabel, status) => card(channel, fileLabel).and(page.locator(`[data-result-status="${status}"]`)).waitFor();
    const setTolerance = async (channel, fileLabel, value, status) => {
        const input = card(channel, fileLabel).locator('[data-tolerance]');
        await input.fill(value); await input.press('Enter');
        await ready(); await waitStatus(channel, fileLabel, status); await settle();
    };
    const visibleRange = () => page.evaluate(() => window.__csvViewerDebug.getVisibleXRange());
    const highlightOptions = () => page.evaluate(() => window.__csvViewerDebug.state.chart.getOption().series.filter(series => String(series.id).startsWith('tolerance-highlight-')).map(series => ({
        id: series.id, xAxisIndex: series.xAxisIndex,
        areas: (series.markArea?.data || []).map(area => [area[0].xAxis, area[1].xAxis]),
        points: (series.markLine?.data || []).map(line => Array.isArray(line) ? line[0].xAxis : line.xAxis),
    })));
    async function assertPressureMarkers(view) {
        const highlights = await highlightOptions();
        assert.equal(highlights.length, 1, `${view}: only the exceeded Pressure comparison gets plot highlights`);
        assert.deepEqual(highlights[0].areas, [[2, 3], [8, 9]], `${view}: contiguous sampled exceedances are bands`);
        assert.deepEqual(highlights[0].points, [6], `${view}: an isolated exceedance remains visible`);
        const targetAxis = await page.evaluate(label => {
            const line = window.__csvViewerDebug.state.chart.getOption().series.find(series => String(series.name).startsWith('Pressure ') && String(series.name).includes(label));
            return line?.xAxisIndex;
        }, labels.b);
        assert.notEqual(targetAxis, undefined, `${view}: the compared Pressure waveform is present`);
        assert.equal(highlights[0].xAxisIndex, targetAxis, `${view}: markers follow the matching file and channel grid`);
    }
    async function navigate(step, pointOrRange) {
        await card('Pressure', labels.b).locator(`[data-exceedance-step="${step}"]`).click(); await settle();
        assert.equal(await resultCount(), 6, 'internal exceedance navigation preserves the evaluated results');
        await waitStatus('Pressure', labels.b, 'exceeded');
        const range = await visibleRange();
        assert.ok(range[0] <= pointOrRange[0] && range[1] >= pointOrRange[1], `navigation shows ${pointOrRange.join('–')} s; got ${range}`);
        assert.ok(range[1] - range[0] < 5, 'navigation focuses the selected exceedance instead of the whole log');
        assert.match(await card('Pressure', labels.b).locator('.compare-exceedance-position').innerText(), new RegExp(String(pointOrRange[0])));
        await assertPressureMarkers('navigated overlay');
    }
    let stage = 'load three files';
    try {
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.locator('#file-input').setInputFiles([sample(names.main, 'main'), sample(names.b, 'b'), sample(names.c, 'c')]);
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 3 && window.__csvViewerDebug.state.parseJobs.size === 0);
        for (const key of ['main', 'b', 'c']) {
            const input = page.getByRole('textbox', { name: `${names[key]}の表示名`, exact: true });
            await input.fill(labels[key]); await input.press('Tab'); await settle();
        }
        for (const channel of ['Pressure', 'Empty', 'Temp']) await page.locator(`[data-channel="${channel}"] .col-item-top`).click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids === 3);
        await page.locator('[data-pane="results"]').click(); await page.locator('#compare-calculate').click(); await ready();
        assert.equal(await page.locator('#compare-sort').inputValue(), 'tolerance', 'the initial result order prioritizes tolerance exceedances');

        stage = 'explicit status and missing data';
        await waitStatus('Pressure', labels.b, 'unset');
        await waitStatus('Empty', labels.b, 'unavailable');
        await waitStatus('Empty', labels.c, 'unavailable');
        await waitStatus('Temp', labels.c, 'unavailable');
        assert.match(await card('Empty', labels.c).innerText(), /未対応|データなし/);
        assert.match(await card('Temp', labels.c).innerText(), /単位不一致/);
        assert.deepEqual(await highlightOptions(), [], 'unset tolerances never produce exceedance highlights');

        await setTolerance('Pressure', labels.b, '2', 'exceeded');
        await waitStatus('Pressure', labels.c, 'partial');
        assert.match(await card('Pressure', labels.b).innerText(), /5\s*点/);
        const counts = card('Pressure', labels.b).locator('dl > div').filter({ has: page.locator('dt', { hasText: '有効 / 欠損・範囲外' }) }).locator('dd');
        assert.equal(await counts.innerText(), '10 / 1', 'missing data is excluded from valid samples, not silently treated as zero');
        await setTolerance('Temp', labels.b, '2', 'within');
        await waitStatus('Temp', labels.c, 'unavailable');
        await waitStatus('Empty', labels.b, 'unavailable');
        await assertPressureMarkers('overlay');
        await page.evaluate(() => window.__csvViewerDebug.state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 2, start: 10, end: 90 })); await settle();
        assert.equal(await resultCount(), 6, 'a Y-axis-only zoom preserves the evaluated time interval and result rows');
        await assertPressureMarkers('Y-axis zoom');
        await page.evaluate(() => window.__csvViewerDebug.state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 2, start: 0, end: 100 })); await settle();
        await page.locator('#compare-sort').selectOption('name'); await settle();
        assert.match(await page.locator('.compare-result').first().locator('.compare-result-title').innerText(), /Empty/, 'channel-order selection remains available');
        await page.locator('#compare-sort').selectOption('tolerance'); await settle();
        assert.equal(await page.locator('.compare-result').first().getAttribute('data-result-status'), 'exceeded', 'severity sorting puts the exceeded comparison first without changing result identity');
        await page.screenshot({ path: path.join(output, 'tolerance-dark-1600.png') });
        await page.locator('#theme-toggle-btn').click(); await settle();
        await assertPressureMarkers('light overlay');
        await page.screenshot({ path: path.join(output, 'tolerance-light-1600.png') });
        await page.locator('#theme-toggle-btn').click(); await settle();

        stage = 'internal result navigation';
        await navigate(1, [2, 3]);
        await setTolerance('Pressure', labels.b, '4', 'exceeded');
        assert.equal(await counts.innerText(), '10 / 1', 'editing a tolerance after result navigation still evaluates the original interval');
        const revisedMarkers = await highlightOptions();
        assert.equal(revisedMarkers.length, 1);
        assert.deepEqual(revisedMarkers[0].areas, [], 'values equal to the revised tolerance do not remain in bands');
        assert.deepEqual(revisedMarkers[0].points, [6], 'a revised tolerance still finds an exceedance outside the current focused view');
        await setTolerance('Pressure', labels.b, '2', 'exceeded');
        await assertPressureMarkers('restored threshold after navigation');
        // Recalculation resets the per-row position, so next starts at the first run again.
        await navigate(1, [2, 3]); await navigate(1, [6, 6]); await navigate(1, [8, 9]);
        await navigate(-1, [6, 6]); await navigate(-1, [2, 3]);
        await card('Pressure', labels.b).locator('.compare-result-title').click(); await settle();
        assert.equal(await resultCount(), 6, 'jumping to the maximum also keeps valid results');
        const maximumRange = await visibleRange();
        assert.ok(maximumRange[0] <= 6 && maximumRange[1] >= 6, 'result title shows the maximum difference at 6 s');

        stage = 'view mapping and non-destructive highlight removal';
        // Existing public debug state seeds an unrelated event; no new production seam is needed.
        await page.evaluate(() => { const debug = window.__csvViewerDebug; debug.state.events = { expr: '既存イベント', intervals: [{ t0: 0, t1: 1 }] }; debug.renderChart(); });
        for (const view of ['stack', 'diff', 'overlay']) {
            await page.locator(`[data-view="${view}"]`).click(); await settle();
            assert.equal(await resultCount(), 6, `${view}: changing presentation preserves raw-data comparison results`);
            await assertPressureMarkers(view);
        }

        stage = 'external zoom invalidation';
        await page.evaluate(() => window.__csvViewerDebug.state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: 0, endValue: 1 }));
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 0); await settle();
        assert.deepEqual(await highlightOptions(), [], 'external zoom removes stale plot markers as well as result rows');
        const events = await page.evaluate(() => ({ intervals: window.__csvViewerDebug.state.events.intervals, series: window.__csvViewerDebug.state.chart.getOption().series.filter(series => String(series.id).startsWith('event-area-')).length }));
        assert.deepEqual(events.intervals, [{ t0: 0, t1: 1 }]); assert.ok(events.series > 0, 'clearing tolerance highlights preserves existing event bands');

        stage = 'threshold equality and clearing';
        await page.locator('#compare-range-all').click(); await settle();
        await page.locator('#compare-calculate').click(); await ready(); await assertPressureMarkers('full range recomputation');
        await setTolerance('Pressure', labels.b, '5', 'partial');
        assert.deepEqual(await highlightOptions(), [], 'a maximum equal to the threshold is not an exceedance');
        await setTolerance('Pressure', labels.b, '', 'unset');
        await waitStatus('Pressure', labels.c, 'unset');
        assert.deepEqual(await highlightOptions(), [], 'clearing the tolerance removes its markers');
        await setTolerance('Pressure', labels.b, '2', 'exceeded'); await assertPressureMarkers('restored threshold');

        stage = 'selected channel invalidation';
        await page.locator('[data-channel="Pressure"] .col-item-top').click();
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 0); await settle();
        assert.deepEqual(await highlightOptions(), [], 'deselecting a channel removes its stale markers');

        stage = 'calculated channel expression invalidation';
        const advanced = page.locator('.compare-advanced');
        if (!await advanced.evaluate(element => element.open)) await advanced.locator(':scope > summary').click();
        await page.locator('#custom-ram-name').fill('Scaled');
        await page.locator('#custom-ram-unit').fill('kPa');
        await page.locator('#custom-ram-expr').fill('Pressure');
        await page.locator('#custom-ram-expr').press('Escape'); // Close expression suggestions before clicking Add.
        await page.locator('#custom-ram-add').click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.selectedNames.has('@Scaled') && window.__csvViewerDebug.state.numGrids === 3); await settle();
        await page.locator('#compare-calculate').click(); await ready();
        await setTolerance('@Scaled', labels.b, '2', 'exceeded');
        const calculatedMarkers = await highlightOptions();
        assert.equal(calculatedMarkers.length, 1);
        assert.deepEqual(calculatedMarkers[0].areas, [[2, 3], [8, 9]]);
        assert.deepEqual(calculatedMarkers[0].points, [6]);
        await page.locator('.cr-edit').click();
        await page.locator('.custom-edit-expr-input').fill('Pressure * 0');
        await page.locator('.custom-edit-save').click();
        await page.locator('.custom-edit-save').waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 0); await settle();
        assert.deepEqual(await highlightOptions(), [], 'editing a formula without renaming its channel removes obsolete exceedance markers');
        await page.locator('#compare-calculate').click(); await ready();
        await waitStatus('@Scaled', labels.b, 'partial');
        const calculatedMaximum = card('@Scaled', labels.b).locator('dl > div').filter({ has: page.locator('dt', { hasText: '最大絶対差' }) }).locator('dd');
        assert.match(await calculatedMaximum.innerText(), /^0\s*kPa$/, 'recomputation uses the edited formula values');
        assert.deepEqual(await highlightOptions(), []);

        stage = 'source time-unit invalidation';
        await page.getByRole('combobox', { name: `${names.b}の時間単位`, exact: true }).selectOption('ms');
        await page.waitForFunction(fileName => {
            const file = Object.values(window.__csvViewerDebug.state.files).find(item => item.name === fileName);
            return file?.headerInfo.timeScaleUnit === 'ms' && document.querySelectorAll('.compare-result').length === 0;
        }, names.b); await settle();
        assert.deepEqual(await highlightOptions(), [], 'changing source time units removes results and markers from the old time base');
        const convertedEnd = await page.evaluate(fileName => {
            const file = Object.values(window.__csvViewerDebug.state.files).find(item => item.name === fileName);
            return file.timeData[file.timeData.length - 1];
        }, names.b);
        assert.ok(Math.abs(convertedEnd - 0.01) < 1e-12, 'the real sidebar control converted the source time base');

        assert.deepEqual(pageErrors, []);
        assert.deepEqual(await page.evaluate(() => window.__toleranceTestErrors), [], 'native browser layout errors must also be absent');
        await page.screenshot({ path: path.join(output, 'tolerance-final.png') });
        console.log('Comparison tolerance status, highlighting, and navigation regressions passed:', output);
    } catch (error) {
        await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
        console.error('Failed stage:', stage, '\nArtifacts:', output, '\nPage errors:', pageErrors, '\nWindow errors:', await page.evaluate(() => window.__toleranceTestErrors));
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
