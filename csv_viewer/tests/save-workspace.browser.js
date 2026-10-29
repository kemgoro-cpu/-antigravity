/* Save/reuse integration preserves existing formats and each purpose's apply semantics. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
(async () => {
    const root = path.resolve(__dirname, '..');
    const out = path.join(__dirname, 'fixtures/generated/save-workspace'); fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.addInitScript(() => localStorage.setItem('csvViewer_channelFavorites', JSON.stringify({ '旧お気に入り': ['Pressure'] })));
    const page = await context.newPage(), errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    const state = fn => page.evaluate(fn);
    const choose = async purpose => {
        if (!await page.locator('.save-workspace-modal').count()) await page.locator('#export-menu-btn').click();
        await page.locator('#save-purpose').selectOption(purpose);
    };
    const close = async () => { await page.locator('#save-workspace-close').click(); await page.waitForFunction(() => !document.getElementById('app-modal-overlay')); };
    const select = async name => { await page.locator('#column-search').fill(name); await page.locator(`[data-channel="${name}"] .col-item-top`).click(); await page.locator('#column-search').fill(''); };
    const download = async (button, name) => { const pending = page.waitForEvent('download'); await page.locator(button).click(); const saved = await pending; const file = path.join(out, name); await saved.saveAs(file); return file; };
    try {
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        assert.equal(await page.locator('.sidebar .preset-row').count(), 0, 'old sidebar forms have been moved, not duplicated');
        assert.equal(await page.locator('#compare-report').count(), 0, 'HTML report has one UI entry');
        await choose('output');
        assert.equal(await page.locator('#save-purpose option').count(), 5);
        assert.match(await page.locator('#save-unavailable').innerText(), /ログを開き/);
        assert.equal(await page.locator('#export-png-btn').isDisabled(), true);
        await choose('template');
        assert.equal(await page.locator('#compare-template-apply').isDisabled(), true);
        assert.equal(await page.locator('#compare-template-import').isDisabled(), true);
        await choose('favorite');
        await page.locator('#channel-fav-select').selectOption('旧お気に入り');
        assert.equal(await page.locator('#channel-fav-apply').isDisabled(), true);
        assert.equal(await page.locator('#channel-fav-delete').isEnabled(), true, 'stored library remains available without data');
        await choose('session');
        const settingsPath = await download('#export-settings-btn', 'empty-settings.json');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(settings._version, 7);
        assert.equal(Object.hasOwn(settings, 'files'), false, 'settings do not embed log data');
        const chooserPromise = page.waitForEvent('filechooser'); await page.locator('#import-settings-btn').click();
        await (await chooserPromise).setFiles(settingsPath);
        await page.waitForTimeout(80);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement?.id === 'export-menu-btn');
        await page.locator('#export-menu-btn').click();
        assert.equal(await page.locator('#save-purpose').inputValue(), 'session');
        await close();

        await page.locator('#file-input').setInputFiles(['基準_ﾛｸﾞ.csv', '比較_ﾛｸﾞ.csv'].map(name => path.join(root, 'docs/samples', name)));
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 2 && window.__csvViewerDebug.state.parseJobs.size === 0);
        await select('Speed'); await select('Pressure');
        await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids === 2);
        await state(() => {
            const s = window.__csvViewerDebug.state;
            Object.values(s.files).find(file => file.role === 'sub').offset = -2;
            s.comparison.notes = [{ id: 'kept', text: '保持するメモ', t0: 0, t1: 1, created: new Date().toISOString(), channels: ['Pressure'], files: [], results: [], context: { settings: {} } }];
            s.comparison.labels = { '比較_ﾛｸﾞ.csv': '表示名を保持' };
        });
        await choose('favorite');
        assert.match(await page.locator('#save-purpose-description').innerText(), /独立した段/);
        await page.locator('#channel-fav-select').selectOption('旧お気に入り'); await page.locator('#channel-fav-apply').click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.selectedNames.size === 1);
        assert.deepEqual(await state(() => [...window.__csvViewerDebug.state.selectedNames]), ['Pressure']);
        assert.equal(await state(() => window.__csvViewerDebug.state.chartGroups.length), 1);
        assert.equal(await state(() => window.__csvViewerDebug.state.comparison.notes[0].text), '保持するメモ');
        assert.equal(await state(() => Object.values(window.__csvViewerDebug.state.files).find(file => file.role === 'sub').offset), -2);
        page.once('dialog', dialog => dialog.accept('新お気に入り'));
        await page.locator('#channel-fav-save').click();
        assert.deepEqual(await state(() => JSON.parse(localStorage.getItem('csvViewer_channelFavorites'))['新お気に入り']), ['Pressure']);
        assert.equal(await page.locator('.save-workspace-modal').count(), 1, 'native prompt does not lose the hub');
        page.once('dialog', dialog => dialog.dismiss()); await page.locator('#channel-fav-save').click();
        assert.equal(await page.locator('#channel-fav-select').inputValue(), '新お気に入り');

        await choose('preset');
        assert.match(await page.locator('#save-purpose-description').innerText(), /比較メモをクリア/);
        page.once('dialog', dialog => dialog.accept('従来形式プリセット')); await page.locator('#preset-save-btn').click();
        assert.equal(await state(() => JSON.parse(localStorage.getItem('csvViewer_presets'))['従来形式プリセット']._version), 7);
        await page.locator('#preset-load-btn').click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.comparison.notes.length === 0);
        await choose('template');
        await page.locator('#compare-template-name').fill('次回用の条件'); await page.locator('#compare-template-save').click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('csv-compare-templates')).length === 1);
        const templatePath = await download('#compare-template-export', 'comparison-template.json');
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
        assert.equal(template.format, 'CSV Comparison Template'); assert.equal(template.version, 1);
        assert.equal(template.settings.fileInfos, undefined); assert.deepEqual(template.settings.comparison.notes, []);
        await close(); await choose('template');
        assert.equal(await page.locator('#compare-template-name').inputValue(), '次回用の条件');
        assert.equal(await page.locator('#compare-template-select').inputValue(), '0');
        await state(() => {
            const s = window.__csvViewerDebug.state;
            s.comparison.notes = [{ id: 'new', text: '今回のメモを残す', t0: 0, t1: 1, created: new Date().toISOString(), channels: ['Pressure'], files: [], results: [], context: { settings: {} } }];
            s.comparison.labels = { '比較_ﾛｸﾞ.csv': '新しい表示名' };
            Object.values(s.files).find(file => file.role === 'sub').offset = 5;
        });
        await page.locator('#compare-template-apply').click();
        await page.waitForFunction(() => !document.querySelector('.save-workspace-modal'));
        assert.equal(await state(() => Object.values(window.__csvViewerDebug.state.files).find(file => file.role === 'sub').offset), 0);
        assert.equal(await state(() => window.__csvViewerDebug.state.comparison.notes[0].text), '今回のメモを残す');
        assert.equal(await state(() => window.__csvViewerDebug.state.comparison.labels['比較_ﾛｸﾞ.csv']), '新しい表示名');
        assert.equal(await page.locator('#compare-align-run').count(), 1);
        // Same file may be imported twice; the native input value is cleared each time.
        for (let i = 0; i < 2; i++) {
            await choose('template'); await page.locator('#compare-template-import').setInputFiles(templatePath);
            await page.waitForFunction(() => !document.querySelector('.save-workspace-modal'));
        }
        // A slow import cannot accept another operation or close a newly reopened hub.
        await choose('template');
        await page.evaluate(() => {
            const original = File.prototype.text;
            File.prototype.text = async function () { const text = await original.call(this); await new Promise(resolve => { window.__finishTemplateRead = resolve; }); return text; };
            window.__restoreFileText = () => { File.prototype.text = original; };
        });
        await page.locator('#compare-template-import').setInputFiles(templatePath);
        await page.waitForFunction(() => !!window.__finishTemplateRead);
        assert.equal(await page.locator('#save-purpose').isDisabled(), true);
        await close(); await page.locator('#export-menu-btn').click();
        assert.equal(await page.locator('#save-purpose').isDisabled(), true);
        await page.waitForFunction(() => document.activeElement?.id === 'save-workspace-close');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'save-workspace-close', 'Tab must skip the inert busy controls');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'save-workspace-close');
        await page.evaluate(() => { window.__finishTemplateRead(); window.__restoreFileText(); });
        await page.waitForFunction(() => !document.getElementById('save-purpose').disabled);
        assert.equal(await page.locator('.save-workspace-modal').count(), 1, 'completion must not close a different dialog');
        await choose('output');
        const csvPath = await download('#export-csv-btn', 'output.csv'); assert.match(fs.readFileSync(csvPath, 'utf8'), /Pressure/);
        const reportPath = await download('#export-report-btn', 'report.html'); assert.match(fs.readFileSync(reportPath, 'utf8'), /今回のメモを残す/);
        await close();
        const pngPromise = page.waitForEvent('download'); await page.keyboard.press('Control+s');
        assert.match((await pngPromise).suggestedFilename(), /\.png$/);
        await choose('template');
        await page.keyboard.press('m');
        assert.equal(await state(() => window.__csvViewerDebug.state.measureMode), false, 'modal typing cannot activate chart modes');
        await page.setViewportSize({ width: 390, height: 844 });
        const box = await page.locator('.save-workspace-modal').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(out, 'save-template-390.png') });
        await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement?.id === 'export-menu-btn');
        await page.setViewportSize({ width: 1440, height: 1000 });
        await choose('output');
        // Replacing a modal externally must park, not destroy, the shared controls.
        await page.evaluate(() => window.__csvViewerDebug.showXYPlotModal());
        await page.waitForFunction(() => document.querySelector('.xy-modal')?.contains(document.activeElement));
        await page.keyboard.press('Escape'); await choose('favorite');
        for (const id of ['settings-preset-select', 'channel-fav-select', 'compare-template-name', 'export-settings-btn']) assert.equal(await page.locator('#' + id).count(), 1, id + ' stays unique');
        assert.equal(await page.locator('#channel-fav-select').inputValue(), '新お気に入り');
        await close();
        // If the user changes logs while file text is being read, never apply to the new target.
        await choose('template');
        await page.evaluate(() => {
            const original = File.prototype.text;
            window.__finishTemplateRead = null;
            File.prototype.text = async function () { const text = await original.call(this); await new Promise(resolve => { window.__finishTemplateRead = resolve; }); return text; };
            window.__restoreFileText = () => { File.prototype.text = original; };
        });
        await page.locator('#compare-template-import').setInputFiles(templatePath);
        await page.waitForFunction(() => !!window.__finishTemplateRead); await close();
        const mainId = await state(() => Object.entries(window.__csvViewerDebug.state.files).find(([, file]) => file.role === 'main')[0]);
        await page.locator(`.remove-file[data-fid="${mainId}"]`).click(); await page.locator('.destructive-confirm').click();
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 1 && window.__csvViewerDebug.state.selectedNames.size === 0);
        await page.evaluate(() => { window.__finishTemplateRead(); window.__restoreFileText(); });
        await page.waitForFunction(() => document.body.textContent.includes('読み込み中に対象ログ・基準・比較順が変わりました'));
        assert.deepEqual(await state(() => [...window.__csvViewerDebug.state.selectedNames]), [], 'template must not select channels on the replacement main log');
        assert.deepEqual(errors, []); assert.deepEqual(network, []);
        console.log('Save/reuse workflow passed: existing formats, distinct apply effects, downloads, prompts, native import, modal reuse, focus, 390px, offline.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
