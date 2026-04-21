'use strict';

// ─────────────────────────────────────────────────────────────
// Error notification system
// ─────────────────────────────────────────────────────────────

const _errorLog = []; // { time, message, detail }

function showError(message, detail) {
    const entry = { time: new Date().toLocaleTimeString(), message, detail: detail || '' };
    _errorLog.push(entry);
    console.error(`[CSV Viewer] ${message}`, detail || '');

    // Create toast notification
    let container = document.getElementById('error-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'error-toast-container';
        container.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:480px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = 'background:#2d1216;border:1px solid #f43f5e;border-radius:8px;padding:12px 16px;color:#fda4af;font-size:13px;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);cursor:pointer;animation:slideIn 0.3s ease;';
    toast.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:#fb7185;">⚠ ${esc(message)}</div>`
        + (detail ? `<div style="font-size:11px;color:#f9a8b8;opacity:0.85;word-break:break-all;max-height:80px;overflow:auto;">${esc(String(detail))}</div>` : '')
        + `<div style="font-size:10px;color:#888;margin-top:4px;">${entry.time} — click to dismiss</div>`;
    toast.addEventListener('click', () => toast.remove());
    container.appendChild(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 15000);
}

// Catch all unhandled errors
window.addEventListener('error', e => {
    showError('Unhandled error', `${e.message}\n at ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', e => {
    showError('Unhandled promise rejection', String(e.reason));
});

// ─────────────────────────────────────────────────────────────
// Modal accessibility helper
// ─────────────────────────────────────────────────────────────

/**
 * モーダル共通のアクセシビリティ処理を仕込む。
 * - role="dialog" / aria-modal="true" を付与
 * - Esc キーで閉じる
 * - 開く直前のフォーカス要素を覚え、閉じたときに戻す
 * - 初期フォーカスをモーダル内の最初のボタンに移動
 *
 * @param {HTMLElement} overlay  body直下に appendChild した overlay 要素
 * @param {HTMLElement} modalEl  overlay 内のモーダル本体（中央の枠）
 */
function setupModalA11y(overlay, modalEl) {
    const prevFocus = document.activeElement;
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('tabindex', '-1');

    // Esc で閉じる（capture で他のkeydownより先に拾う）
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            overlay.remove();
        }
    };
    document.addEventListener('keydown', escHandler, true);

    // overlay が DOM から外れたら後始末: リスナー解除＋フォーカス復帰
    const observer = new MutationObserver(() => {
        if (!document.body.contains(overlay)) {
            observer.disconnect();
            document.removeEventListener('keydown', escHandler, true);
            if (prevFocus && typeof prevFocus.focus === 'function') {
                // 元の要素がまだ DOM にあれば戻す
                if (document.body.contains(prevFocus)) prevFocus.focus();
            }
        }
    });
    observer.observe(document.body, { childList: true });

    // 初期フォーカスをモーダル内の最初のフォーカス可能要素に
    setTimeout(() => {
        const focusable = modalEl.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        (focusable || modalEl).focus();
    }, 0);
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

// 色相を均等に分散させた20色パレット（隣接する色が同系色にならないよう配置）
// HSLで色相を黄金角（≈137.5°）ずつずらし、彩度・明度を交互に変えて区別しやすくしている
const SERIES_COLORS = generateDistinctColors(20);

/**
 * 視覚的に区別しやすい色を指定数だけ生成する。
 * 黄金角（≈137.5°）で色相をずらすことで、隣接する色が同系色になるのを避ける。
 * @param {number} n - 生成する色の数
 * @returns {string[]} #RRGGBB の配列
 */
function generateDistinctColors(n) {
    const colors = [];
    const goldenAngle = 137.508; // 黄金角（度）
    for (let i = 0; i < n; i++) {
        const hue = (i * goldenAngle) % 360;
        // 彩度と明度を交互に変えて、色相が近くても区別できるようにする
        const sat = (i % 2 === 0) ? 75 : 60;
        const lit = (i % 3 === 0) ? 60 : (i % 3 === 1) ? 50 : 65;
        colors.push(hslToHex(hue, sat, lit));
    }
    return colors;
}

/** HSL → #RRGGBB 変換 */
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;
    if      (h < 60)  { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// HTML-escape to safely insert text into innerHTML
function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────
// Expression parser for custom RAMs (recursive descent)
// 対応: +, -, *, /, ^, 括弧, 数値リテラル, RAM名, 関数呼び出し
//
// 【基本数学】 abs(x), sqrt(x), pow(x,n), log(x), exp(x)
//              sin(x), cos(x), tan(x), max(x,y), min(x,y), clamp(x,lo,hi)
// 【時系列】   integral(x), diff(x), mavg(x,n), delay(x,t)
// ─────────────────────────────────────────────────────────────

// --- 利用可能な関数の定義（ヘルプ表示にも使用） ---
const CUSTOM_RAM_FUNCTIONS = [
    { name: 'abs',      args: 'x',        desc: '絶対値' },
    { name: 'sqrt',     args: 'x',        desc: '平方根（ルート）' },
    { name: 'pow',      args: 'x, n',     desc: 'xのn乗（べき乗）' },
    { name: 'log',      args: 'x',        desc: '自然対数（ln）' },
    { name: 'exp',      args: 'x',        desc: '指数関数（eのx乗）' },
    { name: 'sin',      args: 'x',        desc: 'サイン（正弦）' },
    { name: 'cos',      args: 'x',        desc: 'コサイン（余弦）' },
    { name: 'tan',      args: 'x',        desc: 'タンジェント（正接）' },
    { name: 'max',      args: 'x, y',     desc: '2値の大きい方' },
    { name: 'min',      args: 'x, y',     desc: '2値の小さい方' },
    { name: 'clamp',    args: 'x, lo, hi', desc: '値をlo〜hiの範囲に制限' },
    { name: 'integral', args: 'x',        desc: '時間積分（台形法で累積値を計算）' },
    { name: 'diff',     args: 'x',        desc: '時間微分（変化率 = 傾き）' },
    { name: 'mavg',     args: 'x, n',     desc: '移動平均（n点で平滑化）' },
    { name: 'delay',    args: 'x, t',     desc: '時間遅延（t秒ずらす）' },
];

// 関数名のセット（パーサーが関数呼び出しか RAM名 かを区別するために使う）
const _builtinFuncNames = new Set(CUSTOM_RAM_FUNCTIONS.map(f => f.name));

/**
 * 式をトークン列に分割する。
 * トークンの種類:
 *   op(演算子), num(数値), name(RAM名 or 関数名),
 *   crossref(ファイル間参照: s1:Name), comma(引数区切り)
 *
 * ファイル間参照の書式: s1:Fuel_Rate, s2:Actual_Speed など
 *   s1 = サブファイル1番目, s2 = 2番目, ...
 */
function tokenizeExpr(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (/\s/.test(ch)) { i++; continue; }
        // カンマ（関数の引数区切り）
        if (ch === ',') { tokens.push({ type: 'comma' }); i++; continue; }
        // 演算子と括弧（^をべき乗演算子として追加）
        if ('+-*/()^'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }
        // 数値リテラル（小数点、指数表記に対応）
        if (/[\d.]/.test(ch)) {
            let num = '';
            while (i < expr.length && /[\d.eE\-+]/.test(expr[i])) {
                // eE の直後の +/- は指数の符号として許可
                if ((expr[i] === '+' || expr[i] === '-') && num.length > 0 && !/[eE]/.test(num[num.length - 1])) break;
                num += expr[i++];
            }
            tokens.push({ type: 'num', value: parseFloat(num) });
            continue;
        }
        // 識別子（RAM名 or 関数名 or ファイル間参照 s1:Name）
        // 英数字、アンダースコア、ドット、コロン、非ASCII（日本語など）を許可
        let name = '';
        while (i < expr.length && !/[\s+\-*/()^,]/.test(expr[i])) name += expr[i++];
        if (name) {
            // ファイル間参照の判定: s1:Name, s2:Name 形式
            const crossMatch = name.match(/^(s\d+):(.+)$/);
            if (crossMatch) {
                tokens.push({ type: 'crossref', fileKey: crossMatch[1], value: crossMatch[2] });
            } else {
                tokens.push({ type: 'name', value: name });
            }
        }
    }
    return tokens;
}

/**
 * 式をAST（抽象構文木）にパースする。
 * ASTノード:
 *   { type: 'num', value: number }
 *   { type: 'name', value: string }          -- RAM名
 *   { type: 'binop', op, left, right }       -- 二項演算
 *   { type: 'unary', op, operand }           -- 単項 +/-
 *   { type: 'call', name, args: [ASTNode] }  -- 関数呼び出し
 */
function parseExprToAST(expr) {
    const tokens = tokenizeExpr(expr);
    let pos = 0;

    function peek() { return pos < tokens.length ? tokens[pos] : null; }
    function next() { return tokens[pos++]; }

    // expr = term (('+' | '-') term)*
    function parseExpr() {
        let left = parseTerm();
        while (peek() && (peek().value === '+' || peek().value === '-')) {
            const op = next().value;
            left = { type: 'binop', op, left, right: parseTerm() };
        }
        return left;
    }

    // term = power (('*' | '/') power)*
    function parseTerm() {
        let left = parsePower();
        while (peek() && (peek().value === '*' || peek().value === '/')) {
            const op = next().value;
            left = { type: 'binop', op, left, right: parsePower() };
        }
        return left;
    }

    // power = factor ('^' factor)?  （右結合）
    function parsePower() {
        let base = parseFactor();
        if (peek() && peek().value === '^') {
            next();
            base = { type: 'binop', op: '^', left: base, right: parsePower() };
        }
        return base;
    }

    // factor = unary | '(' expr ')' | funcCall | number | ramName
    function parseFactor() {
        const t = peek();
        if (!t) return { type: 'num', value: NaN };

        // 単項マイナス
        if (t.type === 'op' && t.value === '-') {
            next();
            return { type: 'unary', op: '-', operand: parseFactor() };
        }
        // 単項プラス
        if (t.type === 'op' && t.value === '+') {
            next();
            return parseFactor();
        }
        // 括弧
        if (t.type === 'op' && t.value === '(') {
            next();
            const node = parseExpr();
            if (peek() && peek().value === ')') next();
            return node;
        }
        // 数値
        if (t.type === 'num') {
            next();
            return { type: 'num', value: t.value };
        }
        // ファイル間参照 (s1:Name)
        if (t.type === 'crossref') {
            next();
            return { type: 'crossref', fileKey: t.fileKey, value: t.value };
        }
        // 関数呼び出し or RAM名
        if (t.type === 'name') {
            next();
            // 次が '(' なら関数呼び出し
            if (peek() && peek().value === '(') {
                next(); // consume '('
                const args = [];
                if (!(peek() && peek().value === ')')) {
                    args.push(parseExpr());
                    while (peek() && peek().type === 'comma') {
                        next(); // consume ','
                        args.push(parseExpr());
                    }
                }
                if (peek() && peek().value === ')') next();
                return { type: 'call', name: t.value, args };
            }
            // RAM名
            return { type: 'name', value: t.value };
        }
        return { type: 'num', value: NaN };
    }

    return parseExpr();
}

/**
 * ASTを全データポイント分まとめて評価し、Float32Arrayを返す。
 *
 * getArray(ramName) → Float32Array : RAM名からデータ配列を取得
 * timeData → Float64Array : 時間軸データ（積分・微分・遅延に使用）
 * len : データ点数
 * getCrossRef(fileKey, ramName) → Float32Array : ファイル間参照（s1:Name等）を
 *   メインの時間軸に補間して返す。省略時はcrossrefノードでNaNを返す。
 *
 * 各ノードの評価結果はFloat32Array（配列全体）で返す。
 * これにより時系列関数（integral, diff, mavg, delay）が実装できる。
 */
function evaluateAST(ast, getArray, timeData, len, getCrossRef) {
    // 定数 → 全要素同じ値の配列を返す
    function fillConst(v) {
        const arr = new Float32Array(len);
        arr.fill(v);
        return arr;
    }

    // 二項演算を要素ごとに適用
    function binop(op, a, b) {
        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            switch (op) {
                case '+': out[i] = a[i] + b[i]; break;
                case '-': out[i] = a[i] - b[i]; break;
                case '*': out[i] = a[i] * b[i]; break;
                case '/': out[i] = a[i] / b[i]; break;
                case '^': out[i] = Math.pow(a[i], b[i]); break;
            }
        }
        return out;
    }

    // 要素ごとに1引数の Math 関数を適用
    function mapFn(arr, fn) {
        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) out[i] = fn(arr[i]);
        return out;
    }

    // --- ASTノードを再帰的に評価 ---
    function evalNode(node) {
        if (node.type === 'num') return fillConst(node.value);
        if (node.type === 'name') {
            const arr = getArray(node.value);
            return arr || fillConst(NaN);
        }
        // ファイル間参照: s1:Name → サブファイルのデータをメイン時間軸に補間
        if (node.type === 'crossref') {
            if (getCrossRef) {
                const arr = getCrossRef(node.fileKey, node.value);
                return arr || fillConst(NaN);
            }
            return fillConst(NaN);
        }
        if (node.type === 'unary') {
            const v = evalNode(node.operand);
            const out = new Float32Array(len);
            for (let i = 0; i < len; i++) out[i] = -v[i];
            return out;
        }
        if (node.type === 'binop') {
            return binop(node.op, evalNode(node.left), evalNode(node.right));
        }
        if (node.type === 'call') {
            return evalCall(node.name, node.args);
        }
        return fillConst(NaN);
    }

    // --- 関数呼び出しの評価 ---
    function evalCall(name, argNodes) {
        switch (name) {
            // ── 基本数学（要素ごと） ──
            case 'abs':   return mapFn(evalNode(argNodes[0]), Math.abs);
            case 'sqrt':  return mapFn(evalNode(argNodes[0]), Math.sqrt);
            case 'log':   return mapFn(evalNode(argNodes[0]), Math.log);
            case 'exp':   return mapFn(evalNode(argNodes[0]), Math.exp);
            case 'sin':   return mapFn(evalNode(argNodes[0]), Math.sin);
            case 'cos':   return mapFn(evalNode(argNodes[0]), Math.cos);
            case 'tan':   return mapFn(evalNode(argNodes[0]), Math.tan);

            case 'pow': {
                const base = evalNode(argNodes[0]);
                const exp  = evalNode(argNodes[1]);
                return binop('^', base, exp);
            }
            case 'max': {
                const a = evalNode(argNodes[0]), b = evalNode(argNodes[1]);
                const out = new Float32Array(len);
                for (let i = 0; i < len; i++) out[i] = Math.max(a[i], b[i]);
                return out;
            }
            case 'min': {
                const a = evalNode(argNodes[0]), b = evalNode(argNodes[1]);
                const out = new Float32Array(len);
                for (let i = 0; i < len; i++) out[i] = Math.min(a[i], b[i]);
                return out;
            }
            case 'clamp': {
                const x  = evalNode(argNodes[0]);
                const lo = evalNode(argNodes[1]);
                const hi = evalNode(argNodes[2]);
                const out = new Float32Array(len);
                for (let i = 0; i < len; i++) out[i] = Math.max(lo[i], Math.min(hi[i], x[i]));
                return out;
            }

            // ── 時系列関数 ──

            // integral(x): 台形法による時間積分（累積値）
            case 'integral': {
                const x = evalNode(argNodes[0]);
                const out = new Float32Array(len);
                out[0] = 0;
                for (let i = 1; i < len; i++) {
                    const dt = timeData[i] - timeData[i - 1];
                    // 台形法: (前の値 + 現在の値) / 2 × 時間差
                    out[i] = out[i - 1] + (x[i - 1] + x[i]) / 2 * dt;
                }
                return out;
            }

            // diff(x): 時間微分（前後の差分 / 時間差 = 変化率）
            case 'diff': {
                const x = evalNode(argNodes[0]);
                const out = new Float32Array(len);
                out[0] = 0; // 最初の点は微分できないので0
                for (let i = 1; i < len; i++) {
                    const dt = timeData[i] - timeData[i - 1];
                    out[i] = dt > 0 ? (x[i] - x[i - 1]) / dt : 0;
                }
                return out;
            }

            // mavg(x, n): 移動平均（n点の窓で平滑化）
            case 'mavg': {
                const x = evalNode(argNodes[0]);
                // nは定数として先頭の値を使う（全要素同じ値のはず）
                const nArr = evalNode(argNodes[1]);
                const n = Math.max(1, Math.round(nArr[0]));
                const out = new Float32Array(len);
                let sum = 0;
                for (let i = 0; i < len; i++) {
                    sum += isNaN(x[i]) ? 0 : x[i];
                    if (i >= n) sum -= isNaN(x[i - n]) ? 0 : x[i - n];
                    const count = Math.min(i + 1, n);
                    out[i] = sum / count;
                }
                return out;
            }

            // delay(x, t): 時間遅延（t秒シフト、線形補間）
            case 'delay': {
                const x = evalNode(argNodes[0]);
                const tArr = evalNode(argNodes[1]);
                const delayT = tArr[0]; // 遅延時間（秒）は定数
                const out = new Float32Array(len);
                for (let i = 0; i < len; i++) {
                    // 現在時刻から delayT 秒前の値を線形補間で取得
                    const targetT = timeData[i] - delayT;
                    out[i] = interpolateArray(timeData, x, targetT, len);
                }
                return out;
            }

            default:
                // 未知の関数 → NaN
                console.warn(`[Custom RAM] Unknown function: ${name}`);
                return fillConst(NaN);
        }
    }

    return evalNode(ast);
}

/**
 * delay関数用: 時間配列から指定時刻の値を線形補間で取得する。
 * interpolate() はFloat32Arrayにも対応させたバージョン。
 */
function interpolateArray(timeArr, valArr, t, n) {
    if (n === 0) return NaN;
    if (t <= timeArr[0])     return valArr[0];
    if (t >= timeArr[n - 1]) return valArr[n - 1];
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (timeArr[mid] <= t) lo = mid; else hi = mid;
    }
    const dt = timeArr[hi] - timeArr[lo];
    if (dt === 0) return valArr[lo];
    return valArr[lo] + (t - timeArr[lo]) / dt * (valArr[hi] - valArr[lo]);
}

/**
 * 後方互換: 1点ずつ評価する旧API（extractExprNamesで使用）
 */
function evaluateExpr(expr, getVal) {
    const ast = parseExprToAST(expr);
    function evalNode(node) {
        if (node.type === 'num') return node.value;
        if (node.type === 'name') return getVal(node.value);
        if (node.type === 'unary') return -evalNode(node.operand);
        if (node.type === 'binop') {
            const l = evalNode(node.left), r = evalNode(node.right);
            switch (node.op) {
                case '+': return l + r; case '-': return l - r;
                case '*': return l * r; case '/': return l / r;
                case '^': return Math.pow(l, r);
            }
        }
        return NaN;
    }
    return evalNode(ast);
}

// Actual hex values — ECharts does NOT understand CSS variables
const T = {
    text:   '#f0f0f0',
    dim:    '#a0a5b1',
    border: 'rgba(255,255,255,0.08)',
    grid:   'rgba(255,255,255,0.05)',
    axis:   'rgba(255,255,255,0.15)',
};

// Chart layout constants (px)
const L = {
    gridLeft:   70,
    gridRight:  38,
    topPx:      8,    // no ECharts legend → minimal top padding
    bottomPx:   68,
    gapPx:      6,
    yZoomW:     16,
    yZoomRight: 6,
};

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

const state = {
    files:          {},     // fileId → FileRecord
    selectedNames:  new Set(), // set of RAM names (from main file) to display
    yRanges:        {},     // ramName → { min: string, max: string }
    chart:          null,
    colorCtr:       0,
    brushMode:      false,
    shiftMode:      false,
    shiftFileId:    null,   // which sub file is the drag target
    shiftDrag:      null,   // { startClientX, startOffset }
    numGrids:       0,
    customRAMs:     [],     // [{ name, expr, id }]
    zoomHistory:    [],     // X軸ズーム状態の履歴 [{ start, end }, ...]
    zoomHistoryIdx: -1,     // 現在の履歴位置（-1 = 履歴なし）
    zoomUndoRedoing: false, // Undo/Redo操作中フラグ（履歴の二重記録を防止）
    mergedGroups:   [],     // [[nameA, nameB], ...] チャンネルマージのペア
    gridRegions:    [],     // [{ name, top, height, unit }] ドラッグ判定用
    mergeDrag:      null,   // { sourceName, ghostEl } マージドラッグ中の状態
    bitChannels:    new Set(), // Bitモード（0/1表示、グリッド高さ縮小）のチャンネル名
    monoColorMode:  false,     // 単色モード: trueならファイル単位の色で描画
    fileColors:     {},        // fileId → '#RRGGBB' ファイルごとの色（単色モード用）
};

// 復元待ちの設定（ファイル読込後に適用される）
let _pendingSettings = null;

// FileRecord: { name, shortName, columns, timeData, colData, role, offset, file, headerInfo }
//   role: 'main' | 'sub'
//   offset: number (seconds, for sub files)
//   file: File object reference (for lazy column loading)
//   headerInfo: { nameRow, unitRow, dataStart, timeIdx, timeUnit } (cached parse metadata)

// ─────────────────────────────────────────────────────────────
// チャンネルマージ管理ヘルパー
// ─────────────────────────────────────────────────────────────

/** nameが既にマージペアに含まれているか */
function isMerged(name) {
    return state.mergedGroups.some(([a, b]) => a === name || b === name);
}

/** nameのマージ相手を返す（なければnull） */
function getMergedPartner(name) {
    for (const [a, b] of state.mergedGroups) {
        if (a === name) return b;
        if (b === name) return a;
    }
    return null;
}

/** 2つのチャンネルをマージする */
function addMerge(nameA, nameB) {
    if (isMerged(nameA) || isMerged(nameB)) return false;
    if (nameA === nameB) return false;
    state.mergedGroups.push([nameA, nameB]);
    return true;
}

/** nameを含むマージペアを解除する */
function removeMerge(name) {
    state.mergedGroups = state.mergedGroups.filter(([a, b]) => a !== name && b !== name);
}

// ─────────────────────────────────────────────────────────────
// Bitチャンネル判定
// ─────────────────────────────────────────────────────────────

/**
 * Float32Arrayの値が0と1（およびNaN）のみかどうかを判定する。
 * Bitチャンネル（デジタル信号）の自動検出に使用。
 */
function isBitData(arr) {
    if (!arr || arr.length === 0) return false;
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (isNaN(v)) continue;
        if (v !== 0 && v !== 1) return false;
    }
    return true;
}

/**
 * ファイルの読み込み済みカラムについてBit判定を行い、
 * 自動検出されたものを state.bitChannels に追加する。
 * （ユーザーが手動でOFFにしたものは再追加しない）
 */
function detectBitChannels(fileRecord) {
    for (const col of fileRecord.columns) {
        const data = fileRecord.colData[col.id];
        if (!data) continue;
        // まだbitChannelsに入っておらず、手動でOFFにされたわけでもない場合のみ追加
        // （_bitManualOff に入っていたらスキップ）
        if (!_bitManualOff.has(col.name) && isBitData(data)) {
            state.bitChannels.add(col.name);
        }
    }
}

// ユーザーが手動でBitモードをOFFにしたチャンネル名を記憶
// （再読み込み時に自動検出で勝手にONに戻さないため）
const _bitManualOff = new Set();

// ─────────────────────────────────────────────────────────────
// DOM references
// ─────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
    dropZone:   $('drop-zone'),
    fileInput:  $('file-input'),
    fileList:   $('file-list'),
    colSearch:  $('column-search'),
    colList:    $('column-list'),
    colHdr:     $('channel-source-label'),
    chartEl:    $('chart'),
    overlay:    $('chart-overlay'),
    clearBtn:   $('clear-all-btn'),
    zoomBtn:    $('zoom-mode-btn'),
    resetBtn:   $('reset-zoom-btn'),
    shiftBtn:   $('shift-mode-btn'),
    hintEl:     $('toolbar-hint'),
    nameRow:    $('name-row-idx'),
    unitRow:    $('unit-row-idx'),
    sampling:   $('sampling-mode'),
    customName: $('custom-ram-name'),
    customExpr: $('custom-ram-expr'),
    customAdd:  $('custom-ram-add'),
    customList: $('custom-ram-list'),
    customSuggest:    $('custom-ram-suggest'),
    customValidation: $('custom-ram-validation'),
    monoColorBtn: $('mono-color-btn'),
    exportPng:  $('export-png-btn'),
    copyChart:  $('copy-chart-btn'),
    exportSettings: $('export-settings-btn'),
    importSettings: $('import-settings-btn'),
};

// ─────────────────────────────────────────────────────────────
// Chart initialisation
// ─────────────────────────────────────────────────────────────

function initChart() {
    state.chart = echarts.init(dom.chartEl, null, {
        backgroundColor: 'transparent',
        renderer: 'canvas',
    });
    window.addEventListener('resize', () => state.chart.resize());
    state.chart.on('brushEnd', onBrushEnd);

    dom.chartEl.addEventListener('mouseleave', () => {
        _lastTooltipParams = null;
        for (const el of _labelEls) el.style.display = 'none';
    });

    // Y軸ラベル領域のホバーカーソル（grab/pointer）
    dom.chartEl.addEventListener('mousemove', e => {
        // ドラッグ中やシフトモード中はスキップ
        if (state.mergeDrag || state.shiftMode || state.brushMode) return;
        if (isInYAxisArea(e.clientX) && hitTestGrid(e.clientY)) {
            const hit = hitTestGrid(e.clientY);
            dom.chartEl.style.cursor = (hit && hit.region.merged) ? 'pointer' : 'grab';
        } else if (!state.shiftDrag) {
            dom.chartEl.style.cursor = '';
        }
    });

    setupShiftDrag();
    setupMergeDrag();
}

// ─────────────────────────────────────────────────────────────
// Drag-to-shift: move sub file timeline by dragging on chart
// ─────────────────────────────────────────────────────────────

function setupShiftDrag() {
    let rafId = null;

    dom.chartEl.addEventListener('mousedown', e => {
        if (!state.shiftMode || !state.shiftFileId || e.button !== 0) return;
        e.preventDefault();
        state.shiftDrag = {
            startClientX: e.clientX,
            startOffset:  state.files[state.shiftFileId]?.offset ?? 0,
        };
        dom.chartEl.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', e => {
        if (!state.shiftDrag) return;
        const rect = dom.chartEl.getBoundingClientRect();
        const px1  = state.shiftDrag.startClientX - rect.left;
        const px2  = e.clientX - rect.left;

        const t1 = state.chart.convertFromPixel({ xAxisIndex: 0 }, px1);
        const t2 = state.chart.convertFromPixel({ xAxisIndex: 0 }, px2);
        if (t1 == null || t2 == null || isNaN(t1) || isNaN(t2)) return;

        const delta = t2 - t1;
        state.files[state.shiftFileId].offset = state.shiftDrag.startOffset + delta;

        // Sync the offset input field
        const inp = document.querySelector(`[data-offset-id="${state.shiftFileId}"]`);
        if (inp) inp.value = state.files[state.shiftFileId].offset.toFixed(3);

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => { renderChart(); rafId = null; });
    });

    document.addEventListener('mouseup', () => {
        if (state.shiftDrag) {
            state.shiftDrag = null;
            dom.chartEl.style.cursor = state.shiftMode ? 'grab' : '';
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Drag-to-merge: Y軸ラベルをドラッグして別のグリッドにマージ
// ─────────────────────────────────────────────────────────────

/**
 * チャート上のY座標からどのグリッドか判定する。
 * グリッド領域情報（state.gridRegions）を使用。
 * 返値: { index, region } または null
 */
function hitTestGrid(clientY) {
    const rect = dom.chartEl.getBoundingClientRect();
    const y = clientY - rect.top;
    for (let i = 0; i < state.gridRegions.length; i++) {
        const r = state.gridRegions[i];
        if (y >= r.top && y <= r.top + r.height) return { index: i, region: r };
    }
    return null;
}

/**
 * X座標がY軸ラベル領域（グリッドの左端）にあるか判定する。
 */
function isInYAxisArea(clientX) {
    const rect = dom.chartEl.getBoundingClientRect();
    const x = clientX - rect.left;
    return x >= 0 && x <= L.gridLeft;
}

function setupMergeDrag() {
    let ghostEl = null;    // ドラッグ中に表示するゴースト要素
    let sourceGrid = null; // ドラッグ元のグリッド情報
    let targetGrid = null; // ドラッグ先のグリッド情報

    // ゴースト要素を作成する
    function createGhost(name) {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;padding:4px 10px;background:rgba(99,102,241,0.9);color:#fff;font-size:11px;font-family:Inter,sans-serif;border-radius:4px;pointer-events:none;z-index:100001;white-space:nowrap;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
        el.textContent = name;
        document.body.appendChild(el);
        return el;
    }

    // ターゲットグリッドのハイライト要素
    let highlightEl = null;
    function showHighlight(region, valid) {
        if (!highlightEl) {
            highlightEl = document.createElement('div');
            highlightEl.style.cssText = 'position:absolute;pointer-events:none;z-index:100000;border-radius:4px;transition:opacity 0.15s;';
            dom.chartEl.style.position = 'relative';
            dom.chartEl.appendChild(highlightEl);
        }
        highlightEl.style.display = '';
        highlightEl.style.left = '0px';
        highlightEl.style.top = region.top + 'px';
        highlightEl.style.width = L.gridLeft + 'px';
        highlightEl.style.height = region.height + 'px';
        highlightEl.style.background = valid
            ? 'rgba(99,102,241,0.15)' : 'rgba(239,68,68,0.15)';
        highlightEl.style.border = valid
            ? '2px solid rgba(99,102,241,0.5)' : '2px solid rgba(239,68,68,0.4)';
    }
    function hideHighlight() {
        if (highlightEl) highlightEl.style.display = 'none';
    }

    // --- mousedown: Y軸ラベル領域でドラッグ開始 ---
    dom.chartEl.addEventListener('mousedown', e => {
        // シフトモードやブラシモード中は無効
        if (state.shiftMode || state.brushMode) return;
        if (e.button !== 0) return;
        if (!isInYAxisArea(e.clientX)) return;

        const hit = hitTestGrid(e.clientY);
        if (!hit) return;

        // マージ済みグリッドのドラッグも許可（移動先を変える用途に使える）
        sourceGrid = hit;
        // まだドラッグ確定しない（少し動かしてから確定）
    });

    // --- mousemove: ドラッグ中の表示 ---
    document.addEventListener('mousemove', e => {
        if (!sourceGrid) return;

        // ゴーストが未作成 → ドラッグ開始
        if (!ghostEl) {
            ghostEl = createGhost(sourceGrid.region.name);
            dom.chartEl.style.cursor = 'grabbing';
        }

        // ゴーストをマウスに追従させる
        ghostEl.style.left = (e.clientX + 12) + 'px';
        ghostEl.style.top  = (e.clientY - 12) + 'px';

        // ターゲットグリッドのハイライト
        const hit = hitTestGrid(e.clientY);
        if (hit && hit.index !== sourceGrid.index) {
            targetGrid = hit;
            // 同じ単位かどうかで色を変える
            const valid = hit.region.unit === sourceGrid.region.unit
                       && !isMerged(hit.region.name)
                       && !isMerged(sourceGrid.region.name);
            showHighlight(hit.region, valid);
            ghostEl.style.background = valid
                ? 'rgba(99,102,241,0.9)' : 'rgba(239,68,68,0.9)';
        } else {
            targetGrid = null;
            hideHighlight();
            if (ghostEl) ghostEl.style.background = 'rgba(99,102,241,0.9)';
        }
    });

    // --- mouseup: ドロップ → マージ実行 ---
    document.addEventListener('mouseup', () => {
        if (!sourceGrid) return;

        if (ghostEl && targetGrid) {
            const srcName = sourceGrid.region.name;
            const tgtName = targetGrid.region.name;

            if (sourceGrid.region.unit === targetGrid.region.unit
                && !isMerged(srcName) && !isMerged(tgtName)) {
                // マージ実行
                addMerge(tgtName, srcName);
                ensureColumnsAndRender();
            } else {
                showError('マージできません', '同じ単位で、まだマージされていないチャンネル同士のみマージ可能です。');
            }
        }

        // クリーンアップ
        if (ghostEl) { ghostEl.remove(); ghostEl = null; }
        hideHighlight();
        sourceGrid = null;
        targetGrid = null;
        dom.chartEl.style.cursor = '';
    });

    // --- dblclick: マージ解除 ---
    dom.chartEl.addEventListener('dblclick', e => {
        if (state.shiftMode || state.brushMode) return;
        if (!isInYAxisArea(e.clientX)) return;

        const hit = hitTestGrid(e.clientY);
        if (!hit) return;

        const name = hit.region.name;
        if (isMerged(name)) {
            removeMerge(name);
            ensureColumnsAndRender();
        }
    });
}

// ─────────────────────────────────────────────────────────────
// File drag-drop & input
// ─────────────────────────────────────────────────────────────

dom.dropZone.addEventListener('dragover', e => { e.preventDefault(); dom.dropZone.classList.add('dragover'); });
dom.dropZone.addEventListener('dragleave', () => dom.dropZone.classList.remove('dragover'));
dom.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dom.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});
dom.fileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFiles(e.target.files);
    dom.fileInput.value = '';
});

// 対応するファイル拡張子（.csv と .trn）
const SUPPORTED_EXTENSIONS = ['.csv', '.trn'];

function handleFiles(files) {
    Array.from(files).forEach(f => {
        const ext = f.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
        if (SUPPORTED_EXTENSIONS.includes(ext)) parseCSV(f);
        else alert(`未対応の形式です: ${f.name}\nCSV または TRN ファイルをアップロードしてください。`);
    });
}

// ─────────────────────────────────────────────────────────────
// CSV parsing
// ─────────────────────────────────────────────────────────────

/**
 * ファイル拡張子からPapaParseの区切り文字設定を返す。
 * .trn → タブ区切り、.csv → PapaParseの自動検出に任せる
 */
/**
 * ファイル拡張子からPapaParseの区切り文字設定を返す。
 * .trn → ホワイトスペース（空白）区切りなので前処理が必要
 * .csv → PapaParseの自動検出に任せる
 *
 * 注意: PapaParseは空白区切りを直接サポートしていないため、
 * .trn ファイルは parseCSV 内でテキストを前処理してからパースする。
 */
function isTrnFile(fileName) {
    return fileName.toLowerCase().endsWith('.trn');
}

/**
 * TRNファイル用: パイプ記号(|)を除去し、連続する空白をタブ1つに置換する。
 * PapaParseは空白区切りを直接サポートしていないため、タブ区切りに変換する。
 * パイプはTRNヘッダーの装飾記号で、データ行には存在しないため、
 * 残すと列数がズレてしまう。
 */
function convertWhitespaceToTabs(text) {
    return text.split('\n')
        .map(line => line.replace(/\|/g, ' ').trim().replace(/\s+/g, '\t'))
        .join('\n');
}

function parseCSV(file) {
    const fileId = 'f' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const trn = isTrnFile(file.name);
    console.log(`[CSV Viewer] parseCSV: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB, format=${trn ? 'TRN(whitespace)' : 'CSV(auto)'})`);

    if (trn) {
        // TRNファイル: テキストを読み込んで空白→タブに変換してからパースする
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const converted = convertWhitespaceToTabs(reader.result);
                // Phase 1: Preview parse（先頭50行だけ抽出してヘッダー検出）
                const previewLines = converted.split('\n').slice(0, 50).join('\n');
                const previewRes = Papa.parse(previewLines, {
                    delimiter: '\t',
                    header: false,
                    dynamicTyping: false,
                    skipEmptyLines: true,
                });
                // 変換済みテキストを保持するため、fileの代わりにconvertedを渡す
                onHeaderParsed(fileId, file.name, converted, previewRes.data, '\t');
            } catch (e) {
                showError(`TRN parse failed: ${file.name}`, e.stack || e.message);
            }
        };
        reader.onerror = () => showError(`File read error: ${file.name}`, reader.error?.message);
        reader.readAsText(file);
    } else {
        // CSVファイル: PapaParseに直接Fileオブジェクトを渡す
        try {
            Papa.parse(file, {
                header: false,
                dynamicTyping: false,
                skipEmptyLines: true,
                preview: 50,
                complete: res => {
                    try {
                        onHeaderParsed(fileId, file.name, file, res.data, undefined);
                    } catch (e) {
                        showError(`Header parse failed: ${file.name}`, e.stack || e.message);
                    }
                },
                error: err => {
                    showError(`CSV parse error: ${file.name}`, err.message || String(err));
                },
            });
        } catch (e) {
            showError(`Failed to start parsing: ${file.name}`, e.stack || e.message);
        }
    }
}

/**
 * セル文字列がTime列かどうかを判定する。
 * "Time", "time", "| Time", "|Time", "時間" などにマッチする。
 * パイプ記号(|)やスペースを除去してから判定する。
 */
function isTimeHeader(cell) {
    if (typeof cell !== 'string') return false;
    const cleaned = cell.replace(/[|\s]/g, '').toLowerCase();
    return cleaned.includes('time') || cell.includes('時間');
}

function detectHeaderRows(raw) {
    const scanLimit = Math.min(50, raw.length);
    for (let r = 0; r < scanLimit; r++) {
        const row = raw[r];
        if (row.length < 2) continue;
        // Partial match: any cell containing "time" or "時間"（パイプ付きも対応）
        const hasTime = row.some(c => isTimeHeader(c));
        if (!hasTime) continue;
        const nameRow = r;
        let unitRow = -1;
        if (r + 1 < raw.length) {
            const next = raw[r + 1];
            const timeUnits = ['s', 'ms', 'sec', 'min'];
            const hasTimeUnit = next.some(c =>
                typeof c === 'string' && timeUnits.includes(c.trim().toLowerCase())
            );
            if (hasTimeUnit) {
                unitRow = r + 1;
            } else {
                // Unit row not detected — default to the row right after channel names
                unitRow = r + 1;
            }
        }
        return { nameRow, unitRow };
    }
    return {
        nameRow: parseInt(dom.nameRow.value, 10) - 1,
        unitRow: parseInt(dom.unitRow.value, 10) - 1,
    };
}

function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    const u = v.trim().toUpperCase();
    if (u === 'TRUE')  return 1;
    if (u === 'FALSE') return 0;
    const n = parseFloat(v);
    return isNaN(n) ? NaN : n;
}

/**
 * Phase 1: Header-only parse complete.
 * Extracts column metadata and stores File reference for lazy loading.
 * Does NOT load any column data yet — only time data is loaded via streaming.
 */
function onHeaderParsed(fileId, fileName, file, raw, delimiter) {
    const { nameRow, unitRow } = detectHeaderRows(raw);
    const dataStart = Math.max(nameRow, unitRow >= 0 ? unitRow : nameRow) + 1;

    if (raw.length <= dataStart) {
        alert(`Could not parse "${fileName}".\nTry adjusting Name/Unit Row in Settings.`);
        return;
    }

    dom.nameRow.value = nameRow + 1;
    if (unitRow >= 0) dom.unitRow.value = unitRow + 1;

    const headers = raw[nameRow];
    const units   = unitRow >= 0 ? raw[unitRow] : Array(headers.length).fill('');

    let timeIdx = headers.findIndex(h => isTimeHeader(h));
    if (timeIdx < 0) timeIdx = 0;

    const timeUnit = unitRow >= 0 ? (raw[unitRow][timeIdx] || '').trim().toLowerCase() : '';

    const columns = [];
    for (let i = 0; i < headers.length; i++) {
        if (i === timeIdx) continue;
        // 列名の先頭末尾のパイプ(|)とスペースを除去（TRNファイル対応）
        const rawName = (headers[i] || '').trim().replace(/^\|+\s*|\s*\|+$/g, '').trim();
        // パイプだけの空セルや空文字はスキップ（区切り記号が独立した列になった場合）
        if (!rawName) continue;
        columns.push({
            id:    `${fileId}_c${i}`,
            name:  rawName || `Col_${i}`,
            unit:  (units[i]   || '').trim().replace(/^\|+\s*|\s*\|+$/g, '').trim(),
            idx:   i,
            color: SERIES_COLORS[state.colorCtr++ % SERIES_COLORS.length],
        });
    }

    const hasMain   = Object.values(state.files).some(f => f.role === 'main');
    const role      = hasMain ? 'sub' : 'main';
    const shortName = fileName.length > 22 ? fileName.slice(0, 20) + '…' : fileName;

    // Phase 2: Stream-parse to extract ONLY time data (no column values yet)
    const timeChunks = [];
    let rowIdx = 0;

    console.log(`[CSV Viewer] Phase 2: streaming time data for ${fileName} (dataStart=${dataStart}, timeIdx=${timeIdx})`);

    try {
        Papa.parse(file, {
            delimiter: delimiter,
            header: false,
            dynamicTyping: false,
            skipEmptyLines: true,
            step: function(result) {
                rowIdx++;
                if (rowIdx <= dataStart) return; // skip header rows
                const row = result.data;
                if (!row) return;
                const t = toNumber(row[timeIdx]);
                if (!isNaN(t)) {
                    timeChunks.push(timeUnit === 'ms' ? t / 1000 : t);
                }
            },
            complete: function() {
                try {
                    console.log(`[CSV Viewer] Time data loaded: ${timeChunks.length} points for ${fileName}`);
                    const timeData = new Float64Array(timeChunks.length);
                    for (let i = 0; i < timeChunks.length; i++) timeData[i] = timeChunks[i];

                    state.files[fileId] = {
                        name: fileName, shortName, columns, timeData,
                        colData: {},  // empty — columns loaded on demand
                        role, offset: 0,
                        file,         // File reference for lazy column loading
                        headerInfo: { nameRow, unitRow, dataStart, timeIdx, timeUnit, delimiter },
                    };

                    // ファイル色を自動割り当て（単色モード用）
                    if (!state.fileColors[fileId]) {
                        const fileCount = Object.keys(state.fileColors).length;
                        state.fileColors[fileId] = SERIES_COLORS[fileCount % SERIES_COLORS.length];
                    }

                    if (role === 'sub' && !state.shiftFileId) state.shiftFileId = fileId;

                    // 保留中の設定があればファイル読込後に適用する
                    applyPendingSettings();

                    // 既存のCustom RAMがあれば新ファイルにも計算・追加する
                    if (state.customRAMs.length > 0) {
                        addCustomRAMsToFile(fileId).then(() => {
                            updateUI();
                            saveSettings();
                        });
                    } else {
                        updateUI();
                        saveSettings();
                    }
                } catch (e) {
                    showError(`Failed to process time data: ${fileName}`, e.stack || e.message);
                }
            },
            error: err => {
                showError(`Time data parse error: ${fileName}`, err.message || String(err));
            },
        });
    } catch (e) {
        showError(`Failed to start time streaming: ${fileName}`, e.stack || e.message);
    }
}

/**
 * Lazy-load specific columns for a file. Only parses columns not already in colData.
 * Returns a Promise that resolves when loading is complete.
 * Uses a per-file parse queue to prevent duplicate concurrent parses.
 */
const _parseQueue = new Map(); // fileId → Promise (in-flight parse)

function loadColumnsForFile(fileId, colNames) {
    const f = state.files[fileId];
    if (!f || !f.file) return Promise.resolve();

    // Determine which columns need loading (not yet in colData and not being loaded)
    // Custom RAMカラム（isCustom）はファイルパースではなく式で計算するためスキップ
    const colsToLoad = [];
    for (const name of colNames) {
        const col = f.columns.find(c => c.name === name);
        if (col && !col.isCustom && !f.colData[col.id]) colsToLoad.push(col);
    }
    if (colsToLoad.length === 0) {
        // If there's an in-flight parse for this file, wait for it (may be loading our columns)
        return _parseQueue.get(fileId) || Promise.resolve();
    }

    // If there's already a parse in progress for this file, chain after it
    const prev = _parseQueue.get(fileId) || Promise.resolve();
    const job = prev.then(async () => {
        // Re-check which columns still need loading (previous parse may have loaded some)
        const stillNeeded = colsToLoad.filter(col => !f.colData[col.id]);
        if (stillNeeded.length === 0) return;

        // Verify File object is still readable before parsing
        // （TRNファイルは変換済み文字列なのでチェック不要）
        if (f.file instanceof File) {
            try {
                await f.file.slice(0, 1).text();
            } catch (e) {
                showError(
                    `File re-read failed: ${f.name}`,
                    `File object is no longer accessible. This may be caused by browser security policy or the file was moved/deleted.\n${e.message}`
                );
                return;
            }
        }

        const colNamesStr = stillNeeded.map(c => c.name).join(', ');
        console.log(`[CSV Viewer] Loading columns [${colNamesStr}] from ${f.name}`);

        const { dataStart, timeIdx, delimiter: delim } = f.headerInfo;

        return new Promise(resolve => {
            try {
                const tempArrs = {};
                for (const col of stillNeeded) tempArrs[col.id] = [];

                let rowIdx = 0;

                Papa.parse(f.file, {
                    delimiter: delim,
                    header: false,
                    dynamicTyping: false,
                    skipEmptyLines: true,
                    step: function(result) {
                        rowIdx++;
                        if (rowIdx <= dataStart) return;
                        const row = result.data;
                        if (!row) return;
                        const t = toNumber(row[timeIdx]);
                        if (isNaN(t)) return;
                        for (const col of stillNeeded) {
                            tempArrs[col.id].push(toNumber(row[col.idx]));
                        }
                    },
                    complete: function() {
                        try {
                            for (const col of stillNeeded) {
                                f.colData[col.id] = new Float32Array(tempArrs[col.id]);
                            }
                            console.log(`[CSV Viewer] Columns loaded: [${colNamesStr}] (${tempArrs[stillNeeded[0].id].length} rows)`);
                            // Bitチャンネル自動検出
                            detectBitChannels(f);
                        } catch (e) {
                            showError(`Failed to store column data: ${f.name}`, e.stack || e.message);
                        }
                        resolve();
                    },
                    error: function(err) {
                        showError(`Column parse error: ${f.name}`, err.message || String(err));
                        resolve();
                    },
                });
            } catch (e) {
                showError(`Failed to start column loading: ${f.name}`, e.stack || e.message);
                resolve();
            }
        });
    });

    // Clean up queue entry when done
    const cleanup = job.then(() => {
        if (_parseQueue.get(fileId) === cleanup) _parseQueue.delete(fileId);
    });
    _parseQueue.set(fileId, cleanup);

    return cleanup;
}

/**
 * Ensure all selected columns are loaded for all relevant files,
 * then re-render the chart.
 */
async function ensureColumnsAndRender() {
    const names = [...state.selectedNames];
    if (names.length === 0) { renderChart(); return; }

    try {
        const promises = [];
        for (const [fid, f] of Object.entries(state.files)) {
            // Load selected columns that exist in this file
            const relevantNames = names.filter(n => f.columns.some(c => c.name === n));
            if (relevantNames.length > 0) {
                promises.push(loadColumnsForFile(fid, relevantNames));
            }
        }
        await Promise.all(promises);
        renderColumnList(); // Bitバッジの反映
        renderChart();
    } catch (e) {
        showError('Failed to load column data', e.stack || e.message);
        renderChart();
    }
}

// ─────────────────────────────────────────────────────────────
// File management (roles)
// ─────────────────────────────────────────────────────────────

function getMainFile()   { return Object.values(state.files).find(f => f.role === 'main'); }
function getMainFileId() { return Object.keys(state.files).find(id => state.files[id].role === 'main'); }
function getSubFileIds() { return Object.keys(state.files).filter(id => state.files[id].role === 'sub'); }

async function setMainFile(newMainId) {
    const oldMainId = getMainFileId();
    if (oldMainId === newMainId) return;
    if (oldMainId) state.files[oldMainId].role = 'sub';
    state.files[newMainId].role = 'main';

    // 新しいMainファイルに存在するチャンネルだけ選択を維持する
    const newMain = state.files[newMainId];
    const newColNames = new Set(newMain.columns.map(c => c.name));
    state.selectedNames = new Set(
        [...state.selectedNames].filter(name => newColNames.has(name))
    );
    // マージグループも両方のチャンネルが新Mainに存在するペアだけ残す
    state.mergedGroups = state.mergedGroups.filter(
        ([a, b]) => newColNames.has(a) && newColNames.has(b)
    );
    await recomputeCustomRAMs();
    updateUI();
}

function removeFile(fileId) {
    const wasMain = state.files[fileId]?.role === 'main';
    delete state.files[fileId];
    delete state.fileColors[fileId];

    if (state.shiftFileId === fileId) {
        state.shiftFileId = getSubFileIds()[0] ?? null;
        if (!state.shiftFileId && state.shiftMode) exitShiftMode();
    }

    if (wasMain) {
        state.selectedNames = new Set();
        state.mergedGroups  = [];
        const remaining = Object.keys(state.files);
        if (remaining.length) state.files[remaining[0]].role = 'main';
    }

    updateUI();
}

dom.clearBtn.addEventListener('click', () => {
    state.files         = {};
    state.selectedNames = new Set();
    state.mergedGroups  = [];
    state.bitChannels   = new Set();
    _bitManualOff.clear();
    state.yRanges       = {};
    state.colorCtr      = 0;
    state.fileColors    = {};
    state.shiftFileId   = null;
    state.zoomHistory   = [];
    state.zoomHistoryIdx = -1;
    _pendingSettings    = null; // 保留設定もクリア
    if (state.shiftMode) exitShiftMode();
    updateUI();
    // localStorageの保存データもクリア
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
});

// ─────────────────────────────────────────────────────────────
// UI updates
// ─────────────────────────────────────────────────────────────

function updateUI() {
    renderFileList();
    renderColumnList();

    // If columns are selected, ensure their data is loaded before rendering chart
    if (state.selectedNames.size > 0) {
        ensureColumnsAndRender();
    } else {
        renderChart();
    }

    const hasFiles = Object.keys(state.files).length > 0;
    dom.clearBtn.disabled = !hasFiles;

    const hasSub = getSubFileIds().length > 0;
    if (dom.shiftBtn) dom.shiftBtn.disabled = !hasSub;
    if (!hasSub && state.shiftMode) exitShiftMode();

    // 状態が変わるたびにlocalStorageに保存
    saveSettings();
}

function renderFileList() {
    dom.fileList.innerHTML = '';

    // サブファイルの番号を計算（s1, s2, ...）Custom RAM式で使う識別子
    const subIds = getSubFileIds();
    const subIndexMap = new Map(); // fid → 1-based index
    subIds.forEach((sid, i) => subIndexMap.set(sid, i + 1));

    for (const [fid, f] of Object.entries(state.files)) {
        const isMain    = f.role === 'main';
        const subNum    = subIndexMap.get(fid); // undefined for main
        const isShiftTgt = state.shiftMode && fid === state.shiftFileId;
        const li        = document.createElement('li');
        li.className    = `file-item${isShiftTgt ? ' shift-target' : ''}`;

        const offsetRow = isMain ? '' : `
            <div class="file-offset-row">
                <span class="offset-label">Δt&nbsp;(s)</span>
                <input type="number" class="offset-input" step="0.001"
                    value="${f.offset.toFixed(3)}"
                    data-offset-id="${fid}"
                    title="Time offset applied to this sub file (seconds)">
                <button class="btn-auto" data-auto-id="${fid}" title="Auto-align to main">Auto</button>
            </div>`;

        // バッジ表示: Main=M, Sub=s1,s2,...（Custom RAM式で使うID）
        const badgeText = isMain ? 'M' : `s${subNum}`;
        const badgeTitle = isMain
            ? 'Main file — 右クリックで色変更'
            : `Sub file (s${subNum}) — クリックでMain切替 / 右クリックで色変更\nCustom RAM式で s${subNum}:チャンネル名 と書くと参照できます`;
        // ファイル色をバッジの背景色に反映
        const fColor = state.fileColors[fid] || '#6366f1';

        li.innerHTML = `
            <div class="file-item-top">
                <div class="role-badge ${isMain ? 'role-main' : 'role-sub'}"
                    data-roleid="${fid}"
                    title="${badgeTitle}"
                    style="background:${fColor};color:#fff;border-color:${fColor};"
                >${badgeText}</div>
                <input type="color" class="file-color-picker" data-colorid="${fid}"
                    value="${fColor}" style="display:none;">
                <span class="file-name-text" title="${esc(f.name)}">${esc(f.name)}</span>
                <i class='bx bx-bug debug-file' data-fid="${fid}" title="Debug: パース結果を確認"></i>
                <i class='bx bx-x remove-file' data-fid="${fid}" title="Remove"></i>
            </div>
            ${offsetRow}
        `;

        // Click on sub file row in shift mode → change active shift target
        if (state.shiftMode && !isMain) {
            li.querySelector('.file-item-top').style.cursor = 'pointer';
            li.querySelector('.file-item-top').addEventListener('click', e => {
                if (e.target.closest('.remove-file') || e.target.closest('.role-badge')) return;
                state.shiftFileId = fid;
                dom.hintEl.textContent = `Drag chart ← → to shift: ${f.shortName}`;
                renderFileList();
            });
        }

        dom.fileList.appendChild(li);
    }

    // Role toggle（左クリック）
    dom.fileList.querySelectorAll('[data-roleid]').forEach(el => {
        el.addEventListener('click', () => setMainFile(el.dataset.roleid));
        // 右クリックでカラーピッカーを開く
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            const picker = el.parentElement.querySelector('.file-color-picker');
            if (picker) picker.click();
        });
    });

    // ファイル色変更（カラーピッカー）
    dom.fileList.querySelectorAll('.file-color-picker').forEach(inp => {
        inp.addEventListener('input', () => {
            const fid = inp.dataset.colorid;
            state.fileColors[fid] = inp.value;
            renderFileList(); // バッジ色を更新
            if (state.monoColorMode) renderChart(); // 単色モード中ならチャートも更新
            saveSettings();
        });
    });

    // Remove
    dom.fileList.querySelectorAll('.remove-file').forEach(el => {
        el.addEventListener('click', () => removeFile(el.dataset.fid));
    });

    // Offset input change
    dom.fileList.querySelectorAll('.offset-input').forEach(inp => {
        inp.addEventListener('change', () => {
            const fid = inp.dataset.offsetId;
            const v   = parseFloat(inp.value);
            if (!isNaN(v) && state.files[fid]) {
                state.files[fid].offset = v;
                renderChart();
                saveSettings();
            }
        });
    });

    // Auto-align
    dom.fileList.querySelectorAll('[data-auto-id]').forEach(btn => {
        btn.addEventListener('click', () => autoAlign(btn.dataset.autoId));
    });

    // Debug: パース結果を確認
    dom.fileList.querySelectorAll('.debug-file').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            showDebugModal(el.dataset.fid);
        });
    });
}

// ─────────────────────────────────────────────────────────────
// デバッグモーダル: パース結果の確認
// ─────────────────────────────────────────────────────────────

/**
 * ファイルのパース結果をモーダルで表示する。
 * headerInfo, timeData, columns の状態を確認できる。
 * TRNファイルの場合は変換後のテキスト先頭も表示する。
 */
function showDebugModal(fileId) {
    const f = state.files[fileId];
    if (!f) return;

    const hi = f.headerInfo;
    const td = f.timeData;

    // --- セクション1: headerInfo（パース設定）---
    let html = `<h3 style="margin:0 0 12px;color:#818cf8;">Parse Info</h3>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:16px;">`;
    const infoRows = [
        ['ファイル名', f.name],
        ['role', f.role],
        ['nameRow (0始まり)', hi.nameRow],
        ['unitRow (0始まり)', hi.unitRow],
        ['dataStart (0始まり)', hi.dataStart],
        ['timeIdx (列番号)', hi.timeIdx],
        ['timeUnit', hi.timeUnit || '(なし)'],
        ['delimiter', hi.delimiter === '\t' ? 'TAB (\\t)' : hi.delimiter === undefined ? 'auto' : JSON.stringify(hi.delimiter)],
        ['columns数', f.columns.length],
        ['timeData長', td.length],
    ];
    for (const [k, v] of infoRows) {
        html += `<tr><td style="padding:3px 8px;color:#a0a5b1;white-space:nowrap;">${esc(k)}</td>`
            + `<td style="padding:3px 8px;color:#f0f0f0;font-family:'Roboto Mono',monospace;">${esc(String(v))}</td></tr>`;
    }
    html += `</table>`;

    // --- セクション2: timeDataの先頭・末尾 ---
    html += `<h3 style="margin:0 0 8px;color:#818cf8;">Time Data（先頭10 / 末尾5）</h3>`;
    html += `<div style="font-family:'Roboto Mono',monospace;font-size:11px;color:#86efac;margin-bottom:16px;">`;
    if (td.length === 0) {
        html += `(空)`;
    } else {
        const head = Array.from(td.slice(0, 10)).map((v, i) => `[${i}] ${v}`);
        const tail = td.length > 10 ? Array.from(td.slice(-5)).map((v, i) => `[${td.length - 5 + i}] ${v}`) : [];
        html += head.join('<br>');
        if (tail.length) html += `<br><span style="color:#a0a5b1;">... (${td.length} points total)</span><br>` + tail.join('<br>');
    }
    html += `</div>`;

    // --- セクション3: columns一覧 ---
    html += `<h3 style="margin:0 0 8px;color:#818cf8;">Columns</h3>`;
    html += `<div style="font-size:11px;max-height:120px;overflow-y:auto;margin-bottom:16px;">`;
    html += `<table style="border-collapse:collapse;width:100%;">`;
    html += `<tr style="color:#a0a5b1;"><td style="padding:2px 6px;">idx</td><td style="padding:2px 6px;">name</td><td style="padding:2px 6px;">unit</td><td style="padding:2px 6px;">loaded</td></tr>`;
    for (const c of f.columns.slice(0, 30)) {
        const loaded = f.colData[c.id] ? `${f.colData[c.id].length} pts` : '-';
        html += `<tr><td style="padding:2px 6px;color:#a0a5b1;font-family:monospace;">${c.idx}</td>`
            + `<td style="padding:2px 6px;color:#f0f0f0;">${esc(c.name)}</td>`
            + `<td style="padding:2px 6px;color:#a0a5b1;">${esc(c.unit)}</td>`
            + `<td style="padding:2px 6px;color:#86efac;font-family:monospace;">${loaded}</td></tr>`;
    }
    if (f.columns.length > 30) html += `<tr><td colspan="4" style="color:#a0a5b1;padding:4px 6px;">... 他 ${f.columns.length - 30} 列</td></tr>`;
    html += `</table></div>`;

    // --- セクション4: 変換後テキスト（TRN）またはファイル先頭プレビュー ---
    if (typeof f.file === 'string') {
        // dataStart前後を含めて表示（ヘッダー + 実データ最初の数行）
        const showUntil = hi.dataStart + 5;  // dataStartの5行先まで
        html += `<h3 style="margin:0 0 8px;color:#818cf8;">変換後テキスト（〜行${showUntil}）</h3>`;
        const lines = f.file.split('\n').slice(0, showUntil + 1);
        html += `<pre style="font-size:10px;color:#fda4af;background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;overflow-x:auto;white-space:pre;max-width:100%;">`;
        for (let i = 0; i < lines.length; i++) {
            // 各行の役割をラベル表示
            let label = '';
            if (i === hi.nameRow)  label = ' ← nameRow';
            if (i === hi.unitRow)  label = ' ← unitRow';
            if (i === hi.dataStart) label = ' ← dataStart';
            // タブを見やすく可視化
            const vis = esc(lines[i]).replace(/\t/g, '<span style="color:#6366f1;">⇥</span>');
            html += `<span style="color:#a0a5b1;">[${i}]</span> ${vis}<span style="color:#f59e0b;font-weight:600;">${label}</span>\n`;
        }
        html += `</pre>`;
    }

    // --- モーダル表示 ---
    let overlay = document.getElementById('debug-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'debug-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:640px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;';
    modal.innerHTML = html
        + `<div style="text-align:right;margin-top:12px;"><button onclick="this.closest('#debug-modal-overlay').remove()" `
        + `style="background:#6366f1;color:#fff;border:none;border-radius:6px;padding:6px 18px;cursor:pointer;font-size:13px;">閉じる</button></div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setupModalA11y(overlay, modal);
}

// ─────────────────────────────────────────────────────────────
// Custom RAM (computed channels)
// ─────────────────────────────────────────────────────────────

/** Extract RAM names referenced in an expression (組み込み関数名は除外) */
function extractExprNames(expr) {
    return tokenizeExpr(expr)
        .filter(t => t.type === 'name' && !_builtinFuncNames.has(t.value))
        .map(t => t.value);
}

/**
 * 式からファイル間参照（s1:Name等）のカラム名を抽出する。
 * @returns {{ fileKey: string, name: string }[]}
 */
function extractCrossRefs(expr) {
    return tokenizeExpr(expr)
        .filter(t => t.type === 'crossref')
        .map(t => ({ fileKey: t.fileKey, name: t.value }));
}

/**
 * 式にファイル間参照（s1:Name等）が含まれるかどうかを判定する。
 */
function hasCrossRef(expr) {
    return tokenizeExpr(expr).some(t => t.type === 'crossref');
}

/**
 * Custom RAMの式をAST一括評価で計算する。
 * 時系列関数（integral, diff, mavg, delay）にも対応。
 * ファイル間参照（s1:Name等）にも対応。
 * @param {string} expr - 計算式
 * @param {object} fileRecord - 対象ファイル（メインでもサブでも可）
 */
function computeCustomExpr(expr, fileRecord) {
    const td = fileRecord.timeData;
    const len = td.length;
    const ast = parseExprToAST(expr);

    // RAM名 → Float32Array を返す関数
    const getArray = (ramName) => {
        const col = fileRecord.columns.find(c => c.name === ramName);
        if (!col) return null;
        return fileRecord.colData[col.id] || null;
    };

    // ファイル間参照（s1:Name等）→ サブファイルのデータをメイン時間軸に補間
    // fileKey = "s1", "s2" ... → サブファイルの追加順（1始まり）
    const getCrossRef = (fileKey, ramName) => {
        const subIds = getSubFileIds();
        // "s1" → index 0, "s2" → index 1 ...
        const idx = parseInt(fileKey.replace('s', ''), 10) - 1;
        if (idx < 0 || idx >= subIds.length) return null;

        const subFile = state.files[subIds[idx]];
        if (!subFile) return null;

        const col = subFile.columns.find(c => c.name === ramName);
        if (!col) return null;
        const subVals = subFile.colData[col.id];
        if (!subVals) return null;

        // メインの時間軸に合わせて補間（オフセット考慮）
        const subTd = subFile.timeData;
        const offset = subFile.offset;
        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            // メインの時刻tに対応するサブの時刻 = t - offset
            const tSub = td[i] - offset;
            if (tSub < subTd[0] || tSub > subTd[subTd.length - 1]) {
                out[i] = NaN; // サブの範囲外
            } else {
                out[i] = interpolateArray(subTd, subVals, tSub, subTd.length);
            }
        }
        return out;
    };

    return evaluateAST(ast, getArray, td, len, getCrossRef);
}

async function addCustomRAM(name, expr) {
    const mainFile = getMainFile();
    if (!mainFile || !name.trim() || !expr.trim()) return;

    name = name.trim();
    // Prefix with @ if not already starting with a special character
    if (!/^[@#$%]/.test(name)) name = '@' + name;
    // Prevent duplicate names
    if (mainFile.columns.some(c => c.name === name)) {
        alert(`Channel "${name}" already exists.`);
        return;
    }

    // 式で参照されるカラム名を取得
    const refNames = extractExprNames(expr);
    // ファイル間参照（s1:Name等）のカラム名も取得
    const crossRefs = extractCrossRefs(expr);
    const isCrossFile = crossRefs.length > 0;

    // メインファイルの参照カラムをロード
    const mainFileId = getMainFileId();
    const loadPromises = [];
    if (mainFileId) loadPromises.push(loadColumnsForFile(mainFileId, refNames));

    // 全ファイルで参照カラムをロード（ファイル間参照の有無に関わらず）
    for (const [fid, f] of Object.entries(state.files)) {
        if (fid !== mainFileId) {
            loadPromises.push(loadColumnsForFile(fid, refNames));
        }
    }
    // ファイル間参照がある場合、該当サブファイルの参照カラムもロード
    if (isCrossFile) {
        const subIds = getSubFileIds();
        for (const cr of crossRefs) {
            const idx = parseInt(cr.fileKey.replace('s', ''), 10) - 1;
            if (idx >= 0 && idx < subIds.length) {
                loadPromises.push(loadColumnsForFile(subIds[idx], [cr.name]));
            }
        }
    }
    await Promise.all(loadPromises);

    const id = `custom_${Date.now()}`;

    // メインファイルで計算してエラーチェック
    const mainVals = computeCustomExpr(expr, mainFile);
    if (mainVals.every(v => isNaN(v))) {
        alert(`式のエラー: "${expr}" を評価できません。\nRAM名や関数名を確認してください。`);
        return;
    }

    // 全ファイルに追加（ファイル間参照の有無に関わらず全ファイルで計算）
    for (const [fid, f] of Object.entries(state.files)) {
        const colId = (f === mainFile) ? id : `${id}_${fid}`;
        const color = SERIES_COLORS[state.colorCtr++ % SERIES_COLORS.length];
        const colDef = { id: colId, name, unit: '', idx: -1, color, isCustom: true, isCrossFile };
        f.columns.unshift(colDef);
        const vals = (f === mainFile) ? mainVals : computeCustomExpr(expr, f);
        f.colData[colId] = vals;
    }

    state.customRAMs.push({ name, expr, id });
    state.selectedNames.add(name);

    renderCustomRAMList();
    renderColumnList();
    renderChart();
}

function removeCustomRAM(id) {
    const idx = state.customRAMs.findIndex(c => c.id === id);
    if (idx < 0) return;

    const name = state.customRAMs[idx].name;
    state.customRAMs.splice(idx, 1);

    // 全ファイルからCustom RAMカラムを削除
    for (const [fid, f] of Object.entries(state.files)) {
        // メインファイルはidそのまま、サブファイルは id_fid 形式
        f.columns = f.columns.filter(c => !(c.isCustom && c.name === name));
        // colDataも名前で照合して削除（IDがファイルごとに異なるため）
        for (const key of Object.keys(f.colData)) {
            if (key === id || key.startsWith(id + '_')) {
                delete f.colData[key];
            }
        }
    }
    state.selectedNames.delete(name);
    removeMerge(name);

    renderCustomRAMList();
    renderColumnList();
    renderChart();
}

async function recomputeCustomRAMs() {
    if (state.customRAMs.length === 0) return;

    // 全ファイルから既存のCustom RAMカラムを削除
    for (const [fid, f] of Object.entries(state.files)) {
        f.columns = f.columns.filter(c => !c.isCustom);
        for (const key of Object.keys(f.colData)) {
            if (key.startsWith('custom_')) delete f.colData[key];
        }
    }

    // 全ファイルで参照カラムをロード（通常参照＋ファイル間参照）
    const allRefNames = [];
    const allCrossRefs = [];
    for (const cr of state.customRAMs) {
        allRefNames.push(...extractExprNames(cr.expr));
        allCrossRefs.push(...extractCrossRefs(cr.expr));
    }

    const loadPromises = [];
    if (allRefNames.length > 0) {
        for (const [fid] of Object.entries(state.files)) {
            loadPromises.push(loadColumnsForFile(fid, allRefNames));
        }
    }
    // ファイル間参照のカラムもロード
    const subIds = getSubFileIds();
    for (const cr of allCrossRefs) {
        const idx = parseInt(cr.fileKey.replace('s', ''), 10) - 1;
        if (idx >= 0 && idx < subIds.length) {
            loadPromises.push(loadColumnsForFile(subIds[idx], [cr.name]));
        }
    }
    await Promise.all(loadPromises);

    const mainFile = getMainFile();

    // Custom RAMを再計算
    // Custom RAMを全ファイルに再計算・追加（ファイル間参照の有無に関わらず）
    for (const cr of state.customRAMs) {
        const isCross = hasCrossRef(cr.expr);
        for (const [fid, f] of Object.entries(state.files)) {
            const colId = (f.role === 'main') ? cr.id : `${cr.id}_${fid}`;
            const color = SERIES_COLORS[state.colorCtr++ % SERIES_COLORS.length];
            const colDef = { id: colId, name: cr.name, unit: '', idx: -1, color, isCustom: true, isCrossFile: isCross };
            f.columns.unshift(colDef);
            f.colData[colId] = computeCustomExpr(cr.expr, f);
        }
    }
}

/**
 * 新しく追加されたファイルに既存のCustom RAMを計算・追加する。
 * ファイル読込完了後に呼ばれる。
 */
async function addCustomRAMsToFile(fileId) {
    const f = state.files[fileId];
    if (!f || state.customRAMs.length === 0) return;

    // 参照カラムをロード
    const allRefNames = [];
    for (const cr of state.customRAMs) allRefNames.push(...extractExprNames(cr.expr));
    if (allRefNames.length > 0) {
        await loadColumnsForFile(fileId, allRefNames);
    }

    // 各Custom RAMを計算してカラムに追加（ファイル間参照ありも含む）
    for (const cr of state.customRAMs) {
        // すでに同名カラムがあればスキップ
        if (f.columns.some(c => c.name === cr.name)) continue;

        const isCross = hasCrossRef(cr.expr);
        const colId  = (f.role === 'main') ? cr.id : `${cr.id}_${fileId}`;
        const color  = SERIES_COLORS[state.colorCtr++ % SERIES_COLORS.length];

        const colDef = { id: colId, name: cr.name, unit: '', idx: -1, color, isCustom: true, isCrossFile: isCross };
        f.columns.unshift(colDef);
        f.colData[colId] = computeCustomExpr(cr.expr, f);
    }
}

function renderCustomRAMList() {
    dom.customList.innerHTML = '';
    for (const cr of state.customRAMs) {
        const li = document.createElement('li');
        li.className = 'custom-ram-item';
        li.innerHTML = `<span class="cr-name">${esc(cr.name)}</span>`
            + `<span class="cr-expr" title="${esc(cr.expr)}">${esc(cr.expr)}</span>`
            + `<i class='bx bx-x cr-del' data-crid="${esc(cr.id)}" title="Remove"></i>`;
        dom.customList.appendChild(li);
    }
    dom.customList.querySelectorAll('.cr-del').forEach(el => {
        el.addEventListener('click', () => removeCustomRAM(el.dataset.crid));
    });
}

dom.customAdd.addEventListener('click', () => {
    addCustomRAM(dom.customName.value, dom.customExpr.value);
    dom.customName.value = '';
    dom.customExpr.value = '';
    // バリデーション表示をクリア
    dom.customValidation.textContent = '';
    dom.customValidation.className = 'custom-ram-validation';
});

// ── Custom RAM サジェスト（オートコンプリート） ──

/** 式のカーソル位置から直前の「単語」を抽出する */
function getWordAtCursor(input) {
    const pos = input.selectionStart;
    const text = input.value.substring(0, pos);
    // 演算子・括弧・空白で区切った最後のトークンを取得
    const m = text.match(/((?:[a-zA-Z_]\w*:)?[a-zA-Z_]\w*)$/);
    return m ? { word: m[1], start: pos - m[1].length, end: pos } : null;
}

/** サジェスト候補を構築する */
function buildSuggestions(partial) {
    const results = [];
    const lower = partial.toLowerCase();

    // ファイル間参照プレフィックス（s1:, s2:, ...）のチェック
    const crossMatch = partial.match(/^(s\d+):(.*)$/i);
    let targetFile = null;
    let searchTerm = lower;

    if (crossMatch) {
        // s1:Foo → サブファイルのチャンネル名で検索
        const fileKey = crossMatch[1].toLowerCase();
        searchTerm = crossMatch[2].toLowerCase();
        const subIds = getSubFileIds();
        const idx = parseInt(fileKey.replace('s', ''), 10) - 1;
        if (idx >= 0 && idx < subIds.length) {
            targetFile = state.files[subIds[idx]];
        }
    }

    if (targetFile) {
        // サブファイルのチャンネル名を候補に
        for (const col of targetFile.columns) {
            if (!col.isCustom && col.name.toLowerCase().startsWith(searchTerm)) {
                results.push({ text: `${crossMatch[1]}:${col.name}`, type: `[${targetFile.shortName}]` });
            }
        }
    } else {
        // Mainファイルのチャンネル名を候補に
        const mainFile = getMainFile();
        if (mainFile) {
            for (const col of mainFile.columns) {
                if (col.name.toLowerCase().startsWith(lower)) {
                    results.push({ text: col.name, type: col.isCustom ? 'Custom' : 'CH' });
                }
            }
        }
        // 関数名も候補に
        for (const fn of CUSTOM_RAM_FUNCTIONS) {
            if (fn.name.toLowerCase().startsWith(lower)) {
                results.push({ text: fn.name + '(', type: 'fn' });
            }
        }
    }

    return results.slice(0, 15); // 最大15件
}

let _suggestIdx = -1; // サジェストのアクティブインデックス

/** サジェストを表示する */
function showSuggest() {
    const wordInfo = getWordAtCursor(dom.customExpr);
    if (!wordInfo || wordInfo.word.length < 1) {
        hideSuggest();
        return;
    }

    const items = buildSuggestions(wordInfo.word);
    if (items.length === 0) {
        hideSuggest();
        return;
    }

    _suggestIdx = -1;
    dom.customSuggest.innerHTML = '';
    for (const item of items) {
        const li = document.createElement('li');
        li.innerHTML = `${esc(item.text)}<span class="suggest-type">${esc(item.type)}</span>`;
        li.dataset.text = item.text;
        li.addEventListener('mousedown', e => {
            e.preventDefault(); // inputからフォーカスを奪わない
            applySuggest(item.text, wordInfo);
        });
        dom.customSuggest.appendChild(li);
    }
    dom.customSuggest.classList.add('visible');
}

function hideSuggest() {
    dom.customSuggest.classList.remove('visible');
    dom.customSuggest.innerHTML = '';
    _suggestIdx = -1;
}

/** サジェストを確定して式に挿入する */
function applySuggest(text, wordInfo) {
    const expr = dom.customExpr;
    const before = expr.value.substring(0, wordInfo.start);
    const after  = expr.value.substring(wordInfo.end);
    expr.value = before + text + after;
    // カーソルを挿入テキストの末尾へ
    const newPos = wordInfo.start + text.length;
    expr.setSelectionRange(newPos, newPos);
    expr.focus();
    hideSuggest();
    // バリデーションも更新
    validateCustomExpr();
}

// 式入力欄のイベント: サジェスト表示＋バリデーション
dom.customExpr.addEventListener('input', () => {
    showSuggest();
    _validateDebounce();
});

dom.customExpr.addEventListener('focus', () => {
    // フォーカス時にもバリデーション実行
    _validateDebounce();
});

dom.customExpr.addEventListener('blur', () => {
    // 少し遅延してから閉じる（mousedownイベントの発火を待つ）
    setTimeout(hideSuggest, 150);
});

// キーボードでサジェストを操作
dom.customExpr.addEventListener('keydown', e => {
    const items = dom.customSuggest.querySelectorAll('li');
    if (!dom.customSuggest.classList.contains('visible') || items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        _suggestIdx = Math.min(_suggestIdx + 1, items.length - 1);
        items.forEach((li, i) => li.classList.toggle('active', i === _suggestIdx));
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _suggestIdx = Math.max(_suggestIdx - 1, 0);
        items.forEach((li, i) => li.classList.toggle('active', i === _suggestIdx));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (_suggestIdx >= 0 && _suggestIdx < items.length) {
            e.preventDefault();
            const wordInfo = getWordAtCursor(dom.customExpr);
            if (wordInfo) applySuggest(items[_suggestIdx].dataset.text, wordInfo);
        }
    } else if (e.key === 'Escape') {
        hideSuggest();
    }
});

// ── Custom RAM バリデーション＆プレビュー ──

let _validateTimer = null;
const _validateDebounce = () => {
    clearTimeout(_validateTimer);
    _validateTimer = setTimeout(validateCustomExpr, 300);
};

/** 式のバリデーションと結果プレビューを行う */
function validateCustomExpr() {
    const expr = dom.customExpr.value.trim();
    const vEl = dom.customValidation;

    if (!expr) {
        vEl.textContent = '';
        vEl.className = 'custom-ram-validation';
        dom.customAdd.disabled = false;
        return;
    }

    const mainFile = getMainFile();
    if (!mainFile) {
        vEl.textContent = 'ファイルを読み込んでください';
        vEl.className = 'custom-ram-validation error';
        dom.customAdd.disabled = true;
        return;
    }

    const errors = [];

    // 1. 括弧の対応チェック
    let depth = 0;
    for (const ch of expr) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth < 0) break;
    }
    if (depth !== 0) errors.push('括弧の対応が不正です');

    // 2. トークン化してチャンネル名・関数名をチェック
    try {
        const tokens = tokenizeExpr(expr);
        const colNames = new Set(mainFile.columns.map(c => c.name));
        const subIds = getSubFileIds();

        for (let ti = 0; ti < tokens.length; ti++) {
            const t = tokens[ti];
            const nextIsOpen = (ti + 1 < tokens.length && tokens[ti + 1].type === 'op' && tokens[ti + 1].value === '(');
            if (t.type === 'name') {
                if (nextIsOpen) {
                    // 次が'('なので関数呼び出し → 関数名チェック
                    if (!_builtinFuncNames.has(t.value)) {
                        errors.push(`"${t.value}" は未知の関数です`);
                    }
                } else {
                    // チャンネル名チェック（Mainファイルに存在するか）
                    if (!colNames.has(t.value)) {
                        errors.push(`"${t.value}" はMainファイルに存在しません`);
                    }
                }
            } else if (t.type === 'crossref') {
                // ファイル間参照チェック
                const idx = parseInt(t.fileKey.replace('s', ''), 10) - 1;
                if (idx < 0 || idx >= subIds.length) {
                    errors.push(`"${t.fileKey}" に対応するサブファイルがありません（現在 ${subIds.length} ファイル）`);
                } else {
                    // サブファイルのチャンネル名チェック
                    const sf = state.files[subIds[idx]];
                    if (sf && !sf.columns.some(c => c.name === t.value)) {
                        errors.push(`"${t.value}" は ${sf.shortName} に存在しません`);
                    }
                }
            }
        }
    } catch (e) {
        errors.push('式の構文エラー: ' + e.message);
    }

    if (errors.length > 0) {
        // 重複除去して最大3件表示
        const unique = [...new Set(errors)].slice(0, 3);
        vEl.textContent = unique.join(' / ');
        vEl.className = 'custom-ram-validation error';
        dom.customAdd.disabled = true;
        return;
    }

    // 3. 計算結果プレビュー（エラーがなければ）
    try {
        const vals = computeCustomExpr(expr, mainFile);
        let min = Infinity, max = -Infinity, sum = 0, cnt = 0;
        for (let i = 0; i < vals.length; i++) {
            const v = vals[i];
            if (!isNaN(v) && isFinite(v)) {
                if (v < min) min = v;
                if (v > max) max = v;
                sum += v;
                cnt++;
            }
        }
        if (cnt === 0) {
            vEl.textContent = '⚠ 全値がNaN — 参照チャンネルのデータを確認してください';
            vEl.className = 'custom-ram-validation error';
            dom.customAdd.disabled = true;
        } else {
            const avg = sum / cnt;
            // 数値を見やすくフォーマット（小数4桁まで）
            const fmt = (v) => Math.abs(v) >= 1000 ? v.toFixed(1) : v.toPrecision(4);
            vEl.textContent = `min: ${fmt(min)} / max: ${fmt(max)} / avg: ${fmt(avg)}`;
            vEl.className = 'custom-ram-validation preview';
            dom.customAdd.disabled = false;
        }
    } catch (e) {
        vEl.textContent = '計算エラー: ' + e.message;
        vEl.className = 'custom-ram-validation error';
        dom.customAdd.disabled = true;
    }
}

// ── Custom RAM ヘルプモーダル ──
$('custom-ram-help')?.addEventListener('click', showCustomRAMHelp);
// role="button" で自作ボタン化した <i> はキーボード操作も自前で用意する必要がある
$('custom-ram-help')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showCustomRAMHelp();
    }
});

function showCustomRAMHelp() {
    let html = `<h3 style="margin:0 0 12px;color:#818cf8;">Custom RAM 関数リファレンス</h3>`;

    // 演算子
    html += `<h4 style="margin:12px 0 6px;color:#f59e0b;font-size:12px;">演算子</h4>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:8px;">`;
    const ops = [
        ['+, -, *, /', '四則演算'],
        ['^', 'べき乗（例: X^2）'],
        ['( )', '括弧でグループ化'],
    ];
    for (const [op, desc] of ops) {
        html += `<tr><td style="padding:3px 8px;color:#6ee7b7;font-family:monospace;white-space:nowrap;">${esc(op)}</td>`
            + `<td style="padding:3px 8px;color:#f0f0f0;">${esc(desc)}</td></tr>`;
    }
    html += `</table>`;

    // 関数をカテゴリ分け
    const categories = [
        { label: '基本数学', names: ['abs','sqrt','pow','log','exp'] },
        { label: '三角関数', names: ['sin','cos','tan'] },
        { label: '比較・制限', names: ['max','min','clamp'] },
        { label: '時系列解析', names: ['integral','diff','mavg','delay'] },
    ];

    for (const cat of categories) {
        html += `<h4 style="margin:12px 0 6px;color:#f59e0b;font-size:12px;">${esc(cat.label)}</h4>`;
        html += `<table style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:4px;">`;
        for (const fname of cat.names) {
            const f = CUSTOM_RAM_FUNCTIONS.find(fn => fn.name === fname);
            if (!f) continue;
            html += `<tr>`
                + `<td style="padding:3px 8px;color:#6ee7b7;font-family:monospace;white-space:nowrap;">${esc(f.name)}(${esc(f.args)})</td>`
                + `<td style="padding:3px 8px;color:#f0f0f0;">${esc(f.desc)}</td>`
                + `</tr>`;
        }
        html += `</table>`;
    }

    // 使用例
    html += `<h4 style="margin:12px 0 6px;color:#f59e0b;font-size:12px;">使用例</h4>`;
    html += `<div style="font-family:monospace;font-size:11px;color:#86efac;background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;">`;
    const examples = [
        ['abs(Speed - Target)', '速度と目標値の偏差（絶対値）'],
        ['sqrt(X^2 + Y^2)', 'ベクトルの大きさ'],
        ['integral(Power)', 'パワーの累積（エネルギー量）'],
        ['diff(Speed)', '速度の変化率（加速度）'],
        ['mavg(Torque, 50)', 'トルクの50点移動平均'],
        ['delay(Speed, 0.5)', '速度を0.5秒遅延'],
        ['clamp(RPM, 0, 6000)', 'RPMを0〜6000に制限'],
        ['Fuel_Rate - s1:Fuel_Rate', 'メインとs1の燃料差（ファイル間演算）'],
        ['integral(Fuel_Rate - s1:Fuel_Rate)', 'ファイル間差分の累積値'],
    ];
    // ファイル間参照の説明
    html += `</div>`;
    html += `<h4 style="margin:12px 0 6px;color:#f59e0b;font-size:12px;">ファイル間参照</h4>`;
    html += `<div style="font-size:11px;color:#a0a5b1;line-height:1.6;padding:0 4px;">`;
    html += `<code style="color:#6ee7b7;">s1:チャンネル名</code> でサブファイル1のデータを参照できます。<br>`;
    html += `s1, s2, ... はファイル一覧のバッジに表示される番号です。<br>`;
    html += `サブのデータはメインの時間軸に補間され、オフセット(Δt)も考慮されます。</div>`;
    html += `<div style="font-family:monospace;font-size:11px;color:#86efac;background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;margin-top:6px;">`;
    for (const [ex, desc] of examples) {
        html += `<div style="margin-bottom:4px;"><span style="color:#818cf8;">${esc(ex)}</span> <span style="color:#a0a5b1;font-size:10px;">— ${esc(desc)}</span></div>`;
    }
    html += `</div>`;

    // モーダル表示
    let overlay = document.getElementById('debug-modal-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'debug-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:520px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;';
    modal.innerHTML = html
        + `<div style="text-align:right;margin-top:12px;"><button onclick="this.closest('#debug-modal-overlay').remove()" `
        + `style="background:#6366f1;color:#fff;border:none;border-radius:6px;padding:6px 18px;cursor:pointer;font-size:13px;">閉じる</button></div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setupModalA11y(overlay, modal);
}

dom.colSearch.addEventListener('input', renderColumnList);

function renderColumnList() {
    dom.colList.innerHTML = '';
    const mainFile = getMainFile();

    // Update channel source label (guard for missing DOM element)
    if (dom.colHdr) dom.colHdr.textContent = mainFile ? `(${mainFile.shortName})` : '';

    if (!mainFile) {
        dom.colList.innerHTML = '<div class="placeholder-text">Upload a CSV to see channels</div>';
        return;
    }

    const q       = dom.colSearch.value.toLowerCase();
    const matches = mainFile.columns
        .filter(c => !q || c.name.toLowerCase().includes(q))
        .sort((a, b) => (b.isCustom ? 1 : 0) - (a.isCustom ? 1 : 0));

    if (!matches.length) {
        dom.colList.innerHTML = '<div class="placeholder-text">No channels match search</div>';
        return;
    }

    for (const col of matches) {
        const on    = state.selectedNames.has(col.name);
        const range = state.yRanges[col.name] ?? { min: '', max: '' };

        const item = document.createElement('div');
        item.className = `col-item${on ? ' selected' : ''}`;

        const topRow = document.createElement('div');
        topRow.className = 'col-item-top';

        const badge = document.createElement('div');
        badge.style.cssText = `width:9px;height:9px;border-radius:50%;flex-shrink:0;background:${on ? col.color : 'transparent'};border:1.5px solid ${col.color};`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'col-name';
        nameSpan.style.color = '#f0f0f0';
        nameSpan.title = col.name;
        nameSpan.textContent = col.name;

        const unitSpan = document.createElement('span');
        unitSpan.className = 'col-unit';
        unitSpan.textContent = col.unit;

        topRow.appendChild(badge);
        topRow.appendChild(nameSpan);
        topRow.appendChild(unitSpan);

        // Bitバッジ: Bitチャンネルなら表示、クリックでON/OFF切り替え
        const isBit = state.bitChannels.has(col.name);
        if (isBit || _bitManualOff.has(col.name)) {
            const bitBadge = document.createElement('span');
            bitBadge.className = 'bit-badge' + (isBit ? ' active' : '');
            bitBadge.textContent = 'Bit';
            bitBadge.title = isBit ? 'Bitモード ON — クリックで解除' : 'Bitモード OFF — クリックで有効化';
            bitBadge.addEventListener('click', e => {
                e.stopPropagation();
                if (isBit) {
                    // Bitモード OFF
                    state.bitChannels.delete(col.name);
                    _bitManualOff.add(col.name);
                } else {
                    // Bitモード ON
                    state.bitChannels.add(col.name);
                    _bitManualOff.delete(col.name);
                }
                renderColumnList();
                renderChart();
            });
            topRow.appendChild(bitBadge);
        }

        // 「式に挿入」ボタン: クリックでCustom RAM式入力欄にチャンネル名を挿入
        const insertBtn = document.createElement('i');
        insertBtn.className = 'bx bx-plus-circle col-insert-btn';
        insertBtn.title = '式に挿入';
        insertBtn.addEventListener('click', e => {
            e.stopPropagation();
            const expr = dom.customExpr;
            const pos = expr.selectionStart ?? expr.value.length;
            const before = expr.value.substring(0, pos);
            const after  = expr.value.substring(pos);
            expr.value = before + col.name + after;
            const newPos = pos + col.name.length;
            expr.setSelectionRange(newPos, newPos);
            expr.focus();
            validateCustomExpr();
        });
        topRow.appendChild(insertBtn);

        item.appendChild(topRow);

        if (on) {
            const yr = document.createElement('div');
            yr.className = 'col-yrange';
            yr.addEventListener('click', e => e.stopPropagation());
            yr.innerHTML = `
                <span class="col-yrange-label">Y</span>
                <input type="number" class="yrange-input" placeholder="min"
                    value="${esc(range.min)}"
                    data-range-name="${esc(col.name)}" data-range-type="min"
                    title="Y-axis minimum">
                <span class="yrange-sep">~</span>
                <input type="number" class="yrange-input" placeholder="max"
                    value="${esc(range.max)}"
                    data-range-name="${esc(col.name)}" data-range-type="max"
                    title="Y-axis maximum">
            `;
            item.appendChild(yr);

            yr.querySelectorAll('.yrange-input').forEach(inp => {
                inp.addEventListener('change', () => {
                    const nm = inp.dataset.rangeName;
                    const tp = inp.dataset.rangeType;
                    if (!state.yRanges[nm]) state.yRanges[nm] = { min: '', max: '' };
                    state.yRanges[nm][tp] = inp.value;
                    renderChart();
                    saveSettings();
                });
            });
        }

        topRow.addEventListener('click', () => {
            if (on) {
                state.selectedNames.delete(col.name);
                removeMerge(col.name);
                renderColumnList();
                renderChart();
            } else {
                state.selectedNames.add(col.name);
                if (!state.yRanges[col.name]) state.yRanges[col.name] = { min: '', max: '' };
                renderColumnList();
                ensureColumnsAndRender();
            }
            saveSettings();
        });

        dom.colList.appendChild(item);
    }
}

// ─────────────────────────────────────────────────────────────
// Linear interpolation (binary search)
// ─────────────────────────────────────────────────────────────

function interpolate(timeArr, valArr, t) {
    const n = timeArr.length;
    if (n === 0) return NaN;
    if (t <= timeArr[0])     return valArr[0];
    if (t >= timeArr[n - 1]) return valArr[n - 1];
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (timeArr[mid] <= t) lo = mid; else hi = mid;
    }
    const dt = timeArr[hi] - timeArr[lo];
    if (dt === 0) return valArr[lo];
    return valArr[lo] + (t - timeArr[lo]) / dt * (valArr[hi] - valArr[lo]);
}

// ─────────────────────────────────────────────────────────────
// Auto-align: minimize RMSE between main and sub file
// ─────────────────────────────────────────────────────────────

/**
 * Auto-alignのチャンネル選択モーダルを表示する。
 * ユーザーが使いたいチャンネルと探索範囲を選んでからアライメントを実行する。
 */
async function autoAlign(subFileId) {
    const mainFile = getMainFile();
    const subFile  = state.files[subFileId];
    if (!mainFile || !subFile) return;

    // main と sub の両方に存在するチャンネル名を収集
    const mainNames = new Set(mainFile.columns.map(c => c.name));
    const subNames  = new Set(subFile.columns.map(c => c.name));
    const commonAll = [...mainNames].filter(n => subNames.has(n));

    if (!commonAll.length) {
        alert('両ファイルに共通するチャンネルがありません。');
        return;
    }

    // --- チャンネル選択モーダルを表示 ---
    const selectedChannels = await showAlignChannelModal(commonAll, subFileId);
    if (!selectedChannels || !selectedChannels.names.length) return; // キャンセル

    const chosenNames = selectedChannels.names;
    const searchRange = selectedChannels.range; // 探索範囲（秒）

    // 必要なカラムをロード
    const mainFileId = getMainFileId();
    await Promise.all([
        loadColumnsForFile(mainFileId, chosenNames),
        loadColumnsForFile(subFileId, chosenNames),
    ]);

    const mainCols = chosenNames.map(name => mainFile.columns.find(c => c.name === name)).filter(Boolean);
    const subCols  = chosenNames.map(name => subFile.columns.find(c => c.name === name)).filter(Boolean);

    if (!mainCols.length) {
        alert('選択されたチャンネルのデータが読み込めませんでした。');
        return;
    }

    // ダウンサンプルした時刻配列を作成（最大2000点）
    const mTd  = mainFile.timeData;
    const step = Math.max(1, Math.floor(mTd.length / 2000));
    const sampleTimes = [];
    for (let i = 0; i < mTd.length; i += step) sampleTimes.push(mTd[i]);

    // 探索範囲を設定（ユーザー指定 or 自動）
    const halfRange = searchRange;

    // 粗い探索（400ステップ ±halfRange）— ステップ数を増やして精度向上
    const COARSE = 400;
    let bestOff  = 0, bestRmse = Infinity;
    for (let s = 0; s <= COARSE; s++) {
        const off  = -halfRange + s * (halfRange * 2 / COARSE);
        const rmse = computeRmse(sampleTimes, mainFile, mainCols, subFile, subCols, off);
        if (rmse < bestRmse) { bestRmse = rmse; bestOff = off; }
    }

    // 細かい探索（200ステップ、粗い1ステップ幅の前後）
    const fineW = halfRange * 2 / COARSE * 2;
    const FINE  = 200;
    for (let s = 0; s <= FINE; s++) {
        const off  = bestOff - fineW + s * (fineW * 2 / FINE);
        const rmse = computeRmse(sampleTimes, mainFile, mainCols, subFile, subCols, off);
        if (rmse < bestRmse) { bestRmse = rmse; bestOff = off; }
    }

    subFile.offset = bestOff;
    const inp = document.querySelector(`[data-offset-id="${subFileId}"]`);
    if (inp) inp.value = bestOff.toFixed(3);
    renderChart();
}

/**
 * Auto-align用のチャンネル選択＆探索範囲設定モーダル。
 * ユーザーが使いたいチャンネルにチェックを入れて「実行」を押す。
 * @returns {Promise<{names: string[], range: number}|null>} 選択結果、またはキャンセル時null
 */
function showAlignChannelModal(commonNames, subFileId) {
    return new Promise(resolve => {
        // 既存モーダルがあれば削除
        const old = document.getElementById('align-channel-modal');
        if (old) old.remove();

        const subFile = state.files[subFileId];
        const mainFile = getMainFile();
        // デフォルト探索範囲: 短い方のファイル時間長の25%（繰り返しパターン対策）
        const mTd = mainFile.timeData;
        const sTd = subFile.timeData;
        const mainDur = mTd[mTd.length - 1] - mTd[0];
        const subDur  = sTd[sTd.length - 1] - sTd[0];
        const defaultRange = Math.round(Math.min(mainDur, subDur) * 0.25);

        // 現在選択中のチャンネル（チェックを入れるデフォルト候補）
        const currentlySelected = new Set(state.selectedNames);

        const modal = document.createElement('div');
        modal.id = 'align-channel-modal';
        // デバッグモーダルと同じインラインスタイルで統一
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';

        // チャンネルリストを生成
        const channelItems = commonNames.map(name => {
            const checked = currentlySelected.has(name) ? 'checked' : '';
            // チェックボックス＋チャンネル名のラベル
            return `<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:13px;transition:background 0.15s;"
                onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" value="${name}" ${checked} style="accent-color:#6366f1;"> ${name}
            </label>`;
        }).join('');

        modal.innerHTML = `
            <div style="background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:24px 28px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;">
                <h3 style="margin:0 0 8px;font-size:16px;"><i class='bx bx-target-lock'></i> Auto-Align 設定</h3>
                <p style="color:#a0a5b1;font-size:12px;margin-bottom:16px;line-height:1.5;">
                    位置合わせに使うチャンネルと探索範囲を指定してください。<br>
                    チャンネルを絞ると精度が上がります（例: 目標車速）。
                </p>

                <div style="margin-bottom:14px;">
                    <h4 style="font-size:13px;margin-bottom:6px;">チャンネル選択</h4>
                    <div style="display:flex;gap:6px;margin-bottom:6px;">
                        <button id="align-select-all" style="background:#22262f;color:#a0a5b1;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">全選択</button>
                        <button id="align-select-none" style="background:#22262f;color:#a0a5b1;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">全解除</button>
                    </div>
                    <div class="align-ch-list" style="max-height:200px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:4px;">${channelItems}</div>
                </div>

                <div style="margin-bottom:18px;">
                    <h4 style="font-size:13px;margin-bottom:6px;">探索範囲 (±秒)</h4>
                    <input type="number" id="align-range-input" value="${defaultRange}" min="1" step="1"
                        style="width:120px;background:#22262f;color:#f0f0f0;border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:6px 10px;font-size:13px;">
                    <p style="color:#a0a5b1;font-size:11px;margin-top:4px;">ヒント: NEDCのUrban1サイクル≒195秒。範囲を狭めるとサイクル飛びを防げます。</p>
                </div>

                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button id="align-run-btn" style="background:#6366f1;color:#fff;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:13px;font-weight:500;display:flex;align-items:center;gap:4px;"><i class='bx bx-play'></i> 実行</button>
                    <button id="align-cancel-btn" style="background:#22262f;color:#a0a5b1;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 16px;cursor:pointer;font-size:13px;">キャンセル</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 全選択 / 全解除ボタン
        modal.querySelector('#align-select-all').addEventListener('click', () => {
            modal.querySelectorAll('.align-ch-list input[type="checkbox"]').forEach(cb => cb.checked = true);
        });
        modal.querySelector('#align-select-none').addEventListener('click', () => {
            modal.querySelectorAll('.align-ch-list input[type="checkbox"]').forEach(cb => cb.checked = false);
        });

        // 実行ボタン
        modal.querySelector('#align-run-btn').addEventListener('click', () => {
            const checked = [...modal.querySelectorAll('.align-ch-list input:checked')].map(cb => cb.value);
            const range   = parseFloat(modal.querySelector('#align-range-input').value);
            modal.remove();
            if (!checked.length) {
                alert('1つ以上のチャンネルを選択してください。');
                resolve(null);
                return;
            }
            resolve({ names: checked, range: isNaN(range) || range <= 0 ? defaultRange : range });
        });

        // キャンセルボタン & オーバーレイクリック
        const cancel = () => { modal.remove(); resolve(null); };
        modal.querySelector('#align-cancel-btn').addEventListener('click', cancel);
        modal.addEventListener('click', e => { if (e.target === modal) cancel(); });
    });
}

function computeRmse(sampleTimes, mainFile, mainCols, subFile, subCols, offset) {
    let sumSq = 0, count = 0;
    const mTd = mainFile.timeData;
    const sTd = subFile.timeData;

    for (let ci = 0; ci < mainCols.length; ci++) {
        const mc = mainCols[ci], sc = subCols[ci];
        if (!mc || !sc) continue;

        const mVals = mainFile.colData[mc.id];
        const sVals = subFile.colData[sc.id];
        if (!mVals || !sVals) continue;

        // main信号のレンジで正規化（異なるスケールのチャンネルをバランスさせる）
        let mMin = Infinity, mMax = -Infinity;
        for (let i = 0; i < mVals.length; i++) {
            if (!isNaN(mVals[i])) { if (mVals[i] < mMin) mMin = mVals[i]; if (mVals[i] > mMax) mMax = mVals[i]; }
        }
        const range = Math.max(mMax - mMin, 1e-10);

        for (let si = 0; si < sampleTimes.length; si++) {
            const t = sampleTimes[si];
            const tSub = t - offset;
            // sub の時間範囲外ならスキップ（外挿しない）
            if (tSub < sTd[0] || tSub > sTd[sTd.length - 1]) continue;

            // main側もinterpolateで正確な値を取得（旧コードのインデックス推定バグを修正）
            const mVal = interpolate(mTd, mVals, t);
            const sVal = interpolate(sTd, sVals, tSub);

            if (isNaN(mVal) || isNaN(sVal)) continue;
            const diff = (mVal - sVal) / range;
            sumSq += diff * diff;
            count++;
        }
    }
    return count > 0 ? Math.sqrt(sumSq / count) : Infinity;
}

// ─────────────────────────────────────────────────────────────
// Active groups calculation
// ─────────────────────────────────────────────────────────────

/**
 * Builds render groups from the current selection.
 * Each selected RAM name gets one grid; sub files overlay on the same grid.
 * マージされたチャンネルは1つのグリッドにまとめる。
 * Sub file time values are shifted by their offset.
 */
function getActiveGroups() {
    const mainFile = getMainFile();
    if (!mainFile || !state.selectedNames.size) return { groups: new Map(), order: [] };

    // マージペアのセカンダリ（2番目）を特定 → 独立グリッドを作らない
    const mergedSecondaries = new Set();
    const mergeMap = new Map(); // primary → secondary
    for (const [a, b] of state.mergedGroups) {
        if (state.selectedNames.has(a) && state.selectedNames.has(b)) {
            mergedSecondaries.add(b);
            mergeMap.set(a, b);
        }
    }

    const groups = new Map();
    const order  = [];

    for (const ramName of state.selectedNames) {
        // セカンダリはスキップ（プライマリ側で処理される）
        if (mergedSecondaries.has(ramName)) continue;

        const mc = mainFile.columns.find(c => c.name === ramName);
        if (!mc) continue;

        // このグリッドに含まれるチャンネル名一覧
        const partner = mergeMap.get(ramName);
        const channelNames = partner ? [ramName, partner] : [ramName];

        order.push(ramName);
        const grp = { unit: mc.unit, series: [], mergedNames: channelNames };
        groups.set(ramName, grp);

        // 各チャンネルについてメイン＋サブのシリーズを構築
        for (const chName of channelNames) {
            const col = mainFile.columns.find(c => c.name === chName);
            if (!col) continue;

            // ── Main series (solid line) ───────────────────────
            const mtd  = mainFile.timeData;
            const mvd  = mainFile.colData[col.id];
            if (!mvd) continue;
            const mPts = new Array(mtd.length);
            for (let i = 0; i < mtd.length; i++) mPts[i] = [mtd[i], isNaN(mvd[i]) ? null : mvd[i]];

            // 単色モード時はファイルの色を使う、通常時はチャンネル個別の色
            const mainFileId = getMainFileId();
            const mainColor = state.monoColorMode
                ? (state.fileColors[mainFileId] || col.color)
                : col.color;

            grp.series.push({
                id:       col.id,
                label:    `${chName} [${mainFile.shortName}]`,
                color:    mainColor,
                dash:     false,
                data:     mPts,
            });

            // ── Sub series (dashed lines, time-shifted) ────────
            for (const subId of getSubFileIds()) {
                const sf  = state.files[subId];
                const sc  = sf.columns.find(c => c.name === chName);
                if (!sc) continue;

                const std    = sf.timeData;
                const svd    = sf.colData[sc.id];
                if (!svd) continue;
                const offset = sf.offset;
                const sPts   = new Array(std.length);
                for (let i = 0; i < std.length; i++) sPts[i] = [std[i] + offset, isNaN(svd[i]) ? null : svd[i]];

                const subColor = state.monoColorMode
                    ? (state.fileColors[subId] || sc.color)
                    : sc.color;

                grp.series.push({
                    id:    sc.id,
                    label: `${chName} [${sf.shortName}]`,
                    color: subColor,
                    dash:  true,
                    data:  sPts,
                });
            }
        }
    }

    return { groups, order };
}

// ─────────────────────────────────────────────────────────────
// Chart rendering
// ─────────────────────────────────────────────────────────────

function renderChart() {
    if (!state.chart) initChart();

    // Preserve current X-axis dataZoom state before notMerge rebuild
    let savedXZoom = null;
    const curOpt = state.chart.getOption();
    if (curOpt && curOpt.dataZoom && curOpt.dataZoom.length >= 2) {
        savedXZoom = { start: curOpt.dataZoom[0].start, end: curOpt.dataZoom[0].end };
    }

    const { groups, order } = getActiveGroups();
    const n = order.length;

    if (n === 0) {
        state.chart.clear();
        dom.overlay.classList.remove('hidden');
        dom.resetBtn.disabled = true;
        dom.exportPng.disabled = true;
        dom.copyChart.disabled = true;
        state.numGrids = 0;
        return;
    }
    dom.overlay.classList.add('hidden');
    dom.exportPng.disabled = false;
    dom.copyChart.disabled = false;
    dom.resetBtn.disabled = false;
    state.numGrids = n;

    const H = state.chart.getHeight();
    const topPx  = L.topPx;
    const botPx  = L.bottomPx;
    const gapPx  = L.gapPx;

    // Bitチャンネルのグリッドは通常の1/3の高さにする
    // まず各グリッドの「重み」を計算（Bit = 0.33, 通常 = 1.0）
    const BIT_WEIGHT = 0.33;
    const gridWeights = order.map(name => {
        const grp = groups.get(name);
        // マージグリッドの全チャンネルがBitなら狭くする
        const allBit = grp.mergedNames.every(n => state.bitChannels.has(n));
        return allBit ? BIT_WEIGHT : 1.0;
    });
    const totalWeight = gridWeights.reduce((s, w) => s + w, 0);
    const availH = H - topPx - botPx - (n - 1) * gapPx;
    // 重みに応じてグリッド高さを配分
    const gridHeights = gridWeights.map(w => Math.max(Math.floor(availH * w / totalWeight), 24));

    const pct    = px => `${(px / H * 100).toFixed(3)}%`;

    const grids    = [], xAxes  = [], yAxes  = [];
    const series   = [], dataZooms = [];

    // Compute global time range across all loaded files (including offsets)
    let globalXMin = Infinity, globalXMax = -Infinity;
    for (const f of Object.values(state.files)) {
        if (!f.timeData || f.timeData.length === 0) continue;
        const off = f.offset || 0;
        const lo  = f.timeData[0] + off;
        const hi  = f.timeData[f.timeData.length - 1] + off;
        if (lo < globalXMin) globalXMin = lo;
        if (hi > globalXMax) globalXMax = hi;
    }
    if (!isFinite(globalXMin)) { globalXMin = 0; globalXMax = 1; }

    const xSliderRight = L.gridRight + L.yZoomW + L.yZoomRight + 4;

    // X-axis slider (bottom, all grids linked)
    const xStart = savedXZoom ? savedXZoom.start : 0;
    const xEnd   = savedXZoom ? savedXZoom.end   : 100;
    dataZooms.push({
        type: 'slider',
        xAxisIndex: order.map((_, i) => i),
        start: xStart, end: xEnd,
        bottom: 8, height: 28,
        left: L.gridLeft, right: xSliderRight,
        borderColor: T.border,
        backgroundColor: 'rgba(255,255,255,0.03)',
        fillerColor: 'rgba(99,102,241,0.18)',
        handleStyle: { color: '#6366f1', borderColor: '#6366f1' },
        textStyle: { color: T.dim, fontSize: 10 },
        dataBackground: {
            lineStyle: { color: 'rgba(99,102,241,0.4)', width: 1 },
            areaStyle: { color: 'rgba(99,102,241,0.07)' },
        },
    });

    // X-axis inside zoom (scroll + pan) — pan disabled in shift mode
    dataZooms.push({
        type: 'inside',
        xAxisIndex: order.map((_, i) => i),
        start: xStart, end: xEnd,
        zoomOnMouseWheel:  true,
        moveOnMouseMove:   !state.shiftMode,
        moveOnMouseWheel:  false,
    });

    let _cumulativeTop = topPx; // グリッドの累積top位置
    order.forEach((ramName, i) => {
        const grp    = groups.get(ramName);
        const gridH  = gridHeights[i];
        const topPxI = _cumulativeTop;
        _cumulativeTop += gridH + gapPx;

        // Bitチャンネル判定（グリッド内の全チャンネルがBitか）
        const isBitGrid = grp.mergedNames.every(nm => state.bitChannels.has(nm));

        // Parse Y-range settings for this channel
        const rangeSpec  = state.yRanges[ramName] ?? {};
        const yMinParsed = isBitGrid ? -0.2 : parseFloat(rangeSpec.min);
        const yMaxParsed = isBitGrid ? 1.2  : parseFloat(rangeSpec.max);
        const hasYMin    = !isNaN(yMinParsed);
        const hasYMax    = !isNaN(yMaxParsed);

        grids.push({
            left: L.gridLeft, right: L.gridRight,
            top: pct(topPxI), height: pct(gridH),
            containLabel: false,
        });

        xAxes.push({
            gridIndex: i,
            type: 'value',
            axisLabel: {
                show: i === n - 1,
                color: T.dim, fontSize: 10,
                formatter: v => v % 1 === 0 ? v.toString() : v.toFixed(1),
            },
            axisTick:  { show: i === n - 1, lineStyle: { color: T.axis } },
            axisLine:  { show: true, lineStyle: { color: T.axis } },
            splitLine: { show: true, lineStyle: { color: T.grid } },
            min: globalXMin, max: globalXMax,
        });

        // マージされている場合は "A / B (unit)" 形式で表示
        const yLabelName = grp.mergedNames.length > 1
            ? grp.mergedNames.join(' / ')
            : ramName;
        const yLabel = grp.unit ? `${yLabelName}  (${grp.unit})` : yLabelName;
        const yValFmt = v => {
            if (v === 0) return '0';
            const a = Math.abs(v);
            if (a >= 1e6)  return (v / 1e6).toFixed(1) + 'M';
            if (a >= 1e3)  return (v / 1e3).toFixed(1) + 'k';
            if (a >= 1)    return v.toFixed(1);
            if (a >= 0.01) return v.toPrecision(2);
            return v.toExponential(1);
        };
        yAxes.push({
            gridIndex: i,
            type: 'value',
            name: yLabel,
            nameLocation: 'middle',
            nameGap: 50,
            nameTextStyle: { color: T.dim, fontSize: 10, fontWeight: 500 },
            min: hasYMin ? yMinParsed : undefined,
            max: hasYMax ? yMaxParsed : undefined,
            scale: !hasYMin && !hasYMax,
            axisLabel: {
                color: T.dim, fontSize: 10, width: 44, overflow: 'truncate',
                formatter: yValFmt,
            },
            axisPointer: { show: false },
            axisTick:  { lineStyle: { color: T.axis } },
            axisLine:  { show: true, lineStyle: { color: T.axis } },
            splitLine: { show: true, lineStyle: { color: T.grid } },
        });

        // Per-grid Y-axis zoom slider (right side)
        dataZooms.push({
            type: 'slider', yAxisIndex: [i],
            start: 0, end: 100,
            right: L.yZoomRight, top: pct(topPxI),
            height: pct(gridH), width: L.yZoomW,
            borderColor: 'transparent',
            backgroundColor: 'rgba(255,255,255,0.04)',
            fillerColor: 'rgba(255,255,255,0.1)',
            handleStyle: { color: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.2)' },
            showDetail: false, showDataShadow: false,
            textStyle: { color: 'transparent', fontSize: 0 },
        });

        grp.series.forEach((s, si) => {
            // Range-over shading (markArea) on the first series of each grid only
            const markArea = (si === 0 && (hasYMin || hasYMax)) ? {
                silent: true,
                data: [
                    ...(hasYMax ? [[{ yAxis: yMaxParsed }, { yAxis: yMaxParsed * 100 + 1e9 }]] : []),
                    ...(hasYMin ? [[{ yAxis: -(Math.abs(yMinParsed) * 100 + 1e9) }, { yAxis: yMinParsed }]] : []),
                ],
                itemStyle: { color: 'rgba(255,80,50,0.07)' },
            } : undefined;

            // Range-limit markLines (on first series only)
            const markLine = (si === 0 && (hasYMin || hasYMax)) ? {
                silent: true,
                symbol: 'none',
                data: [
                    ...(hasYMax ? [{ yAxis: yMaxParsed, lineStyle: { color: 'rgba(255,120,60,0.6)', type: 'dashed', width: 1 }, label: { formatter: `▲ ${yMaxParsed}`, fontSize: 9, color: 'rgba(255,120,60,0.8)', position: 'insideStartTop' } }] : []),
                    ...(hasYMin ? [{ yAxis: yMinParsed, lineStyle: { color: 'rgba(255,120,60,0.6)', type: 'dashed', width: 1 }, label: { formatter: `▼ ${yMinParsed}`, fontSize: 9, color: 'rgba(255,120,60,0.8)', position: 'insideStartBottom' } }] : []),
                ],
            } : undefined;

            series.push({
                id:         s.id,
                name:       s.label,
                type:       'line',
                xAxisIndex: i,
                yAxisIndex: i,
                data:       s.data,
                showSymbol: false,
                sampling:   dom.sampling.value || false,
                progressive: 400,
                progressiveThreshold: 3000,
                clip:       true,
                lineStyle:  { width: 1.5, color: s.color, type: s.dash ? [6, 4] : 'solid' },
                itemStyle:  { color: s.color },
                emphasis:   { disabled: true },
                ...(markArea ? { markArea } : {}),
                ...(markLine ? { markLine } : {}),
            });
        });
    });

    state.chart.setOption({
        animation:       false,
        backgroundColor: 'transparent',
        legend:          { show: false },  // sidebar acts as legend

        // Global axis pointer — links vertical crosshair across ALL grids
        axisPointer: {
            link:  [{ xAxisIndex: 'all' }],
            label: { show: false },
            triggerOn: 'mousemove',
        },

        tooltip: {
            show: true,
            trigger: 'axis',
            axisPointer: {
                type: 'line',
                lineStyle: { color: 'rgba(255,255,255,0.35)', type: 'solid', width: 1 },
                animation: false,
                snap: true,
            },
            backgroundColor: 'rgba(12,14,20,0.45)',
            extraCssText: [
                'backdrop-filter:blur(8px)',
                '-webkit-backdrop-filter:blur(8px)',
                'border:1px solid rgba(255,255,255,0.08)',
                'border-radius:6px',
                'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
                'padding:4px 8px',
                'pointer-events:none',
            ].join(';'),
            confine: true,
            formatter: params => {
                if (!params || !params.length) return '';
                _lastTooltipParams = params;
                updatePerGridLabels();
                const t = params[0].axisValue;
                const tStr = typeof t === 'number' ? t.toFixed(3) : String(t);
                return `<span style="font-family:'Roboto Mono',monospace;font-size:11px;color:#818cf8;font-weight:600">t = ${tStr} s</span>`;
            },
        },

        brush: {
            xAxisIndex: 'all', brushLink: 'all', toolbox: [],
            throttleType: 'debounce', throttleDelay: 80,
            outOfBrush: { colorAlpha: 0.05 },
        },

        grid:     grids,
        xAxis:    xAxes,
        yAxis:    yAxes,
        dataZoom: dataZooms,
        series,
    }, { notMerge: true });

    // 初回描画時にズーム初期状態を履歴の起点として記録する
    if (state.zoomHistory.length === 0) {
        state.zoomHistory.push({ start: xStart, end: xEnd });
        state.zoomHistoryIdx = 0;
    }

    // ドラッグマージ判定用にグリッド領域情報を保存
    // ドラッグマージ判定用にグリッド領域情報を保存（累積topで計算）
    let _regionTop = topPx;
    state.gridRegions = order.map((name, i) => {
        const h = gridHeights[i];
        const region = {
            name,
            top:    _regionTop,
            height: h,
            unit:   groups.get(name).unit,
            merged: (groups.get(name).mergedNames?.length ?? 1) > 1,
        };
        _regionTop += h + gapPx;
        return region;
    });
}

// ─────────────────────────────────────────────────────────────
// Per-grid floating value labels
// ─────────────────────────────────────────────────────────────

// Container for floating labels — created lazily after ECharts canvas
let _labelContainer = null;
function ensureLabelContainer() {
    if (!_labelContainer) {
        _labelContainer = document.createElement('div');
        _labelContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:9999;';
        dom.chartEl.style.position = 'relative';
        dom.chartEl.appendChild(_labelContainer);
    }
    return _labelContainer;
}

let _labelEls = []; // reusable label element pool

// Stored by tooltip formatter, consumed by updatePerGridLabels
let _lastTooltipParams = null;

function fmtVal(v) {
    const a = Math.abs(v);
    if (a >= 1e4)   return v.toFixed(0);
    if (a >= 1)     return v.toFixed(3);
    if (a >= 0.001) return v.toPrecision(4);
    return v.toExponential(1);
}

function updatePerGridLabels() {
    const params = _lastTooltipParams;
    if (!state.chart || !state.numGrids || !params || !params.length) {
        for (const el of _labelEls) el.style.display = 'none';
        return;
    }
    ensureLabelContainer().style.display = '';

    // Get current x (time) value from tooltip
    const xVal = params[0].axisValue;
    if (xVal == null || isNaN(xVal)) return;

    const mainFile = getMainFile();
    if (!mainFile) return;

    // Build one label per grid, with values from ALL channels and files
    // getActiveGroups() のorder（マージ済み）を使うことでグリッドとインデックスが一致する
    const { groups: activeGroups, order: activeOrder } = getActiveGroups();
    const gridLabels = [];

    activeOrder.forEach((ramName, gi) => {
        const grp = activeGroups.get(ramName);
        if (!grp) return;
        const entries = [];

        // グリッド内の全チャンネル（マージ相手含む）について値を取得
        for (const chName of grp.mergedNames) {
            // Main file
            const mc = mainFile.columns.find(c => c.name === chName);
            if (mc && mainFile.colData[mc.id]) {
                const val = interpolate(mainFile.timeData, mainFile.colData[mc.id], xVal);
                if (!isNaN(val)) {
                    entries.push({ color: mc.color, valStr: fmtVal(val), fileName: mainFile.shortName, val });
                }
            }

            // Sub files
            for (const subId of getSubFileIds()) {
                const sf = state.files[subId];
                const sc = sf.columns.find(c => c.name === chName);
                if (!sc || !sf.colData[sc.id]) continue;
                const subT = xVal - (sf.offset || 0);
                const val = interpolate(sf.timeData, sf.colData[sc.id], subT);
                if (!isNaN(val)) {
                    entries.push({ color: sc.color, valStr: fmtVal(val), fileName: sf.shortName, val });
                }
            }
        }

        if (!entries.length) return;

        // Position: use average y of all entries for this grid
        let yPxSum = 0, yCount = 0;
        for (const e of entries) {
            const yPx = state.chart.convertToPixel({ yAxisIndex: gi }, e.val);
            if (yPx != null && !isNaN(yPx)) { yPxSum += yPx; yCount++; }
        }
        const xPx = state.chart.convertToPixel({ xAxisIndex: gi }, xVal);
        if (!yCount || xPx == null || isNaN(xPx)) return;

        gridLabels.push({ xPx, yPx: yPxSum / yCount, entries });
    });

    // Ensure we have enough label elements
    while (_labelEls.length < gridLabels.length) {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;font-family:"Roboto Mono",monospace;font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px;white-space:nowrap;background:rgba(12,14,20,0.6);border:1px solid rgba(255,255,255,0.12);pointer-events:none;';
        ensureLabelContainer().appendChild(el);
        _labelEls.push(el);
    }

    // Update label positions and content
    for (let i = 0; i < _labelEls.length; i++) {
        const el = _labelEls[i];
        if (i < gridLabels.length) {
            const lb = gridLabels[i];
            el.style.display = '';
            el.style.left = (lb.xPx + 12) + 'px';
            el.style.top  = (lb.yPx - 10) + 'px';

            if (lb.entries.length === 1) {
                const e = lb.entries[0];
                el.style.color = e.color;
                el.textContent = e.valStr;
            } else {
                // Multiple files: show each value vertically
                el.innerHTML = lb.entries.map(e =>
                    `<div style="display:flex;align-items:center;gap:5px;line-height:1.5">`
                    + `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${e.color};flex-shrink:0"></span>`
                    + `<span style="color:${e.color}">${esc(e.valStr)}</span>`
                    + `</div>`
                ).join('');
            }
        } else {
            el.style.display = 'none';
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Zoom controls
// ─────────────────────────────────────────────────────────────

dom.zoomBtn.addEventListener('click', toggleBoxZoom);
dom.resetBtn.addEventListener('click', resetZoom);

// ── 単色モード切り替え ──
dom.monoColorBtn.addEventListener('click', toggleMonoColor);

function toggleMonoColor() {
    state.monoColorMode = !state.monoColorMode;
    dom.monoColorBtn.classList.toggle('btn-active', state.monoColorMode);
    renderChart();
    saveSettings();
}

function toggleBoxZoom() { state.brushMode ? exitBoxZoom() : enterBoxZoom(); }

function enterBoxZoom() {
    if (!state.chart) return;
    if (state.shiftMode) exitShiftMode();
    state.brushMode = true;
    dom.zoomBtn.classList.add('btn-active');
    dom.zoomBtn.innerHTML = `<i class='bx bx-x'></i> Cancel Zoom`;
    dom.hintEl.textContent = 'Drag to select zoom range…';
    state.chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
}

function exitBoxZoom() {
    if (!state.chart) return;
    state.brushMode = false;
    dom.zoomBtn.classList.remove('btn-active');
    dom.zoomBtn.innerHTML = `<i class='bx bx-selection'></i> Box Zoom`;
    dom.hintEl.textContent = '';
    state.chart.dispatchAction({ type: 'brush', areas: [] });
    state.chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: false } });
}

function onBrushEnd(params) {
    if (!state.brushMode || !params.areas?.length) return;
    const area = params.areas[0];
    if (!area.coordRange) return;
    const [sv, ev] = area.coordRange;
    if (ev <= sv) return;
    state.chart.dispatchAction({
        type: 'dataZoom', startValue: sv, endValue: ev,
        xAxisIndex: Array.from({ length: state.numGrids }, (_, i) => i),
    });
    state.chart.dispatchAction({ type: 'brush', areas: [] });
    exitBoxZoom();

    // Box Zoom完了後、現在のズーム状態を履歴に記録する
    recordZoomHistory();
}

function resetZoom() {
    if (!state.chart || state.numGrids === 0) return;
    exitBoxZoom();
    state.chart.dispatchAction({
        type: 'dataZoom', start: 0, end: 100,
        xAxisIndex: Array.from({ length: state.numGrids }, (_, i) => i),
    });
    const opts = state.chart.getOption();
    if (opts?.dataZoom) {
        opts.dataZoom.forEach((_, idx) =>
            state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: idx, start: 0, end: 100 })
        );
    }
}

