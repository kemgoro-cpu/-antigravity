// Auto-Alignの相関ベース並べ替え/初期チェックの検証（使い捨て）
// app.js の computeAlignCorrelations を最小再現し、実データ A vs B で
// 各チャンネルの |r| とおすすめ判定（r>=0.7 or 最上位）を確認する。
const fs = require('fs');
const path = require('path');
const U = require('../parser-utils.js');

function parseTrn(file) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const enc = U.detectTextEncoding(bytes);
    const text = U.decodeBytes(bytes, enc).text;
    const rows = U.convertWhitespaceToTabs(text).split('\n').map(l => l.split('\t'));
    const hdr = U.detectHeaderRows(rows.slice(0, 50), 0, 1);
    const headers = rows[hdr.nameRow] || [];
    const timeIdx = headers.findIndex(h => U.isTimeHeader(h));
    const dataStart = hdr.unitRow >= 0 ? hdr.unitRow + 1 : hdr.nameRow + 1;
    const timeData = [];
    const colArrays = headers.map(() => []);
    for (let r = dataStart; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length < 2) continue;
        const t = U.toNumber(row[timeIdx]);
        if (isNaN(t)) continue;
        timeData.push(t);
        for (let c = 0; c < headers.length; c++) colArrays[c].push(U.toNumber(row[c]));
    }
    const cols = {};
    headers.forEach((h, c) => {
        const name = (h || '').trim();
        if (name && c !== timeIdx) cols[name] = colArrays[c];
    });
    return { timeData, cols };
}
function interp(timeArr, valArr, t) {
    const n = timeArr.length;
    if (t <= timeArr[0]) return valArr[0];
    if (t >= timeArr[n - 1]) return valArr[n - 1];
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (timeArr[m] <= t) lo = m; else hi = m; }
    const dt = timeArr[hi] - timeArr[lo];
    return dt === 0 ? valArr[lo] : valArr[lo] + (t - timeArr[lo]) / dt * (valArr[hi] - valArr[lo]);
}

// app.js の computeAlignCorrelations と同じ計算
function correlations(main, sub, names, offset = 0) {
    const mTd = main.timeData, sTd = sub.timeData, len = mTd.length;
    const step = Math.max(1, Math.floor(len / 2000));
    const map = new Map();
    for (const name of names) {
        const mVals = main.cols[name], sVals = sub.cols[name];
        if (!mVals || !sVals) { map.set(name, 0); continue; }
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (let i = 0; i < len; i += step) {
            const tSub = mTd[i] - offset;
            if (tSub < sTd[0] || tSub > sTd[sTd.length - 1]) continue;
            const x = mVals[i], y = interp(sTd, sVals, tSub);
            if (isNaN(x) || isNaN(y)) continue;
            n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        }
        if (n < 3) { map.set(name, 0); continue; }
        const cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
        const denom = Math.sqrt(vx * vy);
        map.set(name, denom > 1e-12 ? Math.min(1, Math.abs(cov / denom)) : 0);
    }
    return map;
}

const A = parseTrn(path.join(__dirname, '..', 'NEDC_sample_A.trn'));
const B = parseTrn(path.join(__dirname, '..', 'NEDC_sample_B.trn'));
const names = Object.keys(A.cols).filter(n => B.cols[n]);

const corr = correlations(A, B, names, 0);
const sorted = [...names].sort((a, b) => corr.get(b) - corr.get(a));
const top = sorted[0];

console.log('=== Auto-Align 候補（相関の大きい順）main=A, sub=B, offset=0 ===');
console.log('  順位  チャンネル          r       初期チェック');
sorted.forEach((name, i) => {
    const r = corr.get(name);
    const checked = (name === top || r >= 0.7) ? '☑ ON ' : '☐ off';
    console.log(`  ${String(i + 1).padStart(2)}.  ${name.padEnd(18)} ${r.toFixed(3)}   ${checked}`);
});

// ── 合成データで「低相関は外す/定数は0/最上位は必ずON」を検証 ──
console.log('\n=== 合成データでの分岐確認 ===');
const len = A.timeData.length;
const A2 = { timeData: A.timeData, cols: {
    Good:  A.cols['Actual_Speed'],                                   // 似た波形 → 高相関
    Noise: Array.from({ length: len }, () => Math.random()),         // 乱数 → 低相関
    Const: new Array(len).fill(5),                                   // 定数 → 相関0
}};
const B2 = { timeData: B.timeData, cols: {
    Good:  B.cols['Actual_Speed'],
    Noise: Array.from({ length: len }, () => Math.random()),         // 別の乱数
    Const: new Array(len).fill(5),
}};
const n2 = ['Good', 'Noise', 'Const'];
const corr2 = correlations(A2, B2, n2, 0);
const sorted2 = [...n2].sort((a, b) => corr2.get(b) - corr2.get(a));
const top2 = sorted2[0];
console.log('  チャンネル   r       初期チェック   判定');
for (const name of sorted2) {
    const r = corr2.get(name);
    const on = (name === top2 || r >= 0.7);
    const why = name === 'Const' ? '定数→0' : name === 'Noise' ? '乱数→低' : '高相関';
    console.log(`  ${name.padEnd(8)} ${r.toFixed(3)}   ${on ? '☑ ON ' : '☐ off'}        ${why}`);
}
console.log('  → Good=ON, Noise/Const=off になれば分岐は正しい（最上位Goodは必ずON）');
