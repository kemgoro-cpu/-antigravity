'use strict';
// Local development preview. The distributed viewer still works without a server.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const STATUS_PATH = '/__csv_viewer_preview__/status';
const SERVICE = 'csv-chart-viewer-preview-v1';
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8', '.trn': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf',
};
const rootIdentity = root => createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex');
const previewURL = port => `http://${HOST}:${port}/?preview=1`;

function createPreviewServer({ root = APP_ROOT } = {}) {
    const realRoot = fs.realpathSync(root), rootId = rootIdentity(realRoot);
    if (!fs.statSync(realRoot).isDirectory()) throw new Error('Preview root must be a directory');
    const server = http.createServer(async (request, response) => {
        const send = (status, message, extra = {}) => {
            response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...extra });
            response.end(request.method === 'HEAD' ? undefined : message);
        };
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        // Restrict local services from being reached through a rebinding hostname.
        const port = server.address()?.port;
        const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
        if (!allowedHosts.has(request.headers.host)) return send(403, 'Local preview host required.');
        const origin = request.headers.origin;
        if (origin && ![...allowedHosts].some(host => origin === `http://${host}`)) return send(403, 'Cross-origin access is not allowed.');
        if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Only GET and HEAD are supported.', { Allow: 'GET, HEAD' });
        const rawPath = String(request.url || '').split(/[?#]/, 1)[0];
        if (!rawPath.startsWith('/')) return send(400, 'A local path is required.');
        let decoded;
        try { decoded = decodeURIComponent(rawPath); } catch { return send(400, 'Invalid URL encoding.'); }
        if (/[\\:\u0000-\u001f\u007f]/.test(decoded)) return send(400, 'Invalid path.');
        const segments = decoded.split('/').filter(Boolean);
        if (segments.some(segment => segment === '..' || segment.startsWith('.'))) return send(403, 'This path is not available.');
        if (decoded === STATUS_PATH) {
            const payload = JSON.stringify({ service: SERVICE, rootId });
            response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
            return response.end(request.method === 'HEAD' ? undefined : payload);
        }
        if (!segments.length) segments.push('index.html');
        let handle;
        try {
            // Reject links/junctions even when their current target is inside the root.
            // Also check the final canonical path before opening the file.
            let candidate = realRoot;
            for (const segment of segments) {
                candidate = path.join(candidate, segment);
                if ((await fs.promises.lstat(candidate)).isSymbolicLink()) return send(403, 'Linked paths are not served.');
            }
            const canonical = await fs.promises.realpath(candidate), relative = path.relative(realRoot, canonical);
            if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return send(403, 'This path is not available.');
            handle = await fs.promises.open(canonical, 'r');
            const stat = await handle.stat();
            if (!stat.isFile()) { await handle.close(); handle = null; return send(404, 'File not found.'); }
            response.writeHead(200, { 'Content-Type': TYPES[path.extname(canonical).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size });
            if (request.method === 'HEAD') { await handle.close(); handle = null; return response.end(); }
            const stream = handle.createReadStream(); handle = null;
            stream.on('error', () => response.destroy());
            response.on('close', () => stream.destroy());
            stream.pipe(response);
        } catch (error) {
            if (handle) await handle.close().catch(() => {});
            if (response.headersSent) return response.destroy();
            if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return send(404, 'File not found.');
            if (['EACCES', 'EPERM', 'ELOOP'].includes(error.code)) return send(403, 'This path is not available.');
            send(500, 'Could not read the requested file.');
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    return { server, rootId };
}

function statusAt(port) {
    return new Promise(resolve => {
        let settled = false, request;
        const finish = value => {
            if (settled) return;
            settled = true; clearTimeout(deadline); resolve(value); request?.destroy();
        };
        const deadline = setTimeout(() => finish(null), 1000);
        request = http.get({ hostname: HOST, port, path: STATUS_PATH }, response => {
            let body = '';
            response.on('data', data => { body += data; if (body.length > 4096) finish(null); });
            response.on('end', () => {
                try { finish(response.statusCode === 200 ? JSON.parse(body) : null); } catch { finish(null); }
            });
            response.on('error', () => finish(null));
            response.on('aborted', () => finish(null));
        });
        request.on('error', () => finish(null));
    });
}

async function startPreview({ root = APP_ROOT, port = DEFAULT_PORT } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
    const { server, rootId } = createPreviewServer({ root });
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, HOST, () => { server.removeListener('error', reject); resolve(); });
        });
        return { server, reused: false, url: previewURL(server.address().port) };
    } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        const existing = await statusAt(port);
        if (existing?.service === SERVICE && existing.rootId === rootId) return { server: null, reused: true, url: previewURL(port) };
        throw new Error(`Port ${port} is used by another process or a different preview folder. Use --port <number>. No process was stopped.`);
    }
}

function parseArgs(args) {
    let port = DEFAULT_PORT, open = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--open') open = true;
        else if (args[i] === '--port') {
            const value = args[++i];
            if (!/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > 65535) throw new Error('--port requires an integer from 1 to 65535.');
            port = Number(value);
        } else if (args[i] === '--help' || args[i] === '-h') return { help: true };
        else throw new Error(`Unknown option: ${args[i]}`);
    }
    return { port, open };
}

function openBrowser(url) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => console.error('Could not open the browser automatically. Open the printed URL manually.'));
    child.unref();
}

if (require.main === module) {
    (async () => {
        const args = parseArgs(process.argv.slice(2));
        if (args.help) return console.log('CSV Chart Viewer preview\n  node scripts/dev-server.js [--port 8765] [--open]\n  Only 127.0.0.1 is served. Ctrl+C stops a newly started server.');
        const result = await startPreview(args);
        console.log(`CSV Chart Viewer development preview\n${result.url}`);
        console.log(result.reused ? 'Reusing the preview already running for this folder. Stop it in its original terminal.'
            : 'Local computer only (127.0.0.1). Keep this window open. Press Ctrl+C to stop.');
        if (result.server) process.once('SIGINT', () => {
            console.log('\nStopping preview...');
            result.server.closeAllConnections?.();
            result.server.close(() => process.exit(0));
        });
        if (args.open) openBrowser(result.url);
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createPreviewServer, startPreview, parseArgs, STATUS_PATH, SERVICE };
