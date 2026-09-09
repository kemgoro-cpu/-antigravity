'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        for (const count of [3, 4]) {
            const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
            const page = await context.newPage(), errors = [];
            page.setDefaultTimeout(10000);
            page.on('pageerror', e => errors.push(e.message));
            const shifts = [0, 2, -3, 5];
            await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
            // Sequential loading makes file identities deterministic, independently of parse speed.
            for (let n = 0; n < count; n++) {
                const rows = ['Time,Pressure', 's,kPa'];
                for (let i = 0; i <= 200; i++) rows.push(`${i / 10 + shifts[n]},${Math.sin(i / 20) + n * 10}`);
                await page.locator('#file-input').setInputFiles({ name: `Log${n}.csv`, mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
                await page.waitForFunction(n => Object.keys(window.__csvViewerDebug.state.files).length === n, n + 1);
            }
            await page.locator('#column-search').fill('Pressure');
            await page.locator('[data-channel="Pressure"] .col-item-top').click();
            await page.locator('#column-search').fill('');
            const ids = await page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files));
            for (let n = 1; n < count; n++) {
                await page.locator(`[data-offset-id="${ids[n]}"]`).fill(String(-shifts[n]));
                await page.locator(`[data-offset-id="${ids[n]}"]`).press('Tab');
            }
            const check = async main => {
                console.log(`Checking ${count} files, Main Log${main}`);
                await page.waitForFunction(({count, main}) => {
                    const s = window.__csvViewerDebug.state;
                    return Object.values(s.files).find(f => f.role === 'main')?.name === `Log${main}.csv` && s.chart.getOption().series.filter(s => s.type === 'line').length === count;
                }, {count, main});
                const files = await page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(f => ({name:f.name,role:f.role,offset:f.offset})));
                files.forEach(f => { const n = Number(f.name[3]); assert.equal(f.offset, shifts[main] - shifts[n], `offset ${f.name} main=${main}`); });
                await page.locator('[data-view="diff"]').click();
                await page.waitForFunction(count => window.__csvViewerDebug.state.chart.getOption().series.filter(s => s.id.startsWith('compare-diff')).length === count - 1, count);
                const values = await page.evaluate(() => window.__csvViewerDebug.state.chart.getOption().series.filter(s => s.id.startsWith('compare-diff')).map(s => s.data.filter(p => p[1] != null).map(p => p[1])));
                const expected = Array.from({length:count}, (_,n) => (main-n)*10).filter((_,n) => n !== main).sort((a,b)=>a-b);
                assert.deepEqual(values.map(v => Math.round(v[0])).sort((a,b)=>a-b), expected);
                values.forEach(v => { assert.ok(v.length >= 190); assert.ok(v.every(x => Math.abs(x-v[0]) < 1e-6)); });
                await page.locator('[data-view="stack"]').click();
                await page.waitForFunction(count => window.__csvViewerDebug.state.chart.getOption().grid.length === count, count);
                await page.locator('[data-pane="results"]').click();
                await page.locator('#compare-calculate').click();
                await page.waitForFunction(count => document.querySelectorAll('.compare-result').length === count-1, count);
                await page.locator('[data-view="overlay"]').click();
            };
            await check(0);
            for (let main = 1; main < count; main++) {
                await page.locator(`[data-roleid="${ids[main]}"]`).click();
                await check(main);
            }
            await page.reload();
            console.log('Checking restored session');
            await page.waitForFunction(count => Object.keys(window.__csvViewerDebug.state.files).length === count && window.__csvViewerDebug.state.parseJobs.size === 0, count);
            await check(count-1);
            assert.deepEqual(errors, []);
            console.log(`${count} files: legacy Main/Sub switching, offsets, overlay/stack/difference, results and reload passed`);
            await context.close();
        }
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
