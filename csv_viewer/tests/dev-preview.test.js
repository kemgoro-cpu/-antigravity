'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { File } = require('node:buffer');
const Preview = require('../dev-preview.js');
const U = require('../parser-utils.js');
const Papa = require('../lib/papaparse.min.js');
const root = path.resolve(__dirname, '..');
const sample = fs.readFileSync(path.join(root, 'docs/samples', Preview.LOG_NAME), 'utf8');
const mapText = fs.readFileSync(path.join(root, 'docs/samples', Preview.MAP_NAME), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const url of ['file:///C:/viewer/index.html?preview=1', 'https://example.com/?preview=1', 'http://example.com/?preview=1', 'http://localhost/', 'http://localhost/?preview=0']) assert.equal(Preview.enabled(new URL(url)), false, url);
for (const url of ['http://127.0.0.1:8765/?preview=1', 'http://localhost:8765/index.html?preview=1']) assert.equal(Preview.enabled(new URL(url)), true);
const storage = Preview.memoryStorage(); storage.setItem('test', 42); assert.equal(storage.getItem('test'), '42');
assert.equal(Preview.memoryStorage().getItem('test'), null, 'A new preview session starts empty'); storage.removeItem('test'); assert.equal(storage.getItem('test'), null);

function harness(overrides = {}) {
    const nodes = new Map();
    class Element {
        constructor() { this.attributes = {}; this.listeners = {}; this.textContent = ''; this.children = []; }
        setAttribute(key, value) { this.attributes[key] = String(value); }
        set innerHTML(_) { for (const id of ['dev-preview-demo', 'dev-preview-status']) { const child = new Element(); child.id = id; nodes.set(id, child); this.children.push(child); } }
        querySelector(selector) { return nodes.get(selector.slice(1)); }
        addEventListener(type, callback) { this.listeners[type] = callback; }
        removeEventListener(type) { delete this.listeners[type]; }
        prepend(child) { this.children.unshift(child); }
        remove() { this.removed = true; }
    }
    const state = { fileCount: 0, loading: false, restoring: false }, calls = [], loaded = [], configured = [];
    const api = { location: new URL('http://127.0.0.1:8765/?preview=1'), document: { createElement: () => new Element() }, host: new Element(), File,
        state: () => state, isOnlyFile: id => state.fileCount === 1 && id === 'demo',
        fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => url.includes(encodeURIComponent(Preview.LOG_NAME)) ? sample : mapText }; },
        loadLog: async (file, options, signal) => { loaded.push({ file, options, signal }); state.fileCount = 1; return 'demo'; },
        configure: async (id, map, current, signal) => { configured.push({ id, map, current: current(), signal }); return true; }, ...overrides };
    return { preview: Preview.create(api), api, state, calls, loaded, configured, nodes, button: nodes.get('dev-preview-demo'), status: nodes.get('dev-preview-status') };
}

// Use the app's actual parser callbacks to check the new completion bridge.
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function functionSource(name) {
    let start = source.indexOf(`function ${name}(`); const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, name); if (source.slice(start - 6, start) === 'async ') start -= 6;
    return source.slice(start, end + 2);
}
function parserEnvironment(pending = async () => {}) {
    const errors = [], noop = () => {}, jobs = [];
    const env = { ...U, Papa: { parse(input, options) { if (typeof input === 'string') return Papa.parse(input, options); input.text().then(text => Papa.parse(text, options)).catch(options.error); } },
        console: { log: noop, warn: noop }, window: {}, state: { files: {}, fileColors: {}, colorCtr: 0, customRAMs: [], parseJobs: new Map() },
        dom: { nameRow: {}, unitRow: {} }, SERIES_COLORS: ['#176b82'], _origFileById: new Map(), _restoreOrderById: new Map(), _nextSessionOrder: 0,
        _sessionRestoreNames: null, dataInspector: null, renderParseJobs: noop,
        createParseJob(name) { const job = { id: 'job' + jobs.length, name }; jobs.push(job); env.state.parseJobs.set(job.id, job); return job; },
        updateParseJob: noop, detectHeaderRows: raw => U.detectHeaderRows(raw, 0, 1), autoNormalizeTimeScales: noop,
        updateParsePreview: noop, sessionSaveFile: noop, applyPendingSettings: pending, applyDeferredCrossRAMs: async () => {},
        autoGenerateFuelRAMs: async () => {}, computeDriveIndex: async () => {}, updateUI: noop, saveSettings: noop, resetHistoryBaseline: noop, clearEvents: noop,
        showError: (...value) => errors.push(value), showWarning: noop, setTimeout };
    vm.createContext(env);
    for (const name of ['isTrnFile', 'finishParseJob', 'parseCSV', 'describeHeaderParseIssue', 'onHeaderParsed']) vm.runInContext(functionSource(name), env);
    return { env, errors, jobs };
}

