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
// Constants
// ─────────────────────────────────────────────────────────────

const SERIES_COLORS = [
    '#6366f1', '#ec4899', '#10b981', '#f59e0b',
    '#8b5cf6', '#06b6d4', '#f43f5e', '#84cc16',
    '#0ea5e9', '#a855f7', '#14b8a6', '#fb923c',
];

// HTML-escape to safely insert text into innerHTML
function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────
// Expression parser for custom RAMs (recursive descent)
// Supports: +, -, *, /, parentheses, number literals, RAM names
// ─────────────────────────────────────────────────────────────

function tokenizeExpr(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (/\s/.test(ch)) { i++; continue; }
        if ('+-*/()'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue; }
        // Number literal (including decimals and leading dot)
        if (/[\d.]/.test(ch)) {
            let num = '';
            while (i < expr.length && /[\d.eE]/.test(expr[i])) num += expr[i++];
            tokens.push({ type: 'num', value: parseFloat(num) });
            continue;
        }
        // RAM name: anything else that forms an identifier-like token
        // Allow letters, digits, underscore, dot, and non-ASCII (for Japanese etc.)
        let name = '';
        while (i < expr.length && !/[\s+\-*/()]/.test(expr[i])) name += expr[i++];
        if (name) tokens.push({ type: 'name', value: name });
    }
    return tokens;
}

