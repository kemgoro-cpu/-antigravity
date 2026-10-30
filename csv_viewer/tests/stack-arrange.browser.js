/* Stacked charts reorder by their original chart group. Offline synthetic UI regressions. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const output = process.env.CSV_STACK_REPORT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'csv-stack-arrange-'));
    fs.mkdirSync(output, { recursive: true });
    const results = [];
    const channels = ['Speed', 'RPM', 'Load'];
    function fixture(index, names = channels) {
        const units = { Speed: 'km/h', RPM: 'rpm', Load: '%' };
        const rows = [['Time', ...names].join(','), ['s', ...names.map(n => units[n])].join(',')];
        for (let i = 0; i <= 100; i++) {
            const values = { Speed: 20 + index * 2 + Math.sin(i / 10) * 10, RPM: 1000 + index * 100 + 8 * i, Load: 30 + index + Math.cos(i / 7) * 15 };
            rows.push([i, ...names.map(n => values[n])].join(','));
        }
        return { name: `synthetic-stack-${index}.csv`, mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) };
    }
    const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const groups = page => page.evaluate(() => window.__csvViewerDebug.state.chartGroups.map(g => ({ id: g.id, names: g.channels.map(c => c.name) })));
    const order = async page => (await groups(page)).map(g => g.names.join(' / '));
    const mode = page => page.evaluate(() => ({ arrange: window.__csvViewerDebug.state.arrangeMode, view: window.__csvViewerDebug.state.comparison.view }));
    async function select(page, name, wanted = true) {
        await page.locator('#column-search').fill(name);
        const row = page.locator(`[data-channel="${name}"] .col-item-top`);
        if ((await row.getAttribute('aria-pressed') === 'true') !== wanted) await row.click();
        await page.locator('#column-search').fill('');
        await settle(page);
    }
    async function openTools(page) {
        if (!await page.locator('.compare-tools').evaluate(el => el.open)) await page.locator('.compare-tools > summary').click();
    }
    async function arrange(page) {
        await openTools(page);
        assert.equal(await page.locator('#arrange-mode-btn').isEnabled(), true, 'multiple original groups are movable in stack view');
        await page.locator('#arrange-mode-btn').click();
        await page.locator('.chart-arrange-panel').first().waitFor();
    }
    async function view(page, value) {
        await page.locator(`[data-view="${value}"]`).click();
        await settle(page);
    }
    const panel = (page, id) => page.locator(`.chart-arrange-panel[data-source-group-id="${id}"]`);
    async function drag(page, fromId, toId, after = true) {
        const target = panel(page, toId), box = await target.boundingBox();
        assert.ok(box, 'destination group is rendered');
        await panel(page, fromId).locator('.chart-arrange-handle').dragTo(target, { targetPosition: { x: Math.min(230, box.width / 2), y: after ? box.height - 10 : 10 } });
        await settle(page);
    }
    const sourceValues = page => page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(f => ({
        name: f.name, offset: f.offset, time: Array.from(f.timeData),
        columns: f.columns.filter(c => f.colData[c.id]).map(c => ({ name: c.name, values: Array.from(f.colData[c.id]) })).sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.name.localeCompare(b.name)));
    const rendered = page => page.evaluate(() => {
        const s = window.__csvViewerDebug.state, option = s.chart.getOption();
        const blocks = [];
        s.gridRegions.forEach((region, index) => {
            const id = region.sourceGroupId;
            let block = blocks[blocks.length - 1];
            if (!block || block.id !== id) blocks.push(block = { id, names: s.chartGroups.find(g => g.id === id)?.channels.map(c => c.name), rows: [] });
            block.rows.push(option.series.filter(line => line.type === 'line' && line.xAxisIndex === index && !(line.id || '').startsWith('event-'))
                .map(line => ({ name: line.name, data: line.data })));
        });
        return blocks;
    });
    function assertSameBlocks(before, after) {
        assert.equal(new Set(after.map(b => b.id)).size, after.length, 'rows of each original chart stay contiguous');
        assert.deepEqual([...after].sort((a, b) => a.id.localeCompare(b.id)), [...before].sort((a, b) => a.id.localeCompare(b.id)), 'each group retains its per-file row order, series order and numerical values');
    }
    async function assertPanels(page, expectedRows) {
        const panels = await page.locator('.chart-arrange-panel').evaluateAll(items => items.map(el => ({ id: el.dataset.sourceGroupId, rows: Number(el.dataset.rowCount), top: parseFloat(el.style.top), height: parseFloat(el.style.height) })));
        assert.deepEqual(panels.map(p => p.rows), expectedRows);
        const regions = await page.evaluate(() => window.__csvViewerDebug.state.gridRegions);
        for (const p of panels) {
            const rows = regions.filter(r => r.sourceGroupId === p.id);
            assert.equal(p.top, rows[0].top);
            assert.equal(p.height, rows.at(-1).top + rows.at(-1).height - rows[0].top, 'drag panel spans the entire original group including its internal row gaps');
        }
    }
    async function check(name, config, run) {
        if (process.env.CSV_STACK_CASE_FILTER && !name.includes(process.env.CSV_STACK_CASE_FILTER)) return;
        const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
        await context.route(/^https?:\/\//, route => route.abort());
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
            for (const [index, names] of (config.files || [channels, channels]).entries()) {
                await page.locator('#file-input').setInputFiles(fixture(index, names));
                await page.waitForFunction(count => Object.keys(window.__csvViewerDebug.state.files).length === count && !window.__csvViewerDebug.state.parseJobs.size, index + 1);
            }
            for (const name of config.selected || channels) await select(page, name);
            await settle(page);
            await run(page);
            assert.deepEqual(errors, []);
            results.push({ name, status: 'PASS', finalOrder: await order(page) });
        } catch (error) {
            results.push({ name, status: 'FAIL', error: error.stack, state: await mode(page).catch(() => null), groups: await groups(page).catch(() => null), pageErrors: errors });
            await page.screenshot({ path: path.join(output, `failure-${results.length}.png`), fullPage: true }).catch(() => {});
        } finally { await context.close(); }
    }
    try {
        await check('Single file: ordinary overlay charts remain reorderable with unchanged values', { files: [channels] }, async page => {
            const original = await groups(page), before = await rendered(page), values = await sourceValues(page);
            assert.equal((await mode(page)).view, 'overlay');
            await arrange(page); await assertPanels(page, [1, 1, 1]);
            await drag(page, original[0].id, original[2].id);
            assert.deepEqual(await order(page), ['RPM', 'Load', 'Speed']);
            assertSameBlocks(before, await rendered(page));
            assert.deepEqual(await sourceValues(page), values);
            await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
            assert.equal(await page.locator('[data-view="stack"]').isDisabled(), true);
        });
        await check('Two files: whole pairs move down/up repeatedly; exit and view changes retain order', {}, async page => {
            await view(page, 'stack');
            const before = await rendered(page), values = await sourceValues(page), original = await groups(page);
            assert.deepEqual(before.map(b => b.rows.length), [2, 2, 2]);
            await arrange(page); await assertPanels(page, [2, 2, 2]);
            await drag(page, original[0].id, original[2].id);
            assert.deepEqual(await order(page), ['RPM', 'Load', 'Speed']);
            assertSameBlocks(before, await rendered(page));
            await drag(page, original[0].id, original[1].id, false);
            assert.deepEqual(await order(page), ['Speed', 'RPM', 'Load']);
            await drag(page, original[1].id, original[2].id);
            assert.deepEqual(await order(page), ['Speed', 'Load', 'RPM']);
            await openTools(page); await page.locator('#arrange-mode-btn').click();
            assert.equal((await mode(page)).arrange, false);
            assert.equal(await page.locator('.chart-arrange-panel').count(), 0);
            await arrange(page); await page.keyboard.press('Escape');
            assert.equal((await mode(page)).arrange, false);
            await arrange(page); await view(page, 'overlay');
            assert.equal((await mode(page)).arrange, false);
            assert.deepEqual(await order(page), ['Speed', 'Load', 'RPM']);
            await view(page, 'diff'); await openTools(page);
            assert.equal(await page.locator('#arrange-mode-btn').isDisabled(), true);
            await page.keyboard.press('Escape');
            await view(page, 'stack');
            assertSameBlocks(before, await rendered(page));
            assert.deepEqual(await sourceValues(page), values);
        });
        await check('Three files and missing channels: variable-size groups preserve file order, offsets and values', { files: [channels, ['Speed', 'Load'], ['Speed', 'RPM']] }, async page => {
            const ids = await page.evaluate(() => Object.keys(window.__csvViewerDebug.state.files));
            for (const [id, offset] of [[ids[1], '1.5'], [ids[2], '-2']]) {
                await page.locator(`[data-offset-id="${id}"]`).fill(offset);
                await page.locator(`[data-offset-id="${id}"]`).press('Tab');
            }
            await view(page, 'stack');
            const before = await rendered(page), values = await sourceValues(page), original = await groups(page);
            assert.deepEqual(before.map(b => b.rows.length), [3, 2, 2]);
            await arrange(page); await assertPanels(page, [3, 2, 2]);
            await page.screenshot({ path: path.join(output, 'stack-groups-before.png') });
            await drag(page, original[2].id, original[0].id, false);
            assert.deepEqual(await order(page), ['Load', 'Speed', 'RPM']);
            await assertPanels(page, [2, 3, 2]);
            await page.screenshot({ path: path.join(output, 'stack-groups-after.png') });
            assertSameBlocks(before, await rendered(page));
            await drag(page, original[0].id, original[1].id);
            assert.deepEqual(await order(page), ['Load', 'RPM', 'Speed']);
            assertSameBlocks(before, await rendered(page));
            assert.deepEqual(await sourceValues(page), values);
        });
        await check('Hidden cross-file custom group: displayed indices never reorder the hidden original group', { selected: [] }, async page => {
            // Use the existing public debug API only to prepare a derived-channel fixture.
            await page.evaluate(() => window.__csvViewerDebug.addCustomRAM('Delta', 'Speed - s1:Speed', 'km/h'));
            await select(page, '@Delta'); await select(page, 'Speed'); await select(page, 'RPM');
            const original = await groups(page);
            assert.deepEqual(original.map(g => g.names[0]), ['@Delta', 'Speed', 'RPM']);
            await page.locator('#compare-raw').check();
            await view(page, 'stack');
            const before = await rendered(page);
            assert.deepEqual(before.map(b => b.id), [original[1].id, original[2].id]);
            await arrange(page); await assertPanels(page, [2, 2]);
            await drag(page, original[2].id, original[1].id, false);
            assert.deepEqual(await order(page), ['@Delta', 'RPM', 'Speed']);
            assertSameBlocks(before, await rendered(page));
            await page.keyboard.press('Escape');
            await page.locator('#compare-raw').uncheck();
            assert.deepEqual(await order(page), ['@Delta', 'RPM', 'Speed']);
        });
        await check('Merged multichannel chart: all file rows and channel assignments travel together', {}, async page => {
            const target = await page.evaluate(() => { const r = window.__csvViewerDebug.state.gridRegions.find(r => r.name === 'RPM'); return { x: 200, y: r.top + r.height / 2 }; });
            await page.locator('[data-channel="Speed"]').dragTo(page.locator('#chart'), { targetPosition: target });
            await page.waitForFunction(() => window.__csvViewerDebug.state.chartGroups.some(g => g.channels.length === 2));
            const original = await groups(page), merged = original.find(g => g.names.includes('Speed')), single = original.find(g => g.names.length === 1);
            const assignments = await page.evaluate(() => window.__csvViewerDebug.state.chartGroups.map(g => ({ id: g.id, channels: g.channels, axes: g.axes })));
            await view(page, 'stack');
            const before = await rendered(page), values = await sourceValues(page);
            await arrange(page); await assertPanels(page, [2, 2]);
            await drag(page, merged.id, single.id);
            assert.equal((await groups(page)).at(-1).id, merged.id);
            assertSameBlocks(before, await rendered(page));
            const after = await page.evaluate(() => window.__csvViewerDebug.state.chartGroups.map(g => ({ id: g.id, channels: g.channels, axes: g.axes })));
            assert.deepEqual(after.sort((a, b) => a.id.localeCompare(b.id)), assignments.sort((a, b) => a.id.localeCompare(b.id)));
            assert.deepEqual(await sourceValues(page), values);
        });
        await check('One source group across three files is not reorderable; adding/removing a group updates availability', { files: [channels, channels, channels], selected: ['Speed'] }, async page => {
            await view(page, 'stack'); await openTools(page);
            assert.equal(await page.locator('#arrange-mode-btn').isDisabled(), true);
            assert.equal((await rendered(page))[0].rows.length, 3);
            await page.keyboard.press('Escape');
            await select(page, 'RPM'); await arrange(page); await assertPanels(page, [3, 3]);
            await select(page, 'RPM', false);
            assert.equal((await mode(page)).arrange, false);
            await openTools(page);
            assert.equal(await page.locator('#arrange-mode-btn').isDisabled(), true);
            assert.equal(await page.locator('.chart-arrange-panel').count(), 0);
            await page.keyboard.press('Escape');
            await select(page, 'Speed', false); await openTools(page);
            assert.equal(await page.locator('#arrange-mode-btn').isDisabled(), true);
            assert.equal(await page.evaluate(() => window.__csvViewerDebug.state.numGrids), 0);
        });
        await check('Raw-time toggle hides every derived group while arranging and leaves no stale drag panels', { selected: [] }, async page => {
            await page.evaluate(async () => {
                await window.__csvViewerDebug.addCustomRAM('Delta', 'Speed - s1:Speed', 'km/h');
                await window.__csvViewerDebug.addCustomRAM('Sum', 'Speed + s1:Speed', 'km/h');
            });
            await select(page, '@Delta'); await select(page, '@Sum');
            await view(page, 'stack'); await arrange(page); await assertPanels(page, [1, 1]);
            await page.locator('#compare-raw').check(); await settle(page);
            assert.equal(await page.evaluate(() => window.__csvViewerDebug.state.numGrids), 0);
            assert.equal((await mode(page)).arrange, false);
            assert.equal(await page.locator('.chart-arrange-panel').count(), 0);
            await openTools(page); assert.equal(await page.locator('#arrange-mode-btn').isDisabled(), true);
            await page.keyboard.press('Escape');
            await page.locator('#compare-raw').uncheck(); await settle(page);
            await arrange(page); await assertPanels(page, [1, 1]);
            await page.keyboard.press('Escape');
        });
        await check('Reorder participates in Undo/Redo and persists through reload', {}, async page => {
            await view(page, 'stack');
            const original = await groups(page), before = await rendered(page);
            await arrange(page); await drag(page, original[0].id, original[2].id);
            await page.keyboard.press('Escape');
            assert.deepEqual(await order(page), ['RPM', 'Load', 'Speed']);
            await page.locator('#undo-btn').click();
            await page.waitForFunction(() => window.__csvViewerDebug.state.chartGroups.map(g => g.channels[0].name).join(',') === 'Speed,RPM,Load');
            await page.locator('#redo-btn').click();
            await page.waitForFunction(() => window.__csvViewerDebug.state.chartGroups.map(g => g.channels[0].name).join(',') === 'RPM,Load,Speed');
            await page.waitForTimeout(650); // Existing settings save debounce is 500 ms.
            await page.reload();
            await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 2 && !window.__csvViewerDebug.state.parseJobs.size && window.__csvViewerDebug.state.numGrids === 6);
            assert.deepEqual(await order(page), ['RPM', 'Load', 'Speed']);
            assert.equal((await mode(page)).view, 'stack');
            assert.equal((await mode(page)).arrange, false);
            // Session restoration regenerates chart/column IDs by design; verify
            // semantic groups and every rendered value instead of old runtime IDs.
            const semantic = blocks => blocks.map(({ id, ...block }) => block).sort((a, b) => a.names.join(' / ').localeCompare(b.names.join(' / ')));
            assert.deepEqual(semantic(await rendered(page)), semantic(before));
            await arrange(page); await assertPanels(page, [2, 2, 2]);
            await page.keyboard.press('Escape');
        });
    } finally { await browser.close(); }
    const report = { source: path.resolve(__dirname, '..'), synthetic: true, results, passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('Stack arrange regression artifacts:', output);
    process.exitCode = report.failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
