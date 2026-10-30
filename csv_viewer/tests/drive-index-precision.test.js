'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.CSV_VIEWER_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.CSV_VIEWER_APP_PATH || path.join(root, 'app.js'), 'utf8');
const U = require(path.join(root, 'parser-utils.js'));
const Papa = require(path.join(root, 'lib', 'papaparse.min.js'));

function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, name);
    return source.slice(source.slice(start - 6, start) === 'async ' ? start - 6 : start, end + 2);
}

function fixture(text, trn = false) {
    const data = trn ? U.convertWhitespaceToTabs(text) : text;
    const delimiter = trn ? '\t' : ',';
    const raw = Papa.parse(data, { delimiter, skipEmptyLines: true }).data;
    const retained = raw.map((row, index) => ({ row, sourceRow: index + 1 }))
        .filter(({ row, sourceRow }) => sourceRow > 2 && Number.isFinite((trn ? U.toTrnNumber : U.toNumber)(row[0])));
    return { name: `synthetic.${trn ? 'trn' : 'csv'}`, file: data,
        timeData: Float64Array.from(retained, item => (trn ? U.toTrnNumber : U.toNumber)(item.row[0])),
        sourceRowNumbers: Uint32Array.from(retained, item => item.sourceRow),
        headerInfo: { dataStart: 2, timeIdx: 0, delimiter, encoding: 'utf-8', isTrn: trn, columnCount: 3 },
        columns: [{ id: 'speed', name: 'Actual Speed', idx: 1 }, { id: 'rpm', name: 'Engine RPM', idx: 2 }],
        colData: {}, columnDiagnostics: {} };
}

function environment(file, options = {}) {
    const env = { errors: [], parseCalls: 0, bitCalls: 0, jobs: [], failParse: false, cancelNext: false };
    const noop = () => {};
    const context = vm.createContext({ ...U,
        Papa: { parse: (input, config) => {
            env.parseCalls++;
            const parse = () => env.failParse ? config.error(new Error('unreadable synthetic source')) : Papa.parse(input, config);
            if (options.defer) setImmediate(parse); else parse();
        } },
        File: class SyntheticFile {}, state: { files: { f: file } },
        _parseQueue: new Map(), _driveIndexColumnCache: new WeakMap(),
        createParseJob: () => { const job = { cancelled: env.cancelNext }; env.cancelNext = false; env.jobs.push(job); return job; },
        finishParseJob: noop, updateParseJob: noop, showWarning: noop,
        showError: (title, detail) => env.errors.push({ title, detail }),
        detectBitChannels: () => env.bitCalls++, console: { log: noop, warn: noop },
    });
    for (const name of ['getDriveIndexColumnCache', 'loadDriveIndexColumns', 'loadColumnsForFile']) vm.runInContext(functionSource(name), context);
    env.context = context;
    return env;
}

