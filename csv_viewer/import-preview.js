(function (root) {
    'use strict';
    let api;
    const $ = id => document.getElementById(id);
    const normalize = value => root.CSVUtils.normalizeImportOptions(value);
    const encodings = [['auto', '自動'], ['utf-8', 'UTF-8'], ['shift-jis', 'Shift_JIS'], ['utf-16le', 'UTF-16LE'], ['utf-16be', 'UTF-16BE']];
    const delimiters = [['auto', '自動'], [',', 'カンマ ,'], ['\t', 'タブ'], [';', 'セミコロン ;'], ['|', 'パイプ |']];
    const val = (id, fallback) => $(id)?.value ?? fallback;

    function collectSettings() {
        const timeValue = val('import-time-column', '');
        return {
            nameMode: val('import-name-mode', 'auto'),
            unitMode: val('import-unit-mode', 'auto'),
            timeColumn: timeValue === '' ? 'auto' : Number(timeValue) - 1,
            delimiter: val('import-delimiter', 'auto'),
            reviewBeforeLoad: !!$('import-review-before-load')?.checked,
        };
    }
    function getOptions() {
        return normalize({ ...collectSettings(), nameRow: Number(val('name-row-idx', 1)) - 1,
            unitRow: Number(val('unit-row-idx', 2)) - 1, encodingMode: val('encoding-mode', 'auto') });
    }
    function syncControls() {
        if ($('name-row-idx')) $('name-row-idx').disabled = val('import-name-mode', 'auto') !== 'manual';
        if ($('unit-row-idx')) $('unit-row-idx').disabled = val('import-unit-mode', 'auto') !== 'manual';
    }
    function applySettings(settings = {}) {
        const options = normalize(settings);
        for (const [id, value] of [['import-name-mode', options.nameMode], ['import-unit-mode', options.unitMode],
            ['import-time-column', options.timeColumn === 'auto' ? '' : options.timeColumn + 1], ['import-delimiter', options.delimiter]]) {
            if ($(id)) $(id).value = value;
        }
        if ($('import-review-before-load')) $('import-review-before-load').checked = settings.reviewBeforeLoad === true;
        syncControls();
    }
    function init(bridge) {
        api = bridge;
        for (const id of ['import-name-mode', 'import-unit-mode', 'import-time-column', 'import-delimiter',
            'import-review-before-load', 'name-row-idx', 'unit-row-idx']) {
            $(id)?.addEventListener('change', () => { syncControls(); api.onChange(); });
        }
        $('import-preview-open')?.addEventListener('click', () => $('import-preview-files').click());
        $('import-preview-files')?.addEventListener('change', event => {
            if (event.target.files.length) api.handleFiles(event.target.files, { review: true });
            event.target.value = '';
        });
        syncControls();
    }

    async function preview(entry) {
        const revision = ++entry.revision;
        const options = { ...entry.options };
        entry.pending = true;
        try {
            if (!entry.bytes) entry.bytes = new Uint8Array(await entry.file.slice(0, 256 * 1024).arrayBuffer());
            const encoding = options.encodingMode === 'auto' ? root.CSVUtils.detectTextEncoding(entry.bytes) : options.encodingMode;
            const decoded = root.CSVUtils.decodeBytes(entry.bytes, encoding);
            if (!decoded.ok) throw new Error('この文字コードで読み取れません。');
            const trn = /\.trn$/i.test(entry.file.name);
            // A sample ending mid-record is not used for header/data validation.
            let text = decoded.text;
            if (entry.file.size > entry.bytes.length) text = text.slice(0, Math.max(0, text.lastIndexOf('\n')));
            if (trn) text = root.CSVUtils.convertWhitespaceToTabs(text);
            const parsed = root.Papa.parse(text, { delimiter: trn ? '\t' : options.delimiter === 'auto' ? '' : options.delimiter,
                header: false, dynamicTyping: false, skipEmptyLines: true, preview: 50 });
            if (revision !== entry.revision) return;
            entry.raw = parsed.data;
            entry.layout = root.CSVUtils.resolveImportLayout(entry.raw, options);
            entry.encoding = encoding;
            entry.delimiter = parsed.meta.delimiter;
            entry.error = entry.layout.error;
            entry.trn = trn;
        } catch (error) {
            if (revision === entry.revision) entry.error = error.message;
        } finally {
            if (revision === entry.revision) entry.pending = false;
        }
    }

    function confirmFiles(files, defaults) {
        if (!api) return Promise.resolve(files.map(file => ({ file, options: normalize(defaults) })));
        const entries = files.map(file => ({ file, options: normalize(defaults), revision: 0, pending: true, error: '', raw: [] }));
        const esc = api.esc;
        const choices = values => values.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
        return new Promise(resolve => {
            let chosen = null, current = 0;
            const { modal, overlay, close } = api.createModal(`
                <h3 id="import-preview-title">読み込み前に設定を確認</h3>
                <p class="import-preview-intro">元ファイルは変更しません。ファイルごとに設定と先頭データを確認してから読み込みます。行番号は空行を除くCSVレコード番号です。</p>
                <label class="import-preview-file">確認するファイル <select id="import-preview-select">${entries.map((entry, i) => `<option value="${i}">${esc(entry.file.name)}</option>`).join('')}</select></label>
                <div class="import-preview-controls">
                    <label>文字コード<select id="ip-encoding">${choices(encodings)}</select></label>
                    <label>区切り<select id="ip-delimiter">${choices(delimiters)}</select></label>
                    <label>名前行<select id="ip-name-mode">${choices([['auto', '自動'], ['manual', '指定']])}</select><input id="ip-name-row" type="number" min="1" max="49" required aria-label="名前行番号"></label>
                    <label>単位行<select id="ip-unit-mode">${choices([['auto', '自動'], ['none', 'なし'], ['manual', '指定']])}</select><input id="ip-unit-row" type="number" min="1" max="49" required aria-label="単位行番号"></label>
                    <label>時間列<select id="ip-time"><option value="auto">自動</option></select></label>
                </div>
                <div id="import-preview-message" class="import-preview-message" role="status" aria-live="polite"></div>
                <div id="import-preview-table" class="import-preview-table" tabindex="0" aria-label="読み込み前の先頭データ"></div>
                <p class="import-preview-limit">先頭256 KiB・最大50レコードの確認です。全件の品質検査ではありません。TRNは空白・タブ・パイプ区切りを専用処理します。</p>
                <div class="import-preview-options"><button id="ip-copy-all" class="btn-secondary"${entries.length < 2 ? ' disabled' : ''}>この設定を全ファイルへ適用</button>
                <label><input type="checkbox" id="ip-use-default">この設定を次回の既定にする</label></div>
                <div class="import-preview-footer"><span id="ip-summary" role="status"></span><button id="ip-cancel" class="btn-secondary">キャンセル</button><button id="ip-confirm" class="btn-primary" disabled>${entries.length}ファイルを読み込む</button></div>`,
                { modalClass: 'import-preview-modal', labelledBy: 'import-preview-title', closeOnOverlayClick: false, onClose: () => resolve(chosen) });
            const el = id => modal.querySelector('#' + id);
            function summary() {
                if (!overlay.isConnected) return;
                const ready = entries.filter(entry => !entry.pending && !entry.error).length;
                el('ip-summary').textContent = `${ready} / ${entries.length} ファイルの取込設定が有効`;
                el('ip-confirm').disabled = ready !== entries.length;
                el('ip-copy-all').disabled = entries.length < 2 || entries[current].pending || !!entries[current].error;
                [...el('import-preview-select').options].forEach((option, i) => {
                    const entry = entries[i];
                    option.textContent = `${entry.pending ? '確認中' : entry.error ? '要訂正' : '設定有効'}: ${entry.file.name}`;
                });
            }
            function showResult() {
                if (!overlay.isConnected) return;
                const entry = entries[current], layout = entry.layout;
                summary();
                el('ip-confirm').disabled ||= !!el('ip-name-row').validationMessage || !!el('ip-unit-row').validationMessage;
                if (entry.pending) { el('import-preview-message').textContent = '先頭データを読み取っています…'; return; }
                const headers = entry.raw?.[layout?.nameRow] || [];
                el('ip-time').innerHTML = '<option value="auto">自動</option>' + headers.map((header, i) => `<option value="${i}">${i + 1}: ${esc(header || '名称なし')}</option>`).join('');
                el('ip-time').value = String(entry.options.timeColumn);
                el('ip-delimiter').disabled = entry.trn;
                const desc = entry.error || `名前 ${layout.nameRow + 1}行 / 単位 ${layout.unitRow < 0 ? 'なし' : (layout.unitRow + 1) + '行'} / データ開始 ${layout.dataStart + 1}行 / 時間列 ${layout.timeIdx + 1} / ${entry.encoding}`;
                el('import-preview-message').textContent = desc + (layout?.warnings.length ? '\n' + layout.warnings.join('\n') : '');
                el('import-preview-message').classList.toggle('has-error', !!entry.error);
                const rowIndices = [...new Set([0, 1, 2, layout?.nameRow, layout?.unitRow, ...Array.from({ length: 5 }, (_, i) => (layout?.dataStart ?? 0) + i)])]
                    .filter(i => Number.isInteger(i) && i >= 0 && i < entry.raw.length).sort((a, b) => a - b);
                el('import-preview-table').innerHTML = `<table><thead><tr><th>行 / 用途</th>${headers.slice(0, 20).map((_, i) => `<th>${i + 1}列${i === layout?.timeIdx ? '（時間）' : ''}</th>`).join('')}</tr></thead><tbody>${rowIndices.map(i => `<tr class="${i === layout?.nameRow ? 'is-header' : i === layout?.unitRow ? 'is-unit' : ''}"><th>${i + 1}${i === layout?.nameRow ? ' 名前' : i === layout?.unitRow ? ' 単位' : i === layout?.dataStart ? ' データ開始' : ''}</th>${entry.raw[i].slice(0, 20).map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${headers.length > 20 ? '<p>先頭20列を表示。時間列は上の一覧から全列を選べます。</p>' : ''}`;
            }
            function populate() {
                const opts = entries[current].options;
                for (const [id, value] of [['ip-encoding', opts.encodingMode], ['ip-delimiter', opts.delimiter], ['ip-name-mode', opts.nameMode],
                    ['ip-name-row', opts.nameRow + 1], ['ip-unit-mode', opts.unitMode], ['ip-unit-row', opts.unitRow + 1]]) el(id).value = value;
                el('ip-name-row').disabled = opts.nameMode !== 'manual';
                el('ip-unit-row').disabled = opts.unitMode !== 'manual';
                el('ip-use-default').checked = false;
                showResult();
            }
            function changed() {
                const entry = entries[current];
                entry.options = normalize({ encodingMode: el('ip-encoding').value, delimiter: el('ip-delimiter').value,
                    nameMode: el('ip-name-mode').value, nameRow: Number(el('ip-name-row').value) - 1,
                    unitMode: el('ip-unit-mode').value, unitRow: Number(el('ip-unit-row').value) - 1,
                    timeColumn: el('ip-time').value });
                el('ip-name-row').disabled = entry.options.nameMode !== 'manual';
                el('ip-unit-row').disabled = entry.options.unitMode !== 'manual';
                if (!el('ip-name-row').checkValidity() || !el('ip-unit-row').checkValidity()) {
                    entry.revision++; // Discard any preview started before the invalid edit.
                    entry.error = '行番号は1〜49の範囲で指定してください。'; entry.pending = false;
                    el('import-preview-message').textContent = entry.error; summary(); return;
                }
                const work = preview(entry); showResult(); work.then(showResult);
            }
            for (const id of ['ip-encoding', 'ip-delimiter', 'ip-name-mode', 'ip-name-row', 'ip-unit-mode', 'ip-unit-row', 'ip-time']) el(id).addEventListener('change', changed);
            el('import-preview-select').addEventListener('change', () => { current = Number(el('import-preview-select').value); populate(); });
            el('ip-copy-all').addEventListener('click', async () => {
                if (entries[current].pending || entries[current].error) return;
                const selected = entries[current].options;
                const work = Promise.all(entries.map(entry => { entry.options = { ...selected }; return preview(entry); }));
                showResult();
                await work;
                populate();
            });
            el('ip-cancel').addEventListener('click', close);
            el('ip-confirm').addEventListener('click', () => {
                if (entries.some(entry => entry.pending || entry.error) || !el('ip-name-row').checkValidity() || !el('ip-unit-row').checkValidity()) return;
                if (el('ip-use-default').checked) {
                    const opts = entries[current].options;
                    applySettings({ ...opts, reviewBeforeLoad: collectSettings().reviewBeforeLoad });
                    $('name-row-idx').value = opts.nameRow + 1; $('unit-row-idx').value = opts.unitRow + 1;
                    $('encoding-mode').value = opts.encodingMode; api.onChange();
                }
                chosen = entries.map(entry => ({ file: entry.file, options: { ...entry.options } })); close();
            });
            populate();
            Promise.all(entries.map(entry => preview(entry))).then(showResult);
        });
    }
    root.CSVImportPreview = { init, getOptions, collectSettings, applySettings, confirmFiles };
})(window);