// ─────────────────────────────────────────────────────────────
// Zoom Undo / Redo（Ctrl+Z / Ctrl+Y）
// ─────────────────────────────────────────────────────────────

const ZOOM_HISTORY_MAX = 50; // 履歴の最大保持数

/**
 * Box Zoom実行後に呼ばれ、現在のズーム状態を履歴に記録する。
 * スクロールやスライダーによるズーム変更は記録しない。
 */
function recordZoomHistory() {
    // X軸のdataZoom（index 0）の状態を取得
    const opts = state.chart.getOption();
    if (!opts?.dataZoom?.length) return;
    const dz = opts.dataZoom[0];
    const snap = { start: dz.start, end: dz.end };

    // 直前の履歴と同じなら記録しない（重複防止）
    if (state.zoomHistoryIdx >= 0) {
        const prev = state.zoomHistory[state.zoomHistoryIdx];
        if (prev && Math.abs(prev.start - snap.start) < 0.001
                  && Math.abs(prev.end - snap.end) < 0.001) {
            return;
        }
    }

    // 現在位置より後ろの履歴を切り捨てる（新しい操作をしたらRedoは消える）
    state.zoomHistory.length = state.zoomHistoryIdx + 1;

    // 新しい状態を追加
    state.zoomHistory.push(snap);

    // 最大数を超えたら古い履歴を削除
    if (state.zoomHistory.length > ZOOM_HISTORY_MAX) {
        state.zoomHistory.shift();
    }

    // 現在位置を最新に更新
    state.zoomHistoryIdx = state.zoomHistory.length - 1;
}

