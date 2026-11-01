'use strict';
// Application event-flow regression without a browser or optional dependencies.
// The DOM and chart are test doubles; CSV parsing and the workspace module are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Papa = require('../lib/papaparse.min.js');
const FuelMap = require('../fuel-map-utils.js');
const Compare = require('../compare-utils.js');
const XY = require('../xy-utils.js');

function mockDOM() {
    const ids = new Map();
    const document = { activeElement: null, getElementById: id => ids.get(id) || null };
    class Element {
        constructor(tag = 'div') {
            this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map();
            this.value = ''; this.checked = false; this.disabled = false; this.open = false; this.files = [];
            this.dataset = {}; this.style = {}; this.validity = { badInput: false }; this._text = '';
            const classes = new Set();
            this.classList = { add: (...items) => items.forEach(item => classes.add(item)), remove: (...items) => items.forEach(item => classes.delete(item)),
                contains: item => classes.has(item), toggle: (item, force) => { const next = force === undefined ? !classes.has(item) : !!force; next ? classes.add(item) : classes.delete(item); return next; },
                reset: text => { classes.clear(); text.split(/\s+/).filter(Boolean).forEach(item => classes.add(item)); } };
        }
        set id(value) { this._id = value; ids.set(value, this); }
        get id() { return this._id || ''; }
        set className(value) { this.classList.reset(value); }
        set textContent(value) { this._text = String(value); this.children = []; }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
        set innerHTML(html) {
            this.children = []; this._text = '';
            const stack = [this], voidTags = new Set(['INPUT', 'BR', 'HR', 'IMG', 'META', 'LINK']);
            for (const token of String(html).matchAll(/<\/?[\w-]+\b[^>]*>|[^<]+/g)) {
                const text = token[0];
                if (text.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
                if (!text.startsWith('<')) { stack.at(-1)._text += text; continue; }
                const element = new Element(text.match(/^<([\w-]+)/)[1]);
                for (const attribute of text.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)) element.setAttribute(attribute[1], attribute[2] ?? '');
                stack.at(-1).appendChild(element);
                if (!voidTags.has(element.tagName) && !text.endsWith('/>')) stack.push(element);
            }
            if (this.tagName === 'SELECT') this.value = this.children.find(item => item.tagName === 'OPTION')?.value || '';
        }
        setAttribute(name, value) {
            this.attributes[name] = String(value);
            if (name === 'id') this.id = value;
            else if (name === 'class') this.className = value;
            else if (name === 'value') this.value = value;
            else if (['checked', 'disabled', 'open'].includes(name)) this[name] = true;
            else if (name === 'type') this.type = value;
            else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
        }
        getAttribute(name) { return this.attributes[name] ?? null; }
        removeAttribute(name) { delete this.attributes[name]; }
        appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
        contains(child) { return child === this || this.children.some(item => item.contains(child)); }
        get isConnected() { return document.body?.contains(this) || false; }
        matches(selector) { return selector.split(',').some(part => part.startsWith('#') ? this.id === part.slice(1) : part.startsWith('.') ? this.classList.contains(part.slice(1)) : this.tagName === part.toUpperCase()); }
        closest(selector) { for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element; return null; }
        querySelector(selector) { for (const child of this.children) { if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; } return null; }
        addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
        removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
        async emit(type) { return Promise.all((this.listeners.get(type) || []).map(listener => listener({ type, target: this, preventDefault() {}, stopPropagation() {} }))); }
        async click() { if (!this.disabled) return this.emit('click'); }
        focus() { document.activeElement = this; }
        scrollIntoView(options) { this.lastScroll = options; }
        getBoundingClientRect() { return { top: 0, left: 0, right: 470, bottom: 600, width: 470, height: 600 }; }
        getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; }
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this); }
    }
    document.createElement = tag => new Element(tag);
    document.documentElement = new Element('html'); document.body = new Element('body');
    document.documentElement.appendChild(document.body); document.activeElement = document.body;
    const container = new Element(); container.className = 'compare-body'; document.body.appendChild(container);
    const opener = new Element('button'); opener.id = 'xy-panel-toggle'; document.body.appendChild(opener);
    document.querySelector = selector => document.body.querySelector(selector);
    return { document, Element, get: id => document.getElementById(id) };
}

