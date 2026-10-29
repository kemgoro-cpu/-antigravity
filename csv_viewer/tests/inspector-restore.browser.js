'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const name = '同名_ﾛｸﾞ.csv';
const input = (value, count) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('Time,Signal\ns,V\n' + Array.from({ length: count }, (_, i) => `${i / 1000},${value}`).join('\n')) });
async function openInspector(page, tab) {
    if (!await page.locator('#data-inspector').isVisible()) await page.locator('#inspector-open').click();
    await page.locator('#inspector-tab-' + tab).click();
    if (tab === 'stats') await page.locator('#inspector-statistics').waitFor();
}

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        // Hold the second file's first parse after reload. This makes partial
        // restore deterministic without relying on file-size timing races.
        await context.addInitScript(() => {
            let papa;
            window.__heldInspectorParses = [];
            Object.defineProperty(window, 'Papa', { configurable: true, get: () => papa, set: value => {
                papa = value;
                const original = papa.parse;
                papa.parse = function (source, ...args) {
                    if (localStorage.getItem('inspector-test-hold') === '1' && source instanceof Blob && source.size > 1000) {
                        window.__heldInspectorParses.push(() => original.call(papa, source, ...args));
                        return;
                    }
                    return original.call(papa, source, ...args);
                };
            } });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.setDefaultTimeout(20000);
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.locator('#file-input').setInputFiles([input(1, 3), input(100, 5001)]);
        await page.waitForFunction(() => Object.keys(__csvViewerDebug.state.files).length === 2 && !__csvViewerDebug.state.parseJobs.size
            && [...document.querySelectorAll('.file-session-badge')].every(e => e.dataset.status === 'saved'));
        await page.locator('#column-search').fill('Signal');
        await page.locator('[data-channel="Signal"] .col-item-top').click();
        await page.locator('#analysis-scope').selectOption('all');
        await openInspector(page, 'data');
        const second = await page.evaluate(() => Object.keys(__csvViewerDebug.state.files).find(id => __csvViewerDebug.state.files[id].timeData.length === 5001));
        await page.locator('#inspector-file').selectOption(second);
        const waitValue = async value => page.waitForFunction(value => document.querySelector('#inspector-sample-table tbody tr td:nth-child(4)')?.textContent === String(value)
            && document.querySelector('#inspector-content').getAttribute('aria-busy') !== 'true', value);
        await waitValue(100);
        const saved = await page.evaluate(() => __csvViewerDebug.dataInspector.collectSettings());
        assert.ok(saved.fileKey); assert.equal(saved.fileName, name);
        await page.waitForFunction(key => JSON.parse(localStorage.getItem('csvViewer_settings') || '{}').inspection?.fileKey === key, saved.fileKey);

        // Ambiguous legacy name-only settings stay unselected as well.
        await page.evaluate(name => __csvViewerDebug.dataInspector.applySettings({ open: true, tab: 'data', fileName: name }), name);
        await page.waitForFunction(() => document.querySelector('#inspector-file').value === '' && document.querySelector('#inspector-status').textContent.includes('選び直'));
        assert.equal(await page.locator('#inspector-sample-table').count(), 0);
        await page.evaluate(saved => __csvViewerDebug.dataInspector.applySettings(saved), saved); await waitValue(100);

        await page.evaluate(() => localStorage.setItem('inspector-test-hold', '1'));
        await page.reload();
        await page.waitForFunction(() => window.__heldInspectorParses?.length > 0 && Object.keys(__csvViewerDebug.state.files).length === 1);
        await page.waitForFunction(() => document.querySelector('#inspector-file').value === '' && document.querySelector('#inspector-status').textContent.includes('復元を待'));
        assert.equal(await page.locator('#inspector-sample-table').count(), 0, 'first same-named file must never be substituted');
        assert.equal(await page.evaluate(() => __csvViewerDebug.dataInspector.collectSettings().fileKey), saved.fileKey);
        await page.evaluate(() => { localStorage.removeItem('inspector-test-hold'); for (const release of window.__heldInspectorParses.splice(0)) release(); });
        await waitValue(100);
        assert.equal(await page.evaluate(() => __csvViewerDebug.dataInspector.collectSettings().fileKey), saved.fileKey);
        assert.equal(await page.evaluate(() => __csvViewerDebug.state.files[document.querySelector('#inspector-file').value].timeData.length), 5001);

        // Remove only the saved record externally to model unavailable restore
        // content, while retaining the requested inspector key in settings.
        await page.waitForFunction(() => [...document.querySelectorAll('.file-session-badge')].every(e => e.dataset.status === 'saved'));
        await page.evaluate(key => new Promise((resolve, reject) => {
            const request = indexedDB.open('csvViewerSession', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result, tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(key);
                tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
            };
        }), saved.fileKey);
        await page.reload();
        await page.waitForFunction(() => Object.keys(__csvViewerDebug.state.files).length === 1 && !__csvViewerDebug.state.parseJobs.size
            && document.querySelector('#inspector-status').textContent.includes('選び直'));
        assert.equal(await page.locator('#inspector-file').inputValue(), '');
        assert.equal(await page.locator('#inspector-sample-table').count(), 0);
        assert.equal(await page.evaluate(() => __csvViewerDebug.dataInspector.collectSettings().fileKey), saved.fileKey, 'missing key must not be overwritten');
        const first = await page.evaluate(() => Object.keys(__csvViewerDebug.state.files)[0]);
        await page.locator('#inspector-file').selectOption(first); await waitValue(1);
        const firstKey = await page.evaluate(() => __csvViewerDebug.dataInspector.collectSettings().fileKey);
        assert.ok(firstKey); assert.notEqual(firstKey, saved.fileKey);
        await page.waitForFunction(key => JSON.parse(localStorage.getItem('csvViewer_settings') || '{}').inspection?.fileKey === key, firstKey);

        // Unique legacy names remain compatible when no stable key was stored.
        // The existing value-1 table can remain until the scheduled refresh, so
        // wait for the resolved identity as well, not merely unchanged cells.
        await page.evaluate(name => {
            const legacy = { open: true, tab: 'data', fileName: name };
            const settings = JSON.parse(localStorage.getItem('csvViewer_settings'));
            settings.inspection = legacy; localStorage.setItem('csvViewer_settings', JSON.stringify(settings));
            __csvViewerDebug.dataInspector.applySettings(legacy);
        }, name);
        await page.waitForFunction(key => __csvViewerDebug.dataInspector.collectSettings().fileKey === key
            && document.querySelector('#inspector-file').value !== '', firstKey);
        await waitValue(1);
        await page.waitForFunction(key => JSON.parse(localStorage.getItem('csvViewer_settings') || '{}').inspection?.fileKey === key, firstKey);
        assert.equal(await page.evaluate(() => __csvViewerDebug.dataInspector.collectSettings().fileKey), firstKey);
        assert.deepEqual(errors, []);
        console.log('inspector restore passed: identical filenames, held second restore, stable key, missing-key no fallback, explicit reselection, legacy unique/ambiguous names');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
