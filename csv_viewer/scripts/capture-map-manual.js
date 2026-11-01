/* Real application screenshots with clearly synthetic, read-only tutorial files. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const images = path.join(root, 'docs/images');
const samples = ['練習用_エンジン.csv', '練習用_燃費率ﾏｯﾌﾟ.csv'].map(name => path.join(root, 'docs/samples', name));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async () => {
    const sampleHashes = samples.map(hash), errors = [], requests = [];
    const browser = await chromium.launch({ headless: true, channel: 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug?.xyWorkspace);
        if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.locator('#theme-toggle-btn').click();
        await page.locator('#file-input').setInputFiles(samples[0]);
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 1 && window.__csvViewerDebug.state.parseJobs.size === 0);
        for (const name of ['Engine_Speed', 'Engine_Torque']) await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        await page.evaluate(() => window.__csvViewerDebug.selectAnalysisRange([10, 30]));
        await page.locator('#xy-panel-toggle').click();
        await page.locator('#xy-mode').selectOption('map');
        if (!await page.locator('#xy-map-settings').evaluate(el => el.open)) await page.locator('#xy-map-settings > summary').click();
        await page.locator('#xy-map-source').selectOption('external');
        await page.locator('#xy-map-file').setInputFiles(samples[1]);
        await page.waitForFunction(() => !window.__csvViewerDebug.xyWorkspace.inspect().pendingImport);
        await page.locator('#xy-map-confirm-units').check();
        await page.locator('#xy-map-apply').click();
        await page.waitForFunction(() => !!window.__csvViewerDebug.xyWorkspace.inspect().lastResult?.background);
        if (!await page.locator('#xy-map-settings').evaluate(el => el.open)) await page.locator('#xy-map-settings > summary').click();
        await page.locator('#xy-map-style').selectOption('both');
        await page.locator('#xy-map-settings > summary').click();
        await page.waitForFunction(() => window.__csvViewerDebug.xyWorkspace.inspect().chart?.getOption().series.some(series => series.id.startsWith('xy-contour-')));
        const cursor = await page.evaluate(() => {
            const s = window.__csvViewerDebug.state, box = document.querySelector('#chart').getBoundingClientRect();
            return { x: box.x + s.chart.convertToPixel({ xAxisIndex: 0 }, 20), y: box.y + s.gridRegions[0].top + 60 };
        });
        await page.mouse.move(cursor.x, cursor.y);
        await page.waitForFunction(() => window.__csvViewerDebug.xyWorkspace.inspect().cursorUpdateCount > 0);
        await page.locator('.xy-workspace-scroll').evaluate(el => { el.scrollTop = 0; });
        await page.waitForTimeout(450);
        await page.screenshot({ path: path.join(images, 'fuel-map.png') });
        const evidence = await page.evaluate(() => {
            const view = window.__csvViewerDebug.xyWorkspace.inspect(), map = view.lastResult.background;
            return { context: view.lastResult.context, map: { xs: map.xs, ys: map.ys, stats: map.stats }, cursorUpdates: view.cursorUpdateCount, renderCount: view.renderCount,
                pointCounts: view.chart.getOption().series.filter(series => series.id.startsWith('xy-points-')).map(series => series.data.length) };
        });
        assert.deepEqual(evidence.context.range, [10, 30]); assert.deepEqual(evidence.pointCounts, [41]);
        assert.equal(evidence.map.stats.emptyCells, 1);
        assert.deepEqual(errors, []); assert.deepEqual(requests, []); assert.deepEqual(samples.map(hash), sampleHashes);
        fs.writeFileSync(path.join(images, 'map-capture-manifest.json'), JSON.stringify({ revision: '2026-11-01', generatedAt: new Date().toISOString(),
            source: 'Real screenshots in isolated Edge, unchanged synthetic tutorial data; no image editing.',
            sampleHashes, sourceHashes: Object.fromEntries(['index.html', 'app.js', 'compare-workspace.js', 'workspace-ui.js', 'xy-workspace.js', 'xy-workspace.css', 'fuel-map-utils.js', 'xy-utils.js'].map(name => [name, hash(path.join(root, name))])),
            screenshot: 'fuel-map.png', evidence, errors, requests }, null, 2) + '\n');
        console.log(JSON.stringify({ screenshot: 'fuel-map.png', evidence, offline: true }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
