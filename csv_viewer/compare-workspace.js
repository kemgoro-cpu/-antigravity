/* Offline comparison workspace. The host supplies the existing parser/chart/history operations. */
(function (root) {
    'use strict';
    root.CSVWorkspace = function (api) {
        const C = root.CSVCompare, s = api.state, esc = api.esc;
        const $ = id => document.getElementById(id);
        const fmt = x => Number.isFinite(x) ? Number(x.toPrecision(6)).toString() : '—';
        const label = f => s.comparison.labels[f.name] || f.shortName || f.name;
        const setting = () => s.comparison;
        let pane = 'prepare', open = true, filter = 'all', raf = null, selectedSub = '', rows = [], selection = null;
        let rawTime = false, preview = null, generation = 0, busy = false, pick = null, latestCursor = null;
        let selectionMain = null;
        let previewChart = null, pendingMap = null, intervalMode = false, overviewKey = '';
        let resultGeneration = 0, resultBusy = false, resultStatus = '', resultSort = 'tolerance', noteBusy = false;
        let resultSignature = '', highlightFrame = null, resultNavigation = false;
        let lastVisibleRange = null;
        const exceedancePositions = new Map();
        let noteDraft = '';
        const mapDrafts = new Map(), alignDrafts = new Map();
        function draftFor(store, id = currentSub()) {
            const main = api.main(), sub = s.files[id];
            let draft = store.get(id);
            if (!draft || draft.main !== main || draft.sub !== sub) {
                draft = { main, sub, values: Object.create(null) }; store.set(id, draft);
            }
            return draft.values;
        }
        const main = document.querySelector('.main-content');
        const chartContainer = document.querySelector('.chart-container');
        const toolsMenu = document.createElement('details'); toolsMenu.className = 'compare-tools';
        toolsMenu.innerHTML = '<summary class="btn-secondary">解析ツール ▾</summary><div class="compare-tools-content"></div>';
        $('shift-mode-btn').before(toolsMenu);
        for (const id of ['shift-mode-btn', 'arrange-mode-btn', 'diff-curves-btn', 'xy-plot-btn', 'drive-index-btn']) toolsMenu.lastElementChild.appendChild($(id));
        toolsMenu.addEventListener('click', e => { if (e.target.closest('button')) toolsMenu.open = false; });
        document.addEventListener('click', e => { if (!toolsMenu.contains(e.target)) toolsMenu.open = false; });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') toolsMenu.open = false; });
        $('diff-curves-btn').querySelector('.btn-label').textContent = '計算チャンネルに差分を追加';
        const heading = document.createElement('header');
        heading.className = 'compare-header';
        heading.innerHTML = `<div><span class="compare-eyebrow">CSV CHART VIEWER</span><h1>比較ワークスペース</h1></div><div class="compare-header-actions"><span id="compare-status" role="status"></span><button id="compare-panel-toggle" class="btn-secondary" aria-expanded="true">比較パネル</button></div>`;
        main.prepend(heading);
        const bar = document.createElement('div'); bar.className = 'compare-bar';
        bar.innerHTML = `<div class="compare-segment" role="group" aria-label="比較の表示方法"><button data-view="overlay">重ね合わせ</button><button data-view="stack">上下比較</button><button data-view="diff">差分</button></div><label class="compare-raw"><input id="compare-raw" type="checkbox">元の時刻で確認</label><button id="compare-select-range" class="btn-secondary" title="ドラッグで対象区間を選び、区間比較・統計・メモなどを実行します">区間を選択・解析</button><span id="compare-view-hint"></span>`;
        heading.after(bar);
        const contextBar = document.createElement('div'); contextBar.className = 'analysis-context';
        contextBar.innerHTML = '<label>解析対象 <select id="analysis-scope" aria-label="比較・統計・XY・CSV・メモの対象区間"><option value="visible">表示範囲</option><option value="selection">選択区間</option><option value="all">全体</option></select></label><span id="analysis-context-status" class="analysis-context-status" role="status"></span><span class="analysis-scope-help">比較・統計・XY・CSV・メモで共通</span>';
        bar.after(contextBar);
        const body = document.createElement('div'); body.className = 'compare-body';
        chartContainer.before(body); body.appendChild(chartContainer);
        const panel = document.createElement('aside'); panel.className = 'compare-panel'; panel.id = 'compare-panel'; panel.setAttribute('aria-label', '比較の準備と結果');
        panel.innerHTML = `<nav class="compare-tabs" aria-label="比較パネル"><button data-pane="prepare">準備</button><button data-pane="align">時間合わせ</button><button data-pane="results">比較結果</button><button data-pane="notes">メモ</button></nav><div id="compare-panel-content"></div>`;
        body.appendChild(panel);
        const bottom = document.createElement('div'); bottom.className = 'compare-overview';
        bottom.innerHTML = `<div class="compare-overview-heading"><span>全体ナビゲーター <small id="compare-overview-label"></small></span><span id="compare-range-label"></span></div><div id="compare-overview-plot"><canvas id="compare-overview-canvas" height="42"></canvas><div id="compare-overview-window"></div></div><div class="compare-range-inputs"><label>開始 <input id="compare-range-start" type="number" step="any" aria-label="表示区間の開始秒"> s</label><label>終了 <input id="compare-range-end" type="number" step="any" aria-label="表示区間の終了秒"> s</label><button id="compare-range-go" class="btn-secondary">表示</button><button id="compare-range-all" class="btn-secondary">全体</button></div>`;
        main.appendChild(bottom);
        const action = document.createElement('div'); action.id = 'compare-selection'; action.className = 'compare-selection hidden';
        action.innerHTML = `<strong id="compare-selection-label"></strong><span class="compare-selection-help">選択しただけでは解析しません</span><button data-range-action="zoom">拡大</button><button data-range-action="compare">区間比較</button><button data-range-action="stats">統計</button><button data-range-action="event">イベント登録</button><button data-range-action="note">メモ</button><button data-range-action="copy">画像コピー</button><button data-range-action="close" aria-label="区間選択を解除">×</button>`;
        bar.after(action);
        const filters = document.createElement('div'); filters.className = 'compare-channel-filters';
        filters.innerHTML = `<select id="compare-channel-filter" aria-label="チャンネルの絞り込み"><option value="all">すべて</option><option value="selected">表示中</option><option value="common">全ファイル共通</option><option value="unmapped">未対応あり</option><option value="favorite">お気に入りセット</option></select><button id="compare-alias-edit" class="btn-secondary" title="検索用の別名を登録">検索別名</button>`;
        document.querySelector('.search-box').after(filters);
        const advanced = document.createElement('details'); advanced.className = 'compare-advanced';
        advanced.innerHTML = '<summary>読み込み設定・計算・イベント</summary>';
        document.querySelector('.sidebar-upper').appendChild(advanced);
        for (const name of ['parse', 'customRam', 'events']) advanced.appendChild(document.querySelector(`[data-section="${name}"]`));
        document.querySelector('.sidebar-header h2').textContent = 'ファイルとチャンネル';
        let resizeFrame = null;
        const resize = new ResizeObserver(() => {
            // 通知中の描画でスクロールバーが消えると、監視中の幅が再び変わる。
            // 実際のリサイズは次フレームへまとめ、通知の配信中にはレイアウトを変更しない。
            if (resizeFrame !== null) return;
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                api.resize(); drawOverview(true);
                if (previewChart) { previewChart.dispatchAction({ type: 'hideTip' }); previewChart.resize(); }
            });
        });
        resize.observe(chartContainer);
        function run(fn) { Promise.resolve().then(fn).catch(e => api.warning('比較操作を完了できませんでした', e.message)); }
        function change() { api.save(); schedule(); }
        // Drafts belong to the workspace, not to replaceable panel DOM nodes.
        panel.addEventListener('input', e => {
            if (e.target.id === 'compare-note-text') noteDraft = e.target.value;
            rememberAlignInput(e.target);
        });
        panel.addEventListener('change', e => rememberAlignInput(e.target));
        function rememberAlignInput(input) {
            if (['compare-align-channel', 'compare-align-span', 'compare-align-scope', 'compare-anchor-main', 'compare-anchor-sub'].includes(input.id)) draftFor(alignDrafts)[input.id] = input.value;
        }
        function setResultRows(next, signature = '') {
            const redraw = rows.some(r => r.exceedanceIntervals?.length) || next.some(r => r.exceedanceIntervals?.length);
            rows = next; resultSignature = signature; exceedancePositions.clear();
            if (redraw && highlightFrame === null) highlightFrame = requestAnimationFrame(() => {
                highlightFrame = null; api.render();
            });
        }
        function invalidateResults(message = '比較条件が変わりました。「比較を更新」で再計算できます。') {
            resultGeneration++; resultBusy = false; setResultRows([]); resultStatus = message; showRows(); syncResultStatus();
        }
        function syncResultStatus() {
            const status = $('compare-results-status'), button = $('compare-calculate');
            if (status) status.textContent = resultStatus;
            if (button) { button.disabled = resultBusy; button.textContent = resultBusy ? '比較中…' : '比較を更新'; }
            $('compare-results-list')?.setAttribute('aria-busy', String(resultBusy));
        }
        function intervalChanged() {
            invalidateResults('対象区間が変わりました。「比較を更新」で再計算できます。');
            if (pane === 'align' && $('compare-align-scope')?.value === 'visible') {
                generation++; busy = false; preview = null; pick = null; renderPanel();
            }
        }
        function cancelRangeMode() {
            intervalMode = false;
            $('compare-select-range').classList.remove('btn-active');
            $('compare-select-range').setAttribute('aria-pressed', 'false');
            $('compare-select-range').textContent = '区間を選択・解析';
        }
        function setPane(next) { if (pane !== next) { generation++; preview = null; pick = null; busy = false; } pane = next; open = true; renderPanel(); applyLayout(); }
        function applyLayout() {
            panel.classList.toggle('hidden', !open); $('compare-panel-toggle').setAttribute('aria-expanded', String(open));
            main.classList.toggle('compare-panel-open', open); requestAnimationFrame(() => api.resize());
        }
        $('compare-panel-toggle').onclick = () => { open = !open; applyLayout(); };
        panel.querySelectorAll('[data-pane]').forEach(b => b.onclick = () => setPane(b.dataset.pane));
        bar.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { if (s.arrangeMode) api.exitArrange(); setting().view = b.dataset.view; api.render(); change(); });
        $('compare-raw').onchange = e => { rawTime = e.target.checked; persistAnalysis(); preview = null; generation++; invalidateResults(); api.render(); change(); syncAnalysisContext(); };
        $('analysis-scope').onchange = e => {
            if (e.target.value === 'selection' && !selection) { e.target.value = setting().analysis.scope; return api.warning('波形上で先に区間を選択してください'); }
            setting().analysis.scope = e.target.value; persistAnalysis(); intervalChanged(); syncAnalysisContext(); change();
        };
        $('compare-select-range').setAttribute('aria-pressed', 'false');
        $('compare-select-range').onclick = () => {
            if (intervalMode) { api.exitBrush(); cancelRangeMode(); return; }
            if (!s.numGrids) return api.warning('区間を選ぶには、先にチャンネルを表示してください');
            api.startBrush(); intervalMode = true;
            $('compare-select-range').classList.add('btn-active'); $('compare-select-range').setAttribute('aria-pressed', 'true'); $('compare-select-range').textContent = '区間選択をキャンセル';
            api.hint('ドラッグで区間を選択。Escでキャンセルできます。');
        };
        $('compare-channel-filter').onchange = e => { filter = e.target.value; api.renderColumns(); };
        $('compare-alias-edit').onclick = () => {
            const cols = api.main()?.columns || [];
            if (!cols.length) return api.warning('ファイルを先に読み込んでください');
            const { modal, close } = api.modal(`<h3>検索用の別名</h3><p>例：Actual_Speed に「車速 速度」。元のチャンネル名は変わりません。</p><label>チャンネル<select id="compare-alias-channel">${cols.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></label><label>検索語<input id="compare-alias-text" maxlength="300"></label><button id="compare-alias-save" class="btn-primary">保存</button>`);
            const choose = modal.querySelector('select'), text = modal.querySelector('input');
            const sync = () => { text.value = setting().searchAliases[choose.value] || ''; }; sync(); choose.onchange = sync;
            modal.querySelector('button').onclick = () => { setting().searchAliases = { ...setting().searchAliases, [choose.value]: text.value.trim() }; api.renderColumns(); change(); close(); };
        };
        $('compare-range-go').onclick = () => {
            const inputs = [$('compare-range-start'), $('compare-range-end')];
            if (inputs.some(input => input.value.trim() === '')) return api.warning('開始と終了の時刻を両方入力してください');
            zoom(inputs.map(input => Number(input.value)));
        };
        for (const id of ['compare-range-start', 'compare-range-end']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('compare-range-go').click(); } });
        $('compare-range-all').onclick = () => { api.resetZoom(); schedule(); };
        function fullRange() {
            const ranges = Object.values(s.files).map(f => ({ range: root.CSVAnalysis.extent(f), offset: effectiveOffset(f) })).filter(x => x.range);
            return ranges.length ? [Math.min(...ranges.map(x => x.range[0] + x.offset)), Math.max(...ranges.map(x => x.range[1] + x.offset))] : null;
        }
        function zoom(r, preserveResults = false) {
            if (!r || !r.every(Number.isFinite) || r[1] <= r[0] || !s.numGrids) return api.warning('開始より後の終了時刻を指定してください');
            const full = fullRange(); const lo = Math.max(full[0], r[0]), hi = Math.min(full[1], r[1]);
            if (hi <= lo) return api.warning('データがある範囲を指定してください');
            resultNavigation = preserveResults;
            try { s.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: lo, endValue: hi }); }
            finally { resultNavigation = false; }
            api.save(); schedule();
        }
        function analysisContext() { return root.CSVAnalysis.resolve(setting().analysis, api.visibleRange(), fullRange()); }
        function showAnalysisRange() {
            const range = activeRange(), full = fullRange();
            if (!range || !full) return;
            if (range[1] > range[0]) zoom(range, true);
            else {
                const padding = Math.max((full[1] - full[0]) / 100, 0.001);
                zoom([range[0] - padding, range[1] + padding], true);
            }
        }
        function persistAnalysis() {
            setting().analysis = { ...setting().analysis, range: selection ? [...selection] : null, mainName: selection ? api.main()?.name || setting().analysis.mainName : '', rawTime };
            if (setting().analysis.scope === 'selection' && !selection) setting().analysis.scope = 'visible';
        }
        let contextKey = '';
        function syncAnalysisContext() {
            const context = analysisContext();
            $('analysis-scope').value = context.scope;
            $('analysis-scope').querySelector('[value="selection"]').disabled = !selection;
            $('analysis-context-status').textContent = context.label;
            const key = JSON.stringify(context);
            if (key !== contextKey) { contextKey = key; api.analysisChanged?.(context); }
        }
        function restoreAnalysis() {
            const a = root.CSVAnalysis.clean(setting().analysis); setting().analysis = a;
            selection = a.range; selectionMain = selection && api.main()?.name === a.mainName ? api.main() : null;
            rawTime = a.rawTime; $('compare-raw').checked = rawTime;
            action.classList.toggle('hidden', !selection);
            if (selection) $('compare-selection-label').textContent = `選択区間 ${fmt(selection[0])} – ${fmt(selection[1])} s`;
            syncAnalysisContext();
        }
        function activeRange() { return analysisContext().range; }
        function selectRange(r) { selection = [...r]; selectionMain = api.main(); setting().analysis.scope = 'selection'; persistAnalysis(); intervalChanged(); $('compare-selection').classList.remove('hidden'); $('compare-selection-label').textContent = `選択区間 ${fmt(r[0])} – ${fmt(r[1])} s`; syncAnalysisContext(); api.save(); requestAnimationFrame(() => api.render()); schedule(); }
        action.querySelectorAll('[data-range-action]').forEach(b => b.onclick = () => run(async () => {
            if (!selection) return;
            switch (b.dataset.rangeAction) {
                case 'zoom': zoom(selection); break;
                case 'compare': setting().analysis.scope = 'selection'; persistAnalysis(); syncAnalysisContext(); api.save(); setPane('results'); await computeResults(); break;
                case 'stats': setting().analysis.scope = 'selection'; persistAnalysis(); syncAnalysisContext(); api.stats(); api.save(); break;
                case 'event': s.events = { expr: '手動選択区間', intervals: [...s.events.intervals, { t0: selection[0], t1: selection[1] }] }; api.render(); api.save(); api.success('選択区間をイベントとして登録しました'); break;
                case 'note': setting().analysis.scope = 'selection'; persistAnalysis(); syncAnalysisContext(); api.save(); setPane('notes'); $('compare-note-text').focus(); break;
                case 'copy': zoom(selection); await new Promise(requestAnimationFrame); await api.copy(); break;
                case 'close': selection = null; persistAnalysis(); action.classList.add('hidden'); intervalChanged(); api.clearMeasure(); syncAnalysisContext(); change(); break;
            }
        }));
        function currentSub() { const ids = api.subIds(); if (!ids.includes(selectedSub)) selectedSub = ids[0] || ''; return selectedSub; }
        function subOptions() { return api.subIds().map(id => `<option value="${esc(id)}"${id === currentSub() ? ' selected' : ''}>${esc(label(s.files[id]))}</option>`).join(''); }
        function subSelector() { return `<label class="compare-field">比較ファイル<select id="compare-sub">${subOptions()}</select></label>`; }
        function bindSub() { const select = $('compare-sub'); if (select) select.onchange = e => { selectedSub = e.target.value; generation++; preview = null; pick = null; busy = false; renderPanel(); }; }
        function renderPanel() {
            if (previewChart) { previewChart.dispatchAction({ type: 'hideTip' }); previewChart.dispose(); previewChart = null; }
            panel.querySelectorAll('[data-pane]').forEach(b => { b.classList.toggle('active', b.dataset.pane === pane); b.setAttribute('aria-current', b.dataset.pane === pane ? 'page' : 'false'); });
            if (pane === 'prepare') renderPrepare();
            else if (pane === 'align') renderAlign();
            else if (pane === 'results') renderResults();
            else renderNotes();
            bindSub();
        }
        function renderPrepare() {
            const files = Object.entries(s.files), mf = api.main(), sf = s.files[currentSub()];
            $('compare-panel-content').innerHTML = `<div class="compare-step"><span>01</span><h2>基準と比較ファイル</h2></div><p class="compare-muted">ファイル名は保持したまま、作業用の名前を付けられます。</p><div class="compare-file-cards">${files.map(([id, f]) => `<label class="compare-file-card"><span>${f.role === 'main' ? '基準' : '比較'} · <small title="${esc(f.name)}">${esc(f.name)}</small></span><input data-file-label="${esc(id)}" value="${esc(label(f))}" aria-label="${esc(f.name)}の表示名" maxlength="120"></label>`).join('') || '<p class="compare-empty">左へCSV / TRNをドロップして開始します。</p>'}</div>${mf ? `<label class="compare-field">基準ファイル<select id="compare-main">${files.map(([id, f]) => `<option value="${esc(id)}"${f.role === 'main' ? ' selected' : ''}>${esc(label(f))}</option>`).join('')}</select></label>` : ''}<div class="compare-step"><span>02</span><h2>チャンネル対応</h2></div>${sf ? `${subSelector()}<p class="compare-muted">表示中のチャンネルをまとめて対応付け。候補は適用するまで波形に反映しません。</p><div class="compare-map-actions"><button id="compare-map-suggest" class="btn-secondary">名前が一致する候補を選ぶ</button><button id="compare-map-apply" class="btn-primary">対応を適用</button></div><div id="compare-map-list"></div><button id="compare-next" class="btn-primary compare-wide">次へ：時間を合わせる →</button>` : '<p class="compare-empty">比較用のファイルをもう1つ追加してください。</p>'}`;
            panel.querySelectorAll('[data-file-label]').forEach(inp => inp.onchange = () => { const f = s.files[inp.dataset.fileLabel]; setting().labels = { ...setting().labels, [f.name]: inp.value.trim() || f.name }; api.renderFiles(); api.render(); change(); });
            if ($('compare-main')) $('compare-main').onchange = e => run(async () => { generation++; preview = null; selection = null; persistAnalysis(); setResultRows([]); await api.setMain(e.target.value); change(); renderPanel(); });
            if (!sf) return;
            const cols = mf.columns.filter(c => s.selectedNames.has(c.name));
            const draft = draftFor(mapDrafts);
            pendingMap = Object.create(null);
            $('compare-map-list').innerHTML = cols.map((c, i) => {
                const resolved = api.resolve(sf, c.name), value = Object.prototype.hasOwnProperty.call(draft, c.name) ? draft[c.name] : resolved?.name || '';
                pendingMap[c.name] = sf.columns.some(col => col.name === value) ? value : '';
                return `<label class="compare-map-row"><span title="${esc(c.name)}">${esc(c.name)} <small>[${esc(c.unit || '単位なし')}]</small></span><select data-map-index="${i}" aria-label="${esc(c.name)}の対応先"><option value="">未対応</option>${C.candidates(c, sf.columns).map(({ col }) => `<option value="${esc(col.name)}"${col.name === pendingMap[c.name] ? ' selected' : ''}>${esc(col.name)} [${esc(col.unit || '単位なし')}]</option>`).join('')}</select><small data-map-status="${i}"></small></label>`;
            }).join('') || '<p class="compare-empty">左の一覧から比較するチャンネルを選択してください。</p>';
            function statuses() { cols.forEach((c, i) => { const target = sf.columns.find(x => x.name === pendingMap[c.name]); const el = panel.querySelector(`[data-map-status="${i}"]`); const changed = pendingMap[c.name] !== (api.resolve(sf, c.name)?.name || ''); el.textContent = `${changed ? '未適用 · ' : ''}${!target ? '未対応：比較対象から除外' : !C.sameUnit(c.unit, target.unit) ? '単位が異なります：差分・数値比較は除外' : !c.unit ? '対応済み・単位なし（同じ量か確認）' : '対応済み'}`; el.className = changed || !target || !C.sameUnit(c.unit, target.unit) ? 'compare-warning' : 'compare-muted'; }); }
            panel.querySelectorAll('[data-map-index]').forEach(el => el.onchange = () => { const name = cols[Number(el.dataset.mapIndex)].name; draft[name] = pendingMap[name] = el.value; statuses(); });
            $('compare-map-suggest').onclick = () => { cols.forEach((c, i) => { const candidate = C.candidates(c, sf.columns)[0]; if (candidate?.score >= 80) { draft[c.name] = pendingMap[c.name] = candidate.col.name; panel.querySelector(`[data-map-index="${i}"]`).value = candidate.col.name; } }); statuses(); };
            const applyMap = async next => {
                const values = { ...pendingMap };
                setting().matches = { ...setting().matches, [sf.name]: { ...setting().matches[sf.name], ...values } };
                for (const name of Object.keys(values)) delete draft[name];
                invalidateResults();
                await api.ensure(); await api.offsetChanged(); change();
                if (next) setPane('align'); else api.success('チャンネル対応を適用しました');
            };
            $('compare-map-apply').onclick = () => run(() => applyMap(false));
            $('compare-next').onclick = () => run(() => applyMap(true)); statuses();
        }
        function signal(file, name) { const col = api.resolve(file, name); return col && file.colData[col.id] ? { t: file.timeData, v: file.colData[col.id], col } : null; }
        async function loadPair(id, names) {
            const mf = api.main(), sf = s.files[id]; if (!mf || !sf) return false;
            await Promise.all([api.load(api.mainId(), names), api.load(id, names.map(n => api.resolve(sf, n)?.name).filter(Boolean))]);
            return mf === api.main() && sf === s.files[id];
        }
        function renderAlign() {
            const mf = api.main(), sf = s.files[currentSub()];
            if (!mf || !sf) { $('compare-panel-content').innerHTML = '<p class="compare-empty">基準と比較ファイルを読み込んでください。</p>'; return; }
            const eligible = mf.columns.filter(c => { const sc = api.resolve(sf, c.name); return sc && C.sameUnit(c.unit, sc.unit) && !c.isCrossFile; });
            const a = setting().align[sf.name] || {};
            const defaultChannel = a.channel || eligible.find(c => !c.isCustom && s.selectedNames.has(c.name))?.name || eligible.find(c => !c.isCustom)?.name || eligible[0]?.name;
            $('compare-panel-content').innerHTML = `<div class="compare-step"><span>03</span><h2>波形を見ながら時間合わせ</h2></div>${subSelector()}<label class="compare-field">基準にするチャンネル<select id="compare-align-channel">${eligible.map(c => `<option${c.name === defaultChannel ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><div class="compare-two"><label class="compare-field">探索幅 ±秒<input id="compare-align-span" type="number" min="0.001" step="any" value="${a.range || 30}"></label><label class="compare-field">評価区間<select id="compare-align-scope"><option value="all">全区間</option><option value="visible"${a.scope === 'visible' ? ' selected' : ''}>現在の解析対象</option></select></label></div><button id="compare-align-run" class="btn-primary compare-wide"${!eligible.length ? ' disabled' : ''}>自動合わせをプレビュー</button><p class="compare-muted">現在のシフト ${fmt(sf.offset)} s。プレビューでは保存済みの時間を変更しません。</p><div id="compare-align-preview" class="compare-preview"></div><div id="compare-align-info" role="status"></div><div class="compare-two"><button id="compare-align-apply" class="btn-primary" disabled>この時間差を適用</button><button id="compare-align-cancel" class="btn-secondary">キャンセル</button></div><details class="compare-manual"><summary>2点指定・数値で合わせる</summary><p class="compare-muted">プレビュー上で基準の特徴点→比較の特徴点をクリックします。数値入力でも指定できます。</p><button id="compare-align-pick" class="btn-secondary">波形の2点を指定</button><div class="compare-two"><label class="compare-field">基準の時刻 s<input id="compare-anchor-main" type="number" step="any"></label><label class="compare-field">比較の元時刻 s<input id="compare-anchor-sub" type="number" step="any"></label></div><button id="compare-align-manual" class="btn-secondary">2点からプレビュー</button></details><button id="compare-align-results" class="btn-secondary compare-wide">次へ：比較結果 →</button>`;
            $('compare-align-run').onclick = () => run(autoPreview);
            const draft = draftFor(alignDrafts);
            for (const [id, value] of Object.entries(draft)) {
                const input = $(id);
                if (input && (input.tagName !== 'SELECT' || [...input.options].some(option => option.value === value))) input.value = value;
            }
            $('compare-align-results').onclick = () => { setPane('results'); run(computeResults); };
            $('compare-align-apply').onclick = () => run(async () => {
                if (!preview || preview.id !== currentSub() || !s.files[preview.id] || preview.main !== api.main()) return;
                const p = preview; generation++; preview = null; sf.offset = p.offset;
                setting().align = { ...setting().align, [sf.name]: { channel: p.name, range: p.span, scope: p.scope, offset: p.offset, method: p.method } };
                rawTime = false; $('compare-raw').checked = false; persistAnalysis(); syncAnalysisContext(); await api.offsetChanged(); api.renderFiles(); change();
                api.success(`比較側を ${fmt(p.offset)} 秒に設定しました`); renderPanel();
            });
            $('compare-align-cancel').onclick = () => { generation++; busy = false; preview = null; pick = null; renderPanel(); };
            $('compare-align-manual').onclick = () => run(async () => {
                if ($('compare-anchor-main').value === '' || $('compare-anchor-sub').value === '') return api.warning('基準と比較の時刻を両方指定してください');
                const x = Number($('compare-anchor-main').value), y = Number($('compare-anchor-sub').value);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                await buildPreview(x - y, 'manual');
            });
            $('compare-align-pick').onclick = () => run(async () => { await buildPreview(sf.offset, 'manual'); if (!previewChart) return; pick = { step: 0 }; $('compare-align-info').textContent = '実線（基準）の特徴点をクリックしてください'; $('compare-align-preview').scrollIntoView({ block: 'nearest' }); });
            ['compare-align-channel', 'compare-align-span', 'compare-align-scope'].forEach(id => $(id).onchange = () => { generation++; preview = null; pick = null; busy = false; if (previewChart) { previewChart.dispatchAction({ type: 'hideTip' }); previewChart.dispose(); previewChart = null; } $('compare-align-info').textContent = '条件が変わりました。プレビューを更新してください。'; $('compare-align-apply').disabled = true; $('compare-align-run').disabled = !eligible.length; });
        }
        function alignInputs() {
            const id = currentSub(), name = $('compare-align-channel')?.value, span = Number($('compare-align-span')?.value), scope = $('compare-align-scope')?.value;
            const mf = api.main();
            return { id, name, span, scope, range: scope === 'visible' ? activeRange() : mf?.timeData?.length ? [mf.timeData[0], mf.timeData[mf.timeData.length - 1]] : null };
        }
        async function autoPreview() {
            if (busy) return;
            const p = alignInputs();
            if (!p.name || !(p.span > 0) || !Number.isFinite(p.span) || !p.range) return api.warning('チャンネルと正の探索幅を指定してください');
            const token = ++generation; busy = true; $('compare-align-run').disabled = true; $('compare-align-info').textContent = '波形を読み込んで探索しています…';
            try {
                if (!await loadPair(p.id, [p.name]) || token !== generation) return;
                const a = signal(api.main(), p.name), b = signal(s.files[p.id], p.name);
                if (!a || !b) throw new Error('チャンネルを読み込めませんでした');
                const hasVariation = (sig, range) => {
                    let min = Infinity, max = -Infinity;
                    const first = C.lowerBound(sig.t, range[0]), last = C.lowerBound(sig.t, range[1]);
                    const step = Math.max(1, Math.ceil((last - first + 1) / 1200));
                    for (let i = first; i < sig.v.length && sig.t[i] <= range[1]; i += step) if (Number.isFinite(sig.v[i])) { min = Math.min(min, sig.v[i]); max = Math.max(max, sig.v[i]); }
                    return max - min > Math.max(1e-10, Math.max(Math.abs(min), Math.abs(max)) * 1e-9);
                };
                let best = null; const base = s.files[p.id].offset;
                if (!hasVariation(a, p.range) || !hasVariation(b, [p.range[0] - base - p.span, p.range[1] - base + p.span])) throw new Error('変化のない信号では時間差を特定できません。変化のあるチャンネルを選んでください。');
                async function search(center, half, count) {
                    for (let i = 0; i <= count; i++) {
                        if (token !== generation) return;
                        const offset = center - half + 2 * half * i / count, score = C.alignmentScore(a, b, offset, p.range);
                        if (Number.isFinite(score.rms) && (!best || score.rms < best.rms)) best = { ...score, offset };
                        if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
                await search(base, p.span, 240);
                if (best && token === generation) await search(best.offset, p.span / 120, 100);
                if (token !== generation) return;
                if (!best) throw new Error('十分に重なる有効データがありません。区間・探索幅・対応を確認してください。');
                await buildPreview(best.offset, 'auto', p, token);
            } finally { if (token === generation) { busy = false; if ($('compare-align-run')) $('compare-align-run').disabled = false; } }
        }
        async function buildPreview(offset, method, inputs = alignInputs(), token = ++generation) {
            if (!inputs.name || !Number.isFinite(offset) || !inputs.range) return;
            if (!await loadPair(inputs.id, [inputs.name]) || token !== generation || pane !== 'align') return;
            const mf = api.main(), sf = s.files[inputs.id], a = signal(mf, inputs.name), b = signal(sf, inputs.name);
            if (!a || !b) return;
            const before = C.alignmentScore(a, b, sf.offset, inputs.range), after = C.alignmentScore(a, b, offset, inputs.range);
            preview = { ...inputs, offset, method, main: mf, before, after };
            const valid = Number.isFinite(after.rms);
            $('compare-align-apply').disabled = !valid;
            $('compare-align-info').innerHTML = `<strong>比較側を ${fmt(offset)} sへ移動</strong><p>平均二乗誤差の平方根（RMSE）<br>${fmt(before.rms)} → ${fmt(after.rms)} ${esc(a.col.unit || '')}</p><p class="compare-muted">${fmt(inputs.range[0])}–${fmt(inputs.range[1])} s · 有効な重なり ${fmt(after.coverage * 100)}%<br>周期的な波形では別周期に合う場合があります。特徴点も確認してください。</p>${!valid ? '<p class="compare-warning">有効な重なりが不足しています。</p>' : ''}`;
            if (previewChart) { previewChart.dispatchAction({ type: 'hideTip' }); previewChart.dispose(); }
            $('compare-align-preview').classList.add('has-preview');
            previewChart = root.echarts.init($('compare-align-preview'), 'v5');
            const points = (sig, off) => { const out = [], step = Math.max(1, Math.ceil(sig.t.length / 1600)); for (let i = 0; i < sig.t.length; i += step) out.push([sig.t[i] + off, Number.isFinite(sig.v[i]) ? sig.v[i] : null]); return out; };
            previewChart.setOption({ animation: false, grid: { left: 48, right: 15, top: 34, bottom: 32, outerBoundsMode: 'none' }, legend: { textStyle: { color: api.textColor() }, data: ['基準', '現在', '候補'] }, tooltip: { trigger: 'axis' }, xAxis: { type: 'value', min: inputs.range[0], max: inputs.range[1], nameMoveOverlap: false }, yAxis: { type: 'value', scale: true, nameMoveOverlap: false }, series: [
                { name: '基準', type: 'line', showSymbol: false, data: points(a, 0), lineStyle: { color: '#16b8a6', width: 2 }, itemStyle: { color: '#16b8a6' } },
                { name: '現在', type: 'line', showSymbol: false, data: points(b, sf.offset), lineStyle: { color: '#94a3b8', width: 1, type: 'dashed' }, itemStyle: { color: '#94a3b8' } },
                { name: '候補', type: 'line', showSymbol: false, data: points(b, offset), lineStyle: { color: '#f59e0b', width: 2, type: 'dashed' }, itemStyle: { color: '#f59e0b' } },
            ] });
            previewChart.getZr().on('click', e => {
                if (!pick || !previewChart.containPixel('grid', [e.offsetX, e.offsetY])) return;
                const t = previewChart.convertFromPixel({ xAxisIndex: 0 }, e.offsetX);
                if (pick.step === 0) { $('compare-anchor-main').value = fmt(t); pick.step = 1; $('compare-align-info').textContent = '灰色の破線（現在）の特徴点をクリックしてください'; }
                else { $('compare-anchor-sub').value = fmt(t - sf.offset); pick = null; $('compare-align-manual').click(); }
            });
        }
        function effectiveOffset(f) { return rawTime ? 0 : f.offset || 0; }
        function renderResults() {
            $('compare-panel-content').innerHTML = `<div class="compare-step"><span>04</span><h2>違いを見つける</h2></div><p class="compare-muted">上部の解析対象で指定した区間を元データで比較します。アナログ値は基準時刻に線形補間。状態信号は直前値を保持します。</p><div class="compare-two"><button id="compare-calculate" class="btn-primary">比較を更新</button><select id="compare-sort" aria-label="比較結果の並べ替え"><option value="name">チャンネル順</option><option value="tolerance">許容差の超過度順</option></select></div><p id="compare-results-status" role="status"></p><div id="compare-result-summary" role="status" aria-live="polite" hidden></div><div id="compare-results-list"></div><details open><summary>カーソル位置の値</summary><p class="compare-muted">波形上のカーソルに追従します。</p><div id="compare-cursor-table"></div></details>`;
            $('compare-calculate').onclick = () => run(computeResults);
            $('compare-sort').value = resultSort;
            $('compare-sort').onchange = e => { resultSort = e.target.value; showRows(); };
            showRows(); syncResultStatus(); if (latestCursor !== null) cursor(latestCursor);
        }
        async function computeResults(requestedRange = null) {
            const mf = api.main(), names = [...s.selectedNames], range = requestedRange || activeRange(), ids = api.subIds();
            if (!mf || !ids.length || !names.length || !range) { api.warning('基準・比較ファイルと表示チャンネルを選んでください'); return null; }
            lastVisibleRange = api.visibleRange();
            const token = ++resultGeneration, signature = comparisonSignature();
            setResultRows([]); resultBusy = true; resultStatus = '元データを比較しています…'; showRows(); syncResultStatus();
            const result = [];
            try {
            for (const id of ids) {
                if (!await loadPair(id, names) || token !== resultGeneration) return null;
                for (const name of names) {
                    const sf = s.files[id], a = signal(mf, name), b = signal(sf, name);
                    const unit = a?.col.unit || mf.columns.find(c => c.name === name)?.unit || '';
                    const reason = !a || !b ? '未対応・データなし' : !C.sameUnit(unit, b.col.unit) ? '単位不一致' : a.col.isCrossFile ? '基準に固定された計算チャンネル' : '';
                    const stats = reason ? {} : C.compare(a, b, effectiveOffset(sf), range, s.bitChannels.has(name), setting().tolerances[name]);
                    result.push({ name, file: sf.name, fileId: id, fileLabel: label(sf), unit, reason, range: [...range], offset: effectiveOffset(sf), tolerance: setting().tolerances[name] ?? null, ...stats });
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            if (token !== resultGeneration || signature !== comparisonSignature()) return null;
            setResultRows(result, signature); showRows();
            resultStatus = `${fmt(range[0])}–${fmt(range[1])} s · 基準 − 比較 · ${rawTime ? '元の時刻' : '時間合わせ適用'} · ${rows.length}項目`;
            return result;
            } catch (error) {
                if (token === resultGeneration) resultStatus = '比較できませんでした。条件を確認して再実行してください。';
                throw error;
            } finally {
                if (token === resultGeneration) { resultBusy = false; syncResultStatus(); }
            }
        }
        function showRows() {
            if (!$('compare-results-list')) return;
            const sorted = rows.map((r, index) => ({ ...r, index })).sort((a, b) => resultSort === 'tolerance' ? (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
            const exceeded = rows.filter(r => toleranceState(r).kind === 'exceeded').length;
            const judged = rows.filter(r => ['exceeded', 'within', 'partial'].includes(toleranceState(r).kind)).length;
            const summary = $('compare-result-summary');
            summary.hidden = !rows.length; summary.className = exceeded ? 'compare-result-summary has-exceedance' : 'compare-result-summary';
            summary.innerHTML = `<strong>${exceeded ? `許容差超過 ${exceeded}件` : judged ? '判定した有効点は許容差内' : '許容差の判定対象なし'}</strong><span>判定 ${judged} / ${rows.length}件${judged < rows.length ? '（未設定・比較不可を除く）' : ''}</span><small>オレンジの帯は連続する超過点、縦線は単発の超過点です。上下比較では比較側の段に表示します。</small>`;
            $('compare-results-list').innerHTML = sorted.map(r => {
                const status = toleranceState(r), intervals = r.exceedanceIntervals || [];
                return `<article class="compare-result" data-result-status="${status.kind}"><span class="compare-result-badge">${status.label}</span><button data-result="${r.index}" class="compare-result-title"${!Number.isFinite(r.time) ? ' disabled' : ''}>${esc(r.name)} <small>↗ ${esc(r.fileLabel)}</small></button>${r.reason ? `<p class="compare-warning">${esc(r.reason)}</p>` : `<dl><div><dt>最大絶対差</dt><dd>${fmt(r.max)} ${esc(r.unit)}</dd></div><div><dt>その時刻</dt><dd>${fmt(r.time)} s</dd></div><div><dt>平均差 / RMS差</dt><dd>${fmt(r.mean)} / ${fmt(r.rms)}</dd></div>${r.mismatchDuration != null ? `<div><dt>状態不一致</dt><dd>${fmt(r.mismatchDuration)} s</dd></div><div><dt>最初の切替 基準 / 比較</dt><dd>${fmt(r.mainTransition?.time)} / ${fmt(r.subTransition?.time)} s</dd></div><div><dt>同じ遷移の時刻差</dt><dd>${fmt(r.transitionDelta)} s</dd></div>` : ''}<div><dt>有効 / 欠損・範囲外</dt><dd>${r.n || 0} / ${r.missing || 0}</dd></div></dl><label class="compare-tolerance">許容差 [${esc(r.unit || '単位なし')}]<input type="number" min="0" step="any" data-tolerance="${r.index}" value="${setting().tolerances[r.name] || ''}" placeholder="未設定" title="入力後、Enterまたは別の場所をクリックして確定"></label>${r.ratio != null ? `<p class="${r.exceeded > 0 ? 'compare-warning' : 'compare-muted'}">許容差の ${fmt(r.ratio)} 倍 / ${r.exceeded} 点超過${intervals.length ? ` / ${intervals.length}区間` : ''}</p>` : ''}${intervals.length ? `<div class="compare-exceedance-nav" data-exceedance-row="${r.index}"><span class="compare-exceedance-position" aria-live="polite"></span><div><button type="button" class="btn-secondary" data-exceedance-step="-1">前へ</button><button type="button" class="btn-secondary" data-exceedance-step="1">最初の超過へ</button></div></div>` : ''}`}</article>`;
            }).join('') || '<p class="compare-empty">「比較を更新」で差の一覧を作成します。</p>';
            panel.querySelectorAll('[data-result]').forEach(btn => btn.onclick = () => run(async () => {
                const r = rows[Number(btn.dataset.result)]; await api.select([r.name], false);
                const position = r.exceedanceIntervals?.findIndex(iv => iv.t0 <= r.time && r.time <= iv.t1) ?? -1;
                if (position >= 0) jumpToExceedance(r, Number(btn.dataset.result), position);
                else { const width = Math.max((r.range[1] - r.range[0]) * 0.04, 0.1); zoom([r.time - width, r.time + width], true); api.focusChannel(r.name, r.fileId); }
            }));
            panel.querySelectorAll('[data-exceedance-row]').forEach(nav => {
                const index = Number(nav.dataset.exceedanceRow), r = rows[index];
                syncExceedanceNavigation(index);
                nav.querySelectorAll('[data-exceedance-step]').forEach(button => button.onclick = () => {
                    const position = (exceedancePositions.get(index) ?? -1) + Number(button.dataset.exceedanceStep);
                    jumpToExceedance(r, index, position);
                });
            });
            panel.querySelectorAll('[data-tolerance]').forEach(inp => {
                inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); inp.blur(); } });
                inp.onchange = () => run(async () => {
                const r = rows[Number(inp.dataset.tolerance)], n = Number(inp.value);
                if (!r) return;
                if (inp.validity.badInput || (inp.value && (!Number.isFinite(n) || n <= 0))) { inp.value = setting().tolerances[r.name] || ''; return api.warning('許容差は正の値を指定してください'); }
                setting().tolerances = { ...setting().tolerances }; delete setting().tolerances[r.name];
                if (inp.value) setting().tolerances[r.name] = n; change(); await computeResults(r.range);
                });
            });
        }
        function toleranceState(r) {
            if (r.reason || !r.n) return { kind: 'unavailable', label: r.reason ? '比較不可' : '判定不可・有効点なし' };
            if (!(r.tolerance > 0)) return { kind: 'unset', label: '許容差未設定' };
            if (r.exceeded > 0) return { kind: 'exceeded', label: '許容差超過' };
            return r.missing ? { kind: 'partial', label: '有効点は許容差内・欠損あり' } : { kind: 'within', label: '許容差内' };
        }
        function syncExceedanceNavigation(index) {
            const nav = panel.querySelector(`[data-exceedance-row="${index}"]`), r = rows[index];
            if (!nav || !r) return;
            const position = exceedancePositions.get(index) ?? -1, intervals = r.exceedanceIntervals;
            const iv = intervals[position];
            nav.querySelector('.compare-exceedance-position').textContent = iv ? `${position + 1} / ${intervals.length} · ${fmt(iv.t0)}${iv.t0 === iv.t1 ? '' : `–${fmt(iv.t1)}`} s` : `${intervals.length}区間の超過があります`;
            nav.querySelector('[data-exceedance-step="-1"]').disabled = position <= 0;
            const next = nav.querySelector('[data-exceedance-step="1"]');
            next.disabled = position >= intervals.length - 1; next.textContent = position < 0 ? '最初の超過へ' : '次へ';
        }
        function jumpToExceedance(r, index, position) {
            const iv = r.exceedanceIntervals?.[position]; if (!iv) return;
            exceedancePositions.set(index, position);
            const margin = Math.max((r.range[1] - r.range[0]) * 0.02, (iv.t1 - iv.t0) * 0.25, 0.1);
            zoom([iv.t0 - margin, iv.t1 + margin], true); api.focusChannel(r.name, r.fileId); syncExceedanceNavigation(index);
        }
        function exceedanceHighlights(group) {
            if (!resultSignature || resultSignature !== comparisonSignature()) return [];
            return rows.filter(r => r.exceedanceIntervals?.length && group.series.some(line => line.fileId === r.fileId && line.channelName === r.name));
        }
        function cursor(t) {
            latestCursor = t;
            if (pane !== 'results' || !$('compare-cursor-table') || !Number.isFinite(t)) return;
            const mf = api.main(); if (!mf) return;
            let html = `<p class="compare-muted">${fmt(t)} s</p><table><thead><tr><th>信号 / ファイル</th><th>値</th><th>差</th></tr></thead><tbody>`;
            for (const name of s.selectedNames) {
                const a = signal(mf, name); if (!a) continue; const digital = s.bitChannels.has(name), av = C.valueAt(a.t, a.v, t, digital);
                html += `<tr><td>${esc(name)}<small>${esc(label(mf))} [${esc(a.col.unit)}]</small></td><td>${fmt(av)}</td><td>基準</td></tr>`;
                for (const id of api.subIds()) { const f = s.files[id], b = signal(f, name); if (!b) continue; const v = C.valueAt(b.t, b.v, t - effectiveOffset(f), digital); html += `<tr><td>${esc(label(f))} [${esc(b.col.unit)}]</td><td>${fmt(v)}</td><td>${C.sameUnit(a.col.unit, b.col.unit) ? fmt(av - v) : '単位違い'}</td></tr>`; }
            }
            $('compare-cursor-table').innerHTML = html + '</tbody></table>';
        }
        function loadTemplates() { try { const a = JSON.parse(localStorage.getItem('csv-compare-templates') || '[]'); return Array.isArray(a) ? a.filter(t => t?.format === 'CSV Comparison Template' && t.version === 1 && t.settings) : []; } catch { return []; } }
        function storeTemplates(list) { try { localStorage.setItem('csv-compare-templates', JSON.stringify(list)); } catch { throw new Error('テンプレートの保存容量が不足しています。JSONへ書き出してください。'); } }
        function template(name) {
            const settings = JSON.parse(JSON.stringify(api.collect()));
            delete settings.fileInfos; delete settings.fileColors; delete settings.timeUnitOverrides;
            settings.comparison = { ...C.cleanSettings(settings.comparison), labels: {}, matches: {}, notes: [], align: {}, analysis: root.CSVAnalysis.clean() };
            return { format: 'CSV Comparison Template', version: 1, name, settings, slots: api.subIds().map(id => { const f = s.files[id]; const align = setting().align[f.name]; return { matches: setting().matches[f.name] || {}, align: align ? { channel: align.channel, range: align.range, scope: align.scope } : null }; }) };
        }
        async function applyTemplate(t) {
            if (t?.format !== 'CSV Comparison Template' || t.version !== 1 || !t.settings || !Array.isArray(t.slots)) throw new Error('比較テンプレートの形式を確認してください');
            if (!Array.isArray(t.settings.selectedNames) || !t.settings.selectedNames.every(n => typeof n === 'string') || !Array.isArray(t.settings.customRAMs) || !t.settings.customRAMs.every(c => c && typeof c.name === 'string' && typeof c.expr === 'string') || !t.slots.every(x => x && typeof x === 'object' && !Array.isArray(x))) throw new Error('テンプレートのチャンネル・計算式・対応情報が不正です');
            if (!api.main()) throw new Error('先に新しいログを読み込んでください');
            const data = JSON.parse(JSON.stringify(t.settings));
            delete data.fileInfos; delete data.fileColors; delete data.timeUnitOverrides;
            data.comparison = C.cleanSettings(data.comparison); data.comparison.labels = { ...setting().labels }; data.comparison.notes = [...setting().notes]; data.comparison.matches = {}; data.comparison.align = {};
            const available = new Set(api.main().columns.map(c => c.name));
            const missing = (data.selectedNames || []).filter(n => !available.has(n) && !(data.customRAMs || []).some(c => c.name === n));
            api.subIds().forEach((id, i) => { const f = s.files[id], slot = t.slots[i]; if (!slot) return; data.comparison.matches[f.name] = slot.matches || {}; if (slot.align) data.comparison.align[f.name] = { ...slot.align, offset: 0 }; });
            data.fileInfos = Object.values(s.files).map(f => ({ name: f.name, role: f.role, offset: 0 }));
            await api.applyComparison(data);
            await api.offsetChanged(); api.renderFiles(); change();
            api.success('比較テンプレートを適用しました', '時間差は引き継がず、新しいログで再計算してください。');
            if (missing.length) api.warning('不足チャンネル', missing.join('、'));
            setPane('align');
        }
        function download(name, text, type = 'application/json') { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        function renderNotes() {
            const notes = setting().notes;
            $('compare-panel-content').innerHTML = `<h2>発見を残す</h2><p class="compare-muted">上部の解析対象、比較条件、数値と画像を一緒に保存します。</p><textarea id="compare-note-text" rows="3" maxlength="2000" placeholder="例：加速開始から応答が遅れる" aria-label="比較メモ"></textarea><button id="compare-note-add" class="btn-primary compare-wide">この区間をメモに保存</button><div id="compare-notes-list">${notes.map((n, i) => `<article class="compare-note"><button data-note-jump="${i}" class="compare-result-title">${fmt(n.t0)}–${fmt(n.t1)} s ↗</button><p>${esc(n.text)}</p><small>${esc(n.channels.join(' / '))}</small><button data-note-remove="${i}" class="btn-secondary">削除</button></article>`).join('')}</div>`;
            $('compare-note-text').value = noteDraft;
            $('compare-note-add').disabled = noteBusy;
            $('compare-note-add').textContent = noteBusy ? 'メモを保存中…' : 'この区間をメモに保存';
            $('compare-note-add').onclick = () => run(async () => {
                if (noteBusy) return;
                const text = $('compare-note-text').value.trim(), range = activeRange();
                if (!text || !range || !s.selectedNames.size) return api.warning('波形と区間を選び、メモを入力してください');
                if (setting().notes.length >= 20) return api.warning('メモは20件までです。レポートへ保存してから古いメモを削除してください');
                noteBusy = true; $('compare-note-add').disabled = true; $('compare-note-add').textContent = 'メモを保存中…';
                try {
                const noteMain = api.main();
                if (range) { showAnalysisRange(); await new Promise(requestAnimationFrame); }
                const signature = comparisonSignature(), noteRange = [...range], noteChannels = [...s.selectedNames];
                const context = JSON.parse(JSON.stringify(api.collect())); delete context.comparison;
                const noteContext = JSON.parse(JSON.stringify({ settings: context, matches: setting().matches, rawTime, align: setting().align, tolerances: setting().tolerances }));
                const noteFiles = Object.values(s.files).map(f => ({ name: f.name, label: label(f), role: f.role, offset: effectiveOffset(f) }));
                const result = api.subIds().length ? await computeResults() : [];
                const unchanged = () => noteMain === api.main() && signature === comparisonSignature() && JSON.stringify(activeRange()) === JSON.stringify(noteRange);
                if (!result || !unchanged()) throw new Error('保存中に区間または比較条件が変わりました。入力したメモは残っています。条件を確認して保存し直してください。');
                await new Promise(requestAnimationFrame); // Include newly computed exceedance highlights in the image.
                const canvas = document.createElement('canvas'), img = new Image();
                const url = api.image(); let image = '';
                if (url) { img.src = url; await img.decode(); canvas.width = Math.min(img.width, 1000); canvas.height = Math.round(img.height * canvas.width / img.width); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); image = canvas.toDataURL('image/png'); if (image.length >= 400000) image = ''; }
                if (!unchanged()) throw new Error('保存中に区間または比較条件が変わりました。入力したメモは残っています。条件を確認して保存し直してください。');
                const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text, t0: noteRange[0], t1: noteRange[1], created: new Date().toISOString(), channels: noteChannels, files: noteFiles, image, context: noteContext, results: result.map(({ exceedanceIntervals, ...summary }) => summary) };
                const updated = [...setting().notes, note];
                try { localStorage.setItem('csv-compare-storage-probe', JSON.stringify({ ...api.collect(), comparison: { ...setting(), notes: updated } })); localStorage.removeItem('csv-compare-storage-probe'); } catch { localStorage.removeItem('csv-compare-storage-probe'); throw new Error('メモの保存容量が不足しています。レポートへ保存してから古いメモを削除してください。'); }
                setting().notes = updated;
                // Keep any additional text typed while the snapshot was being prepared.
                if (noteDraft.trim() === text) noteDraft = '';
                change(); if (pane === 'notes') renderNotes(); api.success('比較条件とメモを保存しました', image ? '' : '画像が大きいため、数値と条件を保存しました。');
                } finally {
                    noteBusy = false;
                    if ($('compare-note-add')) { $('compare-note-add').disabled = false; $('compare-note-add').textContent = 'この区間をメモに保存'; }
                }
            });
            panel.querySelectorAll('[data-note-jump]').forEach(b => b.onclick = () => run(async () => {
                const n = setting().notes[Number(b.dataset.noteJump)];
                if (n.files.length !== Object.keys(s.files).length || n.files.some(f => !Object.values(s.files).some(x => x.name === f.name))) return api.warning('メモ時点のファイルを読み込んでください', n.files.map(f => f.name).join('、'));
                const settings = { ...n.context.settings, fileInfos: n.files, comparison: { ...setting(), matches: n.context.matches || {}, align: n.context.align || {}, tolerances: n.context.tolerances || setting().tolerances } };
                await api.applyComparison(settings); rawTime = !!n.context.rawTime; $('compare-raw').checked = rawTime; await api.ensure(); selectRange([n.t0, n.t1]); zoom([n.t0, n.t1]); change();
            }));
            panel.querySelectorAll('[data-note-remove]').forEach(b => b.onclick = () => { setting().notes = setting().notes.filter((_, i) => i !== Number(b.dataset.noteRemove)); change(); renderNotes(); });

        }
        function reportHTML() {
            return `<h2>比較ワークスペース</h2><p>表示：${esc(setting().view)} / ${rawTime ? '元の時刻' : '時間合わせ適用'}。差分は基準 − 比較。</p><h3>チャンネル対応・時間合わせ条件</h3><pre>${esc(JSON.stringify({ matches: setting().matches, align: setting().align, tolerances: setting().tolerances }, null, 2))}</pre>` + setting().notes.map(n => `<section><h2>${esc(n.text)}</h2><p>${fmt(n.t0)}–${fmt(n.t1)} s / ${esc(n.created)}</p><p>${esc(n.channels.join(' / '))}</p>${n.image ? `<img class="chart" src="${n.image}" alt="メモ保存時の波形">` : '<p>保存時の波形画像なし</p>'}<table><tr><th>ファイル</th><th>役割</th><th>シフト s</th></tr>${n.files.map(f => `<tr><td>${esc(f.label)} (${esc(f.name)})</td><td>${esc(f.role)}</td><td>${fmt(f.offset)}</td></tr>`).join('')}</table><table><tr><th>チャンネル / 比較</th><th>最大絶対差</th><th>時刻 s</th><th>平均差</th><th>RMS差</th></tr>${n.results.map(r => `<tr><td>${esc(r.name)} / ${esc(r.fileLabel)}</td><td>${esc(r.reason || fmt(r.max))} ${esc(r.unit)}</td><td>${fmt(r.time)}</td><td>${fmt(r.mean)}</td><td>${fmt(r.rms)}</td></tr>`).join('')}</table><details><summary>保存時の解析条件</summary><pre>${esc(JSON.stringify(n.context, null, 2))}</pre></details></section>`).join('');
        }
        function filterColumn(col, q) {
            const text = `${col.name} ${col.unit} ${setting().searchAliases[col.name] || ''} ${(s.channelAliases[col.name] || []).join(' ')}`.toLowerCase();
            if (q && !q.split(/\s+/).every(word => text.includes(word))) return false;
            const ids = api.subIds(), common = ids.length && ids.every(id => !!api.resolve(s.files[id], col.name));
            if (filter === 'selected') return s.selectedNames.has(col.name);
            if (filter === 'common') return !!common;
            if (filter === 'unmapped') return ids.length > 0 && !common;
            if (filter === 'favorite') return api.favoriteNames().includes(col.name);
            return true;
        }
        function decorateChannel(item, col) {
            item.dataset.channel = col.name; item.draggable = true;
            const top = item.querySelector('.col-item-top'); top.tabIndex = 0; top.setAttribute('role', 'button'); top.setAttribute('aria-pressed', String(s.selectedNames.has(col.name))); top.setAttribute('aria-label', `${col.name} [${col.unit || '単位なし'}]`);
            top.onkeydown = e => { if (e.target !== top) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); top.click(); } if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const nodes = [...document.querySelectorAll('.col-item-top')], index = nodes.indexOf(top); nodes[index + (e.key === 'ArrowDown' ? 1 : -1)]?.focus(); } };
            item.addEventListener('dragstart', e => { if (e.target.closest('input,button')) { e.preventDefault(); return; } e.dataTransfer.setData('application/x-csv-channel', col.name); e.dataTransfer.effectAllowed = 'copy'; });
        }
        $('column-search').addEventListener('keydown', e => { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); const top = document.querySelector('.col-item-top'); top?.focus(); if (e.key === 'Enter') top?.click(); } });
        chartContainer.addEventListener('dragover', e => {
            if (!e.dataTransfer.types.includes('application/x-csv-channel')) return;
            e.preventDefault(); chartContainer.classList.add('compare-drop-active');
            const hit = api.dropTarget(e.clientY); api.hint(hit?.edge ? 'ここに独立したチャートを挿入' : hit ? 'ここに重ね合わせ（単位ごとに軸を配置）' : '末尾にチャートを追加');
        });
        chartContainer.addEventListener('dragleave', e => { if (!chartContainer.contains(e.relatedTarget)) chartContainer.classList.remove('compare-drop-active'); });
        chartContainer.addEventListener('drop', e => {
            const name = e.dataTransfer.getData('application/x-csv-channel'); if (!name) return;
            e.preventDefault(); e.stopPropagation(); chartContainer.classList.remove('compare-drop-active'); const hit = api.dropTarget(e.clientY);
            run(async () => { setting().view = 'overlay'; await api.dropChannel(name, hit); change(); });
        });
        function transformGroups(active) {
            if (rawTime) for (const group of active.groups.values()) group.series = group.series.filter(line => !line.isCrossFile);
            if (setting().view === 'overlay' || !api.subIds().length) return active;
            const groups = new Map(), order = [];
            for (const id of active.order) {
                const group = active.groups.get(id);
                if (setting().view === 'stack') {
                    const files = [...new Set(group.series.map(x => x.fileId))];
                    for (const fid of files) { const key = `${id}::${fid}`; order.push(key); groups.set(key, { ...group, id: key, sourceGroupId: id, caption: label(s.files[fid]), series: group.series.filter(x => x.fileId === fid) }); }
                } else {
                    const series = [];
                    for (const name of group.mergedNames) {
                        const a = signal(api.main(), name); if (!a || a.col.isCrossFile) continue;
                        const base = group.series.find(x => x.channelName === name && !x.dash); if (!base) continue;
                        for (const fid of api.subIds()) {
                            const f = s.files[fid], b = signal(f, name); if (!b || !C.sameUnit(a.col.unit, b.col.unit)) continue;
                            const diff = C.compare(a, b, effectiveOffset(f), null, s.bitChannels.has(name), null, true);
                            series.push({ ...base, id: `compare-diff-${base.id}-${fid}`, label: `${name} Δ [${label(api.main())} − ${label(f)}]`, data: diff.points, fileId: fid, color: s.fileColors[fid] || b.col.color });
                        }
                    }
                    order.push(id); groups.set(id, { ...group, series });
                }
            }
            return { groups, order };
        }
        function drawOverview(force = false) {
            const range = fullRange(), visible = api.visibleRange();
            if (!range || !visible) return;
            $('compare-range-label').textContent = `${fmt(visible[0])}–${fmt(visible[1])} s`;
            for (const [id, value] of [['compare-range-start', visible[0]], ['compare-range-end', visible[1]]]) if (document.activeElement !== $(id)) $(id).value = fmt(value);
            const width = range[1] - range[0] || 1;
            const win = $('compare-overview-window'); win.style.left = `${Math.max(0, (visible[0] - range[0]) / width * 100)}%`; win.style.width = `${Math.min(100, (visible[1] - visible[0]) / width * 100)}%`;
            const name = [...s.selectedNames][0], key = JSON.stringify([name, Object.entries(s.files).map(([id, f]) => [id, effectiveOffset(f), f.colData[api.resolve(f, name)?.id]?.length]), s.theme]);
            if (!force && key === overviewKey) return; overviewKey = key;
            const canvas = $('compare-overview-canvas'), w = canvas.clientWidth; canvas.width = Math.max(w, 1) * devicePixelRatio; canvas.height = 42 * devicePixelRatio;
            const ctx = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio); ctx.clearRect(0, 0, w, 42);
            $('compare-overview-label').textContent = name || 'チャンネルを選択';
            const signals = Object.entries(s.files).map(([id, f]) => ({ id, f, sig: signal(f, name) })).filter(x => x.sig);
            const sampled = signals.map(x => { const pts = [], step = Math.max(1, Math.ceil(x.sig.t.length / Math.max(w, 1))); for (let i = 0; i < x.sig.t.length; i += step) pts.push([x.sig.t[i] + effectiveOffset(x.f), x.sig.v[i]]); return { ...x, pts }; });
            let min = Infinity, max = -Infinity; for (const x of sampled) for (const p of x.pts) if (Number.isFinite(p[1])) { min = Math.min(min, p[1]); max = Math.max(max, p[1]); }
            for (const x of sampled) { ctx.strokeStyle = s.fileColors[x.id] || x.sig.col.color || '#16b8a6'; ctx.setLineDash(x.f.role === 'main' ? [] : [4, 3]); ctx.beginPath(); let started = false; for (const [t, v] of x.pts) { if (!Number.isFinite(v)) { started = false; continue; } const px = (t - range[0]) / width * w, py = 38 - (v - min) / (max - min || 1) * 34; if (started) ctx.lineTo(px, py); else ctx.moveTo(px, py); started = true; } ctx.stroke(); }
        }
        let navStart = null;
        $('compare-overview-plot').onpointerdown = e => { if (!s.numGrids) return; navStart = e.offsetX; e.currentTarget.setPointerCapture(e.pointerId); };
        $('compare-overview-plot').onpointerup = e => { if (navStart == null) return; const r = fullRange(), rect = e.currentTarget.getBoundingClientRect(), a = navStart, b = e.clientX - rect.left; navStart = null; const t = x => r[0] + Math.max(0, Math.min(rect.width, x)) / rect.width * (r[1] - r[0]); if (Math.abs(a - b) < 4) { const v = api.visibleRange(), width = Math.min(v[1] - v[0], r[1] - r[0]), lo = Math.max(r[0], Math.min(r[1] - width, t(b) - width / 2)); zoom([lo, lo + width]); } else zoom([t(Math.min(a, b)), t(Math.max(a, b))]); };
        $('compare-overview-plot').onpointercancel = () => { navStart = null; };
        let structure = '';
        function comparisonSignature(includeTolerances = true) {
            const files = Object.entries(s.files).map(([id, f]) => [id, f.role, f.offset, f.timeData?.length,
                f.timeData?.[0], f.timeData?.[f.timeData.length - 1], f.headerInfo?.timeScale,
                f.columns.map(c => [c.name, c.unit, !!c.isCrossFile])]);
            const calculations = s.customRAMs.map(c => [c.name, c.unit, c.expr]);
            const cycles = (s.driveIndex?.results || []).map(r => [r.fileId, r.effectiveId, r.align?.start, r.align?.end]);
            return JSON.stringify([files, calculations, cycles, [...s.selectedNames], [...s.bitChannels], s.channelAliases, setting().matches, setting().labels, includeTolerances ? setting().tolerances : null, rawTime]);
        }
        function schedule() {
            if (raf !== null) return;
            raf = requestAnimationFrame(() => {
                raf = null;
                if (selection && api.main() && !selectionMain && setting().analysis.mainName === api.main().name) selectionMain = api.main();
                if (selection && api.main() && selectionMain !== api.main()) { selection = null; persistAnalysis(); action.classList.add('hidden'); }
                const key = comparisonSignature(false);
                if (key !== structure) { generation++; busy = false; preview = null; pick = null; invalidateResults(); structure = key; renderPanel(); }
                $('compare-status').textContent = `${Object.keys(s.files).length} ファイル · ${s.selectedNames.size} チャンネル`;
                bar.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === setting().view); b.setAttribute('aria-pressed', String(b.dataset.view === setting().view)); b.disabled = b.dataset.view !== 'overlay' && !api.subIds().length; });
                $('compare-view-hint').textContent = setting().view === 'diff' ? '基準 − 比較 / 単位一致のみ / Y軸自動' : rawTime ? '元の時刻（時刻合わせを使う計算線は非表示）' : '時間軸はすべて連動';
                main.classList.toggle('compare-view-diff', setting().view === 'diff');
                document.querySelector('.sidebar').classList.toggle('compare-view-diff', setting().view === 'diff');
                $('arrange-mode-btn').disabled = !api.canArrange();
                if (s.measure.tA !== null && s.measure.tB !== null) { const r = [s.measure.tA, s.measure.tB].sort((a, b) => a - b); if (!selection || r[0] !== selection[0] || r[1] !== selection[1]) selectRange(r); }
                drawOverview();
                syncAnalysisContext();
            });
        }
        function bindChart() {
            s.chart.on('datazoom', () => {
                const visible = api.visibleRange();
                const changed = !lastVisibleRange || !visible || visible.some((value, i) => value !== lastVisibleRange[i]);
                lastVisibleRange = visible;
                if (changed && setting().analysis.scope === 'visible' && !resultNavigation) intervalChanged();
                schedule();
            });
            s.chart.on('updateAxisPointer', e => { const x = e.axesInfo?.find(a => a.axisDim === 'x'); if (x) cursor(Number(x.value)); });
        }
        renderPanel(); applyLayout();
        return { schedule, bindChart, label, effectiveOffset, transformGroups, filterColumn, decorateChannel, reportHTML, exceedanceHighlights, analysisContext, syncAnalysisContext,
            showAnalysisRange,
            templates: {
                list: loadTemplates,
                save: name => { const saved = template(name), list = [...loadTemplates().filter(t => t.name !== name), saved]; storeTemplates(list); change(); api.success('テンプレートを保存しました'); return list.length - 1; },
                export: name => download('comparison-template.json', JSON.stringify(template(name), null, 2)),
                apply: index => applyTemplate(loadTemplates()[index]),
                remove: index => { storeTemplates(loadTemplates().filter((_, i) => i !== index)); change(); },
                import: async file => {
                    if (file.size > 2000000) throw new Error('テンプレートは2MB以下のJSONを指定してください');
                    const files = Object.entries(s.files).map(([id, value]) => ({ id, file: value, role: value.role }));
                    const mainId = api.mainId(), subIds = api.subIds();
                    const data = JSON.parse(await file.text());
                    const current = Object.entries(s.files);
                    if (api.mainId() !== mainId || JSON.stringify(api.subIds()) !== JSON.stringify(subIds)
                        || current.length !== files.length || files.some((entry, index) => current[index][0] !== entry.id || current[index][1] !== entry.file || current[index][1].role !== entry.role)) {
                        throw new Error('読み込み中に対象ログ・基準・比較順が変わりました。現在のログを確認し、テンプレートJSONを選び直してください。');
                    }
                    await applyTemplate(data);
                }
            },
            focusTime: t => {
                const visible = api.visibleRange(), full = fullRange();
                if (!Number.isFinite(t) || !full || (visible && t >= visible[0] && t <= visible[1])) return;
                const width = visible && visible[1] > visible[0] ? visible[1] - visible[0] : Math.max((full[1] - full[0]) / 10, 1);
                let lo = Math.max(full[0], t - width / 2), hi = Math.min(full[1], lo + width);
                lo = Math.max(full[0], hi - width);
                if (hi > lo) zoom([lo, hi], true);
            },
            selectionRange: () => selection,
            selectRange, cancelRangeMode, openAlign: id => { selectedSub = id; setPane('align'); },
            brush: r => { if (!intervalMode) return false; cancelRangeMode(); selectRange(r); return true; },
            changedSettings: () => { restoreAnalysis(); generation++; preview = null; invalidateResults(); mapDrafts.clear(); alignDrafts.clear(); structure = ''; schedule(); },
            clear: () => { generation++; selection = null; rawTime = false; setting().analysis = root.CSVAnalysis.clean(); $('compare-raw').checked = false; invalidateResults(); preview = null; cancelRangeMode(); mapDrafts.clear(); alignDrafts.clear(); action.classList.add('hidden'); overviewKey = ''; syncAnalysisContext(); schedule(); } };
    };
})(window);
