'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
async function openInspector(page, tab) {
    if (!await page.locator('#data-inspector').isVisible()) await page.locator('#inspector-open').click();
    await page.locator('#inspector-tab-' + tab).click();
    if (tab === 'stats') await page.locator('#inspector-statistics').waitFor();
}

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setContent('<style>:root{--bg-main:#10151d;--bg-surface:#18212c;--bg-hover:#263749;--border:#3b4b5e;--text-primary:#edf2f8;--text-secondary:#b2bfce;--accent-soft:#55d6c0}*{box-sizing:border-box}body{margin:0;font:13px sans-serif;background:var(--bg-main);color:var(--text-primary)}.main-content{display:flex;flex-direction:column;height:780px;min-width:0}.analysis-context{display:flex;flex-wrap:wrap;padding:8px;gap:8px}.compare-body{flex:1;min-height:0;padding:20px}.compare-overview{padding:12px}</style><main class="main-content"><div class="analysis-context">共通の解析対象</div><div class="compare-body">波形領域（テスト用）</div><div class="compare-overview">全体ナビゲーター</div></main>');
        await page.addStyleTag({ path: path.resolve(__dirname, '../data-inspector.css') });
        await page.addScriptTag({ path: path.resolve(__dirname, '../data-quality-utils.js') });
        await page.addScriptTag({ path: path.resolve(__dirname, '../data-inspector.js') });
        await page.evaluate(() => {
            const timeData = Float64Array.from({ length: 250 }, (_, i) => i), sourceRowNumbers = Uint32Array.from({ length: 250 }, (_, i) => i + 3);
            const values = Float64Array.from({ length: 250 }, (_, i) => i * 2); values[2] = NaN; values[5] = NaN;
            const file = { name: '元ﾃﾞｰﾀ.csv', role: 'sub', offset: 5, timeData, sourceRowNumbers, headerInfo: { timeScale: 1 },
                columns: [{ id: 'signal', name: 'Signal', unit: 'kPa' }, { id: 'cross', name: '@Cross', unit: 'kPa', isCustom: true, isCrossFile: true }, { id: 'local', name: '@Local', unit: 'kPa', isCustom: true }],
                colData: { signal: values, cross: Float64Array.from(values, n => n - 1), local: Float64Array.from(values, n => n + 1) },
                importDiagnostics: { invalidTimeCount: 1, invalidTimeRows: [300], invalidTimeDetails: [{ sourceRow: 300, raw: '<img src=x onerror="window.injected=true">' }] },
                columnDiagnostics: { signal: { invalidValueCount: 1, invalidValueRows: [{ index: 2, sourceRow: 5, raw: '<img src=x onerror="window.injected=true">' }], missingCount: 1 } } };
            const state = { files: { file0: file }, customRAMs: [{ name: '@Cross', expr: 'Signal - s1:Signal' }] };
            const h = window.inspectorHarness = { state, file, names: ['Signal', '@Cross', '@Local'], context: { scope: 'all', range: [0, 300], rawTime: false, label: '全体 0–300 s · 時間合わせ後' }, renderCount: 0, resizeCount: 0, focus: [], loads: 0, loadGate: null };
            h.ui = CSVDataInspector.init({ state, mainFile: () => file, selectedNames: () => h.names, analysisContext: () => h.context,
                effectiveOffset: f => h.context.rawTime ? 0 : f.offset, resolveColumn: (f, name) => f.columns.find(c => c.name === name),
                loadColumns: async f => { h.loads++; if (h.loadGate) await h.loadGate; f.colData.signal ||= Float64Array.from(f.timeData, n => n * 2); },
                esc: x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
                save: () => {}, render: () => { h.renderCount++; h.ui?.schedule(); }, resize: () => h.resizeCount++, focusTime: t => h.focus.push(t) });
            h.ui.setOpen('data');
        });
        await page.waitForFunction(() => document.querySelectorAll('#inspector-sample-table tbody tr').length === 100);
        assert.equal(await page.locator('#inspector-sample-table tbody tr').first().locator('td').nth(1).textContent(), '0');
        assert.equal(await page.locator('#inspector-sample-table tbody tr').first().locator('td').nth(2).textContent(), '5');
        assert.match(await page.locator('#inspector-sample-table').textContent(), /変換不能: <img/);
        assert.equal(await page.locator('#data-inspector img').count(), 0);
        assert.equal(await page.evaluate(() => window.injected), undefined);
        await page.evaluate(() => inspectorHarness.ui.seekTime(158));
        assert.equal(await page.locator('#inspector-page').inputValue(), '2');
        assert.equal(await page.locator('.inspector-current').getAttribute('data-sample-index'), '153');
        assert.equal(await page.evaluate(() => inspectorHarness.ui.cursorTime()), 158);
        await page.evaluate(() => inspectorHarness.ui.seekTime(400));
        assert.match(await page.locator('#inspector-status').textContent(), /解析対象外/);
        await page.locator('#inspector-close').click();
        assert.equal(await page.evaluate(() => inspectorHarness.ui.cursorTime()), null);
        await openInspector(page, 'data');
        await page.waitForFunction(() => !document.querySelector('.inspector-current'));

        await page.evaluate(() => { const h = inspectorHarness; h.context = { ...h.context, rawTime: true, label: '全体 0–300 s · 元の時刻' }; h.ui.schedule(); });
        await page.waitForFunction(() => !document.querySelector('#inspector-sample-table thead')?.textContent.includes('@Cross'));
        assert.match(await page.locator('#inspector-content').textContent(), /時間合わせに依存する計算列/);
        await openInspector(page, 'quality');
        await page.waitForSelector('#inspector-quality-values');
        assert.match(await page.locator('#inspector-quality-issues').textContent(), /読込時に除外した時刻/);
        assert.equal(await page.locator('#data-inspector img').count(), 0);

        // In-place ms/s conversion must invalidate both the request key and time cache.
        await page.evaluate(() => { const h = inspectorHarness; for (let i = 0; i < h.file.timeData.length; i++) h.file.timeData[i] *= .001; h.file.headerInfo.timeScale = .001; h.ui.schedule(); });
        await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('0.001'));
        assert.doesNotMatch(await page.locator('#inspector-content').textContent(), /中央値 1 s/);

        // Outside-selection quality jumps keep the table range but expose a marker.
        await page.evaluate(() => { const h = inspectorHarness; h.file.timeData[200] = h.file.timeData[190]; h.file.importDiagnostics = { ...h.file.importDiagnostics };
            h.context = { scope: 'selection', range: [0, .1], rawTime: true, label: '選択区間 0–0.1 s · 元の時刻' }; h.ui.schedule(); });
        await page.getByRole('button', { name: '波形へ', exact: true }).first().waitFor();
        await page.getByRole('button', { name: '波形へ', exact: true }).first().click();
        assert.equal(await page.evaluate(() => inspectorHarness.ui.cursorTime()), .19);
        assert.deepEqual(await page.evaluate(() => inspectorHarness.context.range), [0, .1]);
        assert.match(await page.locator('#inspector-status').textContent(), /表は共通/);

        // A newer range wins when asynchronous loading completes out of order.
        await page.evaluate(() => { const h = inspectorHarness; delete h.file.colData.signal; h.loadGate = new Promise(resolve => { h.release = resolve; }); h.ui.setOpen('data'); });
        await page.waitForFunction(() => inspectorHarness.loads > 0);
        await page.evaluate(() => { const h = inspectorHarness; h.context = { ...h.context, range: [.02, .04], label: '選択区間 0.02–0.04 s · 元の時刻' }; h.ui.schedule(); });
        await page.evaluate(() => inspectorHarness.release());
        await page.waitForFunction(() => document.querySelectorAll('#inspector-sample-table tbody tr').length === 21);
        assert.equal(await page.locator('#inspector-sample-table tbody tr').first().locator('td').nth(1).textContent(), '0.02');
        // Finishing a raw-column load after changing tabs must not replace statistics.
        const loadCount = await page.evaluate(() => inspectorHarness.loads);
        await page.evaluate(() => {
            const h = inspectorHarness; delete h.file.colData.signal;
            h.loadGate = new Promise(resolve => { h.release = resolve; }); h.ui.setOpen('quality');
        });
        await page.waitForFunction(previous => inspectorHarness.loads > previous, loadCount);
        await page.evaluate(() => inspectorHarness.ui.setOpen('stats'));
        await page.locator('#inspector-statistics').waitFor();
        await page.evaluate(() => inspectorHarness.release());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#inspector-tab-stats').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#inspector-statistics').count(), 1);
        assert.equal(await page.locator('#inspector-sample-table').count(), 0);
        await page.evaluate(() => inspectorHarness.ui.setOpen('data'));
        await page.waitForFunction(() => document.querySelectorAll('#inspector-sample-table tbody tr').length === 21);
        assert.deepEqual(await page.evaluate(() => Object.keys(inspectorHarness.ui.collectSettings()).sort()), ['fileKey', 'fileName', 'open', 'tab']);
        const calls = await page.evaluate(() => inspectorHarness.renderCount);
        await page.waitForTimeout(100);
        assert.ok((await page.evaluate(() => inspectorHarness.renderCount)) - calls < 3, 'no schedule/render loop');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.cssText = '--bg-main:#fff;--bg-surface:#f7f9fb;--bg-hover:#e8f1f7;--border:#bfccd9;--text-primary:#182838;--text-secondary:#4a6074;--accent-soft:#00685c'; });
        await openInspector(page, 'quality');
        await page.waitForSelector('#inspector-quality-values');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390px body must not overflow horizontally');
        const screenshot = path.join(os.tmpdir(), 'csv-data-inspector-390-light.png'); await page.screenshot({ path: screenshot });
        console.log('Screenshot: ' + screenshot);
        assert.deepEqual(errors, []);
        console.log('data-inspector harness: pagination, original/shifted values, escaping, cursor, raw exclusions, in-place time-scale cache, outside-scope jump, async generation, 390px passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
