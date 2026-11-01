'use strict';
const assert = require('node:assert/strict');
const Q = require('../data-quality-utils');

// Non-adjacent repeated timestamps count as duplicate occurrences, not groups.
{
    const times = Float64Array.from([0, 1, 0, 2, 2, 1]);
    const rows = Uint32Array.from([3, 4, 6, 7, 8, 10]);
    const before = Buffer.from(times.buffer.slice(0));
    const r = Q.analyzeTime(times, { sourceRowNumbers: rows });
    assert.equal(r.count, 6); assert.equal(r.duplicateCount, 3); assert.equal(r.reverseCount, 2);
    assert.equal(r.positiveIntervalCount, 2); assert.equal(r.typicalInterval, 1.5);
    assert.deepEqual(r.issues.filter(x => x.kind === 'duplicate-time').map(x => [x.index, x.sourceRow]), [[2, 6], [4, 8], [5, 10]]);
    assert.equal(r.issues.find(x => x.kind === 'reverse-time').previousTime, 1);
    assert.deepEqual(Buffer.from(times.buffer), before, 'input timestamps must not be reordered');
}

// Unequal positive intervals use their exact median; threshold equality is not a gap.
{
    const r = Q.analyzeTime([0, 1, 3, 6, 10, 21, 22], { gapFactor: 3 });
    assert.equal(r.typicalInterval, 2.5); assert.equal(r.gapThreshold, 7.5);
    assert.equal(r.largeGapCount, 1); assert.equal(r.issues[0].index, 5); assert.equal(r.issues[0].interval, 11);
    const equal = Q.analyzeTime([0, 1, 2, 12, 13]);
    assert.equal(equal.gapThreshold, 10); assert.equal(equal.largeGapCount, 0);
    assert.equal(Q.analyzeTime([0, 1, 2, 12.0001, 13.0001]).largeGapCount, 1);
}

// NaN and infinities are not duplicates and break adjacent-interval measurements.
{
    const r = Q.analyzeTime([0, NaN, -1, Infinity, -Infinity, 3], {
        invalidTimeCount: 4, invalidTimeRows: [5, 7], sourceRowNumbers: [3, 4, 6, 8, 9, 10],
    });
    assert.equal(r.invalidTimeCount, 7); assert.equal(r.nonFiniteTimeCount, 3); assert.equal(r.omittedTimeCount, 4);
    assert.equal(r.reverseCount, 0); assert.equal(r.duplicateCount, 0); assert.equal(r.typicalInterval, null);
    assert.equal(r.minTime, -1); assert.equal(r.maxTime, 3);
    assert.equal(r.issueCount, 7); assert.equal(r.issues.length, 5); assert.equal(r.unlocatedIssueCount, 2);
    assert.equal(r.issuesTruncated, true);
    assert.deepEqual(r.issues.filter(x => x.origin === 'import').map(x => [x.index, x.sourceRow]), [[null, 5], [null, 7]]);
    assert.equal(Q.analyzeTime([0, NaN, 0]).duplicateCount, 1, 'duplicates across invalid timestamps still count');
}

// Detail limits never limit full diagnostic counts.
{
    const r = Q.analyzeTime(new Float64Array(10002), { maxIssues: 3 });
    assert.equal(r.duplicateCount, 10001); assert.equal(r.issues.length, 3); assert.equal(r.issueCount, 10001);
    assert.equal(r.issuesTruncated, true); assert.equal(r.typicalInterval, null);
    assert.equal(Q.analyzeTime([0, 0], { maxIssues: 0 }).issues.length, 0);
    const defaultCap = Q.analyzeTime(new Float64Array(1002)); assert.equal(defaultCap.issues.length, 1000);
    assert.equal(Q.analyzeTime([0, 1], { gapFactor: NaN }).gapFactor, 10);
}

