'use strict';
// Real-file browser checks against known synthetic answers, including missing data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.join(__dirname, 'fixtures/generated');
const out = path.join(root, 'results');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scenario = manifest.scenarios.find(s => s.name === 'edge');
const report = { startedAt: new Date().toISOString(), browser: 'Microsoft Edge headless', scenario: 'edge', status: 'running', files: scenario.files, checks: [], errors: [] };
fs.mkdirSync(out, { recursive: true });
function check(name, fn) {
    try { fn(); report.checks.push({ name, status: 'passed' }); }
    catch (e) { report.checks.push({ name, status: 'failed', error: e.message }); }
}
(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => report.errors.push(e.stack));
    try {
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.locator('#file-input').setInputFiles(scenario.files.map(f => f.path));
        await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 5 && window.__csvViewerDebug.state.parseJobs.size === 0);
        const idFor = name => page.evaluate(name => Object.keys(window.__csvViewerDebug.state.files).find(id => window.__csvViewerDebug.state.files[id].name === name), name);
        await page.locator(`[data-roleid="${await idFor(scenario.files[0].name)}"]`).click();
        for (const name of ['Pressure', 'Temperature', 'State']) {
            await page.locator('#column-search').fill(name);
            const row = page.locator(`[data-channel="${name}"] .col-item-top`);
            await row.waitFor();
            if (await row.getAttribute('aria-pressed') !== 'true') await row.click();
        }
        await page.locator('#column-search').fill('');
        await page.waitForFunction(() => window.__csvViewerDebug.state.chart.getOption().series.filter(s => s.type === 'line').length === 13);
        for (const file of scenario.files.slice(1)) {
            const input = page.locator(`[data-offset-id="${await idFor(file.name)}"]`);
            await input.fill(String(file.expectedOffsetFromFirst));
            await input.press('Tab');
        }
        await page.locator('#compare-range-all').click();
        await page.locator('[data-view="diff"]').click();
        await page.waitForFunction(() => window.__csvViewerDebug.state.chart.getOption().series.filter(s => s.id.startsWith('compare-diff')).length === 10);
        report.differenceSeries = await page.evaluate(() => window.__csvViewerDebug.state.chart.getOption().series.filter(s => s.id.startsWith('compare-diff')).map(s => {
            let min = Infinity, max = -Infinity, valid = 0, missing = 0;
            for (const p of s.data) { if (p[1] == null) { missing++; continue; } min = Math.min(min, p[1]); max = Math.max(max, p[1]); valid++; }
            return { name: s.name, min, max, valid, missing };
        }));
        check('Difference plot excludes missing Pressure column and Pa/kPa mismatch', () => {
            assert.equal(report.differenceSeries.length, 10);
            assert.equal(report.differenceSeries.filter(s => s.name.startsWith('Pressure')).length, 2);
        });
        for (const series of report.differenceSeries) {
            const file = scenario.files.find(f => series.name.includes(f.name) && f.index !== 0);
            const channel = series.name.split(' ')[0];
            check(`Difference values ${channel} / ${file?.name}`, () => {
                assert.ok(file, 'series target must be identifiable');
                assert.ok(series.valid > 0);
                const expected = file.expectedMainMinusSubFromFirst[channel];
                const tolerance = manifest.numericTolerance[channel] || 1e-6;
                assert.ok(Math.abs(series.min - expected) < tolerance && Math.abs(series.max - expected) < tolerance, `expected ${expected}, actual [${series.min}, ${series.max}]`);
            });
        }
        await page.locator('[data-pane="results"]').click();
        await page.locator('#compare-calculate').click();
        await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 12);
        report.rows = await page.locator('.compare-result').evaluateAll(els => els.map(el => ({
            title: el.querySelector('button').textContent,
            reason: el.querySelector('.compare-warning')?.textContent || '',
            values: Object.fromEntries([...el.querySelectorAll('dl>div')].map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])),
        })));
        await page.screenshot({ path: path.join(out, 'edge-differences.png') });
        await page.locator('#compare-results-list').screenshot({ path: path.join(out, 'edge-results.png') });
        check('All four Sub files have a result for all three channels', () => assert.equal(report.rows.length, 12));
        for (const file of scenario.files.slice(1)) {
            for (const channel of ['Pressure', 'Temperature', 'State']) {
                const row = report.rows.find(r => r.title.startsWith(channel) && r.title.includes(file.name));
                check(`Comparison result ${channel} / ${file.name}`, () => {
                    assert.ok(row);
                    if (channel === 'Pressure' && file.index === 1) { assert.equal(row.reason, '未対応・データなし'); return; }
                    if (channel === 'Pressure' && file.index === 3) { assert.equal(row.reason, '単位不一致'); return; }
                    assert.equal(row.reason, '');
                    const expected = file.expectedMainMinusSubFromFirst[channel];
                    assert.ok(Math.abs(parseFloat(row.values['最大絶対差']) - Math.abs(expected)) < 1e-6);
                    const [mean, rms] = row.values['平均差 / RMS差'].split('/').map(Number);
                    assert.ok(Math.abs(mean - expected) < 1e-6 && Math.abs(rms - Math.abs(expected)) < 1e-6);
                    const [valid, missing] = row.values['有効 / 欠損・範囲外'].split('/').map(Number);
                    const expectedMissing = file.missingCounts[channel] || 0;
                    assert.equal(missing, expectedMissing, `missing samples: expected ${expectedMissing}, actual ${missing}`);
                    assert.equal(valid, 10001 - expectedMissing);
                    if (channel === 'State') {
                        assert.equal(parseFloat(row.values['状態不一致']), 0);
                        assert.equal(parseFloat(row.values['同じ遷移の時刻差']), 0);
                    }
                });
            }
        }
        report.loadedFiles = await page.evaluate(() => Object.values(window.__csvViewerDebug.state.files).map(f => ({ name: f.name, role: f.role, offset: f.offset, points: f.timeData.length })));
        check('Parser preserves different row counts and exact file names', () => {
            for (const file of scenario.files) {
                const actual = report.loadedFiles.find(f => f.name === file.name);
                assert.ok(actual);
                assert.equal(actual.points, file.points);
                assert.equal(actual.offset, file.expectedOffsetFromFirst);
            }
        });
        check('No browser JavaScript errors', () => assert.deepEqual(report.errors, []));
        report.status = report.checks.some(c => c.status !== 'passed') ? 'failed' : 'passed';
    } catch (e) {
        report.status = 'failed'; report.failure = e.stack;
        await page.screenshot({ path: path.join(out, 'edge-failure.png') }).catch(() => {});
    } finally {
        report.completedAt = new Date().toISOString();
        fs.writeFileSync(path.join(out, 'edge-report.json'), JSON.stringify(report, null, 2) + '\n');
        await context.close(); await browser.close();
    }
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(c => c.status === 'failed'), failure: report.failure, report: path.join(out, 'edge-report.json') }, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
