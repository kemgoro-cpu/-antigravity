/* Run with Playwright in NODE_PATH. Isolated Edge profile; no server or network required. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage(), errors = [], consoleErrors = [], geometry = {};
    page.on('pageerror', error => errors.push(error.stack));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const out = process.env.UX_SCREENSHOT_DIR || path.join(__dirname, 'fixtures/generated/ux-audit-after');
    fs.mkdirSync(out, { recursive: true });
    let stage = 'startup';
    async function snapshot(name, width, height) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(200);
        geometry[name] = await page.evaluate(() => {
            const result = { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth };
            for (const selector of ['.sidebar', '.toolbar', '#chart', '#chart-overlay', '.empty-guide', '#compare-panel', '.compare-overview']) {
                const element = document.querySelector(selector), rect = element.getBoundingClientRect();
                result[selector] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, display: getComputedStyle(element).display };
            }
            return result;
        });
        await page.screenshot({ path: path.join(out, `${name}.png`) });
        assert.ok(geometry[name].documentWidth <= width, `${name}: no horizontal page overflow`);
        assert.ok(geometry[name]['#chart'].width >= (width < 500 ? width - 2 : 500), `${name}: useful chart width`);
        return geometry[name];
    }
    async function waitFiles(count) {
        await page.waitForFunction(n => Object.keys(window.__csvViewerDebug.state.files).length === n && window.__csvViewerDebug.state.parseJobs.size === 0, count);
    }
    const sample = name => ({ name, mimeType: 'text/csv', buffer: Buffer.from('Time,Pressure,Voltage\ns,kPa,V\n0,10,1\n1,12,2\n2,14,3\n3,13,2\n4,10,1\n') });
    const expanded = locator => page.locator(locator).getAttribute('aria-expanded');
    try {
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.waitForFunction(() => !!document.getElementById('workspace-sidebar-toggle'));
        stage = 'empty responsive shell';
        assert.equal(await expanded('#compare-panel-toggle'), 'false', 'empty workspace starts with comparison pane closed');
        for (const [width, height] of [[1600, 1000], [1100, 800], [390, 844]]) {
            const shot = await snapshot(`empty-${width}`, width, height);
            const guide = shot['.empty-guide'], overlay = shot['#chart-overlay'];
            assert.ok(guide.y >= overlay.y - 1 && guide.bottom <= overlay.bottom + 1, `${width}: all initial guidance fits`);
        }
        assert.equal(await expanded('#workspace-sidebar-toggle'), 'false', 'mobile sidebar starts collapsed');
        assert.equal(await page.locator('.sidebar').evaluate(el => el.inert), true);

        stage = 'loaded state and search recovery';
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.locator('#file-input').setInputFiles(sample('基準_ﾛｸﾞ.csv'));
        await waitFiles(1);
        await page.waitForFunction(() => document.getElementById('workspace-empty-title').textContent.includes('チャンネル'));
        assert.equal(await expanded('#compare-panel-toggle'), 'false', 'single-file view leaves space for the plot');
        assert.equal(await page.locator('#workspace-select-channels').isVisible(), true);
        await page.locator('#workspace-select-channels').click();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'column-search');
        // Exercise a real File/DataTransfer drop outside the upload box, preserving halfwidth kana.
        const droppedFile = sample('比較_ﾛｸﾞ.csv');
        const transfer = await page.evaluateHandle(({ name, contents }) => {
            const data = new DataTransfer();
            data.items.add(new File([contents], name, { type: 'text/csv' }));
            return data;
        }, { name: droppedFile.name, contents: droppedFile.buffer.toString('utf8') });
        await page.locator('#chart').dispatchEvent('drop', { dataTransfer: transfer });
        await transfer.dispose();
        await waitFiles(2);
        assert.deepEqual(await page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(file => file.name).sort()), ['基準_ﾛｸﾞ.csv', '比較_ﾛｸﾞ.csv'].sort(), 'window drop loads exactly one file and preserves its name');
        await page.waitForFunction(() => document.getElementById('compare-panel-toggle').getAttribute('aria-expanded') === 'true');
        await page.locator('#column-search').fill('not-a-channel');
        await page.waitForFunction(() => document.querySelectorAll('#column-list .col-item').length === 0);
        await page.waitForFunction(() => document.getElementById('workspace-channel-count').textContent.startsWith('0 /'));
        assert.match(await page.locator('#column-list').innerText(), /一致するチャンネルがありません/);
        await page.locator('#workspace-search-clear').click();
        await page.waitForFunction(() => document.querySelectorAll('#column-list .col-item').length === 2);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'column-search');
        await page.locator('#compare-channel-filter').selectOption('selected');
        await page.waitForFunction(() => document.querySelectorAll('#column-list .col-item').length === 0);
        await page.locator('#workspace-filter-reset').click();
        await page.waitForFunction(() => document.querySelectorAll('#column-list .col-item').length === 2);
        assert.equal(await page.locator('#compare-channel-filter').inputValue(), 'all');
        for (const name of ['Pressure', 'Voltage']) await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids === 2);
        await snapshot('loaded-1600', 1600, 1000);

        stage = 'compact comparison drawer and visible controls';
        await snapshot('loaded-1100', 1100, 800);
        assert.equal(await expanded('#compare-panel-toggle'), 'false', 'crossing compact breakpoint closes comparison drawer');
        for (const id of ['zoom-mode-btn', 'reset-zoom-btn', 'measure-mode-btn', 'view-menu-btn', 'export-menu-btn']) {
            assert.equal(await page.locator(`#${id} .btn-label`).isVisible(), true, `${id}: common action retains text label`);
        }
        await page.locator('#compare-panel-toggle').click();
        assert.equal(await page.locator('#compare-panel').evaluate(el => getComputedStyle(el).position), 'absolute');
        await page.locator('#workspace-panel-close').click();
        assert.equal(await expanded('#compare-panel-toggle'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'compare-panel-toggle');
        const icon = await page.locator('#shortcuts-help-btn i').evaluate(el => getComputedStyle(el, '::before').content);
        assert.ok(icon && !['none', 'normal', '""'].includes(icon), 'shortcut help has a visible glyph');

        stage = 'mobile sidebar keyboard and pointer access';
        const mobile = await snapshot('loaded-390', 390, 844);
        assert.ok(mobile['#chart'].height >= 300, 'mobile plot has useful height');
        assert.equal(await page.getByText('Y軸が多いため描画領域が狭くなっています', { exact: true }).count(), 0, 'a narrow single-axis plot does not warn about too many axes');
        await page.locator('#workspace-sidebar-toggle').click();
        assert.equal(await page.locator('.sidebar').getAttribute('role'), 'dialog');
        assert.equal(await page.locator('.main-content').evaluate(el => el.inert), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-sidebar-close');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('.sidebar')), true, 'reverse Tab stays within drawer');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-sidebar-close', 'Tab wraps from last to first');
        await page.keyboard.press('Escape');
        assert.equal(await expanded('#workspace-sidebar-toggle'), 'false');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-sidebar-toggle');
        await page.keyboard.press('Control+k');
        assert.equal(await expanded('#workspace-sidebar-toggle'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'column-search');
        await page.locator('#column-search').fill('Pressure');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#column-search').inputValue(), '', 'first Escape clears search');
        assert.equal(await expanded('#workspace-sidebar-toggle'), 'true', 'clearing search keeps drawer open');
        await page.keyboard.press('Escape');
        assert.equal(await expanded('#workspace-sidebar-toggle'), 'false', 'next Escape closes drawer');
        await page.keyboard.press('/');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'column-search', 'slash reopens channel search');
        await page.locator('#workspace-sidebar-backdrop').click({ position: { x: 380, y: 400 } });
        assert.equal(await expanded('#workspace-sidebar-toggle'), 'false', 'backdrop dismisses sidebar');
        assert.equal(await page.locator('.main-content').evaluate(el => el.inert), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-sidebar-toggle', 'backdrop dismissal returns focus to a visible control');
        await page.locator('#workspace-sidebar-toggle').click();
        await page.locator('#workspace-sidebar-close').click();
        assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace-sidebar-toggle');
        await page.locator('#theme-toggle-btn').click();
        await snapshot('loaded-light-390', 390, 844);
        assert.equal(await page.getByText('Y軸が多いため描画領域が狭くなっています', { exact: true }).count(), 0, 'theme changes do not reintroduce the false axis warning');

        stage = 'keyboard sidebar resizing';
        await page.setViewportSize({ width: 1600, height: 1000 });
        const handle = page.locator('#sidebar-resize-handle');
        const originalWidth = await page.locator('.sidebar').evaluate(el => el.offsetWidth);
        await handle.focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('.sidebar').evaluate(el => el.offsetWidth), originalWidth + 16);
        assert.equal(Number(await handle.getAttribute('aria-valuenow')), originalWidth + 16);
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.locator('.sidebar').evaluate(el => el.offsetWidth), originalWidth);

        assert.deepEqual(errors, []);
        assert.deepEqual(consoleErrors, []);
        console.log('UX layout, onboarding, search, and responsive drawer regression passed:', out);
    } catch (error) {
        console.error('Failed stage:', stage);
        await page.screenshot({ path: path.join(out, 'failure.png') });
        throw error;
    } finally {
        fs.writeFileSync(path.join(out, 'geometry.json'), JSON.stringify({ stage, geometry, errors, consoleErrors }, null, 2));
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
