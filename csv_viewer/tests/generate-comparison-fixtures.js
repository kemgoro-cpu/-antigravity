'use strict';

// Run: node tests/generate-comparison-fixtures.js (working directory csv_viewer).
// All generated data is synthetic and is ignored by Git. No installed packages needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const spec = require('./fixtures/fixture-spec.json');
const outputRoot = path.join(__dirname, 'fixtures', 'generated');

function pressureAt(t, linear) {
    return linear ? 100 + .25 * t : 100 + 12 * Math.sin(t * .37) + 5 * Math.cos(t * .11) + .03 * t;
}
function stateAt(t) { return (t >= 20 && t < 60) || t >= 80 ? 1 : 0; }

function writeLog(scenario, index, options = {}) {
    const name = options.name || `${String(index + 1).padStart(2, '0')}_ﾛｸﾞ.csv`;
    const filePath = path.join(outputRoot, scenario.name, name);
    const samplePeriod = options.samplePeriod || scenario.samplePeriod;
    const duration = scenario.duration ?? (scenario.points - 1) * scenario.samplePeriod;
    const points = Math.round(duration / samplePeriod) + 1;
    const timeShift = spec.timeShifts[index];
    const pressureBias = spec.pressureBiasPerIndex * index;
    const temperatureBias = spec.temperatureBiasPerIndex * index;
    const columns = spec.columns.filter(c => !(options.missingChannel === c));
    const units = columns.map(c => c === 'Pressure' && options.pressureUnit ? options.pressureUnit : spec.units[spec.columns.indexOf(c)]);
    const missingCounts = { Pressure: 0, Temperature: 0 };
    const rows = [columns.join(','), units.join(',')];
    for (let i = 0; i < points; i++) {
        // Integer hundredths prevent floating point drift at State transitions.
        const t = Math.round(i * samplePeriod * 100) / 100;
        const data = {
            Time: (t + timeShift).toFixed(2),
            Pressure: ((pressureAt(t, scenario.name === 'edge') + pressureBias) * (options.pressureUnit === 'Pa' ? 1000 : 1)).toFixed(9),
            Temperature: (25 + .05 * t + temperatureBias).toFixed(6),
            State: stateAt(t),
        };
        if (options.missingValues) {
            if (i % 100 === 0) { data.Pressure = ''; missingCounts.Pressure++; }
            if (i % 137 === 0) { data.Temperature = ''; missingCounts.Temperature++; }
        }
        rows.push(columns.map(c => data[c]).join(','));
    }
    const contents = rows.join('\n') + '\n';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Preserve the File/Blob references held by a browser already testing these files.
    // Even identical rewrites can invalidate those references on Windows.
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== contents) {
        fs.writeFileSync(filePath, contents, 'utf8');
    }
    assert.equal(contents.trimEnd().split('\n').length, points + 2);
    const actual = fs.readFileSync(filePath);
    assert.equal(actual.length, Buffer.byteLength(contents));
    return {
        path: filePath, relativePath: path.relative(outputRoot, filePath).split(path.sep).join('/'),
        name, index, timeShift, pressureBias, temperatureBias, points, samplePeriod, duration,
        columns, units, bytes: actual.length, sha256: crypto.createHash('sha256').update(actual).digest('hex'),
        localTimeRange: [timeShift, timeShift + duration],
        expectedOffsetFromFirst: -timeShift || 0,
        expectedMainMinusSubFromFirst: { Pressure: -pressureBias || 0, Temperature: -temperatureBias || 0, State: 0 },
        missingCounts,
        ...(options.expectation ? { expectation: options.expectation } : {}),
    };
}

function generate() {
    const scenarios = [];
    for (const definition of spec.scenarios) {
        const scenario = { ...definition };
        scenario.duration ??= (scenario.points - 1) * scenario.samplePeriod;
        if (scenario.name === 'edge') {
            scenario.files = [
                writeLog(scenario, 0, { name: '01_基準_ﾛｸﾞ.csv' }),
                writeLog(scenario, 1, { name: '02_圧力列なし_ﾛｸﾞ.csv', missingChannel: 'Pressure', expectation: 'Pressure must be reported as missing; Temperature difference = -2 degC; State identical.' }),
                writeLog(scenario, 2, { name: '03_周期40ms_ﾛｸﾞ.csv', samplePeriod: .04, expectation: 'Linear interpolation gives Pressure difference = -20 kPa and Temperature difference = -4 degC at every reference sample; State transitions are at the same physical times.' }),
                writeLog(scenario, 3, { name: '04_単位Pa_ﾛｸﾞ.csv', pressureUnit: 'Pa', expectation: 'Pressure must be reported as a unit mismatch and excluded from its difference plot; Temperature difference = -6 degC; State identical.' }),
                writeLog(scenario, 4, { name: '05_欠損値_ﾛｸﾞ.csv', missingValues: true, expectation: 'Pressure blanks every 100th sample including zero (101 missing, 9900 valid); Temperature blanks every 137th sample including zero (73 missing, 9928 valid). Valid differences: Pressure -40 kPa, Temperature -8 degC; blanks must not become zero.' }),
            ];
        } else {
            scenario.files = Array.from({ length: scenario.fileCount }, (_, i) => writeLog(scenario, i));
        }
        scenario.totalPoints = scenario.files.reduce((sum, f) => sum + f.points, 0);
        scenario.totalBytes = scenario.files.reduce((sum, f) => sum + f.bytes, 0);
        scenarios.push(scenario);
    }
    const manifest = {
        version: spec.version, outputRoot, encoding: 'UTF-8', delimiter: ',', headerRows: 2,
        timeConvention: 'The first row is physical time t=0; CSV Time=t+timeShift. Set file offset=timeShift(main)-timeShift(file).',
        differenceConvention: 'Main minus Sub. Pressure=10*(mainIndex-subIndex), Temperature=2*(mainIndex-subIndex), State=0 after alignment. Applies to regular/large; edge exceptions appear in each file expectation.',
        stateTransitions: spec.stateTransitions,
        csvNumericTolerance: { Pressure: 1e-6, Temperature: 1e-6 },
        numericTolerance: { Pressure: 1e-5, Temperature: 1e-5 },
        numericToleranceReason: 'CSV rounding tolerates 1e-6; the viewer stores channel values in Float32 and its original-data comparisons tolerate 1e-5 for these fixtures.',
        scenarios,
        totalFiles: scenarios.reduce((sum, s) => sum + s.files.length, 0),
        totalPoints: scenarios.reduce((sum, s) => sum + s.totalPoints, 0),
        totalBytes: scenarios.reduce((sum, s) => sum + s.totalBytes, 0),
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}

if (require.main === module) {
    const manifest = generate();
    console.log(JSON.stringify({ manifest: path.join(outputRoot, 'manifest.json'), totalFiles: manifest.totalFiles, totalPoints: manifest.totalPoints, totalBytes: manifest.totalBytes, scenarios: manifest.scenarios.map(s => ({ name: s.name, files: s.files.length, points: s.totalPoints, bytes: s.totalBytes })) }, null, 2));
}

module.exports = { generate, outputRoot, pressureAt, stateAt };
