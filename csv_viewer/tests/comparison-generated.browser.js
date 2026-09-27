'use strict';
// Real CSV files, UI actions, and independently known Main-minus-Sub answers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.join(__dirname, 'fixtures/generated');
const out = path.join(root, 'results');
fs.mkdirSync(out, {recursive:true});
const shifts = [0,2,-3,5,-7,11,-13,17,-19,23];
const report = {startedAt:new Date().toISOString(), browser:'Microsoft Edge headless', cases:[]};
const fileName = i => `${String(i+1).padStart(2,'0')}_ﾛｸﾞ.csv`;
const channels = ['Pressure','Temperature','State'];
async function snapshot(page) {
    return page.evaluate(() => {
        const s = window.__csvViewerDebug.state;
        return { files:Object.values(s.files).map(f=>({name:f.name,role:f.role,offset:f.offset,points:f.timeData.length})), selected:[...s.selectedNames], series:s.chart.getOption().series.map(x=>({id:x.id,name:x.name,length:x.data?.length})), results:document.getElementById('compare-results-list')?.innerText };
    });
}
(async () => {
    const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
    try {
        for (const [dataset,count,points] of [['regular',3,10001],['regular',4,10001],['regular',5,10001],['regular',10,10001],['large',5,100001]]) {
            const context = await browser.newContext({viewport:{width:1600,height:1000}});
            const page = await context.newPage(); page.setDefaultTimeout(60000);
            const result = {dataset,count,pointsPerFile:points,status:'running',timings:[],checks:[],errors:[],warnings:[]}; report.cases.push(result);
            page.on('pageerror', e=>result.errors.push(e.message));
            page.on('console',msg=>{if(['warning','error'].includes(msg.type()))result.warnings.push(msg.text());});
            const measure = async (label,fn) => { const t=performance.now(); const v=await fn(); result.timings.push({label,seconds:Number(((performance.now()-t)/1000).toFixed(3))}); return v; };
            try {
                await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
                await measure('load_all_files',async()=>{
                    await page.locator('#file-input').setInputFiles(Array.from({length:count},(_,i)=>path.join(root,dataset,fileName(i))));
                    await page.waitForFunction(({count,points}) => {const s=window.__csvViewerDebug.state; return Object.keys(s.files).length===count && s.parseJobs.size===0 && Object.values(s.files).every(f=>f.timeData.length===points);},{count,points});
                });
                const idFor = async i => page.evaluate(name=>Object.keys(window.__csvViewerDebug.state.files).find(id=>window.__csvViewerDebug.state.files[id].name===name),fileName(i));
                await page.locator(`[data-roleid="${await idFor(0)}"]`).click();
                await measure('select_three_channels',async()=>{
                    for(const name of channels) { await page.locator('#column-search').fill(name); const row=page.locator(`[data-channel="${name}"] .col-item-top`); await row.waitFor(); if(await row.getAttribute('aria-pressed')!=='true') await row.click(); }
                    await page.locator('#column-search').fill('');
                    await page.waitForFunction(count=>window.__csvViewerDebug.state.chart.getOption().series.filter(x=>x.type==='line').length===count*3,count);
                });
                for(let i=1;i<count;i++) {const input=page.locator(`[data-offset-id="${await idFor(i)}"]`);await input.fill(String(-shifts[i]));await input.press('Tab');}
                const verify = async main => {
                    await page.waitForFunction(({name,count})=>{const s=window.__csvViewerDebug.state;return Object.values(s.files).filter(f=>f.role==='main').length===1 && Object.values(s.files).find(f=>f.role==='main').name===name && s.chart.getOption().series.filter(x=>x.type==='line').length===count*3;},{name:fileName(main),count});
                    const snap=await snapshot(page);
                    for(const f of snap.files){const i=parseInt(f.name,10)-1; assert.equal(f.offset,shifts[main]-shifts[i],`offset ${f.name}`);}
                    assert.deepEqual([...snap.selected].sort(),[...channels].sort());
                    await page.locator('#compare-range-all').click();
                    await page.locator('[data-view="diff"]').click();
                    await page.waitForFunction(count=>window.__csvViewerDebug.state.chart.getOption().series.filter(s=>s.id.startsWith('compare-diff')).length===(count-1)*3,count);
                    const diffs=await page.evaluate(()=>window.__csvViewerDebug.state.chart.getOption().series.filter(s=>s.id.startsWith('compare-diff')).map(s=>{let lo=Infinity,hi=-Infinity,n=0,missing=0;for(const p of s.data){if(p[1]===null){missing++;continue;} n++;lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1]);}return {name:s.name,lo,hi,n,missing};}));
                    for(const channel of channels){
                        const actual=diffs.filter(d=>d.name.includes(channel)).sort((a,b)=>a.lo-b.lo);
                        const scale=channel==='Pressure'?10:channel==='Temperature'?2:0;
                        const expected=Array.from({length:count},(_,i)=>(main-i)*scale).filter((_,i)=>i!==main).sort((a,b)=>a-b);
                        assert.equal(actual.length,count-1);
                        actual.forEach((d,i)=>{assert.ok(d.n>0);assert.ok(Math.abs(d.lo-expected[i])<1e-5 && Math.abs(d.hi-expected[i])<1e-5,`${channel} main=${main}: expected ${expected[i]}, actual [${d.lo},${d.hi}]`);});
                    }
                    await page.locator('[data-pane="results"]').click();
                    await measure(`main_${main}_calculate`,async()=>{await page.locator('#compare-calculate').click();await page.waitForFunction(count=>document.querySelectorAll('.compare-result').length===(count-1)*3,count);});
                    const rows=await page.locator('.compare-result').evaluateAll(els=>els.map(el=>({title:el.querySelector('button').textContent,values:Object.fromEntries([...el.querySelectorAll('dl>div')].map(div=>[div.querySelector('dt').textContent,div.querySelector('dd').textContent]))})));
                    for(const row of rows){
                        const sub=parseInt(row.title.match(/(\d+)_ﾛｸﾞ/)[1],10)-1;
                        const scale=row.title.startsWith('Pressure')?10:row.title.startsWith('Temperature')?2:0;
                        assert.ok(Math.abs(parseFloat(row.values['最大絶対差'])-Math.abs(main-sub)*scale)<1e-4,row.title);
                        const [valid,missing]=row.values['有効 / 欠損・範囲外'].split('/').map(Number);
                        assert.equal(valid+missing,points);assert.ok(missing<=2);
                        if(scale===0) assert.equal(parseFloat(row.values['状態不一致']),0);
                    }
                    result.checks.push({main:fileName(main),differenceSeries:diffs.length,resultRows:rows.length});
                    await page.locator('[data-view="stack"]').click();
                    await page.waitForFunction(count=>window.__csvViewerDebug.state.chart.getOption().grid.length===count*3,count);
                    await page.locator('[data-view="overlay"]').click();
                };
                for(let main=0;main<count;main++){
                    console.log(`${dataset} ${count} files: Main ${main+1}/${count}`);
                    await measure(`main_${main}_switch_and_verify`,async()=>{await page.locator(`[data-roleid="${await idFor(main)}"]`).click();await verify(main);});
                }
                await page.screenshot({path:path.join(out,`${dataset}-${count}-overlay.png`)});
                await measure('reload_and_verify',async()=>{await page.reload();await page.waitForFunction(count=>Object.keys(window.__csvViewerDebug.state.files).length===count&&window.__csvViewerDebug.state.parseJobs.size===0,count);await verify(count-1);});
                assert.deepEqual(result.errors,[]);result.status='passed';
            } catch(e){result.status='failed';result.failure=e.stack;result.snapshot=await snapshot(page).catch(()=>null);await page.screenshot({path:path.join(out,`${dataset}-${count}-failure.png`)}).catch(()=>{});console.error(result.failure);}
            finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await context.close();}
        }
    } finally {await browser.close();}
    report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report.cases.map(c=>({dataset:c.dataset,count:c.count,status:c.status})),null,2));
    if(report.cases.some(c=>c.status!=='passed'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