/**
 * ズーム状態を履歴の指定位置に復元する。
 * dispatchActionでズームを変更し、その際の履歴記録をスキップする。
 */
function applyZoomFromHistory(idx) {
    if (idx < 0 || idx >= state.zoomHistory.length) return;
    if (!state.chart || state.numGrids === 0) return;

    const snap = state.zoomHistory[idx];
    state.zoomHistoryIdx = idx;

    // Undo/Redoフラグを立てて、dataZoomイベントで履歴に記録されないようにする
    state.zoomUndoRedoing = true;
    state.chart.dispatchAction({
        type: 'dataZoom',
        start: snap.start,
        end: snap.end,
        xAxisIndex: Array.from({ length: state.numGrids }, (_, i) => i),
    });
    // フラグ解除（非同期でイベントが来る場合に備えて少し遅延）
    requestAnimationFrame(() => { state.zoomUndoRedoing = false; });
}

/** Undo: 1つ前のズーム状態に戻す */
function zoomUndo() {
    if (state.zoomHistoryIdx > 0) {
        applyZoomFromHistory(state.zoomHistoryIdx - 1);
    }
}

/** Redo: 1つ後のズーム状態に進む */
function zoomRedo() {
    if (state.zoomHistoryIdx < state.zoomHistory.length - 1) {
        applyZoomFromHistory(state.zoomHistoryIdx + 1);
    }
}

