'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

// Different sizes deliberately finish parsing out of order on session restore.
// Constant values make an accidental s1/s2 swap numerically unambiguous.
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-restore-ﾃｽﾄ-'));
    const files = [1001, 300001, 1001].map((count, index) => {
        const file = path.join(directory, `Size${index}.csv`);
        const rows = ['Time,Pressure', 's,kPa'];
        for (let i = 0; i < count; i++) rows.push(`${i / 10},${1 + index * 10}`);
        fs.writeFileSync(file, rows.join('\n'));
        return file;
    });
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(45000);
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        for (let index = 0; index < files.length; index++) {
            await page.locator('#file-input').setInputFiles(files[index]);
            await page.waitForFunction(count => Object.keys(window.__csvViewerDebug.state.files).length === count
                && window.__csvViewerDebug.state.parseJobs.size === 0, index + 1);
        }
        await page.locator('.compare-advanced > summary').click();
        const section = page.locator('[data-section="customRam"]');
        if (await section.evaluate(el => el.classList.contains('collapsed'))) await section.locator('h3').click();
        for (const [name, expr] of [['@DeltaFirst', 'Pressure - s1:Pressure'], ['@DeltaSecond', 'Pressure - s2:Pressure']]) {
            await page.locator('#custom-ram-name').fill(name);
            await page.locator('#custom-ram-expr').fill(expr);
            await page.locator('#custom-ram-expr').press('Escape');
            await page.locator('#custom-ram-expr').press('Tab');
            await page.locator('#custom-ram-add').click();
            await page.waitForFunction(name => window.__csvViewerDebug.state.customRAMs.some(r => r.name === name), name);
        }
        const check = async label => {
            await page.waitForFunction(() => {
                const state = window.__csvViewerDebug.state;
                const main = Object.values(state.files).find(f => f.role === 'main');
                return Object.keys(state.files).length === 3 && state.parseJobs.size === 0
                    && ['@DeltaFirst', '@DeltaSecond'].every(name => {
                        const col = main?.columns.find(c => c.name === name);
                        return col && main.colData[col.id]?.length === 1001;
                    });
            }).catch(async error => {
                console.error(label, await page.evaluate(() => {
                    const s = window.__csvViewerDebug.state;
                    return {ram:s.customRAMs,files:Object.values(s.files).map(f=>({name:f.name,role:f.role,cols:f.columns.filter(c=>c.isCustom).map(c=>({name:c.name,n:f.colData[c.id]?.length}))}))};
                }));
                throw error;
            });
            const actual = await page.evaluate(() => {
                const state = window.__csvViewerDebug.state, files = Object.values(state.files);
                const main = files.find(f => f.role === 'main');
                return {
                    names: files.map(f => f.name),
                    main: main.name,
                    values: ['@DeltaFirst', '@DeltaSecond'].map(name => {
                        const values = main.colData[main.columns.find(c => c.name === name).id];
                        return [values[0], values[500], values[1000]];
                    }),
                };
            });
            assert.deepEqual(actual, { names: ['Size0.csv', 'Size1.csv', 'Size2.csv'], main: 'Size0.csv',
                values: [[-10, -10, -10], [-20, -20, -20]] }, label);
            console.log(`${label}: s1=Size1, s2=Size2; differences -10 / -20 preserved`);
        };
        await check('Before reload');
        // Wait for actual IndexedDB persistence, then force timestamp ties. Legacy
        // sessions omit order; both versions must restore the saved reference order.
        const prepareStore = async legacy => {
            await page.waitForFunction(async () => new Promise((resolve, reject) => {
                const request = indexedDB.open('csvViewerSession', 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result, tx = db.transaction('files', 'readonly');
                    const readRequest = tx.objectStore('files').getAll();
                    tx.oncomplete = () => { db.close(); resolve(readRequest.result.length === 3); };
                };
            }));
            await page.evaluate(legacy => new Promise((resolve, reject) => {
                const request = indexedDB.open('csvViewerSession', 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result, tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
                    const readRequest = store.getAll();
                    readRequest.onsuccess = () => {
                        for (const record of readRequest.result) {
                            record.addedAt = 1;
                            if (legacy) delete record.order;
                            store.put(record);
                        }
                    };
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => { db.close(); reject(tx.error); };
                };
            }), legacy);
        };
        for (let run = 1; run <= 2; run++) {
            await prepareStore(false);
            await page.reload();
            await check(`Reload ${run} with tied timestamps`);
        }
        await prepareStore(true);
        await page.reload();
        await check('Legacy session migration with tied timestamps');
        assert.deepEqual(errors, []);
        await context.close();
    } finally {
        await browser.close();
        files.forEach(file => fs.unlinkSync(file));
        fs.rmdirSync(directory);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
