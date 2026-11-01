/* Local development preview. Production file:// use never enables this panel. */
(function (root) {
    'use strict';
    const LOG_NAME = 'デモ_燃費率マップ付き走行ログ.csv';
    const MAP_NAME = '練習用_詳細燃費率ﾏｯﾌﾟ.csv';
    const SAMPLE_ROOT = 'docs/samples/';
    const IMPORT_OPTIONS = Object.freeze({ nameMode: 'manual', nameRow: 0, unitMode: 'manual', unitRow: 1,
        timeColumn: 0, delimiter: ',', encodingMode: 'utf-8' });

    function enabled(location) {
        return !!location && location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
            && new URLSearchParams(location.search).get('preview') === '1';
    }
    function memoryStorage() {
        const values = new Map();
        return { getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
            setItem: (key, value) => values.set(String(key), String(value)), removeItem: key => values.delete(String(key)), clear: () => values.clear() };
    }
    function create(api) {
        if (!enabled(api.location || root.location)) return null;
        const document = api.document || root.document;
        const panel = document.createElement('section'); panel.id = 'dev-preview-panel'; panel.className = 'dev-preview-panel';
        panel.setAttribute('aria-label', '開発用プレビュー');
        panel.innerHTML = '<div class="dev-preview-heading"><strong>開発用プレビュー</strong><button id="dev-preview-demo" type="button" class="btn-secondary">デモを読み込む</button></div><p>この画面の作業は自動保存しません。デモは架空データです。</p><p id="dev-preview-status" role="status" aria-live="polite"></p>';
        api.host.prepend(panel);
        const button = panel.querySelector('#dev-preview-demo'), status = panel.querySelector('#dev-preview-status');
        let busy = false, generation = 0, controller = null, message = '', destroyed = false, lastFileCount = 0;
        const state = () => api.state();
        function blocked() { const value = state(); return value.restoring || value.loading || value.fileCount > 0; }
        function refresh() {
            if (destroyed) return;
            const value = state();
            if (!busy && value.fileCount === 0 && lastFileCount > 0) message = '';
            lastFileCount = value.fileCount;
            button.disabled = busy || blocked(); button.textContent = busy ? '読み込み中…' : 'デモを読み込む';
            panel.setAttribute('aria-busy', String(busy));
            status.textContent = message || (value.restoring || value.loading ? '現在の読み込みが終わるまでお待ちください。'
                : value.fileCount ? 'デモは空の画面で読み込みます。このプレビューを再読み込みすると空の状態に戻ります。'
                    : '回転数・トルクの波形と詳細な燃費率マップを、一度に表示します。');
        }
        function cancel(reason = 'デモの読み込みを中止しました。') {
            if (!busy) { message = ''; refresh(); return; }
            generation++; controller?.abort(); controller = null; busy = false; message = reason; refresh();
        }
        async function load() {
            if (destroyed || busy || blocked()) { refresh(); return false; }
            const token = ++generation; controller = new AbortController(); const signal = controller.signal;
            const current = () => !destroyed && generation === token && !signal.aborted;
            busy = true; message = '同梱のデモと背景マップを読み込んでいます…'; refresh();
            try {
                const read = async name => {
                    const response = await (api.fetch || root.fetch.bind(root))(SAMPLE_ROOT + encodeURIComponent(name), { signal, cache: 'no-store', redirect: 'error' });
                    if (!response.ok) throw new Error(`${name} を取得できませんでした（HTTP ${response.status}）。`);
                    const text = await response.text();
                    const file = new (api.File || root.File)([text], name, { type: 'text/csv', lastModified: 0 });
                    if (file.size > 5 * 1024 * 1024) throw new Error('デモのサイズが上限を超えています。');
                    return file;
                };
                const [log, map] = await Promise.all([read(LOG_NAME), read(MAP_NAME)]);
                if (!current()) return false;
                if (blocked()) throw new Error('別の読み込みが始まったため、デモを追加しませんでした。');
                const id = await api.loadLog(log, IMPORT_OPTIONS, signal);
                if (!current()) return false;
                if (!id) throw new Error('デモの解析を完了できませんでした。');
                const stillCurrent = () => current() && api.isOnlyFile(id);
                if (!stillCurrent()) throw new Error('対象のログが変わったため、デモの表示設定を中止しました。');
                if (!await api.configure(id, map, stillCurrent, signal)) throw new Error('デモの表示を完了できませんでした。');
                if (!stillCurrent()) return false;
                message = 'デモを表示しました。波形カーソル、境界の幅調整、マップの拡大操作を試せます。';
                return true;
            } catch (error) {
                if (current()) { message = 'デモを読み込めませんでした: ' + (error.message || error); controller?.abort(); }
                return false;
            } finally {
                if (generation === token) { controller = null; busy = false; refresh(); }
            }
        }
        button.addEventListener('click', load); refresh();
        return { load, cancel, refresh, inspect: () => ({ busy, message }), destroy() { cancel(); destroyed = true; button.removeEventListener('click', load); panel.remove(); } };
    }
    const api = { enabled, memoryStorage, create, IMPORT_OPTIONS, LOG_NAME, MAP_NAME };
    root.CSVDevPreview = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
