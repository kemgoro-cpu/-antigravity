'use strict';
// Integration contracts only; exhaustive state-machine cases live in event-utils.test.js.
// NODE_PATH=<Playwright modules> node csv_viewer/tests/events.browser.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const output = path.join(__dirname, 'fixtures/generated/events');
const csv = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
const pressure = [300, 240, 240, 260, 280, 240, 240, 240, 260, 280, 240, 240, 240, '', 240, 240, 240, 280];
const source = csv('synthetic-event-contract.csv', 'Time,Pressure,Lazy\ns,kPa,kPa\n'
    + pressure.map((value, i) => `${i},${value},${value}`).join('\n'));
const optionIds = {
    minDuration: 'event-min-duration', releaseExpr: 'event-release-expr', holdoff: 'event-holdoff',
    mergeGap: 'event-merge-gap', maxSampleGap: 'event-max-sample-gap',
    preSeconds: 'event-pre-seconds', postSeconds: 'event-post-seconds',
};
const options = { minDuration: 0, releaseExpr: '', holdoff: 0, mergeGap: 0, maxSampleGap: 0, preSeconds: 1, postSeconds: 1 };
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const loaded = (page, count) => page.waitForFunction(count => Object.keys(__csvViewerDebug.state.files).length === count
    && !__csvViewerDebug.state.parseJobs.size, count);

