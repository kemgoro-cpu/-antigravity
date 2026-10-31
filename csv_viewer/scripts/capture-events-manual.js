/* Capture the event controls from the real app, using existing synthetic logs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const images = path.join(root, 'docs/images');
const sample = path.join(root, 'docs/samples/基準_ﾛｸﾞ.csv');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async () => {
    const originalHash = hash(sample);
    const browser = await chromium.launch({ headless: true, channel: 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    const errors = [], requests = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } });
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug && !!document.querySelector('.compare-advanced'));
        if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.locator('#theme-toggle-btn').click();
        await page.locator('#file-input').setInputFiles(sample);
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 1 && window.__csvViewerDebug.state.parseJobs.size === 0);
        await page.locator('[data-channel="Pressure"] .col-item-top').click();
        await page.locator('.compare-advanced > summary').click();
        for (const name of ['parse', 'customRam']) {
            const group = page.locator(`[data-section="${name}"]`);
            if (!(await group.getAttribute('class')).includes('collapsed')) await group.locator('h3').click();
        }
        const panel = page.locator('[data-section="events"]');
        if ((await panel.getAttribute('class')).includes('collapsed')) await panel.locator('h3').click();
        await page.locator('#event-expr').fill('Pressure > 120');
        await page.locator('#event-min-duration').fill('2');
        await page.locator('#event-release-expr').fill('Pressure <= 118');
        await page.locator('#event-detect-btn').click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.events.evaluated === true);
        await page.mouse.move(900, 25);
        await panel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
        await panel.screenshot({ path: path.join(images, 'events-panel.png') });
        const result = await page.evaluate(() => window.__csvViewerDebug.state.events);
        assert.ok(result.intervals.length > 0);
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        assert.equal(hash(sample), originalHash);
        fs.writeFileSync(path.join(images, 'events-capture-manifest.json'), JSON.stringify({
            revision: '2026-10-31', generatedAt: new Date().toISOString(),
            source: 'Real app screenshot in isolated Edge; unchanged bundled synthetic log; no image editing.',
            sampleHash: originalHash, sourceHashes: Object.fromEntries(['index.html', 'app.js', 'styles.css', 'event-utils.js', 'settings-utils.js', 'compare-workspace.js'].map(file => [file, hash(path.join(root, file))])),
            screenshot: 'events-panel.png', result, errors, requests,
        }, null, 2) + '\n');
        console.log(JSON.stringify({ events: result.totalCount, screenshot: 'events-panel.png', samplesUnchanged: true, offline: true }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
