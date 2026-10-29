'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const sample = name => ({ name, mimeType: 'text/csv', buffer: Buffer.from('Time,Pressure\ns,kPa\n0,10\n1,20\n2,30\n') });

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        await context.addInitScript(() => {
            const put = IDBObjectStore.prototype.put, del = IDBObjectStore.prototype.delete;
            IDBObjectStore.prototype.put = function (...args) {
                if (this.name === 'files' && window.__failSessionWrites) throw new DOMException('test quota failure', 'QuotaExceededError');
                return put.apply(this, args);
            };
            IDBObjectStore.prototype.delete = function (...args) {
                if (this.name === 'files' && window.__failSessionDeletes) throw new DOMException('test denied deletion', 'UnknownError');
                return del.apply(this, args);
            };
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.setDefaultTimeout(20000);
        const store = async (action, value) => page.evaluate(({ action, value }) => new Promise((resolve, reject) => {
            const request = indexedDB.open('csvViewerSession', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result, tx = db.transaction('files', action === 'read' ? 'readonly' : 'readwrite'), s = tx.objectStore('files');
                const result = action === 'read' ? s.getAll() : action === 'put' ? s.put(value) : s.delete(value);
                tx.oncomplete = () => { db.close(); resolve(action === 'read' ? result.result.map(r => ({ id: r.id, name: r.name, savedAt: r.savedAt, size: r.size, importOptions: r.importOptions, blobSize: r.blob?.size })) : null); };
                tx.onerror = () => { db.close(); reject(tx.error); };
            };
        }), { action, value });
        const load = async name => {
            await page.locator('#file-input').setInputFiles(sample(name));
            await page.waitForFunction(name => Object.values(window.__csvViewerDebug.state.files).some(f => f.name === name), name);
        };
        const row = name => page.locator('.file-item').filter({ has: page.locator(`.file-name-text[title="${name}"]`) });
        const status = async (name, wanted) => page.waitForFunction(({ name, wanted }) => [...document.querySelectorAll('.file-item')]
            .find(e => e.querySelector('.file-name-text')?.title === name)?.querySelector('.file-session-badge')?.dataset.status === wanted, { name, wanted });

        await page.goto(url); await page.waitForFunction(() => !!window.__csvViewerDebug);
        await load('保存ﾃｽﾄ.csv'); await status('保存ﾃｽﾄ.csv', 'saved');
        let records = await store('read'); assert.equal(records.length, 1); assert.equal(records[0].blobSize, sample('x').buffer.length);
        assert.ok(records[0].savedAt > 0); assert.ok(await row('保存ﾃｽﾄ.csv').locator('time').textContent());
        const firstId = records[0].id;
        await page.reload(); await status('保存ﾃｽﾄ.csv', 'saved');
        records = await store('read'); assert.equal(records.length, 1); assert.equal(records[0].id, firstId, 'restoring does not duplicate records');

        await page.evaluate(() => { window.__failSessionWrites = true; });
        await load('書込失敗.csv'); await status('書込失敗.csv', 'failed');
        assert.equal((await store('read')).some(r => r.name === '書込失敗.csv'), false);
        assert.equal(await row('書込失敗.csv').locator('time').count(), 0);
        await page.evaluate(() => { window.__failSessionWrites = false; });
        await row('書込失敗.csv').getByRole('button', { name: /保存を再試行/ }).click();
        await status('書込失敗.csv', 'saved'); assert.equal((await store('read')).length, 2);

        // Exercise the actual capacity branch without allocating a 200 MiB test Blob.
        await store('put', { id: 'capacity-fixture', size: 200 * 1024 * 1024, name: 'capacity-fixture' });
        await load('容量超過.csv'); await status('容量超過.csv', 'skipped');
        assert.match(await row('容量超過.csv').textContent(), /今回のみ/);
        assert.equal((await store('read')).some(r => r.name === '容量超過.csv'), false);
        await store('delete', 'capacity-fixture');
        await row('容量超過.csv').getByRole('button', { name: /保存を再試行/ }).click(); await status('容量超過.csv', 'saved');

        await page.evaluate(() => { window.__failSessionDeletes = true; });
        await row('書込失敗.csv').locator('.remove-file').click();
        await page.getByRole('button', { name: 'ファイルを外す', exact: true }).click();
        await page.getByRole('button', { name: '削除を再試行' }).waitFor();
        assert.ok((await store('read')).some(r => r.name === '書込失敗.csv'));
        await page.evaluate(() => { window.__failSessionDeletes = false; });
        await page.getByRole('button', { name: '削除を再試行' }).click();
        await page.waitForFunction(() => !document.querySelector('.session-cleanup-notice'));
        assert.equal((await store('read')).some(r => r.name === '書込失敗.csv'), false);

        await page.evaluate(() => { window.__failSessionDeletes = true; });
        await page.locator('#clear-all-btn').click();
        await page.getByRole('button', { name: 'すべてクリア', exact: true }).click();
        await page.getByRole('button', { name: '削除を再試行' }).waitFor();
        await load('クリア後の新ログ.csv'); await status('クリア後の新ログ.csv', 'saved');
        await page.evaluate(() => { window.__failSessionDeletes = false; });
        await page.getByRole('button', { name: '削除を再試行' }).click();
        await page.waitForFunction(() => !document.querySelector('.session-cleanup-notice'));
        assert.deepEqual((await store('read')).map(r => r.name), ['クリア後の新ログ.csv'], 'clear retry preserves newer saved log');
        await page.reload(); await status('クリア後の新ログ.csv', 'saved');
        assert.equal(await page.locator('.file-item').count(), 1);

        await page.locator('#clear-all-btn').click();
        await page.getByRole('button', { name: 'すべてクリア', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.session-cleanup-notice'));
        assert.equal((await store('read')).length, 0);
        await page.reload(); assert.equal(await page.locator('.file-item').count(), 0);
        assert.deepEqual(errors, []);
        await context.close();

        const unsupported = await browser.newContext();
        await unsupported.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
        const noDb = await unsupported.newPage(); await noDb.goto(url);
        await noDb.locator('#file-input').setInputFiles(sample('保存非対応.csv'));
        await noDb.waitForFunction(() => document.querySelector('.file-session-badge')?.dataset.status === 'unavailable');
        assert.match(await noDb.locator('.file-session-row').textContent(), /非対応/);
        await unsupported.close();
        console.log('session-status browser: real IDB save/restore, failure/retry, 200 MiB limit, delete retry, clear, unavailable passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
