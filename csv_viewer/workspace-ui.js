/* Workspace presentation and navigation. No parsing or comparison calculations live here. */
(function (root) {
    'use strict';
    root.CSVWorkspaceUI = function (api) {
        const $ = id => document.getElementById(id);
        const sidebar = document.querySelector('.sidebar');
        const main = document.querySelector('.main-content');
        const header = document.querySelector('.compare-header');
        const panel = $('compare-panel');
        const panelToggle = $('compare-panel-toggle');
        const search = $('column-search');
        const small = matchMedia('(max-width: 760px)');
        const compact = matchMedia('(max-width: 1279px)');
        let sidebarOpen = !small.matches, panelChosen = false, previousFiles = 0, queued = false;
        let sidebarReturnFocus = null;

        sidebar.id = 'workspace-sidebar';
        sidebar.setAttribute('aria-label', 'ファイルとチャンネル');
        const sidebarToggle = document.createElement('button');
        sidebarToggle.id = 'workspace-sidebar-toggle';
        sidebarToggle.className = 'btn-secondary';
        sidebarToggle.setAttribute('aria-controls', sidebar.id);
        sidebarToggle.innerHTML = '<i class="bx bx-sidebar" aria-hidden="true"></i><span>ファイル</span>';
        sidebarToggle.title = 'ファイルとチャンネルの表示を切り替え';
        header.prepend(sidebarToggle);
        const sidebarClose = document.createElement('button');
        sidebarClose.id = 'workspace-sidebar-close';
        sidebarClose.className = 'btn-secondary workspace-icon-button';
        sidebarClose.setAttribute('aria-label', 'ファイルとチャンネルを閉じる');
        sidebarClose.textContent = '×';
        document.querySelector('.sidebar-header').appendChild(sidebarClose);
        const backdrop = document.createElement('button');
        backdrop.id = 'workspace-sidebar-backdrop';
        backdrop.className = 'workspace-backdrop hidden';
        backdrop.tabIndex = -1;
        backdrop.setAttribute('aria-label', 'ファイルとチャンネルを閉じる');
        document.body.appendChild(backdrop);

        function setSidebar(value, returnFocus = true) {
            if (value && !sidebarOpen) sidebarReturnFocus = document.activeElement;
            const shouldRestoreFocus = sidebar.contains(document.activeElement) || document.activeElement === backdrop;
            sidebarOpen = value;
            document.body.classList.toggle('workspace-sidebar-open', value);
            document.body.classList.toggle('workspace-sidebar-collapsed', !value);
            sidebar.inert = !value;
            main.inert = small.matches && value;
            backdrop.classList.toggle('hidden', !(small.matches && value));
            sidebarToggle.setAttribute('aria-expanded', String(value));
            if (small.matches && value) {
                sidebar.setAttribute('role', 'dialog');
                sidebar.setAttribute('aria-modal', 'true');
            } else {
                sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal');
            }
            if (!value && returnFocus && shouldRestoreFocus) {
                const target = sidebarReturnFocus?.isConnected && !sidebar.contains(sidebarReturnFocus) ? sidebarReturnFocus : sidebarToggle;
                target.focus();
            }
            requestAnimationFrame(api.resize);
        }
        sidebarToggle.onclick = () => { setSidebar(!sidebarOpen); if (small.matches && sidebarOpen) sidebarClose.focus(); };
        sidebarClose.onclick = backdrop.onclick = () => setSidebar(false);
        small.addEventListener('change', () => setSidebar(!small.matches));
        setSidebar(sidebarOpen, false);

        // The comparison drawer has a close control in the same region as its contents.
        panelToggle.setAttribute('aria-controls', panel.id);
        const panelHead = document.createElement('div'); panelHead.className = 'workspace-panel-heading';
        panelHead.innerHTML = '<strong>比較パネル</strong><button id="workspace-panel-close" class="btn-secondary workspace-icon-button" aria-label="比較パネルを閉じる">×</button>';
        panel.prepend(panelHead);
        $('workspace-panel-close').onclick = () => { panelToggle.click(); panelToggle.focus(); };
        panelToggle.addEventListener('click', () => { panelChosen = true; });
        function hidePanel() { if (!panel.classList.contains('hidden')) panelToggle.click(); }
        compact.addEventListener('change', () => {
            if (compact.matches) hidePanel();
        });
        // Empty and single-file workspaces need space for the chart, not comparison setup.
        if (compact.matches || Object.keys(api.state.files).length < 2) hidePanel();
        panelChosen = false;

        // Keep common actions named; put chart height controls with other display settings.
        const heights = document.createElement('div'); heights.className = 'workspace-height-controls';
        heights.innerHTML = '<span>チャートの高さ</span>';
        for (const id of ['row-fit-btn', 'row-minus-btn', 'row-plus-btn']) heights.appendChild($(id));
        $('view-menu-panel').appendChild(heights);
        const clearRow = document.createElement('div'); clearRow.className = 'workspace-file-actions';
        clearRow.appendChild($('clear-all-btn'));
        $('file-list').after(clearRow);
        $('clear-all-btn').querySelector('.btn-label').textContent = '作業をすべてクリア';
        document.querySelectorAll('.toolbar-sep').forEach(el => el.remove());
        for (const id of ['view-menu-btn', 'export-menu-btn']) $(id).setAttribute('aria-label', id === 'view-menu-btn' ? '表示設定' : '保存・出力');
        $('export-menu-btn').querySelector('.btn-label').textContent = '保存・出力';
        $('toolbar-hint').setAttribute('role', 'status');
        document.querySelector('.chart-container').appendChild($('toolbar-hint'));

        const searchLabel = document.createElement('label'); searchLabel.htmlFor = search.id;
        searchLabel.className = 'workspace-search-label'; searchLabel.textContent = 'チャンネルを検索';
        document.querySelector('.search-box').before(searchLabel);
        search.placeholder = '名前・単位・検索別名';
        search.setAttribute('aria-keyshortcuts', 'Control+k /');
        const clearSearch = document.createElement('button'); clearSearch.id = 'workspace-search-clear';
        clearSearch.className = 'workspace-search-clear'; clearSearch.textContent = '×';
        clearSearch.setAttribute('aria-label', '検索文字を消す');
        document.querySelector('.search-box').appendChild(clearSearch);
        const feedback = document.createElement('div'); feedback.className = 'workspace-channel-feedback';
        feedback.innerHTML = '<span id="workspace-channel-count" role="status" aria-live="polite"></span><button id="workspace-filter-reset" class="workspace-text-button" hidden>絞り込みを解除</button>';
        $('column-list').before(feedback);
        function resetSearch() {
            search.value = ''; $('compare-channel-filter').value = 'all';
            $('compare-channel-filter').dispatchEvent(new Event('change', { bubbles: true }));
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.focus(); schedule();
        }
        clearSearch.onclick = () => { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); search.focus(); schedule(); };
        $('workspace-filter-reset').onclick = resetSearch;
        search.addEventListener('input', schedule);
        search.addEventListener('keydown', e => {
            if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); clearSearch.click(); }
        });
        function focusSearch() {
            setSidebar(true, false);
            const group = document.querySelector('[data-section="channels"]');
            if (group.classList.contains('collapsed')) group.querySelector('h3').click();
            search.focus(); search.select();
        }
        $('workspace-select-channels').onclick = focusSearch;
        window.addEventListener('drop', e => {
            if (e.target.closest('#drop-zone') || $('app-modal-overlay')) return;
            const files = [...(e.dataTransfer?.files || [])].filter(file => /\.(csv|trn)$/i.test(file.name));
            if (files.length) { e.preventDefault(); api.loadFiles(files); }
        });
        document.addEventListener('keydown', e => {
            if (e.defaultPrevented || e.isComposing || $('app-modal-overlay')) return;
            const inField = e.target.closest('input,textarea,select,[contenteditable="true"]');
            if (((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') ||
                (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '/')) {
                e.preventDefault(); e.stopImmediatePropagation(); focusSearch(); return;
            }
            if (small.matches && sidebarOpen) {
                if (e.key === 'Escape' && e.target === search && search.value) {
                    e.preventDefault(); e.stopImmediatePropagation(); clearSearch.click(); return;
                }
                if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setSidebar(false); return; }
                if (e.key === 'Tab') {
                    const items = [...sidebar.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
                    const first = items[0], last = items[items.length - 1];
                    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
                } else if (!inField && /^[btrm?]$/i.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
            }
        }, true);

        // Native details stay usable by keyboard, and action focus returns to their trigger.
        const tools = document.querySelector('.compare-tools');
        tools.addEventListener('click', e => { if (e.target.closest('button') && !$('app-modal-overlay')) tools.querySelector('summary').focus(); });
        tools.addEventListener('keydown', e => {
            if (e.key === 'Escape') { tools.open = false; tools.querySelector('summary').focus(); e.preventDefault(); e.stopPropagation(); }
        });

        function sync() {
            queued = false;
            const files = Object.values(api.state.files), hasFiles = files.length > 0, selected = api.state.selectedNames.size;
            const loading = api.state.parseJobs.size > 0;
            document.body.classList.toggle('workspace-has-files', hasFiles);
            document.body.classList.toggle('workspace-has-chart', selected > 0);
            if (!panelChosen && !compact.matches && files.length >= 2 && previousFiles < 2 && panel.classList.contains('hidden')) {
                panelToggle.click(); panelChosen = false;
            }
            previousFiles = files.length;
            $('workspace-empty-title').textContent = hasFiles ? '表示するチャンネルを選ぼう' : loading ? 'ファイルを読み込んでいます…' : 'データを開いて、波形を見よう';
            $('workspace-empty-description').textContent = hasFiles ? `${files.length} ファイルを読み込みました。名前や単位で検索して、波形を追加できます。` : 'ファイルを選択するか、この画面にドロップしてください。';
            $('workspace-empty-detail').textContent = hasFiles ? '2つ以上のファイルを開くと、同じチャンネルを重ねて比較できます。' : 'データは端末内で処理され、外部へ送信されません。';
            $('overlay-browse-btn').classList.toggle('hidden', hasFiles);
            $('workspace-select-channels').classList.toggle('hidden', !hasFiles);
            $('overlay-browse-btn').disabled = loading;
            $('chart-overlay').inert = $('chart-overlay').classList.contains('hidden');
            const count = $('column-list').querySelectorAll('.col-item').length;
            const total = api.main()?.columns.length || 0;
            $('workspace-channel-count').textContent = hasFiles ? `${count} / ${total} 件 · 表示中 ${selected}` : 'ファイルを開くと一覧が表示されます';
            clearSearch.hidden = !search.value;
            $('workspace-filter-reset').hidden = !search.value && $('compare-channel-filter').value === 'all';
            $('compare-select-range').disabled = !selected;
            $('compare-raw').disabled = files.length < 2;
            for (const id of ['compare-range-go', 'compare-range-all', 'compare-range-start', 'compare-range-end']) $(id).disabled = !selected;
            const placeholder = $('column-list').querySelector('.placeholder-text');
            if (hasFiles && !count && placeholder && placeholder.textContent !== '一致するチャンネルがありません。検索語や絞り込みを変更してください。') {
                placeholder.textContent = '一致するチャンネルがありません。検索語や絞り込みを変更してください。';
            }
        }
        function schedule() { if (!queued) { queued = true; requestAnimationFrame(sync); } }
        const observer = new MutationObserver(schedule);
        for (const id of ['file-list', 'column-list', 'parse-status-list']) observer.observe($(id), { childList: true });
        observer.observe($('chart-overlay'), { attributes: true, attributeFilter: ['class'] });
        observer.observe($('compare-status'), { childList: true });
        sync();
    };
})(window);
