'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { measureSplit } = require('../xy-layout.js');

assert.deepEqual(measureSplit(1200, .5), { stacked: false, ratio: .5, available: 1192, mapWidth: 596, waveWidth: 596, minRatio: 320 / 1192, maxRatio: 872 / 1192 });
for (const width of [720, 800, 1200, 2200]) for (const ratio of [.2, .5, .8]) {
    const size = measureSplit(width, ratio);
    assert.ok(size.mapWidth >= 320 && size.waveWidth >= 320, 'Both panes retain a usable width');
    assert.equal(size.mapWidth + size.waveWidth + 8, width, 'The separator is included in the split budget');
    assert.equal(size.ratio, ratio, 'Narrow layouts do not overwrite the preferred ratio');
}
assert.equal(measureSplit(719, .8).stacked, true);
assert.equal(measureSplit(720, .8).stacked, false);
assert.equal(measureSplit(0, NaN).ratio, .5);
assert.equal(measureSplit(1000, -1).ratio, .2);
assert.equal(measureSplit(1000, 2).ratio, .8);

function harness() {
    const frames = new Map(), observers = [], elements = []; let nextFrame = 0, resizes = 0, width = 1200, height = 700;
    const commits = [], document = {};
    class Element {
        constructor() {
            this.ownerDocument = document; this.children = []; this.attributes = {}; this.listeners = new Map(); this.textContent = '';
            const classes = new Set();
            this.classList = { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)),
                contains: value => classes.has(value), toggle: (value, on) => on ? classes.add(value) : classes.delete(value) };
            const properties = new Map();
            this.style = { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key), getPropertyValue: key => properties.get(key) || '' };
            elements.push(this);
        }
        set className(value) { this.classList.add(...value.split(/\s+/)); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return this.attributes[name]; }
        insertBefore(child, before) { child.parentElement = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
        appendChild(child) { this.insertBefore(child, null); }
        querySelector(selector) { return this.children.find(child => child.classList.contains(selector.slice(1))) || null; }
        addEventListener(name, listener) { this.listeners.set(name, listener); }
        removeEventListener(name) { this.listeners.delete(name); }
        emit(name, value = {}) { const event = { preventDefault() { this.prevented = true; }, ...value }; this.listeners.get(name)?.(event); return event; }
        focus() { document.activeElement = this; }
        setPointerCapture(id) { this.pointer = id; }
        hasPointerCapture(id) { return this.pointer === id; }
        releasePointerCapture() { this.pointer = null; }
        remove() { this.parentElement.children = this.parentElement.children.filter(item => item !== this); }
    }
    document.createElement = () => new Element();
    const container = new Element(), wave = new Element(), panel = new Element(), scroll = new Element();
    wave.className = 'chart-container'; panel.id = 'xy-workspace'; scroll.className = 'xy-workspace-scroll';
    container.appendChild(wave); container.appendChild(panel); panel.appendChild(scroll);
    container.getBoundingClientRect = () => ({ left: 100, right: 100 + width, width, height });
    panel.getBoundingClientRect = () => ({ width: container.classList.contains('xy-layout-expanded') || container.classList.contains('xy-layout-stacked') ? width : parseFloat(panel.style.getPropertyValue('--xy-pane-width')) || 470,
        height: container.classList.contains('xy-layout-stacked') ? 600 : height });
    wave.getBoundingClientRect = () => ({ width: container.classList.contains('xy-layout-stacked') ? width : width - 8 - panel.getBoundingClientRect().width,
        height: container.classList.contains('xy-layout-stacked') ? 320 : height });
    const globals = { document, module: { exports: {} },
        requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); },
        ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../xy-layout.js'), 'utf8'), globals);
    const layout = globals.module.exports.createLayout({ panel, container, ratio: .5, onResize: () => resizes++, onCommit: ratio => commits.push(ratio) });
    const flush = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback()); };
    const handle = elements.find(element => element.id === 'xy-split-handle');
    return { layout, container, panel, handle, commits, observers, frames, flush, get resizes() { return resizes; },
        resize(nextWidth, nextHeight = height) { width = nextWidth; height = nextHeight; observers.forEach(observer => observer.callback()); } };
}

const h = harness(); h.layout.setState({ visible: true, expanded: false }); h.flush();
assert.equal(h.handle.getAttribute('role'), 'separator');
assert.equal(h.handle.getAttribute('aria-orientation'), 'vertical');
assert.equal(h.handle.classList.contains('hidden'), false);
assert.equal(h.resizes, 1);
for (let i = 0; i < 10; i++) h.resize(1200);
assert.equal(h.frames.size, 1, 'Observer notifications share one animation frame');
h.flush(); assert.equal(h.resizes, 1, 'Same-size observer notifications do not redraw either chart');

