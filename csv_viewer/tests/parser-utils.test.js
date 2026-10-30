'use strict';

const assert = require('node:assert/strict');
const CSVUtils = require('../parser-utils.js');

function bytes(values) {
    return Uint8Array.from(values);
}

function utf8Bytes(text) {
    return new TextEncoder().encode(text);
}

function testShiftJisDetection() {
    const sjisHeader = bytes([
        0x54, 0x69, 0x6d, 0x65, 0x2c,
        0x8e, 0xd4, 0x91, 0xac, 0x2c,
        0x89, 0xb7, 0x93, 0x78, 0x0a,
    ]);
    assert.equal(CSVUtils.detectTextEncoding(sjisHeader), 'shift-jis');
    assert.equal(CSVUtils.decodeBytes(sjisHeader, 'shift-jis').text, 'Time,車速,温度\n');
}

function testUtf8Detection() {
    const utf8Header = utf8Bytes('Time,車速,温度\n');
    assert.equal(CSVUtils.detectTextEncoding(utf8Header), 'utf-8');
}

function testBomDetection() {
    assert.equal(CSVUtils.detectTextEncoding(bytes([0xef, 0xbb, 0xbf, 0x54])), 'utf-8');
    assert.equal(CSVUtils.detectTextEncoding(bytes([0xff, 0xfe, 0x54, 0x00])), 'utf-16le');
    assert.equal(CSVUtils.detectTextEncoding(bytes([0xfe, 0xff, 0x00, 0x54])), 'utf-16be');
}

function testHeaderRows() {
    const raw = [
        ['metadata', 'example'],
        ['Time', 'RPM', '車速'],
        ['s', 'rpm', 'km/h'],
        ['0', '1000', '1'],
    ];
    assert.deepEqual(CSVUtils.detectHeaderRows(raw, 0, 1), { nameRow: 1, unitRow: 2 });
    assert.ok(CSVUtils.isTimeHeader('| 時間 |'));
}

function testTrnConversion() {
    const text = '| Time | RPM | 車速 |\n| s | rpm | km/h |\n0    1000    10';
    assert.equal(
        CSVUtils.convertWhitespaceToTabs(text),
        'Time\tRPM\t車速\ns\trpm\tkm/h\n0\t1000\t10'
    );
}

// 単一スペースを含むチャンネル名（Vehicle Speed 等）が2列に分割されないこと。
// 区切りは「パイプ」「タブ」「連続2個以上の空白」のみ。
function testTrnConversionSpaceInName() {
    // 実際の.trnと同じ「先頭パイプ+複数空白区切り」レイアウト
    const text = '| Time    Vehicle Speed    Engine RPM\n  s       km/h          rpm\n      0.0        0.00       805';
    assert.equal(
        CSVUtils.convertWhitespaceToTabs(text),
        'Time\tVehicle Speed\tEngine RPM\ns\tkm/h\trpm\n0.0\t0.00\t805'
    );

    // パイプ区切りレイアウトでもスペース入り名が生き残ること
    const piped = '| Time | Vehicle Speed |\n| s | km/h |\n0.0    12.5';
    assert.equal(
        CSVUtils.convertWhitespaceToTabs(piped),
        'Time\tVehicle Speed\ns\tkm/h\n0.0\t12.5'
    );

    // タブ区切り行はそのまま列として扱われること
    assert.equal(
        CSVUtils.convertWhitespaceToTabs('Time\tVehicle Speed\n0.0\t12.5'),
        'Time\tVehicle Speed\n0.0\t12.5'
    );
}

function testToNumber() {
    assert.equal(CSVUtils.toNumber('TRUE'), 1);
    assert.equal(CSVUtils.toNumber('FALSE'), 0);
    assert.equal(CSVUtils.toNumber('12.5'), 12.5);
    assert.ok(Number.isNaN(CSVUtils.toNumber('abc')));
}

function testTimeUnitHelpers() {
    assert.equal(CSVUtils.getTimeUnitScale('ms').scale, 0.001);
    assert.equal(CSVUtils.getTimeUnitScale('msec').scale, 0.001);
    assert.equal(CSVUtils.getTimeUnitScale('sec').scale, 1);
    assert.equal(CSVUtils.getTimeScaleInfo('Time(ms)', '').scale, 0.001);
    assert.equal(CSVUtils.getTimeScaleInfo('Time [sec]', '').source, 'header');
    assert.equal(CSVUtils.getTimeScaleInfo('Time', '').explicit, false);
}

function testChannelNameHelpers() {
    assert.equal(CSVUtils.normalizeChannelName(' Vehicle_Speed (km/h) '), 'vehiclespeedkmh');
    assert.equal(CSVUtils.getStringSimilarity('Vehicle Speed', 'vehicle_speed'), 1);
    assert.ok(
        CSVUtils.scoreAliasCandidate(
            { name: 'Vehicle Speed', unit: 'km/h' },
            { name: 'vehicle_speed', unit: 'km/h' }
        ) > CSVUtils.scoreAliasCandidate(
            { name: 'Vehicle Speed', unit: 'km/h' },
            { name: 'Battery Voltage', unit: 'V' }
        )
    );
}

testShiftJisDetection();
testUtf8Detection();
testBomDetection();
testHeaderRows();
testTrnConversion();
testTrnConversionSpaceInName();
testToNumber();
testTimeUnitHelpers();
testChannelNameHelpers();