function evaluateExpr(expr, getVal) {
    const tokens = tokenizeExpr(expr);
    let pos = 0;

    function peek() { return pos < tokens.length ? tokens[pos] : null; }
    function next() { return tokens[pos++]; }

    // expr = term (('+' | '-') term)*
    function parseExpr() {
        let left = parseTerm();
        while (peek() && (peek().value === '+' || peek().value === '-')) {
            const op = next().value;
            const right = parseTerm();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    // term = factor (('*' | '/') factor)*
    function parseTerm() {
        let left = parseFactor();
        while (peek() && (peek().value === '*' || peek().value === '/')) {
            const op = next().value;
            const right = parseFactor();
            left = op === '*' ? left * right : left / right;
        }
        return left;
    }

    // factor = '(' expr ')' | number | unary-minus factor | ramName
    function parseFactor() {
        const t = peek();
        if (!t) return NaN;

        // Unary minus
        if (t.type === 'op' && t.value === '-') {
            next();
            return -parseFactor();
        }
        // Unary plus
        if (t.type === 'op' && t.value === '+') {
            next();
            return parseFactor();
        }
        // Parenthesized expression
        if (t.type === 'op' && t.value === '(') {
            next(); // consume '('
            const val = parseExpr();
            if (peek() && peek().value === ')') next(); // consume ')'
            return val;
        }
        // Number literal
        if (t.type === 'num') {
            next();
            return t.value;
        }
        // RAM name
        if (t.type === 'name') {
            next();
            return getVal(t.value);
        }
        return NaN;
    }

    return parseExpr();
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
};

// FileRecord: { name, shortName, columns, timeData, colData, role, offset, file, headerInfo }
//   role: 'main' | 'sub'
//   offset: number (seconds, for sub files)
//   file: File object reference (for lazy column loading)
//   headerInfo: { nameRow, unitRow, dataStart, timeIdx, timeUnit } (cached parse metadata)

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
    setupShiftDrag();
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

function handleFiles(files) {
    Array.from(files).forEach(f => {
        if (f.name.toLowerCase().endsWith('.csv')) parseCSV(f);
        else alert(`Unsupported: ${f.name}\nPlease upload CSV files.`);
    });
}

// ─────────────────────────────────────────────────────────────
// CSV parsing
// ─────────────────────────────────────────────────────────────

function parseCSV(file) {
    const fileId = 'f' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    console.log(`[CSV Viewer] parseCSV: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    try {
        // Phase 1: Preview parse — only read first 50 rows to detect headers
        Papa.parse(file, {
            header: false,
            dynamicTyping: false,
            skipEmptyLines: true,
            preview: 50,
            complete: res => {
                try {
                    onHeaderParsed(fileId, file.name, file, res.data);
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

function detectHeaderRows(raw) {
    const scanLimit = Math.min(50, raw.length);
    for (let r = 0; r < scanLimit; r++) {
        const row = raw[r];
        if (row.length < 2) continue;
        const hasTime = row.some(c => typeof c === 'string' && c.trim().toLowerCase() === 'time');
        if (!hasTime) continue;
        const nameRow = r;
        let unitRow = -1;
        if (r + 1 < raw.length) {
            const next = raw[r + 1];
            const timeUnits = ['s', 'ms', 'sec', 'min'];
            const hasTimeUnit = next.some(c =>
                typeof c === 'string' && timeUnits.includes(c.trim().toLowerCase())
            );
            if (hasTimeUnit) unitRow = r + 1;
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
function onHeaderParsed(fileId, fileName, file, raw) {
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

    let timeIdx = headers.findIndex(h => typeof h === 'string' && h.trim().toLowerCase() === 'time');
    if (timeIdx < 0) timeIdx = 0;

    const timeUnit = unitRow >= 0 ? (raw[unitRow][timeIdx] || '').trim().toLowerCase() : '';

    const columns = [];
    for (let i = 0; i < headers.length; i++) {
        if (i === timeIdx) continue;
        columns.push({
            id:    `${fileId}_c${i}`,
            name:  (headers[i] || `Col_${i}`).trim(),
            unit:  (units[i]   || '').trim(),
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
                        headerInfo: { nameRow, unitRow, dataStart, timeIdx, timeUnit },
                    };

                    if (role === 'sub' && !state.shiftFileId) state.shiftFileId = fileId;
                    updateUI();
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
    const colsToLoad = [];
    for (const name of colNames) {
        const col = f.columns.find(c => c.name === name);
        if (col && !f.colData[col.id]) colsToLoad.push(col);
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
        try {
            await f.file.slice(0, 1).text();
        } catch (e) {
            showError(
                `File re-read failed: ${f.name}`,
                `File object is no longer accessible. This may be caused by browser security policy or the file was moved/deleted.\n${e.message}`
            );
            return;
        }

        const colNamesStr = stillNeeded.map(c => c.name).join(', ');
        console.log(`[CSV Viewer] Loading columns [${colNamesStr}] from ${f.name}`);

        const { dataStart, timeIdx } = f.headerInfo;

        return new Promise(resolve => {
            try {
                const tempArrs = {};
                for (const col of stillNeeded) tempArrs[col.id] = [];

                let rowIdx = 0;

                Papa.parse(f.file, {
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
        renderChart();
    } catch (e) {
        showError('Failed to load column data', e.stack || e.message);
        renderChart(); // render what we have
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
    state.selectedNames = new Set();  // clear selection on main change
    await recomputeCustomRAMs();
    updateUI();
}

function removeFile(fileId) {
    const wasMain = state.files[fileId]?.role === 'main';
    delete state.files[fileId];

    if (state.shiftFileId === fileId) {
        state.shiftFileId = getSubFileIds()[0] ?? null;
        if (!state.shiftFileId && state.shiftMode) exitShiftMode();
    }

    if (wasMain) {
        state.selectedNames = new Set();
        const remaining = Object.keys(state.files);
        if (remaining.length) state.files[remaining[0]].role = 'main';
    }

    updateUI();
}

dom.clearBtn.addEventListener('click', () => {
    state.files         = {};
    state.selectedNames = new Set();
    state.yRanges       = {};
    state.colorCtr      = 0;
    state.shiftFileId   = null;
    if (state.shiftMode) exitShiftMode();
    updateUI();
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
}

function renderFileList() {
    dom.fileList.innerHTML = '';

    for (const [fid, f] of Object.entries(state.files)) {
        const isMain    = f.role === 'main';
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

        li.innerHTML = `
            <div class="file-item-top">
                <div class="role-badge ${isMain ? 'role-main' : 'role-sub'}"
                    data-roleid="${fid}"
                    title="${isMain ? 'Main file' : 'Sub file — click to make this the Main'}"
                >${isMain ? 'M' : 'S'}</div>
                <span class="file-name-text" title="${esc(f.name)}">${esc(f.name)}</span>
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

    // Role toggle
    dom.fileList.querySelectorAll('[data-roleid]').forEach(el => {
        el.addEventListener('click', () => setMainFile(el.dataset.roleid));
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
            }
        });
    });

    // Auto-align
    dom.fileList.querySelectorAll('[data-auto-id]').forEach(btn => {
        btn.addEventListener('click', () => autoAlign(btn.dataset.autoId));
    });
}

