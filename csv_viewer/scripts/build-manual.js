/* Build the self-contained offline guide and its A4 PDF from one source.
 * Requires Playwright in NODE_PATH and installed Microsoft Edge.
 * Screenshots: node scripts/capture-manual.js
 * Guide/PDF:   node scripts/build-manual.js
 * The application itself still needs no build step or Node.js.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'manual.html');
const pdfPath = path.join(root, 'docs/CSV-Chart-Viewer-Manual.pdf');
const previewDir = path.join(root, 'tests/fixtures/generated/manual-preview');

(async () => {
    let images = 0;
    const html = fs.readFileSync(path.join(root, 'docs/manual-source.html'), 'utf8').replace(/data-image="([\w-]+\.png)"/g, (attribute, name) => {
        const bytes = fs.readFileSync(path.join(root, 'docs/images', name));
        images++;
        return `${attribute} src="data:image/png;base64,${bytes.toString('base64')}"`;
    });
    assert.ok(images >= 8, 'The guide must contain real screenshots');
    fs.writeFileSync(htmlPath, html, 'utf8');
    fs.mkdirSync(previewDir, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
        const errors = [], remoteRequests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', req => { if (/^https?:/.test(req.url())) remoteRequests.push(req.url()); });
        await page.goto(pathToFileURL(htmlPath).href);
        await page.evaluate(() => document.fonts.ready);
        const content = await page.evaluate(() => ({
            chapters: document.querySelectorAll('section.page').length,
            revision: document.querySelector('meta[name="manual-revision"]')?.content,
            images: [...document.images].every(img => img.complete && img.naturalWidth > 0 && img.alt),
            anchors: [...document.querySelectorAll('a[href^="#"]')].every(a => document.getElementById(a.hash.slice(1))),
            links: [...document.querySelectorAll('a[href]:not([href^="#"])')].map(a => a.getAttribute('href'))
        }));
        assert.equal(content.chapters, 23, '14 chapters, with continuation pages including event operation and interpretation');
        assert.match(content.revision, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(content.images, 'All images must load and have alt text');
        assert.ok(content.anchors, 'All table-of-contents targets must exist');
        for (const link of content.links) {
            if (link.endsWith('.pdf')) continue; // Created below.
            assert.ok(fs.existsSync(path.resolve(root, link)), `Broken local link: ${link}`);
        }
        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1100 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Guide overflows at ${width}px`);
            await page.screenshot({ path: path.join(previewDir, `guide-${width}.png`) });
        }
        await page.locator('#toc-toggle').click();
        assert.equal(await page.locator('#toc-toggle').getAttribute('aria-expanded'), 'true');
        await page.locator('nav a[href="#range"]').click();
        assert.equal(await page.locator('#toc-toggle').getAttribute('aria-expanded'), 'false');
        assert.equal(new URL(page.url()).hash, '#range');
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.emulateMedia({ media: 'print' });
        const sectionHeights = await page.evaluate(() => {
            document.querySelector('main').style.width = '182mm';
            // The printed guide names the bundled sample folder. Do not embed
            // machine-specific file:// links into a PDF intended for sharing.
            document.querySelectorAll('a[href]:not([href^="#"])').forEach(a => a.removeAttribute('href'));
            return [...document.querySelectorAll('section.page')].map(s => ({ id: s.id, height: Math.round(s.getBoundingClientRect().height) }));
        });
        console.log(JSON.stringify({ sectionHeights }, null, 2));
        for (const section of sectionHeights) assert.ok(section.height <= 1005, `${section.id}: chapter exceeds one printable A4 page`);
        await page.pdf({ path: pdfPath, format: 'A4', preferCSSPageSize: true, printBackground: true,
            tagged: true, outline: true,
            displayHeaderFooter: true, headerTemplate: '<span></span>',
            footerTemplate: `<div style="font-family:Arial,sans-serif;font-size:8px;color:#536875;width:100%;margin:0 14mm;display:flex;justify-content:space-between"><span>CSV Chart Viewer | ${content.revision}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
        });
        assert.equal(remoteRequests.length, 0, 'The manual must work offline');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ html: htmlPath, pdf: pdfPath, chapters: content.chapters, imageInstances: images, offline: true, responsive: [1440, 900, 390], sectionHeights }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
