// Undo/Redo用の統合履歴ロジック(純粋関数のみ)。
// 「いつ・何を記録するか」はapp.js側の責務、「どう積む・どう辿るか」がこのファイルの責務。
// DOM・state・chartには一切触れないため、Nodeで単体テストできる(tests/history-utils.test.js)。
// parser-utils.js / settings-utils.js と同じUMDパターン: ブラウザでは root.CSVHistory、Nodeでは module.exports。
(function (root) {
    'use strict';

    // 履歴の最大保持数(超えたら古いものから捨てる)
    const HISTORY_MAX = 50;
    // 同じcoalesceKeyの操作がこの間隔(ms)内に連続したら、直前エントリを置換して1つにまとめる
    // (カラーピッカーのドラッグ中など、連続発火する操作の履歴スパム対策)
    const COALESCE_MS = 1000;
    // ズーム範囲(%)の差がこれ未満なら「同じズーム」とみなす
    const ZOOM_EPS = 0.001;
    // 履歴比較から除外する「見た目だけ」の設定キー
    // (サイドバー幅の変更だけでUndoエントリが積まれるのは違和感があるため)
    const VISUAL_ONLY_KEYS = ['sidebarWidth'];

    /**
     * 空の履歴オブジェクトを作る。
     * entries: エントリ配列 / idx: 現在位置(-1=空) / max: 最大保持数
     */
    function createHistory(max = HISTORY_MAX) {
        return { entries: [], idx: -1, max };
    }

    /**
     * 設定オブジェクトから履歴比較に使わないキーを除いたコピーを返す(入力は変更しない)。
     */
    function normalizeSettings(settings) {
        const out = { ...settings };
        for (const k of VISUAL_ONLY_KEYS) delete out[k];
        return out;
    }

    /**
     * 設定の同一判定用キー(正規化後のJSON文字列)を返す。
     */
    function settingsKey(settings) {
        return JSON.stringify(normalizeSettings(settings));
    }

    /**
     * 2つのズーム範囲が実質同じか判定する。
     */
    function sameZoom(a, b, eps = ZOOM_EPS) {
        if (!a || !b) return false;
        return Math.abs(a.start - b.start) < eps && Math.abs(a.end - b.end) < eps;
    }

    /**
     * 履歴エントリを生成する(正規化とキー計算をここで行う)。
     * @param {object} settings 設定スナップショット(collectSettingsの戻り値)
     * @param {{start:number,end:number}} zoom X軸ズーム範囲(%)
     * @param {number} ts 記録時刻(Date.now())
     * @param {string|null} coalesceKey 連続操作の統合キー(例 'fileColor:f3')
     */
    function makeEntry(settings, zoom, ts, coalesceKey = null) {
        const key = JSON.stringify(normalizeSettings(settings));
        return {
            key,
            // keyのstringifyを再利用したdeep copy。
            // collectSettingsはstateへの生の参照(yRanges等)を含むため、
            // 浅いコピーだと後の操作で過去の履歴エントリまで書き換わってしまう
            settings: JSON.parse(key),
            zoom: { start: zoom.start, end: zoom.end },
            ts,
            coalesceKey,
        };
    }

    /**
     * エントリを履歴に積む。
     * @returns {'skipped'|'coalesced'|'pushed'}
     *   skipped:   現在位置と内容が同じ(設定もズームも変化なし)ので何もしなかった
     *   coalesced: 直前エントリと同じcoalesceKeyの連続操作なので、直前を置き換えた
     *   pushed:    新しいエントリとして追加した
     */
    function push(hist, entry) {
        // 1. 重複排除: 現在位置のエントリと設定もズームも同じなら積まない
        const cur = hist.idx >= 0 ? hist.entries[hist.idx] : null;
        if (cur && cur.key === entry.key && sameZoom(cur.zoom, entry.zoom)) {
            return 'skipped';
        }

        // 2. Redo側の切り捨て: 新しい操作をしたらRedo履歴は消える
        hist.entries.length = hist.idx + 1;

        // 3. 連続操作の統合: 直前と同じcoalesceKeyかつ短時間なら置換
        const prev = hist.entries[hist.entries.length - 1];
        if (prev && entry.coalesceKey && prev.coalesceKey === entry.coalesceKey
            && (entry.ts - prev.ts) < COALESCE_MS) {
            hist.entries[hist.entries.length - 1] = entry;
            hist.idx = hist.entries.length - 1;
            return 'coalesced';
        }

        // 4. 追加。上限を超えたら最古を捨てる
        hist.entries.push(entry);
        if (hist.entries.length > hist.max) {
            hist.entries.shift();
        }
        hist.idx = hist.entries.length - 1;
        return 'pushed';
    }

    function canUndo(hist) {
        return hist.idx > 0;
    }

    function canRedo(hist) {
        return hist.idx < hist.entries.length - 1;
    }

    /**
     * 1つ前のエントリへ移動して返す。移動できなければnull。
     */
    function undo(hist) {
        if (!canUndo(hist)) return null;
        hist.idx--;
        return hist.entries[hist.idx];
    }

    /**
     * 1つ先のエントリへ移動して返す。移動できなければnull。
     */
    function redo(hist) {
        if (!canRedo(hist)) return null;
        hist.idx++;
        return hist.entries[hist.idx];
    }

    /**
     * 履歴を空にする(ファイル構成が変わったときなど)。
     */
    function reset(hist) {
        hist.entries = [];
        hist.idx = -1;
    }

    const api = {
        HISTORY_MAX,
        COALESCE_MS,
        ZOOM_EPS,
        VISUAL_ONLY_KEYS,
        createHistory,
        normalizeSettings,
        settingsKey,
        sameZoom,
        makeEntry,
        push,
        canUndo,
        canRedo,
        undo,
        redo,
        reset,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CSVHistory = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
