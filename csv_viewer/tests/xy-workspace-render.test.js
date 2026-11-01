'use strict';
// Exercise the real workspace options in the bundled ECharts SVG renderer.
// This verifies chart output without opening a browser or a user session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../lib/echarts.min.js');
const { harness } = require('./xy-workspace.test.js');
const samplePath = path.resolve(__dirname, '../docs/samples/練習用_詳細燃費率ﾏｯﾌﾟ.csv');
const output = path.resolve(__dirname, 'fixtures/generated/contour-detail');

// Regression: INSPECTOR-XY-CURSOR — selecting a raw row left the XY cursor at the old waveform hover.
// Found by live Computer Use QA on 2026-11-02; docs/qa/2026-11-02/screenshots/028-raw-row-jump.jpg.
// Value: protects=one selected display time across raw data, waveform and XY; fails_when=app focus wiring skips XY;
// why_new=module cursor tests bypass inspector/app integration; seam=none; no_claim=browser click/layout (live QA).
async function inspectorCursorRegression() {
    const h = harness(), focused = [];
    const chart = E.init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 420 });
    h.globals.echarts = { init: () => chart, graphic: E.graphic };
    try {
        h.file.offset = 10;
        h.setContext({ scope: 'all', range: [10, 12], rawTime: false, label: '全体 10–12 s' });
        await h.open();
        await h.upload(fs.readFileSync(samplePath, 'utf8'), path.basename(samplePath));
        await h.change('xy-map-confirm-units', true); await h.apply();
        h.workspace.cursor(12); await h.flush();
        assert.equal(h.workspace.inspect().cursorPoints[0].time, 2);

        // Execute the production inspector registration and row-selection path together.
        // Only DOM rendering and the waveform viewport are replaced by test doubles.
        const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
        const start = app.indexOf('dataInspector = CSVDataInspector.init({');
        const end = app.indexOf('\n});', start) + '\n});'.length;
        assert.ok(start >= 0 && end > start);
        const inspector = fs.readFileSync(path.resolve(__dirname, '../data-inspector.js'), 'utf8');
        const context = vm.createContext({ CSVDataInspector: { init: api => api }, state: h.state,
            getMainFile: () => h.file, getAnalysisContext: () => ({ range: [10, 12] }),
            resolveColumnForFile: () => {}, esc: value => String(value), saveSettings: () => {}, renderChart: () => {},
            comparisonWorkspace: { focusTime: time => focused.push(time) }, xyWorkspace: h.workspace,
            snapshot: { file: h.file, fileId: 'main', offset: 10, indices: [0, 1, 2] }, cursor: null, page: 0, PAGE_SIZE: 100,
            setStatus: () => {}, renderTab: () => {}, revealSelectedRow: () => {}, sourceRow: (_, index) => index + 3,
            fmt: value => String(value),
        });
        vm.runInContext(app.slice(start, end), context);
        context.api = context.dataInspector;
        vm.runInContext(inspector.slice(inspector.indexOf('function positionOf('), inspector.indexOf('function nearestPosition(')), context);
        const renderCount = h.workspace.inspect().renderCount;
        let optionCalls = 0;
        const originalSetOption = chart.setOption;
        chart.setOption = (...args) => { optionCalls++; return originalSetOption.apply(chart, args); };
        assert.equal(context.selectSample(1), true);
        await h.flush(); chart._onframe();
        assert.deepEqual(focused, [11], 'Waveform navigation uses source time plus the file offset');
        assert.equal(context.cursor.index, 1, 'The selected raw row is retained');
        assert.equal(h.workspace.inspect().cursorPoints[0].time, 1, 'Raw row selection replaces the old XY cursor with the selected observed sample');
        assert.equal(h.workspace.inspect().cursorPoints[0].displayTime, 11);
        assert.match(h.get('xy-cursor-status').textContent, /カーソル 11 s/);
        assert.equal(h.workspace.inspect().renderCount, renderCount, 'Row navigation does not rebuild the XY plot');
        assert.equal(optionCalls, 0, 'Row navigation updates only the cursor overlay, without repainting the background');
    } finally { h.workspace.destroy(); chart.dispose(); }
}

