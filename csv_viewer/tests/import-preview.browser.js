/* Isolated Edge + file:// regression. Only synthetic files are created. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-import-ﾃｽﾄ-'));
    const errors = [];
    async function open() {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        return { context, page };
    }
    async function settled(page, count) {
        await page.waitForFunction(count => Object.keys(window.__csvViewerDebug.state.files).length === count && window.__csvViewerDebug.state.parseJobs.size === 0, count);
    }
    async function channel(page, name) {
        await page.locator('#column-search').fill(name);
        await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        await page.waitForFunction(name => Object.values(window.__csvViewerDebug.state.files).every(file => {
            const col = file.columns.find(col => col.name === name); return !col || !!file.colData[col.id];
        }), name);
    }
    const write = (name, text) => { const target = path.join(output, name); fs.writeFileSync(target, text); return target; };
    try {
        const files = [
            write('単位なし_ﾛｸﾞ.csv', 'Time,Speed\n0,1\n1,2\n2,3\n'),
            write('単位あり.csv', 'Time,Speed\ns,km/h\n0,1\n1,2\n2,3\n'),
            write('不正時刻.csv', 'Time,Speed\ns,km/h\n\n0,1\nbad,2\n1,3\nInfinity,4\n2,5\n'),
            write('符号付き.trn', 'Time  Actual Speed\ns     km/h\n0.0  1.5\n0.1 -0.5\n0.2  3.5\n'),
            write('SJIS_車速.csv', Buffer.concat([Buffer.from('Time,'), Buffer.from([0x8e, 0xd4, 0x91, 0xac]), Buffer.from('\ns,km/h\n0,1\n1,2\n2,3\n')])),
        ];
        const first = await open();
        try {
            assert.equal(await first.page.locator('#import-preview-open, #import-preview-files').count(), 0, 'the duplicate import entry is removed');
            const chooser = first.page.waitForEvent('filechooser');
            await first.page.locator('#browse-files-btn').click();
            await (await chooser).setFiles(files[0]);
            await settled(first.page, 1);
            await first.page.locator('#file-input').setInputFiles(files.slice(1));
            await settled(first.page, files.length);
            assert.equal(await first.page.locator('.import-preview-modal').count(), 0, 'default import remains immediate');
            await channel(first.page, 'Speed');
            const records = await first.page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(file => ({
                name: file.name, time: [...file.timeData], unitRow: file.headerInfo.unitRow,
                encoding: file.headerInfo.encoding, units: file.columns.map(col => col.unit),
                sourceRows: [...file.sourceRowNumbers], diagnostics: file.importDiagnostics,
                values: file.columns.map(col => file.colData[col.id] ? [...file.colData[col.id]] : null),
            })));
            for (const name of ['単位なし_ﾛｸﾞ.csv', '単位あり.csv']) {
                const file = records.find(item => item.name === name);
                assert.deepEqual(file.time, [0, 1, 2]); assert.deepEqual(file.values[0], [1, 2, 3]);
            }
            const plain = records.find(item => item.name === '単位なし_ﾛｸﾞ.csv');
            assert.equal(plain.unitRow, -1); assert.deepEqual(plain.units, ['']);
            const invalid = records.find(item => item.name === '不正時刻.csv');
            assert.deepEqual(invalid.time, [0, 1, 2]); assert.deepEqual(invalid.values[0], [1, 3, 5]);
            assert.deepEqual(invalid.sourceRows, [3, 5, 7]); assert.equal(invalid.diagnostics.invalidTimeCount, 2);
            assert.deepEqual(invalid.diagnostics.invalidTimeRows, [4, 6]);
            assert.equal(records.find(item => item.name === 'SJIS_車速.csv').encoding, 'shift-jis');
            assert.deepEqual(records.find(item => item.name === '符号付き.trn').time, [0, 0.1, 0.2]);
        } finally { await first.context.close(); }

        const second = await open();
        try {
            const custom = write('装置A.csv', 'memo;Time metadata\nPressure;Tick\nkPa;ms\n10;0\n20;500\n30;1000\n');
            const other = write('装置B.csv', 'Value,Elapsed\n5,0\n6,1\n7,2\n');
            await second.page.locator('#import-review-before-load').check();
            await second.page.locator('#file-input').setInputFiles([custom, other]);
            await second.page.locator('.import-preview-modal').waitFor();
            assert.equal(await second.page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files).length), 0, 'preview must not load files');
            await second.page.locator('#ip-delimiter').selectOption(';');
            await second.page.locator('#ip-name-mode').selectOption('manual');
            await second.page.locator('#ip-name-row').fill(''); await second.page.locator('#ip-name-row').press('Tab');
            assert.equal(await second.page.locator('#ip-confirm').isDisabled(), true, 'blank manual row cannot be confirmed');
            await second.page.locator('#ip-name-row').fill('2'); await second.page.locator('#ip-name-row').press('Tab');
            await second.page.locator('#ip-unit-mode').selectOption('manual');
            await second.page.locator('#ip-unit-row').fill('3'); await second.page.locator('#ip-unit-row').press('Tab');
            await second.page.locator('#ip-time').selectOption('1');
            await second.page.waitForFunction(() => document.getElementById('import-preview-message').textContent.includes('データ開始 4行'));
            await second.page.locator('#import-preview-select').selectOption('1');
            await second.page.locator('#ip-unit-mode').selectOption('none');
            await second.page.locator('#ip-time').selectOption('1');
            await second.page.waitForFunction(() => !document.getElementById('ip-confirm').disabled);
            await second.page.setViewportSize({ width: 390, height: 844 });
            assert.equal(await second.page.evaluate(() => document.querySelector('.import-preview-modal').scrollWidth > document.querySelector('.import-preview-modal').clientWidth + 1), false);
            await second.page.screenshot({ path: path.join(output, 'preview-390.png') });
            await second.page.locator('#ip-confirm').click(); await settled(second.page, 2);
            let result = await second.page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(file => ({
                name: file.name, time: [...file.timeData], opts: file.importOptions, columns: file.columns.map(col => col.name),
            })));
            assert.deepEqual(result.find(file => file.name === '装置A.csv').time, [0, 0.5, 1]);
            assert.deepEqual(result.find(file => file.name === '装置B.csv').time, [0, 1, 2]);
            assert.equal(result.find(file => file.name === '装置A.csv').opts.nameRow, 1);
            assert.equal(result.find(file => file.name === '装置A.csv').opts.unitRow, 2);
            assert.equal(result.find(file => file.name === '装置B.csv').opts.unitMode, 'none');
            await second.page.waitForTimeout(800); await second.page.reload(); await settled(second.page, 2);
            assert.equal(await second.page.locator('#import-review-before-load').isChecked(), true, 'review preference survives restore');
            result = await second.page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(file => ({ name: file.name, time: [...file.timeData], opts: file.importOptions })));
            assert.deepEqual(result.find(file => file.name === '装置A.csv').time, [0, 0.5, 1], 'per-file manual settings survive session restore');
            assert.equal(result.find(file => file.name === '装置B.csv').opts.unitMode, 'none');
        } finally { await second.context.close(); }

        const third = await open();
        try {
            await third.page.locator('#import-review-before-load').check();
            await third.page.locator('#file-input').setInputFiles(files[0]);
            await third.page.locator('.import-preview-modal').waitFor();
            await third.page.keyboard.press('Escape');
            assert.equal(await third.page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files).length), 0);
            assert.equal(await third.page.evaluate(() => window.__csvViewerDebug.state.parseJobs.size), 0);
            await third.page.locator('#import-review-before-load').uncheck();
            await third.page.locator('#file-input').setInputFiles(files[0]);
            await settled(third.page, 1);
            assert.equal(await third.page.locator('.import-preview-modal').count(), 0, 'same entry supports immediate import after cancelling review');
        } finally { await third.context.close(); }
        assert.deepEqual(errors, []);
        console.log('Import preview browser passed (unit rows, SJIS, TRN, manual per-file overrides, restore, cancel, 390px). Evidence:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
