'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startPreview, parseArgs, STATUS_PATH, SERVICE } = require('../scripts/dev-server.js');

function request(port, target = '/', options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: target, ...options }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
            response.on('error', reject);
        });
        req.on('error', reject); req.end();
    });
}
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });

(async () => {
    // Only isolated fixtures are served. This test never starts the real application.
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-preview-ﾃｽﾄ-'));
    const root = path.join(temporary, 'viewer'), outside = path.join(temporary, 'outside');
    const servers = [];
    try {
        fs.mkdirSync(root); fs.mkdirSync(outside);
        fs.mkdirSync(path.join(root, 'docs')); fs.mkdirSync(path.join(root, '.git'));
        fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Isolated fixture</title>');
        fs.writeFileSync(path.join(root, 'script.js'), 'window.fixture = true;');
        fs.writeFileSync(path.join(root, 'docs', '練習_ﾛｸﾞ.csv'), 'time,rpm\n0,1200\n');
        fs.writeFileSync(path.join(root, '.git', 'config'), 'PRIVATE');
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'PRIVATE');
        fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

        const preview = await startPreview({ root, port: 0 }); servers.push(preview.server);
        const address = preview.server.address(), port = address.port;
        assert.equal(address.address, '127.0.0.1', 'The service only binds to IPv4 loopback');
        assert.equal(preview.reused, false);
        assert.equal(preview.url, `http://127.0.0.1:${port}/?preview=1`);
        const index = await request(port, '/?preview=1');
        assert.equal(index.status, 200); assert.match(index.body, /Isolated fixture/);
        assert.equal(index.headers['cache-control'], 'no-store');
        assert.equal(index.headers['x-content-type-options'], 'nosniff');
        const script = await request(port, '/script.js');
        assert.match(script.headers['content-type'], /^text\/javascript/);
        const csv = await request(port, '/docs/' + encodeURIComponent('練習_ﾛｸﾞ.csv'));
        assert.equal(csv.body, 'time,rpm\n0,1200\n', 'Unicode and halfwidth katakana paths are preserved');
        const head = await request(port, '/script.js', { method: 'HEAD' });
        assert.equal(head.status, 200); assert.equal(head.body, '');
        assert.equal(Number(head.headers['content-length']), Buffer.byteLength(script.body));
        assert.equal((await request(port, '/docs/')).status, 404, 'There is no directory listing');
        assert.equal((await request(port, '/missing.csv')).status, 404);
        assert.equal((await request(port, '/', { method: 'POST' })).status, 405);
        for (const target of ['/../outside/secret.txt', '/%2e%2e/outside/secret.txt', '/docs/%2e%2e/%2e%2e/outside/secret.txt', '/.git/config', '/%2Egit/config', '/linked/secret.txt']) {
            const denied = await request(port, target);
            assert.equal(denied.status, 403, target); assert.ok(!denied.body.includes('PRIVATE'));
        }
        for (const target of ['/%ZZ', '/%00', '/..%5Coutside%5Csecret.txt', '/script.js:stream']) assert.equal((await request(port, target)).status, 400, target);
        assert.equal((await request(port, '/', { headers: { Host: `untrusted.example:${port}` } })).status, 403);
        assert.equal((await request(port, '/', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
        assert.equal((await request(port, '/', { headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}` } })).status, 200);
        const status = JSON.parse((await request(port, STATUS_PATH)).body);
        assert.equal(status.service, SERVICE); assert.match(status.rootId, /^[a-f0-9]{64}$/);
        assert.ok(!JSON.stringify(status).includes(temporary), 'The health endpoint does not expose the filesystem path');
        const reused = await startPreview({ root, port });
        assert.equal(reused.reused, true); assert.equal(reused.server, null); assert.equal(reused.url, preview.url);
        await assert.rejects(startPreview({ root: outside, port }), /different preview folder/);
        assert.equal((await request(port)).status, 200, 'A conflicting launch must not stop an existing service');
        const unknown = http.createServer((req, res) => res.end('another app'));
        await new Promise(resolve => unknown.listen(0, '127.0.0.1', resolve)); servers.push(unknown);
        await assert.rejects(startPreview({ root, port: unknown.address().port }), /another process/);
        assert.equal((await request(unknown.address().port)).body, 'another app');

        assert.deepEqual(parseArgs([]), { port: 8765, open: false });
        assert.deepEqual(parseArgs(['--port', '8901', '--open']), { port: 8901, open: true });
        for (const args of [['--host', '0.0.0.0'], ['--port'], ['--port', '0'], ['--port', '65536'], ['--port', '12abc']]) assert.throws(() => parseArgs(args));
        console.log('dev-server: loopback, Unicode paths, GET/HEAD, traversal/link/Host/Origin rejection, reuse and port conflicts passed (isolated fixtures only)');
    } finally {
        await Promise.all(servers.map(close));
        const absolute = path.resolve(temporary), expectedParent = path.resolve(os.tmpdir());
        assert.equal(path.dirname(absolute), expectedParent, 'Cleanup stays inside the explicit temporary fixture parent');
        assert.ok(path.basename(absolute).startsWith('csv-preview-ﾃｽﾄ-'));
        fs.rmSync(absolute, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