async function cursorAndWheelRegression() {
    const h = harness();
    const chart = E.init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 420 });
    h.globals.echarts = { init: () => chart, graphic: E.graphic };
    try {
        await h.open();
        await h.upload(fs.readFileSync(samplePath, 'utf8'), path.basename(samplePath));
        await h.change('xy-map-confirm-units', true); await h.apply();
        h.resize('xy-chart', 640, 420); await h.flush();
        const position = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [2500, 100]);
        const probe = () => chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [4000, 160]);
        const fullScaleProbe = probe();
        const wheel = () => chart.getZr().handler.dispatch('mousewheel', {
            zrX: position[0], zrY: position[1], zrDelta: 1, preventDefault() {}, stopPropagation() {}
        });
        const ranges = () => chart.getOption().dataZoom.map(item => [item.start, item.end]);
        wheel();
        assert.ok(ranges().every(([start, end]) => start === 0 && end === 100), 'Wheel input is ignored until the user enables map zoom');
        await h.get('xy-map-zoom-btn').click();
        wheel(); await new Promise(resolve => setTimeout(resolve, 100)); await h.flush();
        assert.ok(ranges().every(([start, end]) => end - start < 100), 'Actual ZRender wheel input zooms both axes after OFF to ON; dispatchAction alone is insufficient evidence');
        assert.ok(probe().every((pixel, index) => Math.abs(pixel - fullScaleProbe[index]) > 0.5), 'Wheel input changes both real coordinate transforms, not only the stored start/end options');
        const zoomRanges = ranges(), zoomed = JSON.stringify(zoomRanges);

        let cellRenders = 0;
        const cells = chart.getOption().series.find(series => series.id === 'xy-map-cells'), originalRender = cells.renderItem;
        chart.setOption({ series: [{ id: cells.id, renderItem(...args) { cellRenders++; return originalRender(...args); } }] });
        assert.equal(cellRenders, 5743, 'The paint counter covers the complete valid background');
        cellRenders = 0;
        h.workspace.cursor(0); h.workspace.cursor(1); h.workspace.cursor(2);
        await h.flush(); chart._onframe();
        assert.equal(cellRenders, 0, 'Moving the waveform cursor must not repaint background cells');
        assert.equal(JSON.stringify(ranges()), zoomed, 'Waveform cursor movement preserves the user map zoom');
        const assertCursorPosition = () => {
            const point = h.workspace.inspect().cursorPoints[0];
            assert.ok(point, 'The nearest observed point is visible in the cursor overlay');
            const pixel = chart.convertToPixel({ gridIndex: 0 }, [point.x, point.y]);
            assert.deepEqual(Array.from(point.pixel), pixel, 'Cursor position comes from the actual ECharts coordinate transform');
            assert.equal(parseFloat(h.get('xy-cursor-main').style.left), pixel[0]);
            assert.equal(parseFloat(h.get('xy-cursor-main').style.top), pixel[1]);
        };
        assertCursorPosition();

        let resizeCalls = 0;
        const originalResize = chart.resize;
        chart.resize = (...args) => { resizeCalls++; return originalResize(...args); };
        for (let i = 0; i < 3; i++) h.resize('xy-chart', 640, 420);
        await h.flush(); chart._onframe();
        assert.equal(resizeCalls, 0, 'Repeated ResizeObserver notifications with the same dimensions do not resize ECharts');
        assert.equal(cellRenders, 0, 'Unchanged layout notifications do not repaint the background');
        h.resize('xy-chart', 720, 480); h.resize('xy-chart', 760, 500); await h.flush();
        assert.equal(resizeCalls, 1, 'A burst of real size changes uses the latest dimensions once per frame');
        assert.equal(chart.getWidth(), 760); assert.equal(chart.getHeight(), 500);
        assert.equal(JSON.stringify(ranges()), zoomed, 'Resizing the layout preserves actual map zoom');
        assertCursorPosition();
        cellRenders = 0;
        h.resize('xy-chart', 760, 500); h.workspace.cursor(1); await h.flush(); chart._onframe();
        assert.equal(resizeCalls, 1); assert.equal(cellRenders, 0, 'Cursor movement plus an unchanged resize notification causes no background paint');
        assertCursorPosition();

        chart.dispatchAction({ type: 'dataZoom', batch: ['x', 'y'].map(axis => ({ dataZoomId: 'xy-' + axis + '-zoom', start: 60, end: 90 })) });
        await h.flush();
        assert.equal(h.workspace.inspect().cursorPoints.length, 0, 'A measured point outside the zoomed plot is not displayed over labels or controls');
        assert.equal(h.get('xy-cursor-main').style.display, 'none');
        chart.dispatchAction({ type: 'dataZoom', batch: ['x', 'y'].map((axis, index) => ({ dataZoomId: 'xy-' + axis + '-zoom', start: zoomRanges[index][0], end: zoomRanges[index][1] })) });
        h.resize('xy-chart', 640, 420); await h.flush(); assertCursorPosition();

        await h.get('xy-map-reset-view').click();
        assert.ok(ranges().every(([start, end]) => start === 0 && end === 100));
        assert.ok(probe().every((pixel, index) => Math.abs(pixel - fullScaleProbe[index]) < 1e-6), 'Reset restores the coordinate transforms');
        wheel(); await new Promise(resolve => setTimeout(resolve, 100));
        assert.ok(ranges().every(([start, end]) => start === 0 && end === 100), 'Reset disables real wheel input again');
    } finally { h.workspace.destroy(); }
}

