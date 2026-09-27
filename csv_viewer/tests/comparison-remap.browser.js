'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const errors = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const shifts = [0, 2, -3], pressures = ['Pressure', 'Press_Actual', 'Pressure_C'], states = ['State', 'Status_B', 'Switch_C'];
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        for (let n = 0; n < 3; n++) {
            const rows = [`Time,${pressures[n]},${states[n]}`, 's,kPa,'];
            for (let i = 0; i <= 200; i++) rows.push(`${i / 10 + shifts[n]},${Math.sin(i / 20) + n * 10},${i >= 100 ? 1 : 0}`);
            await page.locator('#file-input').setInputFiles({ name: `Mapped${n}.csv`, mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
            await page.waitForFunction(n => Object.keys(window.__csvViewerDebug.state.files).length === n, n + 1);
        }
        for (const name of [pressures[0], states[0]]) {
            await page.locator('#column-search').fill(name);
            await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        }
        await page.locator('#column-search').fill('');
        const ids = await page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files));
        for (let n = 1; n < 3; n++) {
            await page.locator('#compare-sub').selectOption(ids[n]);
            await page.locator('[data-map-index="0"]').selectOption(pressures[n]);
            await page.locator('[data-map-index="1"]').selectOption(states[n]);
            await page.locator('#compare-map-apply').click();
            await page.locator(`[data-offset-id="${ids[n]}"]`).fill(String(-shifts[n]));
            await page.locator(`[data-offset-id="${ids[n]}"]`).press('Tab');
        }
        await page.waitForFunction(() => window.__csvViewerDebug.state.chart.getOption().series.filter(s => s.type === 'line').length === 6);
        // Exercise settings keyed by the original physical column name as well.
        await page.evaluate(() => {
            const s = window.__csvViewerDebug.state;
            s.comparison.searchAliases.Pressure = '圧力';
            s.comparison.tolerances.Pressure = 5;
            s.yRanges.Pressure = { min: '-5', max: '35' };
            s.channelLineWidths.Pressure = 2;
        });
        const groupIds = await page.evaluate(() => window.__csvViewerDebug.state.chartGroups.map(g => g.id));
        const check = async (n, preserveIds = true) => {
            await page.waitForFunction(({ name, pressure, status }) => {
                const s = window.__csvViewerDebug.state;
                return Object.values(s.files).find(f => f.role === 'main')?.name === name &&
                    s.selectedNames.has(pressure) && s.selectedNames.has(status) &&
                    s.chart.getOption().series.filter(x => x.type === 'line').length === 6;
            }, { name: `Mapped${n}.csv`, pressure: pressures[n], status: states[n] });
            const snapshot = await page.evaluate(({ pressure, status }) => {
                const s = window.__csvViewerDebug.state;
                return { files: Object.values(s.files).map(f => ({ name: f.name, offset: f.offset })), groups: s.chartGroups,
                    alias: s.comparison.searchAliases[pressure], tolerance: s.comparison.tolerances[pressure],
                    range: s.yRanges[pressure], width: s.channelLineWidths[pressure], bit: s.bitChannels.has(status) };
            }, { pressure: pressures[n], status: states[n] });
            if (preserveIds) assert.deepEqual(snapshot.groups.map(g => g.id), groupIds);
            assert.deepEqual(snapshot.groups.map(g => g.channels[0].name), [pressures[n], states[n]]);
            assert.deepEqual(snapshot.groups.map(g => g.axes[0].representative), [pressures[n], states[n]]);
            assert.equal(snapshot.alias, '圧力'); assert.equal(snapshot.tolerance, 5); assert.equal(snapshot.width, 2);
            assert.deepEqual(snapshot.range, { min: '-5', max: '35' }); assert.equal(snapshot.bit, true);
            snapshot.files.forEach(f => assert.equal(f.offset, shifts[n] - shifts[Number(f.name[6])]));
            await page.locator('[data-view="diff"]').click();
            await page.waitForFunction(() => window.__csvViewerDebug.state.chart.getOption().series.filter(s => s.id.startsWith('compare-diff')).length === 4);
            const diff = await page.evaluate(pressure => window.__csvViewerDebug.state.chart.getOption().series
                .filter(s => s.id.startsWith('compare-diff') && s.name.includes(pressure)).map(s => s.data.filter(p => p[1] != null).map(p => p[1])), pressures[n]);
            assert.equal(diff.length, 2);
            assert.deepEqual(diff.map(values => Math.round(values[0])).sort((a, b) => a - b), [0, 1, 2].filter(i => i !== n).map(i => (n - i) * 10).sort((a, b) => a - b));
            diff.forEach(values => { assert.ok(values.length >= 190); assert.ok(values.every(value => Math.abs(value - values[0]) < 1e-5)); });
            await page.locator('[data-view="overlay"]').click();
        };
        await check(0);
        for (const n of [1, 2, 0]) { await page.locator(`[data-roleid="${ids[n]}"]`).click(); await check(n); }
        // Undo and session restore must retain the bidirectional channel mapping.
        await page.locator(`[data-roleid="${ids[1]}"]`).click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.selectedNames.has('Press_Actual'));
        await page.locator('#undo-btn').click(); await check(0, false);
        await page.locator(`[data-roleid="${ids[1]}"]`).click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.selectedNames.has('Press_Actual'));
        await page.reload(); await check(1, false);
        await context.close();

        const second = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        const ambiguous = await second.newPage();
        ambiguous.on('pageerror', error => errors.push(error.message));
        await ambiguous.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        for (const [i, data] of ['Time,A,B\ns,kPa,kPa\n0,2,5\n1,3,6\n2,4,7', 'Time,C\ns,kPa\n0,2\n1,3\n2,4'].entries()) {
            await ambiguous.locator('#file-input').setInputFiles({ name: `Many${i}.csv`, mimeType: 'text/csv', buffer: Buffer.from(data) });
            await ambiguous.waitForFunction(count => Object.keys(window.__csvViewerDebug.state.files).length === count, i + 1);
        }
        for (const name of ['A', 'B']) { await ambiguous.locator('#column-search').fill(name); await ambiguous.locator(`[data-channel="${name}"] .col-item-top`).click(); }
        await ambiguous.locator('#column-search').fill('');
        await ambiguous.waitForFunction(() => document.querySelectorAll('[data-map-index]').length === 2);
        await ambiguous.locator('[data-map-index="0"]').selectOption('C');
        await ambiguous.locator('[data-map-index="1"]').selectOption('C');
        await ambiguous.locator('#compare-map-apply').click();
        await ambiguous.waitForFunction(() => {
            const map = window.__csvViewerDebug.state.comparison.matches['Many1.csv'];
            return map?.A === 'C' && map?.B === 'C';
        });
        const newId = await ambiguous.evaluate(() => Object.keys(window.__csvViewerDebug.state.files)[1]);
        await ambiguous.locator(`[data-roleid="${newId}"]`).click();
        await ambiguous.waitForFunction(() => window.__csvViewerDebug.state.selectedNames.has('C'));
        assert.deepEqual(await ambiguous.evaluate(() => ({ selected: [...window.__csvViewerDebug.state.selectedNames], map: window.__csvViewerDebug.state.comparison.matches['Many0.csv'].C })), { selected: ['C'], map: '' });
        await ambiguous.getByText('チャンネル対応を確認してください', { exact: true }).waitFor();
        await second.close();
        assert.deepEqual(errors, []);
        console.log('Three renamed files: all Main switches, offsets, six overlays/four differences, metadata, undo, reload and ambiguous mapping passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
