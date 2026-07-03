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

console.log('parser-utils tests passed');
