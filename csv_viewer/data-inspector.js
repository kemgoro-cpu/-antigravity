/* Original samples, quality diagnostics and statistics for the shared analysis scope. */
(function (root) {
    'use strict';
    function init(api) {
        const doc = document, Q = root.CSVDataQuality, esc = api.esc;
        const PAGE_SIZE = 100, DETAIL_LIMIT = 1000, TABS = ['data', 'quality', 'stats'];
        const finite = Number.isFinite, fmt = n => finite(n) ? String(n) : '—';
        const ids = new WeakMap(); let nextId = 0;
        const refId = value => { if (!value || typeof value !== 'object') return ''; if (!ids.has(value)) ids.set(value, ++nextId); return ids.get(value); };
        let settings = { open: false, tab: 'data', fileName: '', fileKey: '' }, selectedId = '', pendingFileName = '', pendingFileKey = '', selectionNotice = '';
        let frame = null, generation = 0, activeKey = '', completedKey = '', page = 0, cursor = null, snapshot = null;
        let quality = null, detailFilter = 'all', queuedSeek = null, lastFileRef = null;
        const timeCache = new WeakMap();
        const panel = doc.createElement('section'); panel.id = 'data-inspector'; panel.className = 'data-inspector'; panel.hidden = true;
        panel.setAttribute('aria-label', '調べる：元データ・品質・統計');
        panel.innerHTML = `<div class="inspector-heading"><div class="inspector-tabs" role="tablist" aria-label="確認する内容"><button type="button" id="inspector-tab-data" role="tab" aria-controls="inspector-content" data-inspector-tab="data">元データ</button><button type="button" id="inspector-tab-quality" role="tab" aria-controls="inspector-content" data-inspector-tab="quality">品質診断</button><button type="button" id="inspector-tab-stats" role="tab" aria-controls="inspector-content" data-inspector-tab="stats">統計</button></div><label class="inspector-file-label">ファイル <select id="inspector-file" aria-label="元データ・品質診断のファイル"></select></label><button type="button" id="inspector-refresh" class="btn-secondary">更新</button><button type="button" id="inspector-close" class="btn-secondary" aria-label="調べるパネルを閉じる">閉じる</button></div><p id="inspector-context" class="inspector-context"></p><p id="inspector-status" class="inspector-status" role="status"></p><div id="inspector-content" class="inspector-content" role="tabpanel"></div>`;
        const body = doc.querySelector('.compare-body');
        if (body) body.after(panel); else doc.querySelector('.main-content')?.append(panel);
        const bar = doc.querySelector('.analysis-context'), openButton = doc.createElement('button');
        openButton.type = 'button'; openButton.id = 'inspector-open';
        openButton.className = 'btn-secondary inspector-open'; openButton.textContent = '調べる';
        openButton.title = '元データ・品質診断・統計を確認します';
        openButton.setAttribute('aria-controls', panel.id); openButton.setAttribute('aria-expanded', 'false');
        openButton.addEventListener('click', () => setOpen(settings.open ? false : settings.tab)); bar?.append(openButton);
        const $ = id => panel.querySelector('#' + id), content = $('inspector-content');
        const setStatus = text => { $('inspector-status').textContent = text || ''; };
        function currentFile() { return api.state.files[selectedId] || null; }
        const fileKey = file => { const key = file && api.fileKey?.(file); return typeof key === 'string' ? key : ''; };
        function dataOf(file, column) { return (file.colData || file.data || {})[column.id]; }
        function updateControls() {
            panel.hidden = !settings.open;
            openButton.classList.toggle('btn-active', settings.open); openButton.setAttribute('aria-expanded', String(settings.open));
            panel.querySelector('.inspector-file-label').hidden = settings.tab === 'stats';
            for (const button of panel.querySelectorAll('[data-inspector-tab]')) {
                const selected = button.dataset.inspectorTab === settings.tab;
                button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected));
                button.tabIndex = selected ? 0 : -1;
            }
            content.setAttribute('aria-labelledby', 'inspector-tab-' + settings.tab);
        }
        function syncFiles() {
            const files = Object.entries(api.state.files || {}), select = $('inspector-file');
            const restoring = api.isRestoring ? api.isRestoring() : !!api.state.parseJobs?.size;
            if (!api.state.files[selectedId] && selectedId && settings.fileKey) pendingFileKey = settings.fileKey;
            if (pendingFileKey) {
                // A filename is not an identity. Never resolve a missing key to
                // an earlier-finishing same-named file during session restore.
                const matches = files.filter(([, f]) => fileKey(f) === pendingFileKey);
                selectedId = matches.length === 1 ? matches[0][0] : '';
                if (selectedId) { pendingFileKey = ''; pendingFileName = ''; }
            } else if (pendingFileName) {
                // Legacy name-only settings are resolved after restoration so
                // temporary uniqueness cannot select one of two duplicate names.
                const matches = restoring ? [] : files.filter(([, f]) => f.name === pendingFileName);
                selectedId = matches.length === 1 ? matches[0][0] : '';
                if (selectedId) pendingFileName = '';
            } else if (!api.state.files[selectedId]) {
                selectedId = files.find(([, f]) => f === api.mainFile())?.[0] || files[0]?.[0] || '';
            }
            selectionNotice = !selectedId && (pendingFileKey || pendingFileName)
                ? restoring ? '保存したファイルの復元を待っています…'
                    : '保存したファイルを特定できません。ファイル欄で対象を選び直してください。同じ名前の別ファイルは自動選択しません。'
                : '';
            const signature = files.map(([id, f]) => id + ':' + f.name + ':' + fileKey(f)).join('\n') + '|' + selectionNotice;
            if (select.dataset.signature !== signature) {
                select.replaceChildren(); select.dataset.signature = signature;
                const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.disabled = true;
                placeholder.textContent = selectionNotice && restoring ? '保存したファイルを復元中…' : 'ファイルを選択してください'; select.append(placeholder);
                files.forEach(([id, file], i) => { const option = doc.createElement('option'); option.value = id; option.textContent = `${i + 1}. ${file.name}`; select.append(option); });
            }
            select.value = selectedId; select.disabled = !files.length;
            if (currentFile() && !pendingFileKey && !pendingFileName) {
                const name = currentFile().name, key = fileKey(currentFile());
                if (settings.fileName !== name || settings.fileKey !== key) {
                    settings.fileName = name; settings.fileKey = key;
                    // Persist resolved legacy identities even when the user
                    // performs no further action after restoration.
                    api.save();
                }
            }
        }
        function capture() {
            const file = currentFile(), context = api.analysisContext(), names = [...api.selectedNames()];
            const offset = file ? api.effectiveOffset(file) : 0, columns = [], unavailable = [], excluded = [], seen = new Set();
            if (file) for (const name of names) {
                const column = api.resolveColumn(file, name);
                if (!column) { unavailable.push(name); continue; }
                if (context.rawTime && column.isCrossFile) { excluded.push(name); continue; }
                if (!seen.has(column.id)) { seen.add(column.id); columns.push(column); }
            }
            const identity = JSON.stringify([selectedId, refId(file), refId(file?.timeData), refId(file?.sourceRowNumbers),
                file?.timeData?.length, file?.timeData?.[0], file?.timeData?.[file.timeData.length - 1], file?.headerInfo?.timeScale,
                names, columns.map(c => [c.id, c.name, c.unit, !!c.isCustom, !!c.isCrossFile]), context, offset,
                (api.state.customRAMs || []).map(c => [c.id, c.name, c.expr, c.unit])]);
            const key = identity + '|' + columns.map(c => `${refId(dataOf(file, c))}:${refId(file.columnDiagnostics?.[c.id])}`).join(',') + '|' + refId(file?.importDiagnostics);
            return { file, fileId: selectedId, context, offset, columns, unavailable, excluded, identity, key };
        }
        function includedIndices(s) {
            const time = s.file.timeData, range = s.context.range, indices = new Uint32Array(time.length);
            let count = 0, sorted = true, previous = -Infinity;
            if (!range || !range.every(finite) || !finite(s.offset)) return { indices: indices.subarray(0, 0), sorted };
            for (let i = 0; i < time.length; i++) {
                const t = time[i] + s.offset;
                if (!finite(t) || t < range[0] || t > range[1]) continue;
                if (t < previous) sorted = false;
                previous = t; indices[count++] = i;
            }
            return { indices: indices.subarray(0, count), sorted };
        }
        function sourceRow(file, i) { const n = file.sourceRowNumbers?.[i]; return Number.isSafeInteger(n) && n > 0 ? n : null; }
        function rawEntries(file, column) {
            const map = new Map();
            for (const row of file.columnDiagnostics?.[column.id]?.invalidValueRows || []) if (Number.isInteger(row.index)) map.set(row.index, row);
            return map;
        }
        function scopeNotes(s) {
            const notes = [];
            if (s.unavailable.length) notes.push('未対応チャンネル: ' + s.unavailable.join('、'));
            if (s.excluded.length) notes.push('元の時刻では時間合わせに依存する計算列を表示しません: ' + s.excluded.join('、'));
            if (!s.columns.length) notes.push('チャンネルを選ぶと数値列を確認できます。');
            return notes.join(' / ');
        }
        function renderData() {
            const s = snapshot;
            if (!s?.file) { content.innerHTML = `<p class="inspector-empty">${esc(selectionNotice || 'CSV / TRNを開くと、元データを確認できます。')}</p>`; return; }
            const total = s.indices.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            page = Math.min(Math.max(page, 0), pages - 1);
            const from = page * PAGE_SIZE, to = Math.min(total, from + PAGE_SIZE);
            const heads = s.columns.map(c => `<th scope="col" title="${esc(c.name)}">${esc(c.name)}<small>${esc(c.unit || '単位なし')}${c.isCustom ? ' · 計算値' : ''}</small></th>`).join('');
            const raw = s.columns.map(c => rawEntries(s.file, c));
            const rows = [];
            for (let position = from; position < to; position++) {
                const index = s.indices[position], time = s.file.timeData[index], current = cursor?.file === s.file && cursor.index === index;
                const cells = s.columns.map((c, ci) => {
                    const values = dataOf(s.file, c);
                    if (!values) return '<td class="inspector-missing">未読込</td>';
                    const value = values[index], invalid = raw[ci].get(index);
                    if (invalid) return `<td class="inspector-invalid" title="数値に変換できない元文字（保持は先頭80文字まで）">変換不能: <code>${esc(String(invalid.raw ?? ''))}</code></td>`;
                    return finite(value) ? `<td>${esc(String(value))}</td>` : '<td class="inspector-missing">欠損</td>';
                }).join('');
                const rowNumber = sourceRow(s.file, index);
                rows.push(`<tr data-sample-index="${index}"${current ? ' class="inspector-current" aria-current="location"' : ''}><td><button type="button" class="inspector-row-jump" data-sample-index="${index}" aria-label="元レコード${rowNumber ?? '不明'}、表示時刻${esc(fmt(time + s.offset))}秒を波形で確認">${rowNumber ?? '—'}</button></td><td>${esc(fmt(time))}</td><td>${esc(fmt(time + s.offset))}</td>${cells}</tr>`);
            }
            const notes = scopeNotes(s);
            content.innerHTML = `<div class="inspector-table-tools"><span>${total ? `${from + 1}–${to} / ${total.toLocaleString('ja-JP')} サンプル` : '対象区間にサンプルがありません'}</span><div><button type="button" id="inspector-prev-page"${page === 0 ? ' disabled' : ''}>前</button><label>ページ <input id="inspector-page" type="number" min="1" max="${pages}" value="${page + 1}" aria-label="元データのページ"></label><span>/ ${pages}</span><button type="button" id="inspector-next-page"${page + 1 >= pages ? ' disabled' : ''}>次</button></div></div><p class="inspector-note">元レコードは空行を除く1始まりの番号です（物理行番号ではありません）。元時刻は秒換算済み。表示時刻＝元時刻＋時間補正。値は読込済みの原サンプル／計算列の値で、補間しません。</p>${notes ? `<p class="inspector-note inspector-warning">${esc(notes)}</p>` : ''}<div class="inspector-table-scroll"><table id="inspector-sample-table"><thead><tr><th scope="col">元レコード</th><th scope="col">元時刻 [s]</th><th scope="col">表示時刻 [s]</th>${heads}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
            $('inspector-prev-page').onclick = () => { page--; renderData(); };
            $('inspector-next-page').onclick = () => { page++; renderData(); };
            const pageInput = $('inspector-page');
            const changePage = () => { const p = Number(pageInput.value); if (Number.isInteger(p) && p >= 1 && p <= pages) { page = p - 1; renderData(); } else { pageInput.value = String(page + 1); setStatus(`ページは1〜${pages}で指定してください。`); } };
            pageInput.onchange = changePage; pageInput.onkeydown = event => { if (event.key === 'Enter') changePage(); };
        }
        function analyze(s, force) {
            const timeKey = [refId(s.file.sourceRowNumbers), refId(s.file.importDiagnostics), s.file.headerInfo?.timeScale,
                s.file.timeData.length, s.file.timeData[0], s.file.timeData[s.file.timeData.length - 1]].join(':');
            let cached = timeCache.get(s.file.timeData);
            if (force || !cached || cached.key !== timeKey) {
                const d = s.file.importDiagnostics || {};
                cached = { key: timeKey, result: Q.analyzeTime(s.file.timeData, { sourceRowNumbers: s.file.sourceRowNumbers,
                    invalidTimeCount: d.invalidTimeCount, invalidTimeRows: d.invalidTimeRows, maxIssues: DETAIL_LIMIT }) };
                timeCache.set(s.file.timeData, cached);
            }
            const time = cached.result, valueRows = [], valueIssues = [], invalidIssues = [];
            const invalidTimeDetails = new Map((s.file.importDiagnostics?.invalidTimeDetails || []).map(r => [r.sourceRow, r.raw]));
            const timeIssues = time.issues.map(issue => ({ ...issue, channel: '時刻', raw: issue.origin === 'import' ? invalidTimeDetails.get(issue.sourceRow) : undefined,
                displayTime: finite(issue.time) ? issue.time + s.offset : null }));
            let valueIssueCount = 0, invalidDetailCount = 0;
            for (const column of s.columns) {
                const values = dataOf(s.file, column), diagnostics = s.file.columnDiagnostics?.[column.id] || {}, raw = rawEntries(s.file, column);
                if (!values) { valueRows.push({ column, unavailable: true }); continue; }
                // A missing range means no selected interval, not the entire file.
                const result = s.context.range ? Q.analyzeValues(s.file.timeData, values, { range: s.context.range,
                    offset: s.offset, sourceRowNumbers: s.file.sourceRowNumbers, maxIssues: DETAIL_LIMIT }) : Q.analyzeValues([], []);
                valueRows.push({ column, result, diagnostics }); valueIssueCount += result.issueCount;
                for (const issue of result.issues) {
                    const invalid = raw.get(issue.index);
                    if (!invalid && valueIssues.length < DETAIL_LIMIT) valueIssues.push({ ...issue, channel: column.name, displayTime: issue.time });
                }
                for (const invalid of raw.values()) {
                    const t = s.file.timeData[invalid.index] + s.offset, range = s.context.range;
                    if (!range || !finite(t) || t < range[0] || t > range[1]) continue;
                    invalidDetailCount++;
                    if (invalidIssues.length < DETAIL_LIMIT) invalidIssues.push({ kind: 'invalid-value', channel: column.name,
                        index: invalid.index, sourceRow: invalid.sourceRow, raw: invalid.raw, displayTime: t });
                }
            }
            return { time, valueRows, timeIssues, valueIssues, invalidIssues, valueIssueCount, invalidDetailCount };
        }
        function issueLabel(issue) {
            return { 'duplicate-time': '重複時刻', 'reverse-time': '時刻逆転', 'large-gap': '長い間隔（欠落候補）',
                'invalid-time': issue.origin === 'import' ? '読込時に除外した時刻' : '非有限の時刻',
                'invalid-interval': '時刻差を計算できない', 'missing-value': '欠損・非有限値', 'invalid-value': '数値へ変換不能' }[issue.kind] || issue.kind;
        }
        let displayedIssues = [];
        function renderQuality() {
            const s = snapshot, q = quality;
            if (!s?.file || !q) { content.innerHTML = `<p class="inspector-empty">${esc(selectionNotice || 'CSV / TRNを開き、チャンネルを選ぶと品質を確認できます。')}</p>`; return; }
            const t = q.time, cards = [['時刻サンプル', t.count], ['重複（2回目以降）', t.duplicateCount], ['隣接時刻の逆転', t.reverseCount], ['長い間隔（候補）', t.largeGapCount], ['除外・非有限時刻', t.invalidTimeCount]];
            const stats = q.valueRows.map(row => {
                const c = row.column, r = row.result;
                if (row.unavailable) return `<tr><th scope="row">${esc(c.name)}</th><td colspan="7">未読込です。「更新」で再試行してください。</td></tr>`;
                return `<tr><th scope="row">${esc(c.name)}<small>${esc(c.unit || '単位なし')}${c.isCustom ? ' · 計算値' : ''}</small></th><td>${r.sampleCount}</td><td>${r.validCount}</td><td>${r.missingCount} (${r.missingRate === null ? '—' : (r.missingRate * 100).toFixed(1) + '%'})</td><td>${row.diagnostics.invalidValueCount ?? (c.isCustom ? '対象外' : '未記録')}</td><td>${esc(fmt(r.min))}</td><td>${esc(fmt(r.max))}</td><td>${r.validCount === 0 ? '有効点なし' : r.validCount === 1 ? '有効1点（判定材料不足）' : r.constant ? '一定値（要確認）' : '変化あり'}</td></tr>`;
            }).join('');
            const source = detailFilter === 'time' ? q.timeIssues : detailFilter === 'values' ? q.valueIssues : detailFilter === 'invalid' ? q.invalidIssues : [...q.timeIssues, ...q.valueIssues, ...q.invalidIssues];
            displayedIssues = source.slice(0, DETAIL_LIMIT);
            const totalKnown = detailFilter === 'time' ? t.issueCount : detailFilter === 'values' ? q.valueIssueCount : detailFilter === 'invalid' ? q.invalidDetailCount : t.issueCount + q.valueIssueCount;
            const details = displayedIssues.map((issue, i) => {
                const canJump = Number.isInteger(issue.index) && finite(issue.displayTime);
                const inRange = snapshot.context.range && issue.displayTime >= snapshot.context.range[0] && issue.displayTime <= snapshot.context.range[1];
                const raw = issue.raw !== undefined ? `<code>${esc(String(issue.raw))}</code>` : issue.kind === 'invalid-time' && issue.origin === 'import' ? '元文字未保持' : '';
                const extra = issue.kind === 'large-gap' ? `間隔 ${fmt(issue.interval)} s` : issue.kind === 'reverse-time' ? `直前 ${fmt(issue.previousTime)} s` : raw;
                return `<tr><td>${esc(issueLabel(issue))}</td><td>${esc(issue.channel)}</td><td>${esc(String(issue.sourceRow ?? '—'))}</td><td>${esc(fmt(issue.displayTime))}</td><td>${issue.raw !== undefined || (issue.kind === 'invalid-time' && issue.origin === 'import') ? raw : esc(extra)}</td><td>${canJump ? `<button type="button" data-inspector-issue="${i}" class="inspector-issue-jump">${inRange ? '元データへ' : '波形へ'}</button>` : '波形なし'}</td></tr>`;
            }).join('');
            content.innerHTML = `<p class="inspector-note"><strong>時刻品質はファイル全体</strong>、値の品質は<strong>${esc(s.context.label)}</strong>の選択チャンネルです。重複は非隣接も含む2回目以降、逆転は隣接点を数えます。元レコード番号は空行を除くレコードの番号です。</p><div class="inspector-quality-counts">${cards.map(([name, value]) => `<div><span>${esc(name)}</span><strong>${value.toLocaleString('ja-JP')}</strong></div>`).join('')}</div><p class="inspector-note">長い間隔は正の隣接間隔の中央値 ${esc(fmt(t.typicalInterval))} s × ${t.gapFactor}（${esc(fmt(t.gapThreshold))} s超）を目安にした候補です。計測欠落と断定しません。</p><div class="inspector-table-scroll"><table id="inspector-quality-values"><thead><tr><th>選択チャンネル</th><th>対象点</th><th>有効点</th><th>欠損合計<br>変換不能を含む</th><th>変換不能<br>ファイル全体</th><th>最小</th><th>最大</th><th>値の状態</th></tr></thead><tbody>${stats}</tbody></table></div><p class="inspector-note">一定値は正常な状態保持でも発生します。欠損は0と扱いません。変換不能の原文と時刻の除外明細は先頭${DETAIL_LIMIT}件まで保持されるため、区間内の内訳を確定できない場合があります。${esc(scopeNotes(s))}</p><div class="inspector-detail-tools"><label>問題の詳細 <select id="inspector-issue-filter"><option value="all">すべて</option><option value="time">時刻品質（全体）</option><option value="values">欠損・非有限値（対象区間）</option><option value="invalid">変換不能の保持明細（対象区間）</option></select></label><span>${displayedIssues.length}件表示 / ${detailFilter === 'values' ? '変換不能を含む欠損合計 ' : detailFilter === 'invalid' ? '区間内の保持明細 ' : '検出 '}${totalKnown.toLocaleString('ja-JP')}件（表示上限${DETAIL_LIMIT}件）</span></div><div class="inspector-table-scroll"><table id="inspector-quality-issues"><thead><tr><th>種類</th><th>チャンネル</th><th>元レコード</th><th>表示時刻 [s]</th><th>詳細・元文字</th><th>移動</th></tr></thead><tbody>${details || '<tr><td colspan="6">表示できる問題の明細はありません。上の件数と対象範囲も確認してください。</td></tr>'}</tbody></table></div>`;
            $('inspector-issue-filter').value = detailFilter;
            $('inspector-issue-filter').onchange = event => { detailFilter = event.target.value; renderQuality(); };
            if (t.duplicateCount || t.reverseCount) {
                const warning = doc.createElement('p'); warning.className = 'inspector-note inspector-warning';
                warning.textContent = '重複・逆転時刻があるため、補間を使う比較では未評価になります。元レコードを確認してください。';
                content.prepend(warning);
            }
        }
        function renderStats() {
            const context = api.analysisContext();
            $('inspector-context').textContent = context.label;
            content.innerHTML = `<div id="inspector-statistics" class="inspector-statistics"><p class="inspector-note">表示中の全ファイル・チャンネルを集計します。数値は有効サンプルの等重み統計です。元データ・品質診断のファイル選択とは独立しています。</p>${api.statsHTML?.(context) || '<p class="inspector-empty">チャンネルを選ぶと統計を確認できます。</p>'}</div>`;
        }
        function renderTab() { updateControls(); if (settings.tab === 'quality') renderQuality(); else if (settings.tab === 'stats') renderStats(); else renderData(); }
        function revealSelectedRow() {
            const selected = cursor;
            requestAnimationFrame(() => {
                if (!settings.open || settings.tab !== 'data' || cursor !== selected || !selected) return;
                const row = content.querySelector(`tr[data-sample-index="${selected.index}"]`);
                if (!row) return;
                const rowRect = row.getBoundingClientRect(), viewport = content.getBoundingClientRect();
                const headerHeight = content.querySelector('thead')?.getBoundingClientRect().height || 0;
                // Scroll only the inspector. scrollIntoView would also move the page/chart.
                const top = viewport.top + Math.min(headerHeight, viewport.height / 2);
                if (rowRect.top < top) content.scrollTop += rowRect.top - top;
                else if (rowRect.bottom > viewport.bottom) content.scrollTop += rowRect.bottom - viewport.bottom;
            });
        }
        function positionOf(index) {
            if (!snapshot) return -1;
            for (let i = 0; i < snapshot.indices.length; i++) if (snapshot.indices[i] === index) return i;
            return -1;
        }
        function selectSample(index, navigate = true) {
            const s = snapshot, position = positionOf(index);
            if (!s || position < 0) { setStatus('この点は解析対象外です。解析対象を「全体」にすると確認できます。'); return false; }
            cursor = { fileId: s.fileId, file: s.file, index }; page = Math.floor(position / PAGE_SIZE);
            setStatus(`元レコード ${sourceRow(s.file, index) ?? '不明'}、表示時刻 ${fmt(s.file.timeData[index] + s.offset)} sを選択しました。`);
            renderTab(); revealSelectedRow(); if (navigate) api.focusTime(s.file.timeData[index] + s.offset); api.render(); return true;
        }
        function nearestPosition(t) {
            const s = snapshot, a = s.indices;
            if (!a.length) return -1;
            if (s.sorted) {
                let lo = 0, hi = a.length;
                while (lo < hi) { const mid = (lo + hi) >>> 1; if (s.file.timeData[a[mid]] + s.offset < t) lo = mid + 1; else hi = mid; }
                if (!lo) return 0; if (lo === a.length) return lo - 1;
                return t - (s.file.timeData[a[lo - 1]] + s.offset) <= s.file.timeData[a[lo]] + s.offset - t ? lo - 1 : lo;
            }
            let best = 0, distance = Infinity;
            for (let i = 0; i < a.length; i++) { const d = Math.abs(s.file.timeData[a[i]] + s.offset - t); if (d < distance) { best = i; distance = d; } }
            return best;
        }
        function seekTime(t) {
            if (!settings.open || settings.tab === 'stats' || !finite(t)) return false;
            if (!snapshot || activeKey) { queuedSeek = { time: t }; schedule(); return false; }
            const range = snapshot.context.range;
            if (!range || t < range[0] || t > range[1]) { setStatus('指定時刻は共通の解析対象外です。解析対象を変更してから確認してください。'); return false; }
            const position = nearestPosition(t);
            if (position < 0) { setStatus('対象区間に実サンプルがありません。補間せず、点のある区間を選んでください。'); return false; }
            if (settings.tab !== 'data') { settings.tab = 'data'; api.save(); }
            return selectSample(snapshot.indices[position], false);
        }
        async function refresh(force = false) {
            syncFiles(); updateControls();
            if (!settings.open) return;
            if (settings.tab === 'stats') {
                // Statistics use the existing rendered-series collector, including every
                // visible file. They must not load/filter by the sample-table file.
                setStatus(''); content.setAttribute('aria-busy', 'false'); renderStats(); return;
            }
            const initial = capture();
            $('inspector-context').textContent = initial.context.label;
            if (!initial.file) {
                generation++; activeKey = ''; completedKey = ''; snapshot = null; quality = null; cursor = null;
                content.setAttribute('aria-busy', 'false'); setStatus(selectionNotice); renderTab(); return;
            }
            if (!force && (initial.key === completedKey || initial.key === activeKey)) return;
            const token = ++generation; activeKey = initial.key; content.setAttribute('aria-busy', 'true');
            if (initial.columns.some(c => !dataOf(initial.file, c))) setStatus('選択したチャンネルを読み込んでいます…');
            try {
                const needed = initial.columns.filter(c => !dataOf(initial.file, c)).map(c => c.name);
                if (needed.length) await api.loadColumns(initial.file, needed);
                if (token !== generation || !settings.open) return;
                const fresh = capture();
                if (fresh.identity !== initial.identity) { activeKey = ''; schedule(); return; }
                if (lastFileRef !== fresh.file) { cursor = null; page = 0; lastFileRef = fresh.file; }
                snapshot = { ...fresh, ...includedIndices(fresh) };
                // Compute quality only while requested; switching back uses the same scan key.
                quality = settings.tab === 'quality' ? analyze(snapshot, force) : null;
                if (cursor && (cursor.file !== snapshot.file || (positionOf(cursor.index) < 0 && !cursor.allowOutside))) { cursor = null; api.render(); }
                const cursorPosition = cursor ? positionOf(cursor.index) : -1;
                page = cursorPosition >= 0 ? Math.floor(cursorPosition / PAGE_SIZE) : Math.min(page, Math.max(0, Math.ceil(snapshot.indices.length / PAGE_SIZE) - 1));
                completedKey = fresh.key; activeKey = '';
                setStatus(cursor?.allowOutside && cursorPosition < 0 ? '解析対象外の時刻品質を波形で示しています。表は共通の解析範囲を維持しています。' : ''); renderTab();
                if (queuedSeek) { const seek = queuedSeek; queuedSeek = null; if (seek.file === snapshot.file && Number.isInteger(seek.index)) selectSample(seek.index, false); else if (finite(seek.time)) seekTime(seek.time); }
            } catch (error) {
                if (token === generation) { activeKey = ''; completedKey = ''; setStatus('確認データを読み込めませんでした。「更新」で再試行してください。' + (error?.message ? ` ${error.message}` : '')); }
            } finally { if (token === generation) content.setAttribute('aria-busy', 'false'); }
        }
        function schedule() {
            if (frame !== null) return;
            frame = requestAnimationFrame(() => { frame = null; refresh(false); });
        }
        function setOpen(tab) {
            const wasOpen = settings.open;
            if (tab === false || tab === null) {
                settings.open = false; generation++; activeKey = ''; completedKey = ''; cursor = null; queuedSeek = null; updateControls(); api.render();
                if (wasOpen) api.resize?.(); api.save(); openButton.focus(); return;
            }
            const nextTab = TABS.includes(tab) ? tab : 'data';
            if (settings.tab !== nextTab) { generation++; activeKey = ''; completedKey = ''; queuedSeek = null; content.scrollTop = 0; }
            settings.open = true; settings.tab = nextTab; updateControls(); schedule(); api.save();
            if (!wasOpen) api.resize?.();
        }
        panel.querySelectorAll('[data-inspector-tab]').forEach(button => {
            button.onclick = () => setOpen(button.dataset.inspectorTab);
            button.onkeydown = event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1
                    : (TABS.indexOf(settings.tab) + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
                setOpen(TABS[index]); $('inspector-tab-' + settings.tab).focus();
            };
        });
        $('inspector-close').onclick = () => setOpen(false);
        $('inspector-refresh').onclick = () => { completedKey = ''; refresh(true); };
        $('inspector-file').onchange = event => {
            selectedId = event.target.value; pendingFileName = ''; pendingFileKey = ''; selectionNotice = '';
            settings.fileName = currentFile()?.name || ''; settings.fileKey = fileKey(currentFile());
            cursor = null; page = 0; completedKey = ''; content.scrollTop = 0; api.save(); api.render(); schedule();
        };
        content.addEventListener('click', event => {
            const issueButton = event.target.closest('[data-inspector-issue]');
            if (issueButton) {
                const issue = displayedIssues[Number(issueButton.dataset.inspectorIssue)]; if (!issue || !snapshot) return;
                const range = snapshot.context.range;
                if (!range || issue.displayTime < range[0] || issue.displayTime > range[1]) {
                    cursor = { fileId: snapshot.fileId, file: snapshot.file, index: issue.index, allowOutside: true };
                    api.focusTime(issue.displayTime); api.render();
                    setStatus('解析対象外の時刻品質を波形で示しています。表は共通の解析範囲を維持しています。'); return;
                }
                queuedSeek = { file: snapshot.file, index: issue.index }; settings.tab = 'data'; completedKey = '';
                api.focusTime(issue.displayTime); api.save(); schedule(); return;
            }
            const row = event.target.closest('[data-sample-index]'); if (row) selectSample(Number(row.dataset.sampleIndex));
        });
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } });
        updateControls();
        return {
            schedule, setOpen, seekTime,
            collectSettings: () => ({ open: settings.open, tab: settings.tab, fileName: settings.fileName, fileKey: settings.fileKey }),
            applySettings: input => {
                const s = input && typeof input === 'object' ? input : {};
                settings = { open: s.open === true, tab: TABS.includes(s.tab) ? s.tab : 'data', fileName: typeof s.fileName === 'string' ? s.fileName : '', fileKey: typeof s.fileKey === 'string' ? s.fileKey : '' };
                pendingFileName = settings.fileName; pendingFileKey = settings.fileKey; selectedId = ''; cursor = null; snapshot = null; quality = null;
                generation++; activeKey = ''; completedKey = ''; updateControls(); schedule(); api.resize?.();
            },
            cursorTime: () => settings.open && cursor && api.state.files[cursor.fileId] === cursor.file && finite(cursor.file.timeData[cursor.index])
                ? cursor.file.timeData[cursor.index] + api.effectiveOffset(cursor.file) : null,
            clear: () => { generation++; settings = { open: false, tab: 'data', fileName: '', fileKey: '' }; selectedId = ''; pendingFileName = ''; pendingFileKey = ''; selectionNotice = ''; cursor = null; snapshot = null; quality = null; queuedSeek = null; activeKey = ''; completedKey = ''; page = 0; setStatus(''); updateControls(); api.resize?.(); },
        };
    }
    const api = { init };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CSVDataInspector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
