'use strict';
// Browser integration contracts for the docked XY / fuel-map workspace.
// Pure parsing and sampling boundaries are covered by fuel-map-utils.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'fixtures/generated/xy-workspace');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const csv = (name, value) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(value) });
function drivingFile(name, shift = 0, torqueDelta = 0, torqueUnit = 'Nm') {
    const rows = ['Time,Engine_Speed,Engine_Torque,Fuel_Rate,Actual_Speed,Temp,Lazy,sfc_ne,sfc_te,sfc_g_kwh',
        `s,rpm,${torqueUnit},L/h,km/h,degC,degC,rpm,Nm,g/kWh`];
    for (let i = 0; i <= 20; i++) {
        const ne = i === 7 ? '' : 1000 + i * 50;
        rows.push([i + shift, ne, 20 + (i % 5) * 10 + torqueDelta, 2 + i / 10, 40, 20 + i,
            100 + i, 1000 + (i % 3) * 400, 30 + (Math.floor(i / 3) % 3) * 30, 240 + i % 9].join(','));
    }
    return csv(name, rows.join('\n'));
}
const primary = drivingFile('synthetic-map-main.csv');
const comparison = drivingFile('synthetic-map-comparison.csv', 2, 5);
const matrix = csv('synthetic-background.csv', 'rpm\\Nm,1000,1500,2000\n20,250,,280\n40,240,230,260\n60,260,250,270\n');
const duplicateLong = csv('synthetic-duplicate-map.csv', 'x,y,z\nrpm,Nm,g/kWh\n1000,20,200\n1000,20,300\n2000,20,280\n1000,60,260\n2000,60,270\n');
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const loaded = (page, count) => page.waitForFunction(count => Object.keys(__csvViewerDebug.state.files).length === count
    && !__csvViewerDebug.state.parseJobs.size, count);
