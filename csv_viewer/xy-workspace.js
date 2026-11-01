/* Same-workspace XY and fuel-map view. The host owns parsing, time scope and wave navigation. */
(function (root) {
    'use strict';
    root.CSVXYWorkspace = function (api) {
        const F = root.CSVFuelMap, U = root.CSVXYUtils, s = api.state;
        const esc = api.esc, $ = id => document.getElementById(id);
        const fmt = value => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : '—';
        const defaults = { mode: 'scatter', x: '', y: '', z: '', source: 'main', sourceName: '', mapX: 'sfc_ne', mapY: 'sfc_te', mapZ: 'sfc_g_kwh', rpmStep: 400, torqueStep: 3, colorMin: null, colorMax: null, contours: false };
        let cfg = { ...defaults }, visible = false, expanded = false, generation = 0, importGeneration = 0, frame = null;
        let chart = null, destroyed = false, externalMap = null, pendingFile = null, pendingRows = null, pendingIdentity = null, savedExternalIdentity = null, opener = null;
        let lastSignature = '', controlsSignature = '', lastResult = null, mapCache = null, lastCursor = null;
        let preparedFiles = [], renderCount = 0, cursorUpdateCount = 0, contourNotice = '', busy = false, pendingImport = false, externalStatus = '';
        const identities = new WeakMap(); let nextIdentity = 1;
        const idOf = object => { if (!object || typeof object !== 'object') return 0; if (!identities.has(object)) identities.set(object, nextIdentity++); return identities.get(object); };
        const panel = document.createElement('aside');
        panel.id = 'xy-workspace'; panel.className = 'xy-workspace hidden'; panel.setAttribute('aria-label', 'XYと燃費率マップ');
        panel.innerHTML = `<header class="xy-workspace-header"><h2>XY・燃費率マップ</h2><button id="xy-expand-btn" class="btn-secondary" aria-expanded="false">大きく表示</button><button id="xy-close-btn" class="btn-secondary" aria-label="XY・マップを閉じて比較へ戻る">×</button></header>
          <div class="xy-workspace-scroll"><div class="xy-workspace-controls">
          <label>表示<select id="xy-mode"><option value="scatter">散布図</option><option value="map">燃費率マップ</option></select></label>
          <div class="xy-field-pair"><label><span id="xy-x-label">X軸</span><select id="xy-x-select" aria-label="X軸チャンネル"></select></label><label><span id="xy-y-label">Y軸</span><select id="xy-y-select" aria-label="Y軸チャンネル"></select></label></div>
          <p id="xy-point-status" class="xy-help hidden" role="status" aria-live="polite"></p>
          <label id="xy-color-field">点の色<select id="xy-z-select" aria-label="色に使うチャンネル"></select></label>
          <div id="xy-map-controls" class="hidden"><details id="xy-map-settings"><summary>背景マップ・表示設定</summary><label>背景マップのデータ<select id="xy-map-source" aria-label="背景マップのデータ"></select></label>
          <div id="xy-map-log-fields"><details><summary>背景の列・格子幅</summary><p class="xy-help">背景は選んだログのSFC列全体を格子平均します。走行中の燃料流量から燃費率を計算する機能ではありません。</p>
          <label>背景の回転数 [rpm]<select id="xy-map-x-select"></select></label><label>背景のトルク [Nm]<select id="xy-map-y-select"></select></label><label>背景の燃費率 [g/kWh]<select id="xy-map-z-select"></select></label>
          <div class="xy-field-pair"><label>回転数の格子幅 [rpm]<input id="xy-map-rpm-step" type="number" min="0" step="any" value="400"></label><label>トルクの格子幅 [Nm]<input id="xy-map-torque-step" type="number" min="0" step="any" value="3"></label></div></details></div>
          <div id="xy-map-external-fields" class="hidden"><label>マップCSVを選ぶ<input id="xy-map-file" type="file" accept=".csv,.txt,.tsv"></label><p class="xy-help">走行ログとは別に読み込みます。UTF-8、5 MiBまで。行列形式は先頭行が回転数、先頭列がトルク。3列形式は回転数・トルク・燃費率の順です。</p>
          <label>CSVの形式<select id="xy-map-format"><option value="auto">自動判別</option><option value="matrix">行列（先頭行X・先頭列Y）</option><option value="long">3列（X・Y・燃費率）</option></select></label>
          <label class="xy-checkbox"><input id="xy-map-confirm-units" type="checkbox">このCSVの単位が X＝rpm、Y＝Nm、燃費率＝g/kWh であることを確認した</label>
          <div class="xy-field-pair"><button id="xy-map-apply" class="btn-primary" aria-describedby="xy-map-feedback" disabled>背景に適用</button><button id="xy-map-clear" class="btn-secondary" disabled>背景を解除</button></div><p id="xy-map-feedback" class="xy-help xy-map-feedback" role="status" aria-live="polite">CSVを選び、単位確認にチェックを入れてください。</p></div>
          <div class="xy-field-pair"><label>色の下限 [g/kWh]<input id="xy-map-color-min" type="number" step="any" placeholder="空欄＝自動"></label><label>色の上限 [g/kWh]<input id="xy-map-color-max" type="number" step="any" placeholder="空欄＝自動"></label></div>
          <p class="xy-help">空欄は全有効値の範囲です。範囲外は端の色で表示し、元の値は保持します。例：200〜500 g/kWh。</p>
          <label class="xy-checkbox"><input id="xy-map-contours" type="checkbox">等高線を重ねる</label><p class="xy-help">色面は元の格子の値、等高線は隣り合う有効な格子間の補間線です。欠損セルを埋めません。動作点は燃料カット・停車も含み、回転数とトルクが非負の点を表示します。</p>
          </details><p id="xy-map-status" class="xy-help" role="status" aria-live="polite"></p></div>
          </div><p id="xy-analysis-context" class="analysis-result-context"></p><div id="xy-chart" class="xy-workspace-chart" role="img" aria-label="XY・燃費率マップ"></div><p id="xy-data-count" class="xy-help" role="status" aria-live="polite"></p>
          <p id="xy-cursor-status" class="xy-help" role="status"></p><p class="xy-help">波形のカーソルに動作点が連動します。点をクリックすると、その元サンプルの時刻へ移動します。背景マップは全体、動作点は上の解析対象に連動します。</p></div>`;
        document.querySelector('.compare-body').appendChild(panel);
        const dom = Object.fromEntries(['mode', 'x-label', 'y-label', 'x-select', 'y-select', 'z-select', 'point-status', 'map-source', 'map-file', 'map-format', 'map-confirm-units', 'map-apply', 'map-clear', 'map-feedback', 'map-rpm-step', 'map-torque-step', 'map-color-min', 'map-color-max', 'map-contours', 'map-x-select', 'map-y-select', 'map-z-select', 'expand-btn', 'close-btn', 'map-status', 'data-count', 'analysis-context', 'cursor-status'].map(key => [key, $('xy-' + key)]));

        function showImportFeedback(message, error = false, reveal = false) {
            externalStatus = message;
            dom['map-status'].textContent = message;
            dom['map-feedback'].textContent = message;
            dom['map-feedback'].classList.toggle('xy-feedback-error', error);
            if (reveal) { $('xy-map-settings').open = true; dom['map-feedback'].scrollIntoView({ block: 'nearest' }); }
        }
        function updateApplyState() {
            dom['map-apply'].disabled = !pendingRows || !pendingFile || pendingImport || !dom['map-confirm-units'].checked;
            if (pendingImport) showImportFeedback('CSVを読み込んでいます。完了後に単位を確認してください。');
            else if (pendingRows && pendingFile) showImportFeedback(dom['map-confirm-units'].checked
                ? `${pendingFile.name} の準備ができました。「背景に適用」を押してください。`
                : '単位確認にチェックを入れると「背景に適用」が押せます。');
            else if (!externalStatus) showImportFeedback('CSVを選び、単位確認にチェックを入れてください。');
        }

        function sourceFile() {
            if (cfg.source === 'external') return null;
            return cfg.source === 'main' ? api.main() : s.files[cfg.source] || null;
        }
        function label(file) { return api.fileLabel(file) || file.name; }
        function options(select, columns, current, empty = false) {
            select.innerHTML = (empty ? '<option value="">ファイルごとの色</option>' : '<option value="">選択してください</option>')
                + columns.map(c => `<option value="${esc(c.name)}">${esc(c.name)}${c.unit ? ' [' + esc(c.unit) + ']' : ''}</option>`).join('');
            select.value = columns.some(c => c.name === current) ? current : '';
        }
        function choose(columns, kind, names) {
            return columns.find(c => names.includes(c.name.toLowerCase()) && F.compatibleUnit(c.unit, kind))?.name
                || columns.find(c => F.compatibleUnit(c.unit, kind))?.name || '';
        }
        function syncControls(force = false) {
            const main = api.main(), columns = main?.columns || [];
            const signature = JSON.stringify([Object.entries(s.files).map(([fid, f]) => [fid, f.role, f.name, f.columns.map(c => [c.name, c.unit])]), cfg.source]);
            if (!force && signature === controlsSignature) return;
            controlsSignature = signature;
            if (!main) {
                for (const key of ['x-select', 'y-select', 'z-select', 'map-x-select', 'map-y-select', 'map-z-select']) options(dom[key], [], '', key === 'z-select');
                dom['map-source'].innerHTML = '<option value="main">基準ログのSFC列</option><option value="external">別のマップCSV</option>';
                dom['map-source'].value = cfg.source; syncMode(); return;
            }
            if (cfg.source !== 'external' && cfg.source !== 'main' && !s.files[cfg.source]) {
                const matches = Object.entries(s.files).filter(([, file]) => file.name === cfg.sourceName);
                if (matches.length === 1) cfg.source = matches[0][0];
            }
            const selected = [...s.selectedNames].map(name => columns.find(c => c.name === name)).filter(Boolean);
            if (!columns.some(c => c.name === cfg.x)) cfg.x = choose(columns, 'rpm', ['engine_speed', 'engine_rpm', 'rpm']) || (cfg.mode === 'map' ? '' : selected[0]?.name || columns[0]?.name || '');
            if (!columns.some(c => c.name === cfg.y)) cfg.y = choose(columns, 'torque', ['engine_torque', 'torque']) || (cfg.mode === 'map' ? '' : selected[1]?.name || columns[1]?.name || columns[0]?.name || '');
            if (!columns.some(c => c.name === cfg.z)) cfg.z = '';
            options(dom['x-select'], columns, cfg.x); options(dom['y-select'], columns, cfg.y); options(dom['z-select'], columns, cfg.z, true);
            dom['map-source'].innerHTML = '<option value="main">基準ログのSFC列</option>'
                + Object.entries(s.files).filter(([, f]) => f !== main).map(([fid, f]) => `<option value="${esc(fid)}">${esc(label(f))} のSFC列</option>`).join('')
                + '<option value="external">別のマップCSV</option>'
                + (cfg.source !== 'external' && cfg.source !== 'main' && !s.files[cfg.source] ? `<option value="${esc(cfg.source)}">${esc(cfg.sourceName || '保存した背景ログ')}（未読込・再選択）</option>` : '');
            dom['map-source'].value = cfg.source;
            const mapColumns = sourceFile()?.columns || [];
            for (const [key, select, kind, names] of [['mapX', 'map-x-select', 'rpm', ['sfc_ne']], ['mapY', 'map-y-select', 'torque', ['sfc_te']], ['mapZ', 'map-z-select', 'sfc', ['sfc_g_kwh']]]) {
                if (!mapColumns.some(c => c.name === cfg[key])) cfg[key] = mapColumns.find(c => names.includes(c.name.toLowerCase()))?.name || '';
                options(dom[select], mapColumns, cfg[key]);
            }
            syncMode();
        }
        function syncMode() {
            dom.mode.value = cfg.mode;
            dom['x-label'].textContent = cfg.mode === 'map' ? '走行点のX軸' : 'X軸';
            dom['y-label'].textContent = cfg.mode === 'map' ? '走行点のY軸' : 'Y軸';
            dom['x-select'].setAttribute('aria-label', cfg.mode === 'map' ? '走行点のX軸チャンネル' : 'X軸チャンネル');
            dom['y-select'].setAttribute('aria-label', cfg.mode === 'map' ? '走行点のY軸チャンネル' : 'Y軸チャンネル');
            dom['point-status'].textContent = ''; dom['point-status'].classList.add('hidden');
            $('xy-color-field').classList.toggle('hidden', cfg.mode === 'map');
            $('xy-map-controls').classList.toggle('hidden', cfg.mode !== 'map');
            $('xy-map-log-fields').classList.toggle('hidden', cfg.source === 'external');
            $('xy-map-external-fields').classList.toggle('hidden', cfg.source !== 'external');
            dom['map-contours'].checked = cfg.contours;
        }
        function sourceSignature() {
            return JSON.stringify(Object.entries(s.files).map(([fid, file]) => [fid, idOf(file), idOf(file.timeData), file.role, file.offset,
                file.headerInfo?.timeScale, file.timeData?.length, file.timeData?.[0], file.timeData?.[file.timeData.length - 1],
                file.columns.map(c => [c.id, c.name, c.unit, !!c.isCrossFile, c.isCustom ? idOf(file.colData[c.id]) : 0])]).concat([s.customRAMs, s.channelAliases, s.comparison?.matches]));
        }
        function signature() { return JSON.stringify([cfg, api.getContext(), sourceSignature(), s.theme, idOf(externalMap)]); }
        function invalidate(clearFocus = false) { generation++; busy = false; panel.setAttribute('aria-busy', 'false'); lastSignature = ''; lastResult = null; preparedFiles = []; if (chart) chart.clear(); dom['cursor-status'].textContent = ''; if (clearFocus) api.clearFocus?.(); }
        function changed() { invalidate(true); syncMode(); api.save(); schedule(); }
        function chartInstance() {
            if (chart) return chart;
            chart = root.echarts.init($('xy-chart'), 'v5', { renderer: 'canvas' });
            chart.on('click', event => {
                const data = event.data;
                if (!data || !data.fileId || !Array.isArray(data.value) || !event.seriesId?.startsWith('xy-points-')) return;
                const [, , , index, time, displayTime] = data.value;
                api.focusPoint({ fileId: data.fileId, index, time, displayTime });
                cursor(displayTime);
            });
            return chart;
        }
        function axisUnit(column) { return String(column?.unit || '').trim(); }
        function sameUnit(a, b) { return root.CSVCompare.sameUnit(axisUnit(a), axisUnit(b)); }
        function mapUnits(columns) {
            return columns.length === 3 && F.compatibleUnit(columns[0]?.unit, 'rpm') && F.compatibleUnit(columns[1]?.unit, 'torque') && F.compatibleUnit(columns[2]?.unit, 'sfc');
        }
        async function getBackground(token, alive) {
            if (cfg.source === 'external') return externalMap ? { map: externalMap, name: externalMap.name } : { reason: externalStatus || '背景マップCSVを選び、単位を確認して「背景に適用」を押してください。' };
            const file = sourceFile(), fid = Object.keys(s.files).find(id => s.files[id] === file);
            if (!file) return { reason: '背景に使うログがありません。' };
            const cols = [cfg.mapX, cfg.mapY, cfg.mapZ].map(name => file.columns.find(c => c.name === name));
            if (!mapUnits(cols)) return { reason: '背景の列を選択してください。回転数[rpm]・トルク[Nm]・燃費率[g/kWh]が必要です。単位がない列や異なる単位は使用しません。' };
            if (!Number.isFinite(cfg.rpmStep) || cfg.rpmStep <= 0 || !Number.isFinite(cfg.torqueStep) || cfg.torqueStep <= 0) return { reason: '格子幅は0より大きい数値で指定してください。' };
            await api.loadColumns(fid, cols.map(c => c.name));
            if (!alive()) return null;
            const values = cols.map(c => file.colData[c.id]);
            if (values.some(value => !value)) return { reason: '背景の列の読み込みが完了していません。もう一度表示してください。' };
            const key = JSON.stringify([idOf(file), ...values.map(idOf), cfg.rpmStep, cfg.torqueStep]);
            if (mapCache?.key !== key) mapCache = { key, map: F.fromSamples(...values, { rpmStep: cfg.rpmStep, torqueStep: cfg.torqueStep }) };
            return mapCache.map.ok ? { map: mapCache.map, name: label(file) + ' のSFC列' } : { reason: mapCache.map.reason };
        }
        function colorRange(map) {
            const min = cfg.colorMin ?? map.zmin, max = cfg.colorMax ?? map.zmax;
            const manual = cfg.colorMin !== null || cfg.colorMax !== null;
            if (!Number.isFinite(min) || !Number.isFinite(max) || (manual && min >= max)) return { ok: false, reason: '色の範囲は、下限より上限が大きくなるよう指定してください。空欄はその端の自動値です。' };
            return { ok: true, min, max, manual, clipped: 0 };
        }
        function makeMapSeries(map, range) {
            const cells = [];
            for (let j = 0; j < map.ys.length; j++) for (let i = 0; i < map.xs.length; i++) {
                const value = map.zz[j][i];
                if (Number.isFinite(value)) {
                    if (value < range.min || value > range.max) range.clipped++;
                    // Keep the actual value separate from its display-only color coordinate.
                    cells.push([map.xEdges[i], map.yEdges[j], map.xEdges[i + 1], map.yEdges[j + 1], value, map.xs[i], map.ys[j], map.counts?.[j]?.[i] || 1, Math.max(range.min, Math.min(range.max, value))]);
                }
            }
            const series = [{ id: 'xy-map-cells', name: '燃費率 [g/kWh]', type: 'custom', data: cells, silent: false, z: 0,
                dimensions: ['x0', 'y0', 'x1', 'y1', 'fuel', 'rpm', 'torque', 'count', 'displayColor'], encode: { x: [0, 2], y: [1, 3], tooltip: [4] },
                renderItem(params, render) {
                    const a = render.coord([render.value(0), render.value(1)]), b = render.coord([render.value(2), render.value(3)]);
                    const shape = root.echarts.graphic.clipRectByRect({ x: a[0], y: b[1], width: b[0] - a[0], height: a[1] - b[1] }, params.coordSys);
                    return shape && { type: 'rect', shape, style: { fill: render.visual('color'), opacity: 0.82 } };
                } }];
            contourNotice = '';
            if (cfg.contours && U) {
                if (map.xs.length * map.ys.length > 12000) contourNotice = '格子が多いため等高線は省略しました。色面と元の値は保持しています。';
                else {
                    const contours = [], levels = U.niceLevels(range.min, range.max, 6).slice(0, 8); let count = 0;
                    for (const level of levels) {
                        const segments = U.computeIsoSegments(map.xs, map.ys, map.zz, level); count += segments.length;
                        if (count > 12000) { contourNotice = '等高線の線分が多いため省略しました。色面と元の値は保持しています。'; break; }
                        const data = []; for (const pair of segments) data.push(pair[0], pair[1], [null, null]);
                        contours.push({ id: 'xy-contour-' + level, name: '等高線 ' + fmt(level) + ' g/kWh', type: 'line', data, showSymbol: false, connectNulls: false, triggerLineEvent: true, z: 1, lineStyle: { color: '#34465a', width: 1, opacity: 0.75 }, emphasis: { lineStyle: { width: 2 } } });
                    }
                    if (!contourNotice) series.push(...contours);
                }
            }
            return series;
        }
        function showMapStatus(background, range) {
            if (cfg.mode !== 'map') return;
            if (!background?.map) { dom['map-status'].textContent = background?.reason || '背景を読み込んでいます。'; return; }
            const map = background.map, stats = map.stats || {};
            dom['map-status'].textContent = `${background.name} · ${map.format === 'matrix' ? '行列' : map.format === 'long' ? '3列' : '格子集計'} ${map.xs.length} × ${map.ys.length} · 有効 ${stats.eligible ?? '—'}点 / 除外 ${stats.excluded ?? 0}点 · 空白 ${stats.emptyCells ?? 0}格子。背景は全体。${range?.manual ? '色 ' + fmt(range.min) + '〜' + fmt(range.max) + ' g/kWh / 範囲外 ' + range.clipped + '格子は端色（値を保持）。' : ''}${contourNotice}`;
        }
        function theme() {
            const style = getComputedStyle(document.documentElement);
            return { text: style.getPropertyValue('--text-secondary').trim() || '#8899aa', grid: style.getPropertyValue('--border').trim() || '#354052', background: style.getPropertyValue('--bg-surface').trim() || '#171c26' };
        }
        async function render() {
            if (!visible || destroyed) return;
            syncControls();
            const currentSignature = signature();
            if (currentSignature === lastSignature) return;
            const token = ++generation, context = api.getContext(), source = sourceSignature();
            const alive = () => !destroyed && visible && generation === token && source === sourceSignature() && JSON.stringify(context) === JSON.stringify(api.getContext());
            const main = api.main(), mainX = main?.columns.find(c => c.name === cfg.x), mainY = main?.columns.find(c => c.name === cfg.y), mainZ = main?.columns.find(c => c.name === cfg.z);
            dom['analysis-context'].textContent = `${context.label || '解析対象未選択'}（動作点・散布図に適用）`;
            dom['data-count'].textContent = '読み込み・集計中…'; dom['cursor-status'].textContent = '';
            preparedFiles = []; lastResult = null;
            const activeChart = chartInstance(); activeChart.clear();
            const mapMode = cfg.mode === 'map';
            if (!mapMode && (!main || !mainX || !mainY || !context.range)) { dom['data-count'].textContent = 'ログを開き、X軸・Y軸と解析対象を選択してください。'; return; }
            let pointReason = '';
            if (mapMode) {
                if (!main) pointReason = '走行ログがないため、走行点は表示しません。';
                else if (!main.columns.some(c => F.compatibleUnit(c.unit, 'torque'))) pointReason = 'このログにはトルク[Nm]の信号がないため、走行点は表示しません。スロットル開度[%]はトルクの代わりには使えません。';
                else if (!main.columns.some(c => F.compatibleUnit(c.unit, 'rpm'))) pointReason = 'このログには回転数[rpm]の信号がないため、走行点は表示しません。';
                else if (!F.compatibleUnit(mainX?.unit, 'rpm') || !F.compatibleUnit(mainY?.unit, 'torque')) pointReason = '走行点は表示しません。X軸に回転数[rpm]、Y軸にトルク[Nm]を選んでください。スロットル開度や単位のない列は使えません。';
                else if (!context.range) pointReason = '解析対象の時間範囲がないため、走行点は表示しません。';
            }
            dom['point-status'].textContent = pointReason ? pointReason + ' 背景マップは単独で表示できます。' : '';
            dom['point-status'].classList.toggle('hidden', !pointReason);
            // A background has its own axes and does not require a running log or time range.
            const names = [cfg.x, cfg.y, !mapMode && cfg.z].filter(Boolean), files = pointReason ? [] : Object.entries(s.files);
            busy = true; panel.setAttribute('aria-busy', 'true');
            const backgroundPromise = mapMode ? getBackground(token, alive).catch(error => ({ reason: '背景を読み込めませんでした: ' + (error.message || error) })) : Promise.resolve(null);
            await Promise.all(files.map(async ([fid, file]) => {
                const found = names.filter(name => api.resolve(file, name));
                if (found.length) { try { await api.loadColumns(fid, found); } catch (_) { /* Report unavailable columns below. */ } }
            }));
            let background;
            try { background = await backgroundPromise; } catch (error) { background = { reason: '背景を読み込めませんでした: ' + (error.message || error) }; }
            if (!alive()) { if (generation === token) { busy = false; panel.setAttribute('aria-busy', 'false'); } return; }
            const color = background?.map ? colorRange(background.map) : null;
            if (color && !color.ok) {
                busy = false; panel.setAttribute('aria-busy', 'false'); lastSignature = signature();
                dom['map-status'].textContent = color.reason; dom['data-count'].textContent = '色の範囲を修正すると、マップと動作点を再表示します。'; $('xy-map-settings').open = true; return;
            }
            const series = mapMode && background?.map ? makeMapSeries(background.map, color) : [];
            const pointSeries = [], summaries = [], dataFiles = [], colourSeries = []; let zmin = Infinity, zmax = -Infinity;
            for (const [fid, file] of files) {
                const xc = api.resolve(file, cfg.x), yc = api.resolve(file, cfg.y), zc = !mapMode && cfg.z ? api.resolve(file, cfg.z) : null;
                const fail = reason => summaries.push(`${label(file)}: ${reason}`);
                if (!xc || !yc || (!mapMode && cfg.z && !zc)) { fail('対象の列がなく除外'); continue; }
                if (context.rawTime && [xc, yc, zc].some(c => c?.isCrossFile)) { fail('時間合わせに依存する計算列のため除外'); continue; }
                if (mapMode ? !F.compatibleUnit(xc.unit, 'rpm') || !F.compatibleUnit(yc.unit, 'torque') : !sameUnit(xc, mainX) || !sameUnit(yc, mainY) || (zc && !sameUnit(zc, mainZ))) { fail('単位不一致で除外'); continue; }
                const x = file.colData[xc.id], y = file.colData[yc.id], z = zc ? file.colData[zc.id] : null;
                if (!x || !y || (zc && !z)) { fail('列の読み込み未完了'); continue; }
                const offset = api.effectiveOffset(file), result = F.pickPoints(file.timeData, x, y, z, { range: context.range, offset, maxPoints: 10000, nonnegative: mapMode });
                if (!result.ok) { fail(result.reason); continue; }
                const prepared = F.prepareTime(file.timeData);
                dataFiles.push({ fid, file, x, y, z, offset, prepared, mapMode, range: [...context.range] });
                summaries.push(`${label(file)}: 有効 ${result.totalCount}点 / 描画 ${result.displayCount}点${result.truncated ? '（間引き）' : ''} / 対象内の欠損・無効 ${result.excludedCount}点${result.invalidTimeCount ? ' / 時刻不正 ' + result.invalidTimeCount + '点' : ''}${prepared.ok ? '' : '。時刻不正のため波形連動不可'}`);
                const data = result.points.map(point => ({ value: [point.x, point.y, point.z ?? null, point.index, point.time, point.displayTime], fileId: fid }));
                const index = series.length + pointSeries.length;
                pointSeries.push({ id: 'xy-points-' + fid, name: label(file), type: 'scatter', data, symbol: ['circle', 'rect', 'triangle', 'diamond'][pointSeries.length % 4], symbolSize: mapMode ? 4.5 : 4, z: 3, itemStyle: { color: api.fileColor(fid) || '#39b8dc', opacity: 0.82, borderColor: mapMode ? '#26364a' : undefined, borderWidth: mapMode ? 0.5 : 0 }, emphasis: { scale: 1.8 }, animation: false });
                if (zc) { colourSeries.push(index); if (Number.isFinite(result.zmin)) zmin = Math.min(zmin, result.zmin); if (Number.isFinite(result.zmax)) zmax = Math.max(zmax, result.zmax); }
            }
            series.push(...pointSeries);
            for (const data of dataFiles) series.push({ id: 'xy-cursor-' + data.fid, name: 'カーソル / ' + label(data.file), type: 'scatter', data: [], symbol: 'diamond', symbolSize: 14, z: 6, silent: true, itemStyle: { color: api.fileColor(data.fid) || '#ffbd44', borderColor: '#fff', borderWidth: 2 }, tooltip: { show: false } });
            const colors = theme(), map = background?.map, visualMap = [];
            if (map) visualMap.push({ type: 'continuous', min: color.min, max: color.max === color.min ? color.max + Math.max(Math.abs(color.max) * 1e-8, 1) : color.max, dimension: 8, seriesIndex: [0], calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 120, itemWidth: 10, text: [fmt(color.max) + ' g/kWh', fmt(color.min)], textStyle: { color: colors.text, fontSize: 10 }, inRange: { color: ['#32a6a0', '#a4d990', '#f3e89e', '#e89468', '#bd4968'] } });
            else if (colourSeries.length && Number.isFinite(zmin) && Number.isFinite(zmax)) visualMap.push({ type: 'continuous', min: zmin, max: zmin === zmax ? zmax + 1 : zmax, dimension: 2, seriesIndex: colourSeries, calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 120, itemWidth: 10, text: [fmt(zmax) + (mainZ?.unit ? ' [' + mainZ.unit + ']' : ''), fmt(zmin)], textStyle: { color: colors.text, fontSize: 10 }, inRange: { color: ['#4777cd', '#5ac7c7', '#f2d76b', '#db6559'] } });
            const style = { axisLabel: { color: colors.text, formatter: value => fmt(value), fontSize: 10 }, axisLine: { lineStyle: { color: colors.text } }, nameTextStyle: { color: colors.text, fontSize: 11 }, splitLine: { lineStyle: { color: colors.grid } }, scale: true };
            activeChart.setOption({ animation: false, backgroundColor: 'transparent', legend: { data: pointSeries.map(item => item.name), show: pointSeries.length > 1, type: 'scroll', top: 2, textStyle: { color: colors.text, fontSize: 10 } },
                grid: { left: 68, right: 20, top: 38, bottom: visualMap.length ? 90 : 52, outerBoundsMode: 'none' },
                xAxis: { type: 'value', name: mapMode ? 'エンジン回転数 [rpm]' : `${cfg.x}${mainX.unit ? ' [' + mainX.unit + ']' : ''}`, nameLocation: 'middle', nameGap: 28, ...style },
                yAxis: { type: 'value', name: mapMode ? 'トルク [Nm]' : `${cfg.y}${mainY.unit ? ' [' + mainY.unit + ']' : ''}`, nameLocation: 'middle', nameGap: 47, ...style },
                visualMap, tooltip: { trigger: 'item', confine: true, formatter(event) {
                    const v = event.value;
                    if (event.seriesId === 'xy-map-cells') return `背景の格子値<br>${fmt(v[5])} rpm / ${fmt(v[6])} Nm<br>${fmt(v[4])} g/kWh<br>集計 ${fmt(v[7])}点（格子平均）`;
                    if (event.seriesName?.startsWith('等高線 ')) return `${esc(event.seriesName)}<br>有効な格子間の補間線（実測点ではありません）`;
                    if (!event.data?.fileId) return '';
                    return `${esc(event.seriesName)}<br>${esc(cfg.x)}: ${fmt(v[0])}<br>${esc(cfg.y)}: ${fmt(v[1])}${cfg.mode === 'scatter' && cfg.z ? '<br>' + esc(cfg.z) + ': ' + fmt(v[2]) : ''}<br>元時刻 ${fmt(v[4])} s / 表示時刻 ${fmt(v[5])} s<br>クリックでこの時刻へ`;
                } }, series }, { notMerge: true });
            preparedFiles = dataFiles; renderCount++; lastSignature = signature(); busy = false; panel.setAttribute('aria-busy', 'false');
            lastResult = { background: background?.map || null, backgroundName: background?.name || '', colorRange: color, files: dataFiles.map(d => d.fid), seriesCount: series.length, context: { ...context }, summaries };
            dom['data-count'].textContent = summaries.join(' / ') || (pointReason && background?.map ? '背景マップのみ表示しています。' : '対象区間に表示できる動作点がありません。');
            showMapStatus(background, color);
            if (Number.isFinite(lastCursor)) cursor(lastCursor);
        }
        function schedule() {
            if (!visible || destroyed || frame !== null) return;
            frame = requestAnimationFrame(() => { frame = null; render().catch(error => { if (!visible || destroyed) return; busy = false; panel.setAttribute('aria-busy', 'false'); dom['data-count'].textContent = '表示できませんでした: ' + (error.message || error); }); });
        }
        function cursor(time) {
            lastCursor = Number.isFinite(time) ? time : null;
            if (!visible || !chart || !lastResult || !preparedFiles.length) return;
            const updates = [], labels = [];
            for (const data of preparedFiles) {
                const nearest = Number.isFinite(time) && data.prepared.ok ? F.nearestPoint(data.prepared, data.x, data.y, data.z, time, { range: data.range, offset: data.offset, nonnegative: data.mapMode }) : null;
                const p = nearest?.ok && nearest.point;
                updates.push({ id: 'xy-cursor-' + data.fid, data: p ? [[p.x, p.y]] : [] });
                if (p) labels.push(`${label(data.file)}: 元 ${fmt(p.time)} s / 表示 ${fmt(p.displayTime)} s`);
            }
            if (updates.length) chart.setOption({ series: updates }, { lazyUpdate: true });
            cursorUpdateCount++;
            dom['cursor-status'].textContent = Number.isFinite(time) ? `カーソル ${fmt(time)} s · ${labels.join(' / ') || '対象内の有効な元サンプルなし'}（最寄りの観測点。補間なし）` : '';
        }
        function setVisible(next) {
            next = !!next;
            if (visible === next) { if (next) { chart?.resize(); schedule(); } return; }
            visible = next; panel.classList.toggle('hidden', !visible);
            if (!visible) { invalidate(true); chart?.dispose(); chart = null; if (pendingImport) { importGeneration++; pendingImport = false; pendingRows = null; pendingFile = null; pendingIdentity = null; showImportFeedback('CSVの読み込みを中止しました。ファイルを選び直してください。'); updateApplyState(); } expanded = false; panel.classList.remove('xy-expanded'); dom['expand-btn'].textContent = '大きく表示'; dom['expand-btn'].setAttribute('aria-expanded', 'false'); }
            else { requestAnimationFrame(() => { chart?.resize(); schedule(); }); }
            api.resize();
        }
        function open() {
            const active = document.activeElement;
            if (!visible) opener = active?.closest('.compare-tools')?.querySelector('summary') || (active instanceof HTMLElement && active !== document.body ? active : $('xy-panel-toggle'));
            api.activatePanel('xy'); setVisible(true); dom['close-btn'].focus({ preventScroll: true });
        }
        function close() {
            api.activatePanel('compare'); setVisible(false);
            const target = opener?.isConnected && opener.getClientRects().length ? opener : $('xy-panel-toggle'); target?.focus({ preventScroll: true });
        }
        function toggleExpanded() {
            expanded = !expanded; panel.classList.toggle('xy-expanded', expanded);
            dom['expand-btn'].textContent = expanded ? '並べて表示に戻る' : '大きく表示'; dom['expand-btn'].setAttribute('aria-expanded', String(expanded));
            requestAnimationFrame(() => { chart?.resize(); api.resize(); });
        }
        async function readMapFile(file) {
            const token = ++importGeneration; pendingRows = null; pendingFile = file || null; pendingIdentity = null; pendingImport = false; externalStatus = ''; savedExternalIdentity = null;
            const source = sourceSignature(), context = JSON.stringify(api.getContext()), selectedMode = cfg.mode, selectedSource = cfg.source, format = dom['map-format'].value;
            const currentImport = () => token === importGeneration && !destroyed && source === sourceSignature() && context === JSON.stringify(api.getContext()) && selectedMode === cfg.mode && selectedSource === cfg.source && format === dom['map-format'].value;
            const changedImport = () => { if (token === importGeneration) { pendingRows = null; pendingFile = null; pendingIdentity = null; showImportFeedback('読み込み中に対象や条件が変わりました。マップCSVを選び直してください。'); } };
            dom['map-confirm-units'].checked = false; dom['map-apply'].disabled = true;
            externalMap = null; dom['map-clear'].disabled = !file; invalidate(true);
            if (!file) { updateApplyState(); schedule(); return; }
            if (file.size > 5 * 1024 * 1024) { showImportFeedback('マップCSVは5 MiB以下にしてください。', true); pendingFile = null; schedule(); return; }
            pendingImport = true; updateApplyState(); schedule();
            try {
                const text = await file.text();
                if (!currentImport()) { changedImport(); return; }
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
                if (!currentImport()) { changedImport(); return; }
                pendingIdentity = { name: file.name, size: file.size, lastModified: file.lastModified, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
                const parsed = root.Papa.parse(text, { skipEmptyLines: 'greedy' });
                if (parsed.errors.some(error => error.code !== 'UndetectableDelimiter')) throw new Error(parsed.errors[0].message);
                const first = (parsed.data[0] || []).join(' ');
                if (/throttle|スロットル/i.test(first)) throw new Error('このCSVの軸はスロットル開度です。トルク[Nm]の背景マップを選んでください。');
                pendingRows = parsed.data;
            } catch (error) { if (token === importGeneration) { pendingRows = null; pendingFile = null; showImportFeedback('CSVを読み込めませんでした: ' + (error.message || error), true); } }
            finally { if (token === importGeneration) { pendingImport = false; updateApplyState(); } }
        }
        function applyMap() {
            if (!pendingRows || !pendingFile || pendingImport || !dom['map-confirm-units'].checked) { updateApplyState(); return; }
            const result = F.parseMap(pendingRows, { format: dom['map-format'].value });
            if (!result.ok) { showImportFeedback(result.reason, true, true); return; }
            if (Object.entries(result.unitHints || {}).some(([key, unit]) => unit && !F.compatibleUnit(unit, { x: 'rpm', y: 'torque', z: 'sfc' }[key]))) {
                showImportFeedback('CSVの見出しに異なる単位が指定されています。rpm・Nm・g/kWhのマップを使用してください。', true, true); return;
            }
            externalMap = { ...result, name: pendingFile.name, identity: pendingIdentity }; savedExternalIdentity = pendingIdentity; cfg.source = 'external';
            showImportFeedback(`${pendingFile.name} を背景に適用しました。`); $('xy-map-settings').open = false; dom['map-clear'].disabled = false; changed();
        }
        function collectSettings() {
            const source = sourceFile();
            return { ...cfg, source: cfg.source === 'external' || cfg.source === 'main' ? cfg.source : 'named', sourceName: source?.name || cfg.sourceName || '', externalMapIdentity: externalMap?.identity || savedExternalIdentity };
        }
        function applySettings(value, options = {}) {
            importGeneration++; pendingRows = null; pendingFile = null; pendingIdentity = null; pendingImport = false; mapCache = null;
            const saved = value && typeof value === 'object' ? value : {};
            const identity = saved.externalMapIdentity;
            savedExternalIdentity = identity && typeof identity === 'object' && typeof identity.name === 'string' && typeof identity.sha256 === 'string'
                ? { name: identity.name, size: identity.size, lastModified: identity.lastModified, sha256: identity.sha256 } : null;
            if (!options.preserveMap || !externalMap || !savedExternalIdentity || JSON.stringify(externalMap.identity) !== JSON.stringify(savedExternalIdentity)) externalMap = null;
            cfg = { ...defaults };
            for (const key of ['x', 'y', 'z', 'sourceName', 'mapX', 'mapY', 'mapZ']) if (typeof saved[key] === 'string') cfg[key] = saved[key];
            cfg.mode = saved.mode === 'map' ? 'map' : 'scatter';
            cfg.source = ['main', 'external', 'named'].includes(saved.source) ? saved.source : 'main';
            for (const key of ['rpmStep', 'torqueStep']) if (typeof saved[key] === 'number' && Number.isFinite(saved[key]) && saved[key] > 0) cfg[key] = saved[key];
            for (const key of ['colorMin', 'colorMax']) if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) cfg[key] = saved[key];
            cfg.contours = saved.contours === true;
            dom['map-rpm-step'].value = cfg.rpmStep; dom['map-torque-step'].value = cfg.torqueStep;
            dom['map-color-min'].value = cfg.colorMin ?? ''; dom['map-color-max'].value = cfg.colorMax ?? '';
            dom['map-file'].value = ''; dom['map-confirm-units'].checked = false; dom['map-apply'].disabled = true; dom['map-clear'].disabled = !externalMap;
            externalStatus = '';
            if (!externalMap && cfg.source === 'external') showImportFeedback('背景CSVのデータは保存しません。ファイルを再度選び、単位を確認して適用してください。');
            else showImportFeedback(externalMap ? `${externalMap.name} を背景に適用しています。` : 'CSVを選び、単位確認にチェックを入れてください。');
            controlsSignature = ''; invalidate(true); syncControls(true); schedule();
        }
        function clear() {
            importGeneration++; pendingRows = null; pendingFile = null; pendingIdentity = null; pendingImport = false; externalMap = null; savedExternalIdentity = null; mapCache = null; lastCursor = null; externalStatus = '';
            dom['map-file'].value = ''; dom['map-clear'].disabled = true; dom['map-apply'].disabled = true; dom['map-confirm-units'].checked = false;
            updateApplyState();
            invalidate(true); controlsSignature = ''; schedule();
        }
        dom.mode.addEventListener('change', () => {
            cfg.mode = dom.mode.value;
            if (cfg.mode === 'map') {
                const columns = api.main()?.columns || [];
                if (!F.compatibleUnit(columns.find(c => c.name === cfg.x)?.unit, 'rpm')) cfg.x = choose(columns, 'rpm', ['engine_speed', 'engine_rpm', 'rpm']);
                if (!F.compatibleUnit(columns.find(c => c.name === cfg.y)?.unit, 'torque')) cfg.y = choose(columns, 'torque', ['engine_torque', 'torque']);
                if (!columns.some(c => c.name === cfg.mapX)) cfg.source = 'external';
                syncControls(true);
                $('xy-map-settings').open = cfg.source === 'external' && !externalMap;
            } else syncControls(true);
            changed();
        });
        for (const [id, key] of [['x-select', 'x'], ['y-select', 'y'], ['z-select', 'z'], ['map-x-select', 'mapX'], ['map-y-select', 'mapY'], ['map-z-select', 'mapZ']]) dom[id].addEventListener('change', () => { cfg[key] = dom[id].value; changed(); });
        dom['map-source'].addEventListener('change', () => { if (pendingImport) { importGeneration++; pendingImport = false; pendingRows = null; pendingFile = null; pendingIdentity = null; showImportFeedback('背景の参照元を変えたため、CSVの読み込みを中止しました。ファイルを選び直してください。'); updateApplyState(); } cfg.source = dom['map-source'].value; cfg.sourceName = sourceFile()?.name || ''; syncControls(true); changed(); });
        for (const [id, key] of [['map-rpm-step', 'rpmStep'], ['map-torque-step', 'torqueStep']]) dom[id].addEventListener('change', () => { cfg[key] = dom[id].value.trim() ? Number(dom[id].value) : NaN; changed(); });
        for (const [id, key] of [['map-color-min', 'colorMin'], ['map-color-max', 'colorMax']]) dom[id].addEventListener('change', () => { cfg[key] = dom[id].validity.badInput ? NaN : dom[id].value.trim() ? Number(dom[id].value) : null; changed(); });
        dom['map-contours'].addEventListener('change', () => { cfg.contours = dom['map-contours'].checked; changed(); });
        dom['map-file'].addEventListener('change', () => readMapFile(dom['map-file'].files[0]));
        dom['map-confirm-units'].addEventListener('change', updateApplyState);
        dom['map-apply'].addEventListener('click', applyMap);
        dom['map-clear'].addEventListener('click', () => { clear(); showImportFeedback('背景を解除しました。走行ログと軸の設定は残しています。'); api.save(); });
        dom['expand-btn'].addEventListener('click', toggleExpanded); dom['close-btn'].addEventListener('click', close);
        const onKey = event => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !visible || !panel.contains(document.activeElement)) return;
            if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
            event.preventDefault(); event.stopPropagation();
            if (expanded) toggleExpanded(); else close();
        };
        panel.addEventListener('keydown', onKey);
        let resizeFrame = null;
        const observer = new ResizeObserver(() => { if (!visible || resizeFrame !== null) return; resizeFrame = requestAnimationFrame(() => { resizeFrame = null; chart?.resize(); }); });
        observer.observe($('xy-chart'));
        return { open, close, setVisible, schedule, cursor, collectSettings, applySettings, clear,
            inspect: () => ({ chart, visible, expanded, mode: cfg.mode, config: { ...cfg }, lastResult, map: lastResult?.background || null, renderCount, cursorUpdateCount, busy, pendingImport }),
            destroy() { destroyed = true; generation++; importGeneration++; observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); panel.removeEventListener('keydown', onKey); chart?.dispose(); panel.remove(); } };
    };
})(window);
