'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const blockedRequests = [], errors = [];
    await context.route(/^https?:\/\//, route => { blockedRequests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const root = path.resolve(__dirname, '..');
    const evidenceDir = path.join(root, 'validation');
    fs.mkdirSync(evidenceDir, { recursive: true });
    try {
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => !!window.__csvViewerDebug);
        assert.equal(await page.evaluate(() => echarts.version), '6.1.0');
        const rows = ['Time  Actual Speed  Engine RPM', 's     km/h          rpm',
            '0.0  0.5  500', '0.1 -0.5  500', '0.2  0.5  500', '0.3\t\t500', '0.4\t-1.25D-02\t500'];
        for (let i = 5; i < 12000; i++) rows.push(`${i / 10} ${Math.sin(i / 80) * 0.5} ${500 + i % 100}`);
        await page.locator('#file-input').setInputFiles({ name: 'synthetic-speed.trn', mimeType: 'text/plain', buffer: Buffer.from(rows.join('\n')) });
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 1 && window.__csvViewerDebug.state.parseJobs.size === 0);
        for (const name of ['Actual Speed', 'Engine RPM']) {
            await page.locator('#column-search').fill(name);
            await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        }
        await page.locator('#column-search').fill('');
        await page.waitForFunction(() => window.__csvViewerDebug.state.numGrids === 2 && window.__csvViewerDebug.state.parseJobs.size === 0);
        const main = await page.evaluate(() => {
            const d = window.__csvViewerDebug, state = d.state, file = Object.values(state.files)[0];
            const col = file.columns.find(c => c.name === 'Actual Speed'), values = file.colData[col.id];
            const png = d.getChartImageDataURL();
            const pixel = state.chart.convertToPixel({ seriesIndex: 0 }, [0.1, -0.5]);
            return { firstFive: Array.from(values.slice(0, 5)), count: values.length,
                max: Math.max(...Array.from(values).filter(Number.isFinite)), pngBytes: png.length,
                isPng: png.startsWith('data:image/png;base64,'), pixel,
                grids: state.chart.getOption().grid.length };
        });
        assert.deepEqual(main.firstFive.slice(0, 3), [0.5, -0.5, 0.5]);
        assert.ok(Number.isNaN(main.firstFive[3]));
        assert.ok(Math.abs(main.firstFive[4] + 0.0125) < 1e-8);
        assert.equal(main.count, 12000); assert.ok(main.max <= 0.500001);
        assert.ok(main.isPng && main.pngBytes > 1000); assert.ok(main.pixel.every(Number.isFinite));
        await page.evaluate(() => window.__csvViewerDebug.state.chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 1 }));
        await page.screenshot({ path: path.join(evidenceDir, 'vendor-compat-main.png') });
        await page.evaluate(() => window.__csvViewerDebug.showXYPlotModal());
        await page.waitForFunction(() => {
            const el = document.querySelector('#xy-chart'), c = el && echarts.getInstanceByDom(el);
            return c && c.getOption().series.length > 0;
        });
        const xy = await page.evaluate(() => {
            const chart = echarts.getInstanceByDom(document.querySelector('#xy-chart'));
            const option = chart.getOption();
            chart.dispatchAction({ type: 'dataZoom', start: 10, end: 90 });
            return { type: option.series[0].type, points: option.series[0].data.length,
                pngBytes: chart.getDataURL({ type: 'png' }).length };
        });
        assert.equal(xy.type, 'scatter'); assert.ok(xy.points > 5000 && xy.pngBytes > 1000);
        await page.screenshot({ path: path.join(evidenceDir, 'vendor-compat-xy.png') });
        await page.locator('.xy-modal .modal-close-btn').click();
        assert.equal(await page.locator('#xy-chart').count(), 0);
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => window.__csvViewerDebug.state.chart.getWidth() > 0);
        assert.deepEqual(errors, []);
        assert.deepEqual(blockedRequests, []);
        const report = { echarts: '6.1.0', main, xy, pageErrors: errors, blockedHttpRequests: blockedRequests.length };
        fs.writeFileSync(path.join(evidenceDir, 'vendor-compat-browser.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
        console.log('vendor-compat browser passed');
    } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
