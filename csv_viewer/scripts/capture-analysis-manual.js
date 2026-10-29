/* Additional manual screenshots for the analysis workflow. Synthetic samples
 * only, isolated Edge context, file://, and no modification of source CSVs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const images = path.join(root, 'docs/images');
const samples = ['基準_ﾛｸﾞ.csv', '比較_ﾛｸﾞ.csv'].map(name => path.join(root, 'docs/samples', name));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function openInspector(page, tab) {
    if (!await page.locator('#data-inspector').isVisible()) await page.locator('#inspector-open').click();
    await page.locator('#inspector-tab-' + tab).click();
    if (tab === 'stats') await page.locator('#inspector-statistics').waitFor();
}

(async () => {
    const sampleHashes = samples.map(hash);
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await context.newPage(), errors = [], remoteRequests = [], shots = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
    const settle = async () => { await page.mouse.move(750, 25); await page.waitForTimeout(400); };
    const capture = async (name, selector, description) => {
        await settle();
        const target = selector ? page.locator(selector) : page;
        await target.screenshot({ path: path.join(images, name + '.png') });
        shots.push({ file: name + '.png', description, selector });
    };
    try {
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.locator('#theme-toggle-btn').click();
        await page.locator('#import-review-before-load').check();
        await page.locator('#file-input').setInputFiles(samples);
        await page.waitForFunction(() => !document.querySelector('#ip-confirm')?.disabled);
        assert.equal(await page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files).length), 0);
        await capture('import-preview-panel', '.import-preview-modal', '適用前の複数ファイル確認。まだファイルを読み込んでいない。');
        await page.locator('#ip-cancel').click();
        await page.locator('#import-review-before-load').uncheck();
        // Load the Main first so the guide is independent of parser completion order.
        for (let i = 0; i < samples.length; i++) {
            await page.locator('#file-input').setInputFiles(samples[i]);
            await page.waitForFunction(count => Object.keys(window.__csvViewerDebug.state.files).length === count && window.__csvViewerDebug.state.parseJobs.size === 0, i + 1);
        }
        await page.waitForFunction(() => [...document.querySelectorAll('.file-session-badge')].every(badge => badge.dataset.status === 'saved'));
        await capture('session-status-panel', '#file-list', '2ファイルの自動復元可能表示と最終成功時刻。');
        for (const name of ['Pressure', 'Speed']) {
            await page.locator('#column-search').fill(name);
            await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        }
        await page.locator('#column-search').fill('');
        await page.locator('.offset-input').fill('-2'); await page.locator('.offset-input').press('Tab');
        await page.evaluate(() => window.__csvViewerDebug.selectAnalysisRange([10, 30]));
        await openInspector(page, 'data');
        await settle();
        await capture('data-inspector', null, '選択区間10〜30秒の波形と、元サンプルの数値表。');
        await openInspector(page, 'quality');
        await settle();
        await capture('quality-inspector', null, '時刻全体と共通の解析区間の値を区別した品質診断。合成ログの正常例。');
        assert.deepEqual(errors, []);
        assert.deepEqual(remoteRequests, []);
        assert.deepEqual(samples.map(hash), sampleHashes, 'source samples are unchanged');
        fs.writeFileSync(path.join(images, 'analysis-capture-manifest.json'), JSON.stringify({
            revision: '2026-10-30', generatedAt: new Date().toISOString(),
            source: 'Real application screenshots, isolated Edge, synthetic bundled logs, no image editing.',
            sampleHashes, sourceHashes: Object.fromEntries(['app.js', 'index.html', 'data-inspector.js', 'data-quality-utils.js', 'import-preview.js', 'session-status.js'].map(file => [file, hash(path.join(root, file))])),
            shots, errors, remoteRequests,
        }, null, 2) + '\n');
        console.log(JSON.stringify({ screenshots: shots.length, samplesUnchanged: true, offline: true }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
