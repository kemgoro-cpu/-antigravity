// メイン/サブ入れ替えでクロスファイルCustom RAMの線が消えるバグの再現（使い捨て）
// app.js の getCrossRef / integral のロジックを最小再現して、
// 入れ替え前後で integral(Fuel_Rate - s1:Fuel_Rate) の NaN 数がどう変わるか確認する。
const fs = require('fs');
const path = require('path');
const U = require('../parser-utils.js');

// .trnファイルを { timeData: number[], cols: {name: number[]} } にパースする
function parseTrn(file) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const enc = U.detectTextEncoding(bytes);
    const text = U.decodeBytes(bytes, enc).text;
    const converted = U.convertWhitespaceToTabs(text);
    const rows = converted.split('\n').map(l => l.split('\t'));
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
        for (let c = 0; c < headers.length; c++) {
            colArrays[c].push(U.toNumber(row[c]));
        }
    }
    const cols = {};
    headers.forEach((h, c) => {
        const name = (h || '').trim().replace(/^\|+\s*|\s*\|+$/g, '').trim();
        if (name && c !== timeIdx) cols[name] = colArrays[c];
    });
    return { name: path.basename(file), timeData, cols, timeIdx, headers };
}

// app.js の getCrossRef を再現（offset考慮、範囲外はNaN）
function getCrossRef(mainTd, subFile, ramName, offset) {
    const subTd = subFile.timeData;
    const subVals = subFile.cols[ramName];
    if (!subVals) return null;
    const len = mainTd.length;
    const out = new Float64Array(len);
    for (let i = 0; i < len; i++) {
        const tSub = mainTd[i] - offset;
        if (tSub < subTd[0] || tSub > subTd[subTd.length - 1]) {
            out[i] = NaN;
        } else {
            out[i] = interp(subTd, subVals, tSub);
        }
    }
    return out;
}
function interp(timeArr, valArr, t) {
    const n = timeArr.length;
    if (t <= timeArr[0]) return valArr[0];
    if (t >= timeArr[n - 1]) return valArr[n - 1];
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (timeArr[mid] <= t) lo = mid; else hi = mid; }
    const dt = timeArr[hi] - timeArr[lo];
    if (dt === 0) return valArr[lo];
    return valArr[lo] + (t - timeArr[lo]) / dt * (valArr[hi] - valArr[lo]);
}

// app.js の integral（現状: NaN伝播あり）
function integralOld(x, td) {
    const len = x.length;
    const out = new Float64Array(len);
    out[0] = 0;
    for (let i = 1; i < len; i++) {
        const dt = td[i] - td[i - 1];
        out[i] = out[i - 1] + (x[i - 1] + x[i]) / 2 * dt;
    }
    return out;
}
// 修正版 integral（NaN耐性: 欠損区間はスキップして累積を据え置く）
function integralNew(x, td) {
    const len = x.length;
    const out = new Float64Array(len);
    let acc = 0;
    out[0] = isNaN(x[0]) ? NaN : 0;
    for (let i = 1; i < len; i++) {
        const dt = td[i] - td[i - 1];
        if (!isNaN(x[i - 1]) && !isNaN(x[i])) {
            acc += (x[i - 1] + x[i]) / 2 * dt;
            out[i] = acc;
        } else {
            out[i] = NaN; // 欠損点は描画しないが累積accは据え置き、復帰後に続行
        }
    }
    return out;
}
function countNaN(arr) { let n = 0; for (const v of arr) if (isNaN(v)) n++; return n; }

const A = parseTrn(path.join(__dirname, '..', 'NEDC_sample_A.trn'));
const B = parseTrn(path.join(__dirname, '..', 'NEDC_sample_B.trn'));

for (const f of [A, B]) {
    const td = f.timeData;
    console.log(`${f.name}: timeIdx=${f.timeIdx} 点数=${td.length} t0=${td[0]} tEnd=${td[td.length-1]} Fuel_Rate=${f.cols['Fuel_Rate'] ? 'あり' : 'なし'}`);
}
console.log('チャンネル例:', Object.keys(A.cols).slice(0, 10).join(', '));