(async () => {
    const h = harness(); assert.equal(h.button.disabled, false);
    assert.equal(await h.preview.load(), true); assert.equal(h.calls.length, 2); assert.equal(h.loaded.length, 1); assert.equal(h.configured.length, 1);
    assert.equal(h.loaded[0].file.name, Preview.LOG_NAME); assert.equal(h.configured[0].map.name, Preview.MAP_NAME);
    assert.equal(h.configured[0].signal, h.loaded[0].signal, 'Cancellation is passed through to the background import');
    assert.deepEqual(h.loaded[0].options, Preview.IMPORT_OPTIONS);
    const parsed = Papa.parse(await h.loaded[0].file.text(), { skipEmptyLines: true }).data;
    const layout = U.resolveImportLayout(parsed, h.loaded[0].options);
    assert.equal(layout.unitRow, 1); assert.equal(layout.timeIdx, 0); assert.equal(parsed.length - layout.dataStart, 1201);
    assert.equal(parsed[layout.dataStart][0], '0'); assert.equal(parsed.at(-1)[0], '120');
    assert.ok(h.calls.every(call => call.url.startsWith('docs/samples/') && call.options.redirect === 'error' && call.options.signal));
    assert.match(h.status.textContent, /デモを表示/); assert.equal(h.button.disabled, true);
    assert.equal(await h.preview.load(), false); assert.equal(h.loaded.length, 1, 'The demo cannot be added over existing data');

    for (const key of ['restoring', 'loading', 'fileCount']) {
        const blocked = harness(); blocked.state[key] = key === 'fileCount' ? 1 : true; blocked.preview.refresh();
        assert.equal(blocked.button.disabled, true); assert.equal(await blocked.preview.load(), false); assert.equal(blocked.calls.length, 0);
    }
    const gate = deferred(), duplicate = harness({ fetch: async () => { await gate.promise; return { ok: true, text: async () => sample }; } });
    const first = duplicate.preview.load(); assert.equal(await duplicate.preview.load(), false); gate.resolve(); assert.equal(await first, true); assert.equal(duplicate.loaded.length, 1);

    let fail = true;
    const retry = harness({ fetch: async () => ({ ok: !fail, status: 404, text: async () => sample }) });
    assert.equal(await retry.preview.load(), false); assert.equal(retry.loaded.length, 0); assert.equal(retry.button.disabled, false); assert.match(retry.status.textContent, /404/);
    fail = false; assert.equal(await retry.preview.load(), true);
    const wait = deferred(), cancelled = harness({ fetch: async () => { await wait.promise; return { ok: true, text: async () => sample }; } });
    const work = cancelled.preview.load(); cancelled.preview.cancel('通常のファイル読み込みを開始'); wait.resolve();
    assert.equal(await work, false); assert.equal(cancelled.loaded.length, 0); assert.match(cancelled.status.textContent, /通常のファイル/);
    const raceGate = deferred(), race = harness({ fetch: async () => { await raceGate.promise; return { ok: true, text: async () => sample }; } });
    const racing = race.preview.load(); race.state.fileCount = 1; raceGate.resolve(); assert.equal(await racing, false); assert.equal(race.loaded.length, 0);
    const invalid = harness({ loadLog: async () => null }); assert.equal(await invalid.preview.load(), false); assert.equal(invalid.configured.length, 0); assert.equal(invalid.button.disabled, false);
    const configureGate = deferred(); let mapSignal;
    const mapCancel = harness({ configure: async (_id, _map, _current, signal) => { mapSignal = signal; await configureGate.promise; return true; } });
    const mapWork = mapCancel.preview.load(); await tick(); mapCancel.preview.cancel('背景の読込を中止');
    assert.equal(mapSignal.aborted, true); configureGate.resolve(); assert.equal(await mapWork, false);

    const postLoad = deferred(), parser = parserEnvironment(() => postLoad.promise), settled = [];
    const signal = new AbortController();
    await parser.env.parseCSV(new File([sample], Preview.LOG_NAME), null, Preview.IMPORT_OPTIONS, { signal: signal.signal, done: id => settled.push(id) });
    await tick(); assert.equal(settled.length, 0, 'Completion waits for the async post-parse work');
    assert.equal(Object.keys(parser.env.state.files).length, 1);
    postLoad.resolve(); await tick(); assert.equal(settled.length, 1); assert.ok(settled[0]); assert.equal(parser.errors.length, 0);
    assert.equal(parser.env.state.files[settled[0]].timeData.length, 1201);
    const bad = parserEnvironment(), failed = [];
    await bad.env.parseCSV(new File(['Time,X\ns,rpm\nbad,2'], 'bad.csv'), null, Preview.IMPORT_OPTIONS, { done: id => failed.push(id) });
    await tick(); assert.deepEqual(failed, [null]); assert.equal(Object.keys(bad.env.state.files).length, 0);
    const delayed = deferred(), aborted = parserEnvironment(), stopped = [], abort = new AbortController();
    const file = { name: 'pending.csv', size: sample.length, text: async () => { await delayed.promise; return sample; } };
    await aborted.env.parseCSV(file, null, Preview.IMPORT_OPTIONS, { signal: abort.signal, done: id => stopped.push(id) });
    abort.abort(); delayed.resolve(); await tick(); assert.deepEqual(stopped, [null]); assert.equal(Object.keys(aborted.env.state.files).length, 0);
    assert.equal(aborted.env._origFileById.size, 0, 'An aborted demo releases the retained original file');
    const duringPost = deferred(), cancelledPost = parserEnvironment(() => duringPost.promise), postResults = [], stopPost = new AbortController();
    await cancelledPost.env.parseCSV(new File([sample], Preview.LOG_NAME), null, Preview.IMPORT_OPTIONS, { signal: stopPost.signal, done: id => postResults.push(id) });
    await tick(); stopPost.abort(); duringPost.resolve(); await tick(); assert.deepEqual(postResults, [null], 'Cancellation during post-parse setup settles once');
    h.preview.destroy();
    console.log('dev-preview: local gate, temporary storage, bundled data, empty-only load, retry/cancel/races and actual parser completion passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
