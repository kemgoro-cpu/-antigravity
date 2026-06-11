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

function showWarning(message, detail) {
    console.warn(`[CSV Viewer] ${message}`, detail || '');

    let container = document.getElementById('error-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'error-toast-container';
        container.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:480px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = 'background:#2a1f0c;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;color:#fcd34d;font-size:13px;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);cursor:pointer;animation:slideIn 0.3s ease;';
    toast.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:#fbbf24;">${esc(message)}</div>`
        + (detail ? `<div style="font-size:11px;color:#fde68a;opacity:0.85;word-break:break-all;max-height:80px;overflow:auto;">${esc(String(detail))}</div>` : '');
    toast.addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 9000);
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

    // フォーカストラップ: Tab / Shift+Tab をモーダル内に閉じ込める
    // モーダルを開いている間はモーダル外にタブ移動できないようにする（スクリーンリーダー対策）
    const trapHandler = (e) => {
        // IME変換中の Tab は素通し（日本語入力との衝突を避ける）
        if (e.isComposing) return;
        if (e.key !== 'Tab') return;

        // Tab が押されるたびにリストを再取得（モーダル内容が動的に変わる場合に対応）
        const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const candidates = Array.from(modalEl.querySelectorAll(focusableSelector)).filter(el =>
            // disabled な要素と、非表示（offsetParent===null）な要素は除外
            !el.disabled && el.offsetParent !== null
        );

        if (candidates.length === 0) {
            // フォーカス可能な要素が無いときはブラウザのデフォルト動作だけ止める
            e.preventDefault();
            return;
        }

        const first = candidates[0];
        const last  = candidates[candidates.length - 1];
        const isInsideModal = modalEl.contains(document.activeElement);

        if (e.shiftKey) {
            // Shift+Tab: 先頭にいる（またはモーダル外）→ 末尾に折り返す
            if (!isInsideModal || document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            // Tab: 末尾にいる（またはモーダル外）→ 先頭に折り返す
            if (!isInsideModal || document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };
    document.addEventListener('keydown', trapHandler);

    // overlay が DOM から外れたら後始末: リスナー解除＋フォーカス復帰
    // trapHandler も必ず解除してメモリリークを防ぐ
    const observer = new MutationObserver(() => {
        if (!document.body.contains(overlay)) {
            observer.disconnect();
            document.removeEventListener('keydown', escHandler, true);
            document.removeEventListener('keydown', trapHandler);
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
    customRAMs:     [],     // [{ name, unit, expr, id }]
    chartGroups:    [],     // [{ id, channels:[{name,axisId}], axes:[{id,unit,representative}] }]
    arrangeMode:    false,
    channelAliases: {},     // mainChannelName → [aliasName, ...] 全Subファイル共通の別名対応
    gridRegions:    [],     // [{ name, top, height, unit }] ドラッグ判定用
    mergeDrag:      null,   // { sourceName, ghostEl } マージドラッグ中の状態
    bitChannels:    new Set(), // Bitモード（0/1表示、グリッド高さ縮小）のチャンネル名
    monoColorMode:  false,     // 単色モード: trueならファイル単位の色で描画
    fileColors:     {},        // fileId → '#RRGGBB' ファイルごとの色（単色モード用）
    fontScale:      'normal',  // フォントサイズ段階: 'small'|'normal'|'large'|'xlarge'
    rowHeightPx:    null,      // グリッド基準高さ(px)。null=コンテナに自動フィット
    gridHeights:    {},        // グリッド個別の高さ上書き { signature: px }
    parseJobs:      new Map(), // jobId → { name, detail, cancelled }
};

// 復元待ちの設定（ファイル読込後に適用される）
let _pendingSettings = null;

// FileRecord: { name, shortName, columns, timeData, colData, role, offset, file, previewRows, headerInfo }
//   role: 'main' | 'sub'
//   offset: number (seconds, for sub files)
//   file: File object reference (for lazy column loading)
//   headerInfo: { nameRow, unitRow, dataStart, timeIdx, timeUnit, delimiter, encoding, encodingMode } (cached parse metadata)

// ─────────────────────────────────────────────────────────────
// Chart group / multi-axis state
// ─────────────────────────────────────────────────────────────

let _chartGroupCtr = 0;
let _chartAxisCtr = 0;

function nextChartGroupId() { return `group_${++_chartGroupCtr}`; }
function nextChartAxisId() { return `axis_${++_chartAxisCtr}`; }

function getMainColumn(name) {
    return getMainFile()?.columns.find(c => c.name === name) || null;
}

function createChartAxis(name, unit = '') {
    return { id: nextChartAxisId(), unit: unit || '', representative: name };
}

function createSingleChartGroup(name) {
    const col = getMainColumn(name);
    const axis = createChartAxis(name, col?.unit || '');
    return {
        id: nextChartGroupId(),
        channels: [{ name, axisId: axis.id }],
        axes: [axis],
    };
}

function getChartGroupById(groupId) {
    return state.chartGroups.find(g => g.id === groupId) || null;
}

function getChartGroupForChannel(name) {
    return state.chartGroups.find(g => g.channels.some(ch => ch.name === name)) || null;
}

function isMerged(name) {
    const group = getChartGroupForChannel(name);
    return !!group && group.channels.length > 1;
}

function cleanupChartGroup(group) {
    if (!group) return;
    const usedAxisIds = new Set(group.channels.map(ch => ch.axisId));
    group.axes = group.axes.filter(axis => usedAxisIds.has(axis.id));
    for (const axis of group.axes) {
        const assigned = group.channels.filter(ch => ch.axisId === axis.id);
        if (!assigned.some(ch => ch.name === axis.representative)) {
            axis.representative = assigned[0]?.name || '';
        }
        if (!axis.unit) axis.unit = getMainColumn(axis.representative)?.unit || '';
    }
}

function addStandaloneChart(name, insertIndex = state.chartGroups.length) {
    if (!name || getChartGroupForChannel(name)) return;
    const group = createSingleChartGroup(name);
    state.chartGroups.splice(Math.max(0, Math.min(insertIndex, state.chartGroups.length)), 0, group);
}

function removeChannelFromChartGroups(name) {
    const groupIndex = state.chartGroups.findIndex(g => g.channels.some(ch => ch.name === name));
    if (groupIndex < 0) return;
    const group = state.chartGroups[groupIndex];
    group.channels = group.channels.filter(ch => ch.name !== name);
    if (!group.channels.length) state.chartGroups.splice(groupIndex, 1);
    else cleanupChartGroup(group);
}

function detachChannelToStandalone(groupId, name) {
    const groupIndex = state.chartGroups.findIndex(g => g.id === groupId);
    if (groupIndex < 0) return false;
    const group = state.chartGroups[groupIndex];
    if (group.channels.length <= 1 || !group.channels.some(ch => ch.name === name)) return false;
    group.channels = group.channels.filter(ch => ch.name !== name);
    cleanupChartGroup(group);
    state.chartGroups.splice(groupIndex + 1, 0, createSingleChartGroup(name));
    return true;
}

function getAxisUnits(group, axisId) {
    const units = [];
    for (const ch of group.channels.filter(c => c.axisId === axisId)) {
        const unit = getMainColumn(ch.name)?.unit?.trim() || '';
        if (unit && !units.includes(unit)) units.push(unit);
    }
    return units;
}

function getAxisDisplayUnit(group, axisId) {
    return getAxisUnits(group, axisId).join(' / ');
}

function addChannelToChartGroup(sourceName, targetGroupId, targetAxisId = null) {
    const sourceGroup = getChartGroupForChannel(sourceName);
    const targetGroup = getChartGroupById(targetGroupId);
    if (!sourceGroup || sourceGroup.channels.length !== 1 || !targetGroup || sourceGroup.id === targetGroup.id) return false;

    const sourceCol = getMainColumn(sourceName);
    let axisId = targetAxisId;
    if (!axisId) {
        const sameUnitAxis = targetGroup.axes.find(axis => {
            const units = getAxisUnits(targetGroup, axis.id);
            return sourceCol?.unit && units.length === 1 && units[0] === sourceCol.unit;
        });
        axisId = sameUnitAxis?.id || null;
    }
    if (!axisId) {
        const axis = createChartAxis(sourceName, sourceCol?.unit || '');
        targetGroup.axes.push(axis);
        axisId = axis.id;
    }
    if (!targetGroup.axes.some(axis => axis.id === axisId)) return false;

    targetGroup.channels.push({ name: sourceName, axisId });
    state.chartGroups = state.chartGroups.filter(g => g.id !== sourceGroup.id);
    cleanupChartGroup(targetGroup);
    return true;
}

function moveChartGroup(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.chartGroups.length) return;
    const [group] = state.chartGroups.splice(fromIndex, 1);
    const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
    state.chartGroups.splice(Math.max(0, Math.min(adjusted, state.chartGroups.length)), 0, group);
}

function syncChartGroupsWithSelection() {
    const selected = new Set(state.selectedNames);
    for (const group of state.chartGroups) {
        group.channels = group.channels.filter(ch => selected.has(ch.name));
        cleanupChartGroup(group);
    }
    state.chartGroups = state.chartGroups.filter(g => g.channels.length);
    for (const name of selected) addStandaloneChart(name);
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
    parseStatusList: $('parse-status-list'),
    colSearch:  $('column-search'),
    colList:    $('column-list'),
    colHdr:     $('channel-source-label'),
    chartEl:    $('chart'),
    overlay:    $('chart-overlay'),
    clearBtn:   $('clear-all-btn'),
    zoomBtn:    $('zoom-mode-btn'),
    resetBtn:   $('reset-zoom-btn'),
    undoBtn:    $('undo-btn'),
    redoBtn:    $('redo-btn'),
    rowFitBtn:  $('row-fit-btn'),
    rowMinusBtn: $('row-minus-btn'),
    rowPlusBtn: $('row-plus-btn'),
    shiftBtn:   $('shift-mode-btn'),
    arrangeBtn: $('arrange-mode-btn'),
    hintEl:     $('toolbar-hint'),
    nameRow:    $('name-row-idx'),
    unitRow:    $('unit-row-idx'),
    encoding:   $('encoding-mode'),
    parsePreview: $('parse-preview'),
    sampling:   $('sampling-mode'),
    fontScale:  $('font-scale'),
    customName: $('custom-ram-name'),
    customUnit: $('custom-ram-unit'),
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
    presetSelect: $('settings-preset-select'),
    presetSave: $('preset-save-btn'),
    presetLoad: $('preset-load-btn'),
    presetDelete: $('preset-delete-btn'),
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
        if (state.mergeDrag || state.shiftMode || state.brushMode || state.arrangeMode) return;
        const hit = hitTestGrid(e.clientY);
        if (hit && isInYAxisArea(e.clientX, hit.region)) {
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
        if (!state.shiftMode || state.arrangeMode || !state.shiftFileId || e.button !== 0) return;
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
 * Y座標がグリッド下端の「高さリサイズ帯」(境界±6px)にあるか判定する。
 * マージドラッグ等よりも先に判定し、境界ドラッグによる高さ調整を優先する。
 */
function hitTestResizeBand(clientY) {
    const rect = dom.chartEl.getBoundingClientRect();
    const y = clientY - rect.top;
    for (let i = 0; i < state.gridRegions.length; i++) {
        const r = state.gridRegions[i];
        const edge = r.top + r.height;
        if (y >= edge - 6 && y <= edge + 6) return { index: i, region: r };
    }
    return null;
}

/**
 * グリッドのsignature(チャンネル名のソート結合)を取得する。
 * state.gridHeights(個別の高さ上書き)のキーとして使う。
 */
function gridSignatureForRegion(region) {
    const group = getChartGroupById(region.groupId);
    const names = group ? group.channels.map(c => c.name) : [region.name];
    return CSVLayout.gridSignature(names);
}

/**
 * X座標がY軸ラベル領域（グリッドの左端）にあるか判定する。
 */
function isInYAxisArea(clientX, region = null) {
    const rect = dom.chartEl.getBoundingClientRect();
    const x = clientX - rect.left;
    return x >= 0 && x <= (region?.axisAreaWidth || L.gridLeft);
}

function showOverlayAxisModal(targetGroup, sourceName) {
    return new Promise(resolve => {
        document.getElementById('app-modal-overlay')?.remove();
        const sourceUnit = getMainColumn(sourceName)?.unit || '';
        const overlay = document.createElement('div');
        overlay.id = 'app-modal-overlay';
        overlay.className = 'app-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'app-modal axis-choice-modal';
        const axisButtons = targetGroup.axes.map(axis => {
            const unit = getAxisDisplayUnit(targetGroup, axis.id) || 'unitなし';
            const names = targetGroup.channels.filter(ch => ch.axisId === axis.id).map(ch => ch.name).join(', ');
            return `<button class="axis-choice-btn" data-axis-id="${esc(axis.id)}">
                <strong>${esc(unit)}</strong><span>${esc(names)}</span>
            </button>`;
        }).join('');
        modal.innerHTML = `
            <h3 id="axis-choice-title">Y軸の割り当て</h3>
            <p><strong>${esc(sourceName)}</strong>${sourceUnit ? ` (${esc(sourceUnit)})` : ''} を重ねます。</p>
            <div class="axis-choice-list">${axisButtons}</div>
            <button class="axis-choice-btn new-axis" data-axis-id="__new__">
                <strong><i class='bx bx-plus'></i> 新しいY軸</strong><span>独立したスケールで表示</span>
            </button>
            <div class="modal-actions"><button class="btn-secondary axis-choice-cancel">キャンセル</button></div>`;
        modal.setAttribute('aria-labelledby', 'axis-choice-title');
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        setupModalA11y(overlay, modal);

        const finish = value => { overlay.remove(); resolve(value); };
        modal.querySelectorAll('[data-axis-id]').forEach(btn => {
            btn.addEventListener('click', () => finish(btn.dataset.axisId));
        });
        modal.querySelector('.axis-choice-cancel').addEventListener('click', () => finish(null));
        overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
    });
}

async function mergeStandaloneIntoGroup(sourceName, targetGroupId) {
    const sourceGroup = getChartGroupForChannel(sourceName);
    const targetGroup = getChartGroupById(targetGroupId);
    if (!sourceGroup || sourceGroup.channels.length !== 1 || !targetGroup) return;

    const sourceUnit = getMainColumn(sourceName)?.unit?.trim() || '';
    const sameUnitAxis = sourceUnit
        ? targetGroup.axes.find(axis => {
            const units = getAxisUnits(targetGroup, axis.id);
            return units.length === 1 && units[0] === sourceUnit;
        })
        : null;

    let axisId = sameUnitAxis?.id || null;
    if (!axisId) {
        axisId = await showOverlayAxisModal(targetGroup, sourceName);
        if (!axisId) return;
        if (axisId === '__new__') axisId = null;
    }

    if (addChannelToChartGroup(sourceName, targetGroupId, axisId)) {
        ensureColumnsAndRender();
        saveSettings();
    }
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
        highlightEl.style.width = (region.axisAreaWidth || L.gridLeft) + 'px';
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
        if (state.shiftMode || state.brushMode || state.arrangeMode) return;
        if (e.button !== 0) return;
        if (hitTestResizeBand(e.clientY)) return; // 境界の高さリサイズを優先

        const hit = hitTestGrid(e.clientY);
        if (!hit || !isInYAxisArea(e.clientX, hit.region)) return;

        const group = getChartGroupById(hit.region.groupId);
        if (!group || group.channels.length !== 1) return;

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
            const sourceGroup = getChartGroupById(sourceGrid.region.groupId);
            const valid = !!sourceGroup && sourceGroup.channels.length === 1;
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
            mergeStandaloneIntoGroup(srcName, targetGrid.region.groupId);
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
        if (state.shiftMode || state.brushMode || state.arrangeMode) return;
        if (hitTestResizeBand(e.clientY)) return; // 境界のダブルクリックは高さリセット側で処理

        const hit = hitTestGrid(e.clientY);
        if (!hit || !isInYAxisArea(e.clientX, hit.region)) return;

        const group = getChartGroupById(hit.region.groupId);
        if (group?.channels.length > 1) showChartGroupModal(group.id);
    });
}

// ─────────────────────────────────────────────────────────────
// グリッド境界ドラッグ: チャートの高さを個別に調整する
// ─────────────────────────────────────────────────────────────

function setupGridResizeDrag() {
    let drag = null;   // { signature, startY, startH } リサイズ中の状態
    let rafId = null;

    // 境界の上でカーソルをns-resizeにする(通常モードのみ)
    dom.chartEl.addEventListener('mousemove', e => {
        if (drag) return;
        if (state.shiftMode || state.brushMode || state.arrangeMode) return;
        const band = hitTestResizeBand(e.clientY);
        if (band) {
            // 他のドラッグ(grabbing等)のカーソルを上書きしない
            if (!dom.chartEl.style.cursor) dom.chartEl.style.cursor = 'ns-resize';
        } else if (dom.chartEl.style.cursor === 'ns-resize') {
            dom.chartEl.style.cursor = '';
        }
    });

    dom.chartEl.addEventListener('mousedown', e => {
        if (state.shiftMode || state.brushMode || state.arrangeMode) return;
        if (e.button !== 0) return;
        const band = hitTestResizeBand(e.clientY);
        if (!band) return;
        drag = {
            signature: gridSignatureForRegion(band.region),
            startY: e.clientY,
            startH: band.region.height,
        };
        dom.chartEl.style.cursor = 'ns-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!drag) return;
        const newH = Math.min(
            Math.max(drag.startH + (e.clientY - drag.startY), CSVLayout.MIN_GRID_H),
            CSVLayout.MAX_GRID_H
        );
        state.gridHeights[drag.signature] = Math.round(newH);
        // シフトドラッグと同様、再描画はrAFで間引く
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => { renderChart(); rafId = null; });
    });

    document.addEventListener('mouseup', () => {
        if (!drag) return;
        drag = null;
        dom.chartEl.style.cursor = '';
        saveSettings(); // 見た目だけの設定なのでUndo履歴には積まれない
    });

    // 境界のダブルクリックでそのグリッドだけ自動の高さに戻す
    dom.chartEl.addEventListener('dblclick', e => {
        if (state.shiftMode || state.brushMode || state.arrangeMode) return;
        const band = hitTestResizeBand(e.clientY);
        if (!band) return;
        delete state.gridHeights[gridSignatureForRegion(band.region)];
        renderChart();
        saveSettings();
    });
}
setupGridResizeDrag();

function showChartGroupModal(groupId) {
    const group = getChartGroupById(groupId);
    if (!group) return;
    document.getElementById('app-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'app-modal-overlay';
    overlay.className = 'app-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'app-modal chart-group-modal';
    modal.setAttribute('aria-labelledby', 'chart-group-title');

    const axisOptions = group.axes.map(axis => {
        const unit = getAxisDisplayUnit(group, axis.id) || 'unitなし';
        return `<option value="${esc(axis.id)}">${esc(unit)} / ${esc(axis.representative)}</option>`;
    }).join('');
    const rows = group.channels.map(ch => `
        <div class="chart-group-row" data-channel="${esc(ch.name)}">
            <span class="chart-group-channel">${esc(ch.name)}</span>
            <select class="chart-group-axis-select">${axisOptions}<option value="__new__">+ 新しいY軸</option></select>
            <button class="btn-secondary btn-icon chart-group-detach" title="独立チャートへ分離"><i class='bx bx-unlink'></i></button>
        </div>`).join('');
    modal.innerHTML = `
        <h3 id="chart-group-title">Overlay Settings</h3>
        <div class="chart-group-rows">${rows}</div>
        <div class="modal-actions"><button class="btn-primary chart-group-done">完了</button></div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setupModalA11y(overlay, modal);

    modal.querySelectorAll('.chart-group-row').forEach(row => {
        const name = row.dataset.channel;
        const assignment = group.channels.find(ch => ch.name === name);
        const select = row.querySelector('.chart-group-axis-select');
        select.value = assignment.axisId;
        select.addEventListener('change', () => {
            if (select.value === '__new__') {
                const axis = createChartAxis(name, getMainColumn(name)?.unit || '');
                group.axes.push(axis);
                assignment.axisId = axis.id;
                overlay.remove();
                cleanupChartGroup(group);
                renderChart();
                saveSettings();
                showChartGroupModal(group.id);
                return;
            }
            assignment.axisId = select.value;
            cleanupChartGroup(group);
            renderChart();
            saveSettings();
            overlay.remove();
            showChartGroupModal(group.id);
        });
        row.querySelector('.chart-group-detach').addEventListener('click', () => {
            if (detachChannelToStandalone(group.id, name)) {
                overlay.remove();
                renderChart();
                saveSettings();
            }
        });
    });
    modal.querySelector('.chart-group-done').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
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
        else showError(`未対応の形式です: ${f.name}`, 'CSV または TRN ファイルをアップロードしてください。');
    });
}

function createParseJob(name, detail) {
    const id = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const job = { id, name, detail, rows: 0, cancelled: false };
    state.parseJobs.set(id, job);
    renderParseJobs();
    return job;
}

function updateParseJob(job, detail, rows) {
    if (!job || !state.parseJobs.has(job.id)) return;
    if (detail !== undefined) job.detail = detail;
    if (rows !== undefined) job.rows = rows;
    renderParseJobs();
}

function finishParseJob(job) {
    if (!job) return;
    state.parseJobs.delete(job.id);
    renderParseJobs();
}

function renderParseJobs() {
    if (!dom.parseStatusList) return;
    dom.parseStatusList.innerHTML = '';
    for (const job of state.parseJobs.values()) {
        const rowText = job.rows ? ` / ${job.rows.toLocaleString()} rows` : '';
        const el = document.createElement('div');
        el.className = 'parse-job';
        el.innerHTML = `
            <div class="parse-job-top">
                <span class="parse-job-name" title="${esc(job.name)}">${esc(job.name)}</span>
                <button class="btn-secondary parse-job-cancel" data-cancel-job="${job.id}" title="読み込みをキャンセル">
                    <i class='bx bx-x' aria-hidden="true"></i>
                </button>
            </div>
            <div class="parse-job-detail">${esc(job.detail + rowText)}</div>
            <div class="parse-job-bar"><span></span></div>
        `;
        dom.parseStatusList.appendChild(el);
    }
    dom.parseStatusList.querySelectorAll('[data-cancel-job]').forEach(btn => {
        btn.addEventListener('click', e => {
            const job = state.parseJobs.get(e.currentTarget.dataset.cancelJob);
            if (job) {
                job.cancelled = true;
                updateParseJob(job, 'Cancelling...', job.rows);
            }
        });
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

const {
    convertWhitespaceToTabs,
    decodeBytes,
    detectTextEncoding,
    detectHeaderRows: detectHeaderRowsBase,
    getTimeScaleInfo,
    normalizeChannelName,
    scoreAliasCandidate,
    isTimeHeader,
    toNumber,
} = window.CSVUtils;

async function detectFileEncoding(file) {
    const sampleSize = Math.min(file.size, 256 * 1024);
    const bytes = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
    return detectTextEncoding(bytes);
}

async function readFileAsDecodedText(file, encoding) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeBytes(bytes, encoding);
    if (!decoded.ok) throw decoded.error || new Error(`Unsupported encoding: ${encoding}`);
    return decoded.text;
}

function getRequestedEncoding() {
    return dom.encoding?.value || 'auto';
}

async function parseCSV(file) {
    const fileId = 'f' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const trn = isTrnFile(file.name);
    const requestedEncoding = getRequestedEncoding();
    const parseJob = createParseJob(file.name, 'Detecting encoding...');
    let encoding = 'utf-8';
    try {
        encoding = requestedEncoding === 'auto'
            ? await detectFileEncoding(file)
            : requestedEncoding;
    } catch (e) {
        finishParseJob(parseJob);
        showError(`File read error: ${file.name}`, e.stack || e.message);
        return;
    }
    console.log(`[CSV Viewer] parseCSV: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB, format=${trn ? 'TRN(whitespace)' : 'CSV(auto)'}, encoding=${encoding}, mode=${requestedEncoding})`);

    if (trn) {
        // TRNファイル: テキストを読み込んで空白→タブに変換してからパースする
        try {
            updateParseJob(parseJob, 'Decoding TRN...', 0);
            const text = await readFileAsDecodedText(file, encoding);
            const converted = convertWhitespaceToTabs(text);
            updateParseJob(parseJob, 'Parsing header...', 0);
            // Phase 1: Preview parse（先頭50行だけ抽出してヘッダー検出）
            const previewLines = converted.split('\n').slice(0, 50).join('\n');
            const previewRes = Papa.parse(previewLines, {
                delimiter: '\t',
                header: false,
                dynamicTyping: false,
                skipEmptyLines: true,
            });
            // 変換済みテキストを保持するため、fileの代わりにconvertedを渡す
            onHeaderParsed(fileId, file.name, converted, previewRes.data, '\t', encoding, requestedEncoding, parseJob);
        } catch (e) {
            finishParseJob(parseJob);
            showError(`TRN parse failed: ${file.name}`, e.stack || e.message);
        }
    } else {
        // CSVファイル: PapaParseに直接Fileオブジェクトを渡す
        try {
            updateParseJob(parseJob, 'Parsing header...', 0);
            Papa.parse(file, {
                encoding,
                header: false,
                dynamicTyping: false,
                skipEmptyLines: true,
                preview: 50,
                complete: res => {
                    try {
                        onHeaderParsed(fileId, file.name, file, res.data, undefined, encoding, requestedEncoding, parseJob);
                    } catch (e) {
                        finishParseJob(parseJob);
                        showError(`Header parse failed: ${file.name}`, e.stack || e.message);
                    }
                },
                error: err => {
                    finishParseJob(parseJob);
                    showError(`CSV parse error: ${file.name}`, err.message || String(err));
                },
            });
        } catch (e) {
            finishParseJob(parseJob);
            showError(`Failed to start parsing: ${file.name}`, e.stack || e.message);
        }
    }
}

function detectHeaderRows(raw) {
    return detectHeaderRowsBase(
        raw,
        parseInt(dom.nameRow.value, 10) - 1,
        parseInt(dom.unitRow.value, 10) - 1
    );
}

function describeHeaderParseIssue(raw, nameRow, unitRow, dataStart) {
    if (!raw || raw.length === 0) {
        return 'ファイルの先頭からCSV行を読み取れませんでした。文字コード、区切り文字、空ファイルでないことを確認してください。';
    }
    if (nameRow < 0 || nameRow >= raw.length) {
        return `Name Row (${nameRow + 1}) が読み取った範囲外です。Settings の Name Row を確認してください。`;
    }
    const headers = raw[nameRow] || [];
    if (headers.length < 2) {
        return `Name Row (${nameRow + 1}) に2列以上のヘッダーがありません。ヘッダー行を確認してください。`;
    }
    if (unitRow >= raw.length) {
        return `Unit Row (${unitRow + 1}) が読み取った範囲外です。Settings の Unit Row を確認してください。`;
    }
    if (raw.length <= dataStart) {
        return `データ開始行 (${dataStart + 1}) 以降の行がありません。Name Row / Unit Row の設定を確認してください。`;
    }
    return '';
}

/**
 * Phase 1: Header-only parse complete.
 * Extracts column metadata and stores File reference for lazy loading.
 * Does NOT load any column data yet — only time data is loaded via streaming.
 */
function onHeaderParsed(fileId, fileName, file, raw, delimiter, encoding, encodingMode, parseJob) {
    if (parseJob?.cancelled) {
        finishParseJob(parseJob);
        showWarning(`読み込みをキャンセルしました: ${fileName}`);
        return;
    }

    const { nameRow, unitRow } = detectHeaderRows(raw);
    const dataStart = Math.max(nameRow, unitRow >= 0 ? unitRow : nameRow) + 1;

    const parseIssue = describeHeaderParseIssue(raw, nameRow, unitRow, dataStart);
    if (parseIssue) {
        finishParseJob(parseJob);
        showError(`CSVヘッダーを読み取れません: ${fileName}`, parseIssue);
        return;
    }

    dom.nameRow.value = nameRow + 1;
    if (unitRow >= 0) dom.unitRow.value = unitRow + 1;

    const headers = raw[nameRow];
    const units   = unitRow >= 0 ? raw[unitRow] : Array(headers.length).fill('');

    let timeIdx = headers.findIndex(h => isTimeHeader(h));
    if (timeIdx < 0) {
        timeIdx = 0;
        showWarning(
            `Time列が見つかりません: ${fileName}`,
            '先頭列を時間軸として使用します。意図と違う場合は、時間列のヘッダーに Time または 時間 を含めてください。'
        );
    }

    const timeHeader = headers[timeIdx] || '';
    const timeUnit = unitRow >= 0 ? (raw[unitRow][timeIdx] || '').trim().toLowerCase() : '';
    const timeScaleInfo = getTimeScaleInfo(timeHeader, timeUnit);

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

    if (columns.length === 0) {
        finishParseJob(parseJob);
        showError(
            `チャンネルが見つかりません: ${fileName}`,
            `Name Row (${nameRow + 1}) に Time 列以外のチャンネル名がありません。ヘッダー行を確認してください。`
        );
        return;
    }

    const hasMain   = Object.values(state.files).some(f => f.role === 'main');
    const role      = hasMain ? 'sub' : 'main';
    const shortName = fileName.length > 22 ? fileName.slice(0, 20) + '…' : fileName;

    // Phase 2: Stream-parse to extract ONLY time data (no column values yet)
    const timeChunks = [];
    let rowIdx = 0;

    console.log(`[CSV Viewer] Phase 2: streaming time data for ${fileName} (dataStart=${dataStart}, timeIdx=${timeIdx})`);
    updateParseJob(parseJob, 'Loading time data...', 0);

    try {
        Papa.parse(file, {
            delimiter: delimiter,
            encoding,
            header: false,
            dynamicTyping: false,
            skipEmptyLines: true,
            step: function(result, parser) {
                if (parseJob?.cancelled) {
                    parser.abort();
                    finishParseJob(parseJob);
                    showWarning(`読み込みをキャンセルしました: ${fileName}`);
                    return;
                }
                rowIdx++;
                if (rowIdx % 2000 === 0) updateParseJob(parseJob, 'Loading time data...', rowIdx);
                if (rowIdx <= dataStart) return; // skip header rows
                const row = result.data;
                if (!row) return;
                const t = toNumber(row[timeIdx]);
                if (!isNaN(t)) {
                    timeChunks.push(t * timeScaleInfo.scale);
                }
            },
            complete: async function() {
                if (parseJob?.cancelled) return;
                try {
                    console.log(`[CSV Viewer] Time data loaded: ${timeChunks.length} points for ${fileName}`);
                    finishParseJob(parseJob);
                    if (timeChunks.length === 0) {
                        showError(
                            `時間データが見つかりません: ${fileName}`,
                            `Time列 (${timeIdx + 1}列目) に数値として読めるデータがありません。データ開始行、区切り文字、時間列を確認してください。`
                        );
                        return;
                    }
                    const timeData = new Float64Array(timeChunks.length);
                    for (let i = 0; i < timeChunks.length; i++) timeData[i] = timeChunks[i];

                    state.files[fileId] = {
                        name: fileName, shortName, columns, timeData,
                        colData: {},  // empty — columns loaded on demand
                        role, offset: 0,
                        file,         // File reference for lazy column loading
                        previewRows: raw.slice(0, Math.min(raw.length, dataStart + 4)),
                        headerInfo: {
                            nameRow, unitRow, dataStart, timeIdx, timeUnit,
                            timeScale: timeScaleInfo.scale,
                            timeScaleSource: timeScaleInfo.source,
                            timeScaleUnit: timeScaleInfo.unit,
                            delimiter, encoding, encodingMode,
                        },
                    };
                    autoNormalizeTimeScales();
                    updateParsePreview(state.files[fileId]);

                    // ファイル色を自動割り当て（単色モード用）
                    if (!state.fileColors[fileId]) {
                        const fileCount = Object.keys(state.fileColors).length;
                        state.fileColors[fileId] = SERIES_COLORS[fileCount % SERIES_COLORS.length];
                    }

                    if (role === 'sub' && !state.shiftFileId) state.shiftFileId = fileId;

                    // 保留中の設定があればファイル読込後に適用する
                    await applyPendingSettings();

                    // 既存のCustom RAMがあれば新ファイルにも計算・追加する
                    // .catchを.thenの前に置くことで、計算に失敗してもUI更新と保存は必ず行う
                    // （asyncコールバック内のPromise拒否は外側のtry/catchでは捕捉されないため）
                    if (state.customRAMs.length > 0) {
                        addCustomRAMsToFile(fileId)
                            .catch(e => showError(`Custom RAMの計算に失敗: ${fileName}`, e.stack || e.message))
                            .then(() => {
                                updateUI();
                                saveSettings();
                                // ファイルが増えたのでUndo履歴を取り直す（追加前には戻せない）
                                resetHistoryBaseline();
                            });
                    } else {
                        updateUI();
                        saveSettings();
                        // ファイルが増えたのでUndo履歴を取り直す（追加前には戻せない）
                        resetHistoryBaseline();
                    }
                } catch (e) {
                    showError(`Failed to process time data: ${fileName}`, e.stack || e.message);
                }
            },
            error: err => {
                finishParseJob(parseJob);
                showError(`Time data parse error: ${fileName}`, err.message || String(err));
            },
        });
    } catch (e) {
        finishParseJob(parseJob);
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
    // 前のジョブが失敗していても後続の読み込みが止まらないよう、拒否は握りつぶしてチェーンを継続する
    const prev = (_parseQueue.get(fileId) || Promise.resolve()).catch(() => {});
    const queueJob = prev.then(async () => {
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
        const loadJob = createParseJob(f.name, `Loading columns: ${colNamesStr}`);

        const { dataStart, timeIdx, delimiter: delim, encoding } = f.headerInfo;

        return new Promise(resolve => {
            try {
                const tempArrs = {};
                for (const col of stillNeeded) tempArrs[col.id] = [];

                let rowIdx = 0;

                Papa.parse(f.file, {
                    delimiter: delim,
                    encoding,
                    header: false,
                    dynamicTyping: false,
                    skipEmptyLines: true,
                    step: function(result, parser) {
                        if (loadJob.cancelled) {
                            parser.abort();
                            finishParseJob(loadJob);
                            showWarning(`カラム読み込みをキャンセルしました: ${f.name}`);
                            resolve();
                            return;
                        }
                        rowIdx++;
                        if (rowIdx % 2000 === 0) updateParseJob(loadJob, `Loading columns: ${colNamesStr}`, rowIdx);
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
                        if (loadJob.cancelled) return;
                        try {
                            finishParseJob(loadJob);
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
                        finishParseJob(loadJob);
                        showError(`Column parse error: ${f.name}`, err.message || String(err));
                        resolve();
                    },
                });
            } catch (e) {
                finishParseJob(loadJob);
                showError(`Failed to start column loading: ${f.name}`, e.stack || e.message);
                resolve();
            }
        });
    });

    // Clean up queue entry when done
    // ジョブが失敗してもMapから必ず削除する（拒否済みPromiseが残ると以降の読み込みが永久に失敗するため）
    const cleanup = queueJob
        .catch(e => showError(`Column load failed: ${f.name}`, e.stack || e.message))
        .then(() => {
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
            const relevantNames = getResolvedNamesForFile(f, names);
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

function getChannelAliases(mainName) {
    return Array.isArray(state.channelAliases[mainName])
        ? state.channelAliases[mainName].filter(Boolean)
        : [];
}

function addChannelAlias(mainName, aliasName) {
    if (!mainName || !aliasName || mainName === aliasName) return false;
    const aliases = getChannelAliases(mainName);
    if (aliases.includes(aliasName)) return false;
    state.channelAliases[mainName] = [...aliases, aliasName];
    return true;
}

function removeChannelAlias(mainName, aliasName) {
    const aliases = getChannelAliases(mainName).filter(a => a !== aliasName);
    if (aliases.length) state.channelAliases[mainName] = aliases;
    else delete state.channelAliases[mainName];
}

function pruneChannelAliasesForMain(mainFile = getMainFile()) {
    if (!mainFile) return;
    const mainNames = new Set(mainFile.columns.map(c => c.name));
    for (const name of Object.keys(state.channelAliases)) {
        if (!mainNames.has(name)) delete state.channelAliases[name];
    }
}

function resolveColumnForFile(fileRecord, mainName, opts = {}) {
    if (!fileRecord || !mainName) return null;
    const exact = fileRecord.columns.find(c => c.name === mainName);
    if (fileRecord.role === 'main') return exact;

    for (const alias of getChannelAliases(mainName)) {
        const col = fileRecord.columns.find(c => c.name === alias);
        if (col) return col;
    }
    return opts.includeExactFallback === false ? null : exact;
}

function getResolvedNamesForFile(fileRecord, mainNames) {
    const names = [];
    for (const mainName of mainNames) {
        const col = resolveColumnForFile(fileRecord, mainName);
        if (col && !names.includes(col.name)) names.push(col.name);
    }
    return names;
}

function getAliasCandidates(mainCol) {
    const seen = new Map();
    for (const subId of getSubFileIds()) {
        const file = state.files[subId];
        if (!file) continue;
        for (const col of file.columns) {
            const key = col.name;
            if (!seen.has(key)) {
                seen.set(key, {
                    col,
                    score: scoreAliasCandidate(mainCol, col),
                    files: [],
                });
            }
            seen.get(key).files.push(file.shortName);
        }
    }

    return [...seen.values()]
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.col.name.localeCompare(b.col.name, 'ja');
        });
}

function getTimeSpan(fileRecord) {
    const td = fileRecord?.timeData;
    if (!td || td.length < 2) return NaN;
    const span = Math.abs(td[td.length - 1] - td[0]);
    return span > 0 ? span : NaN;
}

function getRawTimeSpan(fileRecord) {
    const scale = Number(fileRecord?.headerInfo?.timeScale) || 1;
    const span = getTimeSpan(fileRecord);
    return isFinite(span) ? span / scale : NaN;
}

function isExplicitTimeScale(fileRecord) {
    const source = fileRecord?.headerInfo?.timeScaleSource;
    return source === 'unit' || source === 'header' || source === 'manual';
}

function applyTimeScale(fileRecord, scale, source, unit, note) {
    const hi = fileRecord?.headerInfo;
    if (!fileRecord || !hi) return false;

    const oldScale = Number(hi.timeScale) || 1;
    const ratio = scale / oldScale;
    const needsDataChange = Math.abs(ratio - 1) > 1e-12;

    if (needsDataChange && fileRecord.timeData) {
        for (let i = 0; i < fileRecord.timeData.length; i++) {
            fileRecord.timeData[i] *= ratio;
        }
    }

    const metaChanged = hi.timeScale !== scale
        || hi.timeScaleSource !== source
        || hi.timeScaleUnit !== unit
        || hi.timeScaleNote !== note;

    hi.timeScale = scale;
    hi.timeScaleSource = source;
    hi.timeScaleUnit = unit;
    hi.timeScaleNote = note || '';
    return needsDataChange || metaChanged;
}

function inferTimeScaleAgainstReference(fileRecord, referenceFile) {
    const rawSpan = getRawTimeSpan(fileRecord);
    const refSpan = getTimeSpan(referenceFile);
    if (!isFinite(rawSpan) || !isFinite(refSpan) || rawSpan <= 0 || refSpan <= 0) return null;

    const candidates = [
        { scale: 1, unit: 's' },
        { scale: 0.001, unit: 'ms' },
    ].map(c => {
        const span = rawSpan * c.scale;
        const ratio = span / refSpan;
        return {
            ...c,
            span,
            ratio,
            score: Math.abs(Math.log(ratio)),
        };
    }).sort((a, b) => a.score - b.score);

    const [best, second] = candidates;
    if (!best || !second) return null;

    const closeEnough = best.score <= Math.log(3);
    const muchBetter = (second.score - best.score) >= Math.log(50);
    return closeEnough && muchBetter ? best : null;
}

function autoNormalizeTimeScales({ notify = true } = {}) {
    const files = Object.values(state.files).filter(f => f.timeData?.length >= 2);
    if (files.length < 2) return;

    const changes = [];
    const explicitFiles = files.filter(isExplicitTimeScale);
    const unknownFiles = files.filter(f => !isExplicitTimeScale(f));

    if (explicitFiles.length) {
        const mainExplicit = explicitFiles.find(f => f.role === 'main');
        const reference = mainExplicit || explicitFiles[0];
        for (const file of unknownFiles) {
            const inferred = inferTimeScaleAgainstReference(file, reference);
            if (!inferred) continue;
            const changed = applyTimeScale(
                file,
                inferred.scale,
                'auto',
                inferred.unit,
                `matched ${reference.shortName || reference.name}`
            );
            if (changed) changes.push(`${file.shortName}: ${inferred.unit}`);
        }
    } else {
        const entries = unknownFiles
            .map(file => ({ file, rawSpan: getRawTimeSpan(file) }))
            .filter(e => isFinite(e.rawSpan) && e.rawSpan > 0)
            .sort((a, b) => a.rawSpan - b.rawSpan);

        if (entries.length >= 2) {
            const minSpan = entries[0].rawSpan;
            const maxSpan = entries[entries.length - 1].rawSpan;
            const ratio = maxSpan / minSpan;

            if (ratio >= 500 && ratio <= 2000) {
                const threshold = Math.sqrt(minSpan * maxSpan);
                for (const entry of entries) {
                    const inferred = entry.rawSpan >= threshold
                        ? { scale: 0.001, unit: 'ms' }
                        : { scale: 1, unit: 's' };
                    const changed = applyTimeScale(
                        entry.file,
                        inferred.scale,
                        'auto',
                        inferred.unit,
                        'duration ratio'
                    );
                    if (changed) changes.push(`${entry.file.shortName}: ${inferred.unit}`);
                }
            }
        }
    }

    if (notify && changes.length) {
        showWarning(
            'Time単位を自動調整しました',
            `${changes.join(', ')} を秒基準に揃えました。Parse Info で判定結果を確認できます。`
        );
    }
}

function getTimeScaleLabel(fileRecord) {
    const hi = fileRecord?.headerInfo || {};
    const rawUnit = hi.timeUnit || '';
    const unit = hi.timeScaleUnit || rawUnit || '';
    const scale = Number(hi.timeScale) || 1;
    const source = hi.timeScaleSource || 'auto';
    const sourceLabel = source === 'unit'
        ? 'unit'
        : source === 'header'
            ? 'header'
            : source === 'manual'
                ? 'manual'
                : 'auto';

    if (unit) return `${unit} -> s (${sourceLabel})`;
    if (scale !== 1) return `x${scale} -> s (${sourceLabel})`;
    return `s (${sourceLabel})`;
}

async function setManualTimeUnit(fileId, unit) {
    const fileRecord = state.files[fileId];
    if (!fileRecord || !['s', 'ms'].includes(unit)) return;

    const scale = unit === 'ms' ? 0.001 : 1;
    const changed = applyTimeScale(fileRecord, scale, 'manual', unit, 'user override');
    if (!changed) return;

    updateParsePreview(fileRecord);

    if (state.customRAMs.length) await recomputeCustomRAMs();
    renderFileList();
    renderColumnList();
    renderChart();
    saveSettings();
    // 時間軸スケールが変わると過去のスナップショットのズーム位置が意味を失うため、
    // Undo履歴をクリアして現在状態を新しい起点にする
    resetHistoryBaseline();
    showExportToast('Time単位を変更しました', `${fileRecord.shortName}: ${unit} → 秒基準`);
}

function updateParsePreview(fileRecord) {
    if (!dom.parsePreview || !fileRecord) return;
    const hi = fileRecord.headerInfo;
    const encodingLabel = hi.encodingMode === 'auto'
        ? `Auto → ${hi.encoding}`
        : hi.encoding;
    const channelNames = fileRecord.columns.slice(0, 5).map(c => c.name).join(', ');
    const more = fileRecord.columns.length > 5 ? `, +${fileRecord.columns.length - 5}` : '';
    const timeHeader = fileRecord.previewRows?.[hi.nameRow]?.[hi.timeIdx] || `#${hi.timeIdx}`;

    dom.parsePreview.classList.remove('hidden');
    dom.parsePreview.innerHTML = `
        <div class="parse-preview-title" title="${esc(fileRecord.name)}">${esc(fileRecord.name)}</div>
        <dl class="parse-preview-grid">
            <dt>Encoding</dt><dd>${esc(encodingLabel)}</dd>
            <dt>Rows</dt><dd>Name ${hi.nameRow + 1}, Unit ${hi.unitRow >= 0 ? hi.unitRow + 1 : '-'}, Data ${hi.dataStart + 1}</dd>
            <dt>Time</dt><dd>${esc(timeHeader)} (${esc(getTimeScaleLabel(fileRecord))})</dd>
            <dt>Data</dt><dd>${fileRecord.timeData.length} points / ${fileRecord.columns.length} channels</dd>
        </dl>
        <div class="parse-preview-channels" title="${esc(channelNames + more)}">${esc(channelNames + more || 'チャンネルなし')}</div>
    `;
}

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
    state.chartGroups.forEach(group => {
        group.channels = group.channels.filter(ch => newColNames.has(ch.name));
        cleanupChartGroup(group);
    });
    state.chartGroups = state.chartGroups.filter(group => group.channels.length);
    pruneChannelAliasesForMain(newMain);
    autoNormalizeTimeScales();
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
        state.chartGroups   = [];
        state.channelAliases = {};
        const remaining = Object.keys(state.files);
        if (remaining.length) state.files[remaining[0]].role = 'main';
    }

    updateUI();
    const latestFile = Object.values(state.files).at(-1);
    if (latestFile) updateParsePreview(latestFile);
    else if (dom.parsePreview) dom.parsePreview.classList.add('hidden');

    // ファイル構成が変わった（削除されたファイルのデータは戻せない）ので、
    // Undo履歴をクリアして現在状態を新しい起点にする
    resetHistoryBaseline();
}

dom.clearBtn.addEventListener('click', () => {
    for (const job of state.parseJobs.values()) job.cancelled = true;
    state.parseJobs.clear();
    state.files         = {};
    state.selectedNames = new Set();
    state.chartGroups   = [];
    state.channelAliases = {};
    state.bitChannels   = new Set();
    _bitManualOff.clear();
    state.yRanges       = {};
    state.colorCtr      = 0;
    state.fileColors    = {};
    state.shiftFileId   = null;
    // ファイルが無くなるのでUndo履歴も空にする（起点は積まない）
    CSVHistory.reset(appHistory);
    updateUndoRedoButtons();
    _pendingSettings    = null; // 保留設定もクリア
    if (state.shiftMode) exitShiftMode();
    if (state.arrangeMode) exitArrangeMode();
    if (dom.parsePreview) dom.parsePreview.classList.add('hidden');
    renderParseJobs();
    updateUI();
    // localStorageの保存データもクリア
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
    // 上のupdateUI()がsaveSettings()で保存を予約しているため、
    // キャンセルしないと500ms後に空設定が書き戻されてしまう
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = null;
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

    const canArrange = state.chartGroups.length > 1;
    if (dom.arrangeBtn) dom.arrangeBtn.disabled = !canArrange;
    if (!canArrange && state.arrangeMode) exitArrangeMode();

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
        const effectiveTimeUnit = f.headerInfo?.timeScaleUnit === 'ms' ? 'ms' : 's';
        const timeUnitRow = `
            <div class="file-time-unit-row">
                <span class="time-unit-label">Time</span>
                <select class="time-unit-select" data-time-unit-id="${fid}"
                    title="このファイルのTime列の元単位を指定">
                    <option value="s"${effectiveTimeUnit === 's' ? ' selected' : ''}>s</option>
                    <option value="ms"${effectiveTimeUnit === 'ms' ? ' selected' : ''}>ms</option>
                </select>
                <span class="time-unit-source">${f.headerInfo?.timeScaleSource === 'manual' ? 'Manual' : 'Auto'}</span>
            </div>`;

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
        const encodingLabel = f.headerInfo?.encodingMode === 'auto'
            ? `Auto:${f.headerInfo.encoding}`
            : (f.headerInfo?.encoding || '');

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
                ${encodingLabel ? `<span class="encoding-badge" title="CSV文字コード">${esc(encodingLabel)}</span>` : ''}
                <i class='bx bx-bug debug-file' data-fid="${fid}" title="Debug: パース結果を確認"></i>
                <i class='bx bx-x remove-file' data-fid="${fid}" title="Remove"></i>
            </div>
            ${timeUnitRow}
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
            // inputイベントはドラッグ中に連続発火するため、coalesceKeyを渡して
            // 短時間の連続変更をUndo履歴1エントリにまとめる
            saveSettings('fileColor:' + fid);
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

    // Manual Time unit override
    // 注意: このリスナー登録はrenderFileList内で行うこと。
    // renderCustomRAMList内に置くと、ファイルリストのselect要素は作り直されないまま
    // Custom RAM操作のたびにリスナーが累積し、単位切替時に再計算が複数回走るバグになる
    dom.fileList.querySelectorAll('.time-unit-select').forEach(select => {
        select.addEventListener('change', async () => {
            select.disabled = true;
            try {
                await setManualTimeUnit(select.dataset.timeUnitId, select.value);
            } finally {
                if (select.isConnected) select.disabled = false;
            }
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
    // id を振ることで aria-labelledby からモーダルタイトルを参照できる
    let html = `<h3 id="debug-modal-title" style="margin:0 0 12px;color:#818cf8;">Parse Info</h3>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:16px;">`;
    const infoRows = [
        ['ファイル名', f.name],
        ['role', f.role],
        ['nameRow (0始まり)', hi.nameRow],
        ['unitRow (0始まり)', hi.unitRow],
        ['dataStart (0始まり)', hi.dataStart],
        ['timeIdx (列番号)', hi.timeIdx],
        ['timeUnit', hi.timeUnit || '(なし)'],
        ['timeScale', getTimeScaleLabel(f)],
        ['timeScaleNote', hi.timeScaleNote || '-'],
        ['delimiter', hi.delimiter === '\t' ? 'TAB (\\t)' : hi.delimiter === undefined ? 'auto' : JSON.stringify(hi.delimiter)],
        ['encoding', hi.encodingMode === 'auto' ? `Auto → ${hi.encoding}` : hi.encoding],
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
    } else if (f.previewRows && f.previewRows.length) {
        html += `<h3 style="margin:0 0 8px;color:#818cf8;">読み込みプレビュー</h3>`;
        html += `<pre style="font-size:10px;color:#fda4af;background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;overflow-x:auto;white-space:pre;max-width:100%;">`;
        for (let i = 0; i < f.previewRows.length; i++) {
            let label = '';
            if (i === hi.nameRow)  label = ' ← nameRow';
            if (i === hi.unitRow)  label = ' ← unitRow';
            if (i === hi.dataStart) label = ' ← dataStart';
            html += `<span style="color:#a0a5b1;">[${i}]</span> ${esc(f.previewRows[i].join(' | '))}<span style="color:#f59e0b;font-weight:600;">${label}</span>\n`;
        }
        html += `</pre>`;
    }

    // --- モーダル表示 ---
    let overlay = document.getElementById('app-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'app-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    // aria-labelledby でスクリーンリーダーがモーダルのタイトルを読み上げられるようにする
    modal.setAttribute('aria-labelledby', 'debug-modal-title');
    modal.style.cssText = 'background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:640px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;';
    modal.innerHTML = html
        + `<div style="text-align:right;margin-top:12px;"><button onclick="this.closest('#app-modal-overlay').remove()" `
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

async function addCustomRAM(name, expr, unit = '') {
    const mainFile = getMainFile();
    if (!mainFile || !name.trim() || !expr.trim()) return;

    name = name.trim();
    unit = String(unit || '').trim();
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
        const colDef = { id: colId, name, unit, idx: -1, color, isCustom: true, isCrossFile };
        f.columns.unshift(colDef);
        const vals = (f === mainFile) ? mainVals : computeCustomExpr(expr, f);
        f.colData[colId] = vals;
    }

    state.customRAMs.push({ name, unit, expr, id });
    state.selectedNames.add(name);
    addStandaloneChart(name);

    renderCustomRAMList();
    renderColumnList();
    renderChart();
    // 永続化とUndo履歴記録。これがないとリロードでRAMが消え、Undo対象にもならない
    // （復元処理から呼ばれた場合はrecordHistory側のフラグで二重記録が防がれる）
    saveSettings();
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
    removeChannelFromChartGroups(name);

    renderCustomRAMList();
    renderColumnList();
    renderChart();
    // 永続化とUndo履歴記録（addCustomRAMと対になる）
    saveSettings();
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
            const colDef = { id: colId, name: cr.name, unit: cr.unit || '', idx: -1, color, isCustom: true, isCrossFile: isCross };
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

        const colDef = { id: colId, name: cr.name, unit: cr.unit || '', idx: -1, color, isCustom: true, isCrossFile: isCross };
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
            + `<span class="cr-unit">${esc(cr.unit || 'unitなし')}</span>`
            + `<span class="cr-expr" title="${esc(cr.expr)}">${esc(cr.expr)}</span>`
            + `<i class='bx bx-edit-alt cr-edit' data-crid="${esc(cr.id)}" title="単位を編集"></i>`
            + `<i class='bx bx-x cr-del' data-crid="${esc(cr.id)}" title="Remove"></i>`;
        dom.customList.appendChild(li);
    }
    dom.customList.querySelectorAll('.cr-del').forEach(el => {
        el.addEventListener('click', () => removeCustomRAM(el.dataset.crid));
    });

    dom.customList.querySelectorAll('.cr-edit').forEach(el => {
        el.addEventListener('click', () => showCustomRAMUnitModal(el.dataset.crid));
    });
}

function showCustomRAMUnitModal(id) {
    const cr = state.customRAMs.find(item => item.id === id);
    if (!cr) return;
    document.getElementById('app-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'app-modal-overlay';
    overlay.className = 'app-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'app-modal custom-unit-modal';
    modal.setAttribute('aria-labelledby', 'custom-unit-title');
    modal.innerHTML = `
        <h3 id="custom-unit-title">Custom RAM Unit</h3>
        <p>${esc(cr.name)}</p>
        <input type="text" class="custom-ram-input custom-unit-edit-input" value="${esc(cr.unit || '')}" placeholder="Unit (optional)">
        <div class="modal-actions">
            <button class="btn-secondary custom-unit-cancel">キャンセル</button>
            <button class="btn-primary custom-unit-save">保存</button>
        </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setupModalA11y(overlay, modal);
    const input = modal.querySelector('.custom-unit-edit-input');
    input.focus();
    const close = () => overlay.remove();
    modal.querySelector('.custom-unit-cancel').addEventListener('click', close);
    modal.querySelector('.custom-unit-save').addEventListener('click', () => {
        cr.unit = input.value.trim();
        for (const file of Object.values(state.files)) {
            const col = file.columns.find(c => c.isCustom && c.name === cr.name);
            if (col) col.unit = cr.unit;
        }
        renderCustomRAMList();
        renderColumnList();
        renderChart();
        saveSettings();
        close();
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

dom.customAdd.addEventListener('click', () => {
    addCustomRAM(dom.customName.value, dom.customExpr.value, dom.customUnit.value);
    dom.customName.value = '';
    dom.customUnit.value = '';
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
    // id を振ることで aria-labelledby からモーダルタイトルを参照できる
    let html = `<h3 id="custom-ram-help-title" style="margin:0 0 12px;color:#818cf8;">Custom RAM 関数リファレンス</h3>`;

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
    let overlay = document.getElementById('app-modal-overlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'app-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    // aria-labelledby でスクリーンリーダーがモーダルのタイトルを読み上げられるようにする
    modal.setAttribute('aria-labelledby', 'custom-ram-help-title');
    modal.style.cssText = 'background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:520px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;';
    modal.innerHTML = html
        + `<div style="text-align:right;margin-top:12px;"><button onclick="this.closest('#app-modal-overlay').remove()" `
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

        const aliasCount = getChannelAliases(col.name).length;
        const mapBtn = document.createElement('i');
        mapBtn.className = 'bx bx-link-alt col-map-btn' + (aliasCount ? ' active' : '');
        mapBtn.title = aliasCount
            ? `別名対応: ${aliasCount}件`
            : 'Subファイル側の別名チャンネルを対応付け';
        mapBtn.addEventListener('click', e => {
            e.stopPropagation();
            showChannelMapModal(col.name);
        });
        topRow.appendChild(mapBtn);

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
            const group = getChartGroupForChannel(col.name);
            const assignment = group?.channels.find(ch => ch.name === col.name);
            const axis = group?.axes.find(a => a.id === assignment?.axisId);
            const representative = axis?.representative || col.name;
            const representativeRange = state.yRanges[representative] ?? { min: '', max: '' };
            const yr = document.createElement('div');
            yr.className = 'col-yrange';
            yr.addEventListener('click', e => e.stopPropagation());
            yr.innerHTML = representative !== col.name
                ? `<span class="col-yrange-shared">Y range: ${esc(representative)} と共有</span>`
                : `
                <span class="col-yrange-label">Y</span>
                <input type="number" class="yrange-input" placeholder="min"
                    value="${esc(representativeRange.min)}"
                    data-range-name="${esc(col.name)}" data-range-type="min"
                    title="Y-axis minimum">
                <span class="yrange-sep">~</span>
                <input type="number" class="yrange-input" placeholder="max"
                    value="${esc(representativeRange.max)}"
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
                removeChannelFromChartGroups(col.name);
                renderColumnList();
                renderChart();
            } else {
                state.selectedNames.add(col.name);
                addStandaloneChart(col.name);
                if (!state.yRanges[col.name]) state.yRanges[col.name] = { min: '', max: '' };
                renderColumnList();
                ensureColumnsAndRender();
            }
            saveSettings();
        });

        dom.colList.appendChild(item);
    }
}

function showChannelMapModal(mainName) {
    const mainFile = getMainFile();
    if (!mainFile) return;
    const mainCol = mainFile.columns.find(c => c.name === mainName);
    if (!mainCol) return;

    let overlay = document.getElementById('app-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'app-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.setAttribute('aria-labelledby', 'channel-map-title');
    modal.style.cssText = 'background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:680px;width:92%;max-height:82vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const render = (filterText = '') => {
        const aliases = getChannelAliases(mainName);
        const candidates = getAliasCandidates(mainCol)
            .filter(c => c.col.name !== mainName && !aliases.includes(c.col.name))
            .filter(c => !filterText || c.col.name.toLowerCase().includes(filterText.toLowerCase()))
            .slice(0, 40);

        const aliasChips = aliases.length
            ? aliases.map(alias => `<span class="alias-chip">${esc(alias)}<button data-remove-alias="${esc(alias)}" title="削除">×</button></span>`).join('')
            : '<span class="alias-empty">未設定</span>';

        const candidateRows = candidates.length
            ? candidates.map(c => {
                const unit = c.col.unit ? ` (${esc(c.col.unit)})` : '';
                const files = c.files.join(', ');
                const score = c.score.toFixed(2);
                return `<button class="alias-candidate" data-add-alias="${esc(c.col.name)}">
                    <span class="alias-candidate-name">${esc(c.col.name)}${unit}</span>
                    <span class="alias-candidate-meta">score ${score} / ${esc(files)}</span>
                </button>`;
            }).join('')
            : '<div class="alias-empty">候補がありません</div>';

        modal.innerHTML = `
            <h3 id="channel-map-title" style="margin:0 0 10px;color:#818cf8;">Channel Map</h3>
            <div class="alias-main">
                <div class="alias-main-label">Main</div>
                <div class="alias-main-name">${esc(mainName)}${mainCol.unit ? ` <span>(${esc(mainCol.unit)})</span>` : ''}</div>
            </div>
            <div class="alias-section">
                <div class="alias-section-title">登録済み別名</div>
                <div class="alias-chip-row">${aliasChips}</div>
            </div>
            <div class="alias-section">
                <div class="alias-section-title">Sub側候補</div>
                <input type="text" id="alias-filter-input" class="alias-filter-input" placeholder="候補を検索..." value="${esc(filterText)}">
                <div class="alias-candidate-list">${candidateRows}</div>
            </div>
            <div class="alias-actions">
                <button id="alias-close-btn" class="btn-secondary">閉じる</button>
            </div>
        `;

        const input = modal.querySelector('#alias-filter-input');
        input.addEventListener('input', () => render(input.value));
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);

        modal.querySelectorAll('[data-add-alias]').forEach(btn => {
            btn.addEventListener('click', () => {
                addChannelAlias(mainName, btn.dataset.addAlias);
                saveSettings();
                renderColumnList();
                ensureColumnsAndRender();
                render(input.value);
            });
        });
        modal.querySelectorAll('[data-remove-alias]').forEach(btn => {
            btn.addEventListener('click', () => {
                removeChannelAlias(mainName, btn.dataset.removeAlias);
                saveSettings();
                renderColumnList();
                ensureColumnsAndRender();
                render(input.value);
            });
        });
        modal.querySelector('#alias-close-btn').addEventListener('click', () => overlay.remove());
    };

    render();
    setupModalA11y(overlay, modal);
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

    const alignableNames = mainFile.columns
        .map(c => c.name)
        .filter(name => !!resolveColumnForFile(subFile, name));

    if (!alignableNames.length) {
        alert('両ファイルで対応付けできるチャンネルがありません。Channel Mapで別名を設定してください。');
        return;
    }

    // --- チャンネル選択モーダルを表示 ---
    const selectedChannels = await showAlignChannelModal(alignableNames, subFileId);
    if (!selectedChannels || !selectedChannels.names.length) return; // キャンセル

    const chosenNames = selectedChannels.names;
    const searchRange = selectedChannels.range; // 探索範囲（秒）

    // 必要なカラムをロード
    const mainFileId = getMainFileId();
    const subLoadNames = getResolvedNamesForFile(subFile, chosenNames);
    await Promise.all([
        loadColumnsForFile(mainFileId, chosenNames),
        loadColumnsForFile(subFileId, subLoadNames),
    ]);

    const mainCols = chosenNames.map(name => mainFile.columns.find(c => c.name === name)).filter(Boolean);
    const subCols  = chosenNames.map(name => resolveColumnForFile(subFile, name)).filter(Boolean);

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
            const resolved = resolveColumnForFile(subFile, name);
            const aliasText = resolved && resolved.name !== name
                ? `<span style="color:#86efac;font-size:11px;margin-left:auto;">← ${esc(resolved.name)}</span>`
                : '';
            // チェックボックス＋チャンネル名のラベル
            return `<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:13px;transition:background 0.15s;"
                onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" value="${esc(name)}" ${checked} style="accent-color:#6366f1;"> ${esc(name)} ${aliasText}
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

    syncChartGroupsWithSelection();

    const groups = new Map();
    const order  = [];

    for (const chartGroup of state.chartGroups) {
        const channelNames = chartGroup.channels.map(ch => ch.name).filter(name => state.selectedNames.has(name));
        if (!channelNames.length) continue;

        order.push(chartGroup.id);
        const grp = {
            id: chartGroup.id,
            axes: chartGroup.axes.map(axis => ({ ...axis })),
            channels: chartGroup.channels.map(ch => ({ ...ch })),
            series: [],
            mergedNames: channelNames,
        };
        groups.set(chartGroup.id, grp);

        // 各チャンネルについてメイン＋サブのシリーズを構築
        for (const chName of channelNames) {
            const col = mainFile.columns.find(c => c.name === chName);
            if (!col) continue;
            const assignment = chartGroup.channels.find(ch => ch.name === chName);
            if (!assignment) continue;

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
                channelName: chName,
                axisId: assignment.axisId,
            });

            // ── Sub series (dashed lines, time-shifted) ────────
            for (const subId of getSubFileIds()) {
                const sf  = state.files[subId];
                const sc  = resolveColumnForFile(sf, chName);
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
                    label: sc.name === chName
                        ? `${chName} [${sf.shortName}]`
                        : `${chName} ← ${sc.name} [${sf.shortName}]`,
                    color: subColor,
                    dash:  true,
                    data:  sPts,
                    channelName: chName,
                    axisId: assignment.axisId,
                });
            }
        }
    }

    return { groups, order };
}

// ─────────────────────────────────────────────────────────────
// Chart rendering
// ─────────────────────────────────────────────────────────────

// 自動フィット時の実効行高さ（renderChartが更新、全体＋/−ボタンの起点に使う）
let _lastAutoRow = null;

function renderChart() {
    if (!state.chart) initChart();

    // Preserve current X-axis dataZoom state before notMerge rebuild
    // Undo/Redo復元中は履歴エントリのズーム位置を優先する
    // （復元が引き起こす全ての再描画が目標ズームで描かれるため、タイミングに依存しない）
    let savedXZoom = _pendingZoomRestore ? { ..._pendingZoomRestore } : null;
    if (!savedXZoom) {
        const curOpt = state.chart.getOption();
        if (curOpt && curOpt.dataZoom && curOpt.dataZoom.length >= 2) {
            savedXZoom = { start: curOpt.dataZoom[0].start, end: curOpt.dataZoom[0].end };
        }
    }

    const active = getActiveGroups();
    _lastRenderedGroups = active; // ホバー時のラベル更新用スナップショット
    const { groups, order } = active;
    const n = order.length;

    if (n === 0) {
        state.chart.clear();
        removeArrangeOverlay();
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

    // フォントスケールと、それに連動する余白(数値ラベル幅・軸名間隔・左マージン)
    const F  = CSVLayout.getFontSizes(state.fontScale);
    const DL = CSVLayout.deriveLayout(F);

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

    // グリッド高さの配分（layout-utils.jsの純粋関数）。
    // rowHeightPx/個別上書きが未設定なら従来どおりコンテナに収まる自動配分、
    // 設定されていれば合計がコンテナを超えた分だけキャンバスを伸ばす（縦スクロール）
    const containerH = dom.chartEl.parentElement.clientHeight;
    const gridSigs = order.map(gid => CSVLayout.gridSignature(groups.get(gid).mergedNames));
    const { heights: gridHeights, totalH, autoRow } = CSVLayout.computeGridHeights({
        weights: gridWeights,
        signatures: gridSigs,
        overrides: state.gridHeights,
        rowHeightPx: state.rowHeightPx,
        containerH, topPx, botPx, gapPx,
    });
    _lastAutoRow = autoRow; // 全体＋/−ボタンの起点（自動フィット時の実効行高さ）

    // キャンバス高さを反映（変化したときだけresizeする。setOptionの%指定より前に行う）
    const targetStyleH = totalH > containerH ? totalH + 'px' : '100%';
    if (dom.chartEl.style.height !== targetStyleH) {
        // ツールチップ表示中にresizeするとECharts内部で
        // 「offsetWidth of null」エラーが出るため、先に隠す
        state.chart.dispatchAction({ type: 'hideTip' });
        dom.chartEl.style.height = targetStyleH;
        state.chart.resize();
    }

    const H = totalH;
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

    const AXIS_GAP = DL.axisGap; // フォントに連動(大きいフォントで軸同士が重ならないように)
    const ZOOM_GAP = 12;
    const groupLayouts = order.map(groupId => {
        const axisCount = Math.max(groups.get(groupId).axes.length, 1);
        const leftCount = Math.ceil(axisCount / 2);
        const rightCount = Math.floor(axisCount / 2);
        return {
            left: DL.gridLeft + Math.max(0, leftCount - 1) * AXIS_GAP,
            right: Math.max(L.gridRight, 68) + Math.max(0, rightCount - 1) * AXIS_GAP + axisCount * ZOOM_GAP,
            axisCount,
        };
    });
    const xSliderLeft = Math.max(...groupLayouts.map(layout => layout.left));
    const xSliderRight = Math.max(...groupLayouts.map(layout => layout.right));
    const narrowPlotWidth = state.chart.getWidth() - xSliderLeft - xSliderRight;
    const warningKey = narrowPlotWidth < 260 ? `${Math.max(...groupLayouts.map(l => l.axisCount))}:${Math.round(narrowPlotWidth)}` : '';
    if (warningKey && state.axisLayoutWarningKey !== warningKey) {
        state.axisLayoutWarningKey = warningKey;
        showWarning('Y軸が多いため描画領域が狭くなっています', 'Overlay Settings で軸を共有すると表示幅を広げられます。');
    } else if (!warningKey) {
        state.axisLayoutWarningKey = '';
    }

    // X-axis slider (bottom, all grids linked)
    const xStart = savedXZoom ? savedXZoom.start : 0;
    const xEnd   = savedXZoom ? savedXZoom.end   : 100;
    dataZooms.push({
        type: 'slider',
        xAxisIndex: order.map((_, i) => i),
        start: xStart, end: xEnd,
        bottom: 8, height: 28,
        left: xSliderLeft, right: xSliderRight,
        borderColor: T.border,
        backgroundColor: 'rgba(255,255,255,0.03)',
        fillerColor: 'rgba(99,102,241,0.18)',
        handleStyle: { color: '#6366f1', borderColor: '#6366f1' },
        textStyle: { color: T.dim, fontSize: F.slider },
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
        moveOnMouseMove:   !state.shiftMode && !state.arrangeMode,
        moveOnMouseWheel:  false,
    });

    const yAxisIndexByGroup = new Map();
    let _cumulativeTop = topPx;
    order.forEach((groupId, i) => {
        const grp    = groups.get(groupId);
        const gridH  = gridHeights[i];
        const topPxI = _cumulativeTop;
        _cumulativeTop += gridH + gapPx;
        const layout = groupLayouts[i];

        const isBitGrid = grp.mergedNames.every(nm => state.bitChannels.has(nm));

        grids.push({
            left: layout.left, right: layout.right,
            top: pct(topPxI), height: pct(gridH),
            containLabel: false,
        });

        xAxes.push({
            gridIndex: i,
            type: 'value',
            axisLabel: {
                show: i === n - 1,
                color: T.dim, fontSize: F.label,
                formatter: v => v % 1 === 0 ? v.toString() : v.toFixed(1),
            },
            axisTick:  { show: i === n - 1, lineStyle: { color: T.axis } },
            axisLine:  { show: true, lineStyle: { color: T.axis } },
            splitLine: { show: true, lineStyle: { color: T.grid } },
            min: globalXMin, max: globalXMax,
        });

        const yValFmt = v => {
            if (v === 0) return '0';
            const a = Math.abs(v);
            if (a >= 1e6)  return (v / 1e6).toFixed(1) + 'M';
            if (a >= 1e3)  return (v / 1e3).toFixed(1) + 'k';
            if (a >= 1)    return v.toFixed(1);
            if (a >= 0.01) return v.toPrecision(2);
            return v.toExponential(1);
        };
        const axisIndexMap = new Map();
        const axisSpecs = new Map();
        grp.axes.forEach((axis, axisOrder) => {
            const assignedNames = grp.channels.filter(ch => ch.axisId === axis.id).map(ch => ch.name);
            if (!assignedNames.length) return;
            const representative = assignedNames.includes(axis.representative) ? axis.representative : assignedNames[0];
            const rangeSpec = state.yRanges[representative] ?? {};
            const axisIsBit = assignedNames.every(name => state.bitChannels.has(name));
            const yMinParsed = axisIsBit ? -0.2 : parseFloat(rangeSpec.min);
            const yMaxParsed = axisIsBit ? 1.2 : parseFloat(rangeSpec.max);
            const hasYMin = !isNaN(yMinParsed);
            const hasYMax = !isNaN(yMaxParsed);
            const position = axisOrder % 2 === 0 ? 'left' : 'right';
            const offset = Math.floor(axisOrder / 2) * AXIS_GAP;
            const units = getAxisDisplayUnit(getChartGroupById(groupId), axis.id);
            const yLabelName = assignedNames.join(' / ');
            const yLabel = units ? `${yLabelName}  (${units})` : yLabelName;
            const yAxisIndex = yAxes.length;
            axisIndexMap.set(axis.id, yAxisIndex);
            axisSpecs.set(axis.id, { representative, yMinParsed, yMaxParsed, hasYMin, hasYMax });

            yAxes.push({
                gridIndex: i,
                type: 'value',
                position,
                offset,
                name: yLabel,
                nameLocation: 'middle',
                nameGap: DL.nameGap,
                nameTextStyle: { color: T.dim, fontSize: F.name, fontWeight: 500 },
                // 軸名(回転表示)がグリッド高さを超えると上下のチャートのラベルと
                // 重なるため、収まらない分は「…」で自動的に切り詰める(ECharts 5.5組み込み)
                nameTruncate: { maxWidth: CSVLayout.truncateMaxWidth(gridH), ellipsis: '…' },
                min: hasYMin ? yMinParsed : undefined,
                max: hasYMax ? yMaxParsed : undefined,
                scale: !hasYMin && !hasYMax,
                axisLabel: { color: T.dim, fontSize: F.label, width: DL.labelWidth, overflow: 'truncate', formatter: yValFmt },
                axisPointer: { show: false },
                axisTick: { lineStyle: { color: T.axis } },
                axisLine: { show: true, lineStyle: { color: T.axis } },
                splitLine: { show: axisOrder === 0, lineStyle: { color: T.grid } },
            });

            dataZooms.push({
                type: 'slider', yAxisIndex: [yAxisIndex],
                start: 0, end: 100,
                right: L.yZoomRight + axisOrder * ZOOM_GAP, top: pct(topPxI),
                height: pct(gridH), width: 9,
                borderColor: 'transparent',
                backgroundColor: 'rgba(255,255,255,0.04)',
                fillerColor: 'rgba(255,255,255,0.1)',
                handleStyle: { color: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.2)' },
                showDetail: false, showDataShadow: false,
                textStyle: { color: 'transparent', fontSize: 0 },
            });
        });
        yAxisIndexByGroup.set(groupId, axisIndexMap);

        const firstSeriesByAxis = new Set();
        grp.series.forEach(s => {
            const yAxisIndex = axisIndexMap.get(s.axisId);
            if (yAxisIndex === undefined) return;
            const axisSpec = axisSpecs.get(s.axisId);
            const isFirstForAxis = !firstSeriesByAxis.has(s.axisId);
            firstSeriesByAxis.add(s.axisId);
            const { yMinParsed, yMaxParsed, hasYMin, hasYMax } = axisSpec;
            const markArea = (isFirstForAxis && (hasYMin || hasYMax)) ? {
                silent: true,
                data: [
                    ...(hasYMax ? [[{ yAxis: yMaxParsed }, { yAxis: yMaxParsed * 100 + 1e9 }]] : []),
                    ...(hasYMin ? [[{ yAxis: -(Math.abs(yMinParsed) * 100 + 1e9) }, { yAxis: yMinParsed }]] : []),
                ],
                itemStyle: { color: 'rgba(255,80,50,0.07)' },
            } : undefined;

            const markLine = (isFirstForAxis && (hasYMin || hasYMax)) ? {
                silent: true,
                symbol: 'none',
                data: [
                    ...(hasYMax ? [{ yAxis: yMaxParsed, lineStyle: { color: 'rgba(255,120,60,0.6)', type: 'dashed', width: 1 }, label: { formatter: `▲ ${yMaxParsed}`, fontSize: F.label - 1, color: 'rgba(255,120,60,0.8)', position: 'insideStartTop' } }] : []),
                    ...(hasYMin ? [{ yAxis: yMinParsed, lineStyle: { color: 'rgba(255,120,60,0.6)', type: 'dashed', width: 1 }, label: { formatter: `▼ ${yMinParsed}`, fontSize: F.label - 1, color: 'rgba(255,120,60,0.8)', position: 'insideStartBottom' } }] : []),
                ],
            } : undefined;

            series.push({
                id:         s.id,
                name:       s.label,
                type:       'line',
                xAxisIndex: i,
                yAxisIndex,
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
                return `<span style="font-family:'Roboto Mono',monospace;font-size:${F.tooltip}px;color:#818cf8;font-weight:600">t = ${tStr} s</span>`;
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
    state.yAxisIndexByGroup = yAxisIndexByGroup;

    // 初回描画時に現在状態をUndo履歴の起点として記録する
    // （復元中は除外。復元はrestoreHistoryEntryが履歴位置を管理している）
    if (appHistory.entries.length === 0 && !_restoringHistory && getMainFile()) {
        seedHistoryBaseline({ start: xStart, end: xEnd });
    }

    // ドラッグマージ判定用にグリッド領域情報を保存
    // ドラッグマージ判定用にグリッド領域情報を保存（累積topで計算）
    let _regionTop = topPx;
    state.gridRegions = order.map((groupId, i) => {
        const h = gridHeights[i];
        const group = groups.get(groupId);
        const chartGroup = getChartGroupById(groupId);
        const region = {
            name: group.mergedNames[0],
            groupId,
            top:    _regionTop,
            height: h,
            axisAreaWidth: groupLayouts[i].left,
            merged: (group.mergedNames?.length ?? 1) > 1,
            label: group.mergedNames.join(' / '),
            axisCount: chartGroup?.axes.length || 1,
        };
        _regionTop += h + gapPx;
        return region;
    });
    updateArrangeOverlay();
}

function removeArrangeOverlay() {
    document.getElementById('chart-arrange-overlay')?.remove();
}

function updateArrangeOverlay() {
    removeArrangeOverlay();
    if (!state.arrangeMode || state.gridRegions.length < 2) return;

    const overlay = document.createElement('div');
    overlay.id = 'chart-arrange-overlay';
    overlay.className = 'chart-arrange-overlay';
    let dragIndex = -1;
    let dropIndex = -1;

    state.gridRegions.forEach((region, index) => {
        const panel = document.createElement('div');
        panel.className = 'chart-arrange-panel';
        panel.draggable = true;
        panel.style.top = `${region.top}px`;
        panel.style.height = `${region.height}px`;
        panel.innerHTML = `<div class="chart-arrange-handle"><i class='bx bx-menu'></i><span>${esc(region.label)}</span></div>`;
        panel.addEventListener('dragstart', e => {
            dragIndex = index;
            panel.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
        });
        panel.addEventListener('dragend', () => {
            panel.classList.remove('dragging');
            overlay.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
        });
        panel.addEventListener('dragover', e => {
            e.preventDefault();
            const rect = panel.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            dropIndex = index + (after ? 1 : 0);
            overlay.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
            panel.classList.add(after ? 'drop-after' : 'drop-before');
        });
        panel.addEventListener('drop', e => {
            e.preventDefault();
            if (dragIndex >= 0 && dropIndex >= 0) {
                moveChartGroup(dragIndex, dropIndex);
                renderChart();
                saveSettings();
            }
        });
        overlay.appendChild(panel);
    });
    dom.chartEl.appendChild(overlay);
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

// renderChartが構築した { groups, order } のスナップショット。
// updatePerGridLabelsはマウス移動のたびに呼ばれるため、そこでgetActiveGroups()を
// 呼び直すと全シリーズ×全ポイントの配列再構築が毎mousemoveで走ってしまう。
// renderChartは状態変更のたびに必ず呼ばれるので、このスナップショットを参照すれば
// キャッシュ無効化ロジックなしで常に描画内容と一致したデータが得られる。
let _lastRenderedGroups = null;

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
    // renderChartが保存したスナップショットのorder（マージ済み）を使うことで
    // グリッドとインデックスが一致し、かつ毎mousemoveの全データ再構築を避けられる
    const { groups: activeGroups, order: activeOrder } =
        _lastRenderedGroups || { groups: new Map(), order: [] };
    const gridLabels = [];

    activeOrder.forEach((ramName, gi) => {
        const grp = activeGroups.get(ramName);
        if (!grp) return;
        const entries = [];

        // グリッド内の全チャンネル（マージ相手含む）について値を取得
        for (const chName of grp.mergedNames) {
            const assignment = grp.channels.find(ch => ch.name === chName);
            const yAxisIndex = state.yAxisIndexByGroup?.get(grp.id)?.get(assignment?.axisId);
            if (yAxisIndex === undefined) continue;
            // Main file
            const mc = mainFile.columns.find(c => c.name === chName);
            if (mc && mainFile.colData[mc.id]) {
                const val = interpolate(mainFile.timeData, mainFile.colData[mc.id], xVal);
                if (!isNaN(val)) {
                    entries.push({ color: mc.color, valStr: fmtVal(val), fileName: mainFile.shortName, val, yAxisIndex });
                }
            }

            // Sub files
            for (const subId of getSubFileIds()) {
                const sf = state.files[subId];
                const sc = resolveColumnForFile(sf, chName);
                if (!sc || !sf.colData[sc.id]) continue;
                const subT = xVal - (sf.offset || 0);
                const val = interpolate(sf.timeData, sf.colData[sc.id], subT);
                if (!isNaN(val)) {
                    entries.push({ color: sc.color, valStr: fmtVal(val), fileName: sf.shortName, val, yAxisIndex });
                }
            }
        }

        if (!entries.length) return;

        // Position: use average y of all entries for this grid
        let yPxSum = 0, yCount = 0;
        for (const e of entries) {
            const yPx = state.chart.convertToPixel({ yAxisIndex: e.yAxisIndex }, e.val);
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
    // フォントスケール設定に連動(要素は再利用されるため毎回上書きする)
    const labelFontPx = CSVLayout.getFontSizes(state.fontScale).tooltip + 'px';
    for (let i = 0; i < _labelEls.length; i++) {
        const el = _labelEls[i];
        if (i < gridLabels.length) {
            const lb = gridLabels[i];
            el.style.display = '';
            el.style.fontSize = labelFontPx;
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

// ── Undo / Redo ──
dom.undoBtn.addEventListener('click', appUndo);
dom.redoBtn.addEventListener('click', appRedo);

// ── チャート縦幅の全体調整 ──

/**
 * 全チャートの基準行高さを倍率で変更する。
 * 自動フィット中は現在の実効行高さを起点にする。
 */
function scaleRowHeight(factor) {
    if (!getMainFile() || state.numGrids === 0) return;
    const base = state.rowHeightPx != null ? state.rowHeightPx : (_lastAutoRow || 120);
    state.rowHeightPx = Math.round(Math.min(Math.max(base * factor, CSVLayout.MIN_GRID_H), 600));
    renderChart();
    saveSettings();
}

dom.rowPlusBtn.addEventListener('click', () => scaleRowHeight(1.25));
dom.rowMinusBtn.addEventListener('click', () => scaleRowHeight(0.8));
dom.rowFitBtn.addEventListener('click', () => {
    // 全画面フィットに戻す（個別の高さ上書きもリセット）
    state.rowHeightPx = null;
    state.gridHeights = {};
    renderChart();
    saveSettings();
});

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
    if (state.arrangeMode) exitArrangeMode();
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
    // dataZoomIndex:0(X軸スライダー)だけを対象にする。
    // xAxisIndex指定はdataZoomアクションのフィルタとして機能せず全dataZoomに波及し、
    // Y軸の値域が時間値と重なるグリッドでY軸ズームが壊れるバグがあった。
    // X軸のinsideズーム(index 1)は同じ軸を共有しているため自動で連動する。
    state.chart.dispatchAction({
        type: 'dataZoom', dataZoomIndex: 0, startValue: sv, endValue: ev,
    });
    state.chart.dispatchAction({ type: 'brush', areas: [] });
    exitBoxZoom();

    // Box Zoom完了後、現在の状態を履歴に記録する（設定不変・ズーム変化のエントリになる）
    recordHistory();
}

function resetZoom() {
    if (!state.chart || state.numGrids === 0) return;
    exitBoxZoom();
    // 全dataZoom(X軸+各Y軸スライダー)を個別に全範囲へ戻す
    const opts = state.chart.getOption();
    if (opts?.dataZoom) {
        opts.dataZoom.forEach((_, idx) =>
            state.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: idx, start: 0, end: 100 })
        );
    }
    // Reset View後もCtrl+Zで直前のズーム状態へ戻れるよう記録する
    recordHistory();
}

// ─────────────────────────────────────────────────────────────
// Undo / Redo（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）
// ズーム・チャンネル選択・マージ・Custom RAMなど全操作を1本の履歴で管理する。
// 履歴の積み方・辿り方の純粋ロジックは history-utils.js (CSVHistory) 側にある。
// ─────────────────────────────────────────────────────────────

// アプリ全体の操作履歴。各エントリは「設定スナップショット+X軸ズーム範囲」
const appHistory = CSVHistory.createHistory(CSVHistory.HISTORY_MAX);
// 復元処理中フラグ。復元が呼ぶsaveSettings→recordHistoryの再記録を防ぐ
let _restoringHistory = false;
// Ctrl+Z連打時に復元処理を1つずつ順番に実行するためのキュー
let _restoreQueue = Promise.resolve();
// 復元時にrenderChartへ渡すズーム指示（renderChartのsavedXZoomに注入される）
let _pendingZoomRestore = null;

/**
 * 現在のX軸ズーム範囲(%)を取得する。チャート未描画時は全範囲を返す。
 */
function getCurrentZoom() {
    const dz = state.chart?.getOption()?.dataZoom?.[0];
    return dz ? { start: dz.start, end: dz.end } : { start: 0, end: 100 };
}

/**
 * 現在の状態を履歴に記録する。saveSettings()から毎回呼ばれる（=全操作が自動記録される）。
 * 起点(seedHistoryBaseline)が積まれる前や復元中は何もしない。
 */
function recordHistory(coalesceKey = null) {
    if (_restoringHistory) return;
    if (!getMainFile()) return;
    if (appHistory.entries.length === 0) return; // 起点未設定（ファイル読込直後に積まれる）
    CSVHistory.push(appHistory,
        CSVHistory.makeEntry(collectSettings(), getCurrentZoom(), Date.now(), coalesceKey));
    updateUndoRedoButtons();
}

/**
 * 現在の状態を履歴の起点として記録する。
 * 起点より前には戻れない（起点だけの状態ではUndo不可）。
 */
function seedHistoryBaseline(zoom) {
    CSVHistory.push(appHistory,
        CSVHistory.makeEntry(collectSettings(), zoom, Date.now(), null));
    updateUndoRedoButtons();
}

/**
 * 履歴を全クリアし、ファイルがあれば現在状態を新しい起点にする。
 * ファイル追加/削除・Time単位変更など「過去に戻れない区切り」で呼ぶ。
 */
function resetHistoryBaseline() {
    CSVHistory.reset(appHistory);
    if (getMainFile()) seedHistoryBaseline(getCurrentZoom());
    updateUndoRedoButtons();
}

/** Undo: 1つ前の状態に戻す */
function appUndo() {
    queueRestore(CSVHistory.canUndo(appHistory) ? CSVHistory.undo(appHistory) : null);
}

/** Redo: 1つ後の状態に進む */
function appRedo() {
    queueRestore(CSVHistory.canRedo(appHistory) ? CSVHistory.redo(appHistory) : null);
}

/**
 * 復元処理をキューに積む。連打しても1件ずつ順番に実行される。
 */
function queueRestore(entry) {
    if (!entry) return;
    updateUndoRedoButtons();
    _restoreQueue = _restoreQueue
        .then(() => restoreHistoryEntry(entry))
        .catch(e => showError('Undo/Redoに失敗しました', e.stack || e.message));
}

/**
 * 履歴エントリの状態を復元する。
 * 設定が現在と同じならズームだけ適用（軽量パス）、違えば設定全体を復元する。
 */
async function restoreHistoryEntry(entry) {
    _restoringHistory = true;
    updateUndoRedoButtons();
    try {
        if (CSVHistory.settingsKey(collectSettings()) !== entry.key) {
            // スナップショットに無いCustom RAMを先に削除する
            // （applyPendingSettingsは「足りないものを追加」しかしないため、
            //   これがないと「Custom RAM追加のUndo」が効かない）
            const keep = new Set((entry.settings.customRAMs || []).map(c => c.name));
            for (const c of [...state.customRAMs]) {
                if (!keep.has(c.name)) removeCustomRAM(c.id);
            }
            // 復元中のすべての再描画が目標ズームで描かれるようrenderChartに注入する
            // （dispatchActionの後追いだと非同期の再描画に上書きされるため）
            _pendingZoomRestore = { ...entry.zoom };
            // entry.settingsはdeep copy済みだが、applySettings側の処理に
            // 履歴エントリを破壊されないようさらにコピーして渡す
            await applySettings(JSON.parse(JSON.stringify(entry.settings)));
        } else {
            dispatchZoom(entry.zoom); // ズームだけ違う → 軽量パス
        }
    } finally {
        // ensureColumnsAndRender等の残処理がsaveSettingsを呼ぶ猶予を1フレーム待ってから解除。
        // 万一その後に記録されても、pushの重複排除(key一致でskipped)が最終防衛線になる
        await new Promise(r => requestAnimationFrame(r));
        _pendingZoomRestore = null;
        _restoringHistory = false;
        updateUndoRedoButtons();
    }
}

/**
 * X軸ズームを全グリッドに適用する。
 */
function dispatchZoom(zoom) {
    if (!state.chart || state.numGrids === 0) return;
    // dataZoomIndex:0(X軸スライダー)のみ対象。insideズームは軸共有で自動連動する
    // (xAxisIndex指定だとY軸ズームまで壊れる。onBrushEndのコメント参照)
    state.chart.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start: zoom.start,
        end: zoom.end,
    });
}

/**
 * Undo/Redoボタンの有効/無効を更新する（復元中は両方無効）。
 */
function updateUndoRedoButtons() {
    if (dom.undoBtn) dom.undoBtn.disabled = _restoringHistory || !CSVHistory.canUndo(appHistory);
    if (dom.redoBtn) dom.redoBtn.disabled = _restoringHistory || !CSVHistory.canRedo(appHistory);
}

// キーボードショートカット（全体）
// - 入力欄にフォーカスがある場合、またはモーダルが開いている場合はすべて無効にする
// - Ctrl+S / Ctrl+Shift+C も入力欄・モーダル中では無効（ブラウザ既定に任せる）
document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    const inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
    const modalOpen = !!document.getElementById('app-modal-overlay');

    // 入力欄・モーダル中はここより下のショートカット全部無効
    // （Custom RAM 式を編集中に Ctrl+S で誤保存、モーダル中に誤操作するのを防ぐ）
    if (inInput || modalOpen) return;

    // Ctrl+S: PNG保存（チャートが保存可能なときだけブラウザの「ページ保存」を上書き）
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        if (!dom.exportPng.disabled) {
            e.preventDefault();
            exportChartAsPNG();
        }
        return;
    }
    // Ctrl+Shift+C: クリップボードコピー（保存可能なときだけ preventDefault）
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'C' || e.key === 'c')) {
        if (!dom.copyChart.disabled) {
            e.preventDefault();
            copyChartToClipboard();
        }
        return;
    }

    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: 操作全体のUndo/Redo（ズーム含む統合履歴）
    if (e.ctrlKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        // Shift押下時はe.keyが'Z'になる。Ctrl+Shift+Z=Redo（一般的なエイリアス）
        if (e.shiftKey) appRedo(); else appUndo();
        return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        appRedo();
        return;
    }

    // ? : ショートカット一覧モーダル（Shift+/ で発火）
    if (e.key === '?') {
        e.preventDefault();
        showShortcutsModal();
        return;
    }

    // Esc: モード離脱
    if (e.key === 'Escape') {
        if (state.brushMode) { exitBoxZoom(); return; }
        if (state.shiftMode) { exitShiftMode(); return; }
        if (state.arrangeMode) { exitArrangeMode(); return; }
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
 * 既存の `showCustomRAMHelp()` と同じ overlay ID（app-modal-overlay）を使うことで、
 * どのモーダルも同時には1つしか開かない設計にしている。
 */
function showShortcutsModal() {
    const rows = [
        ['?',              'このショートカット一覧を表示'],
        ['Esc',            'Box Zoom / Time Shift / Arrange モードを抜ける'],
        ['B',              'Box Zoom モードを切り替え'],
        ['T',              'Time Shift モードを切り替え（Sub ファイルが必要）'],
        ['R',              'ズームをリセット（全範囲表示）'],
        ['Ctrl + Z',       '直前の操作を元に戻す（ズーム・チャンネル選択・設定など）'],
        ['Ctrl + Y',       '操作をやり直す'],
        ['Ctrl + Shift + Z', '操作をやり直す（Ctrl + Y と同じ）'],
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
    let overlay = document.getElementById('app-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'app-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.setAttribute('aria-labelledby', 'shortcuts-modal-title');
    modal.style.cssText = 'background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:20px 24px;max-width:480px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;';
    modal.innerHTML = html
        + `<div style="text-align:right;margin-top:12px;"><button onclick="this.closest('#app-modal-overlay').remove()" `
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
dom.encoding?.addEventListener('change', saveSettings);
// チャートのフォントサイズ段階(小/標準/大/特大)
dom.fontScale?.addEventListener('change', () => {
    state.fontScale = dom.fontScale.value;
    renderChart();
    saveSettings();
});

if (dom.shiftBtn) dom.shiftBtn.addEventListener('click', toggleShiftMode);
if (dom.arrangeBtn) dom.arrangeBtn.addEventListener('click', toggleArrangeMode);

function toggleShiftMode() { state.shiftMode ? exitShiftMode() : enterShiftMode(); }

function enterShiftMode() {
    if (!getSubFileIds().length) return;
    if (state.brushMode) exitBoxZoom();
    if (state.arrangeMode) exitArrangeMode();

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

function toggleArrangeMode() {
    state.arrangeMode ? exitArrangeMode() : enterArrangeMode();
}

function enterArrangeMode() {
    if (state.chartGroups.length < 2) return;
    if (state.brushMode) exitBoxZoom();
    if (state.shiftMode) exitShiftMode();
    state.arrangeMode = true;
    dom.arrangeBtn.classList.add('btn-active');
    dom.arrangeBtn.innerHTML = `<i class='bx bx-x'></i> Exit Arrange`;
    dom.hintEl.textContent = 'Drag chart panels up or down to reorder';
    renderChart();
}

function exitArrangeMode() {
    state.arrangeMode = false;
    dom.arrangeBtn.classList.remove('btn-active');
    dom.arrangeBtn.innerHTML = `<i class='bx bx-sort-alt-2'></i> Arrange`;
    dom.hintEl.textContent = '';
    removeArrangeOverlay();
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
const PRESETS_STORAGE_KEY = 'csvViewer_presets';

function serializeChartGroups() {
    return state.chartGroups.map(group => ({
        id: group.id,
        channels: group.channels.map(ch => ({ name: ch.name, axisId: ch.axisId })),
        axes: group.axes.map(axis => ({ id: axis.id, unit: axis.unit || '', representative: axis.representative })),
    }));
}

function serializeTimeUnitOverrides() {
    const overrides = {};
    for (const file of Object.values(state.files)) {
        if (file.headerInfo?.timeScaleSource === 'manual') {
            overrides[file.name] = file.headerInfo.timeScaleUnit === 'ms' ? 'ms' : 's';
        }
    }
    return overrides;
}

// 保存失敗トーストの多重表示防止フラグ（成功したらリセットする）
let _storageWarnShown = false;
// saveSettingsのdebounce用タイマーID（nullなら保留中の保存なし）
let _saveSettingsTimer = null;

/**
 * 設定保存を予約する（500msのdebounce）。
 * 約18箇所から呼ばれるため、連続操作のたびにJSON.stringifyを即時実行しないようまとめる。
 * 実際の書き込みは saveSettingsNow が行う。
 * @param {string|null} coalesceKey Undo履歴の連続操作統合キー（カラーピッカー等の
 *   連続発火する操作で指定すると、短時間の連続変更が1つの履歴エントリにまとまる）
 */
function saveSettings(coalesceKey = null) {
    // Undo履歴への記録はdebounceせず同期で行う
    // （debounce後だと「操作直後のCtrl+Z」で最後の操作が履歴に無い事故が起きる）
    recordHistory(coalesceKey);
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(flushSettingsSave, 500);
}

/**
 * 保留中の保存があれば即時実行する（ページ離脱時の保存漏れ防止）。
 */
function flushSettingsSave() {
    if (_saveSettingsTimer === null) return; // 保留なし
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = null;
    saveSettingsNow();
}

// beforeunload単独ではタブ切替やモバイルのプロセス破棄で発火しないため、
// pagehide + visibilitychange の両方でflushする
window.addEventListener('pagehide', flushSettingsSave);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSettingsSave();
});

/**
 * 現在の設定を1つのオブジェクトにまとめる。
 * localStorage保存(saveSettingsNow)とUndo履歴のスナップショットの両方で使う
 * 単一情報源。ここがずれると「Undoで戻した状態」と「リロードで復元される状態」が
 * 食い違うため、設定項目の追加は必ずこの関数に対して行うこと。
 * 注意: channelAliases / yRanges / fileColors は生の参照を返す。
 * 履歴に保存する場合は呼び出し側(CSVHistory.makeEntry)がdeep copyする。
 */
function collectSettings() {
    const sidebar = document.querySelector('.sidebar');
    return {
        _version: 3,
        // ファイル情報（名前・ロール・オフセットだけ。データ本体は含めない）
        fileInfos: Object.values(state.files).map(f => ({
            name: f.name,
            role: f.role,
            offset: f.offset,
            timeUnitOverride: f.headerInfo?.timeScaleSource === 'manual'
                ? (f.headerInfo.timeScaleUnit === 'ms' ? 'ms' : 's')
                : null,
        })),
        // 選択中のチャンネル名
        selectedNames: [...state.selectedNames],
        // Custom RAM式
        customRAMs: state.customRAMs.map(c => ({ name: c.name, unit: c.unit || '', expr: c.expr })),
        chartGroups: serializeChartGroups(),
        timeUnitOverrides: serializeTimeUnitOverrides(),
        channelAliases: state.channelAliases,
        // Bit手動Offリスト
        bitManualOff: [..._bitManualOff],
        // パース設定
        nameRowIdx: dom.nameRow.value,
        unitRowIdx: dom.unitRow.value,
        encodingMode: dom.encoding?.value || 'auto',
        // サンプリングモード
        samplingMode: dom.sampling.value,
        // チャートの表示設定（見た目のみ。Undo履歴の比較からは除外される）
        fontScale: state.fontScale,
        rowHeightPx: state.rowHeightPx,
        gridHeights: state.gridHeights,
        // サイドバー幅
        sidebarWidth: sidebar ? sidebar.offsetWidth : null,
        // Y軸範囲のユーザー設定
        yRanges: state.yRanges,
        // 単色モード設定
        monoColorMode: state.monoColorMode,
        fileColors: state.fileColors,
    };
}

/**
 * 現在の設定をlocalStorageに保存する。
 * ファイルデータ本体は保存しない（名前・role・offsetだけ）。
 */
function saveSettingsNow() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectSettings()));
        _storageWarnShown = false; // 保存に成功したら次回失敗時に再度通知できるようにする
    } catch (e) {
        console.warn('[CSV Viewer] Failed to save settings:', e);
        // 容量超過などで保存できない場合、ユーザーが「保存されているつもり」のまま
        // 設定を失わないようトーストで通知する（連続保存でスパムにならないよう1回だけ）
        if (!_storageWarnShown) {
            _storageWarnShown = true;
            showWarning('設定を保存できませんでした',
                'ブラウザの保存領域(localStorage)に書き込めません。容量超過の可能性があります。\n' + (e.message || String(e)));
        }
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
        _version: 3,
        fileInfos: Object.values(state.files).map(f => ({
            name: f.name,
            role: f.role,
            offset: f.offset,
            timeUnitOverride: f.headerInfo?.timeScaleSource === 'manual'
                ? (f.headerInfo.timeScaleUnit === 'ms' ? 'ms' : 's')
                : null,
        })),
        selectedNames: [...state.selectedNames],
        customRAMs: state.customRAMs.map(c => ({ name: c.name, unit: c.unit || '', expr: c.expr })),
        chartGroups: serializeChartGroups(),
        timeUnitOverrides: serializeTimeUnitOverrides(),
        channelAliases: state.channelAliases,
        bitManualOff: [..._bitManualOff],
        nameRowIdx: dom.nameRow.value,
        unitRowIdx: dom.unitRow.value,
        encodingMode: dom.encoding?.value || 'auto',
        samplingMode: dom.sampling.value,
        sidebarWidth: sidebar ? sidebar.offsetWidth : null,
        yRanges: state.yRanges,
    };
}

function buildPresetSettings() {
    return {
        _format: 'CSV Viewer Preset',
        _version: 3,
        selectedNames: [...state.selectedNames],
        customRAMs: state.customRAMs.map(c => ({ name: c.name, unit: c.unit || '', expr: c.expr })),
        chartGroups: serializeChartGroups(),
        timeUnitOverrides: serializeTimeUnitOverrides(),
        channelAliases: state.channelAliases,
        bitManualOff: [..._bitManualOff],
        nameRowIdx: dom.nameRow.value,
        unitRowIdx: dom.unitRow.value,
        encodingMode: dom.encoding?.value || 'auto',
        samplingMode: dom.sampling.value,
        yRanges: state.yRanges,
        monoColorMode: state.monoColorMode,
        fileColors: state.fileColors,
    };
}

function loadPresets() {
    try {
        const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        console.warn('[CSV Viewer] Failed to load presets:', e);
        return {};
    }
}

function savePresets(presets) {
    try {
        localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch (e) {
        // 容量超過時に例外がそのまま飛ぶと「Unhandled error」トーストになり原因が分かりにくい
        showError('プリセットを保存できませんでした',
            'ブラウザの保存領域(localStorage)に書き込めません。容量超過の可能性があります。\n' + (e.message || String(e)));
    }
}

function renderPresetSelect() {
    if (!dom.presetSelect) return;
    const presets = loadPresets();
    const selected = dom.presetSelect.value;
    dom.presetSelect.innerHTML = '<option value="">Preset...</option>';
    Object.keys(presets).sort((a, b) => a.localeCompare(b, 'ja')).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        dom.presetSelect.appendChild(opt);
    });
    if (selected && presets[selected]) dom.presetSelect.value = selected;
}

function saveCurrentPreset() {
    const name = prompt('保存するプリセット名を入力してください', dom.presetSelect?.value || '');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const presets = loadPresets();
    presets[trimmed] = buildPresetSettings();
    savePresets(presets);
    renderPresetSelect();
    if (dom.presetSelect) dom.presetSelect.value = trimmed;
    showExportToast('プリセットを保存しました', trimmed);
}

function loadSelectedPreset() {
    const name = dom.presetSelect?.value;
    if (!name) {
        showWarning('プリセットが選択されていません');
        return;
    }
    const presets = loadPresets();
    if (!presets[name]) {
        showWarning('プリセットが見つかりません', name);
        renderPresetSelect();
        return;
    }
    applySettings(presets[name]);
    showExportToast('プリセットを適用しました', name);
}

function deleteSelectedPreset() {
    const name = dom.presetSelect?.value;
    if (!name) {
        showWarning('削除するプリセットが選択されていません');
        return;
    }
    const presets = loadPresets();
    delete presets[name];
    savePresets(presets);
    renderPresetSelect();
    showExportToast('プリセットを削除しました', name);
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
function applySettings(rawSettings) {
    // バージョンチェック+マイグレーション(settings-utils.js)。
    // 起動時復元・インポート・プリセット適用の全経路がここを通るので、検証はこの1箇所で済む
    const result = CSVSettings.migrateSettings(rawSettings);
    if (!result.ok) {
        if (result.reason === 'newer') {
            showWarning('設定データが新しいバージョンの形式のため読み込みをスキップしました');
        }
        return;
    }
    const s = result.settings;

    // パース設定を復元
    if (s.nameRowIdx) dom.nameRow.value = s.nameRowIdx;
    if (s.unitRowIdx) dom.unitRow.value = s.unitRowIdx;
    if (s.encodingMode && dom.encoding) dom.encoding.value = s.encodingMode;

    // サンプリングモードを復元
    if (s.samplingMode !== undefined) dom.sampling.value = s.samplingMode;

    // チャート表示設定を復元
    if (s.fontScale && CSVLayout.FONT_PRESETS[s.fontScale]) {
        state.fontScale = s.fontScale;
        if (dom.fontScale) dom.fontScale.value = s.fontScale;
    }
    if (s.rowHeightPx !== undefined) state.rowHeightPx = s.rowHeightPx;
    if (s.gridHeights) state.gridHeights = { ...s.gridHeights };

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
    if (s.channelAliases) state.channelAliases = { ...s.channelAliases };

    // 単色モード設定を復元
    if (s.monoColorMode !== undefined) {
        state.monoColorMode = s.monoColorMode;
        dom.monoColorBtn.classList.toggle('btn-active', state.monoColorMode);
    }
    if (s.fileColors) state.fileColors = s.fileColors;

    // ファイルがまだ読み込まれていない場合は、残りの設定を保留する
    _pendingSettings = s;

    if (getMainFile()) {
        // 適用完了を待てるようPromiseを返す（Undo/Redoの直列化で使用）
        return applyPendingSettings().then(updateUI)
            .catch(e => showError('保存済み設定の適用に失敗しました', e.stack || e.message));
    }
    // ファイル読込前の状態を表示
    showPendingFiles(s.fileInfos || []);
    return Promise.resolve();
}

/**
 * ファイルが新たに読み込まれたとき、保留中の設定を適用する。
 * parseCSV完了後（updateUI前）に呼ばれる。
 */
function restoreChartGroupsFromSettings(s, mainFile) {
    const available = new Set(mainFile.columns.map(c => c.name));
    state.chartGroups = [];

    if (Array.isArray(s.chartGroups) && s.chartGroups.length) {
        for (const savedGroup of s.chartGroups) {
            const savedChannels = (savedGroup.channels || []).filter(ch => available.has(ch.name));
            if (!savedChannels.length) continue;
            const axisIdMap = new Map();
            const axes = [];
            for (const savedAxis of savedGroup.axes || []) {
                const assigned = savedChannels.filter(ch => ch.axisId === savedAxis.id);
                if (!assigned.length) continue;
                const axis = createChartAxis(
                    available.has(savedAxis.representative) ? savedAxis.representative : assigned[0].name,
                    savedAxis.unit || ''
                );
                axisIdMap.set(savedAxis.id, axis.id);
                axes.push(axis);
            }
            const fallbackAxis = axes[0] || createChartAxis(savedChannels[0].name, getMainColumn(savedChannels[0].name)?.unit || '');
            if (!axes.length) axes.push(fallbackAxis);
            state.chartGroups.push({
                id: nextChartGroupId(),
                axes,
                channels: savedChannels.map(ch => ({ name: ch.name, axisId: axisIdMap.get(ch.axisId) || fallbackAxis.id })),
            });
        }
        syncChartGroupsWithSelection();
        return;
    }

    const mergedPartner = new Map();
    for (const pair of s.mergedGroups || []) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        mergedPartner.set(pair[0], pair[1]);
        mergedPartner.set(pair[1], pair[0]);
    }
    const handled = new Set();
    for (const name of state.selectedNames) {
        if (handled.has(name) || !available.has(name)) continue;
        const partner = mergedPartner.get(name);
        if (partner && state.selectedNames.has(partner) && available.has(partner)) {
            const axis = createChartAxis(name, getMainColumn(name)?.unit || '');
            state.chartGroups.push({
                id: nextChartGroupId(),
                axes: [axis],
                channels: [{ name, axisId: axis.id }, { name: partner, axisId: axis.id }],
            });
            handled.add(partner);
        } else {
            addStandaloneChart(name);
        }
        handled.add(name);
    }
}

async function applyPendingSettings() {
    const s = _pendingSettings;
    if (!s) return;

    const mainFile = getMainFile();
    if (!mainFile) return;

    let timeScaleChanged = false;

    // オフセットと手動Time単位を復元（ファイル名で照合）
    if (s.fileInfos) {
        for (const [fid, f] of Object.entries(state.files)) {
            const saved = s.fileInfos.find(fi => fi.name === f.name);
            if (saved && saved.offset !== undefined) {
                f.offset = saved.offset;
            }
            const override = saved?.timeUnitOverride || s.timeUnitOverrides?.[f.name];
            if (override === 's' || override === 'ms') {
                timeScaleChanged = applyTimeScale(
                    f,
                    override === 'ms' ? 0.001 : 1,
                    'manual',
                    override,
                    'user override'
                ) || timeScaleChanged;
            }
        }
    } else if (s.timeUnitOverrides) {
        for (const f of Object.values(state.files)) {
            const override = s.timeUnitOverrides[f.name];
            if (override !== 's' && override !== 'ms') continue;
            timeScaleChanged = applyTimeScale(
                f,
                override === 'ms' ? 0.001 : 1,
                'manual',
                override,
                'user override'
            ) || timeScaleChanged;
        }
    }

    // チャンネル別名対応を復元（Mainに存在するチャンネルだけ有効化）
    if (s.channelAliases) {
        state.channelAliases = { ...s.channelAliases };
        pruneChannelAliasesForMain(mainFile);
    }

    // Bit手動Off設定を復元
    if (s.bitManualOff) {
        _bitManualOff.clear();
        for (const name of s.bitManualOff) _bitManualOff.add(name);
    }

    // Custom RAMを復元（まだ追加されていないもののみ）
    if (s.customRAMs && s.customRAMs.length) {
        const existingNames = new Set(state.customRAMs.map(c => c.name));
        for (const { name, unit = '', expr } of s.customRAMs) {
            if (!existingNames.has(name)) {
                await addCustomRAM(name, expr, unit);
                existingNames.add(name);
            }
        }
    }
    if (timeScaleChanged && state.customRAMs.length) await recomputeCustomRAMs();

    // 選択チャンネルを復元
    state.selectedNames = new Set();
    if (s.selectedNames && s.selectedNames.length) {
        const available = new Set(mainFile.columns.map(c => c.name));
        for (const name of s.selectedNames) {
            if (available.has(name)) state.selectedNames.add(name);
        }
    }
    restoreChartGroupsFromSettings(s, mainFile);

    if (timeScaleChanged) {
        // 時間軸スケールが変わったのでUndo履歴をクリアして起点を取り直す
        resetHistoryBaseline();
        updateParsePreview(Object.values(state.files).at(-1));
        renderFileList();
        renderColumnList();
        renderChart();
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
dom.presetSave?.addEventListener('click', saveCurrentPreset);
dom.presetLoad?.addEventListener('click', loadSelectedPreset);
dom.presetDelete?.addEventListener('click', deleteSelectedPreset);
renderPresetSelect();

// 起動時にlocalStorageから設定を復元
const _savedSettings = loadSettings();
if (_savedSettings) {
    applySettings(_savedSettings);
}
