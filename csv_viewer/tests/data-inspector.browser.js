'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

(async () => {
    const root = path.resolve(__dirname, '..');
    const out = path.join(__dirname, 'fixtures/generated/analysis-workflow');
    fs.mkdirSync(out, {recursive:true});
    const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
    const errors = [], remote = [];
    async function makePage() {
        const context = await browser.newContext({viewport:{width:1600,height:1000}});
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', req => { if (/^https?:/i.test(req.url())) remote.push(req.url()); });
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        return page;
    }
    const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    async function load(page, files) {
        await page.locator('#file-input').setInputFiles(files);
        await page.waitForFunction(n => Object.keys(__csvViewerDebug.state.files).length === n && !__csvViewerDebug.state.parseJobs.size, files.length);
        for (const name of ['Signal','Level']) {
            await page.locator('#column-search').fill(name);
            await page.locator(`[data-channel="${name}"] .col-item-top`).click();
        }
        await page.locator('#column-search').fill('');
        await page.locator('#analysis-scope').selectOption('all');
        await settle(page);
    }
    async function waitTable(page) {
        await page.waitForFunction(() => document.querySelector('#inspector-sample-table tbody tr') && document.querySelector('#inspector-content').getAttribute('aria-busy') !== 'true');
        await settle(page);
    }
    async function waitQuality(page) {
        await page.waitForFunction(() => document.querySelector('#inspector-quality-values tbody tr') && document.querySelector('#inspector-content').getAttribute('aria-busy') !== 'true');
        await settle(page);
    }
    try {
        const page = await makePage();
        const csv = shift => 'Time,Signal,Level\ns,V,kPa\n' + Array.from({length:330}, (_,i) => `${i+shift},${i*2},4`).join('\n');
        await load(page, [{name:'原本_ﾛｸﾞ.csv',mimeType:'text/csv',buffer:Buffer.from(csv(0))}, {name:'比較_ﾛｸﾞ.csv',mimeType:'text/csv',buffer:Buffer.from(csv(10))}]);
        await page.locator('.offset-input').fill('-10'); await page.locator('.offset-input').press('Tab'); await settle(page);
        await page.locator('#inspector-open-data').click(); await waitTable(page);
        assert.equal(await page.locator('#inspector-sample-table tbody tr').count(),100);
        assert.deepEqual(await page.locator('#inspector-sample-table tbody tr').first().locator('td').allTextContents(), ['3','0','0','0','4']);
        await page.locator('#inspector-next-page').click();
        await page.locator('#inspector-sample-table tr[data-sample-index="110"] td').first().click();
        assert.equal(await page.evaluate(() => __csvViewerDebug.dataInspector.cursorTime()),110);
        assert.equal(await page.evaluate(() => __csvViewerDebug.getAnalysisContext().scope),'all');
        assert.ok(await page.evaluate(() => __csvViewerDebug.state.chart.getOption().series.some(s => s.id.startsWith('inspection-cursor-'))));
        const pixel = await page.evaluate(() => {
            const d=__csvViewerDebug, r=document.querySelector('#chart').getBoundingClientRect(), grid=d.state.gridRegions[0];
            return {x:r.left+d.state.chart.convertToPixel({xAxisIndex:0},250.2),y:r.top+grid.top+grid.height/2};
        });
        await page.mouse.click(pixel.x,pixel.y); await settle(page);
        assert.equal(await page.evaluate(() => __csvViewerDebug.dataInspector.cursorTime()),250);
        assert.equal(await page.locator('#inspector-page').inputValue(),'3');
        await page.evaluate(() => __csvViewerDebug.selectAnalysisRange([200,310])); await waitTable(page);
        await page.locator('#inspector-next-page').click();
        assert.equal(await page.locator('#inspector-sample-table tbody tr').count(),11);
        assert.equal(await page.locator('#inspector-sample-table tbody tr').first().locator('td').first().innerText(),'303');
        const sub = await page.evaluate(() => Object.keys(__csvViewerDebug.state.files).find(id => __csvViewerDebug.state.files[id].role==='sub'));
        await page.locator('#inspector-file').selectOption(sub); await waitTable(page);
        assert.deepEqual((await page.locator('#inspector-sample-table tbody tr').first().locator('td').allTextContents()).slice(0,3),['203','210','200']);
        await page.locator('#compare-raw').check(); await waitTable(page);
        assert.deepEqual((await page.locator('#inspector-sample-table tbody tr').first().locator('td').allTextContents()).slice(0,3),['193','200','200']);
        await page.waitForTimeout(650); await page.reload();
        await page.waitForFunction(() => Object.keys(__csvViewerDebug.state.files).length===2 && !__csvViewerDebug.state.parseJobs.size);
        await waitTable(page);
        assert.match(await page.locator('#inspector-file option:checked').innerText(),/比較_ﾛｸﾞ\.csv$/);
        assert.deepEqual(await page.evaluate(() => __csvViewerDebug.getAnalysisContext().range),[200,310]);
        assert.equal(await page.locator('#data-inspector').isVisible(),true);

        const qualityPage = await makePage();
        const input = 'Time,Signal,Level\ns,V,kPa\n0,10,4\n1,11,4\n1,,4\n0.5,<img src=x onerror=alert(1)>,4\n20,13,4\n<script>,99,4\n21,NaN,4\n22,Infinity,4\n23,15,4\n';
        await load(qualityPage,[{name:'品質_ﾃｽﾄ.csv',mimeType:'text/csv',buffer:Buffer.from(input)}]);
        const original = await qualityPage.evaluate(() => {const f=Object.values(__csvViewerDebug.state.files)[0];return {times:Array.from(f.timeData),values:Array.from(f.colData[f.columns.find(c=>c.name==='Signal').id],v=>Number.isFinite(v)?v:String(v))};});
        const rendered = await qualityPage.evaluate(() => {
            const d=__csvViewerDebug, f=Object.values(d.state.files)[0], id=f.columns.find(c=>c.name==='Signal').id;
            return d.state.chart.getOption().series.find(s=>s.id===id).data.map(p=>p[1]);
        });
        assert.deepEqual(rendered,[10,11,null,null,13,null,null,15], 'non-finite display points must not destroy the finite waveform or its Y axis');
        await qualityPage.locator('#inspector-open-quality').click(); await waitQuality(qualityPage);
        assert.deepEqual(await qualityPage.locator('.inspector-quality-counts strong').allTextContents(),['8','1','1','1','1']);
        const rows=await qualityPage.locator('#inspector-quality-values tbody tr').allTextContents();
        assert.match(rows[0],/Signal.*8.*4.*4 \(50.0%\).*2.*10.*15/s);
        assert.match(rows[1],/一定値（要確認）/);
        assert.equal(await qualityPage.locator('#data-inspector img, #data-inspector script').count(),0);
        assert.match(await qualityPage.locator('#inspector-quality-issues').innerText(),/<img src=x onerror=alert\(1\)>/);
        assert.match(await qualityPage.locator('#inspector-quality-issues').innerText(),/<script>/);
        await qualityPage.locator('#inspector-quality-issues tr').filter({hasText:'重複時刻'}).getByRole('button').click(); await waitTable(qualityPage);
        assert.equal(await qualityPage.locator('#inspector-sample-table tr[aria-current]').getAttribute('data-sample-index'),'2');
        assert.equal(await qualityPage.evaluate(()=>__csvViewerDebug.dataInspector.cursorTime()),1);
        await qualityPage.evaluate(()=>__csvViewerDebug.selectAnalysisRange([20,23])); await settle(qualityPage);
        await qualityPage.locator('#inspector-open-quality').click(); await waitQuality(qualityPage);
        const selectedRow=await qualityPage.locator('#inspector-quality-values tbody tr').first().innerText();
        assert.match(selectedRow,/Signal.*4.*2.*2 \(50.0%\).*2/s);
        await qualityPage.locator('#inspector-quality-issues tr').filter({hasText:'時刻逆転'}).getByRole('button').click(); await settle(qualityPage);
        assert.equal(await qualityPage.evaluate(()=>__csvViewerDebug.dataInspector.cursorTime()),0.5);
        assert.deepEqual(await qualityPage.evaluate(()=>__csvViewerDebug.getAnalysisContext().range),[20,23]);
        await qualityPage.locator('#inspector-issue-filter').selectOption('invalid');
        assert.equal(await qualityPage.locator('#inspector-quality-issues tbody tr').count(),1);
        assert.match(await qualityPage.locator('#inspector-quality-issues').innerText(),/Infinity/);
        const after=await qualityPage.evaluate(() => {const f=Object.values(__csvViewerDebug.state.files)[0];return {times:Array.from(f.timeData),values:Array.from(f.colData[f.columns.find(c=>c.name==='Signal').id],v=>Number.isFinite(v)?v:String(v))};});
        assert.deepEqual(after,original,'table/diagnostics must not change original sample arrays');
        await qualityPage.locator('#inspector-issue-filter').selectOption('all');
        await qualityPage.screenshot({path:path.join(out,'quality-dark-1600.png')});
        await qualityPage.evaluate(()=>__csvViewerDebug.applyTheme('light')); await qualityPage.waitForTimeout(250);
        await qualityPage.screenshot({path:path.join(out,'quality-light-1600.png')});
        await qualityPage.setViewportSize({width:390,height:844}); await settle(qualityPage);
        assert.ok(await qualityPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page must not overflow horizontally');
        assert.ok(await qualityPage.locator('.compare-body').evaluate(el=>el.getBoundingClientRect().height>=220),'mobile keeps a usable waveform and scrolls the workspace');
        await qualityPage.screenshot({path:path.join(out,'quality-light-390.png'),fullPage:true});
        await qualityPage.locator('#inspector-close').click();
        assert.equal(await qualityPage.evaluate(()=>__csvViewerDebug.dataInspector.cursorTime()),null);
        assert.deepEqual(errors,[]); assert.deepEqual(remote,[]);
        console.log('Data inspector browser passed: original rows, pagination, bidirectional wave/table cursor, shared scope, raw/aligned time, restore, quality counts, original text/XSS, no mutation, dark/light/mobile and offline');
    } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