// ─────────────────────────────────────────────────────────────
// Custom RAM (computed channels)
// ─────────────────────────────────────────────────────────────

/** Extract RAM names referenced in an expression */
function extractExprNames(expr) {
    return tokenizeExpr(expr).filter(t => t.type === 'name').map(t => t.value);
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

    // Ensure referenced columns are loaded before computing
    const refNames = extractExprNames(expr);
    const mainFileId = getMainFileId();
    if (mainFileId) await loadColumnsForFile(mainFileId, refNames);

    const id = `custom_${Date.now()}`;
    const td = mainFile.timeData;
    const vals = new Float32Array(td.length);

    for (let i = 0; i < td.length; i++) {
        vals[i] = evaluateExpr(expr, ramName => {
            const col = mainFile.columns.find(c => c.name === ramName);
            if (!col) return NaN;
            return mainFile.colData[col.id]?.[i] ?? NaN;
        });
    }

    // Check if all NaN (likely bad expression)
    if (vals.every(v => isNaN(v))) {
        alert(`Expression error: could not evaluate "${expr}". Check RAM names.`);
        return;
    }

    const color = SERIES_COLORS[state.colorCtr++ % SERIES_COLORS.length];
    const colDef = { id, name, unit: '', idx: -1, color, isCustom: true };

    mainFile.columns.unshift(colDef);
    mainFile.colData[id] = vals;

    state.customRAMs.push({ name, expr, id });
    state.selectedNames.add(name);

    renderCustomRAMList();
    renderColumnList();
    renderChart();
}

function removeCustomRAM(id) {
    const mainFile = getMainFile();
    const idx = state.customRAMs.findIndex(c => c.id === id);
    if (idx < 0) return;

    const name = state.customRAMs[idx].name;
    state.customRAMs.splice(idx, 1);

    if (mainFile) {
        mainFile.columns = mainFile.columns.filter(c => c.id !== id);
        delete mainFile.colData[id];
    }
    state.selectedNames.delete(name);

    renderCustomRAMList();
    renderColumnList();
    renderChart();
}

