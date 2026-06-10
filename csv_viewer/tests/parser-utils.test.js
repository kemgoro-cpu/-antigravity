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

function testToNumber() {
    assert.equal(CSVUtils.toNumber('TRUE'), 1);
    assert.equal(CSVUtils.toNumber('FALSE'), 0);
    assert.equal(CSVUtils.toNumber('12.5'), 12.5);
    assert.ok(Number.isNaN(CSVUtils.toNumber('abc')));
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
testToNumber();
testChannelNameHelpers();

console.log('parser-utils tests passed');