function simulate(main, sub, subOffset, label) {
    const fr = main.cols['Fuel_Rate'];
    if (!fr) { console.log(`${label}: Fuel_Rateなし`); return; }
    const cross = getCrossRef(main.timeData, sub, 'Fuel_Rate', subOffset);
    const len = main.timeData.length;
    const diff = new Float64Array(len);
    for (let i = 0; i < len; i++) diff[i] = fr[i] - cross[i];
    const oldI = integralOld(diff, main.timeData);
    const newI = integralNew(diff, main.timeData);
    const verdict = n => n > len * 0.5 ? '★線がほぼ消える' : (n > 0 ? `欠損${n}点のみ` : 'OK');
    console.log(`${label}:`);
    console.log(`   crossref範囲外NaN=${countNaN(cross)}/${len}  最初の範囲外index=${cross.findIndex(v=>isNaN(v))}`);
    console.log(`   現状integral  NaN=${countNaN(oldI)}/${len}  → ${verdict(countNaN(oldI))}`);
    console.log(`   修正版integral NaN=${countNaN(newI)}/${len}  → ${verdict(countNaN(newI))}`);
}

console.log('\n=== オフセット0（完全同一範囲）===');
simulate(A, B, 0, '入れ替え後(main=B, sub=A, s1=A)');

// 実運用に近い再現: 旧メインAに正のオフセットが残ったまま入れ替え、Aが新サブになる。
// 入れ替えで offset は変化しない（setMainFileはroleのみ変更）ため、
// 新サブAのoffset>0 が crossref で「メイン先頭がサブ範囲外」を引き起こす。
console.log('\n=== 新サブA に offset=+3.0 が残っているケース（入れ替え後）===');
simulate(B, A, 3.0, '入れ替え後(main=B, sub=A, s1=A, A.offset=+3.0)');

// ── 要望1: オフセットが計算に反映されるか ──────────────────
// 同じ main=A, sub=B で offset を変えると、cross-ref のサンプリング位置が
// ずれて積分結果（最終累積値）が変わることを確認する。
console.log('\n=== 要望1: オフセットが計算結果を変えるか（main=A, sub=B）===');
function finalIntegral(main, sub, off) {
    const fr = main.cols['Fuel_Rate'];
    const cross = getCrossRef(main.timeData, sub, 'Fuel_Rate', off);
    const len = main.timeData.length;
    const diff = new Float64Array(len);
    for (let i = 0; i < len; i++) diff[i] = fr[i] - cross[i];
    const intg = integralNew(diff, main.timeData);
    // 最後の有効値（NaNでない最大index）を返す
    for (let i = len - 1; i >= 0; i--) if (!isNaN(intg[i])) return intg[i];
    return NaN;
}
for (const off of [0, 2, 5, 10]) {
    console.log(`   offset=${off}sec → 積分最終値=${finalIntegral(A, B, off).toFixed(3)}`);
}

// ── 要望2: 入れ替えでオフセット量を引き継ぐ（rebase）──────────
// setMainFile のオフセット再基準化を再現:
//   新メインのoffsetを全ファイルから引く → 新メイン=0, 相対ズレは保持
function rebaseOffsets(off, newMainKey) {
    const shift = off[newMainKey] || 0;
    const out = {};
    for (const k of Object.keys(off)) out[k] = (off[k] || 0) - shift;
    return out;
}
console.log('\n=== 要望2: 入れ替えでオフセット引き継ぎ（rebase）===');
// 初期: main=A(0), sub=B(5)  ← BをAに5秒揃えた状態
const off0 = { A: 0, B: 5 };
console.log(`   入れ替え前: A.offset=${off0.A}, B.offset=${off0.B}（main=A, sub=B）`);
const beforeFinal = finalIntegral(A, B, off0.B); // main=A基準, subB offset=5
// 入れ替え: B を新メインに → rebase
const off1 = rebaseOffsets(off0, 'B');
console.log(`   入れ替え後(rebase): A.offset=${off1.A}, B.offset=${off1.B}（main=B, sub=A）`);
const afterFinal = finalIntegral(B, A, off1.A);  // main=B基準, subA offset=-5
console.log(`   A-B積分(前)=${beforeFinal.toFixed(3)}  /  B-A積分(後,rebase)=${afterFinal.toFixed(3)}`);
console.log(`   → 入れ替えで符号反転した鏡像になるはず（|和|≈0 なら整合）: 和=${(beforeFinal + afterFinal).toFixed(3)}`);
// 比較: rebaseしなかった場合（従来）はA.offsetが0のままで関係が崩れる
const afterNoRebase = finalIntegral(B, A, 0); // A.offset=0（引き継がれず）
console.log(`   [rebase無し(従来)] B-A積分(後)=${afterNoRebase.toFixed(3)}  和=${(beforeFinal + afterNoRebase).toFixed(3)} ← 鏡像が崩れる(和が0から外れる)`);
