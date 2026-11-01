'use strict';
// Exercise the real workspace options in the bundled ECharts SVG renderer.
// This verifies chart output without opening a browser or a user session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../lib/echarts.min.js');
const { harness } = require('./xy-workspace.test.js');
const samplePath = path.resolve(__dirname, '../docs/samples/練習用_詳細燃費率ﾏｯﾌﾟ.csv');
const output = path.resolve(__dirname, 'fixtures/generated/contour-detail');

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
    if (artifacts) fs.writeFileSync(path.join(output, 'render-results.json'), JSON.stringify({ renderer: 'ECharts ' + E.version + ' SVG SSR', browserTest: false, results }, null, 2) + '\n');
    console.log('xy-workspace-render: real ECharts SVG, 3 styles, 2 themes, 2 widths, labels, gaps and zoom/reset passed (no browser)');
})().catch(error => { console.error(error); process.exitCode = 1; });