function testTrnSignedNumericRows() {
    const text = 'Time  Actual Speed  Engine RPM\ns     km/h          rpm\n0.0  0.5  500\n0.1 -0.5  500\n0.2  0.5  500';
    const rows = CSVUtils.convertWhitespaceToTabs(text).split('\n').map(line => line.split('\t'));
    assert.deepEqual(rows[0], ['Time', 'Actual Speed', 'Engine RPM']);
    assert.deepEqual(rows.slice(2).map(row => row.map(CSVUtils.toTrnNumber)), [
        [0, 0.5, 500], [0.1, -0.5, 500], [0.2, 0.5, 500],
    ]);
    rows.slice(2).forEach(row => assert.equal(CSVUtils.validateTrnRow(row, 3, 0), ''));
}

function testAlignedTrnHeaders() {
    const names = [' Time', 'Actual Speed', 'Engine RPM', 'Long_Channel_15', 'Next Sensor', 'Flag'];
    const units = [' sec', 'km/h', 'rpm', 'No Unit', 'N-m', 'No Unit'];
    // Exporter fields are 16 characters, including the last field's padding.
    // The final padding character is omitted; no actual data is embedded here.
    const fixed = cells => cells.map(cell => cell.padEnd(16)).join('').slice(0, -1);
    const lines = ['| CASE #     1', '|' + fixed(names), '|' + fixed(units),
        fixed([' 0.0', '0.5', '500', '-1.25D-02', '10', 'TRUE']),
        fixed([' 0.1', '-0.5', '500', '2', '20', 'FALSE'])];
    // A name exactly 15 characters long leaves only ONE separating space.
    assert.equal(names[3].length, 15);
    const rows = CSVUtils.convertWhitespaceToTabs(lines.join('\r\n')).split('\n').map(line => line.split('\t'));
    assert.deepEqual(rows[1], names.map(name => name.trim()));
    assert.deepEqual(rows[2], units.map(unit => unit.trim()));
    assert.equal(rows[1].length, rows[3].length);
    assert.equal(rows[1][4], 'Next Sensor');
    assert.equal(CSVUtils.validateTrnRow(rows[4], 6, 0), '');
    assert.equal(CSVUtils.toTrnNumber(rows[4][1]), -0.5);

    for (const [index, change] of [
        [2, line => line.slice(0, 17) + ' ' + line.slice(18)], // shifted units
        [1, line => line.slice(0, 16) + 'X' + line.slice(17)], // word crosses boundary
        [3, line => line.slice(0, 31) + '9' + line.slice(32)], // numeric token crosses a boundary
    ]) {
        const altered = lines.map((line, i) => i === index ? change(line) : line);
        const converted = CSVUtils.convertWhitespaceToTabs(altered.join('\n')).split('\n');
        assert.notEqual(converted[1].split('\t').length, 6, 'ambiguous alignment must use legacy parsing');
    }
}

testAlignedTrnHeaders();

function testTrnExplicitEmptyCells() {
    for (const [text, expected] of [
        ['0.1\t\t500', ['0.1', '', '500']],
        ['\t-0.5\t500', ['', '-0.5', '500']],
        ['0.1\t-0.5\t', ['0.1', '-0.5', '']],
        ['0.1||500', ['0.1', '', '500']],
        ['0.1|-0.5|', ['0.1', '-0.5', '']],
        ['| 0.1 | | 500 |', ['0.1', '', '500']],
    ]) {
        assert.deepEqual(CSVUtils.convertWhitespaceToTabs(text).split('\t'), expected);
    }
    assert.equal(CSVUtils.validateTrnRow(['0.1', '', '500'], 3, 0), '');
    assert.ok(Number.isNaN(CSVUtils.toTrnNumber('')));
    assert.ok(CSVUtils.validateTrnRow(['', '-0.5', '500'], 3, 0));
}

function testTrnStrictNumbersAndInvalidRows() {
    assert.equal(CSVUtils.toTrnNumber('-1e-3'), -0.001);
    assert.equal(CSVUtils.toTrnNumber('-1E+3'), -1000);
    assert.equal(CSVUtils.toTrnNumber('-1.25D+02'), -125);
    assert.equal(CSVUtils.toTrnNumber('-1.25D-02'), -0.0125);
    assert.ok(Object.is(CSVUtils.toTrnNumber('-0'), -0));
    assert.equal(CSVUtils.toTrnNumber('TRUE'), 1);
    assert.equal(CSVUtils.toTrnNumber('FALSE'), 0);
    for (const value of ['0.1 -0.5', '12.5rpm', 'Infinity', '1e999', '\u22120.5']) {
        assert.ok(Number.isNaN(CSVUtils.toTrnNumber(value)), value);
    }
    for (const row of [['0.1', '-0.5'], ['0.1', '-0.5', '500', '999'], ['0.1', 'bad', '500']]) {
        assert.ok(CSVUtils.validateTrnRow(row, 3, 0));
    }
    assert.deepEqual(CSVUtils.convertWhitespaceToTabs('0.1 bad 500').split('\t'), ['0.1', 'bad', '500']);
    assert.equal(CSVUtils.validateTrnRow(['0.1', 'NaN', '500'], 3, 0), '');
    // CSV keeps its established conversion path; TRN strictness is opt-in.
    assert.equal(CSVUtils.toNumber('12.5rpm'), 12.5);
}

testTrnSignedNumericRows();
testTrnExplicitEmptyCells();
testTrnStrictNumbersAndInvalidRows();
console.log('parser-utils tests passed');