// キーボードショートカット（全体）
// - 入力欄にフォーカスがある場合は大半を無効にする（テキスト編集との衝突回避）
// - ただし Ctrl+S / Ctrl+Shift+C はブラウザ既定の挙動を抑止したいのでガードの外で処理
document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    const inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
    const modalOpen = !!document.getElementById('debug-modal-overlay');

    // ── 入力欄でも動くショートカット（グローバル優先） ──
    // Ctrl+S: PNG保存（ブラウザの「ページ保存」を上書き）
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!dom.exportPng.disabled) exportChartAsPNG();
        return;
    }
    // Ctrl+Shift+C: チャートをクリップボードにコピー
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        if (!dom.copyChart.disabled) copyChartToClipboard();
        return;
    }

    // ── 以下は入力欄・モーダル中では無効 ──
    if (inInput || modalOpen) return;

    // Ctrl+Z / Ctrl+Y: ズーム Undo/Redo（従来互換）
    if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        zoomUndo();
        return;
    }
    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        zoomRedo();
        return;
    }

    // ? : ショートカット一覧モーダル（Shift+/ で発火）
    if (e.key === '?') {
        e.preventDefault();
        showShortcutsModal();
        return;
    }

    // Esc: モード離脱（Box Zoom / Time Shift）
    if (e.key === 'Escape') {
        if (state.brushMode) { exitBoxZoom(); return; }
        if (state.shiftMode) { exitShiftMode(); return; }
    }

    // 単打キー: B / T / R（修飾キーなしのときだけ）
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'b' || e.key === 'B') {
            e.preventDefault();
            toggleBoxZoom();
            return;
        }
        if (e.key === 't' || e.key === 'T') {
            e.preventDefault();
            // Sub ファイルが無いときは何もしない（enterShiftMode内でも同様にガード）
            toggleShiftMode();
            return;
        }
        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            resetZoom();
            return;
        }
    }
});