(async () => {
    const h = harness();
    delete h.state.files.main; // A background remains useful without operating-point data.
    h.globals.echarts.graphic = E.graphic;
    await h.open();
    await h.upload(fs.readFileSync(samplePath, 'utf8'), path.basename(samplePath));
    await h.change('xy-map-confirm-units', true); await h.apply();
    await h.change('xy-map-contour-step', '5');
    const originalMap = JSON.stringify(h.workspace.inspect().map);
    const artifacts = process.argv.includes('--artifacts');
    if (artifacts) fs.mkdirSync(output, { recursive: true });
    const results = [];
    for (const theme of ['dark', 'light']) {
        h.state.theme = theme; await h.redraw();
        for (const style of ['lines', 'both', 'fill']) {
            await h.change('xy-map-style', style);
            const options = h.chart.getOption();
            for (const width of [470, 1100]) {
                const chart = E.init(null, null, { renderer: 'svg', ssr: true, width, height: width === 470 ? 370 : 650 });
                try {
                    chart.setOption({ ...options, backgroundColor: theme === 'dark' ? '#171c26' : '#f5f8fc' });
                    const svg = chart.renderToSVGString();
                    assert.match(svg, /<svg/);
                    assert.ok(!svg.includes('NaN'), 'Every rendered coordinate is finite');
                    const effective = chart.getOption();
                    const cells = effective.series.find(series => series.id === 'xy-map-cells');
                    if (style === 'lines') {
                        assert.equal(cells, undefined, 'Contour-only output contains no hidden colored cells');
                        assert.equal(effective.visualMap.length, 0, 'The cell color mapping cannot affect lines');
                    } else assert.equal(cells.data.length, 5743, 'Missing cells are not painted');
                    if (style !== 'fill') {
                        const labels = effective.series.find(series => series.id === 'xy-contour-labels').data;
                        assert.ok(labels.length > 0 && labels.length <= 12);
                        assert.ok(labels.some(value => svg.includes('>' + value[2] + '</text>')), 'Major-line values actually render as text, even with a zero-size label symbol');
                        assert.equal(effective.series.filter(series => /^xy-contour-/.test(series.id) && series.type === 'line').length, 45);
                    }
                    chart.dispatchAction({ type: 'dataZoom', batch: ['x', 'y'].map(axis => ({ dataZoomId: 'xy-' + axis + '-zoom', start: 20, end: 80 })) });
                    assert.ok(chart.getOption().dataZoom.every(zoom => zoom.start === 20 && zoom.end === 80));
                    assert.ok(!chart.renderToSVGString().includes('NaN'));
                    chart.dispatchAction({ type: 'dataZoom', batch: ['x', 'y'].map(axis => ({ dataZoomId: 'xy-' + axis + '-zoom', start: 0, end: 100 })) });
                    assert.ok(chart.getOption().dataZoom.every(zoom => zoom.start === 0 && zoom.end === 100));
                    if (artifacts) fs.writeFileSync(path.join(output, `${theme}-${style}-${width}.svg`), svg);
                    results.push({ theme, style, width, series: effective.series.length });
                } finally { chart.dispose(); }
            }
        }
    }
    assert.equal(JSON.stringify(h.workspace.inspect().map), originalMap, 'Rendering and zooming do not change source grid values or missing cells');
    h.workspace.destroy();
    await inspectorCursorRegression();
    await cursorAndWheelRegression();
    if (artifacts) fs.writeFileSync(path.join(output, 'render-results.json'), JSON.stringify({ renderer: 'ECharts ' + E.version + ' SVG SSR', browserTest: false, results }, null, 2) + '\n');
    console.log('xy-workspace-render: real ECharts SVG, labels/gaps, wheel opt-in/reset and zero background repaints during cursor movement passed (no browser)');
})().catch(error => { console.error(error); process.exitCode = 1; });
