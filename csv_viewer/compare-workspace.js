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
        bar.innerHTML = `<div class="compare-segment" role="group" aria-label="比較の表示方法"><button data-view="overlay">重ね合わせ</button><button data-view="stack">上下比較</button><button data-view="diff">差分</button></div><label class="compare-raw"><input id="compare-raw" type="checkbox">元の時刻で確認</label><button id="compare-select-range" class="btn-secondary">区間を選択</button><span id="compare-view-hint"></span>`;
        heading.after(bar);
        const body = document.createElement('div'); body.className = 'compare-body';
        chartContainer.before(body); body.appendChild(chartContainer);
        const panel = document.createElement('aside'); panel.className = 'compare-panel'; panel.id = 'compare-panel'; panel.setAttribute('aria-label', '比較の準備と結果');
        panel.innerHTML = `<nav class="compare-tabs" aria-label="比較パネル"><button data-pane="prepare">準備</button><button data-pane="align">時間合わせ</button><button data-pane="results">比較結果</button><button data-pane="notes">メモ・保存</button></nav><div id="compare-panel-content"></div>`;
        body.appendChild(panel);
        const bottom = document.createElement('div'); bottom.className = 'compare-overview';
        bottom.innerHTML = `<div class="compare-overview-heading"><span>全体ナビゲーター <small id="compare-overview-label"></small></span><span id="compare-range-label"></span></div><div id="compare-overview-plot"><canvas id="compare-overview-canvas" height="42"></canvas><div id="compare-overview-window"></div></div><div class="compare-range-inputs"><label>開始 <input id="compare-range-start" type="number" step="any" aria-label="表示区間の開始秒"> s</label><label>終了 <input id="compare-range-end" type="number" step="any" aria-label="表示区間の終了秒"> s</label><button id="compare-range-go" class="btn-secondary">表示</button><button id="compare-range-all" class="btn-secondary">全体</button></div>`;
        main.appendChild(bottom);
        const action = document.createElement('div'); action.id = 'compare-selection'; action.className = 'compare-selection hidden';
        action.innerHTML = `<strong id="compare-selection-label"></strong><button data-range-action="zoom">拡大</button><button data-range-action="compare">区間比較</button><button data-range-action="stats">統計</button><button data-range-action="event">イベント登録</button><button data-range-action="note">メモ</button><button data-range-action="copy">画像コピー</button><button data-range-action="close" aria-label="区間選択を解除">×</button>`;
        bar.after(action);
        const filters = document.createElement('div'); filters.className = 'compare-channel-filters';
        filters.innerHTML = `<select id="compare-channel-filter" aria-label="チャンネルの絞り込み"><option value="all">すべて</option><option value="selected">表示中</option><option value="common">全ファイル共通</option><option value="unmapped">未対応あり</option><option value="favorite">お気に入りセット</option></select><button id="compare-alias-edit" class="btn-secondary" title="検索用の別名を登録">検索別名</button>`;
        document.querySelector('.search-box').after(filters);
        const advanced = document.createElement('details'); advanced.className = 'compare-advanced';
        advanced.innerHTML = '<summary>読み込み設定・計算・イベント</summary>';
        document.querySelector('.sidebar-upper').appendChild(advanced);
        for (const name of ['parse', 'customRam', 'events']) advanced.appendChild(document.querySelector(`[data-section="${name}"]`));
        document.querySelector('.sidebar-header h2').textContent = 'ファイルとチャンネル';
        const resize = new ResizeObserver(() => { api.resize(); drawOverview(true); if (previewChart) { previewChart.dispatchAction({ type: 'hideTip' }); previewChart.resize(); } });
        resize.observe(chartContainer);
        function run(fn) { Promise.resolve().then(fn).catch(e => api.warning('比較操作を完了できませんでした', e.message)); }
        function change() { api.save(); schedule(); }
        function setPane(next) { if (pane !== next) { generation++; preview = null; pick = null; busy = false; } pane = next; open = true; renderPanel(); applyLayout(); }
        function applyLayout() {
            panel.classList.toggle('hidden', !open); $('compare-panel-toggle').setAttribute('aria-expanded', String(open));
            main.classList.toggle('compare-panel-open', open); requestAnimationFrame(() => api.resize());
        }
        $('compare-panel-toggle').onclick = () => { open = !open; applyLayout(); };
        panel.querySelectorAll('[data-pane]').forEach(b => b.onclick = () => setPane(b.dataset.pane));
        bar.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { if (s.arrangeMode) api.exitArrange(); setting().view = b.dataset.view; api.render(); change(); });
        $('compare-raw').onchange = e => { rawTime = e.target.checked; preview = null; generation++; api.render(); schedule(); };
        $('compare-select-range').onclick = () => { intervalMode = true; api.startBrush(); api.hint('ドラッグで区間を選択。拡大・比較・メモを選べます。'); };
        $('compare-channel-filter').onchange = e => { filter = e.target.value; api.renderColumns(); };
        $('compare-alias-edit').onclick = () => {
            const cols = api.main()?.columns || [];
            if (!cols.length) return api.warning('ファイルを先に読み込んでください');
            const { modal, close } = api.modal(`<h3>検索用の別名</h3><p>例：Actual_Speed に「車速 速度」。元のチャンネル名は変わりません。</p><label>チャンネル<select id="compare-alias-channel">${cols.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></label><label>検索語<input id="compare-alias-text" maxlength="300"></label><button id="compare-alias-save" class="btn-primary">保存</button>`);
            const choose = modal.querySelector('select'), text = modal.querySelector('input');
            const sync = () => { text.value = setting().searchAliases[choose.value] || ''; }; sync(); choose.onchange = sync;
            modal.querySelector('button').onclick = () => { setting().searchAliases = { ...setting().searchAliases, [choose.value]: text.value.trim() }; api.renderColumns(); change(); close(); };
        };
        $('compare-range-go').onclick = () => zoom([Number($('compare-range-start').value), Number($('compare-range-end').value)]);
        $('compare-range-all').onclick = () => { api.resetZoom(); schedule(); };
        function fullRange() {
            const files = Object.values(s.files).filter(f => f.timeData?.length);
            if (!files.length) return null;
            return [Math.min(...files.map(f => f.timeData[0] + effectiveOffset(f))), Math.max(...files.map(f => f.timeData[f.timeData.length - 1] + effectiveOffset(f)))];
        }
        function zoom(r) {
            if (!r || !r.every(Number.isFinite) || r[1] <= r[0] || !s.numGrids) return api.warning('開始より後の終了時刻を指定してください');
            const full = fullRange(); const lo = Math.max(full[0], r[0]), hi = Math.min(full[1], r[1]);
            if (hi <= lo) return api.warning('データがある範囲を指定してください');
            s.chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: lo, endValue: hi }); api.save(); schedule();
        }
        function activeRange() { return selection || api.visibleRange() || fullRange(); }
        function selectRange(r) { selection = r; selectionMain = api.main(); rows = []; showRows(); $('compare-selection').classList.remove('hidden'); $('compare-selection-label').textContent = `${fmt(r[0])} – ${fmt(r[1])} s`; requestAnimationFrame(() => api.render()); schedule(); }
        action.querySelectorAll('[data-range-action]').forEach(b => b.onclick = () => run(async () => {
            if (!selection) return;
            switch (b.dataset.rangeAction) {
                case 'zoom': zoom(selection); break;
                case 'compare': setPane('results'); await computeResults(); break;
                case 'stats': zoom(selection); api.stats(); break;
                case 'event': s.events = { expr: '手動選択区間', intervals: [...s.events.intervals, { t0: selection[0], t1: selection[1] }] }; api.render(); api.save(); api.success('選択区間をイベントとして登録しました'); break;
                case 'note': setPane('notes'); $('compare-note-text').focus(); break;
                case 'copy': zoom(selection); await new Promise(requestAnimationFrame); await api.copy(); break;
                case 'close': selection = null; action.classList.add('hidden'); api.clearMeasure(); schedule(); break;
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
            if ($('compare-main')) $('compare-main').onchange = e => run(async () => { generation++; preview = null; selection = null; rows = []; await api.setMain(e.target.value); change(); renderPanel(); });
            if (!sf) return;
            const cols = mf.columns.filter(c => s.selectedNames.has(c.name));
            pendingMap = Object.create(null);
            $('compare-map-list').innerHTML = cols.map((c, i) => {
                const resolved = api.resolve(sf, c.name); pendingMap[c.name] = resolved?.name || '';
                return `<label class="compare-map-row"><span title="${esc(c.name)}">${esc(c.name)} <small>[${esc(c.unit || '単位なし')}]</small></span><select data-map-index="${i}" aria-label="${esc(c.name)}の対応先"><option value="">未対応</option>${C.candidates(c, sf.columns).map(({ col }) => `<option value="${esc(col.name)}"${col.name === resolved?.name ? ' selected' : ''}>${esc(col.name)} [${esc(col.unit || '単位なし')}]</option>`).join('')}</select><small data-map-status="${i}"></small></label>`;
            }).join('') || '<p class="compare-empty">左の一覧から比較するチャンネルを選択してください。</p>';
            function statuses() { cols.forEach((c, i) => { const target = sf.columns.find(x => x.name === pendingMap[c.name]); const el = panel.querySelector(`[data-map-status="${i}"]`); el.textContent = !target ? '未対応：比較対象から除外' : !C.sameUnit(c.unit, target.unit) ? '単位が異なります：差分・数値比較は除外' : !c.unit ? '対応済み・単位なし（同じ量か確認）' : '対応済み'; el.className = !target || !C.sameUnit(c.unit, target.unit) ? 'compare-warning' : 'compare-muted'; }); }
            panel.querySelectorAll('[data-map-index]').forEach(el => el.onchange = () => { pendingMap[cols[Number(el.dataset.mapIndex)].name] = el.value; statuses(); });
            $('compare-map-suggest').onclick = () => { cols.forEach((c, i) => { const candidate = C.candidates(c, sf.columns)[0]; if (candidate?.score >= 80) { pendingMap[c.name] = candidate.col.name; panel.querySelector(`[data-map-index="${i}"]`).value = candidate.col.name; } }); statuses(); };
            $('compare-map-apply').onclick = () => run(async () => { setting().matches = { ...setting().matches, [sf.name]: { ...setting().matches[sf.name], ...pendingMap } }; await api.ensure(); await api.offsetChanged(); change(); api.success('チャンネル対応を適用しました'); });
            $('compare-next').onclick = () => run(async () => { setting().matches = { ...setting().matches, [sf.name]: { ...setting().matches[sf.name], ...pendingMap } }; await api.ensure(); await api.offsetChanged(); change(); setPane('align'); }); statuses();
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
            $('compare-panel-content').innerHTML = `<div class="compare-step"><span>03</span><h2>波形を見ながら時間合わせ</h2></div>${subSelector()}<label class="compare-field">基準にするチャンネル<select id="compare-align-channel">${eligible.map(c => `<option${c.name === defaultChannel ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><div class="compare-two"><label class="compare-field">探索幅 ±秒<input id="compare-align-span" type="number" min="0.001" step="any" value="${a.range || 30}"></label><label class="compare-field">評価区間<select id="compare-align-scope"><option value="all">全区間</option><option value="visible"${a.scope === 'visible' ? ' selected' : ''}>選択／表示区間</option></select></label></div><button id="compare-align-run" class="btn-primary compare-wide"${!eligible.length ? ' disabled' : ''}>自動合わせをプレビュー</button><p class="compare-muted">現在のシフト ${fmt(sf.offset)} s。プレビューでは保存済みの時間を変更しません。</p><div id="compare-align-preview" class="compare-preview"></div><div id="compare-align-info" role="status"></div><div class="compare-two"><button id="compare-align-apply" class="btn-primary" disabled>この時間差を適用</button><button id="compare-align-cancel" class="btn-secondary">キャンセル</button></div><details class="compare-manual"><summary>2点指定・数値で合わせる</summary><p class="compare-muted">プレビュー上で基準の特徴点→比較の特徴点をクリックします。数値入力でも指定できます。</p><button id="compare-align-pick" class="btn-secondary">波形の2点を指定</button><div class="compare-two"><label class="compare-field">基準の時刻 s<input id="compare-anchor-main" type="number" step="any"></label><label class="compare-field">比較の元時刻 s<input id="compare-anchor-sub" type="number" step="any"></label></div><button id="compare-align-manual" class="btn-secondary">2点からプレビュー</button></details><button id="compare-align-results" class="btn-secondary compare-wide">次へ：比較結果 →</button>`;
            $('compare-align-run').onclick = () => run(autoPreview);
            $('compare-align-results').onclick = () => { setPane('results'); run(computeResults); };
            $('compare-align-apply').onclick = () => run(async () => {
                if (!preview || preview.id !== currentSub() || !s.files[preview.id] || preview.main !== api.main()) return;
                const p = preview; generation++; preview = null; sf.offset = p.offset;
                setting().align = { ...setting().align, [sf.name]: { channel: p.name, range: p.span, scope: p.scope, offset: p.offset, method: p.method } };
                rawTime = false; $('compare-raw').checked = false; await api.offsetChanged(); api.renderFiles(); change();
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
            previewChart = root.echarts.init($('compare-align-preview'));
            const points = (sig, off) => { const out = [], step = Math.max(1, Math.ceil(sig.t.length / 1600)); for (let i = 0; i < sig.t.length; i += step) out.push([sig.t[i] + off, Number.isFinite(sig.v[i]) ? sig.v[i] : null]); return out; };
            previewChart.setOption({ animation: false, grid: { left: 48, right: 15, top: 34, bottom: 32 }, legend: { textStyle: { color: api.textColor() }, data: ['基準', '現在', '候補'] }, tooltip: { trigger: 'axis' }, xAxis: { type: 'value', min: inputs.range[0], max: inputs.range[1] }, yAxis: { type: 'value', scale: true }, series: [
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
            $('compare-panel-content').innerHTML = `<div class="compare-step"><span>04</span><h2>違いを見つける</h2></div><p class="compare-muted">選択区間、なければ表示区間を元データで比較します。アナログ値は基準時刻に線形補間。状態信号は直前値を保持します。</p><div class="compare-two"><button id="compare-calculate" class="btn-primary">比較を更新</button><select id="compare-sort" aria-label="比較結果の並べ替え"><option value="name">チャンネル順</option><option value="tolerance">許容差の超過度順</option></select></div><p id="compare-results-status" role="status"></p><div id="compare-results-list"></div><details open><summary>カーソル位置の値</summary><p class="compare-muted">波形上のカーソルに追従します。</p><div id="compare-cursor-table"></div></details>`;
            $('compare-calculate').onclick = () => run(computeResults);
            $('compare-sort').onchange = showRows;
            showRows(); if (latestCursor !== null) cursor(latestCursor);
        }
        async function computeResults() {
            const mf = api.main(), names = [...s.selectedNames], range = activeRange(), ids = api.subIds();
            if (!mf || !ids.length || !names.length || !range) return api.warning('基準・比較ファイルと表示チャンネルを選んでください');
            const token = ++generation; rows = [];
            if ($('compare-results-status')) $('compare-results-status').textContent = '元データを比較しています…';
            const result = [];
            for (const id of ids) {
                if (!await loadPair(id, names) || token !== generation) return;
                for (const name of names) {
                    const sf = s.files[id], a = signal(mf, name), b = signal(sf, name);
                    const unit = a?.col.unit || mf.columns.find(c => c.name === name)?.unit || '';
                    const reason = !a || !b ? '未対応・データなし' : !C.sameUnit(unit, b.col.unit) ? '単位不一致' : a.col.isCrossFile ? '基準に固定された計算チャンネル' : '';
                    const stats = reason ? {} : C.compare(a, b, effectiveOffset(sf), range, s.bitChannels.has(name), setting().tolerances[name]);
                    result.push({ name, file: sf.name, fileId: id, fileLabel: label(sf), unit, reason, range: [...range], offset: effectiveOffset(sf), ...stats });
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            if (token !== generation) return;
            rows = result; showRows();
            if ($('compare-results-status')) $('compare-results-status').textContent = `${fmt(range[0])}–${fmt(range[1])} s · 基準 − 比較 · ${rawTime ? '元の時刻' : '時間合わせ適用'} · ${rows.length}項目`;
        }
        function showRows() {
            if (!$('compare-results-list')) return;
            const sorted = rows.map((r, index) => ({ ...r, index })).sort((a, b) => $('compare-sort')?.value === 'tolerance' ? (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
            $('compare-results-list').innerHTML = sorted.map(r => `<article class="compare-result"><button data-result="${r.index}" class="compare-result-title"${!Number.isFinite(r.time) ? ' disabled' : ''}>${esc(r.name)} <small>↗ ${esc(r.fileLabel)}</small></button>${r.reason ? `<p class="compare-warning">${esc(r.reason)}</p>` : `<dl><div><dt>最大絶対差</dt><dd>${fmt(r.max)} ${esc(r.unit)}</dd></div><div><dt>その時刻</dt><dd>${fmt(r.time)} s</dd></div><div><dt>平均差 / RMS差</dt><dd>${fmt(r.mean)} / ${fmt(r.rms)}</dd></div>${r.mismatchDuration != null ? `<div><dt>状態不一致</dt><dd>${fmt(r.mismatchDuration)} s</dd></div><div><dt>最初の切替 基準 / 比較</dt><dd>${fmt(r.mainTransition?.time)} / ${fmt(r.subTransition?.time)} s</dd></div><div><dt>同じ遷移の時刻差</dt><dd>${fmt(r.transitionDelta)} s</dd></div>` : ''}<div><dt>有効 / 欠損・範囲外</dt><dd>${r.n || 0} / ${r.missing || 0}</dd></div></dl><label class="compare-tolerance">許容差 [${esc(r.unit || '単位なし')}]<input type="number" min="0" step="any" data-tolerance="${r.index}" value="${setting().tolerances[r.name] || ''}" placeholder="未設定"></label>${r.ratio != null ? `<p class="${r.ratio > 1 ? 'compare-warning' : 'compare-muted'}">許容差の ${fmt(r.ratio)} 倍 / ${r.exceeded} 点超過</p>` : ''}`}</article>`).join('') || '<p class="compare-empty">「比較を更新」で差の一覧を作成します。</p>';
            panel.querySelectorAll('[data-result]').forEach(btn => btn.onclick = () => run(async () => {
                const r = rows[Number(btn.dataset.result)]; await api.select([r.name], false);
                const width = Math.max((r.range[1] - r.range[0]) * 0.04, 0.1); zoom([r.time - width, r.time + width]); api.focusChannel(r.name);
            }));
            panel.querySelectorAll('[data-tolerance]').forEach(inp => inp.onchange = () => run(async () => {
                const r = rows[Number(inp.dataset.tolerance)], n = Number(inp.value);
                if (inp.value && (!Number.isFinite(n) || n <= 0)) return api.warning('許容差は正の値を指定してください');
                setting().tolerances = { ...setting().tolerances }; delete setting().tolerances[r.name];
                if (inp.value) setting().tolerances[r.name] = n; change(); await computeResults();
            }));
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
            settings.comparison = { ...C.cleanSettings(settings.comparison), labels: {}, matches: {}, notes: [], align: {} };
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
            const notes = setting().notes, templates = loadTemplates();
            $('compare-panel-content').innerHTML = `<h2>発見を残す</h2><p class="compare-muted">選択／表示区間、比較条件、数値と画像を一緒に保存します。</p><textarea id="compare-note-text" rows="3" maxlength="2000" placeholder="例：加速開始から応答が遅れる" aria-label="比較メモ"></textarea><button id="compare-note-add" class="btn-primary compare-wide">この区間をメモに保存</button><div id="compare-notes-list">${notes.map((n, i) => `<article class="compare-note"><button data-note-jump="${i}" class="compare-result-title">${fmt(n.t0)}–${fmt(n.t1)} s ↗</button><p>${esc(n.text)}</p><small>${esc(n.channels.join(' / '))}</small><button data-note-remove="${i}" class="btn-secondary">削除</button></article>`).join('')}</div><button id="compare-report" class="btn-secondary compare-wide">メモ付きHTMLレポート</button><hr><h2>次の試験に再利用</h2><label class="compare-field">テンプレート名<input id="compare-template-name" maxlength="100" placeholder="例：加速応答の比較"></label><div class="compare-two"><button id="compare-template-save" class="btn-primary">保存</button><button id="compare-template-export" class="btn-secondary">JSON書き出し</button></div><label class="compare-field">保存済みテンプレート<select id="compare-template-select"><option value="">選択してください</option>${templates.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select></label><div class="compare-two"><button id="compare-template-apply" class="btn-secondary">新しいログに適用</button><button id="compare-template-delete" class="btn-secondary">削除</button></div><label class="compare-template-import">JSONを読み込む<input id="compare-template-import" type="file" accept=".json"></label><p class="compare-muted">配置・式・対応・許容差・時間合わせの条件を再利用。前回の時間差は適用しません。</p>`;
            $('compare-note-add').onclick = () => run(async () => {
                const text = $('compare-note-text').value.trim(), range = activeRange();
                if (!text || !range || !s.selectedNames.size) return api.warning('波形と区間を選び、メモを入力してください');
                if (notes.length >= 20) return api.warning('メモは20件までです。レポートへ保存してから古いメモを削除してください');
                const noteMain = api.main();
                if (selection) { zoom(selection); await new Promise(requestAnimationFrame); }
                await computeResults();
                if (noteMain !== api.main()) return;
                const canvas = document.createElement('canvas'), img = new Image();
                const url = api.image(); let image = '';
                if (url) { img.src = url; await img.decode(); canvas.width = Math.min(img.width, 1000); canvas.height = Math.round(img.height * canvas.width / img.width); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); image = canvas.toDataURL('image/png'); if (image.length >= 400000) image = ''; }
                const context = JSON.parse(JSON.stringify(api.collect())); delete context.comparison;
                const note = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text, t0: range[0], t1: range[1], created: new Date().toISOString(), channels: [...s.selectedNames], files: Object.values(s.files).map(f => ({ name: f.name, label: label(f), role: f.role, offset: effectiveOffset(f) })), image, context: { settings: context, matches: setting().matches, rawTime, align: setting().align }, results: rows };
                const updated = [...setting().notes, note];
                try { localStorage.setItem('csv-compare-storage-probe', JSON.stringify({ ...api.collect(), comparison: { ...setting(), notes: updated } })); localStorage.removeItem('csv-compare-storage-probe'); } catch { localStorage.removeItem('csv-compare-storage-probe'); throw new Error('メモの保存容量が不足しています。レポートへ保存してから古いメモを削除してください。'); }
                setting().notes = updated; change(); renderNotes(); api.success('比較条件とメモを保存しました', image ? '' : '画像が大きいため、数値と条件を保存しました。');
            });
            panel.querySelectorAll('[data-note-jump]').forEach(b => b.onclick = () => run(async () => {
                const n = setting().notes[Number(b.dataset.noteJump)];
                if (n.files.length !== Object.keys(s.files).length || n.files.some(f => !Object.values(s.files).some(x => x.name === f.name))) return api.warning('メモ時点のファイルを読み込んでください', n.files.map(f => f.name).join('、'));
                const settings = { ...n.context.settings, fileInfos: n.files, comparison: { ...setting(), matches: n.context.matches || {}, align: n.context.align || {} } };
                await api.applyComparison(settings); rawTime = !!n.context.rawTime; $('compare-raw').checked = rawTime; await api.ensure(); selectRange([n.t0, n.t1]); zoom([n.t0, n.t1]); change();
            }));
            panel.querySelectorAll('[data-note-remove]').forEach(b => b.onclick = () => { setting().notes = setting().notes.filter((_, i) => i !== Number(b.dataset.noteRemove)); change(); renderNotes(); });
            $('compare-report').onclick = api.report;
            const getName = () => $('compare-template-name').value.trim() || '比較テンプレート';
            $('compare-template-save').onclick = () => run(() => { const t = template(getName()); storeTemplates([...templates.filter(x => x.name !== t.name), t]); change(); renderNotes(); api.success('テンプレートを保存しました'); });
            $('compare-template-export').onclick = () => download('comparison-template.json', JSON.stringify(template(getName()), null, 2));
            $('compare-template-apply').onclick = () => run(async () => { if ($('compare-template-select').value === '') return; await applyTemplate(templates[Number($('compare-template-select').value)]); });
            $('compare-template-delete').onclick = () => run(() => { if ($('compare-template-select').value === '') return; storeTemplates(templates.filter((_, i) => i !== Number($('compare-template-select').value))); change(); renderNotes(); });
            $('compare-template-import').onchange = e => run(async () => { const file = e.target.files[0]; if (!file) return; if (file.size > 2000000) throw new Error('テンプレートは2MB以下のJSONを指定してください'); await applyTemplate(JSON.parse(await file.text())); });
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
        $('column-search').addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); const top = document.querySelector('.col-item-top'); top?.focus(); if (e.key === 'Enter') top?.click(); } });
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
                    for (const fid of files) { const key = `${id}::${fid}`; order.push(key); groups.set(key, { ...group, id: key, caption: label(s.files[fid]), series: group.series.filter(x => x.fileId === fid) }); }
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
        function schedule() {
            if (raf !== null) return;
            raf = requestAnimationFrame(() => {
                raf = null;
                if (selection && selectionMain !== api.main()) { selection = null; action.classList.add('hidden'); }
                const key = JSON.stringify([Object.entries(s.files).map(([id, f]) => [id, f.role, f.offset, f.columns.length]), [...s.selectedNames], setting().matches, setting().labels, rawTime]);
                if (key !== structure) { generation++; busy = false; preview = null; pick = null; rows = []; structure = key; renderPanel(); }
                $('compare-status').textContent = `${Object.keys(s.files).length} ファイル · ${s.selectedNames.size} チャンネル`;
                bar.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === setting().view); b.setAttribute('aria-pressed', String(b.dataset.view === setting().view)); b.disabled = b.dataset.view !== 'overlay' && !api.subIds().length; });
                $('compare-view-hint').textContent = setting().view === 'diff' ? '基準 − 比較 / 単位一致のみ / Y軸自動' : rawTime ? '元の時刻（時刻合わせを使う計算線は非表示）' : '時間軸はすべて連動';
                main.classList.toggle('compare-view-diff', setting().view === 'diff');
                document.querySelector('.sidebar').classList.toggle('compare-view-diff', setting().view === 'diff');
                $('arrange-mode-btn').disabled = setting().view !== 'overlay' || !s.selectedNames.size;
                if (s.measure.tA !== null && s.measure.tB !== null) { const r = [s.measure.tA, s.measure.tB].sort((a, b) => a - b); if (!selection || r[0] !== selection[0] || r[1] !== selection[1]) selectRange(r); }
                drawOverview();
            });
        }
        function bindChart() {
            s.chart.on('datazoom', () => { rows = []; if ($('compare-results-status')) $('compare-results-status').textContent = '表示区間が変わりました。「比較を更新」で再計算できます。'; showRows(); schedule(); });
            s.chart.on('updateAxisPointer', e => { const x = e.axesInfo?.find(a => a.axisDim === 'x'); if (x) cursor(Number(x.value)); });
        }
        renderPanel(); applyLayout();
        return { schedule, bindChart, label, effectiveOffset, transformGroups, filterColumn, decorateChannel, reportHTML,
            selectionRange: () => selection,
            selectRange, openAlign: id => { selectedSub = id; setPane('align'); },
            brush: r => { if (!intervalMode) return false; intervalMode = false; selectRange(r); return true; },
            changedSettings: () => { generation++; preview = null; rows = []; structure = ''; schedule(); },
            clear: () => { generation++; selection = null; rows = []; preview = null; action.classList.add('hidden'); overviewKey = ''; schedule(); } };
    };
})(window);
