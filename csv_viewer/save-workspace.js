/* One save/reuse surface; persistence formats and numerical operations stay in the host. */
(function (root) {
    'use strict';
    root.CSVSaveWorkspace = function (api) {
        const $ = id => document.getElementById(id);
        const trigger = $('export-menu-btn'), host = $('export-menu-panel');
        const parking = document.createElement('div');
        parking.id = 'save-workspace-storage'; parking.hidden = true;
        document.body.appendChild(parking);
        let dialog = null, busy = false;
        const purposes = [
            ['output', '画像・数値・レポートを出力', 'PNG・画像コピー・基準CSV・HTMLレポートを出力します。HTMLには保存済みの比較メモも含みます。'],
            ['session', '今回の作業を再開', '設定JSONで現在の表示・比較条件・時間差・メモ等を保存・読み込みます。元のログ本体は含まれません。元ログは別に保管してください。'],
            ['template', '次の試験へ比較条件', '比較テンプレートで配置・信号・式・対応・許容差を再利用します。適用時は時間差を0へ戻し、現在のメモと表示名は保ちます。適用後に時間合わせと比較をやり直してください。'],
            ['favorite', 'チャンネルの組を再利用', 'お気に入りは列名と順序を保存します。適用すると表示チャンネルを置き換え、各信号を独立した段へ並べ直します。式・時間差・比較メモは置き換えません。'],
            ['preset', '読込・表示設定を再利用', 'プリセットは読込設定・信号・式・配置・軸範囲・比較設定をまとめて適用します。適用すると現在の比較メモをクリアします。必要なメモは先にHTMLレポート等へ保存してください。']
        ];
        const outputButtons = ['export-png-btn', 'copy-chart-btn', 'export-csv-btn', 'export-report-btn'].map($);
        const sessionButtons = ['export-settings-btn', 'import-settings-btn'].map($);
        const presetRow = $('settings-preset-select').closest('.preset-row');
        const favoriteRow = $('channel-fav-select').closest('.preset-row');
        // Move, never clone: legacy references/listeners and selected values remain valid.
        for (const node of [...outputButtons, ...sessionButtons, presetRow, favoriteRow]) parking.appendChild(node);
        host.className = 'save-workspace-content'; host.removeAttribute('role'); host.removeAttribute('aria-label');
        host.innerHTML = `<label class="save-purpose-label" for="save-purpose">目的を選ぶ</label><select id="save-purpose">${purposes.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select><p id="save-purpose-description" class="save-description"></p><p id="save-unavailable" class="save-unavailable" role="status" hidden></p>${purposes.map(([id, label]) => `<section data-save-purpose="${id}" aria-label="${label}" hidden></section>`).join('')}`;
        parking.appendChild(host);
        const section = purpose => host.querySelector(`[data-save-purpose="${purpose}"]`);
        for (const [purpose, buttons] of [['output', outputButtons], ['session', sessionButtons]]) {
            section(purpose).className = 'save-actions';
            for (const button of buttons) { button.removeAttribute('role'); section(purpose).appendChild(button); }
        }
        $('export-settings-btn').querySelector('span').textContent = '設定JSONを書き出す';
        $('import-settings-btn').querySelector('span').textContent = '設定JSONを読み込む';
        $('export-settings-btn').dataset.tipTitle = '設定JSONを書き出す';
        $('import-settings-btn').dataset.tipTitle = '設定JSONを読み込む';
        for (const [purpose, row, name] of [['preset', presetRow, '設定プリセット'], ['favorite', favoriteRow, 'チャンネルのお気に入り']]) {
            row.className = 'save-library-controls';
            const select = row.querySelector('select');
            const label = document.createElement('label'); label.className = 'save-library-label'; label.htmlFor = select.id; label.textContent = '保存済みの' + name;
            section(purpose).append(label, row);
            for (const button of row.querySelectorAll('button')) {
                button.classList.remove('btn-icon');
                const text = document.createElement('span');
                text.textContent = button.id.includes('save') ? '現在を保存' : button.id.includes('delete') ? '削除' : '適用';
                button.appendChild(text);
            }
        }
        section('template').innerHTML = `<label class="save-library-label" for="compare-template-name">テンプレート名</label><input id="compare-template-name" maxlength="100" placeholder="例：加速応答の比較"><div class="save-button-row"><button id="compare-template-save" class="btn-primary">保存</button><button id="compare-template-export" class="btn-secondary">現在の条件をJSON書き出し</button></div><label class="save-library-label" for="compare-template-select">保存済みテンプレート</label><select id="compare-template-select"><option value="">選択してください</option></select><div class="save-button-row"><button id="compare-template-apply" class="btn-secondary">新しいログに適用</button><button id="compare-template-delete" class="btn-secondary">削除</button></div><label class="save-library-label" for="compare-template-import">JSONを読み込んで適用</label><input id="compare-template-import" type="file" accept=".json"><p class="save-description">JSON読込は現在のログへ即時適用します。保存一覧への追加ではありません。JSON書き出しは、選択済みの保存内容ではなく現在の条件です。設定JSONとは別の形式です。</p>`;

        function refreshTemplates(preferred) {
            const select = $('compare-template-select'), selected = preferred === undefined ? select.value : String(preferred);
            select.replaceChildren(new Option('選択してください', ''));
            api.templates.list().forEach((template, index) => select.appendChild(new Option(template.name, String(index))));
            if ([...select.options].some(option => option.value === selected)) select.value = selected;
        }
        function syncAvailability() {
            const hasMain = !!api.main(), hasChannels = api.state.selectedNames.size > 0;
            const purpose = $('save-purpose').value;
            $('save-purpose').disabled = busy;
            host.querySelectorAll('[data-save-purpose]').forEach(element => { element.inert = busy; });
            const templateSelected = $('compare-template-select').value !== '';
            $('compare-template-save').disabled = busy || !hasMain;
            $('compare-template-export').disabled = busy || !hasMain;
            $('compare-template-apply').disabled = busy || !hasMain || !templateSelected;
            $('compare-template-delete').disabled = busy || !templateSelected;
            $('compare-template-import').disabled = busy || !hasMain;
            $('channel-fav-save').disabled = !hasChannels;
            $('channel-fav-apply').disabled = !hasMain || !$('channel-fav-select').value;
            $('channel-fav-delete').disabled = !$('channel-fav-select').value;
            $('preset-load-btn').disabled = !$('settings-preset-select').value;
            $('preset-delete-btn').disabled = !$('settings-preset-select').value;
            const reason = busy ? '比較条件を適用中です。完了を待ってください。'
                : purpose === 'output' && !api.state.numGrids ? 'ログを開き、表示チャンネルを選ぶと出力できます。'
                : purpose === 'template' && !hasMain ? '基準ログを開くと、比較条件の保存・書き出し・適用ができます。保存済み一覧の確認と削除は利用できます。'
                : purpose === 'favorite' && !hasMain ? '基準ログを開くとお気に入りを適用できます。保存済み一覧の確認と削除は利用できます。'
                : purpose === 'favorite' && !hasChannels ? '表示チャンネルを選ぶと、現在の組み合わせを保存できます。' : '';
            $('save-unavailable').textContent = reason; $('save-unavailable').hidden = !reason;
        }
        function showPurpose(value) {
            if (purposes.some(([id]) => id === value)) $('save-purpose').value = value;
            const current = purposes.find(([id]) => id === $('save-purpose').value);
            $('save-purpose-description').textContent = current[2];
            host.querySelectorAll('[data-save-purpose]').forEach(element => { element.hidden = element.dataset.savePurpose !== current[0]; });
            syncAvailability();
        }
        function close() { dialog?.close(); }
        function open(purpose) {
            if (dialog?.overlay.isConnected) { if (purpose) showPurpose(purpose); $('save-purpose').focus(); return; }
            // An outside modal may have removed the overlay before its observer ran.
            // Finish our cleanup synchronously before reusing the same host.
            if (dialog) dialog.close();
            api.refreshLibraries(); refreshTemplates(); showPurpose(purpose);
            const opened = api.modal('<div class="save-workspace-heading"><h2 id="save-workspace-title">保存・再利用</h2><button type="button" id="save-workspace-close" class="btn-secondary" aria-label="保存・再利用を閉じる">閉じる</button></div>', {
                labelledBy: 'save-workspace-title', initialFocus: '#save-purpose',
                onClose: () => {
                    if (dialog !== opened) return;
                    parking.appendChild(host); dialog = null; trigger.setAttribute('aria-expanded', 'false');
                }
            });
            dialog = opened; opened.modal.appendChild(host);
            $('save-workspace-close').onclick = close;
            trigger.setAttribute('aria-expanded', 'true');
        }
        async function runTemplate(action, closeAfter = false) {
            if (busy) return;
            const initiatingDialog = dialog;
            busy = true; syncAvailability();
            try { await action(); if (closeAfter && dialog === initiatingDialog) close(); }
            catch (error) { api.warning('比較テンプレートの操作を完了できませんでした', error.message); }
            finally { busy = false; syncAvailability(); }
        }
        const templateName = () => $('compare-template-name').value.trim() || '比較テンプレート';
        $('compare-template-save').onclick = () => runTemplate(() => { const index = api.templates.save(templateName()); refreshTemplates(index); });
        $('compare-template-export').onclick = () => runTemplate(() => api.templates.export(templateName()));
        $('compare-template-apply').onclick = () => runTemplate(() => api.templates.apply(Number($('compare-template-select').value)), true);
        $('compare-template-delete').onclick = () => runTemplate(() => { api.templates.remove(Number($('compare-template-select').value)); refreshTemplates(''); });
        $('compare-template-import').onchange = event => {
            const file = event.target.files[0]; event.target.value = '';
            if (file) runTemplate(() => api.templates.import(file), true);
        };
        $('save-purpose').onchange = () => showPurpose();
        host.addEventListener('change', syncAvailability);
        // Native prompts and hidden file pickers reuse the existing host handlers.
        // Let synchronous selection changes finish before updating availability.
        host.addEventListener('click', () => { setTimeout(syncAvailability, 0); });
        trigger.setAttribute('aria-label', '保存・再利用'); trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.dataset.tipTitle = '保存・再利用'; trigger.dataset.tipDesc = '目的を選び、画像・数値・作業設定を保存し、次の試験へ再利用します';
        trigger.querySelector('.btn-label').textContent = '保存・再利用'; trigger.onclick = () => open();
        new MutationObserver(() => { if (dialog?.overlay.isConnected) syncAvailability(); }).observe($('file-list'), { childList: true, subtree: true });
        refreshTemplates(); showPurpose('output');
        return { open, close };
    };
})(window);