const before = h.layout.getRatio();
h.handle.emit('keydown', { key: 'ArrowLeft' }); h.flush();
assert.ok(h.layout.getRatio() > before, 'Moving the boundary left grows the right map pane');
h.handle.emit('keydown', { key: 'Home' }); h.flush();
assert.equal(parseFloat(h.panel.style.getPropertyValue('--xy-pane-width')), 320);
h.handle.emit('keydown', { key: 'End' }); h.flush();
assert.equal(parseFloat(h.panel.style.getPropertyValue('--xy-pane-width')), 872);
h.handle.emit('dblclick'); h.flush(); assert.equal(h.layout.getRatio(), .5);

const commitsBeforeDrag = h.commits.length;
h.handle.emit('pointerdown', { button: 0, pointerId: 7 });
for (const x of [700, 600, 500]) h.handle.emit('pointermove', { pointerId: 7, clientX: x });
assert.equal(h.frames.size, 1, 'Rapid drag events share one layout update');
assert.equal(h.commits.length, commitsBeforeDrag, 'Dragging does not persist every pointer event');
h.flush(); assert.ok(h.layout.getRatio() > .5);
h.handle.emit('pointerup', { pointerId: 7 });
assert.equal(h.commits.length, commitsBeforeDrag + 1, 'The split ratio is committed on release');
assert.equal(h.container.classList.contains('xy-layout-dragging'), false);

h.layout.setRatio(.8); h.resize(720); h.flush();
assert.equal(h.layout.getRatio(), .8, 'A constrained pane retains the requested ratio');
assert.equal(parseFloat(h.panel.style.getPropertyValue('--xy-pane-width')), 392);
h.resize(2000); h.flush();
assert.equal(parseFloat(h.panel.style.getPropertyValue('--xy-pane-width')), 1594, 'The saved ratio recovers when more space becomes available');
h.resize(680); h.flush();
assert.equal(h.container.classList.contains('xy-layout-stacked'), true);
assert.equal(h.handle.classList.contains('hidden'), true);
const saved = h.layout.getRatio(); h.handle.emit('keydown', { key: 'ArrowRight' });
assert.equal(h.layout.getRatio(), saved, 'Hidden narrow-screen separators do not change the ratio');
h.resize(1200); h.layout.setState({ expanded: true }); h.flush();
assert.equal(h.handle.classList.contains('hidden'), true);
assert.equal(h.container.classList.contains('xy-layout-expanded'), true);
h.layout.setState({ expanded: false }); h.flush();
assert.equal(h.handle.classList.contains('hidden'), false, 'Returning from expanded mode restores the divider');
assert.equal(h.container.classList.contains('xy-layout-expanded'), false);
assert.equal(h.layout.getRatio(), saved, 'Expanded mode preserves the preferred split');
assert.equal(parseFloat(h.panel.style.getPropertyValue('--xy-pane-width')), 872);
h.layout.setState({ visible: false, expanded: false }); h.flush();
assert.equal(h.container.classList.contains('xy-layout-active'), false);
assert.equal(h.handle.classList.contains('hidden'), true);
h.layout.setState({ visible: true }); h.flush();
assert.equal(h.container.classList.contains('xy-layout-active'), true, 'Reopening restores the split layout');
assert.equal(h.handle.classList.contains('hidden'), false);
assert.equal(h.layout.getRatio(), saved, 'Closing and reopening preserves the preferred split');
assert.equal(parseFloat(h.panel.style.getPropertyValue('--xy-pane-width')), 872);
for (const width of [719, 720, 719, 720]) {
    const resizesBefore = h.resizes;
    h.resize(width); h.flush();
    assert.equal(h.container.classList.contains('xy-layout-stacked'), width < 720);
    assert.equal(h.handle.classList.contains('hidden'), width < 720);
    assert.equal(h.layout.getRatio(), saved, 'Crossing the responsive boundary does not change the preferred split');
    assert.equal(h.resizes, resizesBefore + 1, 'Each responsive transition resizes both panes once');
    h.resize(width); h.flush();
    assert.equal(h.resizes, resizesBefore + 1, 'A stable boundary layout does not start a resize loop');
}
h.layout.destroy();
assert.ok(h.observers.every(observer => observer.disconnected));
assert.equal(h.frames.size, 0);
assert.equal(h.container.children.includes(h.handle), false);
console.log('xy-layout: bounded split, preferred ratio, keyboard, coalesced drag, same-size resize suppression, reopen, expanded return, 719/720px transitions and cleanup passed');
