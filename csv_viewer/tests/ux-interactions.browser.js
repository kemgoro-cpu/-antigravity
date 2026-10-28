'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-ux-ﾃｽﾄ-'));
    const names = ['基準_ﾛｸﾞ.csv', '比較_ﾛｸﾞ.csv'];
    for (const [index, name] of names.entries()) {
        const rows = ['Time,Pressure,State', 's,kPa,'];
        for (let i = 0; i <= 40; i++) rows.push(`${i + index},${Math.sin(i / 4) * 10 + i},${i >= 20 ? 1 : 0}`);
        fs.writeFileSync(path.join(out, name), rows.join('\n'));
    }
    const fileCount = () => page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files).length);
    const selected = () => page.evaluate(() => [...window.__csvViewerDebug.state.selectedNames]);
    const focusedChannel = () => page.evaluate(() => document.activeElement.closest('.col-item')?.dataset.channel);
    try {
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.locator('#file-input').setInputFiles(names.map(n => path.join(out, n)));
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 2 && !window.__csvViewerDebug.state.parseJobs.size);

        // Space toggles a channel without losing the row; arrow keys can continue.
        const pressure = page.locator('[data-channel="Pressure"] .col-item-top');
        await pressure.focus(); await pressure.press('Space');
        await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids > 0);
        assert.deepEqual(await selected(), ['Pressure']);
        assert.equal(await focusedChannel(), 'Pressure');
        await page.keyboard.press('ArrowDown'); assert.equal(await focusedChannel(), 'State');
        await page.keyboard.press('ArrowUp'); assert.equal(await focusedChannel(), 'Pressure');
        await page.keyboard.press('Space'); assert.deepEqual(await selected(), []);
        assert.equal(await focusedChannel(), 'Pressure');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids > 0);

        // Native subcontrols are keyboard reachable and modal closure restores focus.
        const map = page.locator('[data-channel="Pressure"] .col-map-btn');
        assert.equal(await map.evaluate(el => el.tagName), 'BUTTON');
        await map.focus(); await page.keyboard.press('Enter');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor(); assert.ok(await dialog.getAttribute('aria-labelledby'));
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        assert.equal(await map.evaluate(el => el === document.activeElement), true);
        const insert = page.locator('[data-channel="Pressure"] .col-insert-btn');
        await insert.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#custom-ram-expr').isVisible(), true);
        assert.equal(await page.locator('#custom-ram-expr').inputValue(), 'Pressure');
        assert.equal(await page.locator('#custom-ram-expr').evaluate(el => el === document.activeElement), true);
        await page.locator('#custom-ram-expr').fill('');

        // View settings behave as a form: Tab enters it and arrows change a select.
        await page.locator('#view-menu-btn').focus(); await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#sampling-mode').evaluate(el => el === document.activeElement), true);
        const before = await page.locator('#sampling-mode').inputValue();
        await page.keyboard.press('ArrowDown');
        assert.notEqual(await page.locator('#sampling-mode').inputValue(), before);
        assert.equal(await page.locator('#sampling-mode').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#font-scale').evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator('#view-menu-panel').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#view-menu-btn').evaluate(el => el === document.activeElement), true);
        await page.locator('.compare-tools > summary').focus(); await page.keyboard.press('Enter');
        await page.keyboard.press('b');
        assert.equal(await page.evaluate(() => window.__csvViewerDebug.state.brushMode), false);
        await page.keyboard.press('Escape');

        // Cancel/Escape are safe; confirming identifies the exact file including kana.
        const remove = page.locator('.remove-file').last();
        assert.equal(await remove.evaluate(el => el.tagName), 'BUTTON');
        await remove.focus(); await page.keyboard.press('Enter');
        await page.locator('.destructive-cancel').waitFor();
        assert.ok((await dialog.innerText()).includes(names[1]));
        await page.waitForFunction(() => document.activeElement.classList.contains('destructive-cancel'));
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('.destructive-confirm').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.destructive-cancel').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await fileCount(), 2); assert.deepEqual(await selected(), ['Pressure']);
        assert.equal(await remove.evaluate(el => el === document.activeElement), true);

        await page.locator('#clear-all-btn').click();
        await page.locator('.destructive-cancel').waitFor();
        assert.ok((await dialog.innerText()).includes('2件のファイル'));
        await page.locator('.destructive-cancel').click();
        assert.equal(await fileCount(), 2); assert.deepEqual(await selected(), ['Pressure']);
        await remove.click(); await page.locator('.destructive-confirm').click();
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 1);
        assert.deepEqual(await page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(f => f.name)), [names[0]]);
        assert.deepEqual(await selected(), ['Pressure']);
        await page.locator('#clear-all-btn').click(); await page.locator('.destructive-confirm').click();
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 0);
        assert.deepEqual(await selected(), []);
        assert.equal(await page.locator('#browse-files-btn').evaluate(el => el === document.activeElement), true);
        assert.deepEqual(errors, []);
        console.log('UX keyboard, dialog, and destructive-action regressions passed:', out);
    } catch (e) {
        await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
        console.error('UX artifacts:', out, '\nPage errors:', errors);
        throw e;
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
