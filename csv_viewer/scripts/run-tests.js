#!/usr/bin/env node
/**
 * tests/ 配下の全テスト（*.test.js）を順次実行するランナー。
 * 実行: npm test（csv_viewer/ で実行）
 *
 * 各テストファイルを個別の node プロセスで実行し、
 * 1本でも失敗（非0終了）があれば exit code 1 で終了する。
 * テストファイル自体は従来どおり `node tests/<name>.test.js` で単体実行できる。
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testsDir = path.join(__dirname, '..', 'tests');
const testFiles = fs.readdirSync(testsDir)
    .filter(name => name.endsWith('.test.js'))
    .sort();

if (testFiles.length === 0) {
    console.error('tests/ にテストファイル（*.test.js）が見つかりません');
    process.exit(1);
}

let failed = 0;
for (const name of testFiles) {
    const file = path.join(testsDir, name);
    const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
    if (result.status === 0) {
        console.log(`PASS ${name}`);
    } else {
        console.error(`FAIL ${name} (exit code: ${result.status})`);
        failed++;
    }
}

console.log(`\n${testFiles.length}本中 ${testFiles.length - failed}本成功 / ${failed}本失敗`);
process.exit(failed > 0 ? 1 : 0);