async function recomputeCustomRAMs() {
    const mainFile = getMainFile();
    if (!mainFile) return;

    // Remove old custom columns from mainFile
    mainFile.columns = mainFile.columns.filter(c => !c.isCustom);
    for (const cr of state.customRAMs) delete mainFile.colData[cr.id];

    // Ensure referenced columns are loaded
    const mainFileId = getMainFileId();
    if (mainFileId) {
        const allRefNames = [];
        for (const cr of state.customRAMs) allRefNames.push(...extractExprNames(cr.expr));
        if (allRefNames.length > 0) await loadColumnsForFile(mainFileId, allRefNames);
    }

    // Recompute each custom RAM in order (so earlier custom RAMs can be referenced by later ones)
    for (const cr of state.customRAMs) {
        const td = mainFile.timeData;
        const vals = new Float32Array(td.length);

        for (let i = 0; i < td.length; i++) {
            vals[i] = evaluateExpr(cr.expr, ramName => {
                const col = mainFile.columns.find(c => c.name === ramName);
                if (!col) return NaN;
                return mainFile.colData[col.id]?.[i] ?? NaN;
            });
        }

        const color = SERIES_COLORS[state.colorCtr++ % SERIES_COLORS.length];
        const colDef = { id: cr.id, name: cr.name, unit: '', idx: -1, color, isCustom: true };

        mainFile.columns.unshift(colDef);
        mainFile.colData[cr.id] = vals;
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
});

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
        item.style.cssText = 'display:block;min-height:22px;overflow:visible;border:1px solid rgba(255,255,255,0.05);border-radius:6px;margin-bottom:2px;';

        const topRow = document.createElement('div');
        topRow.className = 'col-item-top';
        topRow.style.cssText = 'display:flex;align-items:center;gap:7px;padding:5px 7px;cursor:pointer;user-select:none;';

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
                });
            });
        }

        topRow.addEventListener('click', () => {
            if (on) {
                state.selectedNames.delete(col.name);
                renderColumnList();
                renderChart();
            } else {
                state.selectedNames.add(col.name);
                if (!state.yRanges[col.name]) state.yRanges[col.name] = { min: '', max: '' };
                renderColumnList();
                ensureColumnsAndRender();
            }
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

async function autoAlign(subFileId) {
    const mainFile = getMainFile();
    const subFile  = state.files[subFileId];
    if (!mainFile || !subFile) return;

    // Find channels that are selected AND exist in both main and sub
    const commonNames = [...state.selectedNames].filter(name =>
        subFile.columns.some(c => c.name === name)
    );

    if (!commonNames.length) {
        alert('Select at least one channel that exists in both files for auto-alignment.');
        return;
    }

    // Ensure required columns are loaded in both files
    const mainFileId = getMainFileId();
    await Promise.all([
        loadColumnsForFile(mainFileId, commonNames),
        loadColumnsForFile(subFileId, commonNames),
    ]);

    const mainCols = commonNames.map(name => mainFile.columns.find(c => c.name === name)).filter(Boolean);
    const subCols  = commonNames.map(name => subFile.columns.find(c => c.name === name)).filter(Boolean);

    // Build downsampled sample times from main (max 2000 points)
    const mTd  = mainFile.timeData;
    const step = Math.max(1, Math.floor(mTd.length / 2000));
    const sampleTimes = [];
    for (let i = 0; i < mTd.length; i += step) sampleTimes.push(mTd[i]);

    const sTd      = subFile.timeData;
    const mainDur  = mTd[mTd.length - 1] - mTd[0];
    const subDur   = sTd[sTd.length - 1] - sTd[0];
    const halfRange = Math.max(mainDur, subDur) * 0.75;

    // Coarse search (200 steps across ±halfRange)
    const COARSE = 200;
    let bestOff  = 0, bestRmse = Infinity;
    for (let s = 0; s <= COARSE; s++) {
        const off  = -halfRange + s * (halfRange * 2 / COARSE);
        const rmse = computeRmse(sampleTimes, mainFile, mainCols, subFile, subCols, off);
        if (rmse < bestRmse) { bestRmse = rmse; bestOff = off; }
    }

    // Fine search (100 steps ± one coarse step around best)
    const fineW = halfRange * 2 / COARSE * 2;
    const FINE  = 100;
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

function computeRmse(sampleTimes, mainFile, mainCols, subFile, subCols, offset) {
    let sumSq = 0, count = 0;

    for (let ci = 0; ci < mainCols.length; ci++) {
        const mc = mainCols[ci], sc = subCols[ci];
        if (!mc || !sc) continue;

        const mVals = mainFile.colData[mc.id];
        const sVals = subFile.colData[sc.id];
        if (!mVals || !sVals) continue;
        const sTd   = subFile.timeData;

        // Normalise by main signal range to balance channels of different magnitudes
        let mMin = Infinity, mMax = -Infinity;
        for (let i = 0; i < mVals.length; i++) {
            if (!isNaN(mVals[i])) { if (mVals[i] < mMin) mMin = mVals[i]; if (mVals[i] > mMax) mMax = mVals[i]; }
        }
        const range = Math.max(mMax - mMin, 1e-10);

        for (let si = 0; si < sampleTimes.length; si++) {
            const t = sampleTimes[si];
            const tSub = t - offset;
            // Skip if outside sub file's time range (no extrapolation)
            if (tSub < sTd[0] || tSub > sTd[sTd.length - 1]) continue;

            const mIdx = si * Math.max(1, Math.floor(mainFile.timeData.length / sampleTimes.length));
            const mVal = mVals[Math.min(mIdx, mVals.length - 1)];
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
 * Sub file time values are shifted by their offset.
 */
function getActiveGroups() {
    const mainFile = getMainFile();
    if (!mainFile || !state.selectedNames.size) return { groups: new Map(), order: [] };

    const groups = new Map();
    const order  = [];

    for (const ramName of state.selectedNames) {
        const mc = mainFile.columns.find(c => c.name === ramName);
        if (!mc) continue;

        order.push(ramName);
        const grp = { unit: mc.unit, series: [] };
        groups.set(ramName, grp);

        // ── Main series (solid line) ───────────────────────
        const mtd  = mainFile.timeData;
        const mvd  = mainFile.colData[mc.id];
        if (!mvd) continue; // column data not yet loaded
        const mPts = new Array(mtd.length);
        for (let i = 0; i < mtd.length; i++) mPts[i] = [mtd[i], isNaN(mvd[i]) ? null : mvd[i]];

        grp.series.push({
            id:       mc.id,
            label:    `${ramName} [${mainFile.shortName}]`,
            color:    mc.color,
            dash:     false,
            data:     mPts,
        });

        // ── Sub series (dashed lines, time-shifted) ────────
        for (const subId of getSubFileIds()) {
            const sf  = state.files[subId];
            const sc  = sf.columns.find(c => c.name === ramName);
            if (!sc) continue;

            const std    = sf.timeData;
            const svd    = sf.colData[sc.id];
            if (!svd) continue; // column data not yet loaded
            const offset = sf.offset;
            const sPts   = new Array(std.length);
            for (let i = 0; i < std.length; i++) sPts[i] = [std[i] + offset, isNaN(svd[i]) ? null : svd[i]];

            grp.series.push({
                id:    sc.id,
                label: `${ramName} [${sf.shortName}]`,
                color: sc.color,
                dash:  true,
                data:  sPts,
            });
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
        state.numGrids = 0;
        return;
    }
    dom.overlay.classList.add('hidden');
    dom.resetBtn.disabled = false;
    state.numGrids = n;

    const H = state.chart.getHeight();
    const topPx  = L.topPx;
    const botPx  = L.bottomPx;
    const gapPx  = L.gapPx;
    const availH = H - topPx - botPx - (n - 1) * gapPx;
    const gridH  = Math.max(Math.floor(availH / n), 30);
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

    order.forEach((ramName, i) => {
        const grp    = groups.get(ramName);
        const topPxI = topPx + i * (gridH + gapPx);

        // Parse Y-range settings for this channel
        const rangeSpec  = state.yRanges[ramName] ?? {};
        const yMinParsed = parseFloat(rangeSpec.min);
        const yMaxParsed = parseFloat(rangeSpec.max);
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

        const yLabel = grp.unit ? `${ramName}  (${grp.unit})` : ramName;
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

    // Build one label per selected RAM, with values from ALL files
    const order = [...state.selectedNames];
    const gridLabels = [];

    order.forEach((ramName, gi) => {
        const entries = [];

        // Main file
        const mc = mainFile.columns.find(c => c.name === ramName);
        if (mc && mainFile.colData[mc.id]) {
            const val = interpolate(mainFile.timeData, mainFile.colData[mc.id], xVal);
            if (!isNaN(val)) {
                entries.push({ color: mc.color, valStr: fmtVal(val), fileName: mainFile.shortName, val });
            }
        }

        // Sub files
        for (const subId of getSubFileIds()) {
            const sf = state.files[subId];
            const sc = sf.columns.find(c => c.name === ramName);
            if (!sc || !sf.colData[sc.id]) continue;
            // Sub file time is shifted by offset, so unshift xVal to look up in sub's timeData
            const subT = xVal - (sf.offset || 0);
            const val = interpolate(sf.timeData, sf.colData[sc.id], subT);
            if (!isNaN(val)) {
                entries.push({ color: sc.color, valStr: fmtVal(val), fileName: sf.shortName, val });
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
// Time shift controls
// ─────────────────────────────────────────────────────────────

dom.sampling.addEventListener('change', () => renderChart());

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
// Initialise
// ─────────────────────────────────────────────────────────────

initChart();
