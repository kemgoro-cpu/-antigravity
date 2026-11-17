/* Settings JSON round trip from a clean browser profile, including the next reload. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-viewer-settings-'));
    const errors = [];
    const open = async context => {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        return page;
    };
    const session = async page => {
        await page.locator('#export-menu-btn').click();
        await page.locator('#save-purpose').selectOption('session');
    };
    const values = page => page.evaluate(() => ({
        nameMode: document.getElementById('import-name-mode').value,
        nameRow: document.getElementById('name-row-idx').value,
        sampling: document.getElementById('sampling-mode').value,
        font: document.getElementById('font-scale').value,
        width: document.getElementById('line-width-range').value,
        widthLabel: document.getElementById('line-width-value').textContent,
        markers: document.getElementById('show-markers-chk').checked,
        theme: document.documentElement.dataset.theme || 'dark',
    }));
    const expected = { nameMode: 'manual', nameRow: '3', sampling: '', font: 'xlarge',
        width: '2.5', widthLabel: '2.5', markers: true, theme: 'light' };
    try {
        const sourceContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
        const source = await open(sourceContext);
        await source.locator('details.compare-advanced > summary').click();
        if (await source.locator('[data-section="parse"]').evaluate(element => element.classList.contains('collapsed')))
            await source.locator('[data-section="parse"] h3').click();
        await source.locator('#import-name-mode').selectOption('manual');
        await source.locator('#name-row-idx').fill('3');
        await source.locator('#name-row-idx').dispatchEvent('change');
        await source.locator('#view-menu-btn').click();
        await source.locator('#sampling-mode').selectOption('');
        await source.locator('#font-scale').selectOption('xlarge');
        await source.locator('#line-width-range').evaluate(input => {
            input.value = '2.5'; input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await source.locator('#show-markers-chk').check();
        await source.locator('#theme-toggle-btn').click();
        assert.deepEqual(await values(source), expected, 'source UI values');
        await session(source);
        const downloadEvent = source.waitForEvent('download');
        await source.locator('#export-settings-btn').click();
        const download = await downloadEvent;
        const settingsPath = path.join(tempDir, download.suggestedFilename());
        await download.saveAs(settingsPath);
        const exported = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(exported._format, 'CSV Viewer Settings');
        assert.equal(exported.importSettings.nameMode, 'manual');
        assert.equal(exported.nameRowIdx, '3');
        assert.equal(exported.samplingMode, '');
        assert.equal(exported.fontScale, 'xlarge');
        assert.equal(exported.lineWidth, 2.5);
        assert.equal(exported.showMarkers, true);
        assert.equal(exported.theme, 'light');

        const cleanContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
        const fresh = await open(cleanContext);
        assert.equal(await fresh.evaluate(() => localStorage.getItem('csvViewer_settings')), null,
            'new profile starts without saved settings');
        assert.notDeepEqual(await values(fresh), expected, 'fresh UI starts with defaults');
        await session(fresh);
        const chooserEvent = fresh.waitForEvent('filechooser');
        await fresh.locator('#import-settings-btn').click();
        await (await chooserEvent).setFiles(settingsPath);
        await fresh.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        assert.deepEqual(await values(fresh), expected, 'settings restored immediately from JSON');
        await fresh.waitForFunction(() => {
            const raw = localStorage.getItem('csvViewer_settings');
            return raw && JSON.parse(raw).theme === 'light';
        });
        await fresh.reload();
        await fresh.waitForFunction(() => !!window.__csvViewerDebug);
        assert.deepEqual(await values(fresh), expected, 'imported settings survive reload');
        assert.deepEqual(errors, [], 'no uncaught browser errors');
        console.log('Settings round trip passed: export JSON, clean import, immediate UI and reload.');
    } finally {
        await browser.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