async function selectChannel(page, name) {
    if (!await page.locator('#column-search').isVisible()) await page.locator('#workspace-sidebar-toggle').click();
    await page.locator('#column-search').fill(name);
    const row = page.locator(`[data-channel="${name}"] .col-item-top`);
    if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
    await page.locator('#column-search').fill('');
    await page.waitForFunction(() => !__csvViewerDebug.state.parseJobs.size);
    if (page.viewportSize().width <= 760) await page.locator('#workspace-sidebar-close').click();
}
async function openXY(page) {
    if (!await page.locator('#xy-workspace').isVisible()) await page.locator('#xy-panel-toggle').click();
    await page.locator('#xy-workspace').waitFor({ state: 'visible' });
    await ready(page);
}
async function ready(page) {
    await page.waitForFunction(() => {
        const view = __csvViewerDebug.xyWorkspace?.inspect();
        return view?.chart && view.renderCount > 0 && !view.busy && !__csvViewerDebug.state.parseJobs.size
            && !document.getElementById('xy-data-count').textContent.includes('読み込み・集計中');
    });
    await settle(page);
}
const inspect = page => page.evaluate(() => {
    const view = __csvViewerDebug.xyWorkspace.inspect();
    return { visible: view.visible, expanded: view.expanded, mode: view.mode,
        renderCount: view.renderCount, cursorUpdateCount: view.cursorUpdateCount, contourBuildCount: view.contourBuildCount,
        cursorPoints: view.cursorPoints,
        map: view.map ? { xs: view.map.xs, ys: view.map.ys, zz: view.map.zz, stats: view.map.stats } : null };
});
const pointSeries = page => page.evaluate(() => {
    const chart = __csvViewerDebug.xyWorkspace.inspect().chart;
    return (chart.getOption().series || []).filter(s => String(s.id).startsWith('xy-points-'))
        .map(s => ({ id: s.id, data: s.data.map(p => ({ fileId: p.fileId, value: p.value || p })) }));
});
async function choose(page, id, value) {
    if (await page.locator('#' + id).inputValue() === value) { await ready(page); return; }
    await mapSettings(page);
    await page.locator('#' + id).selectOption(value);
    await settle(page);
    await ready(page);
}
async function uploadMap(page, file, format = 'matrix') {
    await mapSettings(page);
    await page.locator('#xy-map-style').selectOption('fill');
    await page.locator('#xy-map-source').selectOption('external');
    await page.locator('#xy-map-format').selectOption(format);
    await page.locator('#xy-map-file').setInputFiles(file);
    await page.locator('#xy-map-confirm-units').check();
    await page.locator('#xy-map-apply').click();
    await page.waitForFunction(name => __csvViewerDebug.xyWorkspace.inspect().lastResult?.backgroundName === name
        && !!__csvViewerDebug.xyWorkspace.inspect().map, file.name);
    await settle(page);
}
async function mapSettings(page) {
    const settings = page.locator('#xy-map-settings');
    if (await settings.count() && !await settings.evaluate(el => el.open)) await settings.locator(':scope > summary').click();
}
async function colorLimit(page, id, value) {
    await mapSettings(page);
    await page.locator('#' + id).fill(value);
    await page.locator('#' + id).press('Tab');
    await settle(page); await ready(page);
}
const mapColors = page => page.evaluate(() => {
    const chart = __csvViewerDebug.xyWorkspace.inspect().chart, options = chart.getOption();
    const index = options.series.findIndex(series => series.id === 'xy-map-cells');
    const rendered = chart.getModel().getSeriesByIndex(index).getData();
    return { min: options.visualMap[0].min, max: options.visualMap[0].max,
        cells: options.series[index].data.map((item, i) => ({
            actual: (item.value || item)[4], color: rendered.getItemVisual(i, 'style').fill,
        })) };
});
async function holdNextParse(page) {
    await page.evaluate(() => {
        const original = Papa.parse;
        Papa.parse = function(input, options) {
            Papa.parse = original;
            window.__xyHeldParse = () => original.call(Papa, input, options);
        };
    });
}
async function releaseParse(page) {
    await page.evaluate(() => { const release = window.__xyHeldParse; delete window.__xyHeldParse; release(); });
    await page.waitForFunction(() => !__csvViewerDebug.state.parseJobs.size); await settle(page);
}
async function clickDataPoint(page, seriesIndex = 0, pointIndex = 3) {
    const target = await page.evaluate(({ seriesIndex, pointIndex }) => {
        const view = __csvViewerDebug.xyWorkspace.inspect(), chart = view.chart;
        const series = chart.getOption().series.filter(s => String(s.id).startsWith('xy-points-'))[seriesIndex];
        const point = series.data[pointIndex], value = point.value || point;
        const pixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, value.slice(0, 2));
        const rect = document.getElementById('xy-chart').getBoundingClientRect();
        return { x: rect.x + pixel[0], y: rect.y + pixel[1], value, fileId: point.fileId };
    }, { seriesIndex, pointIndex });
    await page.mouse.click(target.x, target.y); await settle(page);
    return target;
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const errors = [], requests = [], checks = [];
    async function open(viewport = { width: 1600, height: 1000 }, settings) {
        const context = await browser.newContext({ viewport, acceptDownloads: true });
        if (settings) await context.addInitScript(value => localStorage.setItem('csvViewer_settings', JSON.stringify(value)), settings);
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
        await page.goto(url); await page.waitForFunction(() => !!window.__csvViewerDebug?.xyWorkspace);
        return { context, page };
    }
    async function setup(page, sub = true) {
        await page.locator('#file-input').setInputFiles(primary); await loaded(page, 1);
        if (sub) { await page.locator('#file-input').setInputFiles(comparison); await loaded(page, 2); }
        await selectChannel(page, 'Engine_Speed');
        await page.locator('#analysis-scope').selectOption('all');
        await openXY(page);
        await choose(page, 'xy-x-select', 'Engine_Speed');
        await choose(page, 'xy-y-select', 'Engine_Torque');
    }
    try {
        const workspace = await open(), page = workspace.page;
        await setup(page);
        assert.equal(await page.locator('.xy-modal').count(), 0, 'XY now uses the workspace rather than another modal');
        assert.equal(await page.locator('#chart').isVisible(), true);
        assert.equal(await page.locator('#compare-panel').isVisible(), false);
        assert.equal((await pointSeries(page)).length, 2);
        assert.ok((await pointSeries(page)).every(s => s.data.length === 20), 'Only missing coordinate is excluded');
        await choose(page, 'xy-z-select', 'Temp');
        let points = await pointSeries(page);
        assert.deepEqual(points[0].data[3].value.slice(0, 6), [1150, 50, 23, 3, 3, 3]);
        assert.ok(await page.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().chart.getOption().visualMap.length > 0));
        checks.push('docked XY, multiple files and third-signal coloring retain raw index/time');

        // Existing panel drafts remain intact while switching the auxiliary panel.
        await page.locator('#compare-panel-toggle').click();
        await page.locator('[data-pane="notes"]').click();
        await page.locator('#compare-note-text').fill('未保存の比較メモを保持');
        await openXY(page);
        await page.locator('#compare-panel-toggle').click();
        assert.equal(await page.locator('#compare-note-text').inputValue(), '未保存の比較メモを保持');
        await openXY(page);
        await page.locator('#xy-expand-btn').click(); await settle(page);
        assert.equal((await inspect(page)).expanded, true);
        assert.equal(page.url(), url, 'Expansion stays on the same page');
        await page.locator('#xy-expand-btn').focus(); await page.keyboard.press('Escape'); await settle(page);
        assert.equal((await inspect(page)).expanded, false, 'Escape restores docked size before closing');
        checks.push('comparison draft survives switching and expansion stays in the same workspace');

        const clicked = await clickDataPoint(page);
        assert.equal(clicked.value[3], 3);
        assert.deepEqual(await page.evaluate(() => __csvViewerDebug.getXYFocus()), {
            fileId: clicked.fileId, index: clicked.value[3], time: clicked.value[4], displayTime: clicked.value[5],
        });
        assert.ok(await page.evaluate(() => __csvViewerDebug.state.chart.getOption().series.some(s => String(s.id).startsWith('xy-focus-'))));
        assert.match(await page.locator('#xy-cursor-status').innerText(), /3(?:\.0+)?\s*s/);
        const beforeCursor = await inspect(page);
        const wave = await page.evaluate(() => {
            const { state } = __csvViewerDebug, box = document.querySelector('#chart canvas').getBoundingClientRect();
            return { x: box.x + state.chart.convertToPixel({ xAxisIndex: 0 }, 5), y: box.y + state.gridRegions[0].top + 50 };
        });
        await page.mouse.move(wave.x, wave.y); await settle(page);
        const afterCursor = await inspect(page);
        assert.equal(afterCursor.renderCount, beforeCursor.renderCount, 'Pointer movement must not rebuild the whole scatter/map');
        assert.ok(afterCursor.cursorUpdateCount > beforeCursor.cursorUpdateCount);
        assert.ok(afterCursor.cursorPoints.length > 0, 'Waveform linking displays the independent cursor overlay');
        assert.ok(await page.locator('#xy-cursor-overlay .xy-cursor-marker:visible').count() > 0);
        assert.match(await page.locator('#xy-cursor-status').innerText(), /5(?:\.0+)?\s*s/);
        checks.push('actual scatter click links to time and waveform cursor updates the independent DOM overlay');

        await choose(page, 'xy-mode', 'map');
        await page.waitForFunction(() => !!__csvViewerDebug.xyWorkspace.inspect().map);
        const background = (await inspect(page)).map;
        assert.equal(background.stats.eligible, 21, 'GT SFC map includes all eligible source rows');
        await page.evaluate(() => __csvViewerDebug.selectAnalysisRange([3, 6]));
        await page.waitForFunction(() => __csvViewerDebug.getAnalysisContext().scope === 'selection');
        await ready(page);
        points = await pointSeries(page);
        assert.equal(points[0].data.length, 4);
        assert.deepEqual((await inspect(page)).map, background, 'Selecting a driving interval must not cut the background map');
        assert.match(await page.locator('#xy-analysis-context').innerText(), /3\s*[–−-]\s*6/);
        await page.locator('.offset-input').fill('-2'); await page.locator('.offset-input').press('Tab'); await ready(page);
        points = await pointSeries(page);
        assert.deepEqual(points[0].data.map(p => p.value[3]), points[1].data.map(p => p.value[3]));
        await page.locator('#compare-raw').check(); await ready(page);
        points = await pointSeries(page);
        assert.notEqual(points[0].data[0].value[3], points[1].data[0].value[3]);
        assert.match(await page.locator('#xy-analysis-context').innerText(), /元の時刻/);
        checks.push('GT SFC background is independent of selection; points honor raw/aligned time basis');

        await uploadMap(page, matrix);
        let map = (await inspect(page)).map;
        assert.equal(map.xs.length, 3); assert.equal(map.ys.length, 3);
        assert.equal(map.stats.emptyCells, 1); assert.ok(Number.isNaN(map.zz[0][1]), 'Missing cell remains missing, not zero');
        await mapSettings(page);
        const mapBounds = () => page.evaluate(() => {
            const o = __csvViewerDebug.xyWorkspace.inspect().chart.getOption();
            return [o.xAxis[0].min, o.xAxis[0].max, o.yAxis[0].min, o.yAxis[0].max];
        });
        const fullMapBounds = await mapBounds();
        await choose(page, 'xy-map-style', 'both');
        await colorLimit(page, 'xy-map-contour-step', '5');
        assert.ok(await page.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().chart.getOption().series
            .some(series => String(series.id).startsWith('xy-contour-') && series.type === 'line' && series.data.length)), 'Detailed contour geometry reaches ECharts');
        const contoursBuilt = (await inspect(page)).contourBuildCount;
        await choose(page, 'xy-map-style', 'lines');
        assert.ok(await page.evaluate(() => {
            const o = __csvViewerDebug.xyWorkspace.inspect().chart.getOption();
            return !o.series.some(series => series.id === 'xy-map-cells') && o.visualMap.length === 0;
        }), 'Line-only mode has no cell-color mapping to contaminate point colors');
        assert.deepEqual(await mapBounds(), fullMapBounds, 'The three background representations use the same map domain');
        assert.equal((await inspect(page)).contourBuildCount, contoursBuilt, 'Style-only changes reuse contour geometry');
        assert.ok((await pointSeries(page)).some(series => series.data.length), 'Operating points remain visible over contours');
        assert.equal(await page.locator('#xy-map-zoom-btn').getAttribute('aria-pressed'), 'false');
        await page.locator('#xy-map-zoom-btn').click(); await settle(page);
        assert.equal(await page.locator('#xy-map-zoom-btn').getAttribute('aria-pressed'), 'true');
        const zoomProbe = await page.evaluate(() => {
            const chart = __csvViewerDebug.xyWorkspace.inspect().chart, option = chart.getOption();
            const center = [option.xAxis[0], option.yAxis[0]].map(axis => (axis.min + axis.max) / 2);
            const value = [option.xAxis[0], option.yAxis[0]].map(axis => axis.min + (axis.max - axis.min) * 0.75);
            const pixel = chart.convertToPixel({ gridIndex: 0 }, center), box = document.getElementById('xy-chart').getBoundingClientRect();
            return { x: box.x + pixel[0], y: box.y + pixel[1], value, before: chart.convertToPixel({ gridIndex: 0 }, value) };
        });
        await page.mouse.move(zoomProbe.x, zoomProbe.y); await page.mouse.wheel(0, -400); await settle(page);
        const wheelZoom = await page.evaluate(value => {
            const chart = __csvViewerDebug.xyWorkspace.inspect().chart;
            return { ranges: chart.getOption().dataZoom.map(item => [item.start, item.end]), pixel: chart.convertToPixel({ gridIndex: 0 }, value) };
        }, zoomProbe.value);
        assert.ok(wheelZoom.ranges.every(([start, end]) => end - start < 100), 'Actual wheel input zooms both axes after enabling zoom');
        assert.ok(wheelZoom.pixel.every((pixel, index) => Math.abs(pixel - zoomProbe.before[index]) > 0.5), 'Wheel input changes the displayed coordinate transforms');
        await page.locator('#xy-map-reset-view').click(); await settle(page);
        assert.ok(await page.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().chart.getOption().dataZoom.every(item => item.start === 0 && item.end === 100)), 'Reset restores the complete map after explicit zoom');
        assert.equal(await page.locator('#xy-map-zoom-btn').getAttribute('aria-pressed'), 'false');
        await mapSettings(page); await choose(page, 'xy-map-style', 'both');
        assert.deepEqual(await mapBounds(), fullMapBounds);
        const mapWave = await page.evaluate(() => {
            const chart = __csvViewerDebug.xyWorkspace.inspect().chart;
            const cells = chart.getOption().series.find(series => series.id === 'xy-map-cells'), original = cells.renderItem;
            window.__xyBackgroundPaints = 0;
            chart.setOption({ series: [{ id: cells.id, renderItem(...args) { window.__xyBackgroundPaints++; return original(...args); } }] });
            window.__xyBackgroundPaints = 0;
            const { state } = __csvViewerDebug, box = document.querySelector('#chart canvas').getBoundingClientRect();
            return { x: box.x + state.chart.convertToPixel({ xAxisIndex: 0 }, 5), y: box.y + state.gridRegions[0].top + 50 };
        });
        await page.mouse.move(mapWave.x - 1, mapWave.y); await page.mouse.move(mapWave.x, mapWave.y); await settle(page);
        assert.equal(await page.evaluate(() => window.__xyBackgroundPaints), 0, 'Waveform pointer movement does not rerun background cell renderers');
        checks.push('detailed contours, stable bounds, retained points, real wheel zoom/reset and zero background paints on waveform pointer movement');
        await uploadMap(page, duplicateLong, 'long');
        map = (await inspect(page)).map;
        assert.equal(map.zz[0][0], 250, 'Duplicate map coordinates use all observations');
        assert.equal(map.stats.duplicatePoints, 1);
        await uploadMap(page, matrix);
        await mapSettings(page);
        await page.locator('#xy-map-clear').click(); await settle(page);
        assert.equal((await inspect(page)).map, null);
        await page.locator('#xy-map-file').setInputFiles(matrix);
        await page.locator('#xy-map-confirm-units').uncheck();
        if (await page.locator('#xy-map-apply').isEnabled()) await page.locator('#xy-map-apply').click();
        await settle(page);
        assert.equal((await inspect(page)).map, null, 'External map needs explicit unit confirmation');
        await page.locator('#xy-map-file').setInputFiles(csv('synthetic-wrong-map-units.csv',
            'rpm\\lb-ft,1000,1500,2000\n20,250,260,280\n40,240,230,260\n'));
        await page.locator('#xy-map-confirm-units').check(); await page.locator('#xy-map-apply').click(); await settle(page);
        assert.equal((await inspect(page)).map, null, 'A checkbox cannot override contradictory units written in the CSV');
        assert.match(await page.locator('#xy-map-status').innerText(), /単位|lb-ft|Nm/);
        checks.push('external matrix/triples, missing cells, duplicate means and explicit units');

        await page.locator('#xy-map-format').selectOption('long');
        const huge = 'x,y,z\n' + Array.from({ length: 201 }, (_, i) => `${1000 + i},${i},250`).join('\n');
        await page.locator('#xy-map-file').setInputFiles(csv('synthetic-grid-limit.csv', huge));
        await page.locator('#xy-map-confirm-units').check();
        await page.locator('#xy-map-apply').click(); await settle(page);
        assert.equal((await inspect(page)).map, null);
        assert.match(await page.locator('#xy-map-status').innerText(), /上限|格子|セル|40,?000/);
        await uploadMap(page, matrix);
        const originalGrid = (await inspect(page)).map;
        await colorLimit(page, 'xy-map-color-min', '240');
        await colorLimit(page, 'xy-map-color-max', '260');
        let colors = await mapColors(page);
        assert.equal(colors.min, 240); assert.equal(colors.max, 260);
        const cellColor = value => colors.cells.find(cell => cell.actual === value).color;
        assert.equal(cellColor(230), cellColor(240), 'Below-range values use the lower endpoint color');
        assert.equal(cellColor(280), cellColor(260), 'Above-range values use the upper endpoint color');
        assert.notEqual(cellColor(240), cellColor(260));
        assert.deepEqual((await inspect(page)).map, originalGrid, 'Display limits must not modify original map values or holes');
        assert.match(await page.locator('#xy-map-status').innerText(), /端色|値を保持/);
        await colorLimit(page, 'xy-map-color-min', '');
        await colorLimit(page, 'xy-map-color-max', '');
        colors = await mapColors(page);
        assert.equal(colors.min, 230); assert.equal(colors.max, 280, 'Blank limits restore the full original value range');
        await colorLimit(page, 'xy-map-color-min', '300');
        assert.match(await page.locator('#xy-map-status').innerText(), /下限|上限|範囲/);
        assert.equal(await page.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().lastResult), null);
        assert.equal(await page.evaluate(() => (__csvViewerDebug.xyWorkspace.inspect().chart.getOption().series || []).length), 0,
            'Invalid display range must clear the previous result instead of leaving stale colors');
        await colorLimit(page, 'xy-map-color-min', '240');
        await colorLimit(page, 'xy-map-color-max', '260');
        assert.deepEqual((await inspect(page)).map, originalGrid, 'Recovering a valid range uses unchanged background data');
        await page.locator('#xy-map-settings > summary').click();
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.waitForTimeout(300);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('csvViewer_settings')));
        assert.ok(!JSON.stringify(saved).includes('"zz"'), 'External map arrays must not enter settings/localStorage');
        await page.reload(); await page.waitForFunction(() => !!window.__csvViewerDebug?.xyWorkspace); await loaded(page, 2);
        await openXY(page);
        assert.equal((await inspect(page)).map, null, 'External map is not silently restored as an old result');
        assert.match(await page.locator('#xy-map-status').innerText(), /読込|読み込|選択|外部|再/);
        await mapSettings(page);
        assert.equal(await page.locator('#xy-map-color-min').inputValue(), '240');
        assert.equal(await page.locator('#xy-map-color-max').inputValue(), '260');
        checks.push('grid guard, display-only color bounds and settings restore without serialized external values');

        const wrong = await open(), wp = wrong.page;
        await wp.locator('#file-input').setInputFiles(drivingFile('synthetic-wrong-torque.csv', 0, 0, '%')); await loaded(wp, 1);
        await selectChannel(wp, 'Engine_Speed'); await openXY(wp);
        await choose(wp, 'xy-x-select', 'Engine_Speed'); await choose(wp, 'xy-y-select', 'Engine_Torque');
        await choose(wp, 'xy-mode', 'map');
        await choose(wp, 'xy-y-select', 'Engine_Torque');
        assert.match(await wp.locator('#xy-point-status').innerText(), /単位|Nm|トルク|評価/);
        assert.equal(await wp.locator('#xy-point-status').isVisible(), true);
        assert.ok((await inspect(wp)).map, 'Valid SFC background survives a percent signal selected for operating-point torque');
        assert.ok((await pointSeries(wp)).every(s => s.data.length === 0));
        await uploadMap(wp, matrix);
        const independentBackground = (await inspect(wp)).map;
        assert.ok(independentBackground, 'Applying an external map with an incompatible Y axis still draws the background');
        assert.equal(await wp.locator('#xy-map-settings').evaluate(element => element.open), false);
        assert.equal(await wp.locator('#xy-point-status').isVisible(), true, 'The missing-torque explanation remains visible after apply closes settings');
        assert.match(await wp.locator('#xy-point-status').innerText(), /Nm|トルク/);
        assert.equal((await pointSeries(wp)).length, 0, 'A percent signal is never drawn against the Nm background');
        assert.ok(await wp.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().chart.getOption().series
            .some(series => series.id === 'xy-map-cells' && series.data.length > 0)), 'Background cells reach ECharts');
        await choose(wp, 'xy-y-select', 'sfc_te');
        assert.ok((await pointSeries(wp))[0].data.length > 0, 'Selecting a real Nm column restores operating points');
        assert.equal(await wp.locator('#xy-point-status').innerText(), '');
        assert.deepEqual((await inspect(wp)).map, independentBackground, 'Point-axis changes leave map values unchanged');
        await choose(wp, 'xy-mode', 'scatter');
        await choose(wp, 'xy-y-select', 'Engine_Torque');
        assert.ok((await pointSeries(wp))[0].data.length > 0, 'Scatter mode continues to allow a percent Y axis');
        await wrong.context.close(); checks.push('fuel-map backgrounds render independently; incompatible points explain requirements and resume with Nm');

        const delayed = await open(), dp = delayed.page;
        await setup(dp, false);
        await mapSettings(dp); await holdNextParse(dp); await dp.locator('#xy-z-select').selectOption('Lazy');
        await dp.waitForFunction(() => typeof window.__xyHeldParse === 'function');
        await dp.locator('#xy-close-btn').click(); await releaseParse(dp);
        assert.equal((await inspect(dp)).visible, false, 'Late data completion must not reopen the hidden panel');
        await openXY(dp);
        assert.equal((await pointSeries(dp))[0].data[0].value[2], 100, 'Reopening reads the latest draft and loaded data');
        await mapSettings(dp); await holdNextParse(dp); await dp.locator('#xy-z-select').selectOption('Temp');
        await dp.waitForFunction(() => typeof window.__xyHeldParse === 'function');
        await dp.locator('[data-cancel-job]').click(); await releaseParse(dp); await ready(dp);
        assert.match(await dp.locator('#xy-data-count').innerText(), /未完了|キャンセル|読み込/);
        assert.equal((await pointSeries(dp)).length, 0, 'Cancelled reads are not a completed zero-value series');
        await choose(dp, 'xy-z-select', ''); await choose(dp, 'xy-z-select', 'Temp');
        assert.equal((await pointSeries(dp))[0].data[0].value[2], 20);
        await choose(dp, 'xy-mode', 'map');
        await mapSettings(dp);
        await dp.locator('#xy-map-source').selectOption('external');
        await dp.evaluate(() => {
            const original = File.prototype.text;
            File.prototype.text = function() {
                File.prototype.text = original;
                return new Promise((resolve, reject) => { window.__xyHeldText = () => original.call(this).then(resolve, reject); });
            };
        });
        await dp.locator('#xy-map-file').setInputFiles(matrix);
        await dp.waitForFunction(() => typeof window.__xyHeldText === 'function');
        await dp.locator('#xy-map-clear').click();
        await dp.evaluate(() => { const release = window.__xyHeldText; delete window.__xyHeldText; release(); });
        await settle(dp);
        assert.equal((await inspect(dp)).map, null);
        assert.equal(await dp.locator('#xy-map-apply').isEnabled(), false, 'A cancelled file read cannot repopulate a pending map');
        await uploadMap(dp, matrix);
        await delayed.context.close(); checks.push('lazy-load close/cancel/retry and late external-file reads cannot revive old results');

        const changed = await open(), cp = changed.page;
        await setup(cp); await choose(cp, 'xy-mode', 'map');
        const originalBackground = await cp.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().lastResult.backgroundName);
        await cp.locator('.role-sub').click(); await ready(cp);
        const newBackground = await cp.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().lastResult.backgroundName);
        assert.notEqual(newBackground, originalBackground, 'The main-log map follows the actual reference log');
        const oldMainId = await cp.locator('.role-sub').getAttribute('data-roleid');
        await cp.locator(`.remove-file[data-fid="${oldMainId}"]`).click();
        await cp.locator('.destructive-confirm').click(); await loaded(cp, 1); await ready(cp);
        assert.equal((await pointSeries(cp)).length, 1);
        assert.ok(!(await pointSeries(cp)).some(series => series.id === 'xy-points-' + oldMainId));
        await changed.context.close(); checks.push('main-file switch and file removal refresh map provenance and point series');

        const mobileContext = await open({ width: 390, height: 844 }), mobile = mobileContext.page;
        await setup(mobile, false);
        await choose(mobile, 'xy-mode', 'map');
        await mobile.mouse.move(100, 20);
        await mobile.locator('#xy-expand-btn').click(); await settle(mobile);
        const overflow = await mobile.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth,
            panel: document.querySelector('#xy-workspace').scrollWidth - document.querySelector('#xy-workspace').clientWidth }));
        assert.ok(overflow.page <= 1 && overflow.panel <= 1, `390px overflow: ${JSON.stringify(overflow)}`);
        await mobile.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        await mobile.locator('#xy-close-btn').focus(); await mobile.keyboard.press('Enter'); await settle(mobile);
        assert.equal(await mobile.locator('#xy-workspace').isVisible(), false);
        assert.ok(await mobile.evaluate(() => document.activeElement && document.activeElement.getBoundingClientRect().width > 0), 'Closing restores visible focus');
        await mobileContext.context.close(); checks.push('390px layout and keyboard close with visible focus');

        if (process.env.CSV_GT_FIXTURE) {
            const fixture = path.resolve(process.env.CSV_GT_FIXTURE);
            const originalBytes = fs.readFileSync(fixture);
            const originalHash = createHash('sha256').update(originalBytes).digest('hex');
            // Independently count eligible raw SFC records instead of trusting the map's own counters.
            const rawLines = originalBytes.toString('utf8').split(/\r?\n/).filter(line => line.trim());
            const headerLine = rawLines.findIndex(line => /^\|\s+Time\s/.test(line));
            assert.ok(headerLine >= 0, 'The optional fixture must be a GT TRN file with a Time header');
            const rawHeaders = rawLines[headerLine].replace(/^\|\s*/, '').trim().split(/\s+/);
            const sfcIndices = ['sfc_ne', 'sfc_te', 'sfc_g_kwh'].map(name => rawHeaders.indexOf(name));
            assert.ok(sfcIndices.every(index => index >= 0));
            const rawRows = rawLines.slice(headerLine + 2).filter(line => !/^\s*\|/.test(line));
            const eligibleFromSource = rawRows.reduce((sum, line) => {
                const values = line.trim().split(/\s+/);
                const [rpm, torque, sfc] = sfcIndices.map(index => Number(values[index]));
                return sum + Number([rpm, torque, sfc].every(Number.isFinite) && rpm >= 0 && torque >= 0 && sfc > 0);
            }, 0);
            if (originalHash === '891916fa7892ace8b3274c402af144f108a4731ad280b32ca70df76c6b35fc9a') {
                assert.equal(eligibleFromSource, 13771, 'Verified unchanged GT reference fixture has 13,771 eligible SFC records');
            }
            const real = await open(), rp = real.page;
            await rp.locator('#file-input').setInputFiles(fixture); await loaded(rp, 1);
            await selectChannel(rp, 'Engine_Speed');
            await openXY(rp); await choose(rp, 'xy-mode', 'map');
            await rp.waitForFunction(() => !!__csvViewerDebug.xyWorkspace.inspect().map);
            const evidence = await rp.evaluate(() => ({
                rows: Object.values(__csvViewerDebug.state.files)[0].timeData.length,
                map: __csvViewerDebug.xyWorkspace.inspect().map.stats,
                grid: __csvViewerDebug.xyWorkspace.inspect().map,
            }));
            assert.equal(evidence.rows, rawRows.length);
            assert.ok(eligibleFromSource > 0);
            assert.equal(evidence.map.eligible, eligibleFromSource);
            assert.equal(evidence.grid.counts.flat().reduce((sum, count) => sum + count, 0), eligibleFromSource);
            assert.equal(createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'), originalHash);
            await rp.locator('#xy-chart').scrollIntoViewIfNeeded(); await settle(rp);
            await rp.screenshot({ path: path.join(output, 'real-gt.png'), fullPage: true });
            fs.writeFileSync(path.join(output, 'real-gt-compatibility.json'), JSON.stringify({
                fixture: path.basename(fixture), sourceUnchanged: true, sha256: originalHash,
                rows: evidence.rows, eligibleFromSource, map: evidence.map,
                scope: 'One existing GT fixture; parser/map compatibility only, not physical engine validation or a performance benchmark.',
            }, null, 2));
            fs.writeFileSync(path.join(output, 'real-gt-grid.json'), JSON.stringify({
                fixture: path.basename(fixture), sha256: originalHash, rpmStep: 400, torqueStep: 3,
                missingValue: 'Nonfinite grid values are serialized as null; no interpolation was applied.',
                grid: evidence.grid,
            }, null, 2));
            await colorLimit(rp, 'xy-map-color-min', '250');
            await colorLimit(rp, 'xy-map-color-max', '500');
            await choose(rp, 'xy-map-style', 'fill');
            const realColors = await mapColors(rp);
            assert.equal(realColors.min, 250); assert.equal(realColors.max, 500);
            assert.deepEqual(await rp.evaluate(() => __csvViewerDebug.xyWorkspace.inspect().map), evidence.grid,
                'A focused display scale must preserve every original GT map value and count');
            await rp.locator('#xy-map-settings > summary').click();
            await rp.locator('#xy-chart').scrollIntoViewIfNeeded(); await settle(rp);
            await rp.screenshot({ path: path.join(output, 'real-gt-color-range.png'), fullPage: true });
            await real.context.close(); checks.push('optional existing GT TRN compatibility with unchanged source hash');
        }

        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, errors, requests }, null, 2));
        console.log(`XY workspace browser passed: ${checks.length} integration groups; no errors or network requests.`);
        checks.forEach(check => console.log(`  PASS ${check}`));
    } catch (error) {
        for (const context of browser.contexts()) {
            const page = context.pages()[0];
            if (page) await page.screenshot({ path: path.join(output, `failure-${browser.contexts().indexOf(context)}.png`), fullPage: true }).catch(() => {});
        }
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