function harness() {
    const dom = mockDOM(), frames = new Map(), loadCalls = []; let nextFrame = 0, workspace;
    const file = { name: 'engine.csv', shortName: 'engine', role: 'main', offset: 0, timeData: Float64Array.from([0, 1, 2]),
        columns: [{ id: 'rpm', name: 'Engine_Speed', unit: 'rpm' }, { id: 'torque', name: 'Engine_Torque', unit: 'Nm' }, { id: 'throttle', name: 'Throttle', unit: '%' }],
        colData: { rpm: Float64Array.from([1000, 1200, 1400]), torque: Float64Array.from([20, 30, 40]), throttle: Float64Array.from([10, 15, 20]) } };
    const state = { files: { main: file }, selectedNames: new Set(['Engine_Speed', 'Engine_Torque']), theme: 'light', customRAMs: [], channelAliases: {}, comparison: { matches: {} } };
    let context = { scope: 'all', range: [0, 2], rawTime: false, label: '全体 0–2 s' };
    const chart = { options: {}, handlers: {}, actions: [], on(type, fn) { this.handlers[type] = fn; }, clear() { this.options = {}; }, resize() {}, dispose() {},
        dispatchAction(action) { this.actions.push(action); },
        setOption(options, flags = {}) {
            if (flags.notMerge) { this.options = options; return; }
            const updates = new Map((options.series || []).map(series => [series.id, series]));
            const series = (this.options.series || []).map(previous => { const next = updates.get(previous.id); updates.delete(previous.id); return next ? { ...previous, ...next } : previous; });
            this.options = { ...this.options, ...options, series: [...series, ...updates.values()] };
        }, getOption() { return this.options; } };
    const globals = { console, document: dom.document, HTMLElement: dom.Element, ResizeObserver: class { observe() {} disconnect() {} },
        getComputedStyle: () => ({ getPropertyValue: name => ({ '--text-secondary': state.theme === 'dark' ? '#b7c7db' : '#536875', '--text-primary': state.theme === 'dark' ? '#edf5ff' : '#172a3b', '--bg-surface': state.theme === 'dark' ? '#171c26' : '#ffffff', '--border': state.theme === 'dark' ? '#354052' : '#d7e1e8' }[name] || '') }), crypto: webcrypto, TextEncoder,
        requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
        CSVFuelMap: FuelMap, CSVCompare: Compare, CSVXYUtils: XY, Papa, echarts: { init: () => chart, graphic: { clipRectByRect: shape => shape } } };
    globals.window = globals;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../xy-workspace.js'), 'utf8'), globals, { filename: 'xy-workspace.js' });
    const api = { state, esc: text => String(text), main: () => state.files.main || null, mainId: () => state.files.main ? 'main' : null, resolve: (f, name) => f.columns.find(column => column.name === name),
        loadColumns: async (fid, names) => { loadCalls.push({ fid, names: [...names] }); }, getContext: () => context, effectiveOffset: f => f.offset, fileLabel: f => f.shortName, fileColor: () => '#c84b57',
        activatePanel: kind => workspace.setVisible(kind === 'xy'), save() {}, resize() {}, warning() {}, clearFocus() {}, focusPoint() {} };
    workspace = globals.CSVXYWorkspace(api);
    const flush = async () => { for (let pass = 0; pass < 12; pass++) { const batch = [...frames]; frames.clear(); for (const [, callback] of batch) callback(); await new Promise(resolve => setImmediate(resolve)); } };
    const change = async (id, value) => { const element = dom.get(id); if (typeof value === 'boolean') element.checked = value; else element.value = value; await element.emit('change'); await flush(); };
    const upload = async (text, name = 'map.csv') => { const input = dom.get('xy-map-file'); input.files = [{ name, size: Buffer.byteLength(text), lastModified: 1, text: async () => text }]; await input.emit('change'); await flush(); };
    return { ...dom, file, state, workspace, chart, globals, flush, change, upload, loadCalls, setContext: value => { context = value; },
        async redraw() { workspace.schedule(); await flush(); },
        async open() { workspace.open(); await flush(); await change('xy-mode', 'map'); await change('xy-map-source', 'external'); await change('xy-map-style', 'fill'); },
        async apply() { await dom.get('xy-map-apply').click(); await flush(); },
        feedback() { const feedback = dom.get('xy-map-feedback'); assert.ok(feedback, 'Map import feedback must exist beside the apply controls'); return feedback.textContent; } };
}

