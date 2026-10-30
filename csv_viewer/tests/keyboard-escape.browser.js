/* Escape routing and focus regression checks. Synthetic data, isolated offline browser. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const output = process.env.CSV_ESCAPE_REPORT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'csv-keyboard-escape-'));
    fs.mkdirSync(output, { recursive: true });
    const results = [];
    const rows = ['Time,Speed,RPM,Load', 's,km/h,rpm,%'];
    for (let i = 0; i <= 100; i++) rows.push(`${i},${20 + 10 * Math.sin(i / 10)},${1000 + 8 * i},${30 + 15 * Math.cos(i / 7)}`);
    const files = ['synthetic-main.csv', 'synthetic-sub.csv'].map(name => ({ name, mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) }));
    const mode = page => page.evaluate(() => {
        const s = window.__csvViewerDebug.state;
        return { arrange: s.arrangeMode, shift: s.shiftMode, brush: s.brushMode, measure: s.measureMode };
    });
    const isSummaryFocused = page => page.locator('.compare-tools > summary').evaluate(el => el === document.activeElement);
    const openTools = async page => {
        if (!await page.locator('.compare-tools').evaluate(el => el.open)) await page.locator('.compare-tools > summary').click();
    };
    const launch = async (page, id, keyboard = false) => {
        await openTools(page);
        const button = page.locator(`#${id}`);
        if (keyboard) { await button.focus(); await page.keyboard.press('Enter'); }
        else await button.click();
    };
    async function check(name, run) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        await context.route(/^https?:\/\//, route => route.abort());
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(8000);
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
            await page.locator('#file-input').setInputFiles(files);
            await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 2 && !window.__csvViewerDebug.state.parseJobs.size);
            for (const name of ['Speed', 'RPM', 'Load']) await page.locator(`[data-channel="${name}"] .col-item-top`).click();
            await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids === 3);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await run(page);
            assert.deepEqual(errors, []);
            results.push({ name, status: 'PASS' });
        } catch (error) {
            const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id, toolsOpen: document.querySelector('.compare-tools')?.open })).catch(() => null);
            results.push({ name, status: 'FAIL', error: error.message, focus, mode: await mode(page).catch(() => null), pageErrors: errors });
            await page.screenshot({ path: path.join(output, `failure-${results.length}.png`) }).catch(() => {});
        } finally { await context.close(); }
    }
    try {
        for (const keyboard of [false, true]) await check(`Arrange: immediate Escape after ${keyboard ? 'keyboard' : 'mouse'} menu command`, async page => {
            await launch(page, 'arrange-mode-btn', keyboard);
            assert.equal((await mode(page)).arrange, true);
            assert.equal(await isSummaryFocused(page), true);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
            assert.equal(await page.locator('.chart-arrange-panel').count(), 0);
        });
        await check('Time shift: immediate Escape from tools', async page => {
            await launch(page, 'shift-mode-btn');
            assert.equal((await mode(page)).shift, true);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).shift, false);
        });
        await check('Repeated open menu: first Escape closes menu, second exits mode', async page => {
            for (let i = 0; i < 3; i++) {
                await launch(page, 'arrange-mode-btn');
                await openTools(page);
                await page.keyboard.press('Escape');
                assert.equal(await page.locator('.compare-tools').evaluate(el => el.open), false);
                assert.equal((await mode(page)).arrange, true);
                assert.equal(await isSummaryFocused(page), true);
                await page.keyboard.press('Escape');
                assert.equal((await mode(page)).arrange, false);
            }
        });
        await check('Closed tools summary allows Escape after B, M and T shortcuts', async page => {
            for (const [key, field] of [['b', 'brush'], ['m', 'measure'], ['t', 'shift']]) {
                await page.locator('.compare-tools > summary').focus();
                await page.keyboard.press(key);
                assert.equal((await mode(page))[field], true);
                await page.keyboard.press('Escape');
                assert.equal((await mode(page))[field], false);
            }
        });
        await check('Display dropdown closes before background mode', async page => {
            await launch(page, 'arrange-mode-btn');
            await page.locator('#view-menu-btn').click();
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#view-menu-panel').isVisible(), false);
            assert.equal((await mode(page)).arrange, true);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
        });
        for (const id of ['drive-index-btn', 'xy-plot-btn', 'diff-curves-btn']) await check(`${id}: modal closes and restores visible tools summary`, async page => {
            for (let pass = 0; pass < 2; pass++) {
                await launch(page, id, pass === 1);
                const dialog = page.locator('#app-modal-overlay [role="dialog"]');
                await dialog.waitFor();
                await page.waitForFunction(() => document.querySelector('#app-modal-overlay')?.contains(document.activeElement));
                await page.keyboard.press('Escape');
                await page.locator('#app-modal-overlay').waitFor({ state: 'detached' });
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
                assert.equal(await isSummaryFocused(page), true);
                assert.equal(await page.locator('.compare-tools').evaluate(el => el.open), false);
            }
        });
        await check('Modal Escape preserves background mode; next Escape exits it', async page => {
            await launch(page, 'arrange-mode-btn');
            await launch(page, 'drive-index-btn');
            await page.waitForFunction(() => document.querySelector('#app-modal-overlay')?.contains(document.activeElement));
            await page.keyboard.press('Escape');
            await page.locator('#app-modal-overlay').waitFor({ state: 'detached' });
            assert.equal((await mode(page)).arrange, true);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
        });
        await check('Search/input and IME do not trigger chart shortcuts or cancel mode', async page => {
            await launch(page, 'arrange-mode-btn');
            const search = page.locator('#column-search');
            await search.fill('Speed');
            await search.press('Escape');
            assert.equal(await search.inputValue(), '');
            assert.equal((await mode(page)).arrange, true);
            await search.press('b');
            assert.equal((await mode(page)).brush, false);
            await search.press('Escape');
            await search.press('Escape');
            assert.equal((await mode(page)).arrange, true);
            await page.locator('.chart-arrange-panel').first().click({ position: { x: 350, y: 70 } });
            await page.locator('body').dispatchEvent('keydown', { key: 'Escape', isComposing: true });
            assert.equal((await mode(page)).arrange, true);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
        });
        await check('Range selection: Escape cancels, button can start again', async page => {
            for (let i = 0; i < 2; i++) {
                await page.locator('#compare-select-range').click();
                assert.equal((await mode(page)).brush, true);
                await page.keyboard.press('Escape');
                assert.equal((await mode(page)).brush, false);
                assert.equal(await page.locator('#compare-select-range').getAttribute('aria-pressed'), 'false');
            }
        });
        await check('Save/reuse modal Escape returns focus and can reopen', async page => {
            for (let i = 0; i < 2; i++) {
                await page.locator('#export-menu-btn').click();
                await page.waitForFunction(() => document.activeElement?.id === 'save-purpose');
                await page.keyboard.press('Escape');
                await page.locator('#app-modal-overlay').waitFor({ state: 'detached' });
                assert.equal(await page.locator('#export-menu-btn').evaluate(el => el === document.activeElement), true);
            }
        });
        await check('Stack supports grouped arrange; diff remains disabled', async page => {
            await page.locator('[data-view="stack"]').click();
            await launch(page, 'arrange-mode-btn');
            assert.equal(await page.locator('.chart-arrange-panel').count(), 3);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
            await page.locator('[data-view="diff"]').click();
            await openTools(page);
            assert.equal(await page.locator('#arrange-mode-btn').isDisabled(), true);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
            await page.locator('[data-view="overlay"]').click();
            await launch(page, 'arrange-mode-btn');
            const panels = page.locator('.chart-arrange-panel');
            const target = await panels.last().boundingBox();
            await panels.first().locator('.chart-arrange-handle').dragTo(panels.last(), { targetPosition: { x: 250, y: target.height - 10 } });
            assert.deepEqual(await page.evaluate(() => window.__csvViewerDebug.state.chartGroups.map(g => g.channels[0].name)), ['RPM', 'Load', 'Speed']);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
        });
    } finally { await browser.close(); }
    const report = { source: path.resolve(__dirname, '..'), synthetic: true, results, passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('Escape regression artifacts:', output);
    process.exitCode = report.failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
