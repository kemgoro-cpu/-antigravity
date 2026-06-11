// チャートのレイアウト計算(フォントサイズプリセット・グリッド高さ配分)の純粋関数。
// DOM・ECharts・stateに触れないため、Nodeで単体テストできる(tests/layout-utils.test.js)。
// parser-utils.js等と同じUMDパターン: ブラウザでは root.CSVLayout、Nodeでは module.exports。
(function (root) {
    'use strict';

    // フォントサイズの段階プリセット(px)。
    // label: 軸の数値ラベル / name: Y軸チャンネル名(常にlabelより大きく) /
    // tooltip: ツールチップとホバー値ラベル / slider: X軸スライダーの数値
    const FONT_PRESETS = {
        small:  { label: 9,  name: 11, tooltip: 10, slider: 9 },
        normal: { label: 10, name: 13, tooltip: 11, slider: 10 },
        large:  { label: 12, name: 16, tooltip: 13, slider: 11 },
        xlarge: { label: 14, name: 19, tooltip: 15, slider: 12 },
    };

    // グリッド高さの調整範囲(px)
    const MIN_GRID_H = 40;   // 個別/手動指定時の最小
    const MAX_GRID_H = 800;  // 個別/手動指定時の最大
    const MIN_AUTO_H = 24;   // 自動フィット時の最小(従来互換)

    /**
     * フォントスケール名からサイズ一式を取得する。未知の値はnormal扱い。
     */
    function getFontSizes(scale) {
        return FONT_PRESETS[scale] || FONT_PRESETS.normal;
    }

    /**
     * フォントサイズから派生するレイアウト値(px)を計算する。
     * フォントを大きくしたとき、Y軸の数値や軸名が見切れないように余白も連動させる。
     */
    function deriveLayout(fonts) {
        // 軸の数値ラベルの表示幅(従来: fontSize10でwidth44)
        const labelWidth = Math.round(44 * fonts.label / 10);
        // 軸名と軸線の間隔(数値ラベル幅+余白)
        const nameGap = labelWidth + 8 + Math.round(fonts.label * 0.4);
        // グリッドの左マージン(軸名の文字幅ぶんまで確保)
        const gridLeft = nameGap + fonts.name + 10;
        // 複数Y軸を並べるときの軸間隔
        const axisGap = nameGap + fonts.name + 4;
        return { labelWidth, nameGap, gridLeft, axisGap };
    }

    /**
     * グリッド(チャート)を永続的に同定するキーを作る。
     * chartGroupsのid(連番カウンタ)はセッションごとに変わるため、
     * チャンネル名の組(ソート済み)で同定する。
     */
    function gridSignature(mergedNames) {
        return [...mergedNames].sort().join('|');
    }

    /**
     * Y軸チャンネル名(回転表示)の切り詰め幅。グリッド高さに収まるようにする。
     */
    function truncateMaxWidth(gridH) {
        return Math.max(24, gridH - 8);
    }

    /**
     * 各グリッドの高さ(px)とキャンバス総高さを計算する。
     *
     * - rowHeightPx が null かつ個別上書きなし → 従来どおりコンテナ高さに収まる重み配分
     * - それ以外 → 各グリッド = 個別上書き ?? 基準高さ×重み。合計がコンテナを超えたら
     *   キャンバスを伸ばす(=呼び出し側で縦スクロールになる)
     *
     * @param {object} p
     * @param {number[]} p.weights     グリッドごとの重み(Bitグリッドは0.33等)
     * @param {string[]} p.signatures  グリッドごとのsignature(overridesのキー)
     * @param {object}   p.overrides   個別上書き { signature: px }
     * @param {number|null} p.rowHeightPx 基準行高さ(null=自動フィット)
     * @param {number} p.containerH    チャートコンテナの高さ(px)
     * @param {number} p.topPx @param {number} p.botPx @param {number} p.gapPx 余白
     * @returns {{heights: number[], totalH: number, autoRow: number}}
     *   autoRow: 自動フィット時の重み1.0グリッドの高さ(全体+/-ボタンの起点に使う)
     */
    function computeGridHeights({ weights, signatures, overrides, rowHeightPx, containerH, topPx, botPx, gapPx }) {
        const n = weights.length;
        const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
        const availH = containerH - topPx - botPx - (n - 1) * gapPx;
        const autoRow = availH / totalWeight;

        const hasOverrides = overrides && Object.keys(overrides).length > 0;
        let heights;
        if (rowHeightPx == null && !hasOverrides) {
            // 従来互換: コンテナに収まる重み配分(最小24px)
            heights = weights.map(w => Math.max(Math.floor(availH * w / totalWeight), MIN_AUTO_H));
        } else {
            const baseRow = rowHeightPx != null ? rowHeightPx : autoRow;
            heights = weights.map((w, i) => {
                const ov = overrides ? overrides[signatures[i]] : undefined;
                const h = ov != null ? ov : baseRow * w;
                return Math.round(Math.min(Math.max(h, MIN_GRID_H), MAX_GRID_H));
            });
        }

        const sumH = heights.reduce((s, h) => s + h, 0);
        const neededH = topPx + botPx + (n - 1) * gapPx + sumH;
        // コンテナより小さい場合はコンテナ高さを使う(キャンバスを縮めない)
        const totalH = Math.max(neededH, containerH);
        return { heights, totalH, autoRow };
    }

    const api = {
        FONT_PRESETS,
        MIN_GRID_H,
        MAX_GRID_H,
        getFontSizes,
        deriveLayout,
        gridSignature,
        truncateMaxWidth,
        computeGridHeights,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.CSVLayout = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
