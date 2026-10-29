/* State and draft regressions. Runs offline with an isolated browser profile. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-ux-比較-ﾃｽﾄ-'));
    const files = [0, 1, 2].map(file => {
        const rows = [`Time,${file ? 'Actual' : 'Pressure'},Temperature,State`, 's,kPa,degC,'];
        for (let i = 0; i <= 200; i++) rows.push(`${i / 10},${Math.sin(i / 20) + file},${20 + i / 100 + file},${i >= 80 + file * 5 ? 1 : 0}`);
        const name = path.join(output, `比較_ﾛｸﾞ_${file}.csv`); fs.writeFileSync(name, rows.join('\n')); return name;
    });
    const pauseFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = fn => page.evaluate(fn);
    const visibleRange = () => state(() => window.__csvViewerDebug.getVisibleXRange());
    async function select(name) {
        const row = page.locator(`[data-channel="${name}"] .col-item-top`);
        if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
        await pauseFrame();
    }
    async function brush(start, end) {
        const points = await state(() => {
            const d = window.__csvViewerDebug, rect = document.getElementById('chart').getBoundingClientRect();
            return { left: rect.left, top: rect.top + d.state.gridRegions[0].top + 45 };
        });
        const xs = await page.evaluate(([a, b]) => [a, b].map(t => window.__csvViewerDebug.state.chart.convertToPixel({ xAxisIndex: 0 }, t)), [start, end]);
        await page.mouse.move(points.left + xs[0], points.top); await page.mouse.down();
        await page.mouse.move(points.left + xs[1], points.top, { steps: 12 }); await page.mouse.up();
        await pauseFrame();
    }
    try {
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.locator('#file-input').setInputFiles(files);
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 3 && window.__csvViewerDebug.state.parseJobs.size === 0);
        await select('Pressure');
        await page.locator('[data-map-index="0"]').selectOption('Actual');
        await select('Temperature');
        assert.equal(await page.locator('[data-map-index="0"]').inputValue(), 'Actual', 'channel selection must preserve uncommitted mapping');
        assert.match(await page.locator('[data-map-status="0"]').innerText(), /未適用/);
        assert.equal(await state(() => window.__csvViewerDebug.state.comparison.matches['比較_ﾛｸﾞ_1.csv']?.Pressure), undefined, 'draft mapping must not apply early');
        await page.locator('[data-pane="notes"]').click();
        await page.locator('#compare-note-text').fill('応答差の調査中。ﾃｽﾄ');
        await page.locator('#export-menu-btn').click(); await page.locator('#save-purpose').selectOption('template');
        await page.locator('#compare-template-name').fill('再利用する比較'); await page.locator('#save-workspace-close').click();
        await page.locator('[data-pane="prepare"]').click();
        assert.equal(await page.locator('[data-map-index="0"]').inputValue(), 'Actual', 'pane switching must preserve mapping');
        await page.locator('#compare-map-apply').click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.comparison.matches['比較_ﾛｸﾞ_1.csv']?.Pressure === 'Actual');
        await pauseFrame();
        await page.locator('[data-pane="notes"]').click();
        assert.equal(await page.locator('#compare-note-text').inputValue(), '応答差の調査中。ﾃｽﾄ');
        await page.locator('#export-menu-btn').click();
        assert.equal(await page.locator('#compare-template-name').inputValue(), '再利用する比較');
        await page.locator('#save-workspace-close').click();
        await select('State');
        assert.equal(await page.locator('#compare-note-text').inputValue(), '応答差の調査中。ﾃｽﾄ', 'structural rerender must preserve note');
        await page.locator('#compare-raw').check(); await pauseFrame();
        assert.equal(await page.locator('#compare-note-text').inputValue(), '応答差の調査中。ﾃｽﾄ');
        await page.locator('#compare-raw').uncheck(); await pauseFrame();

        await page.locator('[data-pane="align"]').click();
        await page.locator('#compare-align-span').fill('12.5');
        await page.locator('#compare-align-scope').selectOption('visible');
        await page.locator('.compare-manual > summary').click();
        await page.locator('#compare-anchor-main').fill('4'); await page.locator('#compare-anchor-sub').fill('6');
        await page.locator('[data-pane="results"]').click(); await page.locator('[data-pane="align"]').click();
        assert.equal(await page.locator('#compare-align-span').inputValue(), '12.5');
        assert.equal(await page.locator('#compare-align-scope').inputValue(), 'visible');
        assert.equal(await page.locator('#compare-anchor-main').inputValue(), '4');
        assert.equal(await page.locator('#compare-anchor-sub').inputValue(), '6');
        await page.locator('.compare-manual > summary').click();
        await page.locator('#compare-align-manual').click();
        await page.waitForFunction(() => !document.getElementById('compare-align-apply').disabled);
        await state(() => window.__csvViewerDebug.state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: 2, endValue: 10 }));
        await pauseFrame();
        assert.equal(await page.locator('#compare-align-apply').isDisabled(), true, 'changed visible range invalidates alignment preview');
        assert.equal(await page.locator('#compare-align-span').inputValue(), '12.5');
        await page.locator('#compare-range-all').click(); await pauseFrame();

        await page.locator('[data-pane="results"]').click();
        // Move the interval while an async comparison is in flight. Old results may not reappear.
        await state(() => {
            document.getElementById('compare-calculate').click();
            return Promise.resolve().then(() => window.__csvViewerDebug.state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: 2, endValue: 10 }));
        });
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.compare-result').count(), 0);
        assert.match(await page.locator('#compare-results-status').innerText(), /対象区間が変わりました/);
        assert.equal(await page.locator('#compare-calculate').isDisabled(), false);
        await page.locator('#compare-calculate').click();
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 6);
        assert.match(await page.locator('#compare-results-status').innerText(), /2–10 s/);
        await page.locator('#compare-sort').selectOption('tolerance');
        await page.locator('[data-pane="notes"]').click(); await page.locator('[data-pane="results"]').click();
        assert.equal(await page.locator('#compare-sort').inputValue(), 'tolerance');
        await page.locator('[data-channel="State"] .bit-badge').click(); await pauseFrame();
        assert.equal(await page.locator('.compare-result').count(), 0, 'interpolation mode changes invalidate results');

        const prior = await visibleRange();
        await page.locator('#compare-range-start').fill(''); await page.locator('#compare-range-end').fill('15');
        await page.locator('#compare-range-end').press('Enter');
        assert.deepEqual(await visibleRange(), prior, 'blank start must not silently become zero');
        await page.locator('#compare-range-all').click(); await pauseFrame();

        // Cancellation must release the specialized brush intent for normal box zoom.
        await page.locator('#compare-select-range').click();
        assert.equal(await page.locator('#compare-select-range').getAttribute('aria-pressed'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#compare-select-range').getAttribute('aria-pressed'), 'false');
        await page.keyboard.press('b'); await brush(4, 8);
        assert.equal(await page.locator('#compare-selection').isVisible(), false);
        let zoom = await visibleRange(); assert.ok(Math.abs(zoom[0] - 4) < .2 && Math.abs(zoom[1] - 8) < .2);
        await page.locator('#compare-range-all').click(); await pauseFrame();
        await page.locator('#compare-select-range').click(); await page.locator('#compare-select-range').click();
        assert.equal(await state(() => window.__csvViewerDebug.state.brushMode), false);
        await page.locator('#compare-select-range').click(); await brush(5, 9);
        assert.equal(await page.locator('#compare-selection').isVisible(), true);
        await page.locator('#compare-calculate').click(); await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 6);
        await page.locator('[data-range-action="close"]').click(); await pauseFrame();
        assert.equal(await page.locator('.compare-result').count(), 0, 'clearing selected interval invalidates its results');

        await page.locator('[data-pane="notes"]').click();
        await state(() => {
            document.getElementById('compare-note-add').click();
            return Promise.resolve().then(() => window.__csvViewerDebug.state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: 2, endValue: 10 }));
        });
        await page.waitForTimeout(150);
        assert.equal(await state(() => window.__csvViewerDebug.state.comparison.notes.length), 0, 'changed conditions must not create a mixed snapshot');
        assert.equal(await page.locator('#compare-note-text').inputValue(), '応答差の調査中。ﾃｽﾄ');
        await state(() => { document.getElementById('compare-note-add').click(); document.getElementById('compare-note-add').click(); });
        await page.waitForFunction(() => window.__csvViewerDebug.state.comparison.notes.length === 1);
        assert.equal(await page.locator('#compare-note-text').inputValue(), '');
        await page.waitForTimeout(100);
        assert.equal(await state(() => window.__csvViewerDebug.state.comparison.notes.length), 1, 'repeated activation must not save duplicate notes');

        await page.locator('#column-search').fill('Pressure');
        const selectionBefore = await state(() => [...window.__csvViewerDebug.state.selectedNames]);
        await page.locator('#column-search').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
        assert.deepEqual(await state(() => [...window.__csvViewerDebug.state.selectedNames]), selectionBefore, 'IME commit must not toggle a channel');
        assert.equal(await state(() => document.activeElement.id), 'column-search');
        assert.deepEqual(errors, []);
        console.log('Comparison UX state regressions passed:', output);
    } catch (error) {
        await page.screenshot({ path: path.join(output, 'failure.png') });
        console.error('Artifacts:', output); console.error('Errors:', errors); throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
