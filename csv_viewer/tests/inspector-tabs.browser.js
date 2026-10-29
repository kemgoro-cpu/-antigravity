'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const screenshots = path.resolve(__dirname, 'fixtures/generated/inspector-tabs');
const file = (name, shift, base) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('Time,Signal\ns,V\n' + [0, 1, 2, 3].map(i => `${i + shift},${base + i * 2}`).join('\n')) });

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const errors = [], requests = [];
    const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    async function open(settings) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        if (settings) await context.addInitScript(value => localStorage.setItem('csvViewer_settings', JSON.stringify(value)), settings);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
        await page.goto(url); await page.waitForFunction(() => !!window.__csvViewerDebug); await settle(page);
        return { context, page };
    }
    const activeTab = page => page.locator('[data-inspector-tab][aria-selected="true"]').getAttribute('data-inspector-tab');
    const rows = page => page.locator('#inspector-statistics tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].slice(1).map(cell => Number(cell.textContent))));
    try {
        fs.mkdirSync(screenshots, { recursive: true });
        const current = await open(), page = current.page;
        assert.equal(await page.locator('#inspector-open').count(), 1);
        assert.equal(await page.locator('#inspector-open-data,#inspector-open-quality,#stats-panel-btn,#stats-panel').count(), 0);
        await page.locator('#file-input').setInputFiles([file('ref.csv', 0, 0), file('sub.csv', 1, 10)]);
        await page.waitForFunction(() => Object.keys(__csvViewerDebug.state.files).length === 2 && !__csvViewerDebug.state.parseJobs.size);
        await page.locator('[data-channel="Signal"] .col-item-top').click();
        await page.locator('.offset-input').fill('-1'); await page.locator('.offset-input').press('Tab');
        await page.locator('#analysis-scope').selectOption('all');
        await page.locator('#inspector-open').click();
        await page.locator('#inspector-tab-stats').click(); await page.locator('#inspector-statistics tbody tr').first().waitFor();
        await settle(page);
        const allRows = await rows(page);
        assert.equal(allRows.length, 2, 'statistics include Main and Sub');
        assert.deepEqual(allRows.map(row => [row[0], row[1], row[2], row[4]]), [[0, 6, 3, 4], [10, 16, 13, 4]]);
        assert.ok(allRows.every(row => Math.abs(row[3] - Math.sqrt(5)) < .001));
        assert.equal(await page.locator('.inspector-file-label').isVisible(), false, 'statistics do not imply a one-file filter');

        // Selecting a file for raw samples must not change the all-file statistics.
        await page.locator('#inspector-tab-data').click();
        const sub = await page.evaluate(() => Object.keys(__csvViewerDebug.state.files).find(id => __csvViewerDebug.state.files[id].role === 'sub'));
        await page.locator('#inspector-file').selectOption(sub); await settle(page);
        await page.locator('#inspector-tab-stats').click(); await settle(page);
        assert.deepEqual(await rows(page), allRows);
        assert.equal(await page.evaluate(() => __csvViewerDebug.dataInspector.seekTime(1)), false, 'wave clicks do not replace a statistics view with raw samples');
        assert.equal(await activeTab(page), 'stats');

        await page.evaluate(() => __csvViewerDebug.selectAnalysisRange([1, 2])); await settle(page);
        assert.deepEqual((await rows(page)).map(row => [row[2], row[4]]), [[3, 2], [13, 2]]);
        await page.locator('#compare-raw').check(); await settle(page);
        assert.deepEqual((await rows(page)).map(row => [row[2], row[4]]), [[3, 2], [11, 2]]);
        await page.locator('#compare-raw').uncheck();
        await page.locator('[data-view="diff"]').click(); await settle(page);
        assert.deepEqual((await rows(page)).map(row => [row[0], row[1], row[2], row[4]]), [[-10, -10, -10, 2]]);
        await page.locator('[data-view="overlay"]').click();

        // Three tabs follow keyboard tablist conventions, close returns focus.
        await page.locator('#inspector-tab-stats').focus(); await page.keyboard.press('Home');
        assert.equal(await activeTab(page), 'data');
        await page.keyboard.press('ArrowRight'); assert.equal(await activeTab(page), 'quality');
        await page.keyboard.press('End'); assert.equal(await activeTab(page), 'stats');
        await page.keyboard.press('ArrowRight'); assert.equal(await activeTab(page), 'data');
        await page.keyboard.press('ArrowLeft'); assert.equal(await activeTab(page), 'stats');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#data-inspector').isVisible(), false);
        assert.equal(await page.locator('#inspector-open').evaluate(el => el === document.activeElement), true);
        await page.locator('#inspector-open').click(); assert.equal(await activeTab(page), 'stats');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('csvViewer_settings') || '{}').statsPanel === true);
        await page.reload(); await page.waitForFunction(() => Object.keys(__csvViewerDebug.state.files).length === 2 && !__csvViewerDebug.state.parseJobs.size);
        await page.locator('#inspector-statistics tbody tr').first().waitFor();
        assert.equal(await activeTab(page), 'stats');

        // The two-point measurement remains a separate capability.
        await page.locator('#measure-mode-btn').click();
        const pixels = await page.evaluate(() => {
            const d = __csvViewerDebug, chart = document.querySelector('#chart').getBoundingClientRect(), grid = d.state.gridRegions[0];
            return [.5, 2.5].map(t => ({ x: chart.left + d.state.chart.convertToPixel({ xAxisIndex: 0 }, t), y: chart.top + grid.top + grid.height / 2 }));
        });
        for (const pixel of pixels) await page.mouse.click(pixel.x, pixel.y);
        await page.locator('#measure-panel table').waitFor();
        assert.equal(await page.locator('#inspector-statistics').isVisible(), true);
        assert.equal(await page.locator('#stats-panel').count(), 0);
        await page.screenshot({ path: path.join(screenshots, 'statistics-and-measure-1600.png') });
        await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'statistics fit within the 390px page');
        await page.locator('#data-inspector').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(screenshots, 'statistics-390.png') });
        await current.context.close();

        // Old settings may contain both former panels. Statistics win, while raw-file identity survives.
        for (const inspection of [undefined, { open: true, tab: 'quality', fileName: 'same.csv', fileKey: 'saved-file-id' }]) {
            const legacy = await open({ _version: 7, statsPanel: true, inspection });
            const state = await legacy.page.evaluate(() => __csvViewerDebug.dataInspector.collectSettings());
            assert.equal(state.open, true); assert.equal(state.tab, 'stats');
            if (inspection) { assert.equal(state.fileName, inspection.fileName); assert.equal(state.fileKey, inspection.fileKey); }
            assert.equal(await legacy.page.locator('#stats-panel').count(), 0);
            await legacy.context.close();
        }
        const closed = await open({ _version: 7, statsPanel: false, inspection: { open: false, tab: 'stats' } });
        assert.equal(await closed.page.locator('#data-inspector').isVisible(), false);
        await closed.page.locator('#inspector-open').click(); assert.equal(await activeTab(closed.page), 'stats');
        await closed.context.close();
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        console.log('Inspector tabs browser passed: one entry, all-file statistics, raw/aligned/diff scope, keyboard/focus, restore/migration, separate measure panel, 390px and offline');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
