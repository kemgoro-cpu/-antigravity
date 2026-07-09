// 文字コード自動判定の回帰バグ検証用（使い捨て）
// 「UTF-8ファイルを256KB境界で切ると、境界がマルチバイト文字の途中になり
//  Shift-JISと誤判定される」かどうかを確認する
const U = require('../parser-utils.js');

const enc = new TextEncoder(); // 常にUTF-8で符号化

// 日本語チャンネル名を含むUTF-8テキスト（実ファイルを模擬）
const header = '時間\tエンジン回転\t燃料噴射量\n';
const bytes = enc.encode(header); // UTF-8バイト列

console.log('全バイト列の判定:', U.detectTextEncoding(bytes), '(期待: utf-8)');

// 「あ」= E3 81 82 の3バイト。これを途中で切る = 末尾が不完全なUTF-8
const a = enc.encode('あ'); // [0xE3,0x81,0x82]
console.log('\n「あ」のバイト:', Array.from(a).map(b => b.toString(16)));

// パターン1: 完全な「あ」で終わる → utf-8のはず
const ok = new Uint8Array([...enc.encode('データ列'), ...a]);
console.log('完全終端:', U.detectTextEncoding(ok), '(期待: utf-8)');

// パターン2: 「あ」を最後の1バイト欠けで終端 → 不完全なUTF-8
const cut1 = new Uint8Array([...enc.encode('データ列'), a[0], a[1]]); // 3バイト目を欠落
console.log('1バイト欠け終端:', U.detectTextEncoding(cut1), '← ここがshift-jisになると誤判定バグ確定');

// パターン3: 2バイト欠け終端
const cut2 = new Uint8Array([...enc.encode('データ列'), a[0]]);
console.log('2バイト欠け終端:', U.detectTextEncoding(cut2), '← 同上');
