'use strict';

// M9: 全体をIIFEで包み、app.js内部の関数・変数（数百個）をグローバルスコープへ
// 漏らさない。function宣言のhoistingはIIFEスコープ内でそのまま維持される。
// テスト（Playwrightスモーク）とコンソールデバッグに必要な最小限だけを
// ファイル末尾の window.__csvViewerDebug で明示的に公開する。
// （本文のインデントは差分を最小にするため意図的に変えていない）
(function () {

// ─────────────────────────────────────────────────────────────
// Error notification system
// ─────────────────────────────────────────────────────────────

const _errorLog = []; // { time, message, detail }

// トーストの種類ごとの見た目定義（色・細部だけが違い、構造は共通）
const TOAST_KINDS = {
    error:   { bg: '#2d1216', border: '#f43f5e', text: '#fda4af', title: '#fb7185', detail: '#f9a8b8', titlePrefix: '⚠ ', titleMargin: 4, detailScroll: true, timestamp: true, alert: true },
    warning: { bg: '#2a1f0c', border: '#f59e0b', text: '#fcd34d', title: '#fbbf24', detail: '#fde68a', titlePrefix: '',   titleMargin: 4, detailScroll: true },
    success: { bg: '#122d1b', border: '#22c55e', text: '#86efac', title: '#4ade80', detail: '#86efac', titlePrefix: '',   titleMargin: 2, detailScroll: false },
};

// 同時に表示するトーストの上限。超えたら最古のものから消す
const TOAST_MAX_VISIBLE = 5;

// トーストの自動消去までの時間(ms)。エラーは読む時間を長めに確保する
const TOAST_TTL_ERROR   = 15000;
const TOAST_TTL_WARNING = 9000;
const TOAST_TTL_SUCCESS = 3000;

/**
 * トースト通知の共通実装。showError / showWarning / showExportToast の本体。
 * @param {'error'|'warning'|'success'} kind  種類（色・細部の見た目を決める）
 * @param {string} message  タイトル行
 * @param {string} [detail] 詳細行（省略可）
 * @param {number} ttl      自動消去までのミリ秒
 */
function showToast(kind, message, detail, ttl) {
    const k = TOAST_KINDS[kind] || TOAST_KINDS.error;

    let container = document.getElementById('error-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'error-toast-container';
        // スクリーンリーダーに新着トーストを読み上げさせる（エラーは各トースト側の role="alert" で即時通知）
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        container.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:480px;';
        document.body.appendChild(container);
    }

    // 表示上限: 不正ファイルの一括ドロップ等で画面が埋まらないようにする
    while (container.children.length >= TOAST_MAX_VISIBLE) {
        container.firstElementChild.remove();
    }

    const toast = document.createElement('div');
    // スライドインはCSSクラス側で prefers-reduced-motion をガード（styles.css参照）
    toast.className = 'toast-slide-in';
    toast.style.cssText = `background:${k.bg};border:1px solid ${k.border};border-radius:8px;padding:12px 16px;color:${k.text};font-size:13px;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);cursor:pointer;`;
    // エラーは assertive 相当で即時読み上げ
    if (k.alert) toast.setAttribute('role', 'alert');

    let html = `<div style="font-weight:600;margin-bottom:${k.titleMargin}px;color:${k.title};">${k.titlePrefix}${esc(message)}</div>`;
    if (detail) {
        const detailExtra = k.detailScroll ? 'word-break:break-all;max-height:80px;overflow:auto;' : '';
        html += `<div style="font-size:11px;color:${k.detail};opacity:0.85;${detailExtra}">${esc(String(detail))}</div>`;
    }
    if (k.timestamp) {
        html += `<div style="font-size:10px;color:#888;margin-top:4px;">${new Date().toLocaleTimeString()} — click to dismiss</div>`;
    }
    toast.innerHTML = html;
    toast.addEventListener('click', () => toast.remove());
    container.appendChild(toast);

    setTimeout(() => { if (toast.parentNode) toast.remove(); }, ttl);
}

function showError(message, detail) {
    const entry = { time: new Date().toLocaleTimeString(), message, detail: detail || '' };
    _errorLog.push(entry);
    console.error(`[CSV Viewer] ${message}`, detail || '');
    showToast('error', message, detail, TOAST_TTL_ERROR);
}

function showWarning(message, detail) {
    console.warn(`[CSV Viewer] ${message}`, detail || '');
    showToast('warning', message, detail, TOAST_TTL_WARNING);
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

/**
 * モーダル共通の生成ヘルパー（M2: モーダル生成の共通化）。
 * overlay(#app-modal-overlay) + モーダル本体(.app-modal)を生成して body に追加し、
 * setupModalA11y（role/フォーカストラップ/Esc/フォーカス復帰）を仕込む。
 * overlay の ID を全モーダルで共有することで、同時に開くモーダルは常に1つになる
 * （既存モーダルが開いていれば先に閉じる）。
 *
 * @param {string} contentHtml  モーダル本体の innerHTML。後から流し込む場合は '' でよい
 * @param {object} opts
 *   - modalClass: '.app-modal' に追加するクラス（幅などの個別調整用）
 *   - labelledBy: aria-labelledby に設定するタイトル要素の ID
 *   - closeOnOverlayClick: overlay の余白クリックで閉じるか（既定 true）。
 *     閉じる前に独自処理（Promise の resolve 等）が必要なモーダルは
 *     false を渡して自前でリスナーを登録すること
 * @returns {{overlay: HTMLElement, modal: HTMLElement, close: Function}}
 *   close は overlay を DOM から外すだけ。リスナー解除とフォーカス復帰は
 *   setupModalA11y 内の MutationObserver が overlay の除去を検知して行う
 */
function createModal(contentHtml, opts = {}) {
    document.getElementById('app-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'app-modal-overlay';
    overlay.className = 'app-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'app-modal' + (opts.modalClass ? ' ' + opts.modalClass : '');
    if (opts.labelledBy) modal.setAttribute('aria-labelledby', opts.labelledBy);
    modal.innerHTML = contentHtml;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setupModalA11y(overlay, modal);

    const close = () => overlay.remove();
    if (opts.closeOnOverlayClick !== false) {
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    }
    return { overlay, modal, close };
}

// Debug / Custom RAMヘルプ / ショートカットの3モーダル共通の「閉じる」フッター。
// インライン onclick は CSP 対応のため使わない（S3）。
// createModal 呼び出し後に .modal-close-btn へ close をバインドすること
const MODAL_CLOSE_FOOTER =
    '<div style="text-align:right;margin-top:12px;"><button class="modal-close-btn" '
    + 'style="background:#6366f1;color:#fff;border:none;border-radius:6px;padding:6px 18px;cursor:pointer;font-size:13px;">閉じる</button></div>';

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
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

// 関数名 → 必要な引数の個数（args定義から導出。式検証のarityチェックに使う）
const _builtinFuncArity = new Map(
    CUSTOM_RAM_FUNCTIONS.map(f => [f.name, f.args.split(',').length])
);

// 式のネスト深度の上限。再帰下降パーサなので、異常に深い式
// （"((((...))))" 等）でスタックオーバーフローする前にエラーで打ち切る
const EXPR_MAX_DEPTH = 200;

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
        // 比較・論理演算子（2文字を1文字より先に判定する）
        const two = expr.slice(i, i + 2);
        if (two === '>=' || two === '<=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
            tokens.push({ type: 'op', value: two }); i += 2; continue;
        }
        if (ch === '>' || ch === '<') { tokens.push({ type: 'op', value: ch }); i++; continue; }
        // 単独の = ! & | は文法に無い（==等の打ち間違い）。無限ループしないよう
        // 消費だけして op として積む（どの文法規則にも一致せず無視される）
        if ('=!&|'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }
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
        while (i < expr.length && !/[\s+\-*/()^,<>=!&|]/.test(expr[i])) name += expr[i++];
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
    let depth = 0; // 再帰の深さ（EXPR_MAX_DEPTH超過でエラー）

    function peek() { return pos < tokens.length ? tokens[pos] : null; }
    function next() { return tokens[pos++]; }

    // expr = logicalOr（優先順位: || < && < 比較 < 加減 < 乗除 < べき乗 < 単項）
    function parseExpr() {
        return parseLogicalOr();
    }

    // logicalOr = logicalAnd ('||' logicalAnd)*
    function parseLogicalOr() {
        let left = parseLogicalAnd();
        while (peek() && peek().value === '||') {
            next();
            left = { type: 'binop', op: '||', left, right: parseLogicalAnd() };
        }
        return left;
    }

    // logicalAnd = comparison ('&&' comparison)*
    function parseLogicalAnd() {
        let left = parseComparison();
        while (peek() && peek().value === '&&') {
            next();
            left = { type: 'binop', op: '&&', left, right: parseComparison() };
        }
        return left;
    }

    // comparison = additive (cmpOp additive)?  （a<b<c のような連鎖は許可しない）
    const CMP_OPS = new Set(['>', '<', '>=', '<=', '==', '!=']);
    function parseComparison() {
        let left = parseAdditive();
        if (peek() && CMP_OPS.has(peek().value)) {
            const op = next().value;
            left = { type: 'binop', op, left, right: parseAdditive() };
        }
        return left;
    }

    // additive = term (('+' | '-') term)*
    function parseAdditive() {
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
    // ネストの再帰（括弧・単項演算子・関数引数）はすべてここを通るため、
    // 深度ガードはこの1箇所に置く（try/finallyで兄弟要素間の誤累積を防ぐ）
    function parseFactor() {
        if (++depth > EXPR_MAX_DEPTH) {
            throw new Error(`式のネストが深すぎます（上限${EXPR_MAX_DEPTH}）`);
        }
        try {
            return parseFactorInner();
        } finally {
            depth--;
        }
    }

    function parseFactorInner() {
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

    // 二項演算を要素ごとに適用。
    // 比較・論理演算の結果は 1（真）/ 0（偽）。どちらかの入力が NaN の点は
    // NaN のまま伝播させる（欠損を「偽」と混同させない。イベント検出側は
    // NaN を偽として扱う）
    function binop(op, a, b) {
        const out = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const x = a[i], y = b[i];
            switch (op) {
                case '+': out[i] = x + y; break;
                case '-': out[i] = x - y; break;
                case '*': out[i] = x * y; break;
                case '/': out[i] = x / y; break;
                case '^': out[i] = Math.pow(x, y); break;
                case '>':  out[i] = (x !== x || y !== y) ? NaN : (x >   y ? 1 : 0); break;
                case '<':  out[i] = (x !== x || y !== y) ? NaN : (x <   y ? 1 : 0); break;
                case '>=': out[i] = (x !== x || y !== y) ? NaN : (x >=  y ? 1 : 0); break;
                case '<=': out[i] = (x !== x || y !== y) ? NaN : (x <=  y ? 1 : 0); break;
                case '==': out[i] = (x !== x || y !== y) ? NaN : (x === y ? 1 : 0); break;
                case '!=': out[i] = (x !== x || y !== y) ? NaN : (x !== y ? 1 : 0); break;
                case '&&': out[i] = (x !== x || y !== y) ? NaN : ((x !== 0 && y !== 0) ? 1 : 0); break;
                case '||': out[i] = (x !== x || y !== y) ? NaN : ((x !== 0 || y !== 0) ? 1 : 0); break;
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
        // 引数不足の関数呼び出し（mavg(X) 等）で argNodes[1] が undefined のまま
        // 渡ってきてもTypeErrorにせずNaN列に落とす（arity検証はUI側で行う）
        if (!node) return fillConst(NaN);
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
        // 関数名は大文字小文字を区別しない（Integral も integral も同じ）。
        // 登録名はすべて小文字なので、照合前に小文字化しておく。
        switch (String(name).toLowerCase()) {
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
                // 累積値は専用変数 acc で持ち回す。out[i] に直接 out[i-1] を
                // 足し込むと、x に1点でも NaN（クロスファイル参照の範囲外など）が
                // 混じった瞬間に out[i] 以降がすべて NaN に伝播し、
                // 線が丸ごと消えてしまうため。
                let acc = 0;
                // 最初のサンプルが欠損ならまだ積分を開始できないので NaN。
                out[0] = isNaN(x[0]) ? NaN : 0;
                for (let i = 1; i < len; i++) {
                    const dt = timeData[i] - timeData[i - 1];
                    if (!isNaN(x[i - 1]) && !isNaN(x[i])) {
                        // 台形法: (前の値 + 現在の値) / 2 × 時間差
                        acc += (x[i - 1] + x[i]) / 2 * dt;
                        out[i] = acc;
                    } else {
                        // 欠損区間は積分できない。その点だけ NaN にして描画から外し、
                        // 累積 acc は据え置く。有効な値が戻れば続きから積分を再開する。
                        out[i] = NaN;
                    }
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

/**
 * styles.css の :root で定義されたCSS変数を読み取る（未定義・空なら fallback）。
 * EChartsはCSS変数を解釈しないため、チャートへ渡す色は起動時にここで実値へ解決する。
 */
function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

// チャート用テーマ色。styles.css の :root トークンを単一情報源とし、
// 起動時とテーマ切替時（applyTheme → refreshThemeColors）に再解決する。
// canvas描画（ECharts）はCSS変数を解釈できないため、ここで実値へ変換して渡す
const T = {};
function refreshThemeColors() {
    Object.assign(T, {
        text:      cssVar('--text-primary',    '#f0f0f0'),
        dim:       cssVar('--text-secondary',  '#a0a5b1'),
        border:    cssVar('--border',          'rgba(255,255,255,0.08)'),
        accent:    cssVar('--accent',          '#6366f1'),
        bgMain:    cssVar('--bg-main',         '#0f1115'),  // PNGエクスポートの背景色
        grid:      cssVar('--chart-grid',      'rgba(255,255,255,0.05)'),
        axis:      cssVar('--chart-axis',      'rgba(255,255,255,0.15)'),
        crosshair: cssVar('--chart-crosshair', 'rgba(255,255,255,0.35)'),
        tooltipBg:     cssVar('--tooltip-bg',     'rgba(12,14,20,0.6)'),
        tooltipBorder: cssVar('--tooltip-border', 'rgba(255,255,255,0.12)'),
    });
}
refreshThemeColors();

/**
 * カラーテーマ（'dark'|'light'）を適用する。
 * <html data-theme> の付け替え → CSSトークン切替 → チャート色の再解決 → 再描画。
 * 永続化（saveSettings）は呼び出し側で行う（起動時の復元で二重保存しないため）。
 */
function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    if (state.theme === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    refreshThemeColors();
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.className = state.theme === 'light' ? 'bx bx-moon' : 'bx bx-sun';
        btn.title = state.theme === 'light' ? 'ダークテーマに切替' : 'ライトテーマに切替';
    }
    if (state.chart) renderChart();
}

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
// チューニング用定数（挙動を調整するときはここを変える）
// ─────────────────────────────────────────────────────────────

// チャート描画（renderChart）系の定数は chart-options-utils.js の
// CSVChartOptions.CONSTANTS が単一情報源（BIT_WEIGHT / ZOOM_GAP /
// NARROW_PLOT_WARN_PX / SERIES_PROGRESSIVE(_THRESHOLD) / MARKER_SYMBOL_SIZE /
// MARK_AREA_FAR_SCALE / MARK_AREA_FAR_OFFSET）。値を変えるときはそちらを編集する。
// Custom RAM式サジェストの最大表示件数
const SUGGEST_MAX_ITEMS = 15;
// 設定保存(saveSettings)のdebounce時間(ms)
const SAVE_DEBOUNCE_MS = 500;
// Custom RAM式ライブ検証のdebounce時間(ms)（追加フォーム・編集モーダル共通）
const VALIDATE_DEBOUNCE_MS = 300;
// チャンネル検索のdebounce時間(ms)
const SEARCH_DEBOUNCE_MS = 150;

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
    measureMode:    false,               // カーソル計測モード（M）
    measure:        { tA: null, tB: null }, // 計測カーソル位置(秒)。永続化しない
    events:         { expr: '', intervals: [] }, // イベント検出結果（区間はメインファイル基準。永続化しない）
    statsPanelVisible: false, // 表示範囲の統計サマリパネル（Stats）を表示中か
    shiftFileId:    null,   // which sub file is the drag target
    shiftDrag:      null,   // { startClientX, startOffset }
    numGrids:       0,
    customRAMs:     [],     // [{ name, unit, expr, id }]
    customModes:    [],     // ユーザー定義の走行モード [{ id, name, trace:{time:[],speed:[]}, phases:[{name,start,end}] }]（時間-車速の手入力。MDC等）
    chartGroups:    [],     // [{ id, channels:[{name,axisId}], axes:[{id,unit,representative}] }]
    arrangeMode:    false,
    channelAliases: {},     // mainChannelName → [aliasName, ...] 全Subファイル共通の別名対応
    gridRegions:    [],     // [{ name, top, height, unit }] ドラッグ判定用
    mergeDrag:      null,   // { sourceName, ghostEl } マージドラッグ中の状態
    bitChannels:    new Set(), // Bitモード（0/1表示、グリッド高さ縮小）のチャンネル名
    monoColorMode:  false,     // 単色モード: trueならファイル単位の色で描画
    fileColors:     {},        // fileId → '#RRGGBB' ファイルごとの色（単色モード用）
    fontScale:      'normal',  // フォントサイズ段階: 'small'|'normal'|'large'|'xlarge'
    theme:          'dark',    // カラーテーマ: 'dark'|'light'
    rowHeightPx:    null,      // グリッド基準高さ(px)。null=コンテナに自動フィット
    gridHeights:    {},        // グリッド個別の高さ上書き { signature: px }
    parseJobs:      new Map(), // jobId → { name, detail, cancelled }
    lineWidth:         1.0,    // 線の太さ（一括のデフォルト値）
    channelLineWidths: {},     // チャンネルごとの太さ上書き { channelName: width }。未指定はlineWidthを使う
    showMarkers:       false,  // データ点マーカー（丸印）を表示するか（全体ON/OFF）
    // ドライビングインデックス（モード走行の走行品質指標＋燃費）
    driveIndex: {
        // 使用チャンネル名（自動検出＋手動上書き）。
        // target=null は「選択モードの法規トレースを目標に使う」を意味する（CSV列名を入れると従来通りその列を目標にする）。
        channels:       { target: null, actual: null, fuel: null },
        cycleId:        null,  // 選択した走行モードID（'nedc'/'wltc3b_4'等、独自モードID）。nullは未選択（自動判別）
        phaseOverride:  null,  // 手動編集したフェーズ [{name,start,end}]。nullなら自動境界
        roadLoadByFile: {},    // 走行抵抗係数・質量をファイル別に保持 { ファイル名: {A,B,C,mass} }（任意。揃えばER/EER算出）
        autoAlign:      true,  // 実測の前後余分データを自動整合（車速波形でサイクル開始位置を検出）するか
        alignByFile:    {},    // サイクル開始/終了の手動上書き { ファイル名: {start, end} }（秒・文字列。空なら自動整合）
        results:        [],    // ファイル別の計算結果 [{ fileId, fileName, role, result, ... }]（永続化しない）
        lastResult:     null,  // メインの計算結果（ツールバーボタン表示用。永続化しない）
    },
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
        // Custom RAMは式の計算結果なのでBit自動判定の対象外にする。
        // 特にクロスファイル式のサブ側コピーは全ゼロに縮退しがちで、
        // これをBit判定すると名前基準でメイン側の同名カラムまでBit軸[-0.2,1.2]に
        // 強制固定され、実値がクリップされて線が消える不具合の原因になる。
        if (col.isCustom) continue;
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
    measureBtn: $('measure-mode-btn'),
    statsBtn:   $('stats-panel-btn'),
    eventExpr:      $('event-expr'),
    eventDetectBtn: $('event-detect-btn'),
    eventValidation: $('event-validation'),
    eventSummary:   $('event-summary'),
    eventList:      $('event-list'),
    exportPng:  $('export-png-btn'),
    copyChart:  $('copy-chart-btn'),
    exportCsv:  $('export-csv-btn'),
    exportSettings: $('export-settings-btn'),
    importSettings: $('import-settings-btn'),
    presetSelect: $('settings-preset-select'),
    presetSave: $('preset-save-btn'),
    presetLoad: $('preset-load-btn'),
    presetDelete: $('preset-delete-btn'),
    diffBtn: $('diff-curves-btn'),
    favSelect: $('channel-fav-select'),
    favSave:   $('channel-fav-save'),
    favApply:  $('channel-fav-apply'),
    favDelete: $('channel-fav-delete'),
    driveIndexBtn: $('drive-index-btn'),
};

// ─────────────────────────────────────────────────────────────
// Chart initialisation
// ─────────────────────────────────────────────────────────────

function initChart() {
    state.chart = echarts.init(dom.chartEl, null, {
        backgroundColor: 'transparent',
        renderer: 'canvas',
    });
    // windowリサイズはrAFでスロットル（フレームに1回）。
    // ツールチップ表示中にresizeするとECharts内部で「offsetWidth of null」
    // エラーが出るため、renderChartと同様に先にhideTipをdispatchする
    let _resizeRafId = null;
    window.addEventListener('resize', () => {
        if (_resizeRafId !== null) return;
        _resizeRafId = requestAnimationFrame(() => {
            _resizeRafId = null;
            state.chart.dispatchAction({ type: 'hideTip' });
            state.chart.resize();
        });
    });
    state.chart.on('brushEnd', onBrushEnd);

    // ズーム操作に統計サマリパネルを追従させる（rAFで間引き）
    let _statsRafId = null;
    state.chart.on('datazoom', () => {
        if (_statsRafId !== null) return;
        _statsRafId = requestAnimationFrame(() => {
            _statsRafId = null;
            updateStatsPanel();
        });
    });

    dom.chartEl.addEventListener('mouseleave', () => {
        _lastTooltipParams = null;
        for (const el of _labelEls) el.style.display = 'none';
    });

    // Y軸ラベル領域のホバーカーソル（grab/pointer）
    dom.chartEl.addEventListener('mousemove', e => {
        // ドラッグ中やシフトモード中はスキップ
        if (state.mergeDrag || state.shiftMode || state.brushMode || state.arrangeMode || state.measureMode) return;
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
            // ドラッグ確定時、クロスファイルCustom RAMを最終オフセットで再計算する。
            // ドラッグ中（mousemove）は毎フレーム再計算すると重いので、
            // 指を離したこのタイミングで1回だけ計算し直す。
            if (hasCrossFileCustomRAMs()) {
                recomputeCustomRAMs().then(renderChart);
            }
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
        const sourceUnit = getMainColumn(sourceName)?.unit || '';
        const axisButtons = targetGroup.axes.map(axis => {
            const unit = getAxisDisplayUnit(targetGroup, axis.id) || 'unitなし';
            const names = targetGroup.channels.filter(ch => ch.axisId === axis.id).map(ch => ch.name).join(', ');
            return `<button class="axis-choice-btn" data-axis-id="${esc(axis.id)}">
                <strong>${esc(unit)}</strong><span>${esc(names)}</span>
            </button>`;
        }).join('');
        const { overlay, modal, close } = createModal(`
            <h3 id="axis-choice-title">Y軸の割り当て</h3>
            <p><strong>${esc(sourceName)}</strong>${sourceUnit ? ` (${esc(sourceUnit)})` : ''} を重ねます。</p>
            <div class="axis-choice-list">${axisButtons}</div>
            <button class="axis-choice-btn new-axis" data-axis-id="__new__">
                <strong><i class='bx bx-plus'></i> 新しいY軸</strong><span>独立したスケールで表示</span>
            </button>
            <div class="modal-actions"><button class="btn-secondary axis-choice-cancel">キャンセル</button></div>`, {
            modalClass: 'axis-choice-modal',
            labelledBy: 'axis-choice-title',
            // overlayクリックは閉じるだけでなく resolve(null) も必要なので自前で登録する
            closeOnOverlayClick: false,
        });

        const finish = value => { close(); resolve(value); };
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
        if (state.shiftMode || state.brushMode || state.arrangeMode || state.measureMode) return;
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
        if (state.shiftMode || state.brushMode || state.arrangeMode || state.measureMode) return;
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
        if (state.shiftMode || state.brushMode || state.arrangeMode || state.measureMode) return;
        const band = hitTestResizeBand(e.clientY);
        if (band) {
            // 他のドラッグ(grabbing等)のカーソルを上書きしない
            if (!dom.chartEl.style.cursor) dom.chartEl.style.cursor = 'ns-resize';
        } else if (dom.chartEl.style.cursor === 'ns-resize') {
            dom.chartEl.style.cursor = '';
        }
    });

    dom.chartEl.addEventListener('mousedown', e => {
        if (state.shiftMode || state.brushMode || state.arrangeMode || state.measureMode) return;
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
        if (state.shiftMode || state.brushMode || state.arrangeMode || state.measureMode) return;
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
    const { modal, close } = createModal(`
        <h3 id="chart-group-title">Overlay Settings</h3>
        <div class="chart-group-rows">${rows}</div>
        <div class="modal-actions"><button class="btn-primary chart-group-done">完了</button></div>`, {
        modalClass: 'chart-group-modal',
        labelledBy: 'chart-group-title',
    });

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
                close();
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
            close();
            showChartGroupModal(group.id);
        });
        row.querySelector('.chart-group-detach').addEventListener('click', () => {
            if (detachChannelToStandalone(group.id, name)) {
                close();
                renderChart();
                saveSettings();
            }
        });
    });
    modal.querySelector('.chart-group-done').addEventListener('click', close);
}

// ─────────────────────────────────────────────────────────────
// File drag-drop & input
// ─────────────────────────────────────────────────────────────

// ドロップゾーン外（チャート領域など）へのD&Dでブラウザがファイルへページ遷移し、
// 読み込み済みの全状態が消えるのを防ぐ（B3対策）。
// preventDefaultは伝播を止めないため、dropZoneのハンドラや
// ArrangeモードのパネルD&D（updateArrangeOverlay内）とは干渉しない。
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

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
// Browse Files ボタン → 非表示の file input を開く（S3: インラインonclickの排除）
$('browse-files-btn')?.addEventListener('click', () => dom.fileInput.click());

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

// パース中ファイルの元Fileオブジェクト（fileId → File）。
// TRNはパイプラインを変換済みテキストで流れるため、セッション保存
// （sessionSaveFile）用に元のバイト列をここで持ち回す
const _origFileById = new Map();

async function parseCSV(file) {
    const fileId = 'f' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    _origFileById.set(fileId, file);
    const trn = isTrnFile(file.name);
    const requestedEncoding = getRequestedEncoding();
    // ヘッダー行のヒントはパース開始時点のSettings値をファイルごとに固定する（B4対策）。
    // 検出結果はUI表示としてdom.nameRow/unitRowへ書き戻されるため、並行パース中に
    // DOMから読み直すと他ファイルの検出値に汚染される。以降のチェーンはこの値だけを使う。
    const headerHints = {
        nameRow: parseInt(dom.nameRow.value, 10) - 1,
        unitRow: parseInt(dom.unitRow.value, 10) - 1,
    };
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
            onHeaderParsed(fileId, file.name, converted, previewRes.data, '\t', encoding, requestedEncoding, parseJob, headerHints);
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
                        onHeaderParsed(fileId, file.name, file, res.data, undefined, encoding, requestedEncoding, parseJob, headerHints);
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

function detectHeaderRows(raw, hints) {
    // hints（parseCSV開始時に固定したSettings値）があればそれを使う。
    // DOMからの読み取りはhints無しで呼ばれた場合のフォールバックのみ（B4対策）。
    return detectHeaderRowsBase(
        raw,
        Number.isInteger(hints?.nameRow) ? hints.nameRow : parseInt(dom.nameRow.value, 10) - 1,
        Number.isInteger(hints?.unitRow) ? hints.unitRow : parseInt(dom.unitRow.value, 10) - 1
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
function onHeaderParsed(fileId, fileName, file, raw, delimiter, encoding, encodingMode, parseJob, headerHints) {
    if (parseJob?.cancelled) {
        finishParseJob(parseJob);
        showWarning(`読み込みをキャンセルしました: ${fileName}`);
        return;
    }

    const { nameRow, unitRow } = detectHeaderRows(raw, headerHints);
    const dataStart = Math.max(nameRow, unitRow >= 0 ? unitRow : nameRow) + 1;

    const parseIssue = describeHeaderParseIssue(raw, nameRow, unitRow, dataStart);
    if (parseIssue) {
        finishParseJob(parseJob);
        showError(`CSVヘッダーを読み取れません: ${fileName}`, parseIssue);
        return;
    }

    // 検出結果のUI表示のみ。パース処理はheaderHints経由で受け渡すため、
    // この書き戻し値が他ファイルのパースに影響することはない（B4対策）
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

                    // ロール決定はstate.filesへの挿入直前に同期で行う（B1対策）。
                    // ヘッダーパース時（Phase 1）に決めると、複数ファイル同時ドロップで
                    // どちらも「Main不在」を見て両方Mainになる競合が起きる。
                    // completeコールバックはイベントループで1件ずつ直列に走るため、
                    // ここで判定→直後に挿入すれば競合しない。
                    const hasMain = Object.values(state.files).some(f => f.role === 'main');
                    const role    = hasMain ? 'sub' : 'main';

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

                    // 次回起動時の自動復元用に元ファイルをIndexedDBへ保存
                    // （非同期・失敗しても読み込み自体には影響させない）。
                    // TRNではこのスコープの file は変換済みテキストなので、
                    // parseCSVが控えた元Fileを使う
                    sessionSaveFile(fileId, _origFileById.get(fileId), fileName);
                    _origFileById.delete(fileId);

                    // ファイル色を自動割り当て（単色モード用）
                    if (!state.fileColors[fileId]) {
                        const fileCount = Object.keys(state.fileColors).length;
                        state.fileColors[fileId] = SERIES_COLORS[fileCount % SERIES_COLORS.length];
                    }

                    if (role === 'sub' && !state.shiftFileId) state.shiftFileId = fileId;

                    // 保留中の設定があればファイル読込後に適用する
                    await applyPendingSettings();
                    // 参照先Subが揃うのを待っていたクロスファイルRAMを再試行
                    await applyDeferredCrossRAMs()
                        .catch(e => console.warn('[CSV Viewer] クロスファイルRAMの復元に失敗:', e));

                    // 既存のCustom RAMがあれば新ファイルにも計算・追加する
                    // 各awaitに個別の.catchを付けることで、計算に失敗してもUI更新と保存は
                    // 必ず行う（asyncコールバック内のPromise拒否は外側のtry/catchでは
                    // 捕捉されないため、ここで握りつぶしてから後続処理に進む）
                    if (state.customRAMs.length > 0) {
                        await addCustomRAMsToFile(fileId)
                            .catch(e => showError(`Custom RAMの計算に失敗: ${fileName}`, e.stack || e.message));
                    }
                    // .trnファイルなら燃料解析用のCustom RAMを自動生成する
                    // （Fuel_Rateチャンネルがある場合のみ。重複時はスキップ）
                    await autoGenerateFuelRAMs(fileId)
                        .catch(e => console.warn('[TRN auto RAM] 自動生成に失敗:', e));
                    updateUI();
                    saveSettings();
                    // ファイルが増えたのでUndo履歴を取り直す（追加前には戻せない）
                    resetHistoryBaseline();
                    // モード走行データ（目標・実測車速あり）ならドライビングインデックスを自動計算
                    computeDriveIndex().catch(e => console.warn('[DriveIndex] auto compute failed:', e));
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

    // メイン/サブを入れ替えても、ファイル間の時間アライメント（オフセット）を保つ。
    // メインは常に基準=offset 0。新メインのオフセット分を全ファイルから引いて
    // 基準を取り直すと、ファイル同士の相対的なズレ量はそのまま維持される。
    //   例: サブBが offset 5（=Bを5秒ずらすとAに揃う）の状態で B をメインにすると、
    //       B:5→0, 旧メインA:0→-5 となり「AとBは5秒ズレ」という関係が引き継がれる。
    // （これをしないと旧メインAは offset 0 のままで、せっかくの位置合わせが失われる）
    const rebase = state.files[newMainId].offset || 0;
    if (rebase !== 0) {
        for (const f of Object.values(state.files)) {
            f.offset = (f.offset || 0) - rebase;
        }
    }

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
    clearEvents(false); // イベント区間は旧メインの時間軸基準なので破棄
    updateUI();
}

function removeFile(fileId) {
    const wasMain = state.files[fileId]?.role === 'main';
    delete state.files[fileId];
    delete state.fileColors[fileId];
    sessionDeleteFile(fileId); // 自動復元ストアからも消す（非同期・失敗は無視）
    // イベント区間は旧メインの時間軸基準なので、メインが変わるなら破棄する
    if (wasMain) clearEvents(false);

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
    _origFileById.clear(); // キャンセルされたパースの控えFileも破棄
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
    _deferredCrossRAMs  = [];   // 繰り延べ中のクロスファイルRAMも破棄
    if (state.shiftMode) exitShiftMode();
    if (state.arrangeMode) exitArrangeMode();
    if (state.measureMode) exitMeasureMode(false);
    clearEvents(false); // イベント区間は消えたファイルの時間軸を指しているため破棄
    if (dom.parsePreview) dom.parsePreview.classList.add('hidden');
    renderParseJobs();
    updateUI();
    // localStorageの保存データもクリア
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
    sessionClearFiles(); // 自動復元ストアも空にする（非同期・失敗は無視）
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
    if (dom.diffBtn) dom.diffBtn.disabled = !hasSub;
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
        // ファイル色をバッジの背景色に反映。
        // 値はapplySettingsで#RRGGBB検証済みだが、多層防御として出力側もesc()を通す
        const fColor = esc(state.fileColors[fid] || '#6366f1');
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
        inp.addEventListener('change', async () => {
            const fid = inp.dataset.offsetId;
            const v   = parseFloat(inp.value);
            if (!isNaN(v) && state.files[fid]) {
                state.files[fid].offset = v;
                // オフセットをクロスファイルCustom RAMの計算へ反映（必要時のみ再計算）
                await applyOffsetChange();
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
    let html = `<h3 id="debug-modal-title" style="margin:0 0 12px;color:var(--accent-soft);">Parse Info</h3>`;
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
    html += `<h3 style="margin:0 0 8px;color:var(--accent-soft);">Time Data（先頭10 / 末尾5）</h3>`;
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
    html += `<h3 style="margin:0 0 8px;color:var(--accent-soft);">Columns</h3>`;
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
        html += `<h3 style="margin:0 0 8px;color:var(--accent-soft);">変換後テキスト（〜行${showUntil}）</h3>`;
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
        html += `<h3 style="margin:0 0 8px;color:var(--accent-soft);">読み込みプレビュー</h3>`;
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
    // aria-labelledby でスクリーンリーダーがモーダルのタイトルを読み上げられるようにする
    const { modal, close } = createModal(html + MODAL_CLOSE_FOOTER, {
        modalClass: 'debug-modal',
        labelledBy: 'debug-modal-title',
    });
    modal.querySelector('.modal-close-btn').addEventListener('click', close);
}

// ─────────────────────────────────────────────────────────────
// Custom RAM (computed channels)
// ─────────────────────────────────────────────────────────────

/** Extract RAM names referenced in an expression (組み込み関数名は除外) */
function extractExprNames(expr) {
    // 関数名（大文字小文字を問わず）は除外し、残りをチャンネル名として扱う。
    // チャンネル名自体は大文字小文字を区別するので .map では元の表記を保つ。
    return tokenizeExpr(expr)
        .filter(t => t.type === 'name' && !_builtinFuncNames.has(t.value.toLowerCase()))
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
 * クロスファイル参照を含むCustom RAMが1つでも存在するか。
 * （こうしたRAMだけがサブファイルのオフセットに依存して計算結果が変わる）
 */
function hasCrossFileCustomRAMs() {
    return state.customRAMs.some(cr => hasCrossRef(cr.expr));
}

/**
 * サブファイルのオフセット（Δt）が変わったときの反映処理。
 * クロスファイルCustom RAM（例 integral(Fuel_Rate - s1:Fuel_Rate)）は、
 * getCrossRef がサブのオフセットを使ってメイン時間軸に補間して計算するため、
 * オフセットを変えたら再計算しないとグラフが古い値のまま残る。
 * 通常のサブ破線は renderChart だけでオフセットに追従するので、
 * クロスファイルRAMが1つも無ければ再計算は不要（無駄な計算を避ける）。
 */
async function applyOffsetChange() {
    if (hasCrossFileCustomRAMs()) {
        await recomputeCustomRAMs();
    }
    renderChart();
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
        showWarning(`チャンネル "${name}" は既に存在します`);
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
        showWarning(`式のエラー: "${name}" を追加できません`,
            `"${expr}" を評価できません。RAM名や関数名を確認してください。`);
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
    // Custom RAMはBitチャンネルにしない。過去に誤検出で登録された場合に備えて解除し、
    // 名前基準のBit軸強制でメイン側の線が消える状態を自己修復する。
    state.bitChannels.delete(name);
    state.selectedNames.add(name);
    addStandaloneChart(name);

    renderCustomRAMList();
    renderColumnList();
    renderChart();
    // 永続化とUndo履歴記録。これがないとリロードでRAMが消え、Undo対象にもならない
    // （復元処理から呼ばれた場合はrecordHistory側のフラグで二重記録が防がれる）
    saveSettings();
}

/**
 * 既存 Custom RAM の式・単位を編集し、全ファイルのカラムを再計算する。
 * 名前は変更しない（名前はチャンネルの識別子で、選択状態・チャートグループ・
 * Y軸設定・色などが名前で紐づくため、変更すると影響範囲が広い）。
 * カラムID・色は保持して見た目を維持し、対象1件だけを in-place 更新する
 * （recomputeCustomRAMs は全RAMの色を振り直すので使わない）。
 * @returns {Promise<boolean>} 成功すれば true、検証失敗なら false（モーダルを閉じない用）
 */
async function editCustomRAM(id, newExpr, newUnit) {
    const cr = state.customRAMs.find(c => c.id === id);
    const mainFile = getMainFile();
    if (!cr || !mainFile) return false;

    newExpr = String(newExpr || '').trim();
    if (!newExpr) return false;
    // newUnit 未指定（undefined/null）なら既存単位を維持する
    const unit = String(newUnit != null ? newUnit : (cr.unit || '')).trim();

    // 新しい式が参照するカラムを全ファイルにロード（addCustomRAM と同じ手順）
    const refNames  = extractExprNames(newExpr);
    const crossRefs = extractCrossRefs(newExpr);
    const isCross   = crossRefs.length > 0;
    const loadPromises = [];
    for (const fid of Object.keys(state.files)) {
        loadPromises.push(loadColumnsForFile(fid, refNames));
    }
    // ファイル間参照（s1:Name 等）のカラムも該当サブファイルでロード
    const subIds = getSubFileIds();
    for (const ref of crossRefs) {
        const idx = parseInt(ref.fileKey.replace('s', ''), 10) - 1;
        if (idx >= 0 && idx < subIds.length) {
            loadPromises.push(loadColumnsForFile(subIds[idx], [ref.name]));
        }
    }
    await Promise.all(loadPromises);

    // メインファイルで評価してエラーチェック（全 NaN なら中止）
    const mainVals = computeCustomExpr(newExpr, mainFile);
    if (mainVals.every(v => isNaN(v))) {
        alert(`式のエラー: "${newExpr}" を評価できません。\nRAM名や関数名を確認してください。`);
        return false;
    }

    // 各ファイルの既存カラムを「色・id はそのまま」で中身だけ再計算する
    for (const f of Object.values(state.files)) {
        const col = f.columns.find(c => c.isCustom && c.name === cr.name);
        if (!col) continue;
        col.isCrossFile = isCross;   // cross↔非cross の切替を描画側（二重線判定）へ反映
        col.unit = unit;
        f.colData[col.id] = (f === mainFile) ? mainVals : computeCustomExpr(newExpr, f);
    }

    // state 側のメタ情報も更新
    cr.expr = newExpr;
    cr.unit = unit;

    renderCustomRAMList();
    renderColumnList();
    renderChart();
    saveSettings();   // 永続化＋Undo履歴記録（addCustomRAM と同様）
    return true;
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
        // Custom RAMはBit扱いにしない（過去の誤検出登録を解除して自己修復）
        state.bitChannels.delete(cr.name);
    }
}

/**
 * 新しく追加されたファイルに既存のCustom RAMを計算・追加する。
 * ファイル読込完了後に呼ばれる。
 */
async function addCustomRAMsToFile(fileId) {
    const f = state.files[fileId];
    if (!f || state.customRAMs.length === 0) return;

    // 参照カラムをロード（通常参照＋ファイル間参照）
    // ファイル間参照（s1:Name等）はサブファイル側のカラムが必要。
    // recomputeCustomRAMs と同じく cross-ref も対象サブファイルにロードしておかないと、
    // 後からファイルを追加したときに cross-ref 未ロードで計算がNaN化し描画が崩れる。
    const allRefNames = [];
    const allCrossRefs = [];
    for (const cr of state.customRAMs) {
        allRefNames.push(...extractExprNames(cr.expr));
        allCrossRefs.push(...extractCrossRefs(cr.expr));
    }
    const loadPromises = [];
    if (allRefNames.length > 0) {
        loadPromises.push(loadColumnsForFile(fileId, allRefNames));
    }
    const subIds = getSubFileIds();
    for (const cr of allCrossRefs) {
        const idx = parseInt(cr.fileKey.replace('s', ''), 10) - 1;
        if (idx >= 0 && idx < subIds.length) {
            loadPromises.push(loadColumnsForFile(subIds[idx], [cr.name]));
        }
    }
    await Promise.all(loadPromises);

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

/**
 * ファイルに指定名のチャンネルが存在するか（完全一致）。
 * 式エンジンはカラム名を完全一致で照合するため、ここも完全一致で判定する。
 */
function fileHasChannel(f, name) {
    return !!f && f.columns.some(c => c.name === name);
}

/**
 * .trnファイル読み込み後に、燃料解析用のCustom RAMを自動生成する。
 *
 * 生成するもの（出力単位は cc・累積）:
 *   - Integral_Fuel : メインの累積燃料消費量
 *                     式 = integral(Fuel_Rate)/3.6
 *   - delta_Fuel_sN : N番目のサブとメインの累積燃料差（サブの数だけ作る）
 *                     式 = integral(Fuel_Rate - sN:Fuel_Rate)/3.6
 *
 * 「/3.6」の根拠:
 *   Fuel_Rate の単位は L/h。Integral() は内部で時間刻み dt[秒] を掛けて積分するため、
 *   Integral(Fuel_Rate) の単位は「L/h × 秒」になる。これを cc に直すには
 *   ×1000（L→cc）÷3600（h→秒）= ÷3.6。Integral が dt を実データの時間軸から
 *   読むので、サンプル間隔（0.1秒など）を式に書く必要はなく、サンプルレートが
 *   変わっても正しい値になる。
 *
 * 既に同名RAMがある場合（リロード時の設定復元を含む）や、対象ファイルに
 * Fuel_Rate チャンネルが無い場合はスキップする（壊れた全NaNのRAMを作らない）。
 *
 * @param {string} fileId 読み込みが完了したファイルのID
 */
async function autoGenerateFuelRAMs(fileId) {
    const f = state.files[fileId];
    // .trn 以外は対象外（auto生成はTRN形式の燃料データ前提）
    if (!f || !isTrnFile(f.name)) return;

    const FUEL = 'Fuel_Rate';            // .trnの燃料流量チャンネル名（単位 L/h）

    // 1) メインの累積燃料 Integral_Fuel（メインにFuel_Rateがあり、未作成のときだけ）
    const mainFile = getMainFile();
    const integralName = '@Integral_Fuel';   // addCustomRAMが先頭に@を付けるため、判定も@付き
    if (mainFile
        && fileHasChannel(mainFile, FUEL)
        && !state.customRAMs.some(cr => cr.name === integralName)) {
        await addCustomRAM('Integral_Fuel', `integral(${FUEL})/3.6`, 'cc');
    }

    // 2) 各サブとの累積差 delta_Fuel_sN（サブの並び順1始まり: s1, s2, ...）
    //    cross-ref の sN はサブの追加順インデックス（getSubFileIds順）に対応する。
    const subIds = getSubFileIds();
    for (let i = 0; i < subIds.length; i++) {
        const sub = state.files[subIds[i]];
        if (!fileHasChannel(sub, FUEL)) continue;   // Fuel_Rateの無いサブはスキップ
        const n = i + 1;                            // s1, s2, ...
        const deltaName = `@delta_Fuel_s${n}`;
        if (state.customRAMs.some(cr => cr.name === deltaName)) continue;  // 重複スキップ
        await addCustomRAM(`delta_Fuel_s${n}`, `integral(${FUEL} - s${n}:${FUEL})/3.6`, 'cc');
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
            + `<i class='bx bx-edit-alt cr-edit' data-crid="${esc(cr.id)}" title="式・単位を編集"></i>`
            + `<i class='bx bx-x cr-del' data-crid="${esc(cr.id)}" title="Remove"></i>`;
        dom.customList.appendChild(li);
    }
    dom.customList.querySelectorAll('.cr-del').forEach(el => {
        el.addEventListener('click', () => removeCustomRAM(el.dataset.crid));
    });

    dom.customList.querySelectorAll('.cr-edit').forEach(el => {
        el.addEventListener('click', () => showCustomRAMEditModal(el.dataset.crid));
    });
}

function showCustomRAMEditModal(id) {
    const cr = state.customRAMs.find(item => item.id === id);
    if (!cr) return;
    // 名前は読み取り専用（識別子のため変更不可）。式と単位を編集できる
    const { modal, close } = createModal(`
        <h3 id="custom-edit-title">Custom RAM を編集</h3>
        <p class="custom-edit-name">${esc(cr.name)}<span class="custom-edit-hint">（名前は変更できません）</span></p>
        <label class="custom-edit-label">式</label>
        <input type="text" class="custom-ram-input custom-edit-expr-input" value="${esc(cr.expr)}" placeholder="e.g. sqrt(pow(X,2) + pow(Y,2))" autocomplete="off">
        <div class="custom-ram-validation custom-edit-validation"></div>
        <label class="custom-edit-label">単位（任意）</label>
        <input type="text" class="custom-ram-input custom-edit-unit-input" value="${esc(cr.unit || '')}" placeholder="Unit (optional)">
        <div class="modal-actions">
            <button class="btn-secondary custom-edit-cancel">キャンセル</button>
            <button class="btn-primary custom-edit-save">保存</button>
        </div>`, {
        modalClass: 'custom-unit-modal',
        labelledBy: 'custom-edit-title',
    });

    const exprInput = modal.querySelector('.custom-edit-expr-input');
    const unitInput = modal.querySelector('.custom-edit-unit-input');
    const vEl       = modal.querySelector('.custom-edit-validation');
    const saveBtn   = modal.querySelector('.custom-edit-save');

    // 式入力をライブ検証（追加フォームと同じ evaluateExprForValidation を共用）
    let vTimer = null;
    const runValidate = () => {
        const { ok, text, cls } = evaluateExprForValidation(exprInput.value);
        vEl.textContent = text;
        vEl.className = 'custom-ram-validation custom-edit-validation' + (cls ? ' ' + cls : '');
        // 空式は保存不可。検証エラーも保存不可
        saveBtn.disabled = !ok || !exprInput.value.trim();
    };
    exprInput.addEventListener('input', () => {
        clearTimeout(vTimer);
        vTimer = setTimeout(runValidate, VALIDATE_DEBOUNCE_MS);
    });
    runValidate();           // 初期表示（既存式のプレビューを出す）
    exprInput.focus();
    exprInput.select();

    modal.querySelector('.custom-edit-cancel').addEventListener('click', close);
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;   // 再計算中の二重クリック防止
        const saved = await editCustomRAM(id, exprInput.value, unitInput.value);
        if (saved) close();
        else runValidate();        // 失敗時はボタンの有効/無効を戻す
    });
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

// ─────────────────────────────────────────────────────────────
// ドライビングインデックス（モード走行の走行品質指標＋燃費）
//   計算ロジックは drive-index-utils.js（window.DriveIndex）の純粋関数に分離。
//   ここは「チャンネル解決 → データ収集 → 計算呼び出し → 表示」の配線のみ。
// ─────────────────────────────────────────────────────────────

/** ファイルのカラム名から 目標車速/実測車速/燃料流量 を推定する */
function detectDriveChannels(file) {
    const cols = file.columns.map(c => c.name);
    const isSpeed = n => /(speed|veloc|車速|spd)/i.test(n);
    // 目標車速: target/reference/目標 系 ＋ 速度語（無ければ目標語のみ）
    const target = cols.find(n => /(target|reference|ref|目標|指示|cmd|command)/i.test(n) && isSpeed(n))
                || cols.find(n => /(target|目標)/i.test(n));
    // 実測車速: actual/実測 系 ＋ 速度語、無ければ目標以外の速度チャンネル
    const actual = cols.find(n => /(actual|実測|meas|driven)/i.test(n) && isSpeed(n))
                || cols.find(n => isSpeed(n) && n !== target);
    // 燃料流量: Fuel_Rate / 燃料 系
    const fuel = cols.find(n => /fuel.?rate/i.test(n)) || cols.find(n => /(燃料|fuel)/i.test(n));
    return { target: target || null, actual: actual || null, fuel: fuel || null };
}

/** ファイルから指定チャンネル名のデータ配列を取得（未ロード/不在は null） */
function getColData(file, name) {
    if (!name) return null;
    const col = file.columns.find(c => c.name === name);
    if (!col) return null;
    return file.colData[col.id] || null;
}

/** 内蔵サイクル＋独自モードを合わせた走行モード一覧を返す */
function allDriveModes() {
    return [...window.DriveIndex.CYCLE_REGISTRY, ...(state.customModes || [])];
}

/** モードID（旧ID読み替え込み）でモード定義を引く。見つからなければ null */
function driveModeById(id) {
    if (!id) return null;
    const rid = window.DriveIndex.resolveCycleId(id);
    return allDriveModes().find(x => x.id === rid) || null;
}

/** モードIDから表示名を返す（未選択は「未判別」） */
function cycleNameOf(id) {
    const m = driveModeById(id);
    return m ? m.name : '未判別';
}

/**
 * 計算に使う実効フェーズを返す（手動編集 > モード既定 > 空）。
 * 手動編集(phaseOverride)は「別モードを表示していた時に編集して保存されたまま」の場合があり得るため、
 * その終了時刻が現在の実効モードの既定終了時刻と大きく食い違う（5%または5秒を超える差）場合は
 * 古い編集とみなして無視し、既定フェーズに戻す。
 */
function getEffectivePhases(effectiveId) {
    const di = state.driveIndex;
    const m = driveModeById(effectiveId);
    const defaults = (m && m.phases) ? m.phases : [];
    if (di.phaseOverride && di.phaseOverride.length) {
        const expectedEnd = defaults.length ? defaults[defaults.length - 1].end : null;
        const overrideEnd = di.phaseOverride[di.phaseOverride.length - 1].end;
        const mismatch = expectedEnd != null && isFinite(overrideEnd)
            && Math.abs(overrideEnd - expectedEnd) > Math.max(expectedEnd * 0.05, 5);
        if (!mismatch) return di.phaseOverride;
    }
    return defaults;
}

/**
 * 実測車速に最も一致する走行モードを、各モードのトレースとの整合RMSEで選ぶ。
 * 前後に余分データがあっても（総時間で判定する detectCycle と違い）正しく判別できる。
 * @returns {{ id, name, align }|null}
 */
function pickBestCycleByAlignment(mTime, mActual) {
    if (!mTime || !mActual || mTime.length < 2) return null;
    const mDur = mTime[mTime.length - 1] - mTime[0];
    let best = null, bestRmse = Infinity;
    for (const mode of allDriveModes()) {
        const tr = window.DriveIndex.getCycleTrace(mode.id, state.customModes);
        if (!tr || tr.time.length < 2) continue;
        const Tdur = tr.time[tr.time.length - 1] - tr.time[0];
        if (Tdur > mDur * 1.02) continue; // サイクルが実測より長いモードは対象外
        const al = window.DriveIndex.alignActualToCycle(mTime, mActual, tr.time, tr.speed, { coarse: 150, fine: 60 });
        if (al.rmse < bestRmse) { bestRmse = al.rmse; best = { id: mode.id, name: mode.name, align: al }; }
    }
    return best;
}

/**
 * 実測車速チャンネルと走行モードが揃えば指標・燃費を計算し state.driveIndex に格納する。
 * 目標車速は原則「選択モードの法規トレース」を使う（di.channels.target にCSV列名がある場合のみその列を目標にする）。
 * @returns {Promise<object|null>}
 */
async function computeDriveIndex({ autoDetect = true } = {}) {
    const mainFile = getMainFile();
    if (!mainFile || !window.DriveIndex) return null;
    const di = state.driveIndex;

    // チャンネル解決: 保存名が現ファイルに存在すれば優先、無ければ自動検出で補完。
    // autoDetect=false（モーダルからの再計算）では補完せず、ユーザー指定（null＝なし含む）を尊重する。
    // 目標(target)は既定がモードの法規トレースなので、CSV列の自動採用はしない（ユーザーが明示選択した時のみ列を使う）。
    const auto  = detectDriveChannels(mainFile);
    const names = mainFile.columns.map(c => c.name);
    const pick  = (kind, allowAuto) => {
        const stored = di.channels[kind];
        if (stored && names.includes(stored)) return stored;
        return (autoDetect && allowAuto) ? auto[kind] : null;
    };
    const targetName = pick('target', false);   // CSV列を目標にするのは明示指定時のみ
    const actualName = pick('actual', true);
    const fuelName   = pick('fuel', true);
    // 解決結果を state に反映（永続化・モーダル表示用）
    di.channels = { target: targetName || null, actual: actualName || null, fuel: fuelName || null };

    // モード判別と整合に使うため、メインの実測車速を先にロードする。
    const mainActualCol = resolveColumnForFile(mainFile, actualName);
    if (mainActualCol) await loadColumnsForFile(getMainFileId(), [mainActualCol.name]);
    const mainActual = mainActualCol ? mainFile.colData[mainActualCol.id] : null;

    // 実効モードID: 手動選択 > 総時間判別（軽量・高速） > （それで一致しなければ）車速ベストフィット。
    //   前後に余分データがあると総時間判別は外れるため、その場合のみ波形ベストフィットにフォールバックする。
    //   ファイル読込時の自動計算でもフォールバックを行う（ここを省略すると「前後に余分データがある
    //   ファイルはファイルを開いただけでは認識されない」という本末転倒になるため）。
    const explicitId = window.DriveIndex.resolveCycleId(di.cycleId);
    let effectiveId, detName;
    if (explicitId) {
        effectiveId = explicitId; detName = '—';
    } else {
        const det = window.DriveIndex.detectCycle(mainFile.timeData, null);
        if (det && det.id) {
            effectiveId = det.id; detName = det.name;
        } else if (di.autoAlign && mainActual) {
            const best = pickBestCycleByAlignment(mainFile.timeData, mainActual);
            effectiveId = best ? best.id : null;
            detName = best ? best.name : '未判別';
        } else {
            effectiveId = null; detName = '未判別';
        }
    }

    // 目標の供給源: CSV列名があればその列、なければ選択モードの法規トレース。
    const useModeTrace = !targetName;
    const modeTrace = useModeTrace ? window.DriveIndex.getCycleTrace(effectiveId, state.customModes) : null;

    // 実測車速が無い、またはモードトレース指定なのにモード未選択（トレース取得不可）なら計算しない。
    if (!actualName || (useModeTrace && !modeTrace)) {
        di.results = [];
        di.lastResult = null;
        updateDriveIndexButton();
        return null;
    }

    const traceT0  = modeTrace ? modeTrace.time[0] : 0;
    const cycleDur = modeTrace ? (modeTrace.time[modeTrace.time.length - 1] - traceT0) : 0;

    // メイン＋全サブを順に計算する。サブはチャンネル名を別名解決（resolveColumnForFile）。
    const results = [];
    const fileIds = [getMainFileId(), ...getSubFileIds()];
    for (const fid of fileIds) {
        const f = state.files[fid];
        if (!f) continue;
        const entry = { fileId: fid, fileName: f.shortName, fullName: f.name, role: f.role };

        // 各ファイルで対象カラムを解決（メインは厳密一致、サブは別名→同名フォールバック）
        const aCol = resolveColumnForFile(f, actualName);
        const fCol = fuelName ? resolveColumnForFile(f, fuelName) : null;
        // 目標がCSV列モードの時だけ目標列を解決
        const tCol = useModeTrace ? null : resolveColumnForFile(f, targetName);
        if (!aCol || (!useModeTrace && !tCol)) {
            entry.result = null;
            entry.reason = '対象チャンネルなし';
            results.push(entry);
            continue;
        }

        // 必要列を遅延ロード（目標トレース利用時は目標列ロード不要）
        const need = [aCol.name];
        if (tCol) need.push(tCol.name);
        if (fCol) need.push(fCol.name);
        await loadColumnsForFile(fid, need);

        const actual = f.colData[aCol.id];
        const fuel   = fCol ? f.colData[fCol.id] : null;
        if (!f.timeData || !actual) {
            entry.result = null;
            entry.reason = 'データなし';
            results.push(entry);
            continue;
        }

        const phases   = getEffectivePhases(effectiveId);
        const roadLoad = di.roadLoadByFile[f.name] || null; // 走行抵抗はファイル別（任意）

        let metricsOpts, alignInfo = null;
        if (useModeTrace) {
            // サイクル開始/終了を決める: 手動上書き > 自動整合 > データ先頭。
            const man = di.alignByFile[f.name] || {};
            const manStart = parseFloat(man.start), manEnd = parseFloat(man.end);
            let start, autoStart = null, alignRmse = null;
            if (isFinite(manStart)) {
                start = manStart;                                   // 手動入力の開始時刻
            } else if (di.autoAlign) {
                const al = window.DriveIndex.alignActualToCycle(f.timeData, actual, modeTrace.time, modeTrace.speed);
                start = al.start; autoStart = al.start; alignRmse = al.rmse; // 車速波形で自動整合
            } else {
                start = f.timeData[0];                              // 整合なし: データ先頭＝サイクル開始
            }
            // 終了時刻は開始より後でなければならない（逆転入力は無視して既定=start+cycleDurに戻す）。
            const manEndInvalid = isFinite(manEnd) && manEnd <= start;
            const end   = (isFinite(manEnd) && !manEndInvalid) ? manEnd : (start + cycleDur);
            const scale = cycleDur > 0 ? (end - start) / cycleDur : 1;
            // 目標トレース・フェーズ境界を実測の時間軸へ写像（前後の余分データは窓外なので無視される）
            const targetTimeM = modeTrace.time.map(t => start + (t - traceT0) * scale);
            const phasesM = phases.map(p => ({ name: p.name, start: start + p.start * scale, end: start + p.end * scale }));
            metricsOpts = {
                targetTime: targetTimeM, target: modeTrace.speed,
                actualTime: f.timeData, actual, fuelTime: f.timeData, fuelRate: fuel,
                phases: phasesM, roadLoad,
            };
            alignInfo = {
                start, end, auto: !isFinite(manStart) && di.autoAlign, autoStart, rmse: alignRmse,
                manEndInvalid,                          // 終了時刻の入力が無視されたか（開始以前だった）
                scaled: cycleDur > 0 && Math.abs(scale - 1) > 0.02, // フェーズ境界を比例配分で補正したか
            };
        } else {
            // CSV列を目標にする従来モード（同一ファイル・同一時間軸。整合なし）
            metricsOpts = {
                targetTime: f.timeData, target: f.colData[tCol.id],
                actualTime: f.timeData, actual, fuelTime: f.timeData, fuelRate: fuel,
                phases, roadLoad,
            };
        }

        entry.result = window.DriveIndex.computeMetrics(metricsOpts);
        entry.effectiveId  = effectiveId;
        entry.cycleName    = cycleNameOf(effectiveId);
        entry.detectedName = detName;
        entry.detectedId   = effectiveId;
        entry.targetSource = useModeTrace ? 'mode' : 'channel';
        entry.align        = alignInfo;
        entry.channels     = { target: useModeTrace ? null : tCol.name, actual: aCol.name, fuel: fCol ? fCol.name : null };
        results.push(entry);
    }

    di.results = results;
    // メインの結果をボタン表示用に保持（後方互換）
    const mainEntry = results.find(r => r.role === 'main' && r.result);
    di.lastResult = mainEntry ? {
        ...mainEntry.result,
        effectiveId:  mainEntry.effectiveId,
        cycleName:    mainEntry.cycleName,
        detectedName: mainEntry.detectedName,
        detectedId:   mainEntry.detectedId,
        channels:     mainEntry.channels,
    } : null;
    updateDriveIndexButton();
    return di.results;
}

/** ツールバーボタンのラベル/状態を直近結果に合わせて更新する */
function updateDriveIndexButton() {
    const btn = dom.driveIndexBtn;
    if (!btn) return;
    const di = state.driveIndex;
    const labelEl = btn.querySelector('.di-label') || btn;
    if (di.lastResult) {
        btn.classList.add('di-active');
        labelEl.textContent = di.lastResult.cycleName || 'Drive Index';
    } else {
        btn.classList.remove('di-active');
        labelEl.textContent = 'Drive Index';
    }
}

// 表示用フォーマッタ（null/非数は「-」）
function diFmtPct(v) { return (v == null || !isFinite(v)) ? '-' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
function diFmtNum(v, d = 2) { return (v == null || !isFinite(v)) ? '-' : v.toFixed(d); }

/** 計算結果から指標テーブルのHTMLを組み立てる */
function buildDriveIndexTable(result) {
    if (!result) {
        return `<p class="di-empty">計算するには「走行モード」と「実測車速」チャンネルを選び、「再計算」を押してください。</p>`;
    }
    const rowHtml = (label, m, cls = '') => `<tr class="${cls}">
        <td class="di-row-label">${esc(label)}</td>
        <td>${diFmtNum(m.rmsse)}</td>
        <td>${diFmtPct(m.iwr)}</td>
        <td>${diFmtPct(m.ascr)}</td>
        <td>${diFmtPct(m.dr)}</td>
        <td>${diFmtPct(m.er)}</td>
        <td>${diFmtPct(m.eer)}</td>
        <td>${diFmtNum(m.fuelKmPerL)}</td>
        <td>${diFmtNum(m.fuelLper100km)}</td>
        <td>${diFmtNum(m.distanceKm, 3)}</td>
        <td>${diFmtNum(m.fuelL, 3)}</td>
    </tr>`;
    const phaseRows = (result.phases || []).map(p => rowHtml(p.name, p)).join('');
    const totalRow  = rowHtml('モード全体 (Total)', result.total || {}, 'di-total-row');
    return `<table class="di-table">
        <thead><tr>
            <th>区間</th><th>RMSSE<br>[km/h]</th><th>IWR</th><th>ASCR</th><th>DR</th>
            <th>ER</th><th>EER</th><th>燃費<br>[km/L]</th><th>[L/100km]</th><th>距離<br>[km]</th><th>燃料<br>[L]</th>
        </tr></thead>
        <tbody>${phaseRows}${totalRow}</tbody>
    </table>`;
}

/**
 * ファイル別の計算結果をまとめて表示する。各ファイルに
 * 「見出し（ファイル名・Main/Subバッジ・判別サイクル）」「ファイル別走行抵抗入力」「指標表」を並べる。
 */
function buildDriveIndexAllTables(results, roadLoadByFile, alignByFile) {
    if (!results || !results.length) {
        return `<p class="di-empty">計算するには「走行モード」と「実測車速」チャンネルを選び、「再計算」を押してください。</p>`;
    }
    return results.map(entry => {
        const rl = (roadLoadByFile && roadLoadByFile[entry.fullName]) || {};
        const roleLabel = entry.role === 'main' ? 'Main' : 'Sub';
        const sub = entry.result ? esc(entry.cycleName || '—') : esc(entry.reason || '計算できませんでした');
        const head = `<div class="di-file-head">
            <span class="di-file-name" title="${esc(entry.fullName)}">${esc(entry.fileName)}</span>
            <span class="di-file-role di-role-${entry.role}">${roleLabel}</span>
            <span class="di-file-cycle">${sub}</span>
        </div>`;
        // ファイル別 サイクル切り出し入力（前後の余分データを除外）。モードトレース利用時のみ表示。
        let alignInputs = '';
        if (entry.align) {
            const man = (alignByFile && alignByFile[entry.fullName]) || {};
            const a = entry.align;
            const phStart = a.autoStart != null ? `自動 ${diFmtNum(a.autoStart, 1)}` : '0';
            const phEnd   = `自動 ${a.end != null ? diFmtNum(a.end, 1) : ''}`;
            // rmseが無限大（実測データがサイクルより大幅に短く、重なりが乏しい）の場合は
            // 数値をそのまま出さず、信頼度が低い旨を文章で伝える。
            const rmseNote = (a.rmse == null) ? ''
                : !isFinite(a.rmse) ? '（実測データがサイクルより大幅に短く、整合の信頼度が低い可能性があります）'
                : `（一致度RMSE ${diFmtNum(a.rmse, 1)} km/h）`;
            let note = a.auto
                ? `自動整合: ${diFmtNum(a.start, 1)}〜${diFmtNum(a.end, 1)}秒を使用` + rmseNote
                : `手動: ${diFmtNum(a.start, 1)}〜${diFmtNum(a.end, 1)}秒を使用`;
            if (a.manEndInvalid) note += '（終了時刻が開始以前だったため入力を無視しました）';
            if (a.scaled) note += '（フェーズ境界を比例配分で補正）';
            alignInputs = `<div class="di-align di-file-align" data-file="${esc(entry.fullName)}">
                <span class="di-rl-title">サイクル切り出し（前後の余分データ除外・空欄=自動整合）</span>
                <label>開始[s]<input type="number" class="di-al-start" value="${esc(man.start || '')}" step="any" placeholder="${esc(phStart)}"></label>
                <label>終了[s]<input type="number" class="di-al-end" value="${esc(man.end || '')}" step="any" placeholder="${esc(phEnd)}"></label>
                <span class="di-align-note">${esc(note)}</span>
            </div>`;
        }
        // ファイル別 走行抵抗入力（data-file にフルネームを持たせ、再計算時に読み取る）
        const rlInputs = `<div class="di-roadload di-file-rl" data-file="${esc(entry.fullName)}">
            <span class="di-rl-title">走行抵抗（任意・ER/EER用）</span>
            <label>A<input type="number" class="di-rl-a" value="${esc(rl.A || '')}" step="any" placeholder="N"></label>
            <label>B<input type="number" class="di-rl-b" value="${esc(rl.B || '')}" step="any" placeholder="N/(km/h)"></label>
            <label>C<input type="number" class="di-rl-c" value="${esc(rl.C || '')}" step="any" placeholder="N/(km/h)²"></label>
            <label>質量<input type="number" class="di-rl-mass" value="${esc(rl.mass || '')}" step="any" placeholder="kg"></label>
        </div>`;
        const body = entry.result
            ? buildDriveIndexTable(entry.result)
            : `<p class="di-empty">${esc(entry.reason || '計算できませんでした')}</p>`;
        return `<div class="di-file-section">${head}${alignInputs}${rlInputs}${body}</div>`;
    }).join('');
}

/**
 * 「時間,車速」テキスト（Excel/CSV貼り付け）を { time:[], speed:[] } にパースする。
 * 区切りはカンマ/タブ/セミコロン/空白。各行の先頭2つの数値を時間・車速とし、見出し等の非数値行はスキップ。
 * 時間は単調増加・2点以上が必要。
 * @returns {{ ok:boolean, trace?, error?, count?, duration?, maxSpeed? }}
 */
function parseTimeSpeedText(text) {
    if (!text || !text.trim()) return { ok: false, error: 'データが空です' };
    const time = [], speed = [];
    for (const line of text.replace(/\r/g, '').split('\n')) {
        const s = line.trim();
        if (!s) continue;
        const parts = s.split(/[,\t; ]+/).map(x => parseFloat(x));
        if (parts.length < 2 || !isFinite(parts[0]) || !isFinite(parts[1])) continue; // 見出し行等はスキップ
        time.push(parts[0]); speed.push(parts[1]);
    }
    if (time.length < 2) return { ok: false, error: '有効な「時間,車速」が2行以上必要です' };
    for (let i = 1; i < time.length; i++) {
        if (time[i] <= time[i - 1]) return { ok: false, error: `時間が単調増加していません（${time[i - 1]} → ${time[i]}）` };
    }
    let maxSpeed = 0;
    for (const v of speed) if (v > maxSpeed) maxSpeed = v;
    return { ok: true, trace: { time, speed }, count: time.length, duration: time[time.length - 1] - time[0], maxSpeed };
}

/** ドライビングインデックスの詳細モーダルを開く（モード/チャンネル/係数/フェーズ編集＋指標表） */
function showDriveIndexModal() {
    const mainFile = getMainFile();
    if (!mainFile) { alert('先にファイルを読み込んでください。'); return; }
    const di = state.driveIndex;
    const REG = window.DriveIndex.CYCLE_REGISTRY;

    const colNames  = mainFile.columns.filter(c => !c.isCustom).map(c => c.name);
    const speedOpts = sel => colNames.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const fuelOpts  = sel => `<option value="" ${!sel ? 'selected' : ''}>（なし）</option>`
        + colNames.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
    // 目標車速: 既定は選択モードの法規トレース（value=""）。CSV列を明示選択した時だけその列を目標にする。
    const targetOpts = sel => `<option value="" ${!sel ? 'selected' : ''}>（選択モードの法規トレースを使用）</option>`
        + colNames.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
    // 走行モード: 内蔵サイクル＋カスタムモード（独自モードは optgroup でまとめる）
    const cycleOpts = () => {
        const cur = window.DriveIndex.resolveCycleId(di.cycleId);
        let html = `<option value="" ${di.cycleId == null ? 'selected' : ''}>自動判別（データ長から）</option>`;
        html += REG.map(c => `<option value="${c.id}" ${cur === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
        const cm = state.customModes || [];
        if (cm.length) {
            html += `<optgroup label="カスタムモード">`
                + cm.map(m => `<option value="${esc(m.id)}" ${cur === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')
                + `</optgroup>`;
        }
        return html;
    };
    const detName = di.lastResult ? di.lastResult.detectedName : '—';

    const { modal, close } = createModal(`
        <h3 id="drive-index-title"><i class='bx bx-tachometer'></i> Driving Index（モード走行品質・燃費）</h3>
        <p class="di-detected">自動判別: <strong>${esc(detName)}</strong>　<span class="di-note">目標車速は選択モードの法規トレースを使用。走行抵抗はファイルごとに各表の上で入力できます</span></p>
        <div class="di-controls">
            <label>走行モード<select class="di-cycle">${cycleOpts()}</select></label>
            <label>目標車速<select class="di-ch-target">${targetOpts(di.channels.target)}</select></label>
            <label>実測車速<select class="di-ch-actual">${speedOpts(di.channels.actual)}</select></label>
            <label>燃料流量<select class="di-ch-fuel">${fuelOpts(di.channels.fuel)}</select></label>
            <label class="di-align-toggle"><input type="checkbox" class="di-auto-align" ${di.autoAlign ? 'checked' : ''}>前後の余分データを自動整合</label>
        </div>
        <details class="di-custom-modes">
            <summary>カスタムモードを追加（MDC等・時間-車速を貼り付け）</summary>
            <div class="di-cm-body">
                <div class="di-cm-list"></div>
                <div class="di-cm-form">
                    <input type="text" class="di-cm-name" placeholder="モード名（例: MDC）">
                    <textarea class="di-cm-data" rows="5" placeholder="時間,車速 を1行ずつ貼り付け（Excel/CSVからコピペ可）&#10;0,0&#10;1,0.5&#10;2,1.8&#10;..."></textarea>
                    <div class="di-cm-msg"></div>
                    <button class="btn-primary btn-sm di-cm-add"><i class='bx bx-plus'></i> モード追加</button>
                </div>
            </div>
        </details>
        <div class="di-phase-edit">
            <div class="di-phase-head">フェーズ区間 [秒]<button class="btn-secondary btn-sm di-phase-add">+ 行追加</button></div>
            <div class="di-phase-rows"></div>
        </div>
        <div class="di-result"></div>
        <div class="modal-actions">
            <button class="btn-secondary di-close">閉じる</button>
            <button class="btn-primary di-recompute"><i class='bx bx-refresh'></i> 再計算</button>
        </div>`, {
        modalClass: 'drive-index-modal',
        labelledBy: 'drive-index-title',
    });

    // ── フェーズ編集行 ──
    const phaseRowsEl = modal.querySelector('.di-phase-rows');
    // モードID（内蔵＋カスタム）から既定フェーズを取得。手動編集の比較・初期化に使う。
    const registryPhasesOf = id => {
        const m = driveModeById(id);
        return (m && m.phases) ? m.phases.map(p => ({ ...p })) : [];
    };
    const renderPhaseRows = phases => {
        phaseRowsEl.innerHTML = phases.map(p => `
            <div class="di-phase-row">
                <input type="text" class="di-p-name" value="${esc(p.name)}">
                <input type="number" class="di-p-start" value="${p.start}" step="any">
                <span class="di-p-sep">–</span>
                <input type="number" class="di-p-end" value="${p.end}" step="any">
                <button class="di-p-del" title="この区間を削除">×</button>
            </div>`).join('');
        phaseRowsEl.querySelectorAll('.di-p-del').forEach(b =>
            b.addEventListener('click', e => e.target.closest('.di-phase-row').remove()));
    };
    const readPhaseRows = () => [...phaseRowsEl.querySelectorAll('.di-phase-row')].map(r => ({
        name:  r.querySelector('.di-p-name').value.trim() || 'phase',
        start: parseFloat(r.querySelector('.di-p-start').value),
        end:   parseFloat(r.querySelector('.di-p-end').value),
    })).filter(p => isFinite(p.start) && isFinite(p.end));

    // 現在ドロップダウンで選ばれている実効サイクルID（自動なら判別結果）
    const currentEffectiveId = () =>
        modal.querySelector('.di-cycle').value || (di.lastResult ? di.lastResult.detectedId : null);

    // 初期フェーズ＝実効フェーズ（手動編集があればそれ）
    renderPhaseRows(getEffectivePhases(currentEffectiveId()));

    modal.querySelector('.di-phase-add').addEventListener('click', () => {
        const rows = readPhaseRows();
        rows.push({ name: 'phase ' + (rows.length + 1), start: 0, end: 0 });
        renderPhaseRows(rows);
    });
    // モード変更でフェーズ既定値を入れ替え（手動編集はリセット）
    modal.querySelector('.di-cycle').addEventListener('change', e =>
        renderPhaseRows(registryPhasesOf(e.target.value || (di.lastResult ? di.lastResult.detectedId : null))));

    // ── カスタムモード（時間-車速の貼り付け） ──
    const cycleSelectEl = modal.querySelector('.di-cycle');
    const cmListEl = modal.querySelector('.di-cm-list');
    const cmMsgEl  = modal.querySelector('.di-cm-msg');
    const cmNameEl = modal.querySelector('.di-cm-name');
    const cmDataEl = modal.querySelector('.di-cm-data');

    // 走行モードのドロップダウンを現在の state.customModes で再構築（選択はできるだけ維持）
    const refreshCycleSelect = () => {
        const keep = cycleSelectEl.value;
        cycleSelectEl.innerHTML = cycleOpts();
        if ([...cycleSelectEl.options].some(o => o.value === keep)) cycleSelectEl.value = keep;
    };
    // カスタムモード一覧（削除ボタン付き）を描画
    const renderCustomModeList = () => {
        const cm = state.customModes || [];
        if (!cm.length) { cmListEl.innerHTML = '<p class="di-cm-empty">カスタムモードはまだありません。</p>'; return; }
        cmListEl.innerHTML = cm.map(m => {
            const n = (m.trace && m.trace.time) ? m.trace.time.length : 0;
            const dur = n ? (m.trace.time[n - 1] - m.trace.time[0]) : 0;
            return `<div class="di-cm-item">
                <span class="di-cm-item-name">${esc(m.name)}</span>
                <span class="di-cm-item-info">${n}点 / ${dur.toFixed(0)}秒</span>
                <button class="di-cm-del" data-id="${esc(m.id)}" title="削除">×</button>
            </div>`;
        }).join('');
        cmListEl.querySelectorAll('.di-cm-del').forEach(b => b.addEventListener('click', async () => {
            const id = b.getAttribute('data-id');
            const wasSelected = window.DriveIndex.resolveCycleId(di.cycleId) === id;
            state.customModes = (state.customModes || []).filter(m => m.id !== id);
            if (wasSelected) di.cycleId = null; // 選択中なら自動に戻す
            saveSettings();
            renderCustomModeList();
            refreshCycleSelect();
            // 削除したモードを選択中だった場合、結果・フェーズ編集欄が古いモードの表示のまま
            // 残らないよう、自動判別で再計算してから両方を再描画する
            // （<select>のvalueをJSで代入しても'change'イベントは発火しないため、明示的な更新が必要）。
            if (wasSelected) {
                await computeDriveIndex({ autoDetect: false });
                renderResult();
                renderPhaseRows(getEffectivePhases(currentEffectiveId()));
            }
        }));
    };
    renderCustomModeList();

    // 貼り付けデータのライブプレビュー（点数・総時間・最高車速）
    cmDataEl.addEventListener('input', () => {
        if (!cmDataEl.value.trim()) { cmMsgEl.textContent = ''; cmMsgEl.className = 'di-cm-msg'; return; }
        const r = parseTimeSpeedText(cmDataEl.value);
        cmMsgEl.textContent = r.ok
            ? `OK: ${r.count}点 / ${r.duration.toFixed(0)}秒 / 最高${r.maxSpeed.toFixed(1)}km/h`
            : r.error;
        cmMsgEl.className = 'di-cm-msg ' + (r.ok ? 'ok' : 'error');
    });

    // カスタムモード追加
    modal.querySelector('.di-cm-add').addEventListener('click', () => {
        const name = cmNameEl.value.trim();
        if (!name) { cmMsgEl.textContent = 'モード名を入力してください'; cmMsgEl.className = 'di-cm-msg error'; return; }
        state.customModes = state.customModes || [];
        if (state.customModes.some(m => m.name === name)) {
            cmMsgEl.textContent = `「${name}」は既に存在します。別の名前にしてください`;
            cmMsgEl.className = 'di-cm-msg error';
            return;
        }
        const r = parseTimeSpeedText(cmDataEl.value);
        if (!r.ok) { cmMsgEl.textContent = r.error; cmMsgEl.className = 'di-cm-msg error'; return; }
        // ID衝突（Date.now()+乱数が同一ミリ秒で偶然一致）を避けるため、既存IDと重複しないことを確認する
        let id;
        do {
            id = 'cm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        } while (state.customModes.some(m => m.id === id));
        state.customModes.push({ id, name, trace: r.trace, phases: [] });
        saveSettings();
        renderCustomModeList();
        refreshCycleSelect();
        cycleSelectEl.value = id;                 // 追加したモードを選択
        renderPhaseRows(registryPhasesOf(id));    // カスタムは既定フェーズ無し（空）
        cmNameEl.value = ''; cmDataEl.value = '';
        cmMsgEl.textContent = `「${name}」を追加しました`; cmMsgEl.className = 'di-cm-msg ok';
    });

    // 結果テーブル描画（ファイル別）
    const renderResult = () => {
        modal.querySelector('.di-result').innerHTML = buildDriveIndexAllTables(di.results, di.roadLoadByFile, di.alignByFile);
    };
    renderResult();

    // 各ファイルの走行抵抗入力を state.roadLoadByFile に取り込む
    const readRoadLoadInputs = () => {
        modal.querySelectorAll('.di-file-rl').forEach(el => {
            const key = el.getAttribute('data-file');
            di.roadLoadByFile[key] = {
                A:    el.querySelector('.di-rl-a').value.trim(),
                B:    el.querySelector('.di-rl-b').value.trim(),
                C:    el.querySelector('.di-rl-c').value.trim(),
                mass: el.querySelector('.di-rl-mass').value.trim(),
            };
        });
    };

    // 各ファイルのサイクル切り出し（開始/終了）入力を state.alignByFile に取り込む。
    //   空欄なら手動上書きを解除（＝自動整合に戻す）。
    const readAlignInputs = () => {
        modal.querySelectorAll('.di-file-align').forEach(el => {
            const key   = el.getAttribute('data-file');
            const start = el.querySelector('.di-al-start').value.trim();
            const end   = el.querySelector('.di-al-end').value.trim();
            if (start === '' && end === '') delete di.alignByFile[key];
            else di.alignByFile[key] = { start, end };
        });
    };

    // 再計算
    modal.querySelector('.di-recompute').addEventListener('click', async () => {
        di.cycleId = modal.querySelector('.di-cycle').value || null;
        di.channels = {
            target: modal.querySelector('.di-ch-target').value || null,
            actual: modal.querySelector('.di-ch-actual').value || null,
            fuel:   modal.querySelector('.di-ch-fuel').value || null,
        };
        di.autoAlign = modal.querySelector('.di-auto-align').checked;
        readRoadLoadInputs(); // ファイル別の走行抵抗を取り込む
        readAlignInputs();    // ファイル別のサイクル切り出し（開始/終了）を取り込む
        // 編集フェーズが既定と同じなら override 解除（＝自動追従に戻す）
        const edited   = readPhaseRows();
        const defaults = registryPhasesOf(currentEffectiveId());
        const same = edited.length === defaults.length &&
            edited.every((p, i) => p.name === defaults[i].name && +p.start === +defaults[i].start && +p.end === +defaults[i].end);
        di.phaseOverride = same ? null : edited;

        await computeDriveIndex({ autoDetect: false });
        renderResult();
        saveSettings();
    });

    modal.querySelector('.di-close').addEventListener('click', close);
}

// ツールバーの Driving Index ボタン → 詳細モーダルを開く
dom.driveIndexBtn?.addEventListener('click', showDriveIndexModal);

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

    return results.slice(0, SUGGEST_MAX_ITEMS);
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
    _validateTimer = setTimeout(validateCustomExpr, VALIDATE_DEBOUNCE_MS);
};

/**
 * 式を検証し結果を返す（DOM非依存・追加フォームと編集モーダルで共用）。
 * @param {string} expr 検証する式
 * @returns {{ ok: boolean, text: string, cls: ''|'error'|'preview' }}
 *   ok   … 追加/保存してよいか（true=有効）
 *   text … 表示メッセージ（プレビュー統計 or エラー文）
 *   cls  … 付与するCSSクラス（''=なし / 'error' / 'preview'）
 */
function evaluateExprForValidation(expr) {
    expr = String(expr || '').trim();
    // 空欄は「まだ何も入力していない」状態。エラー扱いせず追加は許可する
    if (!expr) return { ok: true, text: '', cls: '' };

    const mainFile = getMainFile();
    if (!mainFile) return { ok: false, text: 'ファイルを読み込んでください', cls: 'error' };

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
                    // 次が'('なので関数呼び出し → 関数名チェック（大文字小文字は区別しない）
                    if (!_builtinFuncNames.has(t.value.toLowerCase())) {
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

    // 3. ASTを走査して関数の引数個数をチェック（mavg(X) のような引数不足を検出）
    if (errors.length === 0) {
        try {
            const checkArity = (node) => {
                if (!node || typeof node !== 'object') return;
                if (node.type === 'call') {
                    const fname = String(node.name).toLowerCase();
                    const expected = _builtinFuncArity.get(fname);
                    if (expected != null && node.args.length !== expected) {
                        errors.push(`"${node.name}" は引数が${expected}個必要です（${node.args.length}個指定）`);
                    }
                    node.args.forEach(checkArity);
                } else if (node.type === 'binop') {
                    checkArity(node.left);
                    checkArity(node.right);
                } else if (node.type === 'unary') {
                    checkArity(node.operand);
                }
            };
            checkArity(parseExprToAST(expr));
        } catch (e) {
            errors.push('式の構文エラー: ' + e.message);
        }
    }

    if (errors.length > 0) {
        // 重複除去して最大3件表示
        const unique = [...new Set(errors)].slice(0, 3);
        return { ok: false, text: unique.join(' / '), cls: 'error' };
    }

    // 4. 計算結果プレビュー（エラーがなければ）
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
            return { ok: false, text: '⚠ 全値がNaN — 参照チャンネルのデータを確認してください', cls: 'error' };
        }
        const avg = sum / cnt;
        // 数値を見やすくフォーマット（小数4桁まで）
        const fmt = (v) => Math.abs(v) >= 1000 ? v.toFixed(1) : v.toPrecision(4);
        return { ok: true, text: `min: ${fmt(min)} / max: ${fmt(max)} / avg: ${fmt(avg)}`, cls: 'preview' };
    } catch (e) {
        return { ok: false, text: '計算エラー: ' + e.message, cls: 'error' };
    }
}

/** 追加フォームの式入力をライブ検証し、結果をDOM（検証行・Addボタン）へ反映する薄いラッパー */
function validateCustomExpr() {
    const { ok, text, cls } = evaluateExprForValidation(dom.customExpr.value);
    dom.customValidation.textContent = text;
    dom.customValidation.className = 'custom-ram-validation' + (cls ? ' ' + cls : '');
    dom.customAdd.disabled = !ok;
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
    let html = `<h3 id="custom-ram-help-title" style="margin:0 0 12px;color:var(--accent-soft);">Custom RAM 関数リファレンス</h3>`;

    // 演算子
    html += `<h4 style="margin:12px 0 6px;color:#f59e0b;font-size:12px;">演算子</h4>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:8px;">`;
    const ops = [
        ['+, -, *, /', '四則演算'],
        ['^', 'べき乗（例: X^2）'],
        ['( )', '括弧でグループ化'],
        ['>, <, >=, <=, ==, !=', '比較（結果は 1/0。例: SPD > 120）'],
        ['&&, ||', '論理積・論理和（例: SPD > 60 && GEAR == 4）'],
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
        html += `<div style="margin-bottom:4px;"><span style="color:var(--accent-soft);">${esc(ex)}</span> <span style="color:#a0a5b1;font-size:10px;">— ${esc(desc)}</span></div>`;
    }
    html += `</div>`;

    // モーダル表示
    // aria-labelledby でスクリーンリーダーがモーダルのタイトルを読み上げられるようにする
    const { modal, close } = createModal(html + MODAL_CLOSE_FOOTER, {
        modalClass: 'custom-ram-help-modal',
        labelledBy: 'custom-ram-help-title',
    });
    modal.querySelector('.modal-close-btn').addEventListener('click', close);
}

// チャンネル検索はキーストロークごとにリスト全体を再構築するため、SEARCH_DEBOUNCE_MSでdebounceする。
// プログラムからの renderColumnList() 直接呼び出しは従来どおり即時実行される。
let _colSearchTimer = null;
dom.colSearch.addEventListener('input', () => {
    clearTimeout(_colSearchTimer);
    _colSearchTimer = setTimeout(renderColumnList, SEARCH_DEBOUNCE_MS);
});

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

            // ── チャンネル個別の線の太さ ──────────────────────
            // 個別指定があればその値、なければ一括値(state.lineWidth)を初期表示する
            const hasOwnWidth = col.name in state.channelLineWidths;
            const lwRow = document.createElement('div');
            lwRow.className = 'col-linewidth';
            lwRow.addEventListener('click', e => e.stopPropagation());
            lwRow.innerHTML = `
                <span class="col-linewidth-label">太さ</span>
                <input type="range" class="col-linewidth-range" min="0.5" max="5" step="0.5"
                    value="${hasOwnWidth ? state.channelLineWidths[col.name] : state.lineWidth}">
                <span class="col-linewidth-value">${Number(hasOwnWidth ? state.channelLineWidths[col.name] : state.lineWidth).toFixed(1)}</span>
                <button type="button" class="col-linewidth-reset${hasOwnWidth ? ' active' : ''}"
                    title="一括の太さに戻す">⟲</button>
            `;
            item.appendChild(lwRow);

            const lwRange = lwRow.querySelector('.col-linewidth-range');
            const lwValue = lwRow.querySelector('.col-linewidth-value');
            const lwReset = lwRow.querySelector('.col-linewidth-reset');
            // スライダー操作: このチャンネルの個別太さを設定
            lwRange.addEventListener('input', () => {
                const w = parseFloat(lwRange.value);
                state.channelLineWidths[col.name] = w;
                lwValue.textContent = w.toFixed(1);
                lwReset.classList.add('active');
                renderChart();
                saveSettings();
            });
            // リセット: 個別指定を消して一括値に従わせる
            lwReset.addEventListener('click', e => {
                e.stopPropagation();
                delete state.channelLineWidths[col.name];
                lwRange.value = state.lineWidth;
                lwValue.textContent = Number(state.lineWidth).toFixed(1);
                lwReset.classList.remove('active');
                renderChart();
                saveSettings();
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

    // 内容は render() が後から流し込むため contentHtml は空でよい
    const { modal, close } = createModal('', {
        modalClass: 'channel-map-modal',
        labelledBy: 'channel-map-title',
    });

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
            <h3 id="channel-map-title" style="margin:0 0 10px;color:var(--accent-soft);">Channel Map</h3>
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
        modal.querySelector('#alias-close-btn').addEventListener('click', close);
    };

    render();
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

    // 候補を相関の大きい順に並べるため、対象チャンネルのデータを両ファイルで先読みする。
    // （相関の計算にデータが要るので、モーダル表示の前にロードしておく）
    const mainFileId = getMainFileId();
    await Promise.all([
        loadColumnsForFile(mainFileId, alignableNames),
        loadColumnsForFile(subFileId, getResolvedNamesForFile(subFile, alignableNames)),
    ]);

    // 各チャンネルのメイン↔サブ相関（絶対値）を計算し、大きい順に並べ替える。
    const corrMap = computeAlignCorrelations(mainFile, subFile, alignableNames);
    const sortedNames = [...alignableNames].sort(
        (a, b) => (corrMap.get(b) ?? -1) - (corrMap.get(a) ?? -1)
    );

    // --- チャンネル選択モーダルを表示（相関順・強相関を初期チェック）---
    const selectedChannels = await showAlignChannelModal(sortedNames, subFileId, corrMap);
    if (!selectedChannels || !selectedChannels.names.length) return; // キャンセル

    const chosenNames = selectedChannels.names;
    const searchRange = selectedChannels.range; // 探索範囲（秒）
    // 選択チャンネルのデータは上で先読み済み（loadColumnsForFileはキャッシュ済みなら即返る）

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
    // 自動整合で決めたオフセットもクロスファイルCustom RAMの計算へ反映する
    await applyOffsetChange();
    saveSettings(); // 手動入力と同様にオフセットを永続化（Undo履歴にも記録）
}

/**
 * Auto-align用のチャンネル選択＆探索範囲設定モーダル。
 * ユーザーが使いたいチャンネルにチェックを入れて「実行」を押す。
 * 候補は呼び出し側で相関の大きい順に整列済み。相関の強いものを初期チェックする。
 * @param {string[]} commonNames 相関降順に整列済みのチャンネル名
 * @param {string} subFileId サブファイルID
 * @param {Map<string, number>} corrMap チャンネル名→|相関係数|（0〜1）
 * @returns {Promise<{names: string[], range: number}|null>} 選択結果、またはキャンセル時null
 */
function showAlignChannelModal(commonNames, subFileId, corrMap = new Map()) {
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

        // 初期チェックの基準: 相関 |r| >= 0.7（統計の慣用で「強い相関」）。
        // ただし最上位（commonNamesは相関降順）は必ずONにして、最低1つは選ばれるようにする。
        const CORR_STRONG = 0.7;
        const topName = commonNames[0];
        const isRecommended = (name) =>
            name === topName || (corrMap.get(name) ?? 0) >= CORR_STRONG;

        const modal = document.createElement('div');
        modal.id = 'align-channel-modal';
        // デバッグモーダルと同じインラインスタイルで統一
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';

        // チャンネルリストを生成（相関の大きい順。強相関だけ初期チェック）
        const channelItems = commonNames.map(name => {
            const checked = isRecommended(name) ? 'checked' : '';
            const resolved = resolveColumnForFile(subFile, name);
            const aliasText = resolved && resolved.name !== name
                ? `<span style="color:#86efac;font-size:11px;">← ${esc(resolved.name)}</span>`
                : '';
            // 相関係数バッジ（強=緑 / 中=黄 / 弱=灰）。右端に寄せる
            const corr = corrMap.get(name);
            const corrColor = corr == null ? '#9ca3af' : corr >= 0.7 ? '#86efac' : corr >= 0.4 ? '#fcd34d' : '#9ca3af';
            const corrBadge = `<span style="margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums;color:${corrColor};" title="メイン↔サブの相関（絶対値、1に近いほど波形が似ている）">r=${corr != null ? corr.toFixed(2) : '—'}</span>`;
            // チェックボックス＋チャンネル名のラベル
            return `<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:13px;transition:background 0.15s;"
                onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'">
                <input type="checkbox" value="${esc(name)}" ${checked} style="accent-color:#6366f1;"> ${esc(name)} ${aliasText} ${corrBadge}
            </label>`;
        }).join('');

        modal.innerHTML = `
            <div style="background:#1a1d24;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:24px 28px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#f0f0f0;font-family:Inter,sans-serif;">
                <h3 style="margin:0 0 8px;font-size:16px;"><i class='bx bx-target-lock'></i> Auto-Align 設定</h3>
                <p style="color:#a0a5b1;font-size:12px;margin-bottom:16px;line-height:1.5;">
                    位置合わせに使うチャンネルと探索範囲を指定してください。<br>
                    相関（r）の高い順に並べ、おすすめ（r≧0.7）を初期選択しています。
                    波形がよく似たチャンネルほど位置合わせの精度が上がります（例: 目標車速）。
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

/**
 * Auto-Align候補の並べ替え用に、各チャンネルの「メイン↔サブ相関係数（絶対値）」を計算する。
 * メインの時間軸上でサブを現在のオフセットで補間し、ピアソン相関を求める。
 * 相関が強い（波形がよく似ている）チャンネルほど位置合わせの基準として信頼できる。
 * 定数チャンネル（変化なし）は分散≈0なので相関0扱いになり、おすすめから自然に外れる。
 * @param {object} mainFile メインファイル
 * @param {object} subFile  サブファイル
 * @param {string[]} names  対象チャンネル名（メイン基準の名前）
 * @returns {Map<string, number>} チャンネル名 → |相関係数|（0〜1、計算不能は0）
 */
function computeAlignCorrelations(mainFile, subFile, names) {
    const mTd = mainFile.timeData;
    const sTd = subFile.timeData;
    const len = mTd.length;
    const offset = subFile.offset || 0;
    // 計算量を抑えるため最大2000点にダウンサンプル（RMSE探索と同じ方針）
    const step = Math.max(1, Math.floor(len / 2000));
    const map = new Map();

    for (const name of names) {
        const mc = mainFile.columns.find(c => c.name === name);
        const sc = resolveColumnForFile(subFile, name);
        const mVals = mc && mainFile.colData[mc.id];
        const sVals = sc && subFile.colData[sc.id];
        if (!mVals || !sVals) { map.set(name, 0); continue; }

        // メイン時間軸上で両者をサンプリングしてピアソン相関の各種和を蓄積する
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (let i = 0; i < len; i += step) {
            const t = mTd[i];
            const tSub = t - offset;
            // サブの範囲外は外挿せずスキップ（RMSE探索と揃える）
            if (tSub < sTd[0] || tSub > sTd[sTd.length - 1]) continue;
            const x = mVals[i];
            const y = interpolate(sTd, sVals, tSub);
            if (isNaN(x) || isNaN(y)) continue;
            n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        }
        if (n < 3) { map.set(name, 0); continue; }
        // 相関係数 r = cov(x,y) / (σx·σy)。和の形から算出（n倍したまま比をとる）
        const cov = sxy - sx * sy / n;
        const vx  = sxx - sx * sx / n;
        const vy  = syy - sy * sy / n;
        const denom = Math.sqrt(vx * vy);
        // 分母≈0（どちらかが定数＝変化なし）は位置合わせに使えないので相関0扱い
        const r = denom > 1e-12 ? cov / denom : 0;
        map.set(name, Math.min(1, Math.abs(r))); // 強さで順位付けするので符号は捨てて絶対値
    }
    return map;
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

            // クロスファイルの Custom RAM（式に s1: などサブ参照を含む）は
            // メイン時間軸に固定された1本が正しい姿。サブファイル側にも同名カラムが
            // 自動生成されているが、それは別物の曲線になるので描画をスキップする。
            // （メイン参照だけの式は isCrossFile=false なので従来どおりサブ破線も出る）
            if (col.isCustom && col.isCrossFile) continue;

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
    _lastRenderedLookup = buildHoverLookup(active); // ホバー時の線形検索回避用（PF2）
    const { groups, order } = active;
    const n = order.length;

    if (n === 0) {
        state.chart.clear();
        removeArrangeOverlay();
        dom.overlay.classList.remove('hidden');
        dom.resetBtn.disabled = true;
        dom.exportPng.disabled = true;
        dom.copyChart.disabled = true;
        dom.measureBtn.disabled = true;
        dom.statsBtn.disabled = true;
        dom.exportCsv.disabled = true;
        state.numGrids = 0;
        if (state.measureMode) exitMeasureMode(false); // 表示チャンネルが無くなったら計測も解除
        updateStatsPanel(); // グリッドが無くなったらパネルも消す
        return;
    }
    dom.overlay.classList.add('hidden');
    dom.exportPng.disabled = false;
    dom.copyChart.disabled = false;
    dom.resetBtn.disabled = false;
    dom.measureBtn.disabled = false;
    dom.statsBtn.disabled = false;
    dom.exportCsv.disabled = false;
    state.numGrids = n;

    // フォントスケールと、それに連動する余白(数値ラベル幅・軸名間隔・左マージン)
    const F  = CSVLayout.getFontSizes(state.fontScale);
    const DL = CSVLayout.deriveLayout(F);

    const topPx  = L.topPx;
    const botPx  = L.bottomPx;
    const gapPx  = L.gapPx;

    // Bitチャンネルのグリッドは通常の1/3の高さにする
    // 各グリッドの「重み」（Bit = BIT_WEIGHT, 通常 = 1.0）を純粋関数で計算
    const gridWeights = CSVChartOptions.computeGridWeights(
        order.map(gid => groups.get(gid).mergedNames), state.bitChannels);

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
    const { min: globalXMin, max: globalXMax } = CSVChartOptions.computeGlobalXRange(
        Object.values(state.files)
            .filter(f => f.timeData && f.timeData.length > 0)
            .map(f => ({ first: f.timeData[0], last: f.timeData[f.timeData.length - 1], offset: f.offset || 0 })));

    const AXIS_GAP = DL.axisGap; // フォントに連動(大きいフォントで軸同士が重ならないように)
    const groupLayouts = CSVChartOptions.computeGroupLayouts(
        order.map(groupId => Math.max(groups.get(groupId).axes.length, 1)),
        { gridLeft: DL.gridLeft, gridRight: L.gridRight, axisGap: AXIS_GAP });
    const { left: xSliderLeft, right: xSliderRight } = CSVChartOptions.computeSliderBounds(groupLayouts);
    const narrowPlotWidth = state.chart.getWidth() - xSliderLeft - xSliderRight;
    const warningKey = CSVChartOptions.deriveNarrowWarningKey(narrowPlotWidth, groupLayouts.map(l => l.axisCount));
    if (warningKey && state.axisLayoutWarningKey !== warningKey) {
        state.axisLayoutWarningKey = warningKey;
        showWarning('Y軸が多いため描画領域が狭くなっています', 'Overlay Settings で軸を共有すると表示幅を広げられます。');
    } else if (!warningKey) {
        state.axisLayoutWarningKey = '';
    }

    // X-axis slider (bottom, all grids linked) + inside zoom (scroll + pan)
    const xStart = savedXZoom ? savedXZoom.start : 0;
    const xEnd   = savedXZoom ? savedXZoom.end   : 100;
    dataZooms.push(...CSVChartOptions.buildXDataZooms({
        gridCount: n, start: xStart, end: xEnd,
        left: xSliderLeft, right: xSliderRight,
        theme: T, sliderFontSize: F.slider,
        // シフト/Arrangeモード中はドラッグパンを無効化する
        panEnabled: !state.shiftMode && !state.arrangeMode,
    }));

    const yAxisIndexByGroup = new Map();
    let _cumulativeTop = topPx;
    order.forEach((groupId, i) => {
        const grp    = groups.get(groupId);
        const gridH  = gridHeights[i];
        const topPxI = _cumulativeTop;
        _cumulativeTop += gridH + gapPx;
        const layout = groupLayouts[i];

        grids.push({
            left: layout.left, right: layout.right,
            top: pct(topPxI), height: pct(gridH),
            containLabel: false,
        });

        xAxes.push(CSVChartOptions.buildXAxisOption({
            gridIndex: i, isLast: i === n - 1,
            min: globalXMin, max: globalXMax,
            fontSize: F.label, theme: T,
        }));

        const axisIndexMap = new Map();
        const axisSpecs = new Map();
        grp.axes.forEach((axis, axisOrder) => {
            const assignedNames = grp.channels.filter(ch => ch.axisId === axis.id).map(ch => ch.name);
            if (!assignedNames.length) return;
            // 代表チャンネル・Y範囲・左右位置の解決（純粋関数）
            const axisSpec = CSVChartOptions.computeAxisSpec({
                assignedNames,
                preferredRepresentative: axis.representative,
                yRanges: state.yRanges,
                bitChannels: state.bitChannels,
                axisOrder,
                axisGap: AXIS_GAP,
            });
            const units = getAxisDisplayUnit(getChartGroupById(groupId), axis.id);
            const yAxisIndex = yAxes.length;
            axisIndexMap.set(axis.id, yAxisIndex);
            axisSpecs.set(axis.id, axisSpec);

            yAxes.push(CSVChartOptions.buildYAxisOption({
                gridIndex: i,
                axisSpec,
                assignedNames,
                units,
                axisOrder,
                nameGap: DL.nameGap,
                nameFontSize: F.name,
                labelFontSize: F.label,
                labelWidth: DL.labelWidth,
                nameTruncateMaxWidth: CSVLayout.truncateMaxWidth(gridH),
                theme: T,
            }));

            dataZooms.push(CSVChartOptions.buildYSliderZoom({
                yAxisIndex, axisOrder,
                top: pct(topPxI), height: pct(gridH),
                yZoomRight: L.yZoomRight,
            }));
        });
        yAxisIndexByGroup.set(groupId, axisIndexMap);

        const firstSeriesByAxis = new Set();
        grp.series.forEach(s => {
            const yAxisIndex = axisIndexMap.get(s.axisId);
            if (yAxisIndex === undefined) return;
            const isFirstForAxis = !firstSeriesByAxis.has(s.axisId);
            firstSeriesByAxis.add(s.axisId);
            // markArea / markLine（Y範囲の帯と境界線）はbuildSeriesOption内で
            // 「軸ごとの最初のシリーズ」にだけ付与される
            series.push(CSVChartOptions.buildSeriesOption(s, {
                xAxisIndex: i,
                yAxisIndex,
                isFirstForAxis,
                axisSpec: axisSpecs.get(s.axisId),
                showMarkers: state.showMarkers,
                sampling: dom.sampling.value || false,
                lineWidth: state.channelLineWidths[s.channelName] ?? state.lineWidth,
                labelFontSize: F.label,
            }));
        });
    });

    // イベント検出結果の区間ハイライト（markArea）を各グリッドに重ねる
    if (state.events.intervals.length) {
        const areaData = state.events.intervals.map(iv => [{ xAxis: iv.t0 }, { xAxis: iv.t1 }]);
        order.forEach((groupId, gi) => {
            const yIdxMap = yAxisIndexByGroup.get(groupId);
            const yAxisIndex = yIdxMap && yIdxMap.size ? yIdxMap.values().next().value : 0;
            series.push({
                id: `event-area-${gi}`,
                type: 'line', data: [],
                xAxisIndex: gi, yAxisIndex,
                silent: true, animation: false,
                markArea: {
                    silent: true, animation: false,
                    itemStyle: { color: EVENT_AREA_COLOR },
                    data: areaData,
                },
            });
        });
    }

    // 計測カーソル（縦線）を各グリッドに重ねる。markLineのxAxis値指定なので
    // ズーム・リサイズには自動追従する
    if (state.measureMode && state.measure.tA != null) {
        const cursorData = [{ name: 'A', xAxis: state.measure.tA }];
        if (state.measure.tB != null) cursorData.push({ name: 'B', xAxis: state.measure.tB });
        order.forEach((groupId, gi) => {
            const yIdxMap = yAxisIndexByGroup.get(groupId);
            const yAxisIndex = yIdxMap && yIdxMap.size ? yIdxMap.values().next().value : 0;
            series.push({
                id: `measure-cursor-${gi}`,
                type: 'line', data: [],
                xAxisIndex: gi, yAxisIndex,
                silent: true, animation: false,
                markLine: {
                    symbol: 'none', animation: false,
                    lineStyle: { color: T.accent, width: 1.2, type: 'dashed' },
                    label: {
                        show: gi === 0, position: 'insideStartTop',
                        formatter: p => p.name, color: T.accent, fontWeight: 700,
                    },
                    emphasis: { disabled: true },
                    data: cursorData,
                },
            });
        });
        updateMeasurePanel();
    }

    // 全グリッド共通の静的オプション（axisPointer / tooltipの見た目 / brush）は純粋関数で構築
    const baseOption = CSVChartOptions.buildBaseChartOption({
        theme: { crosshair: T.crosshair, tooltipBg: T.tooltipBg, tooltipBorder: T.tooltipBorder },
    });
    // tooltip formatterだけはモジュール状態（_lastTooltipParams / updatePerGridLabels /
    // フォント設定）に依存するためrenderChart側で注入する
    baseOption.tooltip.formatter = params => {
        if (!params || !params.length) return '';
        _lastTooltipParams = params;
        updatePerGridLabels();
        const t = params[0].axisValue;
        const tStr = typeof t === 'number' ? t.toFixed(3) : String(t);
        return `<span style="font-family:'Roboto Mono',monospace;font-size:${F.tooltip}px;color:var(--accent-soft);font-weight:600">t = ${tStr} s</span>`;
    };

    state.chart.setOption({
        ...baseOption,
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
    updateStatsPanel(); // 表示範囲サマリをズーム/再描画に追従させる
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

// ホバー経路の参照スナップショット（_lastRenderedGroups方式の拡張）。
// updatePerGridLabels内の columns.find / getSubFileIds / resolveColumnForFile は
// チャンネルごとの線形検索なので、描画時にMap化して保存しホバー時は参照のみにする。
// 状態変更（エイリアス・ファイル構成含む）は必ずrenderChartを通るため無効化不要。
let _lastRenderedLookup = null;

/**
 * updatePerGridLabelsが必要とする参照をまとめたスナップショットを構築する。
 * renderChartから描画のたびに呼ばれる。
 * @param {{groups: Map, order: string[]}} active getActiveGroups() の結果
 * @returns {{mainFile: object|null, colByName: Map, subIds: string[], subColByName: Map}}
 *   colByName    … メインファイルの チャンネル名 → カラムレコード
 *   subColByName … サブファイルID → (チャンネル名 → 解決済みカラムレコード)
 */
function buildHoverLookup(active) {
    const mainFile = getMainFile() || null;
    const subIds = getSubFileIds();
    const colByName = new Map();
    const subColByName = new Map(subIds.map(id => [id, new Map()]));
    if (mainFile) {
        for (const gid of active.order) {
            const grp = active.groups.get(gid);
            if (!grp) continue;
            for (const chName of grp.mergedNames) {
                if (!colByName.has(chName)) {
                    colByName.set(chName, mainFile.columns.find(c => c.name === chName) || null);
                }
                for (const subId of subIds) {
                    const m = subColByName.get(subId);
                    if (!m.has(chName)) {
                        m.set(chName, resolveColumnForFile(state.files[subId], chName) || null);
                    }
                }
            }
        }
    }
    return { mainFile, colByName, subIds, subColByName };
}

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

    // renderChartが保存した参照スナップショットを使う（PF2）。
    // ここで getMainFile / columns.find / getSubFileIds / resolveColumnForFile を
    // 呼び直すと毎mousemoveで線形検索が走るため、参照のみにする
    const lookup = _lastRenderedLookup;
    const mainFile = lookup && lookup.mainFile;
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
            const mc = lookup.colByName.get(chName);
            if (mc && mainFile.colData[mc.id]) {
                const val = interpolate(mainFile.timeData, mainFile.colData[mc.id], xVal);
                if (!isNaN(val)) {
                    entries.push({ color: mc.color, valStr: fmtVal(val), fileName: mainFile.shortName, val, yAxisIndex });
                }
            }

            // Sub files
            for (const subId of lookup.subIds) {
                const sf = state.files[subId];
                const sc = lookup.subColByName.get(subId).get(chName);
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
        el.style.cssText = 'position:absolute;font-family:"Roboto Mono",monospace;font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px;white-space:nowrap;background:var(--tooltip-bg);border:1px solid var(--tooltip-border);pointer-events:none;';
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
dom.measureBtn.addEventListener('click', toggleMeasureMode);

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
    if (state.measureMode) exitMeasureMode();
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
// カーソル計測（Measure / M）: チャートを2回クリックして計測点A/Bを置き、
// 区間 [tA, tB] の Δt と、表示中チャンネルごとの A値/B値/Δ/min/max/mean/RMS を
// フローティングパネルに表示する。カーソル位置・パネルは永続化しない。
// ─────────────────────────────────────────────────────────────

function toggleMeasureMode() { state.measureMode ? exitMeasureMode() : enterMeasureMode(); }

function enterMeasureMode() {
    if (!state.chart || state.numGrids === 0) return;
    if (state.brushMode) exitBoxZoom();
    if (state.shiftMode) exitShiftMode();
    if (state.arrangeMode) exitArrangeMode();
    state.measureMode = true;
    state.measure = { tA: null, tB: null };
    dom.measureBtn.classList.add('btn-active');
    dom.measureBtn.innerHTML = `<i class='bx bx-x'></i> Cancel`;
    dom.hintEl.textContent = 'チャートをクリックして計測点A→Bを指定…';
    dom.chartEl.style.cursor = 'crosshair';
    updateMeasurePanel();
}

/**
 * 計測モードを抜けてカーソル・パネルを消す。
 * @param {boolean} rerender falseなら再描画しない（renderChart内から呼ぶとき用）
 */
function exitMeasureMode(rerender = true) {
    state.measureMode = false;
    state.measure = { tA: null, tB: null };
    dom.measureBtn?.classList.remove('btn-active');
    if (dom.measureBtn) dom.measureBtn.innerHTML = `<i class='bx bx-ruler'></i> Measure`;
    dom.hintEl.textContent = '';
    dom.chartEl.style.cursor = '';
    removeMeasurePanel();
    if (rerender && state.chart && state.numGrids > 0) renderChart();
}

// 計測モード中のクリックで計測点を置く（A→B→置き直し）
dom.chartEl.addEventListener('click', e => {
    if (!state.measureMode || !state.chart) return;
    const rect = dom.chartEl.getBoundingClientRect();
    const t = state.chart.convertFromPixel({ xAxisIndex: 0 }, e.clientX - rect.left);
    if (t == null || !Number.isFinite(t)) return;
    const m = state.measure;
    if (m.tA == null)      m.tA = t;
    else if (m.tB == null) m.tB = t;
    else { m.tA = t; m.tB = null; } // 3回目のクリックはAから置き直し
    renderChart(); // カーソル線の再描画（updateMeasurePanelもrenderChart内で呼ばれる）
});

/**
 * timeDataの [t0, t1] 区間のサンプルを集計する（NaNはスキップ）。
 * @returns {{min:number,max:number,mean:number,rms:number,n:number}|null} 点が無ければnull
 */
function computeIntervalStats(timeData, data, t0, t1) {
    // 二分探索で t0 以上の最初のインデックスを求める
    let lo = 0, hi = timeData.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (timeData[mid] < t0) lo = mid + 1; else hi = mid; }
    let min = Infinity, max = -Infinity, sum = 0, sumSq = 0, n = 0;
    for (let i = lo; i < timeData.length && timeData[i] <= t1; i++) {
        const v = data[i];
        if (Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v; sumSq += v * v; n++;
    }
    if (!n) return null;
    return { min, max, mean: sum / n, rms: Math.sqrt(sumSq / n), n };
}

const MEASURE_PANEL_ID = 'measure-panel';

function removeMeasurePanel() {
    document.getElementById(MEASURE_PANEL_ID)?.remove();
}

/**
 * 計測パネルを現在のカーソル状態に合わせて再構築する。
 * データ参照は renderChart が保存したスナップショット（_lastRenderedLookup /
 * _lastRenderedGroups）のみを使う（守るべき制約と同じ理由で線形検索を避ける）。
 */
function updateMeasurePanel() {
    removeMeasurePanel();
    if (!state.measureMode) return;
    const panel = document.createElement('div');
    panel.id = MEASURE_PANEL_ID;
    panel.className = 'measure-panel';

    const { tA, tB } = state.measure;
    if (tA == null || tB == null) {
        const hint = tA == null
            ? '1点目（A）をクリック'
            : `A = ${esc(tA.toFixed(3))} s — 2点目（B）をクリック`;
        panel.innerHTML = `<div class="measure-title">カーソル計測</div><div class="measure-hint">${hint}</div>`;
    } else {
        panel.innerHTML = buildMeasureTableHTML(Math.min(tA, tB), Math.max(tA, tB));
    }
    document.querySelector('.chart-container')?.appendChild(panel);
}

/**
 * 区間 [t0, t1] の計測テーブルHTMLを構築する。
 * 行 = 表示中の各チャンネル × 各ファイル（main + sub。subはタイムシフト適用済み）。
 */
function buildMeasureTableHTML(t0, t1) {
    const lookup = _lastRenderedLookup;
    const { groups: activeGroups, order: activeOrder } =
        _lastRenderedGroups || { groups: new Map(), order: [] };
    const mainFile = lookup && lookup.mainFile;

    let html = `<div class="measure-title">カーソル計測　`
        + `<span class="measure-dt">Δt = ${esc((t1 - t0).toFixed(3))} s`
        + `（A=${esc(t0.toFixed(3))} / B=${esc(t1.toFixed(3))}）</span></div>`;
    if (!mainFile) return html + `<div class="measure-hint">データがありません</div>`;

    // 行を構築する共通処理: ファイルのtimeData/データ列から統計を取る
    const rows = [];
    const pushRow = (label, color, timeData, data, offset) => {
        const s = computeIntervalStats(timeData, data, t0 - offset, t1 - offset);
        if (!s) return;
        const vA = interpolate(timeData, data, t0 - offset);
        const vB = interpolate(timeData, data, t1 - offset);
        rows.push({ label, color, vA, vB, d: vB - vA, ...s });
    };

    for (const gid of activeOrder) {
        const grp = activeGroups.get(gid);
        if (!grp) continue;
        for (const chName of grp.mergedNames) {
            const mc = lookup.colByName.get(chName);
            if (mc && mainFile.colData[mc.id]) {
                pushRow(chName, mc.color, mainFile.timeData, mainFile.colData[mc.id], 0);
            }
            for (const subId of lookup.subIds) {
                const sf = state.files[subId];
                const sc = lookup.subColByName.get(subId).get(chName);
                if (!sc || !sf.colData[sc.id]) continue;
                pushRow(`${chName} (${sf.shortName})`, sc.color,
                        sf.timeData, sf.colData[sc.id], sf.offset || 0);
            }
        }
    }
    if (!rows.length) return html + `<div class="measure-hint">区間内にデータ点がありません</div>`;

    html += `<table><thead><tr>`
        + `<th>Channel</th><th>A</th><th>B</th><th>Δ</th>`
        + `<th>min</th><th>max</th><th>mean</th><th>RMS</th>`
        + `</tr></thead><tbody>`;
    for (const r of rows) {
        const f = v => Number.isNaN(v) ? '—' : fmtVal(v);
        html += `<tr>`
            + `<td><span class="measure-swatch" style="background:${esc(r.color)}"></span>${esc(r.label)}</td>`
            + `<td>${f(r.vA)}</td><td>${f(r.vB)}</td><td>${f(r.d)}</td>`
            + `<td>${f(r.min)}</td><td>${f(r.max)}</td><td>${f(r.mean)}</td><td>${f(r.rms)}</td>`
            + `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
}

// ─────────────────────────────────────────────────────────────
// 表示範囲の統計サマリ（Stats）: 現在ズームで見えている時間範囲に追従して、
// 表示中チャンネルごとの min / max / mean / σ をパネル表示する。
// 計算は計測（Measure）と同じ computeIntervalStats とスナップショットを使う。
// ─────────────────────────────────────────────────────────────

/**
 * 現在表示中のX軸範囲 [t0, t1] を返す（チャート未描画ならnull）。
 * dataZoomのstartValue/endValueを優先し、%指定しか無ければ軸のmin/maxから換算する。
 */
function getVisibleXRange() {
    const opt = state.chart?.getOption();
    const dz = opt?.dataZoom?.[0];
    const xa = opt?.xAxis?.[0];
    if (!dz || !xa) return null;
    let t0 = (typeof dz.startValue === 'number') ? dz.startValue : null;
    let t1 = (typeof dz.endValue === 'number') ? dz.endValue : null;
    if (t0 == null || t1 == null) {
        if (typeof xa.min !== 'number' || typeof xa.max !== 'number') return null;
        t0 = xa.min + (xa.max - xa.min) * (dz.start ?? 0) / 100;
        t1 = xa.min + (xa.max - xa.min) * (dz.end ?? 100) / 100;
    }
    return [t0, t1];
}

function toggleStatsPanel() {
    state.statsPanelVisible = !state.statsPanelVisible;
    dom.statsBtn.classList.toggle('btn-active', state.statsPanelVisible);
    updateStatsPanel();
    saveSettings();
}

/** 統計サマリパネルを現在の表示範囲に合わせて再構築する（非表示時は消す） */
function updateStatsPanel() {
    const existing = document.getElementById('stats-panel');
    if (!state.statsPanelVisible || !state.chart || state.numGrids === 0) {
        existing?.remove();
        return;
    }
    const range = getVisibleXRange();
    if (!range) { existing?.remove(); return; }

    let panel = existing;
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'stats-panel';
        panel.className = 'stats-panel';
        document.querySelector('.chart-container')?.appendChild(panel);
    }
    panel.innerHTML = buildStatsTableHTML(range[0], range[1]);
}

/** 表示範囲 [t0, t1] の統計テーブルHTML（行 = チャンネル × ファイル） */
function buildStatsTableHTML(t0, t1) {
    const lookup = _lastRenderedLookup;
    const { groups: activeGroups, order: activeOrder } =
        _lastRenderedGroups || { groups: new Map(), order: [] };
    const mainFile = lookup && lookup.mainFile;

    let html = `<div class="measure-title">表示範囲の統計　`
        + `<span class="measure-dt">${esc(t0.toFixed(2))} – ${esc(t1.toFixed(2))} s</span></div>`;
    if (!mainFile) return html + `<div class="measure-hint">データがありません</div>`;

    const rows = [];
    const pushRow = (label, color, timeData, data, offset) => {
        const s = computeIntervalStats(timeData, data, t0 - offset, t1 - offset);
        if (!s) return;
        // σ² = RMS² − mean²（数値誤差で負にならないようクランプ）
        const sigma = Math.sqrt(Math.max(s.rms * s.rms - s.mean * s.mean, 0));
        rows.push({ label, color, min: s.min, max: s.max, mean: s.mean, sigma, n: s.n });
    };

    for (const gid of activeOrder) {
        const grp = activeGroups.get(gid);
        if (!grp) continue;
        for (const chName of grp.mergedNames) {
            const mc = lookup.colByName.get(chName);
            if (mc && mainFile.colData[mc.id]) {
                pushRow(chName, mc.color, mainFile.timeData, mainFile.colData[mc.id], 0);
            }
            for (const subId of lookup.subIds) {
                const sf = state.files[subId];
                const sc = lookup.subColByName.get(subId).get(chName);
                if (!sc || !sf.colData[sc.id]) continue;
                pushRow(`${chName} (${sf.shortName})`, sc.color,
                        sf.timeData, sf.colData[sc.id], sf.offset || 0);
            }
        }
    }
    if (!rows.length) return html + `<div class="measure-hint">表示範囲内にデータ点がありません</div>`;

    html += `<table><thead><tr>`
        + `<th>Channel</th><th>min</th><th>max</th><th>mean</th><th>σ</th><th>n</th>`
        + `</tr></thead><tbody>`;
    for (const r of rows) {
        html += `<tr>`
            + `<td><span class="measure-swatch" style="background:${esc(r.color)}"></span>${esc(r.label)}</td>`
            + `<td>${fmtVal(r.min)}</td><td>${fmtVal(r.max)}</td>`
            + `<td>${fmtVal(r.mean)}</td><td>${fmtVal(r.sigma)}</td><td>${r.n}</td>`
            + `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
}

dom.statsBtn.addEventListener('click', toggleStatsPanel);

// ─────────────────────────────────────────────────────────────
// イベント検出: 条件式（例 Actual_Speed > 120）を式パーサで評価し、
// 真（≠0）が連続する区間をメインファイルから抽出して一覧表示・
// チャート上に markArea でハイライトする。行クリックで区間へズーム。
// ─────────────────────────────────────────────────────────────

// 区間ハイライトの塗り色（canvas描画のため実値。薄い赤は両テーマで見える）
const EVENT_AREA_COLOR = 'rgba(239,68,68,0.14)';
// 検出区間の上限。ノイズ的な条件（例 X != 0）で数万区間できると
// markAreaの描画とリスト構築が固まるため打ち切る
const EVENT_MAX_INTERVALS = 300;

/**
 * 真（NaN以外かつ≠0）が連続する区間を抽出する。
 * @returns {{list: {t0:number, t1:number}[], truncated: boolean}}
 */
function extractTrueIntervals(timeData, vals, cap) {
    const list = [];
    let startIdx = null;
    let truncated = false;
    const push = (endIdx) => list.push({ t0: timeData[startIdx], t1: timeData[endIdx] });
    for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        const on = !Number.isNaN(v) && v !== 0;
        if (on && startIdx === null) startIdx = i;
        if (!on && startIdx !== null) {
            push(i - 1);
            startIdx = null;
            if (list.length >= cap) { truncated = true; break; }
        }
    }
    if (startIdx !== null && !truncated) push(vals.length - 1);
    return { list, truncated };
}

function setEventValidation(text, cls) {
    dom.eventValidation.textContent = text;
    dom.eventValidation.className = 'custom-ram-validation' + (cls ? ' ' + cls : '');
}

/** 検出結果とハイライトをすべて消す */
function clearEvents(rerender = true) {
    const had = state.events.intervals.length > 0;
    state.events = { expr: '', intervals: [] };
    dom.eventSummary.textContent = '';
    dom.eventList.innerHTML = '';
    setEventValidation('', '');
    if (rerender && had && state.chart && state.numGrids > 0) renderChart();
}

/** 条件式を評価してイベント区間を検出し、一覧とハイライトを更新する */
async function detectEvents() {
    const expr = dom.eventExpr.value.trim();
    if (!expr) { clearEvents(); return; }
    const mainFile = getMainFile();
    if (!mainFile) { setEventValidation('ファイルを読み込んでください', 'error'); return; }

    // 参照カラムをロードしてから検証・評価する（未ロード列はNaN扱いになるため）
    const mainFileId = getMainFileId();
    try {
        await loadColumnsForFile(mainFileId, extractExprNames(expr));
    } catch (e) { /* ロード失敗は検証エラーとして下で表面化する */ }

    const v = evaluateExprForValidation(expr);
    if (!v.ok) { setEventValidation(v.text, 'error'); return; }
    setEventValidation('', '');

    const vals = computeCustomExpr(expr, mainFile);
    const { list, truncated } = extractTrueIntervals(mainFile.timeData, vals, EVENT_MAX_INTERVALS);
    state.events = { expr, intervals: list };
    renderEventList(truncated);
    renderChart();
    saveSettings();
}

/** イベント一覧（サマリ行+区間リスト）を再構築する */
function renderEventList(truncated) {
    const { intervals } = state.events;
    dom.eventList.innerHTML = '';

    if (!intervals.length) {
        dom.eventSummary.textContent = '条件を満たす区間はありません';
        return;
    }
    dom.eventSummary.innerHTML =
        `${intervals.length}件${truncated ? `（上限${EVENT_MAX_INTERVALS}件で打ち切り）` : ''}　`
        + `<button type="button" id="event-clear-btn" class="event-clear-btn">クリア</button>`;
    dom.eventSummary.querySelector('#event-clear-btn')
        .addEventListener('click', () => { dom.eventExpr.value = state.events.expr; clearEvents(); });

    intervals.forEach((iv, i) => {
        const li = document.createElement('li');
        li.className = 'event-item';
        li.innerHTML = `<span class="event-idx">${i + 1}</span>`
            + `<span class="event-range">${esc(iv.t0.toFixed(2))} – ${esc(iv.t1.toFixed(2))} s</span>`
            + `<span class="event-dur">${esc((iv.t1 - iv.t0).toFixed(2))} s</span>`;
        li.title = 'クリックでこの区間へズーム';
        li.addEventListener('click', () => zoomToInterval(iv));
        dom.eventList.appendChild(li);
    });
}

/** 区間の前後に余白を付けてX軸ズームする */
function zoomToInterval(iv) {
    if (!state.chart || state.numGrids === 0) return;
    const pad = Math.max((iv.t1 - iv.t0) * 0.3, 1);
    // dataZoomIndex:0（X軸スライダー）を対象にする（守るべき制約: index指定必須）
    state.chart.dispatchAction({
        type: 'dataZoom', dataZoomIndex: 0,
        startValue: iv.t0 - pad, endValue: iv.t1 + pad,
    });
    recordHistory();
}

dom.eventDetectBtn.addEventListener('click', detectEvents);
dom.eventExpr.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); detectEvents(); }
});

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
        if (state.measureMode) { exitMeasureMode(); return; }
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
        if (e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            toggleMeasureMode();
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
        ['Esc',            'Box Zoom / Time Shift / Arrange / Measure モードを抜ける'],
        ['B',              'Box Zoom モードを切り替え'],
        ['T',              'Time Shift モードを切り替え（Sub ファイルが必要）'],
        ['R',              'ズームをリセット（全範囲表示）'],
        ['M',              'カーソル計測モードを切り替え（2回クリックで区間統計）'],
        ['Ctrl + Z',       '直前の操作を元に戻す（ズーム・チャンネル選択・設定など）'],
        ['Ctrl + Y',       '操作をやり直す'],
        ['Ctrl + Shift + Z', '操作をやり直す（Ctrl + Y と同じ）'],
        ['Ctrl + S',       'チャートをPNGとして保存'],
        ['Ctrl + Shift + C', 'チャートをクリップボードにコピー'],
    ];

    let html = `<h3 id="shortcuts-modal-title" style="margin:0 0 12px;color:var(--accent-soft);">キーボードショートカット</h3>`;
    html += `<p style="color:#a0a5b1;font-size:11px;margin:0 0 10px;">入力欄にフォーカスがあるときは単打キー (B / T / R / ?) は無効になります。</p>`;
    html += `<table style="border-collapse:collapse;width:100%;font-size:12px;">`;
    for (const [key, desc] of rows) {
        html += `<tr>`
            + `<td style="padding:5px 8px;color:#6ee7b7;font-family:monospace;white-space:nowrap;vertical-align:top;">${esc(key)}</td>`
            + `<td style="padding:5px 8px;color:#f0f0f0;">${esc(desc)}</td>`
            + `</tr>`;
    }
    html += `</table>`;

    const { modal, close } = createModal(html + MODAL_CLOSE_FOOTER, {
        modalClass: 'shortcuts-modal',
        labelledBy: 'shortcuts-modal-title',
    });
    modal.querySelector('.modal-close-btn').addEventListener('click', close);
}

// ツールバーの ? ボタン（追加予定）からもモーダルを開けるようにする
$('shortcuts-help-btn')?.addEventListener('click', showShortcutsModal);

// テーマ切替（ライト/ダーク）。見た目のみの設定なのでUndo履歴には積まない
$('theme-toggle-btn')?.addEventListener('click', () => {
    applyTheme(state.theme === 'light' ? 'dark' : 'light');
    saveSettings();
});

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

// 線の太さ（一括）スライダー: 全系列の太さをまとめて変更
const lineWidthRange = document.getElementById('line-width-range');
if (lineWidthRange) {
    const lineWidthValue = document.getElementById('line-width-value');
    lineWidthRange.value = state.lineWidth;
    if (lineWidthValue) lineWidthValue.textContent = Number(state.lineWidth).toFixed(1);
    lineWidthRange.addEventListener('input', () => {
        state.lineWidth = parseFloat(lineWidthRange.value);
        if (lineWidthValue) lineWidthValue.textContent = state.lineWidth.toFixed(1);
        renderChart();
        saveSettings();
    });
}
// データ点マーカー表示トグル: 全系列の点表示をまとめて切り替え
const showMarkersChk = document.getElementById('show-markers-chk');
if (showMarkersChk) {
    showMarkersChk.checked = state.showMarkers;
    showMarkersChk.addEventListener('change', () => {
        state.showMarkers = showMarkersChk.checked;
        renderChart();
        saveSettings();
    });
}

if (dom.shiftBtn) dom.shiftBtn.addEventListener('click', toggleShiftMode);
if (dom.arrangeBtn) dom.arrangeBtn.addEventListener('click', toggleArrangeMode);

function toggleShiftMode() { state.shiftMode ? exitShiftMode() : enterShiftMode(); }

function enterShiftMode() {
    if (!getSubFileIds().length) return;
    if (state.brushMode) exitBoxZoom();
    if (state.arrangeMode) exitArrangeMode();
    if (state.measureMode) exitMeasureMode();

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
    if (state.measureMode) exitMeasureMode();
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
        backgroundColor: T.bgMain,          // ダークテーマの背景色（styles.css の --bg-main に追従）
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

    showExportToast('PNGを保存しました', fileName);
}

/**
 * 表示中の時間範囲 × 表示中チャンネル（Custom RAM含む）をCSVで保存する（F6）。
 * 行はメインファイルの時間軸（正規化後の秒）。Subファイルの系列は時間軸が
 * 異なるため含まない。欠損（NaN）は空欄で出力する。
 */
function exportVisibleCSV() {
    const lookup = _lastRenderedLookup;
    const mainFile = lookup && lookup.mainFile;
    if (!mainFile || state.numGrids === 0) return;
    const { groups: activeGroups, order: activeOrder } =
        _lastRenderedGroups || { groups: new Map(), order: [] };

    const range = getVisibleXRange();
    const t0 = range ? Math.min(range[0], range[1]) : -Infinity;
    const t1 = range ? Math.max(range[0], range[1]) : Infinity;

    // 表示順のチャンネル列（メインファイルにデータがあるもののみ・重複除去）
    const cols = [];
    const seen = new Set();
    for (const gid of activeOrder) {
        const grp = activeGroups.get(gid);
        if (!grp) continue;
        for (const chName of grp.mergedNames) {
            if (seen.has(chName)) continue;
            seen.add(chName);
            const col = lookup.colByName.get(chName);
            if (col && mainFile.colData[col.id]) cols.push(col);
        }
    }
    if (!cols.length) {
        showWarning('エクスポートできるチャンネルがありません');
        return;
    }

    // CSVフィールドのエスケープ（カンマ・引用符・改行を含む名前対策）
    const q = v => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const lines = [];
    lines.push(['Time', ...cols.map(c => q(c.name))].join(','));
    lines.push(['s',    ...cols.map(c => q(c.unit || ''))].join(','));

    const td = mainFile.timeData;
    const dataArrs = cols.map(c => mainFile.colData[c.id]);
    let rows = 0;
    for (let i = 0; i < td.length; i++) {
        const t = td[i];
        if (t < t0 || t > t1) continue;
        const row = new Array(cols.length + 1);
        row[0] = t;
        for (let k = 0; k < dataArrs.length; k++) {
            const v = dataArrs[k][i];
            row[k + 1] = Number.isNaN(v) ? '' : v;
        }
        lines.push(row.join(','));
        rows++;
    }
    if (!rows) {
        showWarning('表示範囲内にデータ点がありません');
        return;
    }

    const baseName = mainFile.name.replace(/\.(csv|trn)$/i, '');
    const now = new Date();
    const stamp = now.getFullYear()
        + String(now.getMonth() + 1).padStart(2, '0')
        + String(now.getDate()).padStart(2, '0')
        + '_'
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
    const fileName = `${baseName}_export_${stamp}.csv`;

    // BOM付きUTF-8（Excelでの文字化け防止）
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showExportToast('CSVを保存しました', `${fileName}（${rows}行 × ${cols.length}チャンネル）`);
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
        showExportToast('コピーしました', 'チャート画像をクリップボードにコピーしました');
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
    // 成功通知なので短めに自動消去する
    showToast('success', title, detail, TOAST_TTL_SUCCESS);
}

// ボタンのクリックイベントを登録
dom.exportPng.addEventListener('click', exportChartAsPNG);
dom.copyChart.addEventListener('click', copyChartToClipboard);
dom.exportCsv.addEventListener('click', exportVisibleCSV);

// ─────────────────────────────────────────────────────────────
// 設定の保存・復元（localStorage）
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'csvViewer_settings';
const PRESETS_STORAGE_KEY = 'csvViewer_presets';

// プリセットの保存上限。localStorage quota(約5MB)超過で既存プリセットまで
// 巻き込んで失われる前に、保存時点で件数と合計サイズの両方を保護する
const PRESET_MAX_COUNT = 20;                    // 保存できるプリセットの最大件数
const PRESET_MAX_JSON_CHARS = 2 * 1024 * 1024;  // 全プリセットのJSON文字列長の上限（約2MB相当）

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
 * 設定保存を予約する（SAVE_DEBOUNCE_MS のdebounce）。
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
    _saveSettingsTimer = setTimeout(flushSettingsSave, SAVE_DEBOUNCE_MS);
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
        _version: 4,
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
        // カスタム走行モード（時間-車速トレース）
        customModes: (state.customModes || []).map(m => ({ id: m.id, name: m.name, trace: m.trace, phases: m.phases || [] })),
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
        theme: state.theme,
        // イベント検出の条件式（区間は保存しない。次回は式だけ復元して手動で再検出）
        eventExpr: dom.eventExpr?.value || '',
        statsPanel: state.statsPanelVisible,
        fontScale: state.fontScale,
        rowHeightPx: state.rowHeightPx,
        gridHeights: state.gridHeights,
        // 線の太さ・データ点マーカー設定
        lineWidth: state.lineWidth,
        channelLineWidths: state.channelLineWidths,
        showMarkers: state.showMarkers,
        // サイドバー幅
        sidebarWidth: sidebar ? sidebar.offsetWidth : null,
        // Y軸範囲のユーザー設定
        yRanges: state.yRanges,
        // 単色モード設定
        monoColorMode: state.monoColorMode,
        fileColors: state.fileColors,
        // ドライビングインデックス設定（results/lastResultは保存しない＝再計算で得られる）
        driveIndex: {
            channels:       state.driveIndex.channels,
            cycleId:        state.driveIndex.cycleId,
            phaseOverride:  state.driveIndex.phaseOverride,
            roadLoadByFile: state.driveIndex.roadLoadByFile,
            autoAlign:      state.driveIndex.autoAlign,
            alignByFile:    state.driveIndex.alignByFile,
        },
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

/**
 * プリセット一式をlocalStorageへ書き込む。
 * @param {object} presets 全プリセット（name → 設定）
 * @param {string|null} json シリアライズ済みJSON（呼び出し側でサイズ判定に使った文字列を再利用する）
 * @returns {boolean} 書き込みに成功したか
 */
function savePresets(presets, json = null) {
    try {
        localStorage.setItem(PRESETS_STORAGE_KEY, json ?? JSON.stringify(presets));
        return true;
    } catch (e) {
        // 容量超過時に例外がそのまま飛ぶと「Unhandled error」トーストになり原因が分かりにくい
        showError('プリセットを保存できませんでした',
            'ブラウザの保存領域(localStorage)に書き込めません。容量超過の可能性があります。\n' + (e.message || String(e)));
        return false;
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

    // 件数上限: 新規追加のみ制限する（既存名の上書きは常に許可）
    const isNew = !Object.prototype.hasOwnProperty.call(presets, trimmed);
    if (isNew && Object.keys(presets).length >= PRESET_MAX_COUNT) {
        showWarning(`プリセットは最大${PRESET_MAX_COUNT}件までです`,
            '不要なプリセットを削除してから保存してください。');
        return;
    }

    presets[trimmed] = buildPresetSettings();

    // サイズ上限: quota超過の例外で既存プリセットごと保存が失われる前に拒否する
    const json = JSON.stringify(presets);
    if (json.length > PRESET_MAX_JSON_CHARS) {
        showWarning('プリセットの合計サイズが上限(約2MB)を超えるため保存できません',
            '不要なプリセットを削除するか、選択チャンネル数を減らしてから保存してください。');
        return;
    }

    if (!savePresets(presets, json)) return; // quota超過等（savePresets内でエラー表示済み）
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

// ─────────────────────────────────────────────────────────────
// 差分カーブ生成（F8）: MainとSubの両方に存在するチャンネルから選んで、
// Main − Sub の差分を Custom RAM（@Δ名_s番号）として一括生成する。
// 計算はクロスファイル式（名前 - sN:名前）なので、Subのタイムシフト
// （offset）適用後の時間軸でMainに補間される既存機構をそのまま使う。
// ─────────────────────────────────────────────────────────────

/** 名前が式のトークナイザを単一識別子として通るか（空白や演算子入りの名前は式にできない） */
function isExprSafeName(name) {
    try {
        const t = tokenizeExpr(name);
        return t.length === 1 && t[0].type === 'name' && t[0].value === name;
    } catch (e) {
        return false;
    }
}

function showDiffCurvesModal() {
    const mainFile = getMainFile();
    const subIds = getSubFileIds();
    if (!mainFile || !subIds.length) return;

    let body = '';
    let candidates = 0;
    subIds.forEach((subId, i) => {
        const sf = state.files[subId];
        const subNames = new Set(sf.columns.map(c => c.name));
        // 両ファイルに同名で存在し、式に書ける名前だけを候補にする
        // （既生成の差分 @Δ… は除外）
        const common = mainFile.columns.filter(c =>
            subNames.has(c.name) && !c.name.startsWith('@Δ') && isExprSafeName(c.name));
        if (!common.length) return;

        body += `<h4 style="margin:12px 0 6px;color:#f59e0b;font-size:12px;">s${i + 1}: ${esc(sf.shortName)}</h4>`
            + `<div class="diff-ch-list">`;
        for (const c of common) {
            const newName = `@Δ${c.name}_s${i + 1}`;
            const exists = mainFile.columns.some(col => col.name === newName);
            if (!exists) candidates++;
            body += `<label class="diff-ch-item">`
                + `<input type="checkbox" data-sub="${i + 1}" data-ch="${esc(c.name)}"${exists ? ' disabled' : ''}>`
                + `<span${exists ? ' style="opacity:0.45;"' : ''}>${esc(c.name)}</span>`
                + (exists ? `<span class="diff-exists">生成済み</span>` : '')
                + `</label>`;
        }
        body += `</div>`;
    });

    if (!body) {
        showWarning('差分を作れるチャンネルがありません',
            'MainとSubの両方に同じ名前で存在するチャンネルが対象です。名前が違う場合はChannel Mapではなく、Custom RAMで「Main名 - s1:Sub名」を直接定義してください。');
        return;
    }

    const html =
        `<h3 id="diff-modal-title" style="margin:0 0 8px;color:var(--accent-soft);">差分カーブ生成（Main − Sub）</h3>`
        + `<p style="color:var(--text-secondary);font-size:11px;margin:0 0 4px;">`
        + `選んだチャンネルの Main − Sub 差分を Custom RAM（@Δ名_s番号）として追加します。`
        + `Subはタイムシフト適用後の時間軸でMainに補間されます。</p>`
        + body
        + `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">`
        + `<button id="diff-generate-btn" class="btn-primary" style="padding:6px 18px;font-size:13px;"${candidates ? '' : ' disabled'}>生成</button>`
        + `<button class="modal-close-btn" style="background:transparent;color:var(--text-secondary);border:1px solid var(--border);border-radius:6px;padding:6px 18px;cursor:pointer;font-size:13px;">閉じる</button>`
        + `</div>`;

    const { modal, close } = createModal(html, { modalClass: 'diff-modal', labelledBy: 'diff-modal-title' });
    modal.querySelector('.modal-close-btn').addEventListener('click', close);
    modal.querySelector('#diff-generate-btn').addEventListener('click', async () => {
        const checked = [...modal.querySelectorAll('input[type="checkbox"]:checked')];
        if (!checked.length) { showWarning('チャンネルを選択してください'); return; }
        close();
        for (const cb of checked) {
            const ch = cb.dataset.ch;
            const s = cb.dataset.sub;
            const unit = mainFile.columns.find(c => c.name === ch)?.unit || '';
            // addCustomRAM が '@' を付けて @Δ名_sN になる。計算・チャート追加・
            // 永続化・全ファイルへの伝播はCustom RAMの既存経路に任せる
            await addCustomRAM(`Δ${ch}_s${s}`, `${ch} - s${s}:${ch}`, unit);
        }
        showExportToast('差分カーブを追加しました', `${checked.length}件`);
    });
}

dom.diffBtn?.addEventListener('click', showDiffCurvesModal);

// ─────────────────────────────────────────────────────────────
// チャンネルセットのお気に入り（F10）: 表示チャンネルの組み合わせに名前を
// 付けて保存し、ワンクリックで適用する。設定プリセットの軽量版で、
// 保存するのはチャンネル名の配列（グリッド表示順）のみ。
// 独立したlocalStorageキーなので Clear All や設定リセットでは消えない。
// ─────────────────────────────────────────────────────────────

const FAVORITES_STORAGE_KEY = 'csvViewer_channelFavorites';
const FAVORITES_MAX_COUNT = 30;

function loadChannelFavorites() {
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        const obj = raw ? JSON.parse(raw) : {};
        return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (e) {
        return {};
    }
}

function saveChannelFavoritesStore(favs) {
    try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favs));
        return true;
    } catch (e) {
        showError('お気に入りを保存できませんでした', e.message || String(e));
        return false;
    }
}

function renderChannelFavSelect() {
    if (!dom.favSelect) return;
    const favs = loadChannelFavorites();
    const selected = dom.favSelect.value;
    dom.favSelect.innerHTML = '<option value="">Favorites...</option>';
    Object.keys(favs).sort((a, b) => a.localeCompare(b, 'ja')).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        dom.favSelect.appendChild(opt);
    });
    if (selected && favs[selected]) dom.favSelect.value = selected;
}

/** 現在の表示チャンネル名をグリッド表示順で返す（未描画の選択分は末尾） */
function currentChannelOrder() {
    const names = [];
    for (const g of state.chartGroups) {
        for (const ch of g.channels) {
            if (!names.includes(ch.name)) names.push(ch.name);
        }
    }
    for (const n of state.selectedNames) {
        if (!names.includes(n)) names.push(n);
    }
    return names;
}

function saveChannelFavorite() {
    const names = currentChannelOrder();
    if (!names.length) {
        showWarning('保存する表示チャンネルがありません');
        return;
    }
    const name = prompt('保存するお気に入り名を入力してください', dom.favSelect?.value || '');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const favs = loadChannelFavorites();
    const isNew = !Object.prototype.hasOwnProperty.call(favs, trimmed);
    if (isNew && Object.keys(favs).length >= FAVORITES_MAX_COUNT) {
        showWarning(`お気に入りは最大${FAVORITES_MAX_COUNT}件までです`,
            '不要なお気に入りを削除してから保存してください。');
        return;
    }
    favs[trimmed] = names;
    if (!saveChannelFavoritesStore(favs)) return;
    renderChannelFavSelect();
    dom.favSelect.value = trimmed;
    showExportToast('お気に入りを保存しました', `${trimmed}（${names.length}チャンネル）`);
}

function applyChannelFavorite() {
    const key = dom.favSelect?.value;
    if (!key) { showWarning('お気に入りが選択されていません'); return; }
    const favs = loadChannelFavorites();
    const names = favs[key];
    if (!Array.isArray(names)) {
        showWarning('お気に入りが見つかりません', key);
        renderChannelFavSelect();
        return;
    }
    const mainFile = getMainFile();
    if (!mainFile) { showWarning('ファイルを読み込んでください'); return; }

    const colNames = new Set(mainFile.columns.map(c => c.name));
    const found = names.filter(n => colNames.has(n));
    const missing = names.filter(n => !colNames.has(n));
    if (!found.length) {
        showWarning('お気に入りのチャンネルがMainファイルに1つもありません', names.join(', '));
        return;
    }

    // 表示チャンネルを丸ごと置き換える（保存時のグリッド順で単独チャート化）
    state.selectedNames = new Set(found);
    state.chartGroups = [];
    found.forEach(n => addStandaloneChart(n));
    renderColumnList();
    ensureColumnsAndRender();
    saveSettings();
    showExportToast('お気に入りを適用しました', key
        + (missing.length ? `（見つからないチャンネル: ${missing.join(', ')}）` : ''));
}

function deleteChannelFavorite() {
    const key = dom.favSelect?.value;
    if (!key) { showWarning('削除するお気に入りが選択されていません'); return; }
    const favs = loadChannelFavorites();
    delete favs[key];
    saveChannelFavoritesStore(favs);
    renderChannelFavSelect();
    showExportToast('お気に入りを削除しました', key);
}

dom.favSave?.addEventListener('click', saveChannelFavorite);
dom.favApply?.addEventListener('click', applyChannelFavorite);
dom.favDelete?.addEventListener('click', deleteChannelFavorite);

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
    if (s.theme === 'light' || s.theme === 'dark') applyTheme(s.theme);
    if (typeof s.eventExpr === 'string' && dom.eventExpr) dom.eventExpr.value = s.eventExpr;
    if (s.statsPanel != null) {
        state.statsPanelVisible = !!s.statsPanel;
        dom.statsBtn?.classList.toggle('btn-active', state.statsPanelVisible);
        // パネル本体はファイル読み込み後のrenderChartが構築する
    }
    if (s.fontScale && CSVLayout.FONT_PRESETS[s.fontScale]) {
        state.fontScale = s.fontScale;
        if (dom.fontScale) dom.fontScale.value = s.fontScale;
    }
    if (s.rowHeightPx !== undefined) state.rowHeightPx = s.rowHeightPx;
    if (s.gridHeights) state.gridHeights = { ...s.gridHeights };
    if (s.lineWidth != null) state.lineWidth = s.lineWidth;
    if (s.channelLineWidths) state.channelLineWidths = { ...s.channelLineWidths };
    if (s.showMarkers != null) state.showMarkers = s.showMarkers;
    // 太さ・マーカーのUIを復元値に同期
    const _lwr = document.getElementById('line-width-range');
    if (_lwr) { _lwr.value = state.lineWidth; const _lwv = document.getElementById('line-width-value'); if (_lwv) _lwv.textContent = Number(state.lineWidth).toFixed(1); }
    const _smc = document.getElementById('show-markers-chk');
    if (_smc) _smc.checked = state.showMarkers;

    // サイドバー幅を復元
    if (s.sidebarWidth) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.style.width    = s.sidebarWidth + 'px';
            sidebar.style.minWidth = s.sidebarWidth + 'px';
        }
    }

    // Y軸範囲を復元。インポートJSON由来のオブジェクトを参照代入すると以後の編集が
    // 設定オブジェクトと同一実体を書き換えてしまうため、エントリごとにコピーする（B6対策）。
    // 形式が { min, max } でないエントリは捨てる
    if (s.yRanges) {
        const cleaned = {};
        for (const [name, r] of Object.entries(s.yRanges)) {
            if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
            cleaned[name] = {
                min: r.min != null ? String(r.min) : '',
                max: r.max != null ? String(r.max) : '',
            };
        }
        state.yRanges = cleaned;
    }
    if (s.channelAliases) state.channelAliases = { ...s.channelAliases };

    // 単色モード設定を復元
    if (s.monoColorMode !== undefined) {
        state.monoColorMode = s.monoColorMode;
        dom.monoColorBtn.classList.toggle('btn-active', state.monoColorMode);
    }
    // ファイル色を復元。参照代入を避けてコピーし、#RRGGBB形式でない値は
    // インポートJSONで任意文字列を注入できてしまうため捨てる（B6+S1対策）。
    // 捨てられたファイルはデフォルト色（renderFileListの'#6366f1'）にフォールバックする
    if (s.fileColors) {
        const cleaned = {};
        for (const [fid, color] of Object.entries(s.fileColors)) {
            if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) cleaned[fid] = color;
        }
        state.fileColors = cleaned;
    }

    // カスタム走行モード（時間-車速トレース）を復元
    if (Array.isArray(s.customModes)) {
        state.customModes = s.customModes
            .filter(m => m && m.id && m.name && m.trace && Array.isArray(m.trace.time) && Array.isArray(m.trace.speed))
            .map(m => ({ id: m.id, name: m.name, trace: m.trace, phases: Array.isArray(m.phases) ? m.phases : [] }));
    }

    // ドライビングインデックス設定を復元（lastResultは保存していないので再計算で得る）
    if (s.driveIndex) {
        const d = s.driveIndex;
        if (d.channels)      state.driveIndex.channels      = d.channels;
        if (d.cycleId !== undefined) {
            // 孤立ID対策: 復元先が内蔵レジストリにも復元済みカスタムモードにも無ければ、
            // ドロップダウン表示（自動判別）と内部状態がずれてしまうため null（自動）に戻す。
            const resolved = window.DriveIndex.resolveCycleId(d.cycleId);
            state.driveIndex.cycleId = driveModeById(resolved) ? resolved : null;
        }
        if (d.phaseOverride !== undefined) state.driveIndex.phaseOverride = d.phaseOverride;
        if (d.roadLoadByFile) state.driveIndex.roadLoadByFile = d.roadLoadByFile;
        if (d.autoAlign !== undefined) state.driveIndex.autoAlign = d.autoAlign;
        if (d.alignByFile) state.driveIndex.alignByFile = d.alignByFile;
    }

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

// 参照先のSubファイルがまだ無くて復元を繰り延べたクロスファイルCustom RAM
// [{ name, unit, expr }]。後続ファイルのパース完了時に applyDeferredCrossRAMs が再試行する
let _deferredCrossRAMs = [];

/** 繰り延べたクロスファイルRAMのうち、参照先Subが揃ったものを追加する */
async function applyDeferredCrossRAMs() {
    if (!_deferredCrossRAMs.length) return;
    const subCount = getSubFileIds().length;
    const ready = [];
    _deferredCrossRAMs = _deferredCrossRAMs.filter(r => {
        const refs = extractCrossRefs(r.expr);
        const maxRef = refs.length
            ? Math.max(...refs.map(cr => parseInt(cr.fileKey.slice(1), 10))) : 0;
        if (maxRef <= subCount) { ready.push(r); return false; }
        return true;
    });
    for (const r of ready) {
        await addCustomRAM(r.name, r.expr, r.unit);
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

    // Custom RAMを復元（まだ追加されていないもののみ）。
    // クロスファイル式（s1:Name等）は、参照先のSubがまだ読み込まれていないと
    // 全NaNになって失敗するため、対象Subのパース完了まで繰り延べる
    // （複数ファイル同時ドロップやセッション自動復元では、この関数は
    //  最初のファイルの完了時点で走り、_pendingSettingsを消費するため）
    if (s.customRAMs && s.customRAMs.length) {
        const existingNames = new Set(state.customRAMs.map(c => c.name));
        const subCount = getSubFileIds().length;
        for (const { name, unit = '', expr } of s.customRAMs) {
            if (existingNames.has(name)) continue;
            const refs = extractCrossRefs(expr);
            const maxRef = refs.length
                ? Math.max(...refs.map(cr => parseInt(cr.fileKey.slice(1), 10))) : 0;
            if (maxRef > subCount) {
                _deferredCrossRAMs.push({ name, unit, expr });
                continue;
            }
            await addCustomRAM(name, expr, unit);
            existingNames.add(name);
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
// セッション自動復元（IndexedDB）
// パース成功時にFile本体を保存し、次回起動時に自動で再読み込みする。
// ロール・オフセット・選択チャンネルはlocalStorage設定（fileInfosの名前
// マッチ → applyPendingSettings）の既存機構がそのまま復元する。
// IndexedDBが使えない環境（プライベートモード等）では黙って無効になる。
// ─────────────────────────────────────────────────────────────

const SESSION_DB_NAME = 'csvViewerSession';
const SESSION_STORE = 'files';
// 保存合計の上限。IndexedDBのquota超過で書き込みが不安定になる前に打ち切る
const SESSION_TOTAL_MAX_BYTES = 200 * 1024 * 1024;

function openSessionDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(SESSION_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(SESSION_STORE)) {
                db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** 1トランザクションでストア操作を実行する。fnはstoreを受け取りrequestを返してよい */
async function sessionStoreRun(mode, fn) {
    const db = await openSessionDB();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(SESSION_STORE, mode);
            const req = fn(tx.objectStore(SESSION_STORE));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

/** パース済みファイルの本体を自動復元ストアへ保存する（上限超過分はスキップ+通知） */
async function sessionSaveFile(fileId, file, name) {
    if (!(file instanceof Blob)) return;
    const fileName = name || file.name || 'restored.csv';
    try {
        const existing = await sessionStoreRun('readonly', s => s.getAll()) || [];
        const total = existing.filter(r => r.id !== fileId)
                              .reduce((acc, r) => acc + (r.size || 0), 0);
        if (total + file.size > SESSION_TOTAL_MAX_BYTES) {
            showWarning('セッション保存をスキップしました',
                `保存容量の上限（${Math.round(SESSION_TOTAL_MAX_BYTES / 1048576)}MB）を超えるため、` +
                `「${fileName}」は次回の自動復元対象になりません。`);
            return;
        }
        await sessionStoreRun('readwrite', s => s.put({
            id: fileId, name: fileName, size: file.size, addedAt: Date.now(), blob: file,
        }));
    } catch (e) {
        console.warn('[CSV Viewer] セッション保存に失敗:', e);
    }
}

async function sessionDeleteFile(fileId) {
    try { await sessionStoreRun('readwrite', s => s.delete(fileId)); }
    catch (e) { console.warn('[CSV Viewer] セッション削除に失敗:', e); }
}

async function sessionClearFiles() {
    try { await sessionStoreRun('readwrite', s => s.clear()); }
    catch (e) { console.warn('[CSV Viewer] セッションクリアに失敗:', e); }
}

/**
 * 起動時に前回セッションのファイルを自動復元する。
 * 復元パースが新しいfileIdで再保存するため、読み出し後にストアを一度空にする
 * （残したままだと次回リロードで同じファイルが重複する）。
 */
async function restoreSessionFiles() {
    let records;
    try { records = await sessionStoreRun('readonly', s => s.getAll()); }
    catch (e) { return; }
    if (!records || !records.length) return;
    if (Object.keys(state.files).length > 0) return; // 既にファイルがあるなら何もしない

    records.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    try { await sessionStoreRun('readwrite', s => s.clear()); } catch (e) {}

    for (const r of records) {
        if (!r.blob) continue;
        // Blobにはファイル名が無いことがあるためFileへ包み直す
        const f = (typeof File !== 'undefined' && r.blob instanceof File)
            ? r.blob : new File([r.blob], r.name || 'restored.csv');
        parseCSV(f);
    }
    showToast('success', '前回のセッションを復元しました',
        `${records.length} ファイルを再読み込みしています…`);
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
renderChannelFavSelect();

// 起動時にlocalStorageから設定を復元
const _savedSettings = loadSettings();
if (_savedSettings) {
    applySettings(_savedSettings);
}

// 設定適用後に前回セッションのファイルを自動復元する
// （ロール等はapplySettingsが積んだ保留設定がパース完了時に適用する）
restoreSessionFiles();

// ─────────────────────────────────────────────────────────────
// テスト/デバッグ用の公開面（M9）
// ─────────────────────────────────────────────────────────────
// IIFE化によりapp.js内部はグローバルへ一切漏れない。Playwrightスモークテストと
// 開発時のコンソールデバッグに必要な最小限だけをこの名前空間で公開する。
// アプリ本体のコードがこの名前空間に依存してはいけない（公開は一方通行）。
window.__csvViewerDebug = {
    state,
    getChartImageDataURL,
    buildPresetSettings,
    saveCurrentPreset,
    T,
    renderChart,
    parseExprToAST,
    evaluateAST,
    esc,
    applyTheme,
    computeIntervalStats,
    toggleMeasureMode,
    extractTrueIntervals,
    detectEvents,
    computeCustomExpr,
    toggleStatsPanel,
    getVisibleXRange,
    exportVisibleCSV,
    saveChannelFavorite,
    applyChannelFavorite,
    currentChannelOrder,
    showDiffCurvesModal,
};

})();
