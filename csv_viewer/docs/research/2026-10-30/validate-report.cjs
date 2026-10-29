'use strict';
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const records=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}});
  const errors=[],network=[];
  page.on('pageerror',err=>errors.push(err.message));
  page.on('request',req=>{if(/^https?:/.test(req.url()))network.push(req.url());});
  await page.goto(pathToFileURL(path.join(__dirname,'report.html')).href);
  assert.equal(await page.locator('.candidate').count(),55);
  assert.equal(await page.locator('table.products tbody tr').count(),37);
  assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||!i.naturalWidth).length),0);
  assert.deepEqual(await page.locator('a[href^="#"]').evaluateAll(as=>as.filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash)),[]);
  await page.locator('#phase').selectOption('A');
  assert.equal(await page.locator('.candidate:visible').count(),10);
  await page.locator('#cost').selectOption('S');
  assert.equal(await page.locator('.candidate:visible').count(),1);
  await page.locator('#reset').click();
  assert.equal(await page.locator('.candidate:visible').count(),55);
  await page.locator('#q').fill('XY');
  assert.ok(await page.locator('.candidate:visible').count()>0);
  assert.ok(await page.locator('.candidate:visible').count()<55);
  await page.locator('#reset').click();
  await page.locator('#expand').click();
  assert.equal(await page.locator('.candidate details[open]').count(),55);
  for(const width of [1440,900,390]){
   await page.setViewportSize({width,height:1080});
   await page.evaluate(()=>window.scrollTo(0,0));
   const sizes=await page.evaluate(()=>({viewport:window.innerWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth}));
   assert.ok(sizes.root<=width+1,JSON.stringify(sizes));
   records.push(sizes);
   await page.screenshot({path:path.join(__dirname,`screenshots/report-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('#ranking').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'screenshots/report-ranking.png')});
  assert.deepEqual(errors,[]);
  assert.deepEqual(network,[]);
  const result={products:37,proposals:55,filters:'passed',images:'loaded',internalLinks:'valid',widths:records,pageErrors:errors,externalRequests:network};
  fs.writeFileSync(path.join(__dirname,'report-validation.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
