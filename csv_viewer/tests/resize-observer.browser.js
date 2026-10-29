/* Browser-generated ResizeObserver ErrorEvents do not reach Playwright's pageerror. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function openInspector(page, tab) {
    if (!await page.locator('#data-inspector').isVisible()) await page.locator('#inspector-open').click();
    await page.locator('#inspector-tab-' + tab).click();
    if (tab === 'stats') await page.locator('#inspector-statistics').waitFor();
}

(async () => {
    // Real scrollbars are essential: removing one changes the observed content width.
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1366, height: 700 }, deviceScaleFactor: 1.25 });
    await context.addInitScript(() => {
        window.__resizeTest = { errors: [] };
        window.addEventListener('error', event => {
            window.__resizeTest.errors.push({ message: event.message, trusted: event.isTrusted });
        });
    });
    const page = await context.newPage(), pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.stack));
    const out = path.resolve(__dirname, 'fixtures/generated/resize-observer-2026-10-29');
    fs.mkdirSync(out, { recursive: true });
    const settle = () => page.evaluate(() => new Promise(resolve => {
        let frames = 6;
        function next() { if (--frames) requestAnimationFrame(next); else resolve(); }
        requestAnimationFrame(next);
    }));
    const restored = () => page.waitForFunction(() => {
        const state = window.__csvViewerDebug?.state;
        return state && Object.keys(state.files).length === 2 && state.parseJobs.size === 0 && state.numGrids === 3;
    });
    const sample = name => ({ name, mimeType: 'text/csv', buffer: Buffer.from('Time,Speed,Pressure,Voltage\ns,km/h,kPa,V\n0,0,10,1\n1,10,12,2\n2,20,14,3\n3,10,13,2\n4,0,10,1\n') });
    let evidence = {};
    try {
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.locator('#file-input').setInputFiles([sample('reference.csv'), sample('comparison.csv')]);
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 2 && window.__csvViewerDebug.state.parseJobs.size === 0);
        for (const name of ['Speed', 'Pressure', 'Voltage']) await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        await restored(); await settle();

        // The restored sidebar wraps the toolbar, leaving an old, oversized canvas.
        // Resizing that canvas removes its scrollbar and changes the observed width.
        await openInspector(page, 'stats');
        await page.locator('#sidebar-resize-handle').focus();
        await page.keyboard.press('End');
        await settle();
        await page.waitForTimeout(900); // Allow the real session persistence debounce to finish.
        await page.reload(); await restored(); await settle();
        evidence = await page.evaluate(() => ({ ...window.__resizeTest, range: window.__csvViewerDebug.getVisibleXRange() }));
        fs.writeFileSync(path.join(out, 'regression.json'), JSON.stringify(evidence, null, 2));
        assert.deepEqual(evidence.errors, [], 'restoring a wide sidebar must not emit native window errors');
        assert.deepEqual(evidence.range, [0, 4]);

        // Preserve the user's reported reload path, including saved manual heights.
        await page.locator('#sidebar-resize-handle').focus();
        await page.keyboard.press('Home'); await settle();
        await page.locator('#view-menu-btn').click();
        await page.locator('#row-plus-btn').click();
        await page.locator('#font-scale').selectOption('xlarge');
        await page.keyboard.press('Escape');
        await settle();
        for (const [width, height] of [[1365, 768], [1100, 800], [390, 844]]) {
            await page.setViewportSize({ width, height });
            await page.reload(); await restored(); await settle();
            assert.equal(await page.evaluate(() => window.__csvViewerDebug.state.rowHeightPx > 0), true);
            assert.equal(await page.locator('#compare-overview-plot').isVisible(), true);
            await page.locator('#compare-panel-toggle').click(); await settle();
            await page.locator('#compare-panel-toggle').click(); await settle();
            const errors = await page.evaluate(() => window.__resizeTest.errors);
            assert.deepEqual(errors, [], `${width}px reload and comparison panel layout must not emit window errors`);
            const geometry = await page.evaluate(() => {
                const chart = window.__csvViewerDebug.state.chart;
                const element = document.getElementById('chart');
                return { rendered: [chart.getWidth(), chart.getHeight()], available: [element.clientWidth, element.clientHeight] };
            });
            assert.deepEqual(geometry.rendered, geometry.available, `${width}px chart catches up with layout`);
        }
        assert.deepEqual(pageErrors, []);
        await page.screenshot({ path: path.join(out, 'verified.png') });
        console.log('ResizeObserver reflow, restored reload, and responsive panel regressions passed.');
    } catch (error) {
        await page.screenshot({ path: path.join(out, 'regression-failure.png') });
        console.error({ evidence, pageErrors });
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
