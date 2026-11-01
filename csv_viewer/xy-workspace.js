/* Same-workspace XY and fuel-map view. The host owns parsing, time scope and wave navigation. */
(function (root) {
    'use strict';
    root.CSVXYWorkspace = function (api) {
        const F = root.CSVFuelMap, U = root.CSVXYUtils, s = api.state;
        const esc = api.esc, $ = id => document.getElementById(id);
        const fmt = value => Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : '—';
        const defaults = { mode: 'scatter', x: '', y: '', z: '', source: 'main', sourceName: '', mapX: 'sfc_ne', mapY: 'sfc_te', mapZ: 'sfc_g_kwh', rpmStep: 400, torqueStep: 3, colorMin: null, colorMax: null, mapStyle: 'lines', contourStep: 10, splitRatio: .5 };
        let cfg = { ...defaults }, visible = false, expanded = false, generation = 0, importGeneration = 0, frame = null;
        let chart = null, destroyed = false, externalMap = null, pendingFile = null, pendingRows = null, pendingIdentity = null, savedExternalIdentity = null, opener = null;
        let lastSignature = '', controlsSignature = '', lastResult = null, mapCache = null, lastCursor = null, contourCache = null, contourBuildCount = 0;
        let zoomEnabled = false, viewSignature = '', zoomRanges = [{ start: 0, end: 100 }, { start: 0, end: 100 }];
        let preparedFiles = [], renderCount = 0, cursorUpdateCount = 0, contourNotice = '', busy = false, pendingImport = false, externalStatus = '';
        let cursorFrame = null, resizeFrame = null, cursorPoints = [], legendSelected = {}, layout = null;
        const cursorMarkers = new Map();
        const identities = new WeakMap(); let nextIdentity = 1;
        const idOf = object => { if (!object || typeof object !== 'object') return 0; if (!identities.has(object)) identities.set(object, nextIdentity++); return identities.get(object); };
        const panel = document.createElement('aside');
        panel.id = 'xy-workspace'; panel.className = 'xy-workspace hidden'; panel.setAttribute('aria-label', 'XYと燃費率マップ');
        panel.innerHTML = `<header class="xy-workspace-header"><h2>XY・燃費率マップ</h2><button id="xy-expand-btn" class="btn-secondary" aria-expanded="false">大きく表示</button><button id="xy-close-btn" class="btn-secondary" aria-label="XY・マップを閉じて比較へ戻る">×</button></header>
          <div class="xy-workspace-scroll"><details id="xy-map-settings" class="xy-workspace-controls"><summary id="xy-settings-summary">表示・軸・背景設定</summary><div class="xy-settings-fields">
          <label>表示<select id="xy-mode"><option value="scatter">散布図</option><option value="map">燃費率マップ</option></select></label>
          <div class="xy-field-pair"><label><span id="xy-x-label">X軸</span><select id="xy-x-select" aria-label="X軸チャンネル"></select></label><label><span id="xy-y-label">Y軸</span><select id="xy-y-select" aria-label="Y軸チャンネル"></select></label></div>
          <label id="xy-color-field">点の色<select id="xy-z-select" aria-label="色に使うチャンネル"></select></label>
          <div id="xy-map-controls" class="hidden"><label>背景マップのデータ<select id="xy-map-source" aria-label="背景マップのデータ"></select></label>
          <div id="xy-map-log-fields"><details><summary>背景の列・格子幅</summary><p class="xy-help">背景は選んだログのSFC列全体を格子平均します。走行中の燃料流量から燃費率を計算する機能ではありません。</p>
          <label>背景の回転数 [rpm]<select id="xy-map-x-select"></select></label><label>背景のトルク [Nm]<select id="xy-map-y-select"></select></label><label>背景の燃費率 [g/kWh]<select id="xy-map-z-select"></select></label>
          <div class="xy-field-pair"><label>回転数の格子幅 [rpm]<input id="xy-map-rpm-step" type="number" min="0" step="any" value="400"></label><label>トルクの格子幅 [Nm]<input id="xy-map-torque-step" type="number" min="0" step="any" value="3"></label></div></details></div>
          <div id="xy-map-external-fields" class="hidden"><label>マップCSVを選ぶ<input id="xy-map-file" type="file" accept=".csv,.txt,.tsv"></label><p class="xy-help">走行ログとは別に読み込みます。UTF-8、5 MiBまで。行列形式は先頭行が回転数、先頭列がトルク。3列形式は回転数・トルク・燃費率の順です。</p>
          <label>CSVの形式<select id="xy-map-format"><option value="auto">自動判別</option><option value="matrix">行列（先頭行X・先頭列Y）</option><option value="long">3列（X・Y・燃費率）</option></select></label>
          <label class="xy-checkbox"><input id="xy-map-confirm-units" type="checkbox">このCSVの単位が X＝rpm、Y＝Nm、燃費率＝g/kWh であることを確認した</label>
          <div class="xy-field-pair"><button id="xy-map-apply" class="btn-primary" aria-describedby="xy-map-feedback" disabled>背景に適用</button><button id="xy-map-clear" class="btn-secondary" disabled>背景を解除</button></div><p id="xy-map-feedback" class="xy-help xy-map-feedback" role="status" aria-live="polite">CSVを選び、単位確認にチェックを入れてください。</p></div>
          <label>背景の表示<select id="xy-map-style"><option value="fill">塗りつぶし</option><option value="lines">等高線のみ</option><option value="both">塗りつぶし＋等高線</option></select></label>
          <div class="xy-field-pair"><label>燃費率の下限 [g/kWh]<input id="xy-map-color-min" type="number" step="any" placeholder="空欄＝自動"></label><label>燃費率の上限 [g/kWh]<input id="xy-map-color-max" type="number" step="any" placeholder="空欄＝自動"></label></div>
          <p class="xy-help">色と等高線に共通の範囲です。空欄は元データ全体。例：200〜500 g/kWh。塗りつぶしの範囲外は端の色になり、元の値は保持します。</p>
          <label>等高線の間隔 [g/kWh]<input id="xy-map-contour-step" type="number" min="0" step="any" value="10" aria-describedby="xy-contour-help"></label>
          <p id="xy-contour-help" class="xy-help">通常10、詳細5、広く見るときは20が目安です。主要線は太線と数値で表示。等高線は有効な格子間の線形補間で、元データの精度を増やしません。欠損セルは埋めません。走行点は回転数とトルクが非負の元サンプルです。</p>
          </div></div></details>
          <div class="xy-workspace-content"><p id="xy-point-status" class="xy-help hidden" role="status" aria-live="polite"></p><div id="xy-map-navigation" class="xy-map-navigation hidden"><button id="xy-map-zoom-btn" class="btn-secondary" aria-pressed="false">拡大操作 OFF</button><button id="xy-map-reset-view" class="btn-secondary">全体に戻す</button><span class="xy-help">ONでホイール・ピンチ拡大、ドラッグ移動</span></div><div id="xy-chart-frame" class="xy-chart-frame"><div id="xy-chart" class="xy-workspace-chart" role="img" aria-label="XY・燃費率マップ"></div><div id="xy-cursor-overlay" class="xy-cursor-overlay" aria-hidden="true"></div></div><p id="xy-analysis-context" class="analysis-result-context"></p><p id="xy-map-status" class="xy-help" role="status" aria-live="polite"></p><p id="xy-data-count" class="xy-help" role="status" aria-live="polite"></p>
          <p id="xy-cursor-status" class="xy-help" role="status"></p><p class="xy-help">波形のカーソルに動作点が連動します。点をクリックすると、その元サンプルの時刻へ移動します。背景マップは全体、動作点は上の解析対象に連動します。</p></div></div>`;
        document.querySelector('.compare-body').appendChild(panel);
        const dom = Object.fromEntries(['mode', 'x-label', 'y-label', 'x-select', 'y-select', 'z-select', 'point-status', 'map-source', 'map-file', 'map-format', 'map-confirm-units', 'map-apply', 'map-clear', 'map-feedback', 'map-rpm-step', 'map-torque-step', 'map-color-min', 'map-color-max', 'map-style', 'map-contour-step', 'map-zoom-btn', 'map-reset-view', 'map-x-select', 'map-y-select', 'map-z-select', 'expand-btn', 'close-btn', 'map-status', 'data-count', 'analysis-context', 'cursor-status'].map(key => [key, $('xy-' + key)]));

        function setMapStatus(message, priority = false) {
            dom['map-status'].textContent = message;
            dom['map-status'].classList.toggle('xy-status-priority', priority);
        }
        function showImportFeedback(message, error = false, reveal = false) {
            externalStatus = message;
            setMapStatus(message, error || !externalMap);
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
            $('xy-map-navigation').classList.toggle('hidden', cfg.mode !== 'map');
            dom['map-style'].value = cfg.mapStyle;
            dom['map-contour-step'].disabled = cfg.mapStyle === 'fill';
            dom['map-status'].classList.toggle('hidden', cfg.mode !== 'map');
            const summary = $('xy-settings-summary');
            summary.textContent = `表示・軸・背景設定 · ${cfg.mode === 'map' ? '燃費率マップ' : '散布図'}：${cfg.x && cfg.y ? cfg.x + ' × ' + cfg.y : 'X軸・Y軸を選択'}`;
            summary.title = summary.textContent;
            if (cfg.mode === 'scatter' && (!cfg.x || !cfg.y)) $('xy-map-settings').open = true;
        }
        function sourceSignature() {
            return JSON.stringify(Object.entries(s.files).map(([fid, file]) => [fid, idOf(file), idOf(file.timeData), file.role, file.offset,
                file.headerInfo?.timeScale, file.timeData?.length, file.timeData?.[0], file.timeData?.[file.timeData.length - 1],
                file.columns.map(c => [c.id, c.name, c.unit, !!c.isCrossFile, c.isCustom ? idOf(file.colData[c.id]) : 0])]).concat([s.customRAMs, s.channelAliases, s.comparison?.matches]));
        }
        function signature() { const { splitRatio, ...renderConfig } = cfg; return JSON.stringify([renderConfig, api.getContext(), sourceSignature(), s.theme, idOf(externalMap)]); }
        function clearCursor() {
            if (cursorFrame !== null) { cancelAnimationFrame(cursorFrame); cursorFrame = null; }
            for (const marker of cursorMarkers.values()) marker.remove();
            cursorMarkers.clear(); cursorPoints = [];
            dom['cursor-status'].textContent = ''; dom['cursor-status'].title = '';
        }
        function invalidate(clearFocus = false) { generation++; busy = false; panel.setAttribute('aria-busy', 'false'); lastSignature = ''; lastResult = null; preparedFiles = []; clearCursor(); if (chart) chart.clear(); if (clearFocus) api.clearFocus?.(); }
        function changed() { invalidate(true); syncMode(); api.save(); schedule(); }
        function zoomOptions() {
            return ['x', 'y'].map((axis, i) => ({ id: 'xy-' + axis + '-zoom', type: 'inside', [axis + 'AxisIndex']: 0, filterMode: 'none',
                disabled: !zoomEnabled, zoomOnMouseWheel: zoomEnabled, moveOnMouseWheel: false, moveOnMouseMove: zoomEnabled,
                preventDefaultMouseMove: zoomEnabled, ...zoomRanges[i] }));
        }
        function syncZoomButton() {
            dom['map-zoom-btn'].textContent = zoomEnabled ? '拡大操作 ON' : '拡大操作 OFF';
            dom['map-zoom-btn'].setAttribute('aria-pressed', String(zoomEnabled));
        }
        function resetView() {
            zoomRanges = [{ start: 0, end: 100 }, { start: 0, end: 100 }]; zoomEnabled = false; syncZoomButton();
            if (chart && cfg.mode === 'map') {
                chart.dispatchAction({ type: 'dataZoom', batch: ['x', 'y'].map(axis => ({ dataZoomId: 'xy-' + axis + '-zoom', start: 0, end: 100 })) });
                chart.setOption({ dataZoom: zoomOptions() });
                scheduleCursor();
            }
        }
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
            chart.on('datazoom', event => {
                // The event already contains the ranges. getOption() would clone the entire
                // map and every running point for each wheel/drag event.
                for (const item of event.batch || [event]) {
                    const index = ['xy-x-zoom', 'xy-y-zoom'].indexOf(item.dataZoomId);
                    if (index >= 0 && Number.isFinite(item.start) && Number.isFinite(item.end)) zoomRanges[index] = { start: item.start, end: item.end };
                }
                scheduleCursor();
            });
            chart.on('legendselectchanged', event => { legendSelected = event.selected || {}; scheduleCursor(); });
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
            if (!Number.isFinite(min) || !Number.isFinite(max) || (manual && min >= max)) return { ok: false, reason: '燃費率の範囲は、下限より上限が大きくなるよう指定してください。空欄はその端の自動値です。' };
            return { ok: true, min, max, manual, clipped: 0 };
        }
        function makeMapSeries(map, range) {
            const cells = [];
            if (cfg.mapStyle !== 'lines') for (let j = 0; j < map.ys.length; j++) for (let i = 0; i < map.xs.length; i++) {
                const value = map.zz[j][i];
                if (Number.isFinite(value)) {
                    if (value < range.min || value > range.max) range.clipped++;
                    // Keep the actual value separate from its display-only color coordinate.
                    cells.push([map.xEdges[i], map.yEdges[j], map.xEdges[i + 1], map.yEdges[j + 1], value, map.xs[i], map.ys[j], map.counts?.[j]?.[i] || 1, Math.max(range.min, Math.min(range.max, value))]);
                }
            }
            const series = cfg.mapStyle === 'lines' ? [] : [{ id: 'xy-map-cells', name: '燃費率 [g/kWh]', type: 'custom', data: cells, silent: false, z: 0,
                dimensions: ['x0', 'y0', 'x1', 'y1', 'fuel', 'rpm', 'torque', 'count', 'displayColor'], encode: { x: [0, 2], y: [1, 3], tooltip: [4] },
                renderItem(params, render) {
                    const a = render.coord([render.value(0), render.value(1)]), b = render.coord([render.value(2), render.value(3)]);
                    const shape = root.echarts.graphic.clipRectByRect({ x: a[0], y: b[1], width: b[0] - a[0], height: a[1] - b[1] }, params.coordSys);
                    return shape && { type: 'rect', shape, style: { fill: render.visual('color'), opacity: 0.82 } };
                } }];
            contourNotice = '';
            if (cfg.mapStyle !== 'fill') {
                const key = JSON.stringify([idOf(map), range.min, range.max, cfg.contourStep]);
                if (contourCache?.key !== key) {
                    contourCache = { key, value: U.prepareContours(map, { min: range.min, max: range.max, step: cfg.contourStep }) };
                    contourBuildCount++;
                }
                const result = contourCache.value;
                if (!result.ok || !result.segmentCount) {
                    contourNotice = `${result.reason || 'この範囲に等高線はありません。'} 「塗りつぶし」で元の格子値を確認できます。`;
                    return series;
                }
                const levels = result.levels.filter(level => level.segments.length), majorEvery = Math.max(1, Math.ceil(levels.length / 12));
                const colors = theme(), labels = [];
                for (let index = 0; index < levels.length; index++) {
                    const level = levels[index], majorIndex = level.value / (result.step * majorEvery), major = Math.abs(majorIndex - Math.round(majorIndex)) < 1e-8, data = [];
                    for (const path of level.paths) data.push(...path, [null, null]);
                    series.push({ id: 'xy-contour-' + level.value, name: '等高線 ' + fmt(level.value) + ' g/kWh', type: 'line', data, showSymbol: false, connectNulls: false, triggerLineEvent: true, clip: true, z: 1,
                        lineStyle: { color: cfg.mapStyle === 'both' ? colors.overFill : colors.contour, width: major ? 1.6 : 0.8, opacity: major ? 0.95 : 0.65 }, emphasis: { lineStyle: { width: 2.2 } } });
                    if (major) {
                        const point = contourLabelPoint(level.paths, map, index);
                        if (point) labels.push([point[0], point[1], level.value]);
                    }
                }
                series.push({ id: 'xy-contour-labels', name: '等高線の値 [g/kWh]', type: 'scatter', data: labels, symbolSize: 0, silent: true, clip: true, z: 2,
                    label: { show: true, position: 'inside', formatter: item => fmt(item.value[2]), color: colors.label, backgroundColor: colors.background, padding: [2, 3], borderRadius: 2, fontSize: 10 },
                    labelLayout: { hideOverlap: true }, tooltip: { show: false } });
                contourNotice = `等高線 ${fmt(result.step)} g/kWh刻み・${levels.length}段階。数字は主要線の燃費率[g/kWh]です。${result.adjusted ? result.reason : ''}`;
            }
            return series;
        }
        function contourLabelPoint(paths, map, index) {
            const dx = map.xs[map.xs.length - 1] - map.xs[0] || 1, dy = map.ys[map.ys.length - 1] - map.ys[0] || 1;
            const distance = (a, b) => Math.hypot((a[0] - b[0]) / dx, (a[1] - b[1]) / dy);
            let longest = null, length = 0;
            for (const path of paths) {
                let total = 0;
                for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i]);
                if (total > length) { length = total; longest = path; }
            }
            if (!longest || length < 0.06) return null;
            const target = length * [0.35, 0.55, 0.7][index % 3]; let walked = 0;
            for (let i = 1; i < longest.length; i++) {
                const a = longest[i - 1], b = longest[i], step = distance(a, b);
                if (step > 0 && walked + step >= target) { const t = (target - walked) / step; return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; }
                walked += step;
            }
            return longest[longest.length - 1];
        }
        function showMapStatus(background, range) {
            if (cfg.mode !== 'map') return;
            if (!background?.map) { setMapStatus(background?.reason || '背景を読み込んでいます。', true); return; }
            const map = background.map, stats = map.stats || {};
            setMapStatus(`${background.name} · ${map.format === 'matrix' ? '行列' : map.format === 'long' ? '3列' : '格子集計'} ${map.xs.length} × ${map.ys.length} · 有効 ${stats.eligible ?? '—'}点 / 除外 ${stats.excluded ?? 0}点 · 空白 ${stats.emptyCells ?? 0}格子。背景は時間区間で切り取りません。${range?.manual ? '燃費率 ' + fmt(range.min) + '〜' + fmt(range.max) + ' g/kWh。' + (cfg.mapStyle === 'lines' ? '' : '範囲外 ' + range.clipped + '格子は端色（値を保持）。') : ''}${contourNotice}`,
                cfg.mapStyle !== 'fill' && !!contourCache && (!contourCache.value.ok || !contourCache.value.segmentCount));
        }
        function theme() {
            const style = getComputedStyle(document.documentElement);
            const light = s.theme === 'light';
            return { text: style.getPropertyValue('--text-secondary').trim() || (light ? '#536875' : '#aab9cb'), grid: style.getPropertyValue('--border').trim() || '#354052',
                background: style.getPropertyValue('--bg-surface').trim() || (light ? '#f5f8fc' : '#171c26'), label: light ? '#253d50' : '#edf5ff',
                contour: light ? '#42647c' : '#b3ccdf', overFill: light ? '#2b455b' : '#26394b' };
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
            dom['data-count'].textContent = '読み込み・集計中…'; clearCursor(); legendSelected = {};
            preparedFiles = []; lastResult = null;
            const activeChart = chartInstance(); activeChart.clear();
            const mapMode = cfg.mode === 'map';
            if (!mapMode && (!main || !mainX || !mainY || !context.range)) {
                dom['point-status'].textContent = 'ログを開き、「表示・軸・背景設定」でX軸・Y軸と解析対象を選択してください。';
                dom['point-status'].classList.remove('hidden'); dom['data-count'].textContent = dom['point-status'].textContent;
                $('xy-map-settings').open = true; return;
            }
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
                setMapStatus(color.reason, true); dom['data-count'].textContent = '燃費率の範囲を修正すると、マップと動作点を再表示します。'; $('xy-map-settings').open = true; return;
            }
            const map = background?.map;
            const xExtent = map ? [Math.max(0, map.xEdges[0]), map.xEdges[map.xEdges.length - 1]] : [Infinity, -Infinity];
            const yExtent = map ? [Math.max(0, map.yEdges[0]), map.yEdges[map.yEdges.length - 1]] : [Infinity, -Infinity];
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
                if (result.totalCount) {
                    xExtent[0] = Math.min(xExtent[0], result.xmin); xExtent[1] = Math.max(xExtent[1], result.xmax);
                    yExtent[0] = Math.min(yExtent[0], result.ymin); yExtent[1] = Math.max(yExtent[1], result.ymax);
                }
                const prepared = F.prepareTime(file.timeData);
                dataFiles.push({ fid, file, x, y, z, offset, prepared, mapMode, range: [...context.range] });
                summaries.push(`${label(file)}: 有効 ${result.totalCount}点 / 描画 ${result.displayCount}点${result.truncated ? '（間引き）' : ''} / 対象内の欠損・無効 ${result.excludedCount}点${result.invalidTimeCount ? ' / 時刻不正 ' + result.invalidTimeCount + '点' : ''}${prepared.ok ? '' : '。時刻不正のため波形連動不可'}`);
                const data = result.points.map(point => ({ value: [point.x, point.y, point.z ?? null, point.index, point.time, point.displayTime], fileId: fid }));
                const index = series.length + pointSeries.length;
                pointSeries.push({ id: 'xy-points-' + fid, name: label(file), type: 'scatter', data, symbol: ['circle', 'rect', 'triangle', 'diamond'][pointSeries.length % 4], symbolSize: mapMode ? 4.5 : 4, z: 3, itemStyle: { color: api.fileColor(fid) || '#39b8dc', opacity: 0.82, borderColor: mapMode ? '#26364a' : undefined, borderWidth: mapMode ? 0.5 : 0 }, emphasis: { scale: 1.8 }, animation: false });
                if (zc) { colourSeries.push(index); if (Number.isFinite(result.zmin)) zmin = Math.min(zmin, result.zmin); if (Number.isFinite(result.zmax)) zmax = Math.max(zmax, result.zmax); }
            }
            series.push(...pointSeries);
            const colors = theme(), visualMap = [], cellSeriesIndex = series.findIndex(item => item.id === 'xy-map-cells');
            if (map && cellSeriesIndex >= 0) visualMap.push({ type: 'continuous', min: color.min, max: color.max === color.min ? color.max + Math.max(Math.abs(color.max) * 1e-8, 1) : color.max, dimension: 8, seriesIndex: [cellSeriesIndex], calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 120, itemWidth: 10, text: [fmt(color.max) + ' g/kWh', fmt(color.min)], textStyle: { color: colors.text, fontSize: 10 }, inRange: { color: ['#32a6a0', '#a4d990', '#f3e89e', '#e89468', '#bd4968'] } });
            else if (colourSeries.length && Number.isFinite(zmin) && Number.isFinite(zmax)) visualMap.push({ type: 'continuous', min: zmin, max: zmin === zmax ? zmax + 1 : zmax, dimension: 2, seriesIndex: colourSeries, calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemHeight: 120, itemWidth: 10, text: [fmt(zmax) + (mainZ?.unit ? ' [' + mainZ.unit + ']' : ''), fmt(zmin)], textStyle: { color: colors.text, fontSize: 10 }, inRange: { color: ['#4777cd', '#5ac7c7', '#f2d76b', '#db6559'] } });
            const style = { axisLabel: { color: colors.text, formatter: value => fmt(value), fontSize: 10 }, axisLine: { lineStyle: { color: colors.text } }, nameTextStyle: { color: colors.text, fontSize: 11 }, splitLine: { lineStyle: { color: colors.grid } }, scale: true };
            const bounds = extent => Number.isFinite(extent[0]) && Number.isFinite(extent[1])
                ? { min: extent[0] === extent[1] ? Math.max(0, extent[0] - Math.max(1, Math.abs(extent[0]) * .05)) : extent[0], max: extent[0] === extent[1] ? extent[1] + Math.max(1, Math.abs(extent[1]) * .05) : extent[1] } : {};
            const xBounds = mapMode ? bounds(xExtent) : {}, yBounds = mapMode ? bounds(yExtent) : {};
            const nextView = JSON.stringify([cfg.mode, cfg.x, cfg.y, idOf(map), xBounds, yBounds]);
            if (viewSignature !== nextView) { viewSignature = nextView; zoomRanges = [{ start: 0, end: 100 }, { start: 0, end: 100 }]; zoomEnabled = false; }
            syncZoomButton();
            activeChart.setOption({ animation: false, backgroundColor: 'transparent', legend: { data: pointSeries.map(item => item.name), show: pointSeries.length > 1, type: 'scroll', top: 2, textStyle: { color: colors.text, fontSize: 10 } },
                grid: { left: 68, right: 20, top: 38, bottom: visualMap.length ? 90 : 52, outerBoundsMode: 'none' },
                xAxis: { type: 'value', name: mapMode ? 'エンジン回転数 [rpm]' : `${cfg.x}${mainX.unit ? ' [' + mainX.unit + ']' : ''}`, nameLocation: 'middle', nameGap: 28, ...style, ...xBounds },
                yAxis: { type: 'value', name: mapMode ? 'トルク [Nm]' : `${cfg.y}${mainY.unit ? ' [' + mainY.unit + ']' : ''}`, nameLocation: 'middle', nameGap: 47, ...style, ...yBounds },
                dataZoom: mapMode ? zoomOptions() : [],
                visualMap, tooltip: { trigger: 'item', confine: true, formatter(event) {
                    const v = event.value;
                    if (event.seriesId === 'xy-map-cells') return `背景の格子値<br>${fmt(v[5])} rpm / ${fmt(v[6])} Nm<br>${fmt(v[4])} g/kWh<br>集計 ${fmt(v[7])}点（格子平均）`;
                    if (event.seriesName?.startsWith('等高線 ')) return `${esc(event.seriesName)}<br>有効な格子間の補間線（実測点ではありません）`;
                    if (!event.data?.fileId) return '';
                    return `${esc(event.seriesName)}<br>${esc(cfg.x)}: ${fmt(v[0])}<br>${esc(cfg.y)}: ${fmt(v[1])}${cfg.mode === 'scatter' && cfg.z ? '<br>' + esc(cfg.z) + ': ' + fmt(v[2]) : ''}<br>元時刻 ${fmt(v[4])} s / 表示時刻 ${fmt(v[5])} s<br>クリックでこの時刻へ`;
                } }, series }, { notMerge: true });
            preparedFiles = dataFiles; renderCount++; lastSignature = signature(); busy = false; panel.setAttribute('aria-busy', 'false');
            lastResult = { background: background?.map || null, backgroundName: background?.name || '', colorRange: color, files: dataFiles.map(d => d.fid), seriesCount: series.length, context: { ...context }, summaries };
            const backgroundVisible = series.some(item => item.id === 'xy-map-cells' || (item.id.startsWith('xy-contour-') && item.type === 'line' && item.data.length));
            dom['data-count'].textContent = summaries.join(' / ') || (pointReason && map
                ? backgroundVisible ? '背景マップのみ表示しています。' : '背景の等高線は表示されていません。上の案内を確認してください。'
                : '対象区間に表示できる動作点がありません。');
            showMapStatus(background, color);
            if (Number.isFinite(lastCursor)) cursor(lastCursor);
        }
        function schedule() {
            if (!visible || destroyed || frame !== null) return;
            frame = requestAnimationFrame(() => { frame = null; render().catch(error => { if (!visible || destroyed) return; busy = false; panel.setAttribute('aria-busy', 'false'); dom['data-count'].textContent = '表示できませんでした: ' + (error.message || error); }); });
        }
        // Cursor movement must not call ECharts.setOption: even a cursor-only series update
        // reruns every custom background cell. Keep the marker on a separate DOM layer.
        function drawCursor() {
            if (!visible || destroyed || !chart || !lastResult) return;
            const time = lastCursor, labels = [];
            cursorPoints = [];
            for (const data of preparedFiles) {
                const nearest = Number.isFinite(time) && data.prepared.ok ? F.nearestPoint(data.prepared, data.x, data.y, data.z, time, { range: data.range, offset: data.offset, nonnegative: data.mapMode }) : null;
                const p = nearest?.ok && nearest.point;
                let marker = cursorMarkers.get(data.fid);
                if (!marker) {
                    marker = document.createElement('span'); marker.id = 'xy-cursor-' + data.fid; marker.className = 'xy-cursor-marker';
                    marker.style.backgroundColor = api.fileColor(data.fid) || '#ffbd44';
                    $('xy-cursor-overlay').appendChild(marker); cursorMarkers.set(data.fid, marker);
                }
                const pixel = p ? chart.convertToPixel({ gridIndex: 0 }, [p.x, p.y]) : null;
                const displayed = Array.isArray(pixel) && pixel.every(Number.isFinite) && legendSelected[label(data.file)] !== false && chart.containPixel({ gridIndex: 0 }, pixel);
                marker.style.display = displayed ? '' : 'none';
                if (displayed) {
                    marker.style.left = pixel[0] + 'px'; marker.style.top = pixel[1] + 'px';
                    cursorPoints.push({ fileId: data.fid, ...p, pixel: [...pixel] });
                }
                if (p) labels.push(`${label(data.file)}: 元 ${fmt(p.time)} s / 表示 ${fmt(p.displayTime)} s`);
            }
            cursorUpdateCount++;
            const message = Number.isFinite(time) && preparedFiles.length ? `カーソル ${fmt(time)} s · ${labels.join(' / ') || '対象内の有効な元サンプルなし'}（最寄りの観測点。補間なし）` : '';
            dom['cursor-status'].textContent = message; dom['cursor-status'].title = message;
        }
        function scheduleCursor() {
            if (!visible || destroyed || !chart || !lastResult || cursorFrame !== null) return;
            cursorFrame = requestAnimationFrame(() => { cursorFrame = null; drawCursor(); });
        }
        function cursor(time) {
            lastCursor = Number.isFinite(time) ? time : null;
            scheduleCursor();
        }
        function requestChartResize() {
            if (!visible || destroyed || resizeFrame !== null) return;
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                if (!visible || destroyed || !chart) return;
                const element = $('xy-chart'), width = Math.round(element.clientWidth), height = Math.round(element.clientHeight);
                // ResizeObserver also fires after visibility/layout changes without a size change.
                // A redundant ECharts.resize still repaints the full background.
                if (width > 0 && height > 0 && (width !== chart.getWidth() || height !== chart.getHeight())) {
                    chart.resize({ width, height, silent: true }); scheduleCursor();
                }
            });
        }
        function setVisible(next) {
            next = !!next;
            if (visible === next) { if (next) { requestChartResize(); schedule(); } return; }
            visible = next; panel.classList.toggle('hidden', !visible);
            if (!visible) { invalidate(true); chart?.dispose(); chart = null; if (pendingImport) { importGeneration++; pendingImport = false; pendingRows = null; pendingFile = null; pendingIdentity = null; showImportFeedback('CSVの読み込みを中止しました。ファイルを選び直してください。'); updateApplyState(); } expanded = false; panel.classList.remove('xy-expanded'); dom['expand-btn'].textContent = '大きく表示'; dom['expand-btn'].setAttribute('aria-expanded', 'false'); }
            else { requestChartResize(); schedule(); }
            layout?.setState({ visible, expanded });
            api.resize();
        }
        function open() {
            const active = document.activeElement;
            if (!visible) opener = active?.closest('.compare-tools')?.querySelector('summary') || (active instanceof HTMLElement && active !== document.body ? active : $('xy-panel-toggle'));
            api.activatePanel('xy'); setVisible(true); layout?.setState({ reveal: true }); dom['close-btn'].focus({ preventScroll: true });
        }
        function close() {
            api.activatePanel('compare'); setVisible(false);
            const target = opener?.isConnected && opener.getClientRects().length ? opener : $('xy-panel-toggle'); target?.focus({ preventScroll: true });
        }
        function toggleExpanded() {
            expanded = !expanded; panel.classList.toggle('xy-expanded', expanded);
            dom['expand-btn'].textContent = expanded ? '並べて表示に戻る' : '大きく表示'; dom['expand-btn'].setAttribute('aria-expanded', String(expanded));
            layout?.setState({ visible, expanded, reveal: true });
            requestChartResize(); api.resize();
        }
        async function readMapFile(file, signal) {
            const token = ++importGeneration; pendingRows = null; pendingFile = file || null; pendingIdentity = null; pendingImport = false; externalStatus = ''; savedExternalIdentity = null;
            const source = sourceSignature(), context = JSON.stringify(api.getContext()), selectedMode = cfg.mode, selectedSource = cfg.source, format = dom['map-format'].value;
            const currentImport = () => !signal?.aborted && token === importGeneration && !destroyed && source === sourceSignature() && context === JSON.stringify(api.getContext()) && selectedMode === cfg.mode && selectedSource === cfg.source && format === dom['map-format'].value;
            const changedImport = () => { if (token === importGeneration) { pendingRows = null; pendingFile = null; pendingIdentity = null; showImportFeedback(signal?.aborted ? 'マップの読み込みを中止しました。' : '読み込み中に対象や条件が変わりました。マップCSVを選び直してください。'); } };
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
            if (!pendingRows || !pendingFile || pendingImport || !dom['map-confirm-units'].checked) { updateApplyState(); return false; }
            const result = F.parseMap(pendingRows, { format: dom['map-format'].value });
            if (!result.ok) { showImportFeedback(result.reason, true, true); return false; }
            if (Object.entries(result.unitHints || {}).some(([key, unit]) => unit && !F.compatibleUnit(unit, { x: 'rpm', y: 'torque', z: 'sfc' }[key]))) {
                showImportFeedback('CSVの見出しに異なる単位が指定されています。rpm・Nm・g/kWhのマップを使用してください。', true, true); return false;
            }
            externalMap = { ...result, name: pendingFile.name, identity: pendingIdentity }; savedExternalIdentity = pendingIdentity; cfg.source = 'external';
            showImportFeedback(`${pendingFile.name} を背景に適用しました。`); $('xy-map-settings').open = false; dom['map-clear'].disabled = false; changed();
            return true;
        }
        // The bundled demo has known units. Reuse the normal parser and stale-read
        // guards; callers must explicitly acknowledge the same unit contract.
        async function importExternalMap(file, options = {}) {
            if (options.signal?.aborted) throw new Error('マップの読み込みを中止しました。');
            if (options.unitsConfirmed !== true) throw new Error('回転数rpm・トルクNm・燃費率g/kWhの単位確認が必要です。');
            const format = options.format || 'auto';
            if (!['auto', 'long', 'matrix'].includes(format)) throw new Error('マップCSVの形式が不正です。');
            if (destroyed || !visible) throw new Error('マップを開いてから読み込んでください。');
            if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size) || file.size > 5 * 1024 * 1024) throw new Error('5 MiB以下のマップCSVを指定してください。');
            dom['map-format'].value = format;
            const token = importGeneration + 1;
            await readMapFile(file, options.signal);
            if (options.signal?.aborted || destroyed || !visible || token !== importGeneration) throw new Error('マップの読み込みを中止しました。');
            if (pendingFile !== file || !pendingRows || pendingImport) throw new Error(dom['map-feedback'].textContent || 'マップCSVを読み込めませんでした。');
            dom['map-confirm-units'].checked = true; updateApplyState();
            if (!applyMap()) throw new Error(dom['map-feedback'].textContent || 'マップCSVを適用できませんでした。');
            return { ...externalMap.identity };
        }
        function collectSettings() {
            const source = sourceFile();
            return { ...cfg, source: cfg.source === 'external' || cfg.source === 'main' ? cfg.source : 'named', sourceName: source?.name || cfg.sourceName || '', externalMapIdentity: externalMap?.identity || savedExternalIdentity };
        }
        function applySettings(value, options = {}) {
            importGeneration++; pendingRows = null; pendingFile = null; pendingIdentity = null; pendingImport = false; mapCache = null; contourCache = null; viewSignature = '';
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
            cfg.mapStyle = ['fill', 'lines', 'both'].includes(saved.mapStyle) ? saved.mapStyle : typeof saved.contours === 'boolean' ? (saved.contours ? 'both' : 'fill') : defaults.mapStyle;
            if (typeof saved.contourStep === 'number' && Number.isFinite(saved.contourStep) && saved.contourStep > 0) cfg.contourStep = saved.contourStep;
            if (typeof saved.splitRatio === 'number' && Number.isFinite(saved.splitRatio)) cfg.splitRatio = Math.max(.2, Math.min(.8, saved.splitRatio));
            layout?.setRatio(cfg.splitRatio);
            dom['map-rpm-step'].value = cfg.rpmStep; dom['map-torque-step'].value = cfg.torqueStep;
            dom['map-color-min'].value = cfg.colorMin ?? ''; dom['map-color-max'].value = cfg.colorMax ?? '';
            dom['map-contour-step'].value = cfg.contourStep;
            dom['map-file'].value = ''; dom['map-confirm-units'].checked = false; dom['map-apply'].disabled = true; dom['map-clear'].disabled = !externalMap;
            externalStatus = '';
            if (!externalMap && cfg.source === 'external') showImportFeedback('背景CSVのデータは保存しません。ファイルを再度選び、単位を確認して適用してください。');
            else showImportFeedback(externalMap ? `${externalMap.name} を背景に適用しています。` : 'CSVを選び、単位確認にチェックを入れてください。');
            controlsSignature = ''; invalidate(true); syncControls(true); schedule();
        }
        function clear() {
            importGeneration++; pendingRows = null; pendingFile = null; pendingIdentity = null; pendingImport = false; externalMap = null; savedExternalIdentity = null; mapCache = null; contourCache = null; lastCursor = null; externalStatus = ''; viewSignature = '';
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
        dom['map-style'].addEventListener('change', () => { cfg.mapStyle = dom['map-style'].value; changed(); });
        dom['map-contour-step'].addEventListener('change', () => { cfg.contourStep = dom['map-contour-step'].value.trim() ? Number(dom['map-contour-step'].value) : NaN; changed(); });
        dom['map-zoom-btn'].addEventListener('click', () => { zoomEnabled = !zoomEnabled; syncZoomButton(); if (chart) { chart.setOption({ dataZoom: zoomOptions() }); scheduleCursor(); } });
        dom['map-reset-view'].addEventListener('click', resetView);
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
        const observer = new ResizeObserver(requestChartResize);
        observer.observe($('xy-chart'));
        if (root.CSVXYLayout) layout = root.CSVXYLayout({ panel, ratio: cfg.splitRatio,
            onResize() { if (!destroyed) { requestChartResize(); api.resize(); } },
            onCommit(ratio) { cfg.splitRatio = ratio; api.save(); } });
        return { open, close, setVisible, schedule, cursor, collectSettings, applySettings, clear, importExternalMap,
            inspect: () => ({ chart, visible, expanded, mode: cfg.mode, config: { ...cfg }, lastResult, map: lastResult?.background || null, renderCount, cursorUpdateCount, cursorPoints: cursorPoints.map(point => ({ ...point, pixel: [...point.pixel] })), contourBuildCount, busy, pendingImport }),
            destroy() { destroyed = true; generation++; importGeneration++; observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); clearCursor(); layout?.destroy(); panel.removeEventListener('keydown', onKey); chart?.dispose(); panel.remove(); } };
    };
})(window);