async function exposeEvents(page) {
    if (await page.locator('#workspace-sidebar-toggle').getAttribute('aria-expanded') === 'false') {
        await page.locator('#workspace-sidebar-toggle').click();
    }
    const advanced = page.locator('details.compare-advanced');
    if (await advanced.count() && !await advanced.evaluate(el => el.open)) await advanced.locator('summary').first().click();
    const group = page.locator('[data-section="events"]');
    if ((await group.getAttribute('class')).includes('collapsed')) await group.locator('h3').click();
    // Expand optional controls as a user would before entering non-default values.
    const details = group.locator('details');
    for (let i = 0; i < await details.count(); i++) {
        const item = details.nth(i);
        if (!await item.evaluate(el => el.open)) await item.locator('summary').first().click();
    }
}
async function configure(page, expression, config = {}) {
    await exposeEvents(page);
    await page.locator('#event-expr').fill(expression);
    for (const [key, value] of Object.entries({ ...options, ...config })) await page.locator('#' + optionIds[key]).fill(String(value));
    await page.locator('#event-expr').focus();
}
async function detect(page) {
    await page.locator('#event-detect-btn').click();
    await page.waitForFunction(() => !document.querySelector('#event-detect-btn').disabled && !__csvViewerDebug.state.parseJobs.size);
    await settled(page);
}
async function events(page) {
    return page.evaluate(() => {
        const e = __csvViewerDebug.state.events;
        return { ...e, intervals: e.intervals.map(iv => ({ ...iv })) };
    });
}
async function areas(page) {
    return page.evaluate(() => __csvViewerDebug.state.chart.getOption().series
        .filter(s => /^(event|selection)-area-/.test(s.id))
        .map(s => ({ id: s.id, color: s.markArea?.itemStyle?.color, data: s.markArea?.data || [] })));
}
async function selectChannel(page, name) {
    await page.locator('#column-search').fill(name);
    await page.locator(`[data-channel="${name}"] .col-item-top`).click();
    await page.locator('#column-search').fill('');
    await page.waitForFunction(() => !__csvViewerDebug.state.parseJobs.size);
    await settled(page);
}
async function holdNextParse(page) {
    // Delay a real lazy CSV read at its parser boundary, never fabricate loaded values.
    await page.evaluate(() => {
        const parse = Papa.parse;
        Papa.parse = function(input, config) {
            Papa.parse = parse;
            window.__eventHeldParse = () => parse.call(Papa, input, config);
        };
    });
}
async function releaseParse(page) {
    await page.evaluate(() => { const release = window.__eventHeldParse; delete window.__eventHeldParse; release(); });
    await page.waitForFunction(() => !__csvViewerDebug.state.parseJobs.size);
    await settled(page);
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const errors = [], remoteRequests = [], checks = [];
    async function open(settings, viewport = { width: 1600, height: 1000 }) {
        const context = await browser.newContext({ viewport, acceptDownloads: true });
        if (settings) await context.addInitScript(value => localStorage.setItem('csvViewer_settings', JSON.stringify(value)), settings);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
        await page.goto(url); await page.waitForFunction(() => !!window.__csvViewerDebug);
        return { context, page };
    }
    try {
        const main = await open(), page = main.page;
        await page.locator('#file-input').setInputFiles(source); await loaded(page, 1);
        await selectChannel(page, 'Pressure');
        await configure(page, 'Pressure < 250', { minDuration: 2, releaseExpr: 'Pressure >= 270' });
        await detect(page);
        let result = await events(page);
        assert.deepEqual(result.intervals.map(iv => [iv.t0, iv.t1, iv.confirmedAt]), [[5, 8, 7], [10, 12, 12], [14, 16, 16]]);
        assert.equal(result.intervals[1].endReason, 'missing');
        assert.equal(result.totalCount, 3);
        assert.ok(result.unknownCount > 0, 'Blank source value remains unknown through both expressions');
        assert.equal(await page.locator('.event-jump-btn').count(), 3);
        checks.push('duration, release hysteresis and unknown source values');

        await page.evaluate(() => __csvViewerDebug.selectAnalysisRange([3, 6])); await settled(page);
        assert.equal(await page.locator('[data-range-action="event"]').count(), 0);
        assert.equal(await page.locator('[data-range-action="note"]').count(), 1);
        let bands = await areas(page);
        const red = bands.find(s => s.id.startsWith('event-area-'));
        const blue = bands.find(s => s.id.startsWith('selection-area-'));
        assert.ok(red?.data.length && blue?.data.length, 'Selected range and detected events have independent chart series');
        assert.notEqual(red.color, blue.color);
        await page.locator('[data-range-action="close"]').click(); await settled(page);
        assert.equal((await events(page)).totalCount, 3);
        assert.ok(!(await areas(page)).some(s => s.id.startsWith('selection-area-') && s.data.length));
        await page.evaluate(() => __csvViewerDebug.selectAnalysisRange([3, 6])); await settled(page);
        await page.locator('#event-clear-btn').click(); await settled(page);
        assert.equal((await events(page)).intervals.length, 0);
        assert.equal(await page.locator('#event-expr').inputValue(), 'Pressure < 250');
        assert.equal(await page.locator('#event-min-duration').inputValue(), '2');
        bands = await areas(page);
        assert.ok(bands.some(s => s.id.startsWith('selection-area-') && s.data.length));
        assert.ok(!bands.some(s => s.id.startsWith('event-area-') && s.data.length));
        const clearedText = await page.locator('#event-summary').innerText();
        await configure(page, 'Pressure < 0'); await detect(page);
        assert.equal((await events(page)).totalCount, 0);
        const zeroText = await page.locator('#event-summary').innerText();
        assert.notEqual(zeroText, clearedText, 'A successful zero-result search is different from cleared results');
        assert.match(zeroText, /0\s*件|該当.*なし|見つかりません/);
        checks.push('selection versus detected bands and distinct zero/cleared results');

        await configure(page, 'Pressure < 250', { minDuration: 2, releaseExpr: 'Pressure >= 270', mergeGap: 3 });
        await detect(page); result = await events(page);
        assert.equal(result.totalCount, 2);
        assert.ok(result.intervals[0].segments.length >= 2, 'Known recovery gap may merge confirmed intervals');
        assert.equal(result.intervals[1].t0, 14, 'Missing sample is a merge barrier');
        await configure(page, 'Pressure < 250', { minDuration: 2, releaseExpr: 'Pressure >= 270', holdoff: 5 });
        await detect(page);
        assert.deepEqual((await events(page)).intervals.map(iv => iv.t0), [5, 14]);
        checks.push('holdoff and merge controls reach the event engine');

        await configure(page, 'Pressure < 250', { minDuration: 2, releaseExpr: 'Pressure >= 270', preSeconds: 100, postSeconds: 100 });
        await detect(page);
        await page.locator('.event-jump-btn').first().focus(); await page.keyboard.press('Enter'); await settled(page);
        const view = await page.evaluate(() => __csvViewerDebug.getVisibleXRange());
        assert.ok(view[0] >= 0 && view[1] <= 17 && view[0] <= 5 && view[1] >= 8, 'Event jump clamps context to actual source extent');
        const reportDownload = page.waitForEvent('download');
        await page.evaluate(() => __csvViewerDebug.exportReportHTML());
        const report = fs.readFileSync(await (await reportDownload).path(), 'utf8');
        assert.match(report, /Pressure\s*(?:&lt;|<)\s*250/);
        assert.match(report, /Pressure\s*(?:&gt;|>)=\s*270/);
        assert.match(report, /最小.*継続|継続.*時間/);
        assert.match(report, /確定|confirmedAt/);
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        checks.push('keyboard event jump, bounds and report provenance');

        // A dirty draft cannot leave old results available for export or chart overlays.
        await page.locator('#event-expr').fill('Pressure < 200'); await page.locator('#event-expr').press('Tab'); await settled(page);
        assert.equal((await events(page)).intervals.length, 0);
        assert.equal(await page.locator('.event-jump-btn').count(), 0);
        assert.ok(!(await areas(page)).some(s => s.id.startsWith('event-area-') && s.data.length));
        await page.waitForFunction(() => {
            const saved = JSON.parse(localStorage.getItem('csvViewer_settings') || '{}');
            return saved.eventOptions?.preSeconds === 100 && saved.eventExpr === 'Pressure < 200';
        });
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('csvViewer_settings')));
        assert.equal(saved.eventExpr, 'Pressure < 200');
        assert.equal(saved.eventOptions.minDuration, 2); assert.equal(saved.eventOptions.releaseExpr, 'Pressure >= 270');
        await page.reload(); await page.waitForFunction(() => !!window.__csvViewerDebug); await loaded(page, 1); await exposeEvents(page);
        assert.equal(await page.locator('#event-expr').inputValue(), 'Pressure < 200');
        assert.equal(await page.locator('#event-min-duration').inputValue(), '2');
        assert.equal(await page.locator('#event-release-expr').inputValue(), 'Pressure >= 270');
        assert.equal((await events(page)).intervals.length, 0, 'Restore conditions without silently reusing detections');
        checks.push('dirty invalidation and persisted conditions without persisted detections');

        await configure(page, 'Lazy < 250', { minDuration: 2, releaseExpr: 'Lazy >= 270' });
        await holdNextParse(page); await page.locator('#event-detect-btn').click();
        await page.waitForFunction(() => typeof window.__eventHeldParse === 'function');
        await page.locator('#event-clear-btn').click(); await releaseParse(page);
        assert.equal((await events(page)).intervals.length, 0, 'Clear invalidates an in-flight detection');
        // Reloading the small fixture creates a fresh unloaded Lazy column for cancellation.
        await main.context.close();
        const cancelled = await open(), cp = cancelled.page;
        await cp.locator('#file-input').setInputFiles(source); await loaded(cp, 1);
        await configure(cp, 'Lazy < 250'); await holdNextParse(cp); await cp.locator('#event-detect-btn').click();
        await cp.waitForFunction(() => typeof window.__eventHeldParse === 'function');
        await cp.locator('[data-cancel-job]').click(); await releaseParse(cp);
        assert.equal((await events(cp)).intervals.length, 0, 'Cancelled lazy read must not manufacture detections');
        assert.notEqual((await events(cp)).evaluated, true, 'Cancellation is not a completed zero-event search');
        assert.equal(await cp.locator('.event-jump-btn').count(), 0);
        await configure(cp, 'Lazy < 250'); await holdNextParse(cp); await cp.locator('#event-detect-btn').click();
        await cp.waitForFunction(() => typeof window.__eventHeldParse === 'function');
        await cp.locator('#event-expr').fill('Lazy > 10000'); await cp.locator('#event-expr').press('Tab');
        await releaseParse(cp);
        assert.notEqual((await events(cp)).evaluated, true, 'Editing a condition while reading prevents stale result publication');
        await detect(cp);
        assert.equal((await events(cp)).evaluated, true, 'A cancelled read can be retried');
        assert.equal((await events(cp)).totalCount, 0, 'Retry uses the latest condition');
        await cancelled.context.close();
        checks.push('late lazy-load completion after clear, cancellation and condition edits; retry');

        const changed = await open(), sp = changed.page;
        await sp.locator('#file-input').setInputFiles([source, { ...source, name: 'synthetic-event-second.csv' }]); await loaded(sp, 2);
        await selectChannel(sp, 'Pressure');
        await configure(sp, 'Pressure < 250'); await detect(sp);
        assert.ok((await events(sp)).intervals.length);
        await sp.locator('.time-unit-select').first().selectOption('ms'); await settled(sp);
        assert.equal((await events(sp)).intervals.length, 0, 'Source time-unit edit invalidates detections');
        await sp.locator('.time-unit-select').first().selectOption('s');
        await configure(sp, 'Pressure < 250'); await detect(sp);
        await sp.locator('.role-sub').first().click(); await settled(sp);
        assert.equal((await events(sp)).intervals.length, 0, 'Main-file replacement invalidates detections');
        await sp.evaluate(() => __csvViewerDebug.addCustomRAM('EventPressure', 'Pressure', 'kPa'));
        await configure(sp, '@EventPressure < 250'); await detect(sp);
        assert.ok((await events(sp)).intervals.length);
        await sp.evaluate(() => __csvViewerDebug.editCustomRAM(__csvViewerDebug.state.customRAMs.find(c => c.name === '@EventPressure').id, 'Pressure + 100', 'kPa'));
        assert.equal((await events(sp)).intervals.length, 0, 'Custom source formula edit invalidates detections');
        await changed.context.close();
        checks.push('time unit, main file and custom formula provenance invalidation');

        const nonfinite = await open(), np = nonfinite.page;
        await np.locator('#file-input').setInputFiles(csv('synthetic-nonfinite-events.csv',
            'Time,Pressure\ns,kPa\n0,300\n1,240\n2,Infinity\n3,240\n4,280\n'));
        await loaded(np, 1); await configure(np, 'Pressure < 250', { releaseExpr: 'Pressure >= 270' }); await detect(np);
        const nonfiniteResult = await events(np);
        assert.equal(nonfiniteResult.unknownCount, 1);
        assert.deepEqual(nonfiniteResult.intervals.map(iv => [iv.t0, iv.t1, iv.endReason]), [[1, 1, 'missing'], [3, 3, 'release']]);
        assert.deepEqual(await np.evaluate(() => Array.from(__csvViewerDebug.computeCustomExpr('exp(1000) > 0', Object.values(__csvViewerDebug.state.files)[0]))), [1, 1, 1, 1, 1]);
        await configure(np, 'exp(1000) > 0'); await detect(np);
        assert.equal((await events(np)).totalCount, 0); assert.equal((await events(np)).unknownCount, 5);
        await nonfinite.context.close(); checks.push('nonfinite event conditions stay unknown while legacy formula arithmetic remains compatible');

        const capped = await open(), cap = capped.page;
        const many = 'Time,Pulse\ns,bool\n' + Array.from({ length: 9303 }, (_, i) => `${i},${i % 3 < 2 ? 1 : 0}`).join('\n');
        await cap.locator('#file-input').setInputFiles(csv('synthetic-3101-events.csv', many)); await loaded(cap, 1);
        await selectChannel(cap, 'Pulse');
        await configure(cap, 'Pulse > 0'); await detect(cap);
        const large = await events(cap);
        assert.equal(large.totalCount, 3101); assert.equal(large.intervals.length, 300); assert.equal(large.truncated, true);
        assert.equal(await cap.locator('.event-jump-btn').count(), 300);
        assert.match(await cap.locator('#event-summary').innerText(), /3,?101/);
        assert.equal((await areas(cap)).find(s => s.id.startsWith('event-area-')).data.length, 300);
        await configure(cap, 'Pulse > 0', { mergeGap: 1 });
        const mergeStarted = Date.now(); await detect(cap); const mergedElapsedMs = Date.now() - mergeStarted;
        const merged = await events(cap);
        assert.equal(merged.totalCount, 1); assert.equal(merged.intervals[0].segmentCount, 3101);
        assert.equal(merged.intervals[0].segments.length, 3000); assert.equal(merged.segmentsTruncated, true);
        const spans = (await areas(cap)).find(s => s.id.startsWith('event-area-')).data;
        assert.equal(spans.length, 3000);
        assert.ok(spans.every(span => span[1].xAxis - span[0].xAxis <= 1), 'Omitted merged segments must never turn into a continuous red envelope');
        assert.match(await cap.locator('#event-summary').innerText(), /3,?000/);
        checks.push(`event and merged-span caps retain full counts (3101 runs, merged render ${mergedElapsedMs} ms)`);
        await capped.context.close();

        const legacy = await open({ _version: 7, eventExpr: 'Pressure < 250' }, { width: 390, height: 844 }), mobile = legacy.page;
        await mobile.locator('#file-input').setInputFiles(source); await loaded(mobile, 1); await exposeEvents(mobile);
        assert.equal(await mobile.locator('#event-expr').inputValue(), 'Pressure < 250');
        assert.equal(await mobile.locator('#event-min-duration').inputValue(), '0');
        assert.equal(await mobile.locator('#event-release-expr').inputValue(), '');
        await detect(mobile);
        await mobile.locator('#event-clear-btn').focus(); await mobile.keyboard.press('Enter'); await settled(mobile);
        assert.equal((await events(mobile)).intervals.length, 0);
        const bounds = await mobile.locator('#event-clear-btn').boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
        const overflow = await mobile.evaluate(() => ({
            page: document.documentElement.scrollWidth - innerWidth,
            sidebar: document.querySelector('.sidebar').scrollWidth - document.querySelector('.sidebar').clientWidth,
        }));
        assert.ok(overflow.page <= 1 && overflow.sidebar <= 1, `390px overflow: ${JSON.stringify(overflow)}`);
        await mobile.locator('#event-summary').scrollIntoViewIfNeeded();
        const mobileSummary = await mobile.locator('#event-summary').evaluate(el => ({
            whiteSpace: getComputedStyle(el).whiteSpace, width: el.clientWidth, scrollWidth: el.scrollWidth,
            height: el.clientHeight, scrollHeight: el.scrollHeight,
        }));
        assert.ok(mobileSummary.scrollWidth <= mobileSummary.width + 1, 'Mobile status text must wrap inside the sidebar');
        await mobile.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        await legacy.context.close(); checks.push('legacy expression upgrade and keyboard clear at 390px');

        assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, mobileSummary, errors, remoteRequests }, null, 2));
        console.log(`Event workflow browser passed: ${checks.length} integration groups; no page errors or network requests.`);
        checks.forEach(check => console.log(`  PASS ${check}`));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
