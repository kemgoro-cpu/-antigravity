// .trnファイル読み込みの再現調査用スクリプト（使い捨て）
// parser-utils.js の関数を使って、実ファイルがどう解釈されるかを確認する
const fs = require('fs');
const path = require('path');
const U = require('../parser-utils.js');

const target = process.argv[2] || path.join(__dirname, '..', 'NEDC_sample_A.trn');
const bytes = new Uint8Array(fs.readFileSync(target));

// 1) エンコーディング検出
const enc = U.detectTextEncoding(bytes);
console.log('=== file:', path.basename(target), '===');
console.log('encoding:', enc);

// 2) デコード
const dec = U.decodeBytes(bytes, enc);
const text = dec.text;

// 3) 空白→タブ変換
const converted = U.convertWhitespaceToTabs(text);

// 4) 先頭行を2次元配列に（タブ分割）
const raw = converted.split('\n').slice(0, 50).map(l => l.split('\t'));

// 各行の列数を表示
console.log('\n-- 先頭8行の列数と内容（先頭6セル）--');
for (let i = 0; i < Math.min(8, raw.length); i++) {
    console.log(`row${i}: cols=${raw[i].length}  ${JSON.stringify(raw[i].slice(0, 6))}`);
}

// 5) ヘッダー検出（fallback: nameRow=0, unitRow=1）
const hdr = U.detectHeaderRows(raw, 0, 1);
console.log('\ndetectHeaderRows ->', hdr);

const headers = raw[hdr.nameRow] || [];
const units = hdr.unitRow >= 0 ? (raw[hdr.unitRow] || []) : [];
console.log('nameRow内容:', JSON.stringify(headers.slice(0, 12)));
console.log('unitRow内容:', JSON.stringify(units.slice(0, 12)));

// 6) Time列検出
let timeIdx = headers.findIndex(h => U.isTimeHeader(h));
console.log('timeIdx:', timeIdx);

// 7) チャンネル抽出（app.jsのロジックを再現）
const columns = [];
for (let i = 0; i < headers.length; i++) {
    if (i === timeIdx) continue;
    const rawName = (headers[i] || '').trim().replace(/^\|+\s*|\s*\|+$/g, '').trim();
    if (!rawName) continue;
    columns.push({ idx: i, name: rawName, unit: (units[i] || '').trim() });
}
console.log('抽出チャンネル数:', columns.length);
console.log('チャンネル:', JSON.stringify(columns.slice(0, 12)));
