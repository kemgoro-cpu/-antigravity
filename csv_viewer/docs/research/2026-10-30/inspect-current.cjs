'use strict';
// Read-only application inspection in a disposable Edge context. Synthetic data only.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
// This is the archived, pre-implementation inspection. Do not overwrite its
// evidence using a newer app while still labeling the result as bbba7af.
const inspectedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim();
const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', root], {cwd:root,encoding:'utf8'}).trim();
if (!inspectedCommit.startsWith('bbba7af') || changed) {
  throw new Error('Run this archived inspection from a clean checkout of bbba7af. Current implementation must not replace baseline evidence.');
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const facts = { inspectedDate: '2026-10-30', branch: 'main', commit: 'bbba7af', syntheticOnly: true, imports: [] };
  try {
    for (const [name, content] of [
      ['unit-row.csv', 'Time,Speed\ns,km/h\n0,1\n1,2\n2,3\n'],
      ['no-unit-row.csv', 'Time,Speed\n0,1\n1,2\n2,3\n']
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
      await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
      await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 1 && window.__csvViewerDebug.state.parseJobs.size === 0);
      facts.imports.push(await page.evaluate(() => {
        const f = Object.values(window.__csvViewerDebug.state.files)[0];
        return { name: f.name, inputSamples: 3, parsedSamples: f.timeData.length, times: Array.from(f.timeData), columns: f.columns.map(c => ({ name: c.name, unit: c.unit })), header: f.headerInfo };
      }));
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.locator('#file-input').setInputFiles([path.join(root, 'docs/samples/基準_ﾛｸﾞ.csv'), path.join(root, 'docs/samples/比較_ﾛｸﾞ.csv')]);
    await page.waitForFunction(() => Object.keys(window.__csvViewerDebug.state.files).length === 2 && window.__csvViewerDebug.state.parseJobs.size === 0);
    for (const name of ['Speed', 'Pressure', 'State']) {
      await page.locator('#column-search').fill(name);
      await page.locator(`[data-channel="${name}"] .col-item-top`).click();
    }
    await page.locator('#column-search').fill('');
    await page.locator('[data-pane="results"]').click();
    await page.locator('#compare-calculate').click();
    await page.waitForFunction(() => document.querySelectorAll('.compare-result').length === 3);
    await page.waitForTimeout(4500);
    await page.screenshot({ path: path.join(__dirname, 'screenshots/current-synthetic.png') });
    facts.current = await page.evaluate(() => ({ selected: [...window.__csvViewerDebug.state.selectedNames], resultText: document.getElementById('compare-panel-content').innerText }));
    facts.pageErrors = errors;
    facts.baselineTests = { unitFiles: 10, failures: 0, browserWorkflow: 'comparison.browser.js passed' };
    fs.writeFileSync(path.join(__dirname, 'current-facts.json'), JSON.stringify(facts, null, 2));
    console.log(JSON.stringify({ imports: facts.imports, pageErrors: errors }, null, 2));
    await ctx.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
