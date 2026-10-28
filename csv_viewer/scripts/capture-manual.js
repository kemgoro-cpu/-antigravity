/*
 * Rebuild the manual's small CSV samples and real application screenshots.
 * Requirements: Playwright in NODE_PATH, Microsoft Edge (or PLAYWRIGHT_CHANNEL).
 * Run from csv_viewer: node scripts/capture-manual.js
 * Uses an isolated browser context and file://; never touches the user's saved session.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const images = path.join(root, 'docs/images');
const samples = path.join(root, 'docs/samples');
fs.mkdirSync(images, { recursive: true });
fs.mkdirSync(samples, { recursive: true });

function writeSamples() {
    const reference = ['Time,Speed,Pressure,State', 's,km/h,kPa,'];
    const comparison = [...reference];
    for (let i = 0; i <= 120; i++) {
        const t = i / 2;
        const speed = t < 8 ? 0 : t < 20 ? (t - 8) * 4 : t < 28 ? 48 : t < 38 ? 48 - (t - 28) * 3.3 : t < 46 ? 15 + (t - 38) * 5 : t < 56 ? 55 - (t - 46) * 5.5 : 0;
        // Binary-exact eighths keep the tutorial's known 5 kPa difference exact in Float32.
        const pressure = Math.round((100 + 0.45 * speed + 2 * Math.sin(t / 3)) * 8) / 8;
        const state = t >= 8 && t < 56 ? 1 : 0;
        reference.push(`${t},${speed.toFixed(3)},${pressure.toFixed(3)},${state}`);
        comparison.push(`${t + 2},${speed.toFixed(3)},${(Number(pressure.toFixed(3)) + 5).toFixed(3)},${state}`);
    }
    for (const [name, rows] of [['基準_ﾛｸﾞ.csv', reference], ['比較_ﾛｸﾞ.csv', comparison]]) {
        fs.writeFileSync(path.join(samples, name), rows.join('\r\n') + '\r\n', 'utf8');
    }
}

(async () => {
    writeSamples();
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
    await context.addInitScript(() => {
        window.__manualBrowserErrors = [];
        window.addEventListener('error', event => window.__manualBrowserErrors.push(event.message));
    });
    const page = await context.newPage();
    const errors = [], shots = [], facts = { sampleCount: 121, samplePeriodSeconds: 0.5, comparisonTimeDelaySeconds: 2, comparisonPressureIncreaseKPa: 5 };
    const sourceHashes = Object.fromEntries(['index.html', 'app.js', 'styles.css', 'parser-utils.js', 'compare-utils.js', 'chart-options-utils.js', 'layout-utils.js', 'compare-workspace.js', 'compare-workspace.css', 'workspace-ui.js', 'workspace-ui.css'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    page.on('pageerror', error => errors.push(error.stack || error.message));
    async function settle() {
        await page.mouse.move(750, 25);
        await page.waitForFunction(() => !document.querySelector('#error-toast-container')?.children.length, null, { timeout: 12000 });
        await page.waitForTimeout(350);
    }
    async function capture(name, description, crop) {
        await settle();
        await page.screenshot({ path: path.join(images, name + '.png') });
        if (crop) await page.locator(crop).screenshot({ path: path.join(images, name + '-panel.png') });
        shots.push({ file: name + '.png', description, crop: crop ? name + '-panel.png' : null, viewport: page.viewportSize() });
    }
    async function select(name) {
        await page.locator('#column-search').fill(name);
        const row = page.locator(`[data-channel="${name}"] .col-item-top`);
        await row.waitFor();
        if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
        await page.locator('#column-search').fill('');
    }
    try {
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug && !!document.getElementById('workspace-sidebar-toggle'));
        if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.locator('#theme-toggle-btn').click();
        await capture('start', '初期画面。ファイルを選ぶ前のライトテーマ。');

        await page.locator('#file-input').setInputFiles([path.join(samples, '基準_ﾛｸﾞ.csv'), path.join(samples, '比較_ﾛｸﾞ.csv')]);
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 2 && window.__csvViewerDebug.state.parseJobs.size === 0);
        await select('Pressure'); await select('Speed');
        await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids === 2);
        await capture('overview', 'PressureとSpeedを表示。時間合わせ前の重ね合わせ。');
        await page.locator('.sidebar').screenshot({ path: path.join(images, 'sidebar.png') });
        await page.locator('.compare-overview').screenshot({ path: path.join(images, 'navigator-panel.png') });
        assert.equal(await page.evaluate(() => window.__csvViewerDebug.state.chart.getOption().dataZoom[0].show), false, 'the separate overview is the only visible time navigator');

        await page.locator('[data-pane="align"]').click();
        await page.locator('#compare-align-channel').selectOption('Speed');
        await page.locator('#compare-align-span').fill('5');
        await page.locator('#compare-align-run').click();
        await page.waitForFunction(() => !document.getElementById('compare-align-apply').disabled);
        assert.equal(await page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).find(file => file.role === 'sub').offset), 0, 'preview must leave the actual offset unchanged');
        facts.previewText = await page.locator('#compare-align-info').innerText();
        await page.locator('#compare-align-channel').scrollIntoViewIfNeeded();
        await settle();
        await page.locator('#compare-panel').screenshot({ path: path.join(images, 'align-controls.png') });
        // A shorter viewport allows the native panel to scroll past the preview button cleanly.
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.locator('#compare-align-apply').scrollIntoViewIfNeeded();
        await page.locator('#compare-align-preview').evaluate(element => element.previousElementSibling.scrollIntoView({ block: 'start' }));
        await capture('align', 'Speedで探索幅±5秒のプレビュー。候補は-2秒、適用前の実シフトは0秒。', '#compare-panel');
        await page.setViewportSize({ width: 1400, height: 1000 });
        await page.locator('#compare-align-apply').click();
        await page.waitForFunction(() => Math.abs(Object.values(window.__csvViewerDebug.state.files).find(file => file.role === 'sub').offset + 2) < 0.01);
        facts.appliedOffsetSeconds = await page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).find(file => file.role === 'sub').offset);

        await page.locator('[data-pane="prepare"]').click();
        await page.locator('#compare-select-range').click();
        const points = await page.evaluate(() => {
            const { state } = window.__csvViewerDebug;
            const canvas = document.querySelector('#chart canvas').getBoundingClientRect();
            return { x0: canvas.x + state.chart.convertToPixel({ xAxisIndex: 0 }, 10), x1: canvas.x + state.chart.convertToPixel({ xAxisIndex: 0 }, 30), y: canvas.y + state.gridRegions[0].top + 65 };
        });
        await page.mouse.move(points.x0, points.y); await page.mouse.down();
        await page.mouse.move(points.x1, points.y, { steps: 16 }); await page.mouse.up();
        await page.locator('#compare-selection:not(.hidden)').waitFor();
        facts.selectedRangeLabel = await page.locator('#compare-selection-label').innerText();
        await capture('selection', '約10～30秒をドラッグで選択。上の操作バーから区間比較やメモを実行。');
        await page.locator('#compare-selection').screenshot({ path: path.join(images, 'selection-strip.png') });

        await page.locator('[data-range-action="compare"]').click();
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 2);
        const pressure = page.locator('.compare-result').filter({ has: page.locator('.compare-result-title', { hasText: 'Pressure' }) });
        await pressure.locator('[data-tolerance]').fill('3');
        await pressure.locator('[data-tolerance]').press('Enter');
        await page.waitForFunction(() => document.getElementById('compare-results-list').textContent.includes('1.66667'));
        await page.locator('[data-view="diff"]').click();
        facts.pressureResults = await pressure.innerText();
        assert.match(facts.pressureResults, /-5\s*\/\s*5/, 'aligned Pressure mean difference is -5 and RMS difference is 5');
        assert.equal(await pressure.getAttribute('data-result-status'), 'exceeded');
        assert.match(facts.pressureResults, /41 点超過/);
        await pressure.scrollIntoViewIfNeeded();
        await capture('results', '差分表示と超過判定。Pressureの平均差-5kPa、RMS差5、許容差3kPa、41点超過。', '.compare-result[data-result-status="exceeded"]');
        await page.locator('#compare-panel-content').evaluate(element => { element.scrollTop = 0; });
        await capture('tolerance', '選択区間10〜30秒のPressureが許容差3kPaを超え、オレンジの帯と超過1件の案内が表示される。');
        await pressure.locator('[data-exceedance-step="1"]').click();
        await settle();
        facts.exceedanceNavigation = await pressure.locator('.compare-exceedance-position').innerText();
        assert.match(facts.exceedanceNavigation, /1 \/ 1/);
        await pressure.locator('.compare-exceedance-nav').screenshot({ path: path.join(images, 'tolerance-nav.png') });
        await page.locator('#compare-range-all').click();

        await page.locator('[data-range-action="note"]').click();
        await page.locator('#compare-note-text').fill('Speedで時間合わせ（比較側 -2秒）。選択区間のPressureは基準−比較=-5 kPa。比較側が一貫して5 kPa高い。許容差3 kPaを超過。');
        await page.locator('#compare-note-add').click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.comparison.notes.length === 1);
        facts.note = await page.evaluate(() => {
            const note = window.__csvViewerDebug.state.comparison.notes[0];
            return { t0: note.t0, t1: note.t1, channels: note.channels, results: note.results.map(({ name, n, mean, rms, max, exceeded }) => ({ name, n, mean, rms, max, exceeded })) };
        });
        await page.locator('#compare-template-name').fill('圧力と速度の比較');
        await page.locator('#compare-template-save').click();
        await page.locator('#compare-note-text').scrollIntoViewIfNeeded();
        await capture('notes', '区間と条件を伴うメモを保存。下部で比較テンプレートも保存。', '#compare-panel');

        await page.locator('#export-menu-btn').click();
        await capture('export', '保存・出力メニュー。PNG、CSV、HTMLレポート、設定JSONの入口。', '#export-menu-panel');
        await page.keyboard.press('Escape');

        await page.locator('.compare-tools > summary').click();
        await page.locator('#xy-plot-btn').click();
        await page.locator('#xy-x-select').selectOption('Speed');
        await page.locator('#xy-y-select').selectOption('Pressure');
        await page.waitForFunction(() => !!document.querySelector('#xy-chart canvas'));
        await capture('xy', 'XYプロット。X=Speed、Y=Pressureで2本の関係を確認。', '.xy-modal');
        assert.deepEqual(errors, []);
        const browserErrors = await page.evaluate(() => window.__manualBrowserErrors);
        assert.deepEqual(browserErrors, []);
        fs.writeFileSync(path.join(images, 'capture-manifest.json'), JSON.stringify({ revision: '2026-10-29', generatedAt: new Date().toISOString(), viewport: { width: 1400, height: 1000 }, theme: 'light', source: 'Real application screenshots through Playwright, isolated Edge context and file:// with native scrollbars. No screenshot content was edited.', sourceHashes, facts, shots, additionalImages: ['align-controls.png', 'sidebar.png', 'selection-strip.png', 'navigator-panel.png', 'tolerance-nav.png'], errors, browserErrors }, null, 2) + '\n');
        console.log(JSON.stringify({ images, facts, screenshots: shots.length }, null, 2));
    } catch (error) {
        const out = path.join(root, 'tests/fixtures/generated/manual-capture');
        fs.mkdirSync(out, { recursive: true });
        await page.screenshot({ path: path.join(out, 'failure.png') });
        console.error('Manual capture failed; screenshot:', path.join(out, 'failure.png'));
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