/**
 * キーボードショートカット一覧を表示するモーダル。
 * 既存の `showCustomRAMHelp()` と同じ overlay ID（debug-modal-overlay）を使うことで、
 * どのモーダルも同時には1つしか開かない設計にしている。
 */
function showShortcutsModal() {
    const rows = [
        ['?',              'このショートカット一覧を表示'],
        ['Esc',            'Box Zoom / Time Shift モードを抜ける'],
        ['B',              'Box Zoom モードを切り替え'],
        ['T',              'Time Shift モードを切り替え（Sub ファイルが必要）'],
        ['R',              'ズームをリセット（全範囲表示）'],
        ['Ctrl + Z',       'ズーム操作を1つ戻す'],
        ['Ctrl + Y',       'ズーム操作を1つやり直す'],
        ['Ctrl + S',       'チャートをPNGとして保存'],
        ['Ctrl + Shift + C', 'チャートをクリップボードにコピー'],
    ];

    let html = `<h3 id="shortcuts-modal-title" style="margin:0 0 12px;color:#818cf8;">キーボードショートカット</h3>`;
    html += `<p style="color:#a0a5b1;font-size:11px;margin:0 0 10px;">入力欄にフォーカスがあるときは単打キー (B / T / R / ?) は無効になります。</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:12px;">`;
    for (const [key, desc] of rows) {
        html += `<tr>`
            + `<td style="padding:5px 8px;color:#6ee7b7;font-family:monospace;white-space:nowrap;vertical-align:top;">${esc(key)}</td>`
            + `<td style="padding:5px 8px;color:#f0f0f0;">${esc(desc)}</td>`
            + `</tr>`;
    }
    html += `</table>`;

    // 既存モーダルがあれば閉じる
    let overlay = document.getElementById('debug-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'debug-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.setAttribute('aria-labelledby', 'shortcuts-modal-title');
    modal.style.cssText = 'background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:480px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;';
    modal.innerHTML = html
        + `<div style="text-align:right;margin-top:12px;"><button onclick="this.closest('#debug-modal-overlay').remove()" `
        + `style="background:#6366f1;color:#fff;border:none;border-radius:6px;padding:6px 18px;cursor:pointer;font-size:13px;">閉じる</button></div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setupModalA11y(overlay, modal);
}

// ツールバーの ? ボタン（追加予定）からもモーダルを開けるようにする
$('shortcuts-help-btn')?.addEventListener('click', showShortcutsModal);

// ─────────────────────────────────────────────────────────────
// Time shift controls
// ─────────────────────────────────────────────────────────────

dom.sampling.addEventListener('change', () => { renderChart(); saveSettings(); });

if (dom.shiftBtn) dom.shiftBtn.addEventListener('click', toggleShiftMode);

function toggleShiftMode() { state.shiftMode ? exitShiftMode() : enterShiftMode(); }

function enterShiftMode() {
    if (!getSubFileIds().length) return;
    if (state.brushMode) exitBoxZoom();

    // Default shift target = first sub file
    if (!state.shiftFileId || !state.files[state.shiftFileId] || state.files[state.shiftFileId].role !== 'sub') {
        state.shiftFileId = getSubFileIds()[0];
    }

    state.shiftMode = true;
    dom.shiftBtn.classList.add('btn-active');
    dom.shiftBtn.innerHTML = `<i class='bx bx-x'></i> Exit Shift`;
    dom.hintEl.textContent = `Drag chart ← → to shift: ${state.files[state.shiftFileId]?.shortName ?? ''}`;
    dom.chartEl.style.cursor = 'grab';

    renderFileList();
    renderChart(); // updates inside dataZoom moveOnMouseMove
}

function exitShiftMode() {
    state.shiftMode = false;
    state.shiftDrag = null;
    dom.shiftBtn.classList.remove('btn-active');
    dom.shiftBtn.innerHTML = `<i class='bx bx-transfer-alt'></i> Time Shift`;
    dom.hintEl.textContent = '';
    dom.chartEl.style.cursor = '';

    renderFileList();
    renderChart();
}

// ─────────────────────────────────────────────────────────────
// サイドバー幅リサイズ（ドラッグで幅変更）
// ─────────────────────────────────────────────────────────────

(function setupSidebarResize() {
    const handle  = $('sidebar-resize-handle');
    const sidebar = document.querySelector('.sidebar');
    if (!handle || !sidebar) return;

    let dragging = false;
    let startX   = 0;
    let startW   = 0;

    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        dragging = true;
        startX   = e.clientX;
        startW   = sidebar.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        // ドラッグ中にiframeやcanvasがイベントを奪わないようにする
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        // マウス移動量からサイドバー幅を計算
        const newW = Math.max(200, Math.min(window.innerWidth * 0.6, startW + (e.clientX - startX)));
        sidebar.style.width    = newW + 'px';
        sidebar.style.minWidth = newW + 'px';
        // チャートがあればリサイズイベントを発火（グラフの再描画）
        if (state.chart) state.chart.resize();
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveSettings(); // サイドバー幅をlocalStorageに保存
    });
})();

// ─────────────────────────────────────────────────────────────
// セクション折りたたみ（Files, Settings, Custom RAM）
// ─────────────────────────────────────────────────────────────

(function setupCollapsibleSections() {
    // Channelsセクション以外のcontrol-groupを折りたたみ可能にする
    const sections = document.querySelectorAll('.sidebar-content > .control-group:not(.active-columns-group)');

    sections.forEach(section => {
        section.classList.add('collapsible');

        const heading = section.querySelector('h3');
        if (!heading) return;

        // 折りたたみ矢印アイコンをh3の末尾に追加
        const arrow = document.createElement('i');
        arrow.className = 'bx bx-chevron-down collapse-arrow';
        heading.appendChild(arrow);

        // h3をクリックで折りたたみ/展開を切り替え
        heading.addEventListener('click', () => {
            section.classList.toggle('collapsed');
        });
    });
})();

// ─────────────────────────────────────────────────────────────
// チャートエクスポート（PNG保存 / クリップボードにコピー）
// ─────────────────────────────────────────────────────────────

/**
 * EChartsからPNG画像のData URLを生成する。
 * 背景色を明示的に設定してチャートが見えるようにする。
 */
function getChartImageDataURL() {
    if (!state.chart) return null;
    // EChartsの getDataURL で背景色つきPNGを生成
    // （背景透明だと保存した画像が見づらいため、ダーク背景を付ける）
    return state.chart.getDataURL({
        type: 'png',
        pixelRatio: 2,                     // 高解像度（Retina対応）
        backgroundColor: '#0f1115',         // ダークテーマの背景色
    });
}

/**
 * Data URLをBlobに変換するユーティリティ関数。
 * クリップボードAPIはBlobを要求するため、この変換が必要。
 */
function dataURLtoBlob(dataURL) {
    // "data:image/png;base64,XXXXX" を分解する
    const parts = dataURL.split(',');
    const mime  = parts[0].match(/:(.*?);/)[1];  // MIMEタイプを抽出（例: "image/png"）
    const raw   = atob(parts[1]);                 // Base64をデコード
    const arr   = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

/**
 * チャートをPNGファイルとしてダウンロードする。
 * ブラウザの「名前を付けて保存」ダイアログが表示される。
 */
function exportChartAsPNG() {
    const dataURL = getChartImageDataURL();
    if (!dataURL) return;

    // ファイル名にメインファイル名と日時を含める
    const mainFile = getMainFile();
    const baseName = mainFile ? mainFile.name.replace(/\.csv$/i, '') : 'chart';
    const now      = new Date();
    const stamp    = now.getFullYear()
        + String(now.getMonth() + 1).padStart(2, '0')
        + String(now.getDate()).padStart(2, '0')
        + '_'
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
    const fileName = `${baseName}_${stamp}.png`;

    // <a> タグを一時的に作って自動クリック → ダウンロードが始まる
    const link  = document.createElement('a');
    link.href     = dataURL;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showExportToast('PNG saved', fileName);
}

/**
 * チャートをクリップボードに画像としてコピーする。
 * Ctrl+V でExcelやチャットツールに貼り付けできる。
 *
 * 注意: Clipboard APIはHTTPS環境またはlocalhostでのみ動作する。
 * file:// プロトコルでは動かないので、ローカルサーバーで開く必要がある。
 */
async function copyChartToClipboard() {
    const dataURL = getChartImageDataURL();
    if (!dataURL) return;

    try {
        const blob = dataURLtoBlob(dataURL);
        // ClipboardItem APIでクリップボードに画像を書き込む
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ]);
        showExportToast('Copied!', 'チャート画像をクリップボードにコピーしました');
    } catch (e) {
        // file:// で開いている場合やHTTPSでない場合はここに来る
        console.error('[CSV Viewer] Clipboard write failed:', e);
        showError(
            'クリップボードへのコピーに失敗しました',
            'HTTPS環境（またはlocalhost）で開いてください。\nfile:// では Clipboard API が利用できません。\n' + e.message
        );
    }
}

/**
 * エクスポート成功時の軽いトースト通知を表示する。
 * エラー通知とは別に、短い緑色のフィードバックを出す。
 */
function showExportToast(title, detail) {
    let container = document.getElementById('error-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'error-toast-container';
        container.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:480px;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = 'background:#122d1b;border:1px solid #22c55e;border-radius:8px;padding:12px 16px;color:#86efac;font-size:13px;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);cursor:pointer;animation:slideIn 0.3s ease;';
    toast.innerHTML = `<div style="font-weight:600;margin-bottom:2px;color:#4ade80;">${esc(title)}</div>`
        + `<div style="font-size:11px;color:#86efac;opacity:0.85;">${esc(detail)}</div>`;
    toast.addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    // 3秒で自動的に消える（成功通知なので短めに）
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

// ボタンのクリックイベントを登録
dom.exportPng.addEventListener('click', exportChartAsPNG);
dom.copyChart.addEventListener('click', copyChartToClipboard);

// ─────────────────────────────────────────────────────────────
// 設定の保存・復元（localStorage）
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'csvViewer_settings';

/**
 * 現在の設定をlocalStorageに保存する。
 * ファイルデータ本体は保存しない（名前・role・offsetだけ）。
 */
function saveSettings() {
    try {
        const sidebar = document.querySelector('.sidebar');
        const settings = {
            // ファイル情報（名前・ロール・オフセットだけ。データ本体は含めない）
            fileInfos: Object.values(state.files).map(f => ({
                name: f.name,
                role: f.role,
                offset: f.offset,
            })),
            // 選択中のチャンネル名
            selectedNames: [...state.selectedNames],
            // Custom RAM式
            customRAMs: state.customRAMs.map(c => ({ name: c.name, expr: c.expr })),
            // チャンネルマージ設定
            mergedGroups: state.mergedGroups,
            // Bit手動Offリスト
            bitManualOff: [..._bitManualOff],
            // パース設定
            nameRowIdx: dom.nameRow.value,
            unitRowIdx: dom.unitRow.value,
            // サンプリングモード
            samplingMode: dom.sampling.value,
            // サイドバー幅
            sidebarWidth: sidebar ? sidebar.offsetWidth : null,
            // Y軸範囲のユーザー設定
            yRanges: state.yRanges,
            // 単色モード設定
            monoColorMode: state.monoColorMode,
            fileColors: state.fileColors,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('[CSV Viewer] Failed to save settings:', e);
    }
}

/**
 * localStorageから保存済み設定を読み出す。
 * @returns {object|null} 設定オブジェクト、または保存データがなければnull
 */
function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.warn('[CSV Viewer] Failed to load settings:', e);
        return null;
    }
}

/**
 * 設定をJSON形式のオブジェクトにまとめる（エクスポート用）。
 * localStorageとほぼ同じだが、共有用に整形する。
 */
function buildSettingsForExport() {
    const sidebar = document.querySelector('.sidebar');
    return {
        _format: 'CSV Viewer Settings',
        _version: 1,
        fileInfos: Object.values(state.files).map(f => ({
            name: f.name,
            role: f.role,
            offset: f.offset,
        })),
        selectedNames: [...state.selectedNames],
        customRAMs: state.customRAMs.map(c => ({ name: c.name, expr: c.expr })),
        mergedGroups: state.mergedGroups,
        bitManualOff: [..._bitManualOff],
        nameRowIdx: dom.nameRow.value,
        unitRowIdx: dom.unitRow.value,
        samplingMode: dom.sampling.value,
        sidebarWidth: sidebar ? sidebar.offsetWidth : null,
        yRanges: state.yRanges,
    };
}

/**
 * 設定をJSONファイルとしてダウンロードする。
 */
function exportSettings() {
    const settings = buildSettingsForExport();
    const json = JSON.stringify(settings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'csv_viewer_settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showExportToast('設定をエクスポートしました', 'csv_viewer_settings.json');
}

/**
 * JSONファイルから設定をインポートする。
 * ファイル選択ダイアログを開き、選んだJSONを読み込む。
 */
function importSettings() {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const settings = JSON.parse(reader.result);
                applySettings(settings);
                showExportToast('設定をインポートしました', file.name);
            } catch (e) {
                alert('設定ファイルの読み込みに失敗しました。\n' + e.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

/**
 * 設定オブジェクトを現在のアプリ状態に適用する。
 * ファイルがまだ読み込まれていない場合は、pendingSettingsとして保持する。
 * @param {object} s - 設定オブジェクト
 */
function applySettings(s) {
    if (!s) return;

    // パース設定を復元
    if (s.nameRowIdx) dom.nameRow.value = s.nameRowIdx;
    if (s.unitRowIdx) dom.unitRow.value = s.unitRowIdx;

    // サンプリングモードを復元
    if (s.samplingMode !== undefined) dom.sampling.value = s.samplingMode;

    // サイドバー幅を復元
    if (s.sidebarWidth) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.style.width    = s.sidebarWidth + 'px';
            sidebar.style.minWidth = s.sidebarWidth + 'px';
        }
    }

    // Y軸範囲を復元
    if (s.yRanges) state.yRanges = s.yRanges;

    // 単色モード設定を復元
    if (s.monoColorMode !== undefined) {
        state.monoColorMode = s.monoColorMode;
        dom.monoColorBtn.classList.toggle('btn-active', state.monoColorMode);
    }
    if (s.fileColors) state.fileColors = s.fileColors;

    // ファイルがまだ読み込まれていない場合は、残りの設定を保留する
    _pendingSettings = s;

    // ファイル読込前の状態を表示
    showPendingFiles(s.fileInfos || []);
}

/**
 * ファイルが新たに読み込まれたとき、保留中の設定を適用する。
 * parseCSV完了後（updateUI前）に呼ばれる。
 */
function applyPendingSettings() {
    const s = _pendingSettings;
    if (!s) return;

    const mainFile = getMainFile();
    if (!mainFile) return;

    // オフセットを復元（ファイル名で照合）
    if (s.fileInfos) {
        for (const [fid, f] of Object.entries(state.files)) {
            const saved = s.fileInfos.find(fi => fi.name === f.name);
            if (saved && saved.offset) {
                f.offset = saved.offset;
            }
        }
    }

    // チャンネルマージを復元
    if (s.mergedGroups && s.mergedGroups.length) {
        // 既存のマージをクリアして復元
        state.mergedGroups = [];
        for (const [a, b] of s.mergedGroups) {
            // 両方のチャンネルがmainFileに存在するか確認
            const hasA = mainFile.columns.some(c => c.name === a);
            const hasB = mainFile.columns.some(c => c.name === b);
            if (hasA && hasB) addMerge(a, b);
        }
    }

    // Bit手動Off設定を復元
    if (s.bitManualOff) {
        _bitManualOff.clear();
        for (const name of s.bitManualOff) _bitManualOff.add(name);
    }

    // Custom RAMを復元（まだ追加されていないもののみ）
    if (s.customRAMs && s.customRAMs.length) {
        const existingNames = new Set(state.customRAMs.map(c => c.name));
        for (const { name, expr } of s.customRAMs) {
            if (!existingNames.has(name)) {
                // addCustomRAMはawaitが必要だが、ここでは順番に追加していく
                addCustomRAM(name, expr);
            }
        }
    }

    // 選択チャンネルを復元
    if (s.selectedNames && s.selectedNames.length) {
        const available = new Set(mainFile.columns.map(c => c.name));
        for (const name of s.selectedNames) {
            if (available.has(name)) state.selectedNames.add(name);
        }
    }

    // 設定適用済みなのでクリア
    _pendingSettings = null;
}

/**
 * 前回のファイル情報を「再読み込み待ち」として表示する。
 */
function showPendingFiles(fileInfos) {
    if (!fileInfos || !fileInfos.length) return;

    // ファイルリストに警告表示
    dom.fileList.innerHTML = '';
    for (const fi of fileInfos) {
        const li = document.createElement('li');
        li.className = 'file-item pending-file';
        li.innerHTML = `
            <div class="file-item-top">
                <div class="role-badge ${fi.role === 'main' ? 'role-main' : 'role-sub'}">${fi.role === 'main' ? 'Main' : 'Sub'}</div>
                <span class="file-name" style="opacity:0.5;" title="${esc(fi.name)}">
                    <i class='bx bx-error-circle' style="color:#f59e0b;margin-right:4px;"></i>${esc(fi.name)}
                </span>
            </div>
            <div style="font-size:11px;color:#f59e0b;padding:2px 8px 4px;">再読み込みしてください（ドラッグ＆ドロップ）</div>
        `;
        dom.fileList.appendChild(li);
    }
}

// ─────────────────────────────────────────────────────────────
// Initialise
// ─────────────────────────────────────────────────────────────

initChart();

// 設定エクスポート/インポートボタンのイベント登録
dom.exportSettings.addEventListener('click', exportSettings);
dom.importSettings.addEventListener('click', importSettings);

// 起動時にlocalStorageから設定を復元
const _savedSettings = loadSettings();
if (_savedSettings) {
    applySettings(_savedSettings);
}