const long = 'rpm,Nm,g/kWh\n1000,20,300\n1400,20,280\n1000,40,260\n1400,40,250\n';
const matrix = 'rpm\\Nm,1000,1400\n20,300,280\n40,260,250\n';
const points = h => (h.chart.getOption().series || []).filter(series => series.id.startsWith('xy-points-'));
const contourLines = h => (h.chart.getOption().series || []).filter(series => series.id.startsWith('xy-contour-') && series.type === 'line');
const cells = h => (h.chart.getOption().series || []).find(series => series.id === 'xy-map-cells');
const axisBounds = h => JSON.stringify(['xAxis', 'yAxis'].map(key => [h.chart.getOption()[key].min, h.chart.getOption()[key].max]));
const mapSnapshot = h => JSON.stringify(h.workspace.inspect().map);
function assertBackgroundOnly(h, expectedMap, reason, description) {
    assert.equal(h.workspace.inspect().map?.stats.eligible, 4, `${description}: valid background still renders`);
    assert.equal(h.chart.getOption().series.find(series => series.id === 'xy-map-cells')?.data.length, 4, `${description}: map cells reach the chart`);
    assert.equal(mapSnapshot(h), expectedMap, `${description}: background values are unchanged`);
    assert.equal(points(h).length, 0, `${description}: unavailable inputs are not drawn as operating points`);
    const notice = h.get('xy-point-status');
    assert.ok(notice, 'A separate operating-point notice is present above the chart');
    assert.match(notice.textContent, reason, `${description}: the operating-point requirement is explained`);
    assert.equal(notice.classList.contains('hidden'), false, 'The operating-point notice is visible');
    assert.equal(h.get('xy-map-settings').contains(notice), false, 'The explanation remains available when background settings are collapsed');
    assert.deepEqual(h.loadCalls, [], `${description}: no unavailable operating-point columns are loaded`);
}

