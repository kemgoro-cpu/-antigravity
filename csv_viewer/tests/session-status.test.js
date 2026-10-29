'use strict';
const assert = require('node:assert/strict');
const { create, describe } = require('../session-status');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
    const live = new Set(), records = new Map();
    let available = true, failWrite = null, failRemove = false, failClear = false, waitWrite = null, clock = 1000;
    const controller = create({
        exists: id => live.has(id), supported: () => available, now: () => ++clock,
        read: async () => [...records.values()],
        write: async record => {
            if (waitWrite) await waitWrite.promise;
            if (failWrite) throw failWrite;
            const total = [...records.values()].filter(r => r.id !== record.id).reduce((n, r) => n + r.size, 0);
            if (total + record.size > 100) return { saved: false, existing: records.has(record.id), reason: 'capacity' };
            records.set(record.id, record); return { saved: true };
        },
        remove: async id => { if (failRemove) throw new Error('delete denied'); records.delete(id); },
        clear: async ids => { if (failClear) throw new Error('clear denied'); ids.forEach(id => records.delete(id)); },
    });
    return { controller, records, live, file: size => ({ size }),
        available: x => { available = x; }, failWrite: x => { failWrite = x; },
        failRemove: x => { failRemove = x; }, failClear: x => { failClear = x; }, wait: x => { waitWrite = x; } };
}
(async () => {
    const h = setup(), c = h.controller;
    h.live.add('one'); const file = h.file(60), gate = deferred(); h.wait(gate);
    const first = c.save('one', file, '元ﾛｸﾞ.trn', { order: 0, importOptions: { unitMode: 'none' } });
    assert.equal(c.get('one').status, 'saving');
    assert.equal(c.get('one').savedAt, null, 'no success date before commit');
    gate.resolve(); assert.equal(await first, true); h.wait(null);
    assert.equal(c.get('one').status, 'saved');
    assert.equal(h.records.get('one').blob, file, 'original TRN object retained');
    assert.deepEqual(h.records.get('one').importOptions, { unitMode: 'none' });
    assert.match(describe(c.get('one')).label, /次回復元可能/);

    h.live.add('two'); await c.save('two', h.file(50), 'two.csv');
    assert.equal(c.get('two').status, 'skipped'); assert.equal(h.records.has('two'), false);
    h.live.delete('one'); await c.remove('one'); assert.equal(h.records.has('one'), false);
    assert.equal(await c.retry('two'), true); assert.equal(h.records.has('two'), true);

    const savedAt = c.get('two').savedAt;
    h.failWrite(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    await c.save('two', c.get('two').file, 'two.csv');
    assert.equal(c.get('two').status, 'failed'); assert.equal(c.get('two').savedAt, savedAt);
    assert.match(describe(c.get('two')).label, /前回保存分は復元可能/);
    h.live.add('failed'); await c.save('failed', h.file(1), 'failed.csv');
    assert.equal(c.get('failed').restorable, false); assert.equal(c.get('failed').savedAt, null);
    h.failWrite(null); await c.retry('failed'); assert.equal(h.records.has('failed'), true);

    h.available(false); h.live.add('unsupported'); await c.save('unsupported', h.file(1), 'unsupported.csv');
    assert.equal(c.get('unsupported').status, 'unavailable'); assert.equal(h.records.has('unsupported'), false);
    h.available(true); await c.retry('unsupported'); assert.equal(c.get('unsupported').status, 'saved');

    const race = setup(), r = race.controller, inFlight = deferred(); race.wait(inFlight); race.live.add('race');
    const saving = r.save('race', race.file(10), 'race.csv');
    await Promise.resolve(); // enter the write before deleting
    race.live.delete('race'); const deleting = r.remove('race');
    inFlight.resolve(); await Promise.all([saving, deleting]);
    assert.equal(race.records.size, 0, 'in-flight write cannot resurrect a removed file');
    assert.equal(r.get('race'), undefined);

    const clearRace = setup(), cr = clearRace.controller, inFlight2 = deferred(); clearRace.wait(inFlight2); clearRace.live.add('old');
    const oldSave = cr.save('old', clearRace.file(10), 'old.csv'); await Promise.resolve();
    clearRace.live.clear(); const clearing = cr.clear();
    clearRace.live.add('new'); const newSave = cr.save('new', clearRace.file(10), 'new.csv');
    inFlight2.resolve(); await Promise.all([oldSave, clearing, newSave]);
    assert.deepEqual([...clearRace.records.keys()], ['new'], 'clear queues before later new save');

    clearRace.failClear(true); clearRace.live.clear(); await cr.clear();
    assert.equal(cr.notices()[0].pending, false);
    clearRace.live.add('after'); await cr.save('after', clearRace.file(10), 'after.csv');
    clearRace.failClear(false); await cr.retryCleanup('clear');
    assert.deepEqual([...clearRace.records.keys()], ['after'], 'retry clear preserves newly loaded files');
    assert.equal(cr.notices().length, 0);

    clearRace.failRemove(true); clearRace.live.delete('after'); await cr.remove('after');
    assert.equal(cr.notices().length, 1); assert.equal(clearRace.records.has('after'), true);
    clearRace.failRemove(false); await cr.retryCleanup('remove:after');
    assert.equal(clearRace.records.size, 0); assert.equal(cr.notices().length, 0);

    const restored = setup(), rr = restored.controller, original = { id: 'persisted-id', name: 'saved.csv', size: 20, savedAt: 50 };
    restored.records.set(original.id, original); restored.live.add('new-ui-id');
    await rr.save('new-ui-id', restored.file(20), original.name, { order: 0 }, original);
    assert.deepEqual([...restored.records.keys()], ['persisted-id'], 'restore updates original ID without duplicating or pre-clearing');
    restored.live.delete('new-ui-id'); await rr.remove('new-ui-id'); assert.equal(restored.records.size, 0);
    console.log('session-status: committed state, capacity, retry, original Blob, import settings, restore ID, delete/clear races passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
