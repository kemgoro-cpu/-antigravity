/* Session persistence state. Success means the storage transaction committed. */
(function (root) {
    'use strict';
    function create(options) {
        const entries = new Map(), cleanup = new Map();
        let queue = Promise.resolve(), generation = 0;
        const notify = () => options.changed?.();
        const enqueue = work => {
            const task = queue.then(work);
            queue = task.catch(() => {});
            return task;
        };
        const active = (id, entry) => entries.get(id) === entry && options.exists(id);
        const detail = error => error?.name === 'QuotaExceededError'
            ? 'ブラウザの保存容量が不足しています。不要な復元データを整理して再試行してください。'
            : error?.name === 'SecurityError' || error?.name === 'NotSupportedError'
                ? 'このブラウザ環境では自動復元用の保存を利用できません。元ログを保管してください。'
                : '自動復元用の保存に失敗しました。元ログを保管し、再試行してください。';
        function save(id, file, name, metadata = {}, restored = null) {
            if (!options.exists(id)) return Promise.resolve(false);
            let entry = entries.get(id);
            if (entry?.status === 'saving') return entry.pending;
            if (!entry) {
                const previousTime = restored?.savedAt || restored?.addedAt;
                entry = { id, file, name, key: restored?.id || id,
                    savedAt: Number.isFinite(previousTime) && previousTime > 0 && previousTime <= 8640000000000000 ? previousTime : null,
                    restorable: !!restored, metadata };
                entries.set(id, entry);
            }
            entry.file = file; entry.name = name; entry.metadata = metadata;
            if (!options.supported()) {
                entry.status = 'unavailable'; entry.reason = 'この環境は自動復元用の保存に非対応です。元ログを保管してください。';
                entry.restorable = false; notify(); return Promise.resolve(false);
            }
            entry.status = 'saving'; entry.reason = ''; notify();
            entry.pending = enqueue(async () => {
                if (!active(id, entry)) return false;
                const savedAt = options.now();
                try {
                    const result = await options.write({ id: entry.key, name, size: file.size,
                        ...metadata, addedAt: savedAt, savedAt, blob: file });
                    if (!active(id, entry)) return false;
                    if (!result.saved) {
                        entry.status = 'skipped'; entry.reason = result.reason;
                        entry.restorable = !!result.existing;
                    } else {
                        entry.status = 'saved'; entry.savedAt = savedAt; entry.restorable = true;
                    }
                    notify(); return result.saved;
                } catch (error) {
                    if (!active(id, entry)) return false;
                    entry.status = ['SecurityError', 'NotSupportedError'].includes(error?.name) ? 'unavailable' : 'failed';
                    entry.reason = detail(error);
                    // A previously committed unchanged Blob is still a backup; do not report a new success.
                    notify(); return false;
                }
            });
            return entry.pending;
        }
        function runCleanup(key, action, message) {
            const item = { key, action, message, pending: true };
            cleanup.set(key, item); notify();
            return enqueue(async () => {
                try {
                    await action();
                    if (cleanup.get(key) === item) cleanup.delete(key);
                    notify(); return true;
                } catch (error) {
                    if (cleanup.get(key) === item) { item.pending = false; item.reason = error?.message || '保存領域へアクセスできません'; }
                    notify(); return false;
                }
            });
        }
        function remove(id) {
            const entry = entries.get(id);
            entries.delete(id); generation++; notify();
            return runCleanup('remove:' + id, () => options.remove(entry?.key || id), 'ファイルの自動復元データを削除できませんでした');
        }
        function clear() {
            generation++; entries.clear(); cleanup.clear(); notify();
            return runCleanup('clear', async () => {
                // A retry must not erase files loaded after the clear operation.
                const preserve = new Set([...entries.values()].map(e => e.key));
                const records = await options.read();
                await options.clear(records.filter(r => !preserve.has(r.id)).map(r => r.id));
            }, '自動復元データをすべて削除できませんでした');
        }
        return {
            save, remove, clear,
            get: id => entries.get(id),
            generation: () => generation,
            read: () => enqueue(options.read),
            idle: () => queue,
            notices: () => [...cleanup.values()],
            retry: id => { const e = entries.get(id); return e ? save(id, e.file, e.name, e.metadata) : Promise.resolve(false); },
            retryCleanup: key => { const n = cleanup.get(key); return n && !n.pending ? runCleanup(key, n.action, n.message) : Promise.resolve(false); },
        };
    }
    function describe(entry) {
        if (!entry) return { status: 'pending', label: '保存待ち', detail: '自動復元用の保存状態を確認しています。', retry: false };
        const labels = { saving: '保存中', saved: '保存済み・次回復元可能', skipped: '今回のみ', unavailable: '非対応', failed: '保存失敗' };
        let label = labels[entry.status] || '保存待ち';
        if (entry.restorable && entry.status === 'skipped') label = '保存更新を見送り';
        if (entry.restorable && entry.status !== 'saved' && entry.status !== 'saving') label += '・前回保存分は復元可能';
        return { status: entry.status, label, detail: entry.reason || (entry.status === 'saved'
            ? 'このログはブラウザ内に保存されています。元のCSV / TRNも保管してください。'
            : 'ブラウザ内への保存完了を待っています。'), savedAt: entry.savedAt,
            retry: entry.status !== 'saving' && entry.status !== 'saved' };
    }
    const api = { create, describe };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CSVSessionStatus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
