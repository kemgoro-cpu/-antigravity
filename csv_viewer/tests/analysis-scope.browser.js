'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
 const page=await context.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const scope=()=>page.evaluate(()=>window.__csvViewerDebug.getAnalysisContext());
 try{
  const root=path.resolve(__dirname,'..');
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);
  await page.locator('#file-input').setInputFiles(['基準_ﾛｸﾞ.csv','比較_ﾛｸﾞ.csv'].map(n=>path.join(root,'docs/samples',n)));
  await page.waitForFunction(()=>Object.keys(window.__csvViewerDebug.state.files).length===2&&window.__csvViewerDebug.state.parseJobs.size===0);
  for(const n of ['Speed','Pressure']){await page.locator('#column-search').fill(n);await page.locator(`[data-channel="${n}"] .col-item-top`).click();}
  await page.locator('#column-search').fill('');
  await page.locator('.offset-input').fill('-2');await page.locator('.offset-input').press('Tab');await settle();
  await page.evaluate(()=>window.__csvViewerDebug.selectAnalysisRange([10,30]));await settle();
  await page.locator('#compare-range-start').fill('40');await page.locator('#compare-range-end').fill('50');await page.locator('#compare-range-go').click();await settle();
  assert.deepEqual((await scope()).range,[10,30]);
  await page.locator('[data-pane="results"]').click();await page.locator('#compare-calculate').click();
  await page.waitForFunction(()=>document.querySelectorAll('.compare-result').length===2);
  assert.match(await page.locator('#compare-results-status').innerText(),/10–30/);
  await page.locator('#stats-panel-btn').click();assert.match(await page.locator('#stats-panel').innerText(),/10.00.*30.00/);
  let dl=page.waitForEvent('download');await page.evaluate(()=>window.__csvViewerDebug.exportVisibleCSV());let file=await dl;
  let rows=fs.readFileSync(await file.path(),'utf8').trim().split(/\r?\n/);assert.equal(rows.length,43);assert.equal(Number(rows[2].split(',')[0]),10);assert.equal(Number(rows.at(-1).split(',')[0]),30);
  await page.evaluate(()=>window.__csvViewerDebug.showXYPlotModal());
  await page.waitForFunction(()=>document.querySelector('#xy-data-count').textContent.includes('41'));
  assert.match(await page.locator('#xy-analysis-context').innerText(),/選択区間 10 – 30/);
  assert.deepEqual(await page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#xy-chart')).getOption().series.map(s=>s.data.length)),[41,41]);
  await page.locator('.xy-modal .modal-close-btn').click();
  await page.locator('#analysis-scope').selectOption('visible');await settle();assert.deepEqual((await scope()).range,[40,50]);
  assert.match(await page.locator('#stats-panel').innerText(),/40.00.*50.00/);
  dl=page.waitForEvent('download');await page.evaluate(()=>window.__csvViewerDebug.exportVisibleCSV());file=await dl;
  rows=fs.readFileSync(await file.path(),'utf8').trim().split(/\r?\n/);assert.equal(rows.length,23);
  await page.locator('#analysis-scope').selectOption('all');await settle();assert.deepEqual((await scope()).range,[0,60]);
  await page.locator('#compare-raw').check();await settle();assert.equal((await scope()).rawTime,true);assert.deepEqual((await scope()).range,[0,62]);
  await page.locator('#analysis-scope').selectOption('selection');await settle();
  await page.evaluate(()=>window.__csvViewerDebug.showXYPlotModal());await page.waitForFunction(()=>document.querySelector('#xy-data-count').textContent.includes('41'));
  const points=await page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#xy-chart')).getOption().series.map(s=>s.data[0]));
  // Raw basis must take Sub's original 10 seconds (Main's 8 seconds), not shifted 10 seconds.
  assert.notEqual(points[0][0],points[1][0]);
  assert.match(await page.locator('#xy-analysis-context').innerText(),/元の時刻/);
  await page.locator('.xy-modal .modal-close-btn').click();
  dl=page.waitForEvent('download');await page.evaluate(()=>window.__csvViewerDebug.exportReportHTML());file=await dl;
  assert.match(fs.readFileSync(await file.path(),'utf8'),/選択区間 10 – 30 s · 元の時刻/);
  await page.waitForTimeout(650);await page.reload();
  await page.waitForFunction(()=>Object.keys(window.__csvViewerDebug.state.files).length===2&&window.__csvViewerDebug.state.parseJobs.size===0);
  await settle();assert.deepEqual((await scope()).range,[10,30]);assert.equal((await scope()).rawTime,true);
  assert.deepEqual(errors,[]);
  console.log('Analysis scope browser passed: distinct selected/visible/all, statistics, comparison, raw/aligned XY, exact CSV, report, restore');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