async function run() {
    const h = harness(); await h.open();
    assert.equal(h.get('xy-map-apply').disabled, true, 'No selected CSV cannot be applied');
    assert.match(h.feedback(), /CSV|ファイル|選|チェック|確認/);
    assert.ok(h.get('xy-map-external-fields').contains(h.get('xy-map-feedback')), 'Feedback belongs to the external import controls, not below all display settings');
    assert.match(h.get('xy-map-apply').getAttribute('aria-describedby'), /xy-map-feedback/, 'The disabled button exposes its explanation to assistive technology');
    await h.upload(long);
    assert.equal(h.get('xy-map-apply').disabled, true, 'Selecting a valid CSV does not consent to its units');
    assert.match(h.feedback(), /単位/); assert.match(h.feedback(), /チェック|確認/);
    await h.apply(); assert.equal(h.workspace.inspect().map, null, 'A disabled apply button does not create a map');
    await h.change('xy-map-confirm-units', true);
    assert.equal(h.get('xy-map-apply').disabled, false); assert.match(h.feedback(), /適用/);
    await h.change('xy-map-confirm-units', false);
    assert.equal(h.get('xy-map-apply').disabled, true); assert.match(h.feedback(), /単位/);
    await h.change('xy-map-confirm-units', true); await h.apply();
    assert.equal(h.workspace.inspect().map?.stats.eligible, 4, 'Valid three-column map reaches chart output');
    assert.equal(h.chart.getOption().series.find(series => series.id === 'xy-map-cells').data.length, 4);
    assert.match(h.feedback(), /適用/);
    await h.upload(matrix); await h.change('xy-map-format', 'matrix'); await h.change('xy-map-confirm-units', true); await h.apply();
    assert.equal(h.workspace.inspect().map?.format, 'matrix');
    assert.equal(h.workspace.inspect().map?.zz[1][1], 250, 'Matrix data retains its actual cell value');

    await h.upload('rpm\\Nm,1000,1400\n20,300\n40,260,250\n', 'broken.csv');
    await h.change('xy-map-confirm-units', true); await h.apply();
    assert.equal(h.workspace.inspect().map, null); assert.match(h.feedback(), /列数|形式/);
    assert.equal(h.get('xy-map-feedback').lastScroll?.block, 'nearest', 'Applying an invalid file brings the error into view');

    await h.upload('rpm\\lb-ft,1000,1400\n20,300,280\n40,260,250\n', 'wrong-units.csv');
    await h.change('xy-map-confirm-units', true); await h.apply();
    assert.equal(h.workspace.inspect().map, null); assert.match(h.feedback(), /単位/);

    const independent = harness(); await independent.open();
    await independent.change('xy-y-select', 'Throttle');
    independent.loadCalls.length = 0;
    await independent.upload(long, '練習用_燃費率ﾏｯﾌﾟ.csv');
    await independent.change('xy-map-confirm-units', true); await independent.apply();
    assert.equal(independent.workspace.inspect().map?.stats.eligible, 4, 'Applying a background with Throttle [%] selected must display the map');
    const background = mapSnapshot(independent);
    assertBackgroundOnly(independent, background, /トルク|Nm/, 'Throttle [%] is not torque');
    assert.equal(independent.get('xy-map-settings').open, false, 'Successful apply closes settings while leaving the point notice visible');
    assert.match(independent.chart.getOption().xAxis.name, /rpm/);
    assert.match(independent.chart.getOption().yAxis.name, /Nm/);

    await independent.change('xy-y-select', 'Engine_Torque');
    assert.equal(points(independent)[0]?.data.length, 3, 'Selecting real torque restores all measured operating points');
    assert.equal(points(independent)[0].data[0].value[1], 20, 'Restored points use measured torque, not throttle');
    assert.equal(mapSnapshot(independent), background, 'Changing operating-point axes does not alter the background');
    assert.equal(independent.get('xy-point-status').textContent, '', 'The point warning clears when the inputs are usable');

    independent.workspace.cursor(1);
    assert.equal(independent.chart.getOption().series.find(series => series.id === 'xy-cursor-main').data.length, 1, 'Valid points participate in time-cursor linking');
    independent.loadCalls.length = 0;
    await independent.change('xy-y-select', 'Throttle');
    independent.workspace.cursor(2);
    assertBackgroundOnly(independent, background, /トルク|Nm/, 'Changing from valid torque to throttle');
    assert.equal(independent.chart.getOption().series.some(series => series.id.startsWith('xy-cursor-')), false, 'Invalid axes cannot revive a previous operating-point cursor');
    await independent.change('xy-y-select', 'Engine_Torque');

    independent.loadCalls.length = 0;
    independent.setContext({ scope: 'selection', range: null, rawTime: false, label: '選択区間なし' });
    await independent.redraw();
    assertBackgroundOnly(independent, background, /解析|区間|範囲/, 'No analysis interval');
    independent.setContext({ scope: 'all', range: [0, 2], rawTime: false, label: '全体 0–2 s' });
    await independent.redraw();

    const columns = independent.file.columns;
    independent.loadCalls.length = 0;
    independent.file.columns = columns.filter(column => column.id !== 'rpm');
    await independent.redraw();
    assertBackgroundOnly(independent, background, /回転数|rpm/, 'No RPM column');
    independent.loadCalls.length = 0;
    independent.file.columns = [];
    await independent.redraw();
    assertBackgroundOnly(independent, background, /列|軸|ログ/, 'No operating-point columns');
    independent.loadCalls.length = 0;
    delete independent.state.files.main;
    await independent.redraw();
    assertBackgroundOnly(independent, background, /ログ/, 'No driving log');
    independent.state.files.main = independent.file;
    independent.file.columns = columns;
    await independent.redraw();

    await independent.change('xy-mode', 'scatter');
    await independent.change('xy-x-select', 'Throttle');
    await independent.change('xy-y-select', 'Engine_Torque');
    assert.equal(points(independent)[0]?.data.length, 3, 'Scatter mode still accepts arbitrary compatible X/Y units');
    assert.equal(points(independent)[0].data[0].value[0], 10);
    assert.match(independent.chart.getOption().xAxis.name, /Throttle.*%/);
    assert.equal(independent.workspace.inspect().map, null, 'Scatter mode does not show the fuel-map background');
    assert.equal(independent.get('xy-point-status').textContent, '', 'Map-only point warnings are cleared in scatter mode');

    const sampled = harness();
    sampled.file.columns.push({ id: 'mapRpm', name: 'sfc_ne', unit: 'rpm' }, { id: 'mapTorque', name: 'sfc_te', unit: 'Nm' }, { id: 'sfc', name: 'sfc_g_kwh', unit: 'g/kWh' });
    sampled.file.colData.mapRpm = Float64Array.from([1000, 1400, 1800]);
    sampled.file.colData.mapTorque = Float64Array.from([20, 40, 60]);
    sampled.file.colData.sfc = Float64Array.from([300, 280, 260]);
    await sampled.open(); await sampled.change('xy-y-select', 'Throttle');
    sampled.loadCalls.length = 0;
    await sampled.change('xy-map-source', 'main');
    assert.equal(sampled.workspace.inspect().map?.stats.eligible, 3, 'SFC background columns also render independently of invalid operating-point axes');
    assert.equal(points(sampled).length, 0);
    assert.deepEqual(sampled.loadCalls, [{ fid: 'main', names: ['sfc_ne', 'sfc_te', 'sfc_g_kwh'] }], 'Only the three background columns are loaded when operating-point axes are invalid');
    assert.match(sampled.get('xy-point-status').textContent, /Nm|トルク/);

    const standalone = harness(); delete standalone.state.files.main;
    standalone.setContext({ scope: 'all', range: null, rawTime: false, label: 'ログなし' });
    await standalone.open(); await standalone.upload(long); await standalone.change('xy-map-confirm-units', true); await standalone.apply();
    assertBackgroundOnly(standalone, mapSnapshot(standalone), /ログ/, 'Importing a background before opening any driving log');

    const withoutTorque = harness();
    withoutTorque.file.columns = withoutTorque.file.columns.filter(column => column.id !== 'torque');
    await withoutTorque.open();
    assert.equal(withoutTorque.get('xy-x-select').value, 'Engine_Speed', 'RPM is still selected automatically when available');
    assert.equal(withoutTorque.get('xy-y-select').value, '', 'A log with no Nm column leaves torque unselected instead of selecting throttle');
    assert.equal(withoutTorque.workspace.inspect().config.y, '');
    withoutTorque.loadCalls.length = 0;
    await withoutTorque.upload(long); await withoutTorque.change('xy-map-confirm-units', true); await withoutTorque.apply();
    assertBackgroundOnly(withoutTorque, mapSnapshot(withoutTorque), /トルク|Nm/, 'Driving log with RPM and throttle but no torque');
    await withoutTorque.change('xy-map-style', 'lines');
    assert.ok(contourLines(withoutTorque).some(series => series.data.length), 'A torque-free log can still view a contour-only background');
    assert.equal(points(withoutTorque).length, 0, 'Contour display does not manufacture operating-point torque');
    assert.equal(cells(withoutTorque), undefined);
    assert.match(withoutTorque.get('xy-point-status').textContent, /トルク|Nm/);
    await withoutTorque.change('xy-mode', 'scatter');
    assert.equal(withoutTorque.get('xy-y-select').value, 'Throttle', 'Returning to scatter restores its ordinary Y-axis fallback');
    assert.equal(points(withoutTorque)[0]?.data.length, 3, 'Returning to scatter displays the available RPM/throttle points');
    assert.equal(points(withoutTorque)[0].data[0].value[1], 10);
    assert.equal(withoutTorque.get('xy-point-status').textContent, '', 'Returning to scatter clears the missing-torque notice');

    const detailed = harness(); await detailed.open();
    await detailed.upload('rpm\\Nm,1000,1400,1800\n20,300,,280\n40,270,250,260\n60,260,240,250\n');
    await detailed.change('xy-map-confirm-units', true); await detailed.apply();
    const detailedBackground = mapSnapshot(detailed), fullBounds = axisBounds(detailed);
    assert.equal(detailed.workspace.inspect().map.stats.emptyCells, 1);
    assert.ok(Number.isNaN(detailed.workspace.inspect().map.zz[0][1]), 'A missing map value is kept as unavailable');
    assert.equal(cells(detailed).data.length, 8);
    assert.equal(contourLines(detailed).length, 0, 'Fill mode does not compute or display contour lines');
    const fillBuilds = detailed.workspace.inspect().contourBuildCount;

    await detailed.change('xy-map-style', 'lines');
    assert.equal(cells(detailed), undefined, 'Line-only mode removes the colored cell series');
    assert.equal(detailed.chart.getOption().visualMap.length, 0, 'A cell-color visualMap must not be applied to contour lines or operating points');
    assert.ok(contourLines(detailed).some(series => series.data.length > 0), 'Line-only mode draws actual contour geometry');
    assert.equal(points(detailed)[0].data.length, 3, 'Operating points remain available above the line-only background');
    assert.equal(mapSnapshot(detailed), detailedBackground, 'Switching representation does not change map values or holes');
    assert.equal(axisBounds(detailed), fullBounds, 'The line-only view keeps the entire background domain');
    assert.equal(detailed.workspace.inspect().contourBuildCount, fillBuilds + 1, 'First line view computes its contour geometry once');
    const tenLines = contourLines(detailed).length;
    await detailed.change('xy-map-contour-step', '5');
    assert.ok(contourLines(detailed).length > tenLines, 'A 5 g/kWh interval provides more detail than 10 g/kWh');
    assert.equal(mapSnapshot(detailed), detailedBackground);
    assert.equal(axisBounds(detailed), fullBounds);
    assert.ok(detailed.chart.getOption().series.some(series => String(series.id).includes('label') && series.data.length > 0), 'Major contours have a separate, bounded label series');
    const built = detailed.workspace.inspect().contourBuildCount;
    const lineData = JSON.stringify(contourLines(detailed).map(series => series.data));
    detailed.workspace.cursor(1);
    assert.equal(detailed.workspace.inspect().contourBuildCount, built, 'Waveform cursor movement does not rebuild contours');
    detailed.setContext({ scope: 'selection', range: [1, 2], rawTime: false, label: '選択区間 1–2 s' }); await detailed.redraw();
    assert.equal(points(detailed)[0].data.length, 2);
    assert.equal(detailed.workspace.inspect().contourBuildCount, built, 'Changing the driving interval reuses background geometry');
    assert.equal(JSON.stringify(contourLines(detailed).map(series => series.data)), lineData);
    const lightLine = contourLines(detailed).find(series => series.data.length).lineStyle.color;
    detailed.state.theme = 'dark'; await detailed.redraw();
    assert.equal(detailed.workspace.inspect().contourBuildCount, built, 'Theme changes only restyle cached contours');
    assert.notEqual(contourLines(detailed).find(series => series.data.length).lineStyle.color, lightLine, 'Contour lines adapt to the background theme');
    await detailed.change('xy-map-style', 'both');
    assert.equal(cells(detailed).data.length, 8); assert.ok(contourLines(detailed).length > 0);
    assert.equal(detailed.workspace.inspect().contourBuildCount, built, 'Showing fill alongside existing lines reuses contour geometry');
    assert.equal(axisBounds(detailed), fullBounds);
    const mapVisual = detailed.chart.getOption().visualMap[0];
    assert.ok(mapVisual.seriesIndex.every(index => detailed.chart.getOption().series[index].id === 'xy-map-cells'), 'Color mapping targets only colored map cells');
    assert.equal(mapVisual.dimension, 8, 'Actual map values stay separate from display-only color values');

    assert.equal(detailed.get('xy-map-zoom-btn').getAttribute('aria-pressed'), 'false', 'Map zoom starts with an explicit opt-in');
    assert.equal(detailed.chart.getOption().dataZoom.length, 2, 'Map zoom controls both coordinate axes');
    assert.ok(detailed.chart.getOption().dataZoom.every(item => item.filterMode === 'none' && item.zoomOnMouseWheel === false), 'Page scrolling must not unexpectedly zoom or discard map geometry');
    await detailed.get('xy-map-zoom-btn').click(); await detailed.flush();
    assert.equal(detailed.get('xy-map-zoom-btn').getAttribute('aria-pressed'), 'true');
    assert.ok(detailed.chart.getOption().dataZoom.every(item => item.zoomOnMouseWheel === true), 'Explicit opt-in enables wheel/pinch zoom');
    for (const item of detailed.chart.getOption().dataZoom) { item.start = 20; item.end = 80; }
    detailed.chart.handlers.datazoom();
    await detailed.change('xy-map-style', 'lines');
    assert.ok(detailed.chart.getOption().dataZoom.every(item => item.start === 20 && item.end === 80), 'Switching representation preserves the chosen coordinate range');
    detailed.state.theme = 'light'; await detailed.redraw();
    assert.ok(detailed.chart.getOption().dataZoom.every(item => item.start === 20 && item.end === 80), 'A theme change preserves map zoom');
    assert.equal(detailed.get('xy-map-zoom-btn').getAttribute('aria-pressed'), 'true');
    await detailed.change('xy-map-style', 'both');
    await detailed.get('xy-map-reset-view').click();
    const reset = detailed.chart.actions.find(action => action.type === 'dataZoom');
    assert.ok(reset, 'Reset dispatches a chart zoom reset');
    assert.deepEqual(Array.from(reset.batch, item => item.dataZoomId).sort(), ['xy-x-zoom', 'xy-y-zoom']);
    assert.ok(reset.batch.every(item => item.start === 0 && item.end === 100), 'Reset covers the full coordinate domain');
    assert.equal(detailed.get('xy-map-zoom-btn').getAttribute('aria-pressed'), 'false', 'Reset also returns to ordinary page scrolling');
    assert.equal(detailed.workspace.inspect().contourBuildCount, built, 'Resetting the view does not rebuild the background');

    const savedDetailed = detailed.workspace.collectSettings();
    assert.equal(savedDetailed.mapStyle, 'both'); assert.equal(savedDetailed.contourStep, 5);
    assert.equal(Object.hasOwn(savedDetailed, 'contours'), false, 'Only the consolidated display choice is saved');
    detailed.workspace.applySettings(savedDetailed, { preserveMap: true }); await detailed.flush();
    assert.equal(detailed.get('xy-map-style').value, 'both'); assert.equal(Number(detailed.get('xy-map-contour-step').value), 5);
    assert.equal(mapSnapshot(detailed), detailedBackground, 'Restoring settings can retain an explicitly preserved external map');
    for (const [contours, expectedStyle] of [[false, 'fill'], [true, 'both']]) {
        const legacy = { ...savedDetailed, contours }; delete legacy.mapStyle; delete legacy.contourStep;
        detailed.workspace.applySettings(legacy, { preserveMap: true }); await detailed.flush();
        assert.equal(detailed.workspace.inspect().config.mapStyle, expectedStyle, 'Legacy checkbox settings retain their visual meaning');
        assert.equal(detailed.get('xy-map-style').value, expectedStyle);
        assert.equal(detailed.workspace.inspect().config.contourStep, 10);
    }
    await detailed.change('xy-map-style', 'lines');
    await detailed.change('xy-map-contour-step', '0');
    assert.equal(contourLines(detailed).length, 0, 'An invalid contour interval clears old line geometry');
    assert.match(detailed.get('xy-map-status').textContent, /間隔|刻み|0より|正/);
    assert.equal(mapSnapshot(detailed), detailedBackground, 'An invalid display interval does not erase the imported map');
    await detailed.change('xy-map-style', 'fill');
    assert.equal(cells(detailed).data.length, 8, 'Fill remains usable when the unused contour interval is invalid');
    await detailed.change('xy-map-contour-step', '5'); await detailed.change('xy-map-style', 'lines');
    assert.ok(contourLines(detailed).length > 0, 'Correcting the interval restores contours');
    await detailed.change('xy-map-contour-step', '0.1');
    assert.ok(contourLines(detailed).length > 8 && contourLines(detailed).length <= 81, 'A very fine requested interval is bounded without reverting to eight low-end contours');
    // The 280/300 values border the missing cell, so they must not manufacture lines there.
    assert.ok(Math.max(...contourLines(detailed).map(series => Number(series.id.slice('xy-contour-'.length)))) >= 265, 'Bounded contours still cover the high end of the fully populated cells');
    assert.match(detailed.get('xy-map-status').textContent, /調整|変更/, 'Automatic interval adjustment is disclosed');

    const constant = harness(); await constant.open();
    await constant.upload('rpm\\Nm,1000,1400\n20,250,250\n40,250,250\n');
    await constant.change('xy-map-confirm-units', true); await constant.apply();
    const constantBounds = axisBounds(constant); await constant.change('xy-map-style', 'lines');
    assert.equal(contourLines(constant).length, 0, 'A constant map does not invent contour geometry');
    assert.match(constant.get('xy-map-status').textContent, /一定|同じ|等高線.*(?:なし|ありません|描け|生成)/, 'No-line maps explain why the background appears empty');
    assert.equal(axisBounds(constant), constantBounds, 'No contour intersections still retain a meaningful map domain');
    assert.equal(constant.workspace.inspect().map.stats.eligible, 4);
    await constant.change('xy-map-style', 'fill');
    assert.equal(cells(constant).data.length, 4, 'A constant map can still be inspected in fill mode');

    const canceled = harness(); await canceled.open();
    let finishRead;
    canceled.get('xy-map-file').files = [{ name: 'delayed.csv', size: long.length, lastModified: 1, text: () => new Promise(resolve => { finishRead = resolve; }) }];
    const reading = canceled.get('xy-map-file').emit('change'); await canceled.flush();
    assert.equal(canceled.get('xy-map-apply').disabled, true); assert.match(canceled.feedback(), /読/);
    canceled.setContext({ scope: 'selection', range: [1, 2], rawTime: false, label: '選択区間 1–2 s' });
    finishRead(long); await reading; await canceled.flush();
    assert.equal(canceled.get('xy-map-apply').disabled, true); assert.equal(canceled.workspace.inspect().map, null);
    assert.match(canceled.feedback(), /変更|選び直/);
    await canceled.upload(long); await canceled.change('xy-map-confirm-units', true); await canceled.apply();
    assert.equal(canceled.workspace.inspect().map?.stats.eligible, 4, 'Reselecting after a canceled import can succeed');
    h.workspace.destroy(); independent.workspace.destroy(); sampled.workspace.destroy(); standalone.workspace.destroy(); withoutTorque.workspace.destroy(); detailed.workspace.destroy(); constant.workspace.destroy(); canceled.workspace.destroy();
    console.log('xy-workspace: independent backgrounds, detailed contours, style/interval settings, cache, theme, zoom reset, legacy settings, eligible operating points, scatter and import feedback passed (DOM/chart mocks)');
}

module.exports = { harness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