// Full, shifted and reversed ranges; both endpoints are included; no interpolation.
{
    const t = Float64Array.from([0, 1, 2, 4]), v = Float64Array.from([10, NaN, 30, 40]);
    const r = Q.analyzeValues(t, v, { range: [12, 10], offset: 10, sourceRowNumbers: [3, 4, 5, 8] });
    assert.equal(r.sampleCount, 3); assert.equal(r.validCount, 2); assert.equal(r.missingCount, 1); assert.equal(r.missingRate, 1 / 3);
    assert.equal(r.min, 10); assert.equal(r.max, 30); assert.equal(r.constant, false);
    assert.deepEqual(r.range, [10, 12]);
    assert.deepEqual(r.issues[0], { kind: 'missing-value', index: 1, time: 11, rawTime: 1, sourceRow: 4 });
    const empty = Q.analyzeValues(t, v, { range: [1.1, 1.9] });
    assert.equal(empty.sampleCount, 0); assert.equal(empty.missingRate, null); assert.equal(empty.min, null); assert.equal(empty.constant, false);
    assert.deepEqual(Array.from(t), [0, 1, 2, 4]); assert.deepEqual(Array.from(v), [10, NaN, 30, 40]);
}

// Non-finite values, undefined entries and short columns are missing; no coercion.
{
    const r = Q.analyzeValues([0, 1, 2, 3, 4, 5, 6], [NaN, Infinity, -Infinity, null, '3', 8]);
    assert.equal(r.sampleCount, 7); assert.equal(r.validCount, 1); assert.equal(r.missingCount, 6);
    assert.equal(r.constant, true); assert.equal(r.constantValue, 8);
    const allMissing = Q.analyzeValues([0, 1], [NaN, Infinity]);
    assert.equal(allMissing.constant, false); assert.equal(allMissing.min, null); assert.equal(allMissing.missingRate, 1);
    const constant = Q.analyzeValues([0, 0.1, 100], [5, NaN, 5]); assert.equal(constant.constant, true);
    const extras = Q.analyzeValues([0], [1, 2, 3]); assert.equal(extras.sampleCount, 1); assert.equal(extras.extraValueCount, 2);
}

// An invalid timestamp cannot be assigned to a requested interval, but its value
// still belongs to full-column diagnostics when no range has been requested.
{
    const full = Q.analyzeValues([0, NaN, 2], [1, NaN, 3]);
    assert.equal(full.sampleCount, 3); assert.equal(full.missingCount, 1); assert.equal(full.nonFiniteTimeCount, 1);
    const scoped = Q.analyzeValues([0, NaN, 2], [1, NaN, 3], { range: [-Infinity, Infinity] });
    assert.equal(scoped.sampleCount, 2); assert.equal(scoped.excludedTimeCount, 1); assert.equal(scoped.missingCount, 0);
    assert.equal(Q.analyzeValues([0], [1], { offset: NaN }).error, 'invalid-offset');
    assert.equal(Q.analyzeValues([0], [1], { range: [NaN, 1] }).error, 'invalid-range');
}

// Large input does not spread arrays onto the stack; only details are capped.
{
    const n = 250000, times = new Float64Array(n), values = new Float64Array(n);
    for (let i = 0; i < n; i++) { times[i] = i / 10; values[i] = i % 2 ? NaN : 7; }
    const time = Q.analyzeTime(times); assert.equal(time.duplicateCount, 0); assert.equal(time.largeGapCount, 0);
    const r = Q.analyzeValues(times, values, { maxIssues: 2 });
    assert.equal(r.validCount, n / 2); assert.equal(r.missingCount, n / 2); assert.equal(r.issues.length, 2);
    assert.equal(r.issueCount, n / 2); assert.equal(r.constant, true); assert.equal(r.missingRate, 0.5);
}
for (const input of [[], null, undefined, '123']) {
    const t = Q.analyzeTime(input), v = Q.analyzeValues(input, []);
    assert.equal(t.count, 0); assert.equal(t.typicalInterval, null); assert.equal(t.issueCount, 0);
    assert.equal(v.sampleCount, 0); assert.equal(v.missingRate, null); assert.equal(v.constant, false);
}