(async () => {
    const csv = fixture('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,0.10800000000000001,500\nbad,ignore,500\n0,-0.5,501\n0.1,,502\n0.2,1.25E-2,503');
    const env = environment(csv);
    await env.context.loadColumnsForFile('f', ['Actual Speed', 'Engine RPM']);
    const display = csv.colData.speed, diagnostics = JSON.stringify(csv.columnDiagnostics);
    assert.equal(display.constructor.name, 'Float32Array');
    assert.equal(display[1], -0.5); assert.ok(Number.isNaN(display[2]));
    assert.notEqual(display[0], Number('0.10800000000000001'));
    const exact = await env.context.loadDriveIndexColumns('f', ['Actual Speed', 'Engine RPM']);
    assert.equal(exact.precision, 'float64'); assert.deepEqual(Array.from(exact.computedColumns), []);
    assert.equal(exact.colData.speed.constructor.name, 'Float64Array');
    assert.equal(exact.colData.speed[0], Number('0.10800000000000001'));
    assert.equal(exact.colData.speed[1], -0.5); assert.ok(Number.isNaN(exact.colData.speed[2]));
    assert.deepEqual(Array.from(exact.colData.rpm), [500, 501, 502, 503]);
    assert.equal(csv.timeData.length, exact.colData.speed.length, 'duplicate timestamps and finite-time row filtering remain aligned');
    assert.equal(csv.colData.speed, display, 'calculation reads must not replace display buffers');
    assert.equal(JSON.stringify(csv.columnDiagnostics), diagnostics); assert.equal(env.bitCalls, 1);
    const calls = env.parseCalls;
    const cached = await env.context.loadDriveIndexColumns('f', ['Actual Speed']);
    assert.equal(cached.colData.speed, exact.colData.speed); assert.equal(env.parseCalls, calls);

    for (const order of ['display-first', 'precision-first', 'both-precision']) {
        const file = fixture('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,0.10800000000000001,500\n0.1,-0.5,501');
        const concurrent = environment(file, { defer: true });
        const precise = () => concurrent.context.loadDriveIndexColumns('f', ['Actual Speed']);
        const ordinary = () => concurrent.context.loadColumnsForFile('f', ['Actual Speed']);
        const requests = order === 'display-first' ? [ordinary(), precise()] : order === 'precision-first' ? [precise(), ordinary()] : [precise(), precise()];
        await Promise.all(requests);
        const full = await precise();
        assert.equal(full.colData.speed[0], Number('0.10800000000000001'));
        if (order !== 'both-precision') assert.equal(file.colData.speed[0], Math.fround(Number('0.10800000000000001')));
        assert.equal(concurrent.parseCalls, order === 'both-precision' ? 1 : 2);
        assert.equal(concurrent.context._parseQueue.size, 0);
    }

    const trn = fixture('Time\tActual Speed\tEngine RPM\ns\tkm/h\trpm\n0\t-1.25D-02\t500\n0.1\t\t501\n0.2\t-0.5\t', true);
    const tenv = environment(trn);
    const tvalue = await tenv.context.loadDriveIndexColumns('f', ['Actual Speed', 'Engine RPM']);
    assert.equal(tvalue.colData.speed[0], -0.0125); assert.ok(Number.isNaN(tvalue.colData.speed[1]));
    assert.equal(tvalue.colData.rpm[1], 501); assert.ok(Number.isNaN(tvalue.colData.rpm[2]));
    assert.deepEqual(Object.keys(trn.colData), [], 'precision loading alone must leave the chart cache empty');
    trn.file = trn.file.replace('-1.25D-02', 'bad');
    await assert.rejects(tenv.context.loadDriveIndexColumns('f', ['Actual Speed']), /数値/);
    assert.equal(tenv.context._parseQueue.size, 0);

    const changed = fixture('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,1.0000000000000002,500\n1,2,501');
    const changeEnv = environment(changed);
    await changeEnv.context.loadDriveIndexColumns('f', ['Actual Speed']);
    changed.file = changed.file.replace('1.0000000000000002', '1.0000000000000004');
    const replacement = await changeEnv.context.loadDriveIndexColumns('f', ['Actual Speed']);
    assert.equal(replacement.colData.speed[0], Number('1.0000000000000004'));
    changed.sourceRowNumbers = Uint32Array.from([3, 99]);
    await assert.rejects(changeEnv.context.loadDriveIndexColumns('f', ['Actual Speed']), /行対応/);
    changed.sourceRowNumbers = Uint32Array.from([3, 4]); changed.timeData = Float64Array.from([0, 1, 2]);
    await assert.rejects(changeEnv.context.loadDriveIndexColumns('f', ['Actual Speed']), /行数/);

    const cancelled = environment(fixture('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,1,500\n1,2,501'));
    cancelled.cancelNext = true;
    await assert.rejects(cancelled.context.loadDriveIndexColumns('f', ['Actual Speed']), /キャンセル/);
    assert.equal(cancelled.context._parseQueue.size, 0);
    const unreadable = environment(fixture('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,1,500\n1,2,501'));
    unreadable.failParse = true;
    await assert.rejects(unreadable.context.loadDriveIndexColumns('f', ['Actual Speed']), /unreadable/);
    assert.equal(unreadable.context._parseQueue.size, 0);
    unreadable.failParse = false;
    assert.ok((await unreadable.context.loadDriveIndexColumns('f', ['Actual Speed'])).colData.speed);

    const stale = environment(fixture('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,1,500\n1,2,501'), { defer: true });
    const request = stale.context.loadDriveIndexColumns('f', ['Actual Speed']);
    await Promise.resolve(); delete stale.context.state.files.f;
    await assert.rejects(request, /入力|条件/);
    assert.equal(stale.context._parseQueue.size, 0);

    const computed = fixture('Time,Actual Speed,Engine RPM\ns,km/h,rpm\n0,1,500\n1,2,501');
    computed.columns.push({ id: 'custom', name: '@Speed', idx: -1, isCustom: true });
    computed.colData.custom = Float32Array.from([1.00000001, 2]);
    const mixed = await environment(computed).context.loadDriveIndexColumns('f', ['Actual Speed', '@Speed']);
    assert.equal(mixed.precision, 'mixed'); assert.deepEqual(Array.from(mixed.computedColumns), ['@Speed']);
    assert.equal(mixed.colData.custom, computed.colData.custom);
    console.log('Drive Index precision tests passed (Float64 source reads, untouched signed display, row mapping, cache invalidation, concurrent queues, cancellation, parse failures, computed provenance)');
})().catch(error => { console.error(error); process.exitCode = 1; });
