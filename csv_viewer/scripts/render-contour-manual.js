'use strict';
// Render actual chart options for the manual without opening the application.
// Requires sharp in NODE_PATH. This image is a chart export, not a UI screenshot.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const hash = name => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
(async () => {
    execFileSync(process.execPath, ['tests/xy-workspace-render.test.js', '--artifacts'], { cwd: root, stdio: 'inherit' });
    const svg = fs.readFileSync(path.join(root, 'tests/fixtures/generated/contour-detail/light-lines-1100.svg'));
    const image = 'docs/images/fuel-map-detail.png';
    await sharp(svg).png().toFile(path.join(root, image));
    fs.writeFileSync(path.join(root, 'docs/images/contour-render-manifest.json'), JSON.stringify({
        generatedAt: new Date().toISOString(), renderer: 'ECharts ' + require('../lib/echarts.min.js').version + ' SVG SSR + sharp',
        source: 'Actual CSVXYWorkspace chart options on a DOM mock; synthetic background only; not a browser/UI screenshot.',
        sample: 'docs/samples/練習用_詳細燃費率ﾏｯﾌﾟ.csv', style: 'lines', contourStep: 5, theme: 'light', width: 1100, height: 650,
        sourceHashes: Object.fromEntries(['xy-workspace.js', 'xy-layout.js', 'xy-utils.js', 'fuel-map-utils.js', 'tests/xy-workspace.test.js', 'tests/xy-workspace-render.test.js', 'docs/samples/練習用_詳細燃費率ﾏｯﾌﾟ.csv'].map(name => [name, hash(name)])),
        image, imageSha256: hash(image)
    }, null, 2) + '\n');
    console.log(image);
})().catch(error => { console.error(error); process.exitCode = 1; });