// Regression: QUALITY-READABILITY — round summary text, never held samples.
// Found by live Computer Use QA on 2026-11-02; docs/qa/2026-11-02/screenshots/016-quality.jpg.
// Value: protects=quality readability and exact raw rows; fails_when=summary uses String or raw rows round;
// why_new=pure quality tests do not render text; seam=none; no_claim=layout (verified in the live app).
{
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, '../data-inspector.js'), 'utf8');
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const values = Float32Array.from([1496.284, 3276.513]), times = Float64Array.from([18, 18.1]);
    const before = Buffer.from(values.buffer.slice(0));
    const file = { timeData: times, sourceRowNumbers: [3, 4], colData: { speed: values } };
    const column = { id: 'speed', name: 'Engine_Speed', unit: 'rpm' };
    const range = { range: [0, 120], label: '全体 0–120 s' };
    const time = Q.analyzeTime(Array.from({ length: 1201 }, (_, i) => i / 10));
    const nodes = new Map();
    const context = {
        snapshot: { file, context: range, columns: [column], indices: [0, 1], offset: 0, unavailable: [], excluded: [] },
        quality: { time, valueRows: [{ column, result: Q.analyzeValues(times, values), diagnostics: {} }],
            timeIssues: [], valueIssues: [], invalidIssues: [], valueIssueCount: 0, invalidDetailCount: 0 },
        content: { innerHTML: '' }, detailFilter: 'all', displayedIssues: [], DETAIL_LIMIT: 1000, PAGE_SIZE: 100,
        page: 0, cursor: null, esc: escape, scopeNotes: () => '', rawEntries: () => new Map(),
        dataOf: (f, c) => f.colData[c.id], sourceRow: (f, i) => f.sourceRowNumbers[i],
        $: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('const finite ='), source.indexOf('const ids =')), context);
    vm.runInContext(source.slice(source.indexOf('function renderQuality()'), source.indexOf('function renderStats()')), context);
    vm.runInContext(source.slice(source.indexOf('function renderData()'), source.indexOf('function analyze(')), context);
    context.renderQuality();
    const text = context.content.innerHTML.replace(/<[^>]+>/g, '');
    assert.match(text, /中央値 0\.1 s × 10（1 s超）/, 'sampling summary must not expose binary arithmetic tails');
    assert.match(text, /1496\.284/);
    assert.doesNotMatch(text, /1496\.2840576171875/, 'summary extrema are human-readable');
    assert.match(context.content.innerHTML, /title="保持値: 1496\.2840576171875"/, 'held extrema remain available');
    assert.match(context.content.innerHTML, /title="保持値: 0\.10000000000000053"/, 'exact sampling threshold remains available');
    context.quality.valueRows[0].result = { ...context.quality.valueRows[0].result, min: 0, max: 1.234567891e-12 };
    context.renderQuality();
    assert.match(context.content.innerHTML, /title="保持値: 0">0<\/span>/, 'a measured zero is still zero');
    assert.match(context.content.innerHTML, />1\.234568e-12<\/span>/, 'small nonzero values must not round to zero');
    context.quality.valueRows[0].result = { ...context.quality.valueRows[0].result, min: null, max: null, validCount: 0 };
    context.renderQuality();
    assert.match(context.content.innerHTML, /<td>—<\/td><td>—<\/td>/, 'missing summaries must not become zero');
    context.renderData();
    assert.match(context.content.innerHTML, /<td>1496\.2840576171875<\/td>/, 'raw rows retain exact held values');
    assert.deepEqual(Buffer.from(values.buffer), before, 'formatting must not mutate held samples');
}
console.log('data-quality-utils: full-scan duplicates/reversals/gaps, raw rows, non-finite values, range/offset, constant, caps and 250k samples passed');
