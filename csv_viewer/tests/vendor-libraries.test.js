'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const E = require('../lib/echarts.min.js');
const Papa = require('../lib/papaparse.min.js');
const CO = require('../chart-options-utils.js');
const root = path.resolve(__dirname, '..');
const manifest = require('../lib/vendor-manifest.json');

for (const pkg of manifest.packages) {
    for (const file of pkg.files) {
        const bytes = fs.readFileSync(path.join(root, file.path));
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
}
assert.equal(E.version, '6.1.0');
assert.match(fs.readFileSync(path.join(root, 'lib/papaparse.min.js'), 'utf8').slice(0, 300), /v5\.7\.0/);
vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/echarts-theme-v5.js'), 'utf8'), { echarts: E });

const csv = Papa.parse('\uFEFFTime;Speed;Label\r\ns;km/h;text\r\n0;-0.5;"a;b"\r\n0.1;0;test', { skipEmptyLines: true });
assert.equal(csv.meta.delimiter, ';');
assert.deepEqual(csv.errors, []);
assert.deepEqual(csv.data[2], ['0', '-0.5', 'a;b']);
let steps = 0, completions = 0, aborted = false;
Papa.parse('0,-0.5\n1,0\n2,0.5', {
    step(result, parser) { assert.equal(result.data.length, 2); if (++steps === 2) parser.abort(); },
    complete(result) { completions++; aborted = result.meta.aborted; },
});
assert.equal(steps, 2);
assert.equal(completions, 1);
assert.equal(aborted, true);

const data = Array.from({ length: 12000 }, (_, i) => [i / 10, Math.sin(i / 80) * 0.5]);
const chart = E.init(null, 'v5', { renderer: 'svg', ssr: true, width: 1000, height: 400 });
try {
    chart.setOption({
        ...CO.buildBaseChartOption({}),
        grid: { left: 70, right: 70, top: 40, bottom: 50, outerBoundsMode: 'none' },
        xAxis: { type: 'value', nameMoveOverlap: false },
        yAxis: [{ type: 'value', nameMoveOverlap: false }, { type: 'value', nameMoveOverlap: false }],
        dataZoom: [{ type: 'inside', xAxisIndex: 0 }],
        series: [CO.buildSeriesOption({ id: 'speed', label: 'Speed', color: '#2563eb', data }, {
            xAxisIndex: 0, yAxisIndex: 0, isFirstForAxis: true,
            axisSpec: { hasYMin: false, hasYMax: false },
            sampling: 'lttb', showMarkers: false, lineWidth: 1, labelFontSize: 12,
        }), { id: 'xy', type: 'scatter', yAxisIndex: 1, data: [[0, -0.5], [1, 0], [2, 0.5]] }],
    });
    const processed = chart.getModel().getSeriesByIndex(0).getData();
    assert.ok(processed.count() < data.length);
    for (let i = 0; i < processed.count(); i++) assert.ok(Math.abs(processed.get(processed.mapDimension('y'), i)) <= 0.500001);
    assert.ok(chart.convertToPixel({ seriesIndex: 1 }, [1, 0]).every(Number.isFinite));
    chart.dispatchAction({ type: 'dataZoom', start: 10, end: 90 });
    const svg = chart.renderToSVGString();
    assert.match(svg, /<svg/);
    assert.ok(!svg.includes('NaN'));
} finally { chart.dispose(); }
console.log('vendor-libraries tests passed (versions, integrity, parser streaming, v5 theme, LTTB, axes, zoom, scatter, SVG)');
